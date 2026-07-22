#!/usr/bin/env python3
"""
behavior_engine.py

User Behavior Analytics Engine
Used by SIEM generators for AI correlation.

Adds:
- User baseline comparison
- Risk scoring
- Anomaly detection
"""


from datetime import datetime, timezone
import random


# ============================================================
# TIME ANALYSIS
# ============================================================


def current_hour():

    return datetime.now().hour



def check_working_hours(user):

    behavior = user.get(
        "behavior",
        {}
    )


    hours = behavior.get(
        "normal_hours",
        {}
    )


    start = int(
        hours.get(
            "start",
            "08:00"
        ).split(":")[0]
    )


    end = int(
        hours.get(
            "end",
            "18:00"
        ).split(":")[0]
    )


    hour=current_hour()


    if start <= hour <= end:

        return {

            "normal":True,

            "reason":"inside working hours"

        }


    return {

        "normal":False,

        "reason":"outside normal working hours"

    }



# ============================================================
# DEVICE ANALYSIS
# ============================================================


def check_device(user, host):


    assets=user.get(
        "assets",
        {}
    )


    devices=assets.get(
        "assigned_devices",
        []
    )


    if host in devices:

        return {

            "known_device":True,

            "risk":0

        }


    return {

        "known_device":False,

        "risk":25

    }



# ============================================================
# IP ANALYSIS
# ============================================================


def check_ip(user, ip):


    behavior=user.get(
        "behavior",
        {}
    )


    known_ips=behavior.get(
        "usual_ips",
        []
    )


    if ip in known_ips:

        return {

            "known_ip":True,

            "risk":0

        }


    return {

        "known_ip":False,

        "risk":20

    }



# ============================================================
# SERVER ACCESS ANALYSIS
# ============================================================


def check_server_access(user, server):


    allowed=user.get(
        "behavior",
        {}
    ).get(
        "usual_servers",
        []
    )


    if server in allowed:

        return {

            "allowed":True,

            "risk":0

        }


    return {

        "allowed":False,

        "risk":30

    }



# ============================================================
# PRIVILEGE ANALYSIS
# ============================================================


def check_privilege(user, action):


    privilege=user.get(
        "access",
        {}
    ).get(
        "privilege_level",
        "standard"
    )


    dangerous_actions=[

        "admin",

        "delete",

        "grant",

        "domain_admin",

        "privilege_change"

    ]


    suspicious=False


    for item in dangerous_actions:

        if item.lower() in action.lower():

            suspicious=True



    if suspicious and privilege=="standard":

        return {

            "allowed":False,

            "risk":50,

            "reason":
            "standard user performing privileged action"

        }



    return {

        "allowed":True,

        "risk":0

    }



# ============================================================
# DATA VOLUME ANALYSIS
# ============================================================


def check_data_volume(user, amount_mb):


    baseline=user.get(
        "behavior",
        {}
    ).get(
        "average_data_access_mb",
        500
    )


    if amount_mb > baseline * 5:


        return {

            "normal":False,

            "risk":40,

            "deviation":
            round(
                amount_mb / baseline,
                2
            )

        }


    return {

        "normal":True,

        "risk":0,

        "deviation":1

    }



# ============================================================
# USER RISK CALCULATION
# ============================================================


def calculate_risk(
    user,
    extra_risk=0
):


    base=user.get(
        "risk",
        {}
    ).get(
        "score",
        0
    )


    final=min(
        base + extra_risk,
        100
    )


    if final >=80:

        level="critical"


    elif final>=50:

        level="high"


    elif final>=30:

        level="medium"


    else:

        level="low"



    return {

        "score":final,

        "level":level

    }



# ============================================================
# MAIN EVENT ENRICHMENT FUNCTION
# ============================================================


def enrich_event(
    event,
    user,
    host=None,
    source_ip=None,
    server=None,
    action=""

):


    risks=[]


    if user:


        # Time

        time_check=check_working_hours(user)

        if not time_check["normal"]:

            risks.append(20)



        # Device

        if host:

            device=check_device(
                user,
                host
            )

            risks.append(
                device["risk"]
            )



        # IP

        if source_ip:

            ip_result=check_ip(
                user,
                source_ip
            )

            risks.append(
                ip_result["risk"]
            )



        # Server

        if server:

            srv=check_server_access(
                user,
                server
            )

            risks.append(
                srv["risk"]
            )



        # Privilege

        privilege=check_privilege(
            user,
            action
        )

        risks.append(
            privilege["risk"]
        )


        total=sum(risks)


        event["behavior"]={

            "working_hours":
            time_check,


            "risk_factors":
            risks,


            "analysis":
            calculate_risk(
                user,
                total
            )

        }



    return event
