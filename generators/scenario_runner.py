#!/usr/bin/env python3
"""Send finite, coordinated enterprise scenarios to the existing UDP inputs."""

import argparse
from datetime import datetime, timedelta, timezone
import json
import random
import socket
import time
import uuid

import ad_generator as ad
import database_generator as database
import edr_generator as edr
import email_generator as email
import linux_generator as linux
import webapp_generator as webapp
from scenario_engine import NORMAL_BUILDERS, SOURCE_PORTS, build_scenario
from simulation_engine import normal_events_required


ALERT_BUILDERS = {
    "ad": ad.ALERT_EVENTS,
    "database": database.ALERT_EVENTS,
    "edr": edr.ALERT_EVENTS,
    "email": email.ALERT_EVENTS,
    "linux": linux.ALERT_EVENTS,
    "webapp": webapp.ALERT_EVENTS,
}

SCENARIOS = (
    "account_compromise",
    "endpoint_persistence",
    "exfiltration",
    "full_attack_chain",
    "policy_violations",
    "benign_admin",
    "mixed_enterprise",
)


def is_alert(record):
    return record[1].get("event", {}).get("kind") == "alert"


def _background_alert():
    source = random.choice(sorted(ALERT_BUILDERS))
    event = random.choice(ALERT_BUILDERS[source])()
    event.setdefault("labels", {})["scenario_background"] = "true"
    event.setdefault("tags", []).append("scenario-background")
    return source, event


def _background_normal(index):
    sources = sorted(NORMAL_BUILDERS)
    source = sources[index % len(sources)]
    event = random.choice(NORMAL_BUILDERS[source])()
    event.setdefault("labels", {})["scenario_background"] = "true"
    event.setdefault("tags", []).append("scenario-background")
    return source, event


def compose_run(scenario, user, source_ip, target_ratio=0.14, repeat=1, seed=None):
    """Compose scenario records plus realistic background noise."""
    if seed is not None:
        random.seed(seed)
    records = []
    started = datetime.now(timezone.utc)
    for iteration in range(repeat):
        records.extend(build_scenario(
            scenario,
            user,
            source_ip,
            start_time=started + timedelta(minutes=iteration),
            campaign_id=f"BMB-{scenario.upper().replace('_', '-')}-{uuid.uuid4().hex[:10]}",
        ))

    while True:
        alerts = sum(1 for record in records if is_alert(record))
        non_alerts = len(records) - alerts
        if alerts == 0:
            records.append(_background_alert())
            continue
        try:
            padding = normal_events_required(alerts, target_ratio, non_alerts)
            break
        except ValueError:
            records.append(_background_alert())

    records.extend(_background_normal(index) for index in range(padding))
    return records


def summarize(records):
    alerts = sum(1 for record in records if is_alert(record))
    policy_events = sum(
        1 for _, event in records if "policy" in event
    )
    total = len(records)
    by_source = {}
    for source, _ in records:
        by_source[source] = by_source.get(source, 0) + 1
    return {
        "total": total,
        "alerts": alerts,
        "normal_or_policy": total - alerts,
        "policy_events": policy_events,
        "alert_ratio": round(alerts / total, 4) if total else 0.0,
        "by_source": by_source,
    }


def send_records(records, host, interval=0.05, print_events=False, dry_run=False):
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        for source, event in records:
            payload = json.dumps(event, separators=(",", ":"), ensure_ascii=False)
            if print_events:
                print(json.dumps({"source": source, "event": event}, ensure_ascii=False))
            if not dry_run:
                sock.sendto(payload.encode("utf-8"), (host, SOURCE_PORTS[source]))
                if interval:
                    time.sleep(interval)
    finally:
        sock.close()


def parse_args():
    parser = argparse.ArgumentParser(
        description="Generate coordinated SOC scenarios with 13-15% alerts"
    )
    parser.add_argument("--scenario", choices=SCENARIOS, default="mixed_enterprise")
    parser.add_argument("--host", default="127.0.0.1", help="Logstash/syslog UDP host")
    parser.add_argument("--user", default="maya.georges", help="Existing inventory username")
    parser.add_argument("--source-ip", default="198.51.100.24")
    parser.add_argument("--alert-ratio", type=float, default=0.14)
    parser.add_argument("--repeat", type=int, default=1)
    parser.add_argument("--seed", type=int, default=20260717)
    parser.add_argument("--interval", type=float, default=0.05)
    parser.add_argument("--dry-run", action="store_true", help="Build and validate without UDP sends")
    parser.add_argument("--print-events", action="store_true", help="Print generated NDJSON")
    return parser.parse_args()


def main():
    args = parse_args()
    if args.repeat < 1:
        raise SystemExit("--repeat must be at least 1")
    records = compose_run(
        args.scenario,
        args.user,
        args.source_ip,
        args.alert_ratio,
        args.repeat,
        args.seed,
    )
    summary = summarize(records)
    if not 0.13 <= summary["alert_ratio"] <= 0.15:
        raise RuntimeError(f"alert ratio escaped safety range: {summary['alert_ratio']}")
    send_records(
        records,
        args.host,
        interval=max(0.0, args.interval),
        print_events=args.print_events,
        dry_run=args.dry_run,
    )
    print(json.dumps({
        "mode": "dry-run" if args.dry_run else "sent",
        "scenario": args.scenario,
        "destination": args.host,
        **summary,
    }, indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
