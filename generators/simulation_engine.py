#!/usr/bin/env python3
"""
simulation_engine.py

Realistic SIEM telemetry simulation controller.

Controls:
- Event generation speed
- Business hour patterns
- Random traffic bursts
- Attack windows
- Alert probability
"""


import random
import time
import math
from datetime import datetime


# ============================================================
# GLOBAL SIMULATION STATE
# ============================================================


SIMULATION_MODE = "normal"


ACTIVE_ATTACK = False


ATTACK_SEVERITY = 0


# Keep standalone generators inside the lab's intended signal-to-noise range.
# Coordinated scenarios use ``normal_events_required`` instead of raising these
# rates, so an attack exercise never turns the feed into an unrealistic wall of
# alerts.
ALERT_RATES = {
    "ad": 0.15,
    "edr": 0.14,
    "email": 0.13,
    "database": 0.15,
    "linux": 0.14,
    "webapp": 0.13,
}


# Policy violations are deliberately uncommon and remain ordinary events.
# They are evidence for acceptable-use investigations, not malware alerts.
POLICY_EVENT_RATES = {
    "edr": 0.025,
    "webapp": 0.01,
}



# ============================================================
# TIME PROFILE
# ============================================================


def current_hour():

    return datetime.now().hour



def is_business_hours():

    hour = current_hour()

    return 8 <= hour <= 18



def is_night_time():

    return not is_business_hours()



# ============================================================
# EVENT VOLUME ENGINE
# ============================================================


def get_activity_level():

    """
    Returns environment activity multiplier.

    High:
        Business hours

    Medium:
        Evening

    Low:
        Night
    """


    if is_business_hours():

        return random.uniform(
            1.0,
            3.0
        )


    else:

        return random.uniform(
            0.1,
            0.5
        )



# ============================================================
# REALISTIC EVENT DELAY
# ============================================================


def get_event_delay(base_rate=5):

    """
    Calculates realistic delay.

    base_rate:
        approximate events per second
    """


    activity = get_activity_level()


    effective_rate = (
        base_rate *
        activity
    )


    # Random human/system behavior

    jitter=random.uniform(
        0.5,
        1.8
    )


    delay = (
        1 /
        max(
            effective_rate,
            0.1
        )
    )


    return delay * jitter



# ============================================================
# LOG VOLUME BURSTS
# ============================================================


def should_create_burst():

    """
    Simulates:
    - backups
    - patching
    - scans
    - user activity spikes
    """


    probability=random.random()


    if is_business_hours():

        return probability < 0.08


    return probability < 0.02



def burst_multiplier():

    return random.randint(
        3,
        15
    )



# ============================================================
# ALERT GENERATION LOGIC
# ============================================================


def alert_probability(source):

    """
    Realistic alert rates.

    Most logs are normal.
    """


    base=ALERT_RATES.get(
        source,
        0.14
    )


    if ACTIVE_ATTACK:

        base *= (
            10 +
            ATTACK_SEVERITY
        )


    return min(
        base,
        0.8
    )



def should_generate_alert(source):


    return random.random() < alert_probability(source)


def policy_event_probability(source):

    return POLICY_EVENT_RATES.get(source, 0.0)


def should_generate_policy_event(source):

    return random.random() < policy_event_probability(source)


def normal_events_required(alert_count, target_ratio=0.14, existing_non_alerts=0):
    """Return the padding needed to keep a finite scenario at ``target_ratio``.

    The helper counts generated security alerts only. Policy violations remain
    in the non-alert side of the ratio by design.
    """

    alerts = max(0, int(alert_count))
    existing = max(0, int(existing_non_alerts))
    ratio = float(target_ratio)
    if alerts == 0:
        return 0
    if ratio < 0.13 or ratio > 0.15:
        raise ValueError("target_ratio must be between 0.13 and 0.15")
    current_total = alerts + existing
    minimum_total = math.ceil(alerts / 0.15)
    maximum_total = math.floor(alerts / 0.13)
    candidates = [
        total for total in range(max(current_total, minimum_total), maximum_total + 1)
        if 0.13 <= alerts / total <= 0.15
    ]
    if not candidates:
        raise ValueError(
            "existing non-alert events require additional alerts before the "
            "scenario can fit the 13-15% alert ratio"
        )
    ideal_total = alerts / ratio
    target_total = min(candidates, key=lambda total: abs(total - ideal_total))
    return target_total - current_total



# ============================================================
# ATTACK SIMULATION CONTROL
# ============================================================


def start_attack(
    severity=5
):

    global ACTIVE_ATTACK
    global ATTACK_SEVERITY


    ACTIVE_ATTACK=True

    ATTACK_SEVERITY=severity



def stop_attack():


    global ACTIVE_ATTACK
    global ATTACK_SEVERITY


    ACTIVE_ATTACK=False

    ATTACK_SEVERITY=0



def attack_active():

    return ACTIVE_ATTACK



# ============================================================
# REALISTIC USER ACTIVITY
# ============================================================


def user_activity_multiplier(user):

    """
    Different users create different amounts
    of telemetry.
    """


    roles=user.get(
        "roles",
        []
    )


    if "it_admin" in roles:

        return random.uniform(
            2,
            5
        )


    if "developer" in roles:

        return random.uniform(
            1.5,
            3
        )


    if "service_account" in roles:

        return random.uniform(
            3,
            8
        )


    return random.uniform(
        0.5,
        2
    )



# ============================================================
# EVENT COUNT GENERATOR
# ============================================================


def generate_event_count(
    source,
    minimum=10,
    maximum=1000
):


    activity=get_activity_level()


    count=int(

        random.randint(
            minimum,
            maximum
        )
        *
        activity

    )


    if should_create_burst():

        count *= burst_multiplier()


    return count



# ============================================================
# TEST MODE
# ============================================================


if __name__=="__main__":


    print(
        "Simulation engine test"
    )


    for i in range(10):

        print(

            "delay:",
            get_event_delay(10),

            "alert:",
            should_generate_alert("edr")

        )

        time.sleep(1)
