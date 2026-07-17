#!/usr/bin/env python3
"""
edr_generator.py

Realistic Endpoint Detection and Response telemetry generator.

Integrated with:

- common_inventory.py
- behavior_engine.py
- simulation_engine.py


Simulates:

- Process execution
- Network activity
- Endpoint behavior
- Malware activity
- Persistence
- Command execution
"""


import argparse
import json
import random
import socket
import time
import uuid


from datetime import datetime, timezone



from common_inventory import (

    choose_user,

    user_doc,

    workstation_host_doc,

    related_for_user_host,

    DOC_IPS

)



from behavior_engine import enrich_event



from simulation_engine import (

    get_event_delay,

    should_generate_alert,

    should_generate_policy_event

)





NORMAL_PROCESSES=[

    "chrome.exe",

    "msedge.exe",

    "outlook.exe",

    "teams.exe",

    "winword.exe",

    "excel.exe",

    "explorer.exe"

]



SUSPICIOUS_PROCESSES=[

    "powershell.exe",

    "cmd.exe",

    "rundll32.exe",

    "mshta.exe",

    "certutil.exe",

    "wscript.exe"

]



BENIGN_PARENTS=[

    "explorer.exe",

    "svchost.exe",

    "services.exe"

]



SUSPICIOUS_CHAINS=[

    (

        "WINWORD.EXE",

        "powershell.exe"

    ),

    (

        "EXCEL.EXE",

        "cmd.exe"

    ),

    (

        "outlook.exe",

        "wscript.exe"

    ),

    (

        "explorer.exe",

        "rundll32.exe"

    )

]





# ============================================================
# HELPERS
# ============================================================



def now_iso():

    return datetime.now(

        timezone.utc

    ).strftime(

        "%Y-%m-%dT%H:%M:%S.%f"

    )[:-3]+"Z"





def hash_value(length):

    return "".join(

        random.choices(

            "0123456789abcdef",

            k=length

        )

    )





def entity_id():

    return uuid.uuid4().hex[:16]





def campaign(

    campaign_id,

    stage,

    tactic

):

    return {


        "campaign_id":

        campaign_id,


        "stage":

        stage,


        "tactic":

        tactic

    }





# ============================================================
# BASE EVENT
# ============================================================



def base_event(

    action,

    category,

    severity=1,

    kind="event",

    outcome="success"

):


    return {


        "@timestamp":

        now_iso(),



        "ecs":{

            "version":

            "8.17.0"

        },



        "data_stream":{

            "type":

            "logs",

            "dataset":

            "edr.endpoint",

            "namespace":

            "default"

        },



        "event":{


            "id":

            str(uuid.uuid4()),


            "kind":

            kind,


            "category":

            category,


            "action":

            action,


            "outcome":

            outcome,


            "severity":

            severity,


            "risk_score":

            severity*10,


            "module":

            "edr"

        },



        "agent":{


            "type":

            "edr-agent",


            "version":

            "5.2.0",


            "id":

            entity_id()

        },



        "tags":[

            "edr",

            "endpoint",

            "behavior-analysis",

            "demo"

        ]

    }





# ============================================================
# ENDPOINT CONTEXT
# ============================================================



def add_endpoint_context(

    event,

    user,

    action

):


    event["user"]=user_doc(user)



    event["host"]=workstation_host_doc(user)



    event["related"]=related_for_user_host(

        user

    )



    event["source"]={

        "ip":

        user["ip"],

        "port":

        random.randint(

            49152,

            65535

        )

    }



    enrich_event(

        event,

        user,

        host=user["host"],

        source_ip=user["ip"],

        action=action

    )



    return event





# ============================================================
# PROCESS CREATION
# ============================================================



def add_process(

    event,

    process,

    parent=None

):


    event["process"]={


        "name":

        process,


        "pid":

        random.randint(

            1000,

            50000

        ),


        "entity_id":

        entity_id(),


        "executable":

        f"C:\\Windows\\System32\\{process}",


        "hash":{

            "sha256":

            hash_value(64),

            "sha1":

            hash_value(40),

            "md5":

            hash_value(32)

        }


    }



    if parent:


        event["process"]["parent"]={


            "name":

            parent,


            "pid":

            random.randint(

                500,

                5000

            ),


            "entity_id":

            entity_id()

        }



    return event

# ============================================================
# NORMAL EDR EVENTS
# ============================================================



def normal_process_execution():


    user=choose_user()


    process=random.choice(

        NORMAL_PROCESSES

    )


    parent=random.choice(

        BENIGN_PARENTS

    )


    event=base_event(

        "process-start",

        ["process"],

        severity=1

    )


    add_endpoint_context(

        event,

        user,

        "process_execution"

    )


    add_process(

        event,

        process,

        parent

    )


    event["message"]=(
        f"{parent} launched "
        f"{process} on {user['host']}"
    )


    return event





def normal_network_connection():


    user=choose_user()


    destination=random.choice(

        [

        "13.107.42.14",

        "20.190.160.20",

        "140.82.112.4"

        ]

    )


    event=base_event(

        "network-connection",

        ["network"],

        severity=1

    )


    add_endpoint_context(

        event,

        user,

        "network_connection"

    )


    event["destination"]={

        "ip":

        destination,


        "port":

        443

    }


    event["network"]={

        "protocol":

        "https",

        "transport":

        "tcp"

    }



    event["process"]={

        "name":

        random.choice(

            [

            "chrome.exe",

            "teams.exe",

            "outlook.exe"

            ]

        )

    }


    return event





def dns_lookup():


    user=choose_user()


    domain=random.choice(

        [

        "microsoft.com",

        "github.com",

        "office.com",

        "teams.microsoft.com"

        ]

    )


    event=base_event(

        "dns-query",

        ["network"],

        severity=1

    )


    add_endpoint_context(

        event,

        user,

        "dns_lookup"

    )


    event["dns"]={

        "question":{

            "name":

            domain

        }

    }


    return event





def service_activity():


    user=choose_user()


    event=base_event(

        "service-status",

        ["host"],

        severity=1

    )


    add_endpoint_context(

        event,

        user,

        "service_activity"

    )


    event["service"]={

        "name":

        random.choice(

            [

            "Windows Defender",

            "BITS",

            "Windows Update",

            "Print Spooler"

            ]

        ),

        "state":

        "running"

    }


    return event





# ============================================================
# ATTACK EVENTS
# ============================================================



def powershell_attack():


    user=choose_user()


    event=base_event(

        "suspicious-powershell",

        ["process"],

        severity=9,

        kind="alert"

    )


    add_endpoint_context(

        event,

        user,

        "powershell_execution"

    )


    add_process(

        event,

        "powershell.exe",

        "WINWORD.EXE"

    )


    event["process"]["command_line"]=(
        "powershell.exe "
        "-enc SQBFAFgA"
    )


    event["attack"]=campaign(

        "EDR-EXECUTION-001",

        "execution",

        "TA0002"

    )


    event["rule"]={

        "name":

        "Encoded PowerShell Execution",

        "category":

        "execution"

    }


    return event





def office_macro_attack():


    user=choose_user()


    parent,child=random.choice(

        SUSPICIOUS_CHAINS

    )


    event=base_event(

        "office-child-process",

        ["process"],

        severity=8,

        kind="alert"

    )


    add_endpoint_context(

        event,

        user,

        "macro_execution"

    )


    add_process(

        event,

        child,

        parent

    )


    event["attack"]=campaign(

        "EDR-OFFICE-001",

        "execution",

        "TA0002"

    )


    event["rule"]={

        "name":

        "Office Application Spawned Suspicious Process",

        "category":

        "execution"

    }


    return event





def malware_execution():


    user=choose_user()


    malware=random.choice(

        [

        "invoice.exe",

        "update.exe",

        "payload.exe",

        "document_viewer.exe"

        ]

    )


    event=base_event(

        "malware-execution",

        ["malware"],

        severity=10,

        kind="alert"

    )


    add_endpoint_context(

        event,

        user,

        "malware_execution"

    )


    add_process(

        event,

        malware,

        "explorer.exe"

    )


    event["file"]={

        "name":

        malware,


        "hash":{

            "sha256":

            hash_value(64)

        }

    }


    event["attack"]=campaign(

        "EDR-MALWARE-001",

        "execution",

        "TA0002"

    )


    return event





def c2_connection():


    user=choose_user()


    destination=random.choice(

        DOC_IPS

    )


    event=base_event(

        "command-control-connection",

        ["network"],

        severity=9,

        kind="alert"

    )


    add_endpoint_context(

        event,

        user,

        "c2_connection"

    )


    event["destination"]={

        "ip":

        destination,


        "port":

        random.choice(

            [

            443,

            8080,

            8443

            ]

        )

    }


    add_process(

        event,

        "powershell.exe",

        "explorer.exe"

    )


    event["attack"]=campaign(

        "EDR-C2-001",

        "command_and_control",

        "TA0011"

    )


    event["rule"]={

        "name":

        "Suspicious C2 Communication",

        "category":

        "command-control"

    }


    return event





def credential_dumping():


    user=choose_user()


    event=base_event(

        "credential-access",

        ["process"],

        severity=10,

        kind="alert"

    )


    add_endpoint_context(

        event,

        user,

        "credential_dump"

    )


    add_process(

        event,

        "mimikatz.exe",

        "powershell.exe"

    )


    event["attack"]=campaign(

        "EDR-CRED-001",

        "credential_access",

        "TA0006"

    )


    event["rule"]={

        "name":

        "Credential Dumping Attempt",

        "category":

        "credential-access"

    }


    return event

# ============================================================
# PERSISTENCE ATTACKS
# ============================================================



def registry_persistence():


    user=choose_user()


    event=base_event(

        "registry-run-key-modification",

        ["registry"],

        severity=8,

        kind="alert"

    )


    add_endpoint_context(

        event,

        user,

        "registry_persistence"

    )


    event["registry"]={

        "path":

        "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run",


        "value":

        "Updater",


        "data":

        "powershell.exe -hidden"

    }



    event["attack"]=campaign(

        "EDR-PERSIST-001",

        "persistence",

        "TA0003"

    )



    event["rule"]={

        "name":

        "Registry Persistence Detected",


        "category":

        "persistence"

    }


    return event





def scheduled_task_persistence():


    user=choose_user()


    event=base_event(

        "scheduled-task-created",

        ["process","configuration"],

        severity=8,

        kind="alert"

    )


    add_endpoint_context(

        event,

        user,

        "scheduled_task"

    )


    event["process"]={

        "name":

        "schtasks.exe",


        "command_line":

        "schtasks /create /tn updater"

    }



    event["attack"]=campaign(

        "EDR-PERSIST-002",

        "persistence",

        "TA0003"

    )


    return event





def ransomware_activity():


    user=choose_user()


    event=base_event(

        "mass-file-encryption",

        ["file"],

        severity=10,

        kind="alert"

    )


    add_endpoint_context(

        event,

        user,

        "ransomware_activity"

    )


    event["file"]={

        "extension_before":

        ".docx",


        "extension_after":

        ".encrypted",


        "files_modified":

        random.randint(

            500,

            5000

        )

    }


    event["attack"]=campaign(

        "EDR-RANSOMWARE-001",

        "impact",

        "TA0040"

    )


    event["rule"]={

        "name":

        "Ransomware-Like File Encryption",

        "category":

        "impact"

    }


    return event





# ============================================================
# NON-ALERT ACCEPTABLE-USE / POLICY TELEMETRY
# ============================================================


def add_policy_context(event,policy_id,category,violation,reason,authorized=False):

    event["policy"]={
        "id":policy_id,
        "domain":"acceptable_use",
        "category":category,
        "violation":bool(violation),
        "authorized":bool(authorized),
        "security_alert":False,
        "disposition":"review" if violation else "allowed",
        "reason":reason
    }

    event["tags"].extend(["acceptable-use","policy-telemetry","non-alert"])

    return event


def unauthorized_game_execution():

    user=choose_user()
    process,executable=random.choice([
        ("GameLauncher.exe", "C:\\Games\\GameLauncher.exe"),
        ("steam.exe", "C:\\Program Files (x86)\\Steam\\steam.exe"),
        ("EpicGamesLauncher.exe", "C:\\Program Files (x86)\\Epic Games\\Launcher\\EpicGamesLauncher.exe")
    ])
    event=base_event("unauthorized-game-launch",["process"],severity=2,kind="event")
    add_endpoint_context(event,user,"unauthorized_game_execution")
    add_process(event,process,"explorer.exe")
    event["process"]["executable"]=executable
    event["event"]["type"]=["start","info"]
    event["message"]=(f"Non-business game application {process} was launched by "
                      f"{user['name']} on {user['host']}")
    add_policy_context(event,"AUP-SOFTWARE-001","unauthorized_software",True,
                       "Gaming software is not approved on corporate endpoints")
    return event


def interactive_powershell_session():

    user=choose_user()
    roles=set(user.get("roles",[]))
    authorized=bool(roles.intersection({
        "devops","database_admin","cloud_admin","it_admin"
    }))
    event=base_event("interactive-powershell-session",["process"],
                     severity=1 if authorized else 2,kind="event")
    add_endpoint_context(event,user,"interactive_powershell_session")
    add_process(event,"powershell.exe","explorer.exe")
    event["process"]["command_line"]="powershell.exe -NoLogo"
    event["event"]["type"]=["start","info"]
    event["message"]=(f"Interactive PowerShell session opened by {user['name']} "
                      f"on {user['host']}")
    reason=("Interactive scripting is allowed for this privileged role" if authorized
            else "Interactive scripting requires an approved administrative role")
    add_policy_context(event,"AUP-SCRIPTING-002","interactive_scripting",
                       not authorized,reason,authorized=authorized)
    return event


def prohibited_website_access():

    user=choose_user()
    domain=random.choice([
        "blocked-adult.example",
        "prohibited-streaming.example",
        "unapproved-gambling.example"
    ])
    event=base_event("prohibited-website-access",["web"],severity=2,
                     kind="event",outcome="success")
    add_endpoint_context(event,user,"prohibited_website_access")
    add_process(event,random.choice(["chrome.exe","msedge.exe"]),"explorer.exe")
    event["url"]={"domain":domain,"scheme":"https","path":"/"}
    event["destination"]={"ip":random.choice(DOC_IPS),"port":443}
    event["network"]={"protocol":"http","transport":"tcp"}
    event["event"]["type"]=["access","info"]
    event["message"]=(f"{user['name']} accessed prohibited web category {domain} "
                      f"from {user['host']}")
    add_policy_context(event,"AUP-WEB-003","prohibited_web_content",True,
                       "The requested domain belongs to a prohibited web category")
    return event


def authorized_admin_maintenance():

    user=choose_user("database_admin")
    change_id=f"CHG-{random.randint(100000,999999)}"
    event=base_event("authorized-admin-powershell",["process"],severity=1,kind="event")
    add_endpoint_context(event,user,"authorized_admin_maintenance")
    add_process(event,"powershell.exe","explorer.exe")
    event["process"]["command_line"]="powershell.exe -NoProfile -File inventory-check.ps1"
    event["change"]={"id":change_id,"approved":True}
    event["event"]["type"]=["start","info"]
    event["message"]=(f"Approved PowerShell maintenance executed by {user['name']} "
                      f"under change {change_id}")
    add_policy_context(event,"AUP-SCRIPTING-002","interactive_scripting",False,
                       f"Authorized maintenance activity under {change_id}",authorized=True)
    return event


# ============================================================
# EVENT LISTS
# ============================================================


NORMAL_EVENTS=[

    normal_process_execution,

    normal_process_execution,

    normal_network_connection,

    dns_lookup,

    service_activity

]



ALERT_EVENTS=[

    powershell_attack,

    office_macro_attack,

    malware_execution,

    c2_connection,

    credential_dumping,

    registry_persistence,

    scheduled_task_persistence,

    ransomware_activity

]


POLICY_EVENTS=[

    unauthorized_game_execution,

    interactive_powershell_session,

    prohibited_website_access,

    authorized_admin_maintenance

]





def choose_event():


    if should_generate_alert(

        "edr"

    ):

        return random.choice(

            ALERT_EVENTS

        )


    if should_generate_policy_event(

        "edr"

    ):

        return random.choice(

            POLICY_EVENTS

        )


    return random.choice(

        NORMAL_EVENTS

    )





# ============================================================
# MAIN LOOP
# ============================================================



def main():


    parser=argparse.ArgumentParser(

        description=

        "Realistic EDR telemetry generator"

    )


    parser.add_argument(

        "--host",

        default="127.0.0.1"

    )


    parser.add_argument(

        "--port",

        type=int,

        default=5601

    )


    parser.add_argument(

        "--rate",

        type=float,

        default=15

    )


    parser.add_argument(

        "--duration",

        type=int,

        default=0

    )


    args=parser.parse_args()



    sock=socket.socket(

        socket.AF_INET,

        socket.SOCK_DGRAM

    )



    start=time.time()

    sent=0



    print(

        f"[EDR] sending to "

        f"{args.host}:{args.port}"

    )




    try:


        while True:


            if args.duration > 0:


                if time.time()-start >= args.duration:

                    break



            builder=choose_event()



            event=builder()



            sock.sendto(

                json.dumps(

                    event,

                    separators=(

                        ",",

                        ":"

                    )

                ).encode(),

                (

                    args.host,

                    args.port

                )

            )



            sent += 1



            time.sleep(

                get_event_delay(

                    args.rate

                )

            )



    except KeyboardInterrupt:


        print(

            "Stopped by user"

        )



    finally:


        sock.close()


        print(

            f"[EDR] sent={sent}"

        )





if __name__=="__main__":


    main()
