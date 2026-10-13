"""AppKit lifecycle and an origin-checked WKWebView bridge."""
import json
import os
import signal
import uuid
from urllib.parse import urlsplit

import objc
import AppKit as A
import Foundation as F
import WebKit as W
from PyObjCTools import AppHelper

from runtime import ROOT, ControlServer, Preferences, trusted_frame


class Desktop(F.NSObject):
    @objc.python_method
    def setup(self, host, home):
        self.host, self.home = host, home
        self.preferences = Preferences(home)
        self.quit_token = None
        self.allow_quit = False
        self.loaded = False
        self.visible = True
        self.app = A.NSApplication.sharedApplication()
        self.app.setDelegate_(self)
        self.app.setActivationPolicy_(A.NSApplicationActivationPolicyRegular)
        self.icon = A.NSImage.alloc().initWithContentsOfFile_(str(ROOT / "desktop/life-manager.icns"))
        self.tray_icon = A.NSImage.alloc().initWithContentsOfFile_(str(ROOT / "desktop/tray-template.png"))
        if not self.icon or not self.tray_icon:
            raise RuntimeError("Life Manager desktop icons could not be loaded.")
        self.tray_icon.setSize_((18, 18))
        self.tray_icon.setTemplate_(True)
        self.app.setApplicationIconImage_(self.icon)
        self.dock_icon_view = A.NSImageView.alloc().initWithFrame_(F.NSMakeRect(0, 0, 128, 128))
        self.dock_icon_view.setImage_(self.icon)
        self.dock_icon_view.setImageScaling_(A.NSImageScaleProportionallyUpOrDown)
        self.status_item = A.NSStatusBar.systemStatusBar().statusItemWithLength_(A.NSVariableStatusItemLength)
        self.status_item.button().setImage_(self.tray_icon)
        self.status_item.button().setToolTip_("Life Manager")
        self.menu = A.NSMenu.alloc().initWithTitle_("Life Manager")
        self.add_menu_item(self.menu, "Open Life Manager", "showWorkspace:")
        self.add_menu_item(self.menu, "Open in Browser", "openBrowser:")
        self.add_menu_item(self.menu, "Open Log", "openLog:")
        self.menu.addItem_(A.NSMenuItem.separatorItem())
        self.add_menu_item(self.menu, "Quit Life Manager", "quit:", "q")
        self.status_item.setMenu_(self.menu)
        main_menu = A.NSMenu.alloc().initWithTitle_("Main")
        app_item = A.NSMenuItem.alloc().initWithTitle_action_keyEquivalent_("Life Manager", None, "")
        app_menu = A.NSMenu.alloc().initWithTitle_("Life Manager")
        self.add_menu_item(app_menu, "Quit Life Manager", "quit:", "q")
        app_item.setSubmenu_(app_menu)
        main_menu.addItem_(app_item)
        edit_item = A.NSMenuItem.alloc().initWithTitle_action_keyEquivalent_("Edit", None, "")
        edit_menu = A.NSMenu.alloc().initWithTitle_("Edit")
        for title, selector, key in [("Undo", "undo:", "z"), ("Redo", "redo:", "Z"), ("Cut", "cut:", "x"), ("Copy", "copy:", "c"), ("Paste", "paste:", "v"), ("Select All", "selectAll:", "a")]:
            edit_menu.addItem_(A.NSMenuItem.alloc().initWithTitle_action_keyEquivalent_(title, selector, key))
        edit_item.setSubmenu_(edit_menu)
        main_menu.addItem_(edit_item)
        window_item = A.NSMenuItem.alloc().initWithTitle_action_keyEquivalent_("Window", None, "")
        window_menu = A.NSMenu.alloc().initWithTitle_("Window")
        for title, selector, key in [("Close", "performClose:", "w"), ("Minimize", "performMiniaturize:", "m")]:
            window_menu.addItem_(A.NSMenuItem.alloc().initWithTitle_action_keyEquivalent_(title, selector, key))
        window_item.setSubmenu_(window_menu)
        main_menu.addItem_(window_item)
        self.app.setMainMenu_(main_menu)
        configuration = W.WKWebViewConfiguration.alloc().init()
        configuration.setWebsiteDataStore_(W.WKWebsiteDataStore.nonPersistentDataStore())
        self.content = configuration.userContentController()
        self.content.addScriptMessageHandler_name_(self, "lifeManager")
        self.install_script()
        self.webview = W.WKWebView.alloc().initWithFrame_configuration_(F.NSMakeRect(0, 0, 1280, 860), configuration)
        self.webview.setCustomUserAgent_("Mozilla/5.0 (Macintosh) AppleWebKit/605.1.15 LifeManagerDesktop")
        self.webview.setNavigationDelegate_(self)
        self.webview.setUIDelegate_(self)
        self.webview.setAllowsBackForwardNavigationGestures_(True)
        style = A.NSWindowStyleMaskTitled | A.NSWindowStyleMaskClosable | A.NSWindowStyleMaskMiniaturizable | A.NSWindowStyleMaskResizable
        self.window = A.NSWindow.alloc().initWithContentRect_styleMask_backing_defer_(F.NSMakeRect(0, 0, 1280, 860), style, A.NSBackingStoreBuffered, False)
        self.window.setTitle_("Life Manager")
        self.window.setMinSize_((700, 500))
        self.window.setReleasedWhenClosed_(False)
        self.window.setDelegate_(self)
        self.window.setContentView_(self.webview)
        self.window.center()
        self.webview.loadRequest_(F.NSURLRequest.requestWithURL_(F.NSURL.URLWithString_(host.origin)))
        self.control_server = ControlServer(home, self.control)

    @objc.python_method
    def add_menu_item(self, menu, title, action, key=""):
        item = A.NSMenuItem.alloc().initWithTitle_action_keyEquivalent_(title, action, key)
        item.setTarget_(self)
        menu.addItem_(item)

    @objc.python_method
    def install_script(self):
        source = (ROOT / "desktop/cocoa/bridge.js").read_text().replace("__ORIGIN__", json.dumps(self.host.origin)).replace("__PREFERENCES__", json.dumps(self.preferences.values))
        self.content.removeAllUserScripts()
        self.content.addUserScript_(W.WKUserScript.alloc().initWithSource_injectionTime_forMainFrameOnly_(source, W.WKUserScriptInjectionTimeAtDocumentStart, True))

    @objc.python_method
    def control(self, command):
        if command == "open":
            AppHelper.callAfter(self.showWorkspace_, None)
        elif command == "stop":
            AppHelper.callAfter(self.quit_, None)
        return {"pid": os.getpid(), "serverPid": self.host.process.pid, "origin": self.host.origin,
                "dataDir": self.host.data_dir, "visible": self.visible,
                "state": "quit-requested" if command == "stop" else "quitting" if self.quit_token else "server-stopped" if self.host.process.poll() is not None else "running"}

    def applicationDidFinishLaunching_(self, notification):
        self.showWorkspace_(None)

    def showWorkspace_(self, sender):
        self.app.setActivationPolicy_(A.NSApplicationActivationPolicyRegular)
        # macOS may reset the Dock tile during an activation-policy transition.
        self.app.setApplicationIconImage_(self.icon)
        self.app.dockTile().setContentView_(self.dock_icon_view)
        self.app.dockTile().display()
        if self.window.isMiniaturized():
            self.window.deminiaturize_(None)
        self.window.makeKeyAndOrderFront_(None)
        self.app.activateIgnoringOtherApps_(True)
        self.visible = True

    def windowShouldClose_(self, window):
        window.orderOut_(None)
        self.visible = False
        self.app.setActivationPolicy_(A.NSApplicationActivationPolicyAccessory)
        return False

    def applicationShouldHandleReopen_hasVisibleWindows_(self, app, visible):
        self.showWorkspace_(None)
        return True

    def applicationShouldTerminateAfterLastWindowClosed_(self, app):
        return False

    def applicationShouldTerminate_(self, app):
        if self.allow_quit:
            return A.NSTerminateNow
        self.quit_(None)
        return A.NSTerminateCancel

    def openBrowser_(self, sender):
        A.NSWorkspace.sharedWorkspace().openURL_(F.NSURL.URLWithString_(self.host.origin))

    def openLog_(self, sender):
        A.NSWorkspace.sharedWorkspace().openURL_(F.NSURL.fileURLWithPath_(str(self.home / "desktop.log")))

    def quit_(self, sender):
        if self.quit_token:
            return
        token = self.quit_token = uuid.uuid4().hex
        self.webview.evaluateJavaScript_completionHandler_(f"window.lifeManagerCocoaQuit?.({json.dumps(token)})", None)
        AppHelper.callLater(10, self.finish_quit, token, "Saving pending edits timed out.")

    @objc.python_method
    def choose_discard(self, error):
        self.showWorkspace_(None)
        alert = A.NSAlert.alloc().init()
        alert.setMessageText_("Some edits could not be saved.")
        alert.setInformativeText_(str(error))
        alert.addButtonWithTitle_("Keep Open")
        alert.addButtonWithTitle_("Quit Without Saving")
        return alert.runModal() == A.NSAlertSecondButtonReturn

    @objc.python_method
    def finish_quit(self, token, error):
        if token != self.quit_token:
            return
        if error and not self.choose_discard(error):
            self.quit_token = None
            return
        self.host.close()
        self.control_server.close()
        self.allow_quit = True
        self.stop_loop()

    @objc.python_method
    def stop_loop(self):
        self.app.stop_(None)
        # Wake NSApplication.run so Python finally blocks release the profile lock.
        event = A.NSEvent.otherEventWithType_location_modifierFlags_timestamp_windowNumber_context_subtype_data1_data2_(
            A.NSEventTypeApplicationDefined, (0, 0), 0, 0, 0, None, 0, 0, 0)
        self.app.postEvent_atStart_(event, True)

    @objc.python_method
    def reply(self, document, request_id, result=None, error=None):
        args = ",".join(json.dumps(value) for value in (document, request_id, result, error))
        self.webview.evaluateJavaScript_completionHandler_(f"window.lifeManagerCocoaReply?.({args})", None)

    def userContentController_didReceiveScriptMessage_(self, controller, message):
        frame = message.frameInfo()
        origin = frame.securityOrigin()
        if message.name() != "lifeManager" or message.webView() != self.webview or not trusted_frame(frame.isMainFrame(), origin.protocol(), origin.host(), origin.port(), self.host.origin):
            return
        body = message.body()
        if not hasattr(body, "get"):
            return
        method = body.get("method")
        if method == "quitResult":
            if isinstance(body.get("token"), str):
                self.finish_quit(body["token"], body.get("error"))
            return
        request_id, document = body.get("id"), body.get("documentId")
        if not isinstance(request_id, str) or not isinstance(document, str) or len(request_id) > 100 or len(document) > 100:
            return
        try:
            if method == "setPreference":
                self.preferences.set(body.get("key"), body.get("value"))
                self.install_script()
                self.reply(document, request_id, True)
            elif method == "sendT3":
                self.host.send_t3(body.get("prompt"), body.get("webhookUrl"), lambda result: AppHelper.callAfter(self.reply, document, request_id, result))
            else:
                self.reply(document, request_id, error="Unsupported desktop method.")
        except Exception:
            # Never include webhook URLs or preference values in errors or logs.
            self.reply(document, request_id, error="The desktop operation could not be completed.")

    @objc.python_method
    def open_external(self, url):
        if urlsplit(url).scheme in {"http", "https", "mailto", "codex"}:
            A.NSWorkspace.sharedWorkspace().openURL_(F.NSURL.URLWithString_(url))

    def webView_decidePolicyForNavigationAction_decisionHandler_(self, webview, action, decide):
        url = str(action.request().URL().absoluteString())
        parsed = urlsplit(url)
        same_origin = f"{parsed.scheme}://{parsed.netloc}" == self.host.origin
        target = action.targetFrame()
        if target is not None and (same_origin or (not target.isMainFrame() and url in {"about:blank", "about:srcdoc"})):
            decide(W.WKNavigationActionPolicyAllow)
        else:
            decide(W.WKNavigationActionPolicyCancel)
            if action.navigationType() == W.WKNavigationTypeLinkActivated or parsed.scheme == "codex":
                self.open_external(url)

    def webView_createWebViewWithConfiguration_forNavigationAction_windowFeatures_(self, webview, configuration, action, features):
        self.open_external(str(action.request().URL().absoluteString()))
        return None

    def webView_didFinishNavigation_(self, webview, navigation):
        self.loaded = True
        print("Workspace window loaded.", flush=True)

    def webView_runJavaScriptAlertPanelWithMessage_initiatedByFrame_completionHandler_(self, webview, message, frame, complete):
        alert = A.NSAlert.alloc().init()
        alert.setMessageText_(message)
        alert.runModal()
        complete()

    def webView_runJavaScriptConfirmPanelWithMessage_initiatedByFrame_completionHandler_(self, webview, message, frame, complete):
        alert = A.NSAlert.alloc().init()
        alert.setMessageText_(message)
        alert.addButtonWithTitle_("OK")
        alert.addButtonWithTitle_("Cancel")
        complete(alert.runModal() == A.NSAlertFirstButtonReturn)

    def webView_runJavaScriptTextInputPanelWithPrompt_defaultText_initiatedByFrame_completionHandler_(self, webview, prompt, default, frame, complete):
        alert = A.NSAlert.alloc().init()
        alert.setMessageText_(prompt)
        field = A.NSTextField.alloc().initWithFrame_(F.NSMakeRect(0, 0, 300, 24))
        field.setStringValue_(default or "")
        alert.setAccessoryView_(field)
        alert.addButtonWithTitle_("OK")
        alert.addButtonWithTitle_("Cancel")
        complete(field.stringValue() if alert.runModal() == A.NSAlertFirstButtonReturn else None)

    def webView_runOpenPanelWithParameters_initiatedByFrame_completionHandler_(self, webview, parameters, frame, complete):
        panel = A.NSOpenPanel.openPanel()
        panel.setAllowsMultipleSelection_(parameters.allowsMultipleSelection())
        panel.setCanChooseDirectories_(parameters.allowsDirectories())
        complete(panel.URLs() if panel.runModal() == A.NSModalResponseOK else None)


def run(host, home, desktop_class=Desktop, on_ready=None):
    F.NSProcessInfo.processInfo().setProcessName_("Life Manager")
    desktop = desktop_class.alloc().init()
    desktop.setup(host, home)
    for name in (signal.SIGINT, signal.SIGTERM):
        signal.signal(name, lambda *_: AppHelper.callAfter(desktop.quit_, None))
    if on_ready:
        AppHelper.callAfter(on_ready, desktop)
    try:
        desktop.app.run()
    finally:
        desktop.control_server.close()
        desktop.content.removeScriptMessageHandlerForName_("lifeManager")
        A.NSStatusBar.systemStatusBar().removeStatusItem_(desktop.status_item)
