"""Native integration checks. Opens only disposable workspaces and profiles."""
import json
import os
from pathlib import Path
import queue
import shutil
import subprocess
import sys
import tempfile
import threading
import time
import traceback
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.request import urlopen

from runtime import ROOT, NodeHost, Preferences, control


def wait_for(read, description, timeout=15):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        value = read()
        if value:
            return value
        time.sleep(0.05)
    raise AssertionError(f"Timed out: {description}")


def scenario(home, mode):
    import objc
    import AppKit as A
    import Foundation as F
    from PyObjCTools import AppHelper
    from cocoa import Desktop, run

    errors = []
    prompts = []

    class Hook(BaseHTTPRequestHandler):
        def do_POST(self):
            prompts.append(json.loads(self.rfile.read(int(self.headers["Content-Length"]))))
            self.send_response(202)
            self.end_headers()

        def do_GET(self):
            self.send_response(200)
            self.end_headers()
            self.wfile.write(b"<html>Untrusted origin</html>")

        def log_message(self, *_):
            pass

    hook = ThreadingHTTPServer(("127.0.0.1", 0), Hook)
    threading.Thread(target=hook.serve_forever, daemon=True).start()
    webhook = f"http://127.0.0.1:{hook.server_port}/hook"

    class SmokeDesktop(Desktop):
        @objc.python_method
        def choose_discard(self, error):
            self.save_error = error
            self.showWorkspace_(None)
            return mode == "discard"

    host = NodeHost(os.environ.get("LIFE_MANAGER_NODE", shutil.which("node")), home / "workspace")

    def ready(desktop):
        def ui(operation):
            reply = queue.Queue()
            def execute():
                try:
                    reply.put((True, operation()))
                except BaseException as error:
                    reply.put((False, error))
            AppHelper.callAfter(execute)
            ok, result = reply.get(timeout=15)
            if not ok:
                raise result
            return result

        def js(source):
            result = queue.Queue()
            ui(lambda: desktop.webview.evaluateJavaScript_completionHandler_(source, lambda value, error: result.put((value, error))))
            value, error = result.get(timeout=15)
            if error:
                raise AssertionError(str(error))
            return value

        def checks():
            try:
                wait_for(lambda: js("typeof window.lifeManagerFlush === 'function'"), "shared React UI")
                assert js("typeof window.lifeManagerDesktop.sendT3") == "function"
                if mode == "restart":
                    assert js("window.lifeManagerDesktop.preferences.getItem('life-manager.theme')") == "dark"
                    assert js("document.documentElement.dataset.theme") == "dark"
                    with urlopen(host.origin + "/api/items/build") as response:
                        assert "Pending Cocoa note" in json.load(response)["item"]["notes"]
                    control(home, "stop")
                    return
                if mode == "discard":
                    js("window.lifeManagerFlush = async () => { throw new Error('Synthetic save failure'); }; null")
                    ui(lambda: desktop.quit_(None))
                    return

                original_pid = control(home, "status")["pid"]
                # Exercise the actual close delegate and status-menu action repeatedly.
                for _ in range(3):
                    ui(lambda: desktop.window.performClose_(None))
                    assert not control(home, "status")["visible"]
                    assert host.process.poll() is None
                    assert ui(lambda: desktop.app.activationPolicy()) == A.NSApplicationActivationPolicyAccessory
                    assert ui(lambda: desktop.status_item.button().image().isEqual_(desktop.tray_icon))
                    ui(lambda: desktop.menu.performActionForItemAtIndex_(0))
                    assert ui(lambda: desktop.window.isVisible())
                    def icon_pixels(image):
                        rendered = A.NSImage.alloc().initWithSize_((128, 128))
                        rendered.lockFocus()
                        image.drawInRect_fromRect_operation_fraction_(F.NSMakeRect(0, 0, 128, 128), F.NSMakeRect(0, 0, 0, 0), A.NSCompositingOperationCopy, 1)
                        rendered.unlockFocus()
                        return bytes(rendered.TIFFRepresentation())
                    assert ui(lambda: icon_pixels(desktop.app.dockTile().contentView().image()) == icon_pixels(desktop.icon)), "Dock icon differs from the shared icon"
                    assert ui(lambda: desktop.app.activationPolicy()) == A.NSApplicationActivationPolicyRegular
                ui(lambda: desktop.window.miniaturize_(None))
                assert ui(lambda: desktop.app.activationPolicy()) == A.NSApplicationActivationPolicyRegular
                ui(lambda: desktop.window.performClose_(None))
                launches = [subprocess.Popen([sys.executable, str(ROOT / "desktop/cocoa/lm.py"), "start", "--home", str(home)], stdout=subprocess.PIPE, text=True) for _ in range(3)]
                for launch in launches:
                    output, _ = launch.communicate(timeout=5)
                    assert launch.returncode == 0 and json.loads(output)["pid"] == original_pid
                wait_for(lambda: control(home, "status")["visible"], "single-instance reopen")
                assert ui(lambda: not desktop.window.isMiniaturized())

                js("window.lifeManagerDesktop.preferences.setItem('life-manager.theme', 'dark')")
                wait_for(lambda: Preferences(home).values.get("life-manager.theme") == "dark", "native preference persistence")
                js(f"void window.lifeManagerDesktop.sendT3('Cocoa smoke prompt', {json.dumps(webhook)}).then(value => window.hookResult = value)")
                wait_for(lambda: js("window.hookResult?.accepted"), "native webhook reply")
                assert prompts == [{"prompt": "Cocoa smoke prompt"}]

                # Both same-origin and opaque-origin child frames must be rejected by native checks.
                for sandbox in [False, True]:
                    source = r"""(() => {
                      const frame = document.createElement('iframe');
                      SANDBOX
                      frame.srcdoc = `<script>window.webkit.messageHandlers.lifeManager.postMessage({method:'setPreference',id:'forged',documentId:'forged',key:'life-manager.theme',value:'light'}); parent.postMessage('frame-attempted','*');<\/script>`;
                      document.body.appendChild(frame);
                    })()""".replace("SANDBOX", "frame.sandbox = 'allow-scripts';" if sandbox else "")
                    js("window.frameAttempted = false; window.addEventListener('message', event => { if(event.data === 'frame-attempted') window.frameAttempted = true; }, {once:true})")
                    js(source)
                    wait_for(lambda: js("window.frameAttempted"), "subframe bridge attempt")
                    assert Preferences(home).values["life-manager.theme"] == "dark"
                js("void window.webkit.messageHandlers.lifeManager.postMessage({method:'setPreference',id:'bad',documentId:'bad',key:'arbitrary.file',value:'bad'})")
                assert "arbitrary.file" not in Preferences(home).values
                old_url = js("location.href")
                js(f"location.href = {json.dumps(webhook)}")
                assert js("location.href") == old_url

                # A failed flush cancels Quit and reopens the hidden workspace.
                js("window.realFlush = window.lifeManagerFlush; window.lifeManagerFlush = async () => { throw new Error('Synthetic save failure'); }; null")
                ui(lambda: desktop.window.performClose_(None))
                control(home, "stop")
                wait_for(lambda: getattr(desktop, "save_error", None), "failed-save Keep Open path")
                wait_for(lambda: control(home, "status")["state"] == "running", "Quit cancelled")
                assert control(home, "status")["visible"] and host.process.poll() is None
                js("window.lifeManagerFlush = window.realFlush; null")

                # Edit the real MDXEditor and Quit before its autosave debounce expires.
                ui(lambda: desktop.webview.loadRequest_(F.NSURLRequest.requestWithURL_(F.NSURL.URLWithString_(host.origin + "/items/build"))))
                wait_for(lambda: js("Boolean(document.querySelector('[contenteditable=true]'))"), "real notes editor")
                js("document.querySelector('[contenteditable=true]').focus(); document.execCommand('insertText', false, 'Pending Cocoa note');")
                control(home, "stop")
            except BaseException:
                errors.append(traceback.format_exc())
                AppHelper.callAfter(desktop.stop_loop)

        threading.Thread(target=checks, daemon=True).start()

    try:
        run(host, home, desktop_class=SmokeDesktop, on_ready=ready)
    finally:
        host.close()
        hook.shutdown()
        hook.server_close()
    if errors:
        raise AssertionError(errors[0])
    assert not (home / "workspace/.server.json").exists()
    assert not (home / "workspace/.server.lock").exists()
    if mode == "lifecycle":
        assert "Pending Cocoa note" in __import__("sqlite3").connect(home / "workspace/life-manager.sqlite").execute("select notes from items where id='build'").fetchone()[0]
    print(f"PASS: {mode}", flush=True)


def main():
    if len(sys.argv) == 3:
        scenario(Path(sys.argv[1]), sys.argv[2])
        return
    directory = Path(tempfile.mkdtemp(prefix="life-manager-cocoa-", dir="/tmp"))
    print(f"Temporary workspace, profile and logs: {directory}", flush=True)
    for mode in ["lifecycle", "restart", "discard"]:
        with open(directory / f"{mode}.log", "w") as log:
            result = subprocess.run([sys.executable, __file__, str(directory), mode], stdout=log, stderr=subprocess.STDOUT, timeout=90)
        output = (directory / f"{mode}.log").read_text()
        print(output, end="")
        if result.returncode or f"PASS: {mode}" not in output:
            raise SystemExit(result.returncode or 1)
    print("All Cocoa desktop smoke checks passed.")


if __name__ == "__main__":
    main()
