"""Process ownership and profile storage; no Cocoa dependencies."""
import json
import os
from pathlib import Path
import queue
import socket
import subprocess
import threading
import uuid

ROOT = Path(__file__).resolve().parents[2]
PREFERENCE_KEYS = frozenset({
    "life-manager.theme", "life-manager.prompt-handling", "life-manager.t3-webhook-url",
    "life-manager.property-filters", "life-manager.sunburst-display.v1",
})


class Preferences:
    def __init__(self, home):
        self.path = Path(home) / "preferences.json"
        try:
            values = json.loads(self.path.read_text())
            self.values = {k: v for k, v in values.items() if k in PREFERENCE_KEYS and isinstance(v, str)}
        except FileNotFoundError:
            self.values = {}

    def set(self, key, value):
        if key not in PREFERENCE_KEYS or not isinstance(value, str) or len(value) > 100_000:
            raise ValueError("Unsupported client preference.")
        updated = {**self.values, key: value}
        temporary = self.path.with_suffix(".tmp")
        with open(temporary, "w", opener=lambda path, flags: os.open(path, flags, 0o600)) as file:
            json.dump(updated, file)
        temporary.replace(self.path)
        self.values = updated


def trusted_frame(main_frame, protocol, host, port, origin):
    # WKSecurityOrigin supplies these fields; never trust a URL supplied by JavaScript.
    return bool(main_frame and f"{protocol}://{host}:{port}" == origin)


class NodeHost:
    def __init__(self, node, data_dir=None, port=0, public_dir=None):
        options = {"port": port}
        if data_dir:
            options["dataDir"] = str(Path(data_dir).expanduser().resolve())
        if public_dir:
            options["publicDir"] = str(public_dir)
        self.process = subprocess.Popen(
            [node, "--import", "tsx", str(ROOT / "desktop/cocoa/server.ts"), json.dumps(options)],
            cwd=ROOT, stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True, bufsize=1,
        )
        self.ready = queue.Queue()
        self.callbacks = {}
        self.lock = threading.Lock()
        self.closed = False
        threading.Thread(target=self._read, daemon=True).start()
        try:
            result = self.ready.get(timeout=20)
            if result.get("type") != "ready":
                raise RuntimeError(result.get("message", "Node server stopped during startup."))
            self.origin, self.data_dir = result["origin"], result["dataDir"]
        except BaseException:
            self.close()
            raise

    def _read(self):
        for line in self.process.stdout:
            try:
                message = json.loads(line)
            except ValueError:
                continue
            if "type" in message:
                self.ready.put(message)
            else:
                with self.lock:
                    callback = self.callbacks.pop(message.get("id"), None)
                if callback:
                    callback(message.get("result"))
        self.ready.put({"type": "error", "message": "Node server exited. Check desktop.log; after changing Node, run npm rebuild better-sqlite3 with that runtime."})
        with self.lock:
            callbacks, self.callbacks = self.callbacks, {}
        for callback in callbacks.values():
            callback({"accepted": False, "error": "The local server stopped. Check T3 before resubmitting."})

    def send_t3(self, prompt, webhook_url, callback):
        request_id = uuid.uuid4().hex
        with self.lock:
            self.callbacks[request_id] = callback
            try:
                self.process.stdin.write(json.dumps({"id": request_id, "method": "sendT3", "prompt": prompt, "webhookUrl": webhook_url}) + "\n")
                self.process.stdin.flush()
            except (BrokenPipeError, ValueError):
                self.callbacks.pop(request_id, None)
                raise RuntimeError("The local server is unavailable.") from None

    def close(self):
        if self.closed:
            return
        self.closed = True
        try:
            self.process.stdin.close()
        except BrokenPipeError:
            pass
        try:
            self.process.wait(timeout=8)
        except subprocess.TimeoutExpired:
            self.process.terminate()
            try:
                self.process.wait(timeout=3)
            except subprocess.TimeoutExpired:
                self.process.kill()
                self.process.wait()
        self.process.stdout.close()


def control(home, command):
    with socket.socket(socket.AF_UNIX) as client:
        client.settimeout(3)
        client.connect(str(Path(home) / "control.sock"))
        if command == "stop":
            # Saving may require a user's decision; only a final shutdown result is success.
            client.settimeout(None)
        client.sendall((json.dumps({"command": command}) + "\n").encode())
        with client.makefile("r") as reader:
            result = json.loads(reader.readline(65536))
        if "error" in result:
            raise RuntimeError(result["error"])
        return result


class ControlServer:
    def __init__(self, home, handler):
        self.path = Path(home) / "control.sock"
        self.path.unlink(missing_ok=True)
        self.socket = socket.socket(socket.AF_UNIX)
        self.socket.bind(str(self.path))
        os.chmod(self.path, 0o600)
        self.socket.listen(8)
        self.handler = handler
        threading.Thread(target=self._serve, daemon=True).start()

    def _serve(self):
        while True:
            try:
                client, _ = self.socket.accept()
            except OSError:
                return
            # Keep status/reopen responsive while stop waits for saving or a dialog.
            # Non-daemon workers finish sending their reply before Python exits.
            threading.Thread(target=self._handle, args=(client,), daemon=False).start()

    def _handle(self, client):
        with client:
            client.settimeout(3)
            try:
                with client.makefile("r") as reader:
                    message = json.loads(reader.readline(4096))
                command = message.get("command")
                if command not in {"status", "open", "stop"}:
                    raise ValueError("Unknown launcher command.")
                result = self.handler(command)
                client.sendall((json.dumps(result) + "\n").encode())
            except (ValueError, OSError):
                pass

    def close(self):
        self.socket.close()
        self.path.unlink(missing_ok=True)
