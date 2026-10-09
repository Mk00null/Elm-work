"""Smoke tests for the Vidar backend: run with  python -m unittest discover -s tests"""
import importlib.util
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def load(name, rel):
    spec = importlib.util.spec_from_file_location(name, ROOT / rel)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


class FleetDbTest(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.db = self.tmp / "t.db"

    def cli(self, *args):
        return subprocess.run([sys.executable, str(ROOT / "inventory/fleet_db.py"), "--db", str(self.db), *args],
                              capture_output=True, text=True)

    def test_add_update_list_export(self):
        r = self.cli("--add", "--device-id", "APT-LIVING", "--model", "RockTek G2", "--ip", "100.64.0.11",
                     "--location", "apartment", "--mac", "aa-bb-cc-dd-ee-ff")
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertEqual(self.cli("--update", "APT-LIVING", "--rustdesk-id", "123456789").returncode, 0)
        out = self.cli("--list").stdout
        self.assertIn("AA:BB:CC:DD:EE:FF", out)
        self.assertIn("apartment", out)
        conf = self.tmp / "devices.conf"
        self.cli("--export-devices", str(conf))
        self.assertIn("100.64.0.11 APT-LIVING@apartment", conf.read_text())

    def test_rejects_bad_input(self):
        r = self.cli("--add", "--device-id", "X", "--model", "Onn 4K Pro", "--mac", "nope")
        self.assertNotEqual(r.returncode, 0)


class HealthParsingTest(unittest.TestCase):
    def test_devices_conf_parsing(self):
        fh = load("fleet_health", "scripts/maintenance/fleet_health.py")
        conf = Path(tempfile.mkdtemp()) / "d.conf"
        conf.write_text("# c\n100.64.0.11 APT@apartment\n10.0.0.5:5556 X\n")
        self.assertEqual(fh.load_devices(conf), [("100.64.0.11:5555", "APT@apartment"), ("10.0.0.5:5556", "X")])


class DashboardAndBotTest(unittest.TestCase):
    def setUp(self):
        tmp = Path(tempfile.mkdtemp())
        self.db, self.log = tmp / "fleet.db", tmp / "fleet_health.log"
        subprocess.run([sys.executable, str(ROOT / "inventory/fleet_db.py"), "--db", str(self.db), "--add",
                        "--device-id", "OFFICE", "--model", "Onn 4K Pro", "--ip", "100.64.0.41",
                        "--location", "office"], check=True, capture_output=True)
        self.log.write_text(json.dumps({"ts": "t", "label": "OFFICE@office", "adb": "device",
                                        "uptime_h": 5.0, "tcp_ms": 12.0}) + "\n")

    def test_dashboard_merges_health(self):
        try:
            app = load("dash", "dashboard/app.py")
        except ImportError:
            self.skipTest("fastapi not installed")
        app.DB, app.HEALTH_LOG = self.db, self.log
        fleet = app.merged_fleet()
        self.assertEqual(fleet[0]["device_id"], "OFFICE")
        self.assertTrue(fleet[0]["online"])
        self.assertEqual(fleet[0]["latency"], [12.0])

    def test_bot_tools(self):
        tools = load("fleet_tools", "bot/fleet_tools.py")
        tools.DB, tools.HEALTH_LOG = self.db, self.log
        status = tools.run_tool("fleet_status", {})
        self.assertIn("1/1 TVs online", status["summary"])
        self.assertEqual(tools.run_tool("restart_tv", {"device_id": "nope"}), {"error": "unknown device"})
        self.assertTrue(tools.WRITE_TOOLS.isdisjoint(tools.READ_TOOLS))


class ProvisionDryRunTest(unittest.TestCase):
    def test_dry_run(self):
        r = subprocess.run([sys.executable, str(ROOT / "scripts/provision/provision-tv.py"), "--ip", "100.64.0.9",
                            "--device-id", "T", "--model", "Onn 4K Pro", "--location", "home", "--dry-run"],
                           capture_output=True, text=True)
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertIn("set-home-activity", r.stdout)


class CatalogTest(unittest.TestCase):
    def test_apps_json(self):
        cat = json.loads((ROOT / "scripts/provision/apps.json").read_text())
        pkgs = [a["package"] for g in ("core", "free_tv", "extras") for a in cat[g]]
        self.assertEqual(len(pkgs), len(set(pkgs)), "duplicate package ids")
        for g in ("core", "free_tv", "extras"):
            for a in cat[g]:
                self.assertIn(a["source"], {"apk", "play"})
                if a["source"] == "apk":
                    self.assertTrue(a.get("apk"))

    def test_jellyfin_setup_needs_key(self):
        r = subprocess.run([sys.executable, str(ROOT / "scripts/jellyfin/setup-jellyfin.py"), "--api-key", ""],
                           capture_output=True, text=True)
        self.assertEqual(r.returncode, 1)
        self.assertIn("JELLYFIN_API_KEY", r.stderr)


if __name__ == "__main__":
    unittest.main()
