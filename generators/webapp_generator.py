#!/usr/bin/env python3
"""
webapp_generator.py

Realistic Web Application Security Telemetry Generator.

Integrated with:

- common_inventory.py
- behavior_engine.py
- simulation_engine.py


Simulates:

- HTTP requests
- Authentication
- Sessions
- Web attacks
- API abuse
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

    DOC_IPS

)



from behavior_engine import enrich_event



from simulation_engine import (

    get_event_delay,

    should_generate_alert

)





WEBAPP="WEBAPP01"


APP_NAME="Inclusive Platform"



NORMAL_PATHS=[

    ("/login","POST"),

    ("/dashboard","GET"),

    ("/jobs","GET"),

    ("/profile","GET"),

    ("/applications","GET"),

    ("/reports","GET"),

    ("/api/profile","GET")

]



SUSPICIOUS_PATHS=[

    "/admin/users",

    "/api/export",

    "/api/debug",

    "/upload",

    "/search"

]



USER_AGENTS=[

    "Mozilla/5.0 Chrome",

    "Mozilla/5.0 Edge",

    "Mozilla/5.0 Firefox"

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





def session_id():

    return uuid.uuid4().hex





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

            "web.application",


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

            "webapp"

        },



        "observer":{


            "vendor":

            "ExampleCorp",


            "product":

            APP_NAME,


            "type":

            "web_application",


            "name":

            server_name(WEBAPP),


            "ip":[

                server_ip(WEBAPP)

            ]

        },



        "service":{

            "name":

            "inclusive-webapp",


            "version":

            "2.1.0"

        },



        "host":

        server_host_doc(WEBAPP),



        "tags":[

            "web",

            "application",

            "http",

            "demo"

        ]

    }





# ============================================================
# WEB CONTEXT
# ============================================================



def add_web_context(

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

            40000,

            60000

        )

    }



    event["destination"]={


        "ip":

        server_ip(WEBAPP),


        "port":

        443

    }



    event["session"]={


        "id":

        session_id()

    }



    event["user_agent"]={


        "original":

        random.choice(

            USER_AGENTS

        )

    }



    event["related"]={


        "ip":[

            user["ip"],

            server_ip(WEBAPP)

        ],


        "hosts":[

            user["host"],

            WEBAPP

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

        server=WEBAPP,

        action=action

    )



    return event





# ============================================================
# HTTP HELPER
# ============================================================



def add_http(

    event,

    method,

    path,

    status=200

):


    event["http"]={


        "request":{

            "method":

            method

        },


        "response":{

            "status_code":

            status

        }

    }



    event["url"]={


        "domain":

        "inclusive.examplecorp.local",


        "path":

        path

    }



    return event





# ============================================================
# NORMAL EVENTS
# ============================================================



def normal_request():


    user=choose_user()


    path,method=random.choice(

        NORMAL_PATHS

    )



    event=base_event(

        "http-request",

        ["web"],

        severity=1

    )



    add_web_context(

        event,

        user,

        "http_request"

    )



    add_http(

        event,

        method,

        path

    )



    event["message"]=(
        f"{method} {path} "
        f"requested by {user['name']}"
    )


    return event





def login_success():


    user=choose_user()


    event=base_event(

        "user-login-success",

        ["authentication","web"],

        severity=1

    )



    add_web_context(

        event,

        user,

        "login"

    )



    add_http(

        event,

        "POST",

        "/login",

        200

    )



    return event

# ============================================================
# WEB ATTACK EVENTS
# ============================================================



def sql_injection_attack():


    user=choose_user()


    attacker=random.choice(

        DOC_IPS

    )



    event=base_event(

        "sql-injection-attempt",

        ["web","attack"],

        severity=9,

        kind="alert",

        outcome="failure"

    )



    add_web_context(

        event,

        user,

        "sql_injection"

    )



    event["source"]["ip"]=attacker



    add_http(

        event,

        "GET",

        "/search",

        403

    )



    event["url"]["query"]=(
        "id=1 OR 1=1 --"
    )



    event["attack"]=campaign(

        "WEB-SQLI-001",

        "initial_access",

        "TA0001"

    )



    event["rule"]={


        "name":

        "SQL Injection Attempt Detected",


        "category":

        "web-attack"

    }



    return event





def xss_attack():


    user=choose_user()


    attacker=random.choice(

        DOC_IPS

    )



    event=base_event(

        "cross-site-scripting",

        ["web"],

        severity=8,

        kind="alert",

        outcome="failure"

    )



    add_web_context(

        event,

        user,

        "xss_attempt"

    )



    event["source"]["ip"]=attacker



    add_http(

        event,

        "POST",

        "/profile/update",

        403

    )



    event["http"]["request"]["payload"]=(
        "<script>alert(1)</script>"
    )



    event["attack"]=campaign(

        "WEB-XSS-001",

        "initial_access",

        "TA0001"

    )



    event["rule"]={


        "name":

        "Cross Site Scripting Attempt",


        "category":

        "web-attack"

    }



    return event





def login_bruteforce():


    user=choose_user()


    attacker=random.choice(

        DOC_IPS

    )



    event=base_event(

        "login-bruteforce",

        ["authentication","web"],

        severity=8,

        kind="alert",

        outcome="failure"

    )



    add_web_context(

        event,

        user,

        "bruteforce"

    )



    event["source"]["ip"]=attacker



    add_http(

        event,

        "POST",

        "/login",

        401

    )



    event["authentication"]={


        "attempts":

        random.randint(

            50,

            300

        ),


        "success":

        False

    }



    event["attack"]=campaign(

        "WEB-AUTH-001",

        "credential_access",

        "TA0006"

    )



    event["rule"]={


        "name":

        "Web Login Brute Force",


        "category":

        "authentication-risk"

    }



    return event





def admin_panel_access():


    user=choose_user()


    event=base_event(

        "admin-panel-access",

        ["web","iam"],

        severity=7,

        kind="alert"

    )



    add_web_context(

        event,

        user,

        "admin_access"

    )



    add_http(

        event,

        "GET",

        "/admin/users",

        200

    )



    event["attack"]=campaign(

        "WEB-ADMIN-001",

        "privilege_escalation",

        "TA0004"

    )



    event["rule"]={


        "name":

        "Administrative Panel Access",


        "category":

        "privileged-access"

    }



    return event





def large_data_export():


    user=random.choice(

        [

        choose_user(role="finance_user"),

        choose_user(role="hr_user")

        ]

    )



    bytes_sent=random.randint(

        10000000,

        80000000

    )



    event=base_event(

        "large-data-export",

        ["web","database"],

        severity=10,

        kind="alert"

    )



    add_web_context(

        event,

        user,

        "data_export"

    )



    add_http(

        event,

        "GET",

        "/api/export",

        200

    )



    event["http"]["response"]["bytes"]=bytes_sent



    event["attack"]=campaign(

        "WEB-EXFIL-001",

        "exfiltration",

        "TA0010"

    )



    event["rule"]={


        "name":

        "Large Web Data Export",


        "category":

        "data-exfiltration"

    }



    return event





def suspicious_file_upload():


    user=choose_user()


    event=base_event(

        "malicious-file-upload",

        ["web","file"],

        severity=8,

        kind="alert"

    )



    add_web_context(

        event,

        user,

        "file_upload"

    )



    add_http(

        event,

        "POST",

        "/upload",

        403

    )



    event["file"]={


        "name":

        "shell.php",


        "type":

        "webshell"

    }



    event["attack"]=campaign(

        "WEB-SHELL-001",

        "persistence",

        "TA0003"

    )



    event["rule"]={


        "name":

        "Suspicious Web File Upload",


        "category":

        "web-attack"

    }



    return event

# ============================================================
# EVENT DISTRIBUTION
# ============================================================



NORMAL_EVENTS=[

    normal_request,

    normal_request,

    normal_request,

    login_success

]



ALERT_EVENTS=[

    sql_injection_attack,

    xss_attack,

    login_bruteforce,

    admin_panel_access,

    large_data_export,

    suspicious_file_upload

]





def choose_event():


    if should_generate_alert(

        "webapp"

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

        "Realistic Web Application Generator"

    )


    parser.add_argument(

        "--host",

        default="127.0.0.1"

    )


    parser.add_argument(

        "--port",

        type=int,

        default=5607

    )


    parser.add_argument(

        "--rate",

        type=float,

        default=20

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

        f"[WEBAPP] sending to "

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

            f"[WEBAPP] sent={sent}"

        )





if __name__=="__main__":


    main()
