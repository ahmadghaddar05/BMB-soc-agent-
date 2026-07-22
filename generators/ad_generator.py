#!/usr/bin/env python3
"""
ad_generator.py

Realistic Active Directory Security Telemetry Generator.

Integrated with:

- common_inventory.py
- behavior_engine.py
- simulation_engine.py


Features:

- Windows Security Events
- Authentication telemetry
- Kerberos activity
- IAM changes
- User risk enrichment
- Attack campaign correlation
- Dynamic realistic event frequency
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

    server_ip,

    server_name,

    server_host_doc,

    DOMAIN,

    DOC_IPS

)



from behavior_engine import enrich_event



from simulation_engine import (

    get_event_delay,

    should_generate_alert

)





DC="DC01"



SENSITIVE_GROUPS=[

    "Domain Admins",

    "Enterprise Admins",

    "Schema Admins"

]



SERVICE_ACCOUNTS=[

    "svc-sql",

    "svc-backup",

    "svc-web"

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

            "version":"8.17.0"

        },



        "data_stream":{

            "type":"logs",

            "dataset":"ad.security",

            "namespace":"default"

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

            "active_directory"

        },



        "observer":{


            "vendor":

            "Microsoft",


            "product":

            "Windows Active Directory",


            "type":

            "domain_controller",


            "name":

            server_name(DC),


            "ip":[

                server_ip(DC)

            ]

        },



        "host":

        server_host_doc(DC),



        "tags":[

            "active_directory",

            "windows_security",

            "identity",

            "demo"

        ]

    }





# ============================================================
# USER ENRICHMENT
# ============================================================



def add_user_context(

    event,

    user,

    action

):


    event["user"]=user_doc(user)



    event["source"]={

        "ip":

        user["ip"],


        "port":

        random.randint(

            49152,

            65535

        )

    }



    event["destination"]={

        "ip":

        server_ip(DC),


        "port":

        88

    }



    event["client"]={

        "ip":

        user["ip"]

    }



    event["related"]={

        "ip":[

            user["ip"],

            server_ip(DC)

        ],


        "hosts":[

            user["host"],

            server_name(DC)

        ],


        "user":[

            user["name"]

        ]

    }




    enrich_event(

        event,

        user,

        host=user["host"],

        source_ip=user["ip"],

        server=DC,

        action=action

    )



    return event

# ============================================================
# NORMAL AD EVENTS
# ============================================================



def successful_logon():


    user=choose_user()


    event=base_event(

        "windows-logon-success",

        ["authentication"],

        severity=1

    )


    add_user_context(

        event,

        user,

        "login"

    )


    event["winlog"]={

        "event_id":4624,


        "provider_name":
        "Microsoft-Windows-Security-Auditing",


        "event_data":{

            "LogonType":"3",

            "TargetUserName":
            user["name"],

            "IpAddress":
            user["ip"]

        }

    }


    event["message"]=(
        f"{user['name']} logged "
        f"successfully to {DC}"
    )


    return event





def logoff():


    user=choose_user()


    event=base_event(

        "windows-logoff",

        ["authentication","session"],

        severity=1

    )


    add_user_context(

        event,

        user,

        "logout"

    )


    event["winlog"]={

        "event_id":4634,


        "event_data":{

            "TargetUserName":
            user["name"]

        }

    }


    event["message"]=(
        f"{user['name']} logged off"
    )


    return event





def password_change():


    user=choose_user()


    event=base_event(

        "password-change",

        ["iam"],

        severity=2

    )


    add_user_context(

        event,

        user,

        "password_change"

    )


    event["winlog"]={

        "event_id":4723,


        "event_data":{

            "TargetUserName":
            user["name"]

        }

    }


    return event





def kerberos_authentication():


    user=choose_user()


    event=base_event(

        "kerberos-authentication",

        ["authentication"],

        severity=1

    )


    add_user_context(

        event,

        user,

        "kerberos_authentication"

    )


    event["winlog"]={

        "event_id":4768,


        "event_data":{

            "TargetUserName":
            user["name"],


            "ServiceName":
            "krbtgt",


            "TicketEncryptionType":
            "0x12"

        }

    }


    event["message"]=(
        f"Kerberos authentication "
        f"ticket issued for {user['name']}"
    )


    return event





def kerberos_service_ticket():


    user=choose_user()


    service=random.choice(

        SERVICE_ACCOUNTS

    )


    event=base_event(

        "kerberos-service-ticket",

        ["authentication"],

        severity=1

    )


    add_user_context(

        event,

        user,

        "kerberos_service_ticket"

    )


    event["winlog"]={

        "event_id":4769,


        "event_data":{

            "TargetUserName":
            user["name"],


            "ServiceName":
            service,


            "TicketEncryptionType":
            "0x12"

        }

    }


    return event





# ============================================================
# SUSPICIOUS EVENTS
# ============================================================




def failed_logon():


    user=choose_user()


    event=base_event(

        "windows-logon-failure",

        ["authentication"],

        severity=5,

        kind="alert",

        outcome="failure"

    )


    add_user_context(

        event,

        user,

        "failed_login"

    )


    event["winlog"]={

        "event_id":4625,


        "event_data":{

            "TargetUserName":
            user["name"],


            "FailureReason":
            "Bad password"

        }

    }


    event["rule"]={

        "name":
        "Failed Windows Login",


        "category":
        "authentication-risk"

    }


    return event





def account_lockout():


    user=choose_user()


    event=base_event(

        "account-lockout",

        ["authentication"],

        severity=6,

        kind="alert",

        outcome="failure"

    )


    add_user_context(

        event,

        user,

        "account_lockout"

    )


    event["winlog"]={

        "event_id":4740,


        "event_data":{

            "TargetUserName":
            user["name"]

        }

    }


    event["rule"]={

        "name":
        "Account Lockout",

        "category":
        "authentication-risk"

    }


    return event





def password_spray():


    user=choose_user()


    attacker=random.choice(

        DOC_IPS

    )


    event=base_event(

        "password-spray",

        ["authentication"],

        severity=8,

        kind="alert",

        outcome="failure"

    )


    event["user"]=user_doc(user)


    event["source"]={

        "ip":attacker

    }


    event["winlog"]={

        "event_id":4625,


        "event_data":{

            "AttemptCount":
            random.randint(

                30,

                250

            ),


            "TargetUserName":
            user["name"]

        }

    }


    event["attack"]=campaign(

        "AD-PASSWORD-SPRAY-001",

        "credential_access",

        "TA0006"

    )


    event["rule"]={

        "name":
        "Password Spray Attack",

        "category":
        "credential-access"

    }


    return event





def privilege_escalation():


    actor=choose_user()


    target=choose_user()


    group=random.choice(

        SENSITIVE_GROUPS

    )


    event=base_event(

        "privileged-group-change",

        ["iam"],

        severity=9,

        kind="alert"

    )


    add_user_context(

        event,

        actor,

        "privilege_change"

    )


    event["target"]={

        "user":
        target["name"],


        "group":
        group

    }


    event["winlog"]={

        "event_id":4728,


        "event_data":{

            "SubjectUserName":
            actor["name"],


            "TargetUserName":
            target["name"],


            "TargetGroupName":
            group

        }

    }


    event["attack"]=campaign(

        "AD-PRIV-ESC-001",

        "privilege_escalation",

        "TA0004"

    )


    return event

# ============================================================
# ADVANCED ATTACK EVENTS
# ============================================================



def kerberoasting():


    user=choose_user()


    service=random.choice(

        SERVICE_ACCOUNTS

    )


    event=base_event(

        "kerberoasting-attempt",

        ["authentication"],

        severity=8,

        kind="alert"

    )


    add_user_context(

        event,

        user,

        "kerberoasting"

    )


    event["winlog"]={

        "event_id":4769,


        "event_data":{

            "Requester":

            user["name"],


            "ServiceName":

            service,


            "TicketEncryptionType":

            "0x17"

        }

    }



    event["attack"]=campaign(

        "AD-KERBEROAST-001",

        "credential_access",

        "TA0006"

    )



    event["rule"]={

        "name":

        "Possible Kerberoasting Attack",


        "category":

        "credential-access"

    }



    return event






def dcsync():


    service_users=[

        u for u in [

            choose_user()

        ]

    ]


    user=choose_user()


    attacker=random.choice(

        DOC_IPS

    )


    event=base_event(

        "directory-replication-request",

        ["iam","authentication"],

        severity=10,

        kind="alert"

    )



    event["user"]=user_doc(user)



    event["source"]={

        "ip":attacker

    }



    event["destination"]={

        "ip":server_ip(DC)

    }




    enrich_event(

        event,

        user,

        host=DC,

        source_ip=attacker,

        server=DC,

        action="directory_replication"

    )




    event["winlog"]={

        "event_id":4662,


        "event_data":{

            "AccessMask":

            "0x100",


            "Properties":

            "DS-Replication-Get-Changes-All"

        }

    }




    event["attack"]=campaign(

        "AD-DCSYNC-001",

        "credential_access",

        "TA0006"

    )




    event["rule"]={

        "name":

        "Possible DCSync Attack",


        "category":

        "credential-access"

    }




    event["message"]=(
        "Unauthorized directory "
        "replication request detected"
    )


    return event





# ============================================================
# EVENT DISTRIBUTION
# ============================================================



NORMAL_EVENTS=[

    successful_logon,

    successful_logon,

    successful_logon,

    kerberos_authentication,

    kerberos_service_ticket,

    logoff,

    password_change

]



ALERT_EVENTS=[

    failed_logon,

    account_lockout,

    password_spray,

    privilege_escalation,

    kerberoasting,

    dcsync

]





def choose_event():


    if should_generate_alert(

        "ad"

    ):

        return random.choice(

            ALERT_EVENTS

        )


    return random.choice(

        NORMAL_EVENTS

    )





# ============================================================
# MAIN GENERATOR LOOP
# ============================================================



def main():


    parser=argparse.ArgumentParser(

        description=

        "Realistic Active Directory Generator"

    )


    parser.add_argument(

        "--host",

        default="127.0.0.1"

    )


    parser.add_argument(

        "--port",

        type=int,

        default=5606

    )


    parser.add_argument(

        "--rate",

        type=float,

        default=10

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

        f"[AD] sending to "

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

            f"[AD] sent={sent}"

        )





if __name__=="__main__":


    main()
