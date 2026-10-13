import json
import os
from pathlib import Path
import queue
import shutil
import signal
import subprocess
import sys
import tempfile
import time
import unittest
from urllib.request import Request, urlopen

from runtime import ROOT, NodeHost, Preferences, ControlServer, control, trusted_frame


class RuntimeTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory(prefix="lm-cocoa-", dir="/tmp")
        self.home = Path(self.directory.name)
        self.node = os.environ.get("LIFE_MANAGER_NODE", shutil.which("node"))
        self.hosts = []

    def tearDown(self):
        for host in self.hosts:
            host.close()
        self.directory.cleanup()

    def host(self):
        host = NodeHost(self.node, self.home / "workspace")
        self.hosts.append(host)
        return host

    def test_preferences_survive_restart_and_reject_unknown_keys(self):
        preferences = Preferences(self.home)
        preferences.set("life-manager.theme", "dark")
        self.assertEqual(Preferences(self.home).values, {"life-manager.theme": "dark"})
        self.assertEqual((self.home / "preferences.json").stat().st_mode & 0o777, 0o600)
        for key, value in [("PATH", "bad"), ("life-manager.theme", {}), ("life-manager.theme", "x" * 100001)]:
            with self.assertRaises(ValueError):
                preferences.set(key, value)

    def test_bridge_requires_exact_main_frame_origin(self):
        origin = "http://127.0.0.1:4317"
        self.assertTrue(trusted_frame(True, "http", "127.0.0.1", 4317, origin))
        for args in [(False, "http", "127.0.0.1", 4317), (True, "https", "127.0.0.1", 4317), (True, "http", "localhost", 4317), (True, "http", "127.0.0.1", 4318), (True, "file", "", 0)]:
            self.assertFalse(trusted_frame(*args, origin))

    def test_control_socket_only_routes_known_commands(self):
        commands = []
        server = ControlServer(self.home, lambda command: commands.append(command) or {"state": "running"})
        try:
            for command in ["open", "status", "stop"]:
                self.assertEqual(control(self.home, command), {"state": "running"})
            with self.assertRaises(ValueError):
                control(self.home, "eval")
            self.assertEqual(commands, ["open", "status", "stop"])
        finally:
            server.close()

    def test_owned_server_restarts_and_refuses_another_owner(self):
        host = self.host()
        with urlopen(host.origin + "/api/server") as response:
            self.assertEqual(json.load(response)["application"], "life-manager")
        with self.assertRaisesRegex(RuntimeError, "already served"):
            NodeHost(self.node, self.home / "workspace")
        request = Request(host.origin + "/api/mutate", data=json.dumps({"command": {"type": "create", "id": "cocoa-test", "title": "Cocoa test", "parentId": "build"}}).encode(), headers={"Content-Type": "application/json", "X-Life-Manager": "1"})
        urlopen(request).close()
        host.close()
        self.assertFalse((self.home / "workspace/.server.json").exists())
        restarted = self.host()
        with urlopen(restarted.origin + "/api/items/cocoa-test") as response:
            self.assertEqual(json.load(response)["item"]["title"], "Cocoa test")

    def test_native_prompt_uses_shared_validation(self):
        host = self.host()
        replies = queue.Queue()
        host.send_t3("test", "file:///tmp/no", replies.put)
        self.assertFalse(replies.get(timeout=3)["accepted"])

    def test_parent_crash_closes_pipe_and_releases_workspace(self):
        owner = subprocess.Popen([sys.executable, str(Path(__file__)), "owner", self.node, str(self.home)], stdout=subprocess.PIPE, text=True)
        try:
            record = json.loads(owner.stdout.readline())
            owner.kill()
            owner.wait(timeout=5)
            deadline = time.monotonic() + 10
            while (self.home / "workspace/.server.json").exists() and time.monotonic() < deadline:
                time.sleep(0.05)
            self.assertFalse((self.home / "workspace/.server.json").exists())
            with self.assertRaises(OSError):
                urlopen(record["origin"] + "/api/server", timeout=1)
            self.host()
        finally:
            if owner.poll() is None:
                owner.kill()
                owner.wait()
            owner.stdout.close()

    def test_eof_during_startup_still_cleans_up(self):
        data_dir = self.home / "early-eof"
        process = subprocess.Popen([self.node, "--import", "tsx", str(ROOT / "desktop/cocoa/server.ts"), json.dumps({"dataDir": str(data_dir)})], cwd=ROOT, stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True)
        process.stdin.close()
        self.assertEqual(process.wait(timeout=10), 0)
        process.stdout.close()
        self.assertFalse((data_dir / ".server.json").exists())
        self.assertFalse((data_dir / ".server.lock").exists())


if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "owner":
        host = NodeHost(sys.argv[2], Path(sys.argv[3]) / "workspace")
        print(json.dumps({"origin": host.origin}), flush=True)
        signal.pause()
    else:
        unittest.main()
