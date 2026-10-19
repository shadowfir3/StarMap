"""Drive headless Chromium over the DevTools protocol with emulated touch input.

Usage: python -I cdp_touch.py <chrome.exe> <url> <shots-dir>
Serve the repo root first (python -m http.server 8000) and pass http://127.0.0.1:8000/.
Standard library only: a minimal WebSocket client talks CDP directly.
"""
import base64, json, os, socket, struct, subprocess, sys, time, urllib.request

CHROME, URL, SHOTS = sys.argv[1], sys.argv[2], sys.argv[3]
PORT = 9333


class WS:
    def __init__(self, url):
        rest = url.split("://", 1)[1]
        hostport, path = rest.split("/", 1)
        host, port = hostport.split(":")
        self.sock = socket.create_connection((host, int(port)))
        key = base64.b64encode(os.urandom(16)).decode()
        self.sock.sendall((f"GET /{path} HTTP/1.1\r\nHost: {hostport}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n"
                           f"Sec-WebSocket-Key: {key}\r\nSec-WebSocket-Version: 13\r\n\r\n").encode())
        buf = b""
        while b"\r\n\r\n" not in buf:
            buf += self.sock.recv(4096)
        head, self.buf = buf.split(b"\r\n\r\n", 1)
        assert b" 101 " in head.split(b"\r\n")[0], head

    def send(self, text):
        data = text.encode()
        n = len(data)
        header = bytes([0x81])
        if n < 126: header += bytes([0x80 | n])
        elif n < 65536: header += bytes([0x80 | 126]) + struct.pack(">H", n)
        else: header += bytes([0x80 | 127]) + struct.pack(">Q", n)
        mask = os.urandom(4)
        self.sock.sendall(header + mask + bytes(b ^ mask[i % 4] for i, b in enumerate(data)))

    def _exact(self, n):
        while len(self.buf) < n:
            chunk = self.sock.recv(1 << 16)
            if not chunk: raise ConnectionError("socket closed")
            self.buf += chunk
        out, self.buf = self.buf[:n], self.buf[n:]
        return out

    def recv(self):
        message = b""
        while True:
            b1, b2 = self._exact(2)
            fin, opcode, n = b1 & 0x80, b1 & 0x0F, b2 & 0x7F
            if n == 126: n = struct.unpack(">H", self._exact(2))[0]
            elif n == 127: n = struct.unpack(">Q", self._exact(8))[0]
            mask = self._exact(4) if b2 & 0x80 else None
            payload = self._exact(n)
            if mask: payload = bytes(b ^ mask[i % 4] for i, b in enumerate(payload))
            if opcode == 8: raise ConnectionError("closed by peer")
            if opcode == 9:  # ping -> pong
                self.sock.sendall(bytes([0x8A, 0x80]) + b"\0\0\0\0"); continue
            if opcode == 10: continue
            message += payload
            if fin: return message.decode()


class CDP:
    def __init__(self, ws):
        self.ws, self.id = ws, 0

    def call(self, method, **params):
        self.id += 1
        self.ws.send(json.dumps({"id": self.id, "method": method, "params": params}))
        while True:
            msg = json.loads(self.ws.recv())
            if msg.get("id") == self.id:
                if "error" in msg: raise RuntimeError(f"{method}: {msg['error']}")
                return msg.get("result", {})

    def js(self, expression, wait=False):
        result = self.call("Runtime.evaluate", expression=expression, awaitPromise=wait, returnByValue=True)
        if "exceptionDetails" in result: raise RuntimeError(result["exceptionDetails"].get("text"))
        return result["result"].get("value")

    def frame(self):
        self.js("new Promise(r => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(r, 20))))", wait=True)

    def text(self, selector):
        return self.js(f"document.querySelector({selector!r}).textContent")

    def label(self, name):
        return self.js(f"(() => {{ const l = [...document.querySelectorAll('.star-label')].find(l => l.textContent === {name!r}); return l && [Math.round(parseFloat(l.style.left)), Math.round(parseFloat(l.style.top))]; }})()")

    def touch(self, kind, points):
        self.call("Input.dispatchTouchEvent", type=kind, touchPoints=[{"x": x, "y": y, "id": i} for i, (x, y) in enumerate(points)])

    def mouse(self, kind, x, y, **extra):
        self.call("Input.dispatchMouseEvent", type=kind, x=x, y=y, **extra)

    def shot(self, name):
        data = self.call("Page.captureScreenshot", format="png")["data"]
        with open(os.path.join(SHOTS, name), "wb") as handle: handle.write(base64.b64decode(data))


def near(p, x, y, tol=3):
    return bool(p) and abs(p[0] - x) <= tol and abs(p[1] - y) <= tol


chrome = subprocess.Popen([CHROME, "--headless", "--disable-gpu", "--enable-unsafe-swiftshader", "--no-first-run", "--no-sandbox",
                           "--force-prefers-reduced-motion", f"--remote-debugging-port={PORT}", "--window-size=1600,850", "about:blank"],
                          stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
try:
    targets = None
    for _ in range(100):
        try:
            with urllib.request.urlopen(f"http://127.0.0.1:{PORT}/json") as response: targets = json.load(response)
            if any(t["type"] == "page" for t in targets): break
        except Exception: pass
        time.sleep(0.2)
    page = next(t for t in targets if t["type"] == "page")
    cdp = CDP(WS(page["webSocketDebuggerUrl"]))
    cdp.call("Emulation.setTouchEmulationEnabled", enabled=True, maxTouchPoints=5)
    cdp.call("Runtime.enable")
    cdp.call("Page.navigate", url=URL)
    for _ in range(100):
        if cdp.js("document.readyState") == "complete" and cdp.js("document.querySelector('#visible-count').textContent") not in ("0", None): break
        time.sleep(0.2)
    cdp.js("window.__errors = []; window.addEventListener('error', e => window.__errors.push(String(e.message)));")
    cdp.frame()
    out = {}
    out["fullscreenHidden"] = cdp.js("document.querySelector('#fullscreen-button').hidden")
    out["coarsePointer"] = cdp.js("matchMedia('(pointer: coarse)').matches")
    out["rangeBefore"] = cdp.text("#range-value")
    cx, cy = cdp.js("(() => { const r = document.querySelector('#star-map').getBoundingClientRect(); return [Math.round(r.left + r.width / 2), Math.round(r.top + r.height / 2)]; })()")
    out["centre"] = [cx, cy]
    probe = lambda: next((cdp.label(n) for n in ["Sirius", "Procyon", "Barnard's Star", "Rigil Kentaurus"] if cdp.label(n)), None)

    # 1. pinch out: 100 px -> 200 px between fingers => radius 15 -> 7.5 ly
    cdp.touch("touchStart", [(750, 425), (850, 425)]); cdp.touch("touchMove", [(750, 425), (950, 425)]); cdp.touch("touchEnd", [])
    cdp.frame(); out["afterPinchOut"] = cdp.text("#range-value")
    # 2. pinch in with both fingers (200 -> 50 px => x4 => 30 ly) and a midpoint drift of +50/+40 px (pan)
    cdp.touch("touchStart", [(700, 400), (900, 400)]); cdp.touch("touchMove", [(800, 440), (850, 440)]); cdp.touch("touchEnd", [])
    cdp.frame(); out["afterPinchIn"] = cdp.text("#range-value"); out["nameAfterPinches"] = cdp.text("#star-name")
    # 3. two-finger pan only (constant distance): radius unchanged, Sol label moves
    before = probe()
    cdp.touch("touchStart", [(600, 400), (800, 400)]); cdp.touch("touchMove", [(650, 460), (850, 460)]); cdp.touch("touchEnd", [])
    cdp.frame(); out["afterPanOnly"] = cdp.text("#range-value"); out["panMovedStars"] = [before, probe()]
    # 4. tap then double tap a single star
    target = next((n for n in ["Barnard's Star", "Ran", "Altair", "Fomalhaut"] if cdp.label(n)), None)
    out["touchTarget"] = target
    x, y = cdp.label(target)
    cdp.touch("touchStart", [(x, y)]); cdp.touch("touchEnd", [])
    cdp.frame(); out["tapSelected"] = cdp.text("#star-name") == target
    time.sleep(0.5)  # > 350 ms so the next two taps form their own double tap
    cdp.touch("touchStart", [(x, y)]); cdp.touch("touchEnd", []); time.sleep(0.12); cdp.touch("touchStart", [(x + 2, y + 1)]); cdp.touch("touchEnd", [])
    cdp.frame(); cdp.frame()
    out["doubleTapCentred"] = near(cdp.label(target), cx, cy)
    out["labelAfterDoubleTap"] = cdp.label(target)
    out["nameAfterDoubleTap"] = cdp.text("#star-name")
    # 5. one-finger drag rotates (target label moves away from the centre? no: the focused star stays centred; Sol moves)
    before = probe()
    cdp.touch("touchStart", [(600, 600)])  # on the sky, clear of the selection panel and the action buttons
    for i in range(1, 6): cdp.touch("touchMove", [(600 + 24 * i, 600 + 12 * i)])
    cdp.touch("touchEnd", [])
    cdp.frame(); out["dragRotated"] = [before, probe()]; out["nameAfterDrag"] = cdp.text("#star-name")
    # 6. tap on empty sky clears the selection (panel shows Sol)
    cdp.touch("touchStart", [(60, 700)]); cdp.touch("touchEnd", [])
    cdp.frame(); out["nameAfterEmptyTap"] = cdp.text("#star-name")
    cdp.shot("cdp-map-after-touch.png")
    # 7. observation mode pinch (200 -> 600 px => range / 3) and slider mirror
    cdp.js("document.querySelector('#observe-button').click()"); cdp.frame(); cdp.frame()
    out["observeGrid"] = cdp.text("#grid-value"); out["observeRangeBefore"] = cdp.text("#range-value")
    cdp.touch("touchStart", [(700, 425), (900, 425)]); cdp.touch("touchMove", [(700, 425), (1300, 425)]); cdp.touch("touchEnd", [])
    cdp.frame(); out["observeRangeAfter"] = cdp.text("#range-value"); out["sliderValue"] = cdp.js("document.querySelector('#visibility-slider').value")
    cdp.shot("cdp-observe-after-pinch.png")
    cdp.js("document.querySelector('#observe-button').click()"); cdp.frame(); cdp.frame()
    # 8. mouse: click selects, double click centres, wheel scales, shift-drag pans
    cdp.call("Emulation.setTouchEmulationEnabled", enabled=False)
    mouse_target = next((n for n in ["Ran", "Altair", "Fomalhaut", "Procyon"] if n != target and cdp.label(n)), None)
    out["mouseTarget"] = mouse_target
    mx, my = cdp.label(mouse_target)
    cdp.mouse("mouseMoved", mx, my); cdp.mouse("mousePressed", mx, my, button="left", clickCount=1); cdp.mouse("mouseReleased", mx, my, button="left", clickCount=1)
    cdp.frame(); out["clickSelected"] = cdp.text("#star-name") == mouse_target
    cdp.mouse("mousePressed", mx, my, button="left", clickCount=2); cdp.mouse("mouseReleased", mx, my, button="left", clickCount=2)
    cdp.frame(); cdp.frame(); out["dblclickCentred"] = near(cdp.label(mouse_target), cx, cy); out["labelAfterDblclick"] = cdp.label(mouse_target)
    before = cdp.text("#range-value")
    cdp.mouse("mouseWheel", 800, 425, deltaX=0, deltaY=240)
    cdp.frame(); out["wheel"] = [before, cdp.text("#range-value")]
    before = probe()
    cdp.mouse("mousePressed", 500, 300, button="left", clickCount=1, modifiers=8); cdp.mouse("mouseMoved", 560, 340, button="left", modifiers=8); cdp.mouse("mouseReleased", 560, 340, button="left", clickCount=1, modifiers=8)
    cdp.frame(); out["shiftDragPanned"] = [before, probe()]; out["rangeAfterShiftDrag"] = cdp.text("#range-value")
    out["errors"] = cdp.js("window.__errors")
    out["serviceWorker"] = cdp.js("navigator.serviceWorker.getRegistration().then(r => r ? r.scope : null)", wait=True)
    cdp.shot("cdp-final.png")
    # 9. phone emulation screenshot with device metrics (mobile + touch => coarse pointer)
    cdp.call("Emulation.setTouchEmulationEnabled", enabled=True, maxTouchPoints=5)
    cdp.call("Emulation.setDeviceMetricsOverride", width=390, height=844, deviceScaleFactor=2, mobile=True)
    cdp.call("Page.reload"); time.sleep(1.5)
    for _ in range(50):
        if cdp.js("document.readyState") == "complete" and cdp.js("document.querySelector('#visible-count').textContent") not in ("0", None): break
        time.sleep(0.2)
    cdp.frame(); cdp.frame()
    out["phoneCoarse"] = cdp.js("matchMedia('(pointer: coarse)').matches")
    out["phoneFooter"] = cdp.js("getComputedStyle(document.querySelector('footer .touch-hint')).display")
    cdp.shot("cdp-phone.png")
    print(json.dumps(out, indent=1))
finally:
    chrome.kill()
