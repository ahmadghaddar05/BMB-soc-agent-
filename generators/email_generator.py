#!/usr/bin/env python3
"""
email_generator.py

Realistic Email Security Telemetry Generator.

Integrated with:

- common_inventory.py
- behavior_engine.py
- simulation_engine.py


Simulates:

- Normal email traffic
- Mail security inspection
- Phishing
- Malware attachments
- BEC attacks
- Malicious links
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

    DOC_IPS,

    GOOD_EXTERNAL_IPS

)



from behavior_engine import enrich_event



from simulation_engine import (

    get_event_delay,

    should_generate_alert

)





MAILGW="MAILGW01"




NORMAL_SENDERS=[

    "alerts@microsoft.com",

    "notifications@github.com",

    "hr@partner.example",

    "billing@vendor.example",

    "support@salesforce.com"

]



SUSPICIOUS_SENDERS=[

    "security-alert@micros0ft-login.test",

    "invoice@billing-secure.test",

    "password-reset@verify-account.test",

    "shared-docs@cloud-files.test"

]



NORMAL_SUBJECTS=[

    "Monthly invoice",

    "Project update",

    "Meeting invitation",

    "HR announcement",

    "System notification"

]


SUSPICIOUS_SUBJECTS=[

    "Urgent password reset",

    "Invoice overdue",

    "Your mailbox will be closed",

    "Shared document requires login"

]



NORMAL_ATTACHMENTS=[

    "report.pdf",

    "meeting.docx",

    "invoice.xlsx",

    "agenda.pdf"

]


MALICIOUS_ATTACHMENTS=[

    "invoice.xlsm",

    "payment.exe",

    "document.iso",

    "scan.zip"

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

            "email.security",


            "namespace":

            "default"

        },



        "event":{


            "id":

            str(uuid.uuid4()),


            "kind":

            kind,


            "category":[

                "email"

            ],


            "type":[

                "info"

            ],


            "action":

            action,


            "outcome":

            outcome,


            "severity":

            severity,


            "risk_score":

            severity*10,


            "module":

            "email"

        },



        "observer":{


            "vendor":

            "SecureMailGateway",


            "product":

            "Email Security Simulator",


            "type":

            "mail_gateway",


            "name":

            server_name(MAILGW),


            "ip":[

                server_ip(MAILGW)

            ]

        },



        "tags":[

            "email",

            "mail_security",

            "demo"

        ]

    }





# ============================================================
# EMAIL CONTEXT
# ============================================================



def add_email_context(

    event,

    user,

    sender,

    source_ip,

    action

):


    event["user"]=user_doc(user)



    event["source"]={

        "ip":

        source_ip

    }



    event["destination"]={

        "ip":

        server_ip(MAILGW)

    }



    event["email"]={


        "from":{

            "address":[

                sender

            ]

        },


        "to":{

            "address":[

                user["email"]

            ]

        }

    }



    event["related"]={


        "ip":[

            source_ip,

            server_ip(MAILGW),

            user["ip"]

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

        action=action

    )


    return event





# ============================================================
# NORMAL EMAIL EVENTS
# ============================================================



def normal_email():


    user=choose_user()


    sender=random.choice(

        NORMAL_SENDERS

    )


    source=random.choice(

        GOOD_EXTERNAL_IPS

    )


    event=base_event(

        "email-delivered"

    )


    add_email_context(

        event,

        user,

        sender,

        source,

        "email_received"

    )


    event["email"].update({


        "subject":

        random.choice(

            NORMAL_SUBJECTS

        ),


        "security":{

            "spf":

            "pass",

            "dkim":

            "pass",

            "dmarc":

            "pass",

            "reputation":

            "trusted"

        }

    })


    event["message"]=(
        f"Email delivered to "
        f"{user['name']}"
    )


    return event





def normal_attachment_scan():


    user=choose_user()


    attachment=random.choice(

        NORMAL_ATTACHMENTS

    )


    sender=random.choice(

        NORMAL_SENDERS

    )


    source=random.choice(

        GOOD_EXTERNAL_IPS

    )


    event=base_event(

        "attachment-scanned"

    )


    add_email_context(

        event,

        user,

        sender,

        source,

        "attachment_scan"

    )


    event["file"]={


        "name":

        attachment,


        "extension":

        attachment.split(".")[-1]

    }



    event["email"]["attachment"]={

        "count":1

    }


    event["message"]=(
        f"Attachment {attachment} "
        f"scanned successfully"
    )


    return event

# ============================================================
# PHISHING ATTACK
# ============================================================



def phishing_email():


    user=choose_user()


    sender=random.choice(

        SUSPICIOUS_SENDERS

    )


    attacker=random.choice(

        DOC_IPS

    )


    event=base_event(

        "phishing-email-detected",

        severity=8,

        kind="alert",

        outcome="failure"

    )



    add_email_context(

        event,

        user,

        sender,

        attacker,

        "phishing_detection"

    )



    event["email"].update({


        "subject":

        random.choice(

            SUSPICIOUS_SUBJECTS

        ),


        "security":{

            "spf":

            "fail",


            "dkim":

            "fail",


            "dmarc":

            "reject",


            "reputation":

            "malicious"

        }

    })



    event["attack"]=campaign(

        "EMAIL-PHISH-001",

        "initial_access",

        "TA0001"

    )



    event["rule"]={


        "name":

        "Phishing Email Detected",


        "category":

        "phishing"

    }



    event["message"]=(
        f"Phishing email blocked "
        f"for {user['name']}"
    )



    return event





# ============================================================
# MALWARE ATTACHMENT
# ============================================================



def malware_attachment():


    user=choose_user()


    sender=random.choice(

        SUSPICIOUS_SENDERS

    )


    attacker=random.choice(

        DOC_IPS

    )


    attachment=random.choice(

        MALICIOUS_ATTACHMENTS

    )


    event=base_event(

        "malicious-attachment",

        severity=9,

        kind="alert",

        outcome="failure"

    )



    add_email_context(

        event,

        user,

        sender,

        attacker,

        "malware_attachment"

    )



    event["file"]={


        "name":

        attachment,


        "extension":

        attachment.split(".")[-1],


        "malware_detected":

        True

    }



    event["email"]["security"]={


        "spf":

        "fail",


        "dkim":

        "fail",


        "dmarc":

        "fail",


        "reputation":

        "malicious"


    }



    event["attack"]=campaign(

        "EMAIL-MALWARE-001",

        "initial_access",

        "TA0001"

    )



    event["rule"]={


        "name":

        "Malicious Email Attachment Blocked",


        "category":

        "malware"

    }



    return event





# ============================================================
# BUSINESS EMAIL COMPROMISE
# ============================================================



def bec_attack():


    user=random.choice(

        [

            choose_user(role="finance_user"),

            choose_user(role="hr_user")

        ]

    )


    sender=(

        "ceo@"
        "examplecorp-executive.test"

    )


    attacker=random.choice(

        DOC_IPS

    )


    event=base_event(

        "business-email-compromise",

        severity=8,

        kind="alert"

    )



    add_email_context(

        event,

        user,

        sender,

        attacker,

        "bec_detection"

    )



    event["email"].update({


        "subject":

        "Urgent wire transfer request",


        "security":{

            "spf":

            "fail",


            "dkim":

            "fail",


            "dmarc":

            "fail",


            "reputation":

            "suspicious"

        }

    })



    event["attack"]=campaign(

        "EMAIL-BEC-001",

        "initial_access",

        "TA0001"

    )



    event["rule"]={


        "name":

        "Executive Impersonation Detected",


        "category":

        "business-email-compromise"

    }



    event["message"]=(
        f"Possible CEO impersonation "
        f"targeting {user['name']}"
    )



    return event





# ============================================================
# MALICIOUS LINK
# ============================================================



def malicious_link():


    user=choose_user()


    sender=random.choice(

        SUSPICIOUS_SENDERS

    )


    attacker=random.choice(

        DOC_IPS

    )


    event=base_event(

        "malicious-url-detected",

        severity=7,

        kind="alert"

    )



    add_email_context(

        event,

        user,

        sender,

        attacker,

        "malicious_url"

    )



    event["url"]={


        "full":

        "https://secure-login-validation.test/auth",


        "domain":

        "secure-login-validation.test"

    }



    event["email"]["security"]={


        "reputation":

        "malicious"

    }



    event["attack"]=campaign(

        "EMAIL-LINK-001",

        "initial_access",

        "TA0001"

    )



    event["rule"]={


        "name":

        "Malicious URL Rewritten",


        "category":

        "phishing-link"

    }



    return event

# ============================================================
# EVENT DISTRIBUTION
# ============================================================


NORMAL_EVENTS=[

    normal_email,

    normal_email,

    normal_email,

    normal_attachment_scan

]



ALERT_EVENTS=[

    phishing_email,

    malware_attachment,

    bec_attack,

    malicious_link

]





def choose_event():


    if should_generate_alert(

        "email"

    ):

        return random.choice(

            ALERT_EVENTS

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

        "Realistic Email Security Generator"

    )


    parser.add_argument(

        "--host",

        default="127.0.0.1"

    )


    parser.add_argument(

        "--port",

        type=int,

        default=5604

    )


    parser.add_argument(

        "--rate",

        type=float,

        default=8

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

        f"[EMAIL] sending to "

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

            f"[EMAIL] sent={sent}"

        )





if __name__=="__main__":


    main()
