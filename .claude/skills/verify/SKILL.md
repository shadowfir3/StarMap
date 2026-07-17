---
name: verify
description: Build/launch/drive recipe to verify StarMap changes end-to-end in headless Chromium.
---

# Verify StarMap

Static app, no build step. Surface is a browser GUI (WebGL canvas).

## Launch

Any static server on the repo root works, e.g. `python -m http.server 8000`.
`npm install` is blocked in the sandbox (SSL handshake failure to registry),
but Playwright browsers already exist under `$LOCALAPPDATA/ms-playwright/`.

Headless Chromium renders the WebGL scene fine with:

```bash
"$LOCALAPPDATA/ms-playwright/chromium-<ver>/chrome-win/chrome.exe" \
  --headless --disable-gpu --enable-unsafe-swiftshader --no-first-run \
  --window-size=1616,900 --virtual-time-budget=9000 \
  --screenshot=out.png "http://127.0.0.1:8000/"
```

`--virtual-time-budget` fast-forwards rAF/setTimeout, so navigation
animations and delayed UI pokes complete before the screenshot.

## Drive interactions

Chromium CLI can't run JS, and Node here (v18) has no WebSocket for CDP.
Working pattern: serve a same-origin `driver.html` that iframes `/index.html`
(1600×850) and, on iframe load, pokes its DOM via `contentDocument`:

- Settings: `doc.querySelector('input[name="contact-lines"][value="prominent"]').click()`
  (radio groups: `grid-strength`, `normal-strength`, `contact-lines`, `star-size`)
- Select/center a star: click `#search-button`, set `#star-search .value`,
  dispatch `new win.Event("input", {bubbles:true})`, then click the first
  `.search-result` after a short timeout.
- Layers: click `#layers-panel input[data-category]` checkboxes.
- Single-click a star on the canvas: read a `.star-label`'s `style.left/top`
  (labels sit at projected star coords), stub
  `canvas.setPointerCapture = () => {}` (synthetic pointers can't be
  captured and the app calls it in pointerdown), then dispatch
  `PointerEvent` pointerdown + pointerup at those coords.
- Keyboard shortcuts: dispatch `new win.KeyboardEvent("keydown", {key:"r"})`
  on the iframe window.
- Write a status `<div>` (JSON of checked inputs, `#star-name`,
  `#visible-count`, captured window errors) so the screenshot doubles as a
  state assertion.

Serve the driver from the same origin (tiny Node http server mapping
`/driver.html` to the scratchpad, everything else to the repo).

## Flows worth driving

- Default load: Sol selected, check `#settings-panel` defaults and visible count.
- Contact lines off/normal/prominent around Sol.
- Search-select a star (e.g. Sirius) and confirm overlays follow the selection.
- All layers off → only Sol, no link, no errors (empty-neighbor path).

## Gotchas

- Kill the server task when done; port stays bound otherwise.
- Sandbox warning `Sandbox cannot access executable` + one network-service
  crash line at startup are harmless; the screenshot still writes.
