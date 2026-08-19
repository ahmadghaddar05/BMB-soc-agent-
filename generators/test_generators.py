import os
import sys
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
if HERE not in sys.path:
    sys.path.insert(0, HERE)

from common_inventory import USERS
from evidence_context import enrich_event_evidence
from mitre_catalog import ACTION_MAPPINGS, TACTICS
from scenario_engine import build_scenario
from scenario_runner import SCENARIOS, compose_run, summarize
from simulation_engine import ALERT_RATES
import ad_generator as ad
import database_generator as database
import edr_generator as edr
import email_generator as email
import linux_generator as linux
import webapp_generator as webapp


class GeneratorScenarioTests(unittest.TestCase):
    SOURCES = {
        "ad": ad,
        "database": database,
        "edr": edr,
        "email": email,
        "linux": linux,
        "webapp": webapp,
    }

    @staticmethod
    def assert_sha256(testcase, value):
        testcase.assertIsInstance(value, str)
        testcase.assertEqual(len(value), 64)
        testcase.assertTrue(all(character in "0123456789abcdef" for character in value))

    @staticmethod
    def flattened_keys(value, prefix=""):
        keys = []
        if isinstance(value, dict):
            for key, child in value.items():
                path = f"{prefix}.{key}" if prefix else key
                keys.append(path.lower())
                keys.extend(GeneratorScenarioTests.flattened_keys(child, path))
        elif isinstance(value, list):
            for child in value:
                keys.extend(GeneratorScenarioTests.flattened_keys(child, prefix))
        return keys

    def test_existing_identity_records_are_preserved(self):
        users = {user["name"]: user for user in USERS}
        self.assertEqual(users["maya.georges"]["identity"]["immutable_id"], "AD-EMP-00006")
        self.assertEqual(users["maya.georges"]["identity"]["employee_id"], "EMP-10006")
        self.assertEqual(users["maya.georges"]["host"], "HR-WS001")
        self.assertEqual(users["tony.azar"]["identity"]["immutable_id"], "AD-DBA-00001")
        self.assertEqual(len(users), len(USERS), "inventory usernames must remain unique")

    def test_full_attack_chain_has_stable_correlation_pivots_and_unique_ids(self):
        records = build_scenario(
            "full_attack_chain", "maya.georges", "198.51.100.24",
            campaign_id="BMB-TEST-CAMPAIGN",
        )
        alerts = [event for _, event in records if event["event"]["kind"] == "alert"]
        self.assertGreaterEqual(len(alerts), 6)
        self.assertEqual({event["user"]["name"] for event in alerts}, {"maya.georges"})
        self.assertEqual({event["source"]["ip"] for event in alerts}, {"198.51.100.24"})
        self.assertEqual({event["attack"]["campaign_id"] for _, event in records}, {"BMB-TEST-CAMPAIGN"})
        self.assertEqual(len({event["correlation"]["session_id"] for _, event in records}), 1)
        self.assertEqual(
            [event["correlation"]["sequence"] for _, event in records],
            list(range(1, len(records) + 1)),
        )
        ids = [event["event"]["id"] for _, event in records]
        self.assertEqual(len(ids), len(set(ids)))

    def test_full_attack_chain_has_canonical_ordered_mitre_path(self):
        records = build_scenario(
            "full_attack_chain", "maya.georges", "198.51.100.24",
            campaign_id="BMB-MITRE-PATH-TEST",
        )
        alerts = [event for _, event in records if event["event"]["kind"] == "alert"]
        self.assertEqual(
            [event["attack"]["tactic_id"] for event in alerts],
            [
                "TA0001", "TA0002", "TA0003", "TA0006", "TA0007",
                "TA0008", "TA0009", "TA0011", "TA0010", "TA0040",
            ],
        )
        self.assertEqual(
            [event["correlation"]["path_position"] for event in alerts],
            list(range(1, len(alerts) + 1)),
        )
        self.assertEqual({event["correlation"]["path_length"] for event in alerts}, {len(alerts)})
        self.assertIsNone(alerts[0]["correlation"]["previous_event_id"])
        self.assertIsNone(alerts[-1]["correlation"]["next_event_id"])
        self.assertEqual(
            alerts[0]["correlation"]["next_event_id"], alerts[1]["event"]["id"]
        )

    def test_every_alert_builder_has_canonical_mitre_and_observed_control_metadata(self):
        for source, module in self.SOURCES.items():
            for builder in module.ALERT_EVENTS:
                with self.subTest(source=source, builder=builder.__name__):
                    event = enrich_event_evidence(builder(), source)
                    action = event["event"]["action"]
                    self.assertIn(action, ACTION_MAPPINGS)
                    mapping = ACTION_MAPPINGS[action]
                    self.assertEqual(event["threat"]["framework"], "MITRE ATT&CK")
                    self.assertEqual(event["threat"]["technique"]["id"], [mapping["technique_id"]])
                    self.assertEqual(event["threat"]["tactic"]["id"], [mapping["tactic_id"]])
                    self.assertEqual(event["attack"]["technique_name"], mapping["technique_name"])
                    self.assertEqual(event["attack"]["tactic_name"], mapping["tactic_name"])
                    self.assertEqual(
                        event["attack"]["stage_order"], TACTICS[mapping["tactic_id"]]["order"]
                    )
                    self.assertIn(event["security_control"]["status"], {"blocked", "detected"})
                    self.assertTrue(event["security_control"]["observed"])
                    self.assertIn(
                        event["attack"]["observed_state"], {"contained", "detected-active"}
                    )

    def test_standalone_alerts_do_not_reuse_template_campaign_as_correlation_identity(self):
        first = enrich_event_evidence(edr.credential_dumping(), "edr")
        second = enrich_event_evidence(edr.credential_dumping(), "edr")
        self.assertEqual(first["attack"]["template_id"], "EDR-CRED-001")
        self.assertEqual(second["attack"]["template_id"], "EDR-CRED-001")
        self.assertNotEqual(first["attack"]["campaign_id"], second["attack"]["campaign_id"])

    def test_sparse_incident_scenario_links_only_alert_records(self):
        records = build_scenario("account_compromise", campaign_id="BMB-SPARSE-TEST")
        alerts = [event for _, event in records if event["event"]["kind"] == "alert"]
        non_alerts = [event for _, event in records if event["event"]["kind"] != "alert"]
        self.assertEqual(len(alerts), 3)
        self.assertEqual([event["correlation"]["path_position"] for event in alerts], [1, 2, 3])
        self.assertTrue(all("path_position" not in event["correlation"] for event in non_alerts))

    def test_policy_records_are_investigable_but_never_security_alerts(self):
        records = build_scenario("policy_violations", "maya.georges", "198.51.100.24")
        self.assertEqual(len(records), 3)
        for _, event in records:
            self.assertEqual(event["event"]["kind"], "event")
            self.assertTrue(event["policy"]["violation"])
            self.assertFalse(event["policy"]["security_alert"])
            self.assertIn("non-alert", event["tags"])

    def test_approved_admin_activity_is_not_a_violation(self):
        _, event = build_scenario("benign_admin")[0]
        self.assertEqual(event["user"]["name"], "tony.azar")
        self.assertTrue(event["policy"]["authorized"])
        self.assertFalse(event["policy"]["violation"])
        self.assertFalse(event["policy"]["security_alert"])
        self.assertTrue(event["change"]["approved"])

    def test_every_finite_run_stays_between_thirteen_and_fifteen_percent(self):
        for scenario in SCENARIOS:
            with self.subTest(scenario=scenario):
                summary = summarize(compose_run(
                    scenario, "maya.georges", "198.51.100.24", seed=7,
                ))
                self.assertGreaterEqual(summary["alert_ratio"], 0.13)
                self.assertLessEqual(summary["alert_ratio"], 0.15)

    def test_standalone_source_rates_stay_in_the_same_safety_band(self):
        self.assertEqual(set(ALERT_RATES), {"ad", "database", "edr", "email", "linux", "webapp"})
        for source, rate in ALERT_RATES.items():
            with self.subTest(source=source):
                self.assertGreaterEqual(rate, 0.13)
                self.assertLessEqual(rate, 0.15)

    def test_scenario_events_keep_minimum_ecs_shape(self):
        for source, event in compose_run(
            "mixed_enterprise", "maya.georges", "198.51.100.24", seed=11,
        ):
            with self.subTest(source=source, event=event.get("event", {}).get("id")):
                self.assertIn("@timestamp", event)
                self.assertIn("ecs", event)
                self.assertIn("data_stream", event)
                self.assertIn("id", event["event"])
                self.assertIn(event["event"]["kind"], {"event", "alert"})
                self.assertEqual(event["data_stream"]["type"], "logs")

    def test_every_runtime_builder_receives_evidence_provenance_without_answer_keys(self):
        forbidden = {"expected_verdict", "ground_truth", "true_positive", "false_positive"}
        for source, module in self.SOURCES.items():
            builders = list(module.NORMAL_EVENTS) + list(module.ALERT_EVENTS)
            builders += list(getattr(module, "POLICY_EVENTS", []))
            for builder in builders:
                with self.subTest(source=source, builder=builder.__name__):
                    event = enrich_event_evidence(builder(), source)
                    self.assertEqual(event["evidence"]["profile"], f"bmb-{source}-context-v1")
                    self.assertFalse(event["evidence"]["answer_key_included"])
                    self.assertIn("observed sensor fields", event["evidence"]["assessment_basis"])
                    self.assertGreater(len(event["message"]), 40)
                    keys = {path.rsplit(".", 1)[-1] for path in self.flattened_keys(event)}
                    self.assertFalse(forbidden & keys)

    def test_edr_alerts_have_process_lineage_hashes_and_endpoint_state(self):
        for builder in edr.ALERT_EVENTS:
            with self.subTest(builder=builder.__name__):
                event = enrich_event_evidence(builder(), "edr")
                process = event["process"]
                self.assertTrue(process["command_line"])
                self.assertTrue(process["executable"])
                self.assertTrue(process["parent"]["name"])
                self.assertTrue(process["parent"]["command_line"])
                self.assert_sha256(self, process["hash"]["sha256"])
                self.assert_sha256(self, process["parent"]["hash"]["sha256"])
                self.assert_sha256(self, event["file"]["hash"]["sha256"])
                self.assertEqual(event["endpoint"]["sensor_status"], "healthy")

    def test_executable_hashes_are_stable_across_events_but_process_ids_are_unique(self):
        first = enrich_event_evidence(edr.powershell_attack(), "edr")
        second = enrich_event_evidence(edr.powershell_attack(), "edr")
        self.assertEqual(first["process"]["hash"]["sha256"], second["process"]["hash"]["sha256"])
        self.assertNotEqual(first["process"]["entity_id"], second["process"]["entity_id"])

    def test_linux_alerts_have_audit_process_and_identity_context(self):
        for builder in linux.ALERT_EVENTS:
            with self.subTest(builder=builder.__name__):
                event = enrich_event_evidence(builder(), "linux")
                self.assertTrue(event["process"]["command_line"])
                self.assertTrue(event["process"]["parent"]["executable"])
                self.assert_sha256(self, event["process"]["hash"]["sha256"])
                self.assertIn("session", event["auditd"])
                self.assertIn("effective", event["user"])

    def test_ad_alerts_have_authentication_result_session_and_failure_codes(self):
        for builder in ad.ALERT_EVENTS:
            with self.subTest(builder=builder.__name__):
                event = enrich_event_evidence(builder(), "ad")
                self.assertTrue(event["authentication"]["session_id"])
                self.assertEqual(event["authentication"]["result"], event["event"]["outcome"])
                self.assertTrue(event["winlog"]["event_data"]["IpAddress"])
                self.assertTrue(event["winlog"]["event_data"]["WorkstationName"])
                if event["event"]["outcome"] == "failure":
                    self.assertTrue(event["winlog"]["event_data"]["Status"])
                    self.assertTrue(event["winlog"]["event_data"]["FailureReason"])

    def test_email_alerts_have_delivery_authentication_and_sandbox_context(self):
        for builder in email.ALERT_EVENTS:
            with self.subTest(builder=builder.__name__):
                event = enrich_event_evidence(builder(), "email")
                self.assertTrue(event["email"]["subject"])
                self.assertTrue(event["email"]["message_id"])
                self.assertIn(event["email"]["delivery_action"], {"delivered", "quarantined"})
                for field in ("spf", "dkim", "dmarc", "reputation"):
                    self.assertIn(field, event["email"]["security"])
                self.assertEqual(event["email"]["sandbox"]["status"], "completed")
                if "file" in event:
                    self.assert_sha256(self, event["file"]["hash"]["sha256"])

    def test_database_alerts_have_query_transaction_and_result_context(self):
        for builder in database.ALERT_EVENTS:
            with self.subTest(builder=builder.__name__):
                event = enrich_event_evidence(builder(), "database")
                self.assertTrue(event["database"]["query"])
                self.assertTrue(event["database"]["query_id"])
                self.assertTrue(event["database"]["transaction_id"])
                self.assertIsInstance(event["database"]["duration_ms"], int)
                self.assertIsInstance(event["database"]["rows_affected"], int)
                self.assertTrue(event["database_audit"]["statement_logged"])

    def test_web_alerts_have_request_response_session_and_waf_context(self):
        for builder in webapp.ALERT_EVENTS:
            with self.subTest(builder=builder.__name__):
                event = enrich_event_evidence(builder(), "webapp")
                self.assertTrue(event["url"]["original"])
                self.assertTrue(event["session"]["id"])
                self.assertIsInstance(event["http"]["request"]["bytes"], int)
                self.assertIsInstance(event["http"]["response"]["status_code"], int)
                self.assertTrue(event["web_application_firewall"]["rule_id"])


if __name__ == "__main__":
    unittest.main()
