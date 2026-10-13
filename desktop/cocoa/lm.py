"""Run with uv run --project desktop/cocoa python desktop/cocoa/lm.py."""
import argparse
import fcntl
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import time

from runtime import ROOT, NodeHost, control


def main():
    parser = argparse.ArgumentParser(description="Life Manager Cocoa/WebKit desktop (macOS, local workspace).")
    parser.add_argument("command", nargs="?", default="start", choices=["start", "stop", "status", "_run"])
    parser.add_argument("--home", default=os.environ.get("LIFE_MANAGER_COCOA_HOME", str(Path.home() / "Library/Application Support/Life Manager/cocoa")))
    parser.add_argument("--data-dir", default=os.environ.get("LIFE_MANAGER_DATA_DIR"))
    parser.add_argument("--node", default=os.environ.get("LIFE_MANAGER_NODE", "node"))
    parser.add_argument("--port", type=int, default=0)
    args = parser.parse_args()
    home = Path(args.home).expanduser().resolve()
    if sys.platform != "darwin":
        parser.error("The Cocoa launcher requires macOS.")
    if not 0 <= args.port <= 65535:
        parser.error("Port must be between 0 and 65535.")
    if args.command != "_run":
        try:
            reply = control(home, "status")
        except (FileNotFoundError, ConnectionRefusedError):
            reply = None
        if reply:
            if args.data_dir and Path(args.data_dir).expanduser().resolve() != Path(reply["dataDir"]):
                raise RuntimeError("This launcher profile already has another workspace open. Stop it first or choose another --home.")
            if args.command != "status":
                reply = control(home, "open" if args.command == "start" else "stop")
            print(json.dumps(reply))
            return 0
        if args.command in {"status", "stop"}:
            print("Life Manager Cocoa is stopped.")
            return 1 if args.command == "status" else 0
    home.mkdir(parents=True, exist_ok=True, mode=0o700)
    if len(os.fsencode(home / "control.sock")) >= 104:
        raise RuntimeError("Choose a shorter --home path for the macOS control socket.")
    node = shutil.which(args.node)
    if not node:
        raise RuntimeError("Node was not found. Set LIFE_MANAGER_NODE to the runtime used for npm ci.")
    if not (ROOT / "dist/index.html").is_file():
        raise RuntimeError("Build the shared web UI first: npm run build")
    if args.command == "start":
        command = [sys.executable, str(Path(__file__).resolve()), "_run", "--home", str(home), "--node", node, "--port", str(args.port)]
        if args.data_dir:
            command.extend(["--data-dir", str(Path(args.data_dir).expanduser().resolve())])
        with open(home / "desktop.log", "a", opener=lambda path, flags: os.open(path, flags, 0o600)) as log:
            child = subprocess.Popen(command, stdin=subprocess.DEVNULL, stdout=log, stderr=log, start_new_session=True)
        deadline = time.monotonic() + 25
        while time.monotonic() < deadline:
            try:
                print(json.dumps(control(home, "open")))
                return 0
            except (FileNotFoundError, ConnectionRefusedError):
                if child.poll() is not None and child.returncode != 0:
                    raise RuntimeError(f"Desktop startup failed. See {home / 'desktop.log'}")
                time.sleep(0.1)
        raise RuntimeError(f"Desktop startup timed out. See {home / 'desktop.log'}")
    with open(home / "instance.lock", "a") as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            return 0
        from cocoa import run
        host = NodeHost(node, args.data_dir, args.port)
        try:
            run(host, home)
        finally:
            host.close()
            (home / "control.sock").unlink(missing_ok=True)
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
