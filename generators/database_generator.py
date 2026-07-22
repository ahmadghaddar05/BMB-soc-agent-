#!/usr/bin/env python3
"""
database_generator.py

Realistic Database Audit Telemetry Generator.

Integrated with:

- common_inventory.py
- behavior_engine.py
- simulation_engine.py


Simulates:

- PostgreSQL audit logs
- User database activity
- Application queries
- Privilege changes
- Data access anomalies
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





DB="DB01"

WEBAPP="WEBAPP01"

DATABASE_NAME="inclusive_platform"



NORMAL_TABLES=[

    "users",

    "jobs",

    "applications",

    "reports",

    "invoices"

]



SENSITIVE_TABLES=[

    "employee_records",

    "salary_information",

    "customer_data",

    "audit_logs"

]



DATABASE_USERS=[

    "app_readonly",

    "app_readwrite",

    "postgres"

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
# BASE DATABASE EVENT
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

            "database.audit",


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

            "database"

        },



        "observer":{


            "vendor":

            "PostgreSQL",


            "product":

            "PostgreSQL Audit Simulator",


            "type":

            "database",


            "name":

            server_name(DB),


            "ip":[

                server_ip(DB)

            ]

        },



        "service":{


            "name":

            "postgresql",


            "version":

            "15"

        },



        "host":

        server_host_doc(DB),



        "tags":[

            "database",

            "postgresql",

            "audit",

            "demo"

        ]

    }





# ============================================================
# DATABASE CONTEXT
# ============================================================



def add_database_context(

    event,

    user,

    action

):


    event["user"]=user_doc(user)



    event["source"]={

        "ip":

        server_ip(WEBAPP),


        "port":

        random.randint(

            40000,

            60000

        )

    }



    event["destination"]={

        "ip":

        server_ip(DB),


        "port":

        5432

    }



    event["related"]={


        "ip":[

            server_ip(WEBAPP),

            server_ip(DB),

            user["ip"]

        ],


        "hosts":[

            WEBAPP,

            DB,

            user["host"]

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

        server=DB,

        action=action

    )



    return event





# ============================================================
# NORMAL DATABASE EVENTS
# ============================================================



def database_login():


    user=choose_user()



    event=base_event(

        "database-login-success",

        ["authentication"],

        severity=1

    )



    add_database_context(

        event,

        user,

        "database_login"

    )



    event["database"]={


        "type":

        "postgresql",


        "name":

        DATABASE_NAME,


        "user":

        "app_readwrite",


        "operation":

        "CONNECT"

    }



    event["message"]=(
        f"Database login from "
        f"WEBAPP01 for {user['name']}"
    )


    return event





def normal_select():


    user=choose_user()



    table=random.choice(

        NORMAL_TABLES

    )


    rows=random.randint(

        1,

        100

    )



    event=base_event(

        "database-select",

        ["database","access"],

        severity=1

    )



    add_database_context(

        event,

        user,

        "select"

    )



    event["database"]={


        "name":

        DATABASE_NAME,


        "operation":

        "SELECT",


        "table":

        table,


        "rows_returned":

        rows,


        "duration_ms":

        random.randint(

            5,

            500

        )

    }



    event["message"]=(
        f"SELECT on {table} "
        f"returned {rows} rows"
    )



    return event





def normal_write():


    user=choose_user()



    table=random.choice(

        NORMAL_TABLES

    )


    operation=random.choice(

        [

        "INSERT",

        "UPDATE"

        ]

    )



    event=base_event(

        "database-write",

        ["database","change"],

        severity=2

    )



    add_database_context(

        event,

        user,

        "database_write"

    )



    event["database"]={


        "name":

        DATABASE_NAME,


        "operation":

        operation,


        "table":

        table,


        "rows":

        random.randint(

            1,

            10

        )

    }



    return event

# ============================================================
# SUSPICIOUS DATABASE EVENTS
# ============================================================



def sensitive_table_access():


    user=choose_user()



    table=random.choice(

        SENSITIVE_TABLES

    )


    rows=random.randint(

        5000,

        50000

    )



    event=base_event(

        "sensitive-table-access",

        ["database","access"],

        severity=8,

        kind="alert"

    )



    add_database_context(

        event,

        user,

        "sensitive_data_access"

    )



    event["database"]={


        "name":

        DATABASE_NAME,


        "operation":

        "SELECT",


        "table":

        table,


        "rows_returned":

        rows,


        "sensitivity":

        "high"

    }



    event["attack"]=campaign(

        "DB-DATA-ACCESS-001",

        "collection",

        "TA0009"

    )



    event["rule"]={


        "name":

        "Sensitive Database Table Access",


        "category":

        "data-access"

    }



    event["message"]=(
        f"Sensitive table {table} "
        f"accessed with {rows} rows"
    )



    return event





def large_data_export():


    user=random.choice(

        [

        choose_user(role="finance_user"),

        choose_user(role="hr_user")

        ]

    )



    rows=random.randint(

        50000,

        500000

    )



    event=base_event(

        "database-large-export",

        ["database","exfiltration"],

        severity=10,

        kind="alert"

    )



    add_database_context(

        event,

        user,

        "data_export"

    )



    event["database"]={


        "name":

        DATABASE_NAME,


        "operation":

        "SELECT",


        "table":

        random.choice(

            SENSITIVE_TABLES

        ),


        "rows_returned":

        rows,


        "export_size_mb":

        random.randint(

            500,

            50000

        )

    }



    event["attack"]=campaign(

        "DB-EXFIL-001",

        "exfiltration",

        "TA0010"

    )



    event["rule"]={


        "name":

        "Large Database Export Detected",


        "category":

        "data-exfiltration"

    }



    return event





def sql_injection_activity():


    user=choose_user()



    event=base_event(

        "sql-injection-detected",

        ["database","application"],

        severity=8,

        kind="alert",

        outcome="failure"

    )



    add_database_context(

        event,

        user,

        "sql_injection"

    )



    event["database"]={


        "name":

        DATABASE_NAME,


        "operation":

        "SELECT",


        "query":

        "SELECT * FROM users WHERE id='1 OR 1=1'"

    }



    event["attack"]=campaign(

        "DB-SQLI-001",

        "initial_access",

        "TA0001"

    )



    event["rule"]={


        "name":

        "SQL Injection Attempt",


        "category":

        "web-attack"

    }



    return event





def privilege_grant():


    user=choose_user(role="it_admin")



    target=random.choice(

        [

        "app_readonly",

        "reporting_user",

        "temporary_admin"

        ]

    )



    event=base_event(

        "database-privilege-grant",

        ["database","iam"],

        severity=9,

        kind="alert"

    )



    add_database_context(

        event,

        user,

        "privilege_change"

    )



    event["database"]={


        "operation":

        "GRANT",


        "target_user":

        target,


        "permission":

        "ADMIN"

    }



    event["attack"]=campaign(

        "DB-PRIV-001",

        "privilege_escalation",

        "TA0004"

    )



    event["rule"]={


        "name":

        "Database Privilege Escalation",


        "category":

        "privilege-change"

    }



    return event





def destructive_action():


    user=choose_user(role="database_admin")



    table=random.choice(

        SENSITIVE_TABLES

    )



    event=base_event(

        "database-destructive-action",

        ["database"],

        severity=10,

        kind="alert",

        outcome="failure"

    )



    add_database_context(

        event,

        user,

        "destructive_operation"

    )



    event["database"]={


        "operation":

        "DROP",


        "table":

        table

    }



    event["attack"]=campaign(

        "DB-IMPACT-001",

        "impact",

        "TA0040"

    )



    event["rule"]={


        "name":

        "Destructive Database Action",


        "category":

        "data-destruction"

    }



    return event

# ============================================================
# EVENT DISTRIBUTION
# ============================================================



NORMAL_EVENTS=[

    database_login,

    normal_select,

    normal_select,

    normal_select,

    normal_write

]



ALERT_EVENTS=[

    sensitive_table_access,

    large_data_export,

    sql_injection_activity,

    privilege_grant,

    destructive_action

]





def choose_event():


    if should_generate_alert(

        "database"

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

        "Realistic Database Audit Generator"

    )


    parser.add_argument(

        "--host",

        default="127.0.0.1"

    )


    parser.add_argument(

        "--port",

        type=int,

        default=5608

    )


    parser.add_argument(

        "--rate",

        type=float,

        default=5

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

        f"[DATABASE] sending to "

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

            f"[DATABASE] sent={sent}"

        )





if __name__=="__main__":


    main()
