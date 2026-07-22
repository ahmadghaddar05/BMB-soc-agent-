import os
import sys
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
if HERE not in sys.path:
    sys.path.insert(0, HERE)

from common_inventory import USERS
from scenario_engine import build_scenario
from scenario_runner import SCENARIOS, compose_run, summarize
from simulation_engine import ALERT_RATES


class GeneratorScenarioTests(unittest.TestCase):
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
        ids = [event["event"]["id"] for _, event in records]
        self.assertEqual(len(ids), len(set(ids)))

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


if __name__ == "__main__":
    unittest.main()
