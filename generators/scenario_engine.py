#!/usr/bin/env python3
"""Deterministic, cross-source enterprise scenarios for the telemetry generators.

The existing standalone generators remain intact.  This module composes their
existing event builders and inventory into finite test stories whose alerts
share stable correlation pivots (user, source IP, and campaign ID).
"""

from copy import deepcopy
from datetime import datetime, timedelta, timezone
import uuid

import ad_generator as ad
import database_generator as database
import edr_generator as edr
import email_generator as email
import linux_generator as linux
import webapp_generator as webapp
from common_inventory import USERS, user_doc, workstation_host_doc


SOURCE_PORTS = {
    "edr": 5601,
    "email": 5604,
    "linux": 5605,
    "ad": 5606,
    "webapp": 5607,
    "database": 5608,
}

NORMAL_BUILDERS = {
    "ad": ad.NORMAL_EVENTS,
    "database": database.NORMAL_EVENTS,
    "edr": edr.NORMAL_EVENTS,
    "email": email.NORMAL_EVENTS,
    "linux": linux.NORMAL_EVENTS,
    "webapp": webapp.NORMAL_EVENTS,
}


def find_user(name):
    """Return an existing inventory user without changing the inventory."""
    for user in USERS:
        if user.get("name") == name:
            return deepcopy(user)
    available = ", ".join(sorted(user.get("name", "") for user in USERS))
    raise ValueError(f"Unknown inventory user {name!r}. Available users: {available}")


def _iso(value):
    return value.astimezone(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def _correlate(event, source, user, source_ip, campaign_id, stage, tactic, sequence, timestamp):
    """Apply common pivots while preserving every source builder's schema."""
    event["@timestamp"] = _iso(timestamp)
    event.setdefault("event", {})["id"] = str(uuid.uuid4())
    event["event"]["sequence"] = sequence
    event["user"] = user_doc(user)
    event.setdefault("source", {})["ip"] = source_ip

    if source == "edr":
        event["host"] = workstation_host_doc(user)

    related = event.setdefault("related", {})
    related["user"] = [user["name"]]
    related_ips = [ip for ip in related.get("ip", []) if ip and ip != user.get("ip")]
    related["ip"] = list(dict.fromkeys([source_ip, *related_ips]))
    related_hosts = [host for host in related.get("hosts", []) if host]
    related["hosts"] = list(dict.fromkeys([user["host"], *related_hosts]))

    event["attack"] = {
        "campaign_id": campaign_id,
        "stage": stage,
        "tactic": tactic,
    }
    event.setdefault("labels", {}).update({
        "scenario_managed": "true",
        "scenario_campaign_id": campaign_id,
        "scenario_stage": stage,
    })
    event.setdefault("tags", []).extend(["coordinated-scenario", campaign_id])
    return event


def _record(source, builder, user, source_ip, campaign_id, stage, tactic, sequence, timestamp):
    event = builder()
    return source, _correlate(
        event, source, user, source_ip, campaign_id, stage, tactic, sequence, timestamp
    )


def _policy_record(builder, user, source_ip, campaign_id, sequence, timestamp,
                   *, violation=True, authorized=False):
    source, event = _record(
        "edr", builder, user, source_ip, campaign_id,
        "policy_review", "acceptable_use", sequence, timestamp
    )
    event["event"]["kind"] = "event"
    event.setdefault("policy", {})["violation"] = bool(violation)
    event["policy"]["authorized"] = bool(authorized)
    event["policy"]["security_alert"] = False
    event["policy"]["disposition"] = "review" if violation else "allowed"
    return source, event


def build_scenario(name, user_name="maya.georges", source_ip="198.51.100.24",
                   *, start_time=None, campaign_id=None):
    """Build one finite scenario and return ``[(source, event), ...]``."""
    user = find_user(user_name)
    start = start_time or datetime.now(timezone.utc)
    campaign = campaign_id or f"BMB-{name.upper().replace('_', '-')}-{uuid.uuid4().hex[:10]}"
    records = []

    def add(source, builder, stage, tactic):
        sequence = len(records) + 1
        records.append(_record(
            source, builder, user, source_ip, campaign, stage, tactic,
            sequence, start + timedelta(seconds=(sequence - 1) * 4)
        ))

    if name in {"account_compromise", "full_attack_chain", "mixed_enterprise"}:
        add("ad", ad.failed_logon, "credential_access", "TA0006")
        add("ad", ad.failed_logon, "credential_access", "TA0006")
        add("ad", ad.successful_logon, "initial_access", "TA0001")
        add("email", email.phishing_email, "initial_access", "TA0001")

    if name in {"endpoint_persistence", "full_attack_chain", "mixed_enterprise"}:
        add("edr", edr.credential_dumping, "credential_access", "TA0006")
        add("edr", edr.scheduled_task_persistence, "persistence", "TA0003")

    if name in {"exfiltration", "full_attack_chain", "mixed_enterprise"}:
        add("webapp", webapp.large_data_export, "collection", "TA0009")
        add("database", database.large_data_export, "exfiltration", "TA0010")

    if name in {"policy_violations", "mixed_enterprise"}:
        for builder in (
            edr.unauthorized_game_execution,
            edr.interactive_powershell_session,
            edr.prohibited_website_access,
        ):
            sequence = len(records) + 1
            records.append(_policy_record(
                builder, user, source_ip, campaign, sequence,
                start + timedelta(seconds=(sequence - 1) * 4),
                violation=True, authorized=False,
            ))

    if name in {"benign_admin", "mixed_enterprise"}:
        admin = find_user("tony.azar")
        sequence = len(records) + 1
        records.append(_policy_record(
            edr.authorized_admin_maintenance, admin, admin["ip"], campaign,
            sequence, start + timedelta(seconds=(sequence - 1) * 4),
            violation=False, authorized=True,
        ))

    valid_names = {
        "account_compromise", "endpoint_persistence", "exfiltration",
        "full_attack_chain", "policy_violations", "benign_admin", "mixed_enterprise",
    }
    if name not in valid_names:
        raise ValueError(f"Unknown scenario {name!r}; choose one of {sorted(valid_names)}")
    return records

