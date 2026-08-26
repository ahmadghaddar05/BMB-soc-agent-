#!/usr/bin/env python3
"""Canonical MITRE ATT&CK metadata for BMB synthetic security telemetry.

The generators describe observed sensor activity.  This module adds stable
ATT&CK identifiers and observed control disposition without adding an AI
verdict or a hidden answer key.  Correlation and incident promotion remain
backend decisions.
"""

from copy import deepcopy


TACTICS = {
    "TA0043": {"name": "Reconnaissance", "slug": "reconnaissance", "order": 1},
    "TA0001": {"name": "Initial Access", "slug": "initial_access", "order": 2},
    "TA0002": {"name": "Execution", "slug": "execution", "order": 3},
    "TA0003": {"name": "Persistence", "slug": "persistence", "order": 4},
    "TA0004": {"name": "Privilege Escalation", "slug": "privilege_escalation", "order": 5},
    "TA0006": {"name": "Credential Access", "slug": "credential_access", "order": 6},
    "TA0007": {"name": "Discovery", "slug": "discovery", "order": 7},
    "TA0008": {"name": "Lateral Movement", "slug": "lateral_movement", "order": 8},
    "TA0009": {"name": "Collection", "slug": "collection", "order": 9},
    "TA0011": {"name": "Command and Control", "slug": "command_and_control", "order": 10},
    "TA0010": {"name": "Exfiltration", "slug": "exfiltration", "order": 11},
    "TA0040": {"name": "Impact", "slug": "impact", "order": 12},
}


def _mapping(technique_id, technique_name, tactic_id):
    tactic = TACTICS[tactic_id]
    return {
        "technique_id": technique_id,
        "technique_name": technique_name,
        "tactic_id": tactic_id,
        "tactic_name": tactic["name"],
        "tactic_slug": tactic["slug"],
        "tactic_order": tactic["order"],
    }


ACTION_MAPPINGS = {
    # Active Directory / identity telemetry.
    "windows-logon-failure": _mapping("T1110", "Brute Force", "TA0006"),
    "account-lockout": _mapping("T1110", "Brute Force", "TA0006"),
    "password-spray": _mapping("T1110.003", "Password Spraying", "TA0006"),
    "privileged-group-change": _mapping("T1098", "Account Manipulation", "TA0004"),
    "kerberoasting-attempt": _mapping("T1558.003", "Kerberoasting", "TA0006"),
    "directory-replication-request": _mapping("T1003.006", "DCSync", "TA0006"),

    # Endpoint telemetry.
    "suspicious-powershell": _mapping("T1059.001", "PowerShell", "TA0002"),
    "office-child-process": _mapping("T1204.002", "Malicious File", "TA0002"),
    "malware-execution": _mapping("T1204.002", "Malicious File", "TA0002"),
    "command-control-connection": _mapping("T1071.001", "Web Protocols", "TA0011"),
    "credential-access": _mapping("T1003.001", "LSASS Memory", "TA0006"),
    "registry-run-key-modification": _mapping("T1547.001", "Registry Run Keys / Startup Folder", "TA0003"),
    "scheduled-task-created": _mapping("T1053.005", "Scheduled Task", "TA0003"),
    "mass-file-encryption": _mapping("T1486", "Data Encrypted for Impact", "TA0040"),
    "network-service-scanning": _mapping("T1046", "Network Service Discovery", "TA0007"),
    "remote-service-execution": _mapping("T1021.002", "SMB/Windows Admin Shares", "TA0008"),

    # Email telemetry.
    "phishing-email-detected": _mapping("T1566", "Phishing", "TA0001"),
    "malicious-attachment": _mapping("T1566.001", "Spearphishing Attachment", "TA0001"),
    "business-email-compromise": _mapping("T1566.002", "Spearphishing Link", "TA0001"),
    "malicious-url-detected": _mapping("T1566.002", "Spearphishing Link", "TA0001"),

    # Linux telemetry.
    "ssh-bruteforce": _mapping("T1110", "Brute Force", "TA0006"),
    "root-privilege-escalation": _mapping("T1548.003", "Sudo and Sudo Caching", "TA0004"),
    "cron-persistence-created": _mapping("T1053.003", "Cron", "TA0003"),
    "reverse-shell-executed": _mapping("T1059.004", "Unix Shell", "TA0002"),
    "sensitive-file-access": _mapping("T1003.008", "/etc/passwd and /etc/shadow", "TA0006"),

    # Database telemetry.
    "sensitive-table-access": _mapping("T1213", "Data from Information Repositories", "TA0009"),
    "database-large-export": _mapping("T1020", "Automated Exfiltration", "TA0010"),
    "sql-injection-detected": _mapping("T1190", "Exploit Public-Facing Application", "TA0001"),
    "database-privilege-grant": _mapping("T1098", "Account Manipulation", "TA0004"),
    "database-destructive-action": _mapping("T1485", "Data Destruction", "TA0040"),

    # Web application telemetry.
    "sql-injection-attempt": _mapping("T1190", "Exploit Public-Facing Application", "TA0001"),
    "cross-site-scripting": _mapping("T1190", "Exploit Public-Facing Application", "TA0001"),
    "login-bruteforce": _mapping("T1110", "Brute Force", "TA0006"),
    "admin-panel-access": _mapping("T1078", "Valid Accounts", "TA0004"),
    "large-data-export": _mapping("T1213", "Data from Information Repositories", "TA0009"),
    "malicious-file-upload": _mapping("T1505.003", "Web Shell", "TA0003"),
}


def mapping_for_action(action):
    """Return a defensive copy of the canonical mapping for ``action``."""
    mapping = ACTION_MAPPINGS.get(str(action or "").strip().lower())
    return deepcopy(mapping) if mapping else None


def _observed_control(event):
    """Describe the sensor-observed disposition, not an AI conclusion."""
    email_action = event.get("email", {}).get("delivery_action")
    waf_action = event.get("web_application_firewall", {}).get("action")
    outcome = event.get("event", {}).get("outcome")
    action = event.get("event", {}).get("action")

    if email_action == "quarantined":
        return {"status": "blocked", "action": "quarantine", "observed": True}
    if waf_action == "blocked":
        return {"status": "blocked", "action": "block", "observed": True}
    if action == "account-lockout":
        return {"status": "blocked", "action": "lock_account", "observed": True}
    if outcome == "failure":
        return {"status": "blocked", "action": "deny", "observed": True}
    return {"status": "detected", "action": "detect", "observed": True}


def enrich_attack_metadata(event):
    """Add canonical ATT&CK and observed-control fields to an alert event."""
    if event.get("event", {}).get("kind") != "alert":
        return event

    mapping = mapping_for_action(event.get("event", {}).get("action"))
    if not mapping:
        return event

    tactic_id = mapping["tactic_id"]
    technique_id = mapping["technique_id"]
    event["threat"] = {
        "framework": "MITRE ATT&CK",
        "tactic": {
            "id": [tactic_id],
            "name": [mapping["tactic_name"]],
            "reference": [f"https://attack.mitre.org/tactics/{tactic_id}/"],
        },
        "technique": {
            "id": [technique_id],
            "name": [mapping["technique_name"]],
            "reference": [
                f"https://attack.mitre.org/techniques/{technique_id.replace('.', '/')}/"
            ],
        },
    }

    attack = event.setdefault("attack", {})
    original_campaign = attack.get("campaign_id")
    scenario_managed = str(event.get("labels", {}).get("scenario_managed", "")).lower() == "true"
    if original_campaign and not scenario_managed:
        attack.setdefault("template_id", original_campaign)
        event_id = str(event.get("event", {}).get("id", "unknown")).replace("-", "")[:16]
        attack["campaign_id"] = f"BMB-OBS-{event_id.upper()}"
    attack.update({
        "stage": mapping["tactic_slug"],
        "stage_order": mapping["tactic_order"],
        "tactic": tactic_id,
        "tactic_id": tactic_id,
        "tactic_name": mapping["tactic_name"],
        "technique_id": technique_id,
        "technique_name": mapping["technique_name"],
    })

    control = _observed_control(event)
    event["security_control"] = control
    attack["observed_state"] = "contained" if control["status"] == "blocked" else "detected-active"
    return event


__all__ = ["ACTION_MAPPINGS", "TACTICS", "enrich_attack_metadata", "mapping_for_action"]
