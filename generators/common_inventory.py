#!/usr/bin/env python3
"""
common_inventory.py

Central Enterprise Identity + Asset Inventory

Used by:
- AD Generator
- EDR Generator
- Email Generator
- Linux Generator
- Database Generator
- Web Application Generator

Purpose:
- Identity correlation
- User behavior analytics
- Hardware correlation
- AI SOC reasoning
- Risk scoring
"""

import random
import uuid



# ============================================================
# ORGANIZATION
# ============================================================


DOMAIN = "EXAMPLECORP"

EMAIL_DOMAIN = "examplecorp.local"



ORGANIZATION = {

    "name":
    "ExampleCorp",

    "industry":
    "Technology Services",

    "country":
    "Lebanon",

    "location":
    "Beirut HQ",

    "timezone":
    "Asia/Beirut"

}



# ============================================================
# NETWORK ZONES
# ============================================================


NETWORK_ZONES = {


"CORPORATE_LAN":{

    "cidr":
    "192.168.10.0/24",

    "trust":
    "medium"

},


"FINANCE_VLAN":{

    "cidr":
    "192.168.20.0/24",

    "trust":
    "high"

},


"HR_VLAN":{

    "cidr":
    "192.168.30.0/24",

    "trust":
    "high"

},


"SERVER_ZONE":{

    "cidr":
    "192.168.50.0/24",

    "trust":
    "critical"

},


"DMZ":{

    "cidr":
    "192.168.100.0/24",

    "trust":
    "low"

}

}



# ============================================================
# HARDWARE TEMPLATES
# ============================================================


def laptop(
    asset_id,
    hostname,
    owner
):

    return {


        "asset_id":
        asset_id,


        "hostname":
        hostname,


        "type":
        "Laptop",


        "manufacturer":
        "Dell",


        "model":
        "Latitude 7440",


        "serial_number":
        f"DL-{asset_id}",


        "owner":
        owner,


        "os":{

            "name":
            "Windows 11 Enterprise",

            "version":
            "23H2"

        },


        "security":{

            "encrypted":
            True,


            "edr_installed":
            True,


            "antivirus":
            "Microsoft Defender",


            "trust_level":
            "trusted"

        }

    }





def mobile(
    model
):

    return {


        "type":
        "Mobile",


        "manufacturer":
        "Apple",


        "model":
        model,


        "mdm_enrolled":
        True,


        "encrypted":
        True

    }





# ============================================================
# USERS
# ============================================================


USERS = [



# ============================================================
# EXECUTIVE
# ============================================================


{

"name":
"michael.jones",


"email":
"michael.jones@examplecorp.local",


"department":
"Management",


"host":
"EXEC-WS001",


"ip":
"192.168.10.80",


"roles":[

    "executive",

    "director"

],



"identity":{

    "immutable_id":
    "AD-MGR-00001",

    "employee_id":
    "EMP-MGR-001",

    "account_type":
    "human"

},



"organization":{

    "department":
    "Management",

    "business_unit":
    "Executive",

    "job_title":
    "Operations Director",

    "manager":
    None,

    "manager_title":
    None,

    "location":
    "Beirut HQ"

},



"access":{

    "privilege_level":
    "executive",

    "ad_groups":[

        "Executives"

    ],

    "cloud_roles":[

        "Microsoft365-Executive"

    ]

},



"authentication":{

    "mfa_enabled":
    True,

    "mfa_method":
    "FIDO2-Hardware-Key",

    "authentication_strength":
    "critical"

},



"hardware":{

    "primary_device":
    laptop(
        "EXEC001",
        "EXEC-WS001",
        "michael.jones"
    ),

    "mobile_devices":[

        mobile(
            "iPhone 15 Pro"
        )

    ]

},



"behavior":{

    "normal_hours":{

        "start":
        "08:00",

        "end":
        "19:00"

    },

    "usual_locations":[

        "Beirut HQ"

    ],

    "usual_servers":[

        "WEBAPP01"

    ],

    "average_daily_logins":
    15

},



"risk":{

    "score":
    25,

    "level":
    "low",

    "hr_status":
    "active"

}

},

# ============================================================
# FINANCE MANAGEMENT
# ============================================================


{

"name":
"nadim.haddad",

"email":
"nadim.haddad@examplecorp.local",

"department":
"Finance",

"host":
"FIN-MGR-WS001",

"ip":
"192.168.10.90",

"roles":[

    "finance_manager"

],


"identity":{

    "immutable_id":
    "AD-MGR-00002",

    "employee_id":
    "EMP-MGR-002",

    "account_type":
    "human"

},


"organization":{

    "department":
    "Finance",

    "business_unit":
    "Corporate Finance",

    "job_title":
    "Finance Manager",

    "manager":
    "michael.jones",

    "manager_title":
    "Operations Director",

    "location":
    "Beirut HQ"

},


"access":{

    "privilege_level":
    "manager",

    "ad_groups":[

        "Finance-Managers"

    ]

},


"authentication":{

    "mfa_enabled":
    True,

    "mfa_method":
    "FIDO2"

},


"hardware":{

    "primary_device":
    laptop(
        "FIN-MGR001",
        "FIN-MGR-WS001",
        "nadim.haddad"
    )

},


"risk":{

    "score":
    20,

    "level":
    "low",

    "hr_status":
    "active"

}

},



{

"name":
"sara.khalil",

"email":
"sara.khalil@examplecorp.local",

"department":
"Finance",

"host":
"CORP-WS002",

"ip":
"192.168.10.22",

"roles":[

    "finance_user"

],


"identity":{

    "immutable_id":
    "AD-EMP-00002",

    "employee_id":
    "EMP-10002",

    "account_type":
    "human"

},


"organization":{

    "department":
    "Finance",

    "business_unit":
    "Corporate Finance",

    "job_title":
    "Financial Analyst",

    "manager":
    "nadim.haddad",

    "manager_title":
    "Finance Manager",

    "location":
    "Beirut HQ"

},


"access":{

    "privilege_level":
    "standard",

    "ad_groups":[

        "Finance-Users"

    ]

},


"authentication":{

    "mfa_enabled":
    True,

    "mfa_method":
    "FIDO2"

},


"hardware":{

    "primary_device":
    laptop(
        "FIN001",
        "CORP-WS002",
        "sara.khalil"
    )

},


"behavior":{

    "normal_hours":{

        "start":
        "08:00",

        "end":
        "17:30"

    },

    "usual_servers":[

        "DB01"

    ],

    "average_daily_logins":
    20,

    "average_data_access_mb":
    250

},


"risk":{

    "score":
    25,

    "level":
    "low",

    "hr_status":
    "active"

}

},



{

"name":
"nour.mansour",

"email":
"nour.mansour@examplecorp.local",

"department":
"Finance",

"host":
"FIN-WS001",

"ip":
"192.168.10.24",

"roles":[

    "finance_user"

],


"identity":{

    "immutable_id":
    "AD-EMP-00005",

    "employee_id":
    "EMP-10005",

    "account_type":
    "human"

},


"organization":{

    "department":
    "Finance",

    "job_title":
    "Senior Accountant",

    "manager":
    "nadim.haddad",

    "manager_title":
    "Finance Manager"

},


"access":{

    "privilege_level":
    "standard"

},


"hardware":{

    "primary_device":
    laptop(
        "FIN002",
        "FIN-WS001",
        "nour.mansour"
    )

},


"risk":{

    "score":
    18,

    "level":
    "low"

}

},



# ============================================================
# IT MANAGEMENT
# ============================================================


{

"name":
"karim.rahme",

"email":
"karim.rahme@examplecorp.local",

"department":
"IT",

"host":
"IT-MGR-WS001",

"ip":
"192.168.10.91",

"roles":[

    "it_manager"

],


"identity":{

    "immutable_id":
    "AD-MGR-00003",

    "employee_id":
    "EMP-MGR-003",

    "account_type":
    "human"

},


"organization":{

    "department":
    "IT",

    "business_unit":
    "Infrastructure",

    "job_title":
    "IT Manager",

    "manager":
    "michael.jones",

    "manager_title":
    "Operations Director"

},


"access":{

    "privilege_level":
    "administrator",

    "ad_groups":[

        "IT-Managers",

        "Administrators"

    ]

},


"authentication":{

    "mfa_enabled":
    True,

    "mfa_method":
    "FIDO2-Hardware-Key"

},


"hardware":{

    "primary_device":
    laptop(
        "IT001",
        "IT-MGR-WS001",
        "karim.rahme"
    )

},


"risk":{

    "score":
    30,

    "level":
    "medium"

}

},



{

"name":
"david.wilson",

"email":
"david.wilson@examplecorp.local",

"department":
"IT",

"host":
"IT-ADMIN01",

"ip":
"192.168.10.26",

"roles":[

    "it_admin"

],


"identity":{

    "immutable_id":
    "AD-ADM-00001",

    "employee_id":
    "EMP-10008",

    "account_type":
    "privileged_user"

},


"organization":{

    "department":
    "IT",

    "job_title":
    "System Administrator",

    "manager":
    "karim.rahme",

    "manager_title":
    "IT Manager"

},


"access":{

    "privilege_level":
    "administrator",

    "ad_groups":[

        "Domain Admins",

        "Server Administrators"

    ]

},


"hardware":{

    "primary_device":
    laptop(
        "ADM001",
        "IT-ADMIN01",
        "david.wilson"
    )

},


"risk":{

    "score":
    35,

    "level":
    "medium"

}

},

# ============================================================
# HR MANAGEMENT
# ============================================================


{

"name":
"lina.salem",

"email":
"lina.salem@examplecorp.local",

"department":
"HR",

"host":
"HR-MGR-WS001",

"ip":
"192.168.10.92",

"roles":[

    "hr_manager"

],

"identity":{

    "immutable_id":
    "AD-MGR-00004",

    "employee_id":
    "EMP-MGR-004",

    "account_type":
    "human"

},

"organization":{

    "department":
    "HR",

    "job_title":
    "HR Manager",

    "manager":
    "michael.jones",

    "manager_title":
    "Operations Director"

},

"access":{

    "privilege_level":
    "manager"

},

"hardware":{

    "primary_device":
    laptop(
        "HR001",
        "HR-MGR-WS001",
        "lina.salem"
    )

},

"risk":{

    "score":20,

    "level":"low"

}

},



{

"name":
"maya.georges",

"email":
"maya.georges@examplecorp.local",

"department":
"HR",

"host":
"HR-WS001",

"ip":
"192.168.10.25",

"roles":[

    "hr_user"

],

"identity":{

    "immutable_id":
    "AD-EMP-00006",

    "employee_id":
    "EMP-10006",

    "account_type":
    "human"

},

"organization":{

    "department":
    "HR",

    "job_title":
    "HR Specialist",

    "manager":
    "lina.salem",

    "manager_title":
    "HR Manager"

},

"hardware":{

    "primary_device":
    laptop(
        "HR002",
        "HR-WS001",
        "maya.georges"
    )

},

"risk":{

    "score":12,

    "level":"low"

}

},



# ============================================================
# SECURITY USERS
# ============================================================


{

"name":
"elias.nassar",

"email":
"elias.nassar@examplecorp.local",

"department":
"Security",

"host":
"SEC-WS001",

"ip":
"192.168.10.60",

"roles":[

    "soc_analyst"

],

"identity":{

    "immutable_id":
    "AD-SEC-00001",

    "employee_id":
    "EMP-10010",

    "account_type":
    "human"

},

"organization":{

    "department":
    "Cyber Security",

    "job_title":
    "SOC Analyst",

    "manager":
    "karim.rahme",

    "manager_title":
    "IT Manager"

},

"hardware":{

    "primary_device":
    laptop(
        "SEC001",
        "SEC-WS001",
        "elias.nassar"
    )

},

"risk":{

    "score":15,

    "level":"low"

}

},



{

"name":
"jad.mattar",

"email":
"jad.mattar@examplecorp.local",

"department":
"Security",

"host":
"SEC-WS002",

"ip":
"192.168.10.61",

"roles":[

    "incident_responder"

],

"identity":{

    "immutable_id":
    "AD-SEC-00002",

    "employee_id":
    "EMP-10011",

    "account_type":
    "human"

},

"organization":{

    "department":
    "Cyber Security",

    "job_title":
    "Incident Response Engineer",

    "manager":
    "karim.rahme",

    "manager_title":
    "IT Manager"

},

"hardware":{

    "primary_device":
    laptop(
        "SEC002",
        "SEC-WS002",
        "jad.mattar"
    )

},

"risk":{

    "score":20,

    "level":"low"

}

},



# ============================================================
# DEVELOPMENT
# ============================================================


{

"name":
"rami.khoury",

"email":
"rami.khoury@examplecorp.local",

"department":
"Development",

"host":
"DEV-MGR-WS001",

"ip":
"192.168.10.93",

"roles":[

    "development_manager"

],

"identity":{

    "immutable_id":
    "AD-MGR-00005",

    "employee_id":
    "EMP-MGR-005",

    "account_type":
    "human"

},

"organization":{

    "department":
    "Development",

    "job_title":
    "Development Manager",

    "manager":
    "michael.jones",

    "manager_title":
    "Operations Director"

},

"hardware":{

    "primary_device":
    laptop(
        "DEV001",
        "DEV-MGR-WS001",
        "rami.khoury"
    )

},

"risk":{

    "score":25,

    "level":"low"

}

},



{

"name":
"karim.haddad",

"email":
"karim.haddad@examplecorp.local",

"department":
"Development",

"host":
"DEV-WS001",

"ip":
"192.168.10.70",

"roles":[

    "developer"

],

"identity":{

    "immutable_id":
    "AD-DEV-00001",

    "employee_id":
    "EMP-10012",

    "account_type":
    "human"

},

"organization":{

    "department":
    "Development",

    "job_title":
    "Software Engineer",

    "manager":
    "rami.khoury",

    "manager_title":
    "Development Manager"

},

"hardware":{

    "primary_device":
    laptop(
        "DEV002",
        "DEV-WS001",
        "karim.haddad"
    )

},

"risk":{

    "score":22,

    "level":"low"

}

},



{

"name":
"rami.saleh",

"email":
"rami.saleh@examplecorp.local",

"department":
"Development",

"host":
"DEV-WS002",

"ip":
"192.168.10.71",

"roles":[

    "devops"

],

"identity":{

    "immutable_id":
    "AD-DEV-00002",

    "employee_id":
    "EMP-10013",

    "account_type":
    "human"

},

"organization":{

    "department":
    "Development",

    "job_title":
    "DevOps Engineer",

    "manager":
    "rami.khoury",

    "manager_title":
    "Development Manager"

},

"hardware":{

    "primary_device":
    laptop(
        "DEV003",
        "DEV-WS002",
        "rami.saleh"
    )

},

"risk":{

    "score":40,

    "level":"medium"

}

},

# ============================================================
# DATABASE ADMIN
# ============================================================


{

"name":
"tony.azar",

"email":
"tony.azar@examplecorp.local",

"department":
"Database",

"host":
"DBA-WS001",

"ip":
"192.168.10.72",

"roles":[

    "database_admin"

],

"identity":{

    "immutable_id":
    "AD-DBA-00001",

    "employee_id":
    "EMP-10014",

    "account_type":
    "privileged_user"

},

"organization":{

    "department":
    "Database",

    "job_title":
    "Database Administrator",

    "manager":
    "karim.rahme",

    "manager_title":
    "IT Manager"

},

"hardware":{

    "primary_device":
    laptop(
        "DB001",
        "DBA-WS001",
        "tony.azar"
    )

},

"risk":{

    "score":45,

    "level":"medium"

}

},



# ============================================================
# CLOUD ADMIN
# ============================================================


{

"name":
"samer.younes",

"email":
"samer.younes@examplecorp.local",

"department":
"Cloud",

"host":
"CLOUD-WS001",

"ip":
"192.168.10.73",

"roles":[

    "cloud_admin"

],

"identity":{

    "immutable_id":
    "AD-CLOUD-00001",

    "employee_id":
    "EMP-10015",

    "account_type":
    "privileged_user"

},

"organization":{

    "department":
    "Cloud",

    "job_title":
    "Cloud Administrator",

    "manager":
    "karim.rahme",

    "manager_title":
    "IT Manager"

},

"hardware":{

    "primary_device":
    laptop(
        "CLOUD001",
        "CLOUD-WS001",
        "samer.younes"
    )

},

"risk":{

    "score":55,

    "level":"high"

}

},



# ============================================================
# SALES
# ============================================================


{

"name":
"john.smith",

"email":
"john.smith@examplecorp.local",

"department":
"Sales",

"host":
"CORP-WS003",

"ip":
"192.168.10.23",

"roles":[

    "sales_user"

],

"identity":{

    "immutable_id":
    "AD-EMP-00003",

    "employee_id":
    "EMP-10003",

    "account_type":
    "human"

},

"organization":{

    "department":
    "Sales",

    "job_title":
    "Sales Executive",

    "manager":
    "michael.jones",

    "manager_title":
    "Operations Director"

},

"hardware":{

    "primary_device":
    laptop(
        "SAL001",
        "CORP-WS003",
        "john.smith"
    )

},

"risk":{

    "score":15,

    "level":"low"

}

},



# ============================================================
# SERVICE ACCOUNTS
# ============================================================


{

"name":
"svc-backup",

"email":
"svc-backup@examplecorp.local",

"department":
"IT",

"host":
"DC01",

"ip":
"192.168.10.10",

"roles":[

    "service_account"

],

"identity":{

    "immutable_id":
    "AD-SVC-00001",

    "account_type":
    "service"

},

"organization":{

    "department":
    "IT",

    "job_title":
    "Backup Service Account",

    "manager":
    "karim.rahme"

},

"access":{

    "privilege_level":
    "high"

},

"behavior":{

    "non_interactive":
    True

},

"risk":{

    "score":60,

    "level":"high"

}

},



{

"name":
"svc-sql",

"email":
"svc-sql@examplecorp.local",

"department":
"Database",

"host":
"DB01",

"ip":
"192.168.10.50",

"roles":[

    "service_account"

],

"identity":{

    "immutable_id":
    "AD-SVC-00002",

    "account_type":
    "service"

},

"organization":{

    "department":
    "Database",

    "job_title":
    "SQL Service Account",

    "manager":
    "tony.azar"

},

"access":{

    "privilege_level":
    "high"

},

"behavior":{

    "non_interactive":
    True

},

"risk":{

    "score":50,

    "level":"medium"

}

}


]

# ============================================================
# SERVERS
# ============================================================


SERVERS={


"DC01":{

"name":"DC01",

"ip":"192.168.10.10",

"role":"domain_controller",

"criticality":"critical",

"os":{

"type":"windows",

"name":"Windows Server 2022"

}

},


"MAILGW01":{

"name":"MAILGW01",

"ip":"192.168.10.6",

"role":"mail_gateway",

"criticality":"high",

"os":{

"type":"linux",

"name":"Ubuntu Server"

}

},


"LINUX-WEB01":{

"name":"LINUX-WEB01",

"ip":"192.168.10.31",

"role":"web_server",

"criticality":"high",

"os":{

"type":"linux",

"name":"Ubuntu 22.04"

}

},


"LINUX-APP01":{

"name":"LINUX-APP01",

"ip":"192.168.10.32",

"role":"application_server",

"criticality":"high",

"os":{

"type":"linux",

"name":"Ubuntu 22.04"

}

},


"LINUX-JUMP01":{

"name":"LINUX-JUMP01",

"ip":"192.168.10.33",

"role":"linux_jump_server",

"criticality":"high",

"os":{

"type":"linux",

"name":"Ubuntu 22.04"

}

},


"WEBAPP01":{

"name":"WEBAPP01",

"ip":"192.168.10.40",

"role":"web_application",

"criticality":"high",

"os":{

"type":"linux",

"name":"Ubuntu 22.04"

}

},


"DB01":{

"name":"DB01",

"ip":"192.168.10.50",

"role":"database",

"criticality":"critical",

"os":{

"type":"linux",

"name":"Ubuntu 22.04"

}

},


"ELASTIC01":{

"name":"ELASTIC01",

"ip":"10.1.244.52",

"role":"siem",

"criticality":"critical",

"os":{

"type":"linux",

"name":"Ubuntu Server"

}

},


"AI-DASH01":{

"name":"AI-DASH01",

"ip":"10.1.244.110",

"role":"ai_dashboard",

"criticality":"high",

"os":{

"type":"linux",

"name":"Ubuntu Server"

}

}


}
DOC_IPS=[

"198.51.100.24",

"192.0.2.77",

"203.0.113.55"

]


GOOD_EXTERNAL_IPS=[

"13.107.42.14",

"20.190.160.20",

"140.82.112.4"

]

def choose_user(role=None):

    if role:

        users=[

            u for u in USERS

            if role in u.get(
                "roles",
                []
            )

        ]

        if users:

            return random.choice(users)


    return random.choice(USERS)





def user_doc(user):


    org=user.get(
        "organization",
        {}
    )


    return {

        "name":
        user.get("name"),

        "email":
        user.get("email"),

        "id":
        user.get(
            "identity",
            {}
        ).get(
            "immutable_id"
        ),

        "employee_id":
        user.get(
            "identity",
            {}
        ).get(
            "employee_id"
        ),

        "department":
        org.get(
            "department"
        ),

        "job_title":
        org.get(
            "job_title"
        ),

        "manager":
        org.get(
            "manager"
        ),

        "manager_title":
        org.get(
            "manager_title"
        ),

        "location":
        org.get(
            "location"
        ),

        "roles":
        user.get(
            "roles",
            []
        ),

        "privilege":
        user.get(
            "access",
            {}
        ).get(
            "privilege_level",
            "standard"
        ),

        "hardware":
        user.get(
            "hardware",
            {}
        ),

        "authentication":
        user.get(
            "authentication",
            {}
        ),

        "risk_score":
        user.get(
            "risk",
            {}
        ).get(
            "score",
            0
        )

    }





def server_ip(name):

    return SERVERS[name]["ip"]





def server_name(name):

    return SERVERS[name]["name"]





def server_host_doc(name):

    server=SERVERS[name]

    return {

        "name":
        server["name"],

        "hostname":
        server["name"],

        "id":
        str(
            uuid.uuid5(
                uuid.NAMESPACE_DNS,
                server["name"]
            )
        ),

        "ip":[

            server["ip"]

        ],

        "os":
        server["os"]

    }





def workstation_host_doc(user):

    return {

        "name":
        user["host"],

        "hostname":
        user["host"],

        "ip":[

            user["ip"]

        ],

        "hardware":
        user.get(
            "hardware",
            {}
        )

    }





def related_for_user_host(user):

    return {

        "ip":[

            user.get("ip")

        ],

        "hosts":[

            user.get("host")

        ],

        "user":[

            user.get("name")

        ]

    }
