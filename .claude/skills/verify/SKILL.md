---
name: verify
description: Build/launch/drive recipe to verify StarMap changes end-to-end in headless Chromium.
---

# Verify StarMap

Static app, no build step. Surface is a browser GUI (WebGL canvas).
Data tests: `node tests/catalog.test.js` (validates `data/stars.js`,
`data/nebulae.js`, `data/star-types.js` and `CREDITS.md`) and
`node tests/pwa.test.js` (manifest, icons, page head, `sw.js` precache list).

## Launch

Any static server on the repo root works, e.g. `python -m http.server 8000`.
`npm install` is blocked in the sandbox (SSL handshake failure to registry),
but Playwright browsers already exist under `$LOCALAPPDATA/ms-playwright/`.

Headless Chromium renders the WebGL scene fine with:

```bash
"$LOCALAPPDATA/ms-playwright/chromium-<ver>/chrome-win/chrome.exe" \
  --headless --disable-gpu --enable-unsafe-swiftshader --no-first-run --no-sandbox \
  --force-prefers-reduced-motion \
  --window-size=1616,960 --virtual-time-budget=15000 \
  --screenshot="C:\\path\\to\\out.png" "http://127.0.0.1:8000/"
```

- `--virtual-time-budget` fast-forwards rAF/setTimeout, so delayed UI pokes
  complete before the screenshot — but the app's navigation/blend animations
  run on `performance.now()` and are captured mid-flight. Pass
  `--force-prefers-reduced-motion`: the app checks `prefers-reduced-motion`
  and then jumps instantly, which makes captures deterministic.
- On Windows/Git Bash pass the screenshot path in Windows form
  (`$(cygpath -w "$PWD")\\out.png`); a POSIX path silently writes nothing.
- Nebula textures are preloaded at startup from data URIs, so sprites appear
  in the first frames.

## Drive interactions

Chromium CLI can't run JS, and Node here (v18) has no WebSocket for CDP.
Working pattern: serve a same-origin `driver.html` that iframes `/index.html`
(1600×850) and, on iframe load, pokes its DOM via `contentDocument`:

- Settings: `doc.querySelector('input[name="contact-lines"][value="prominent"]').click()`
  (radio groups: `grid-strength`, `normal-strength`, `contact-lines`, `star-size`)
- Select/center an object: click `#search-button`, set `#star-search .value`,
  dispatch `new win.Event("input", {bubbles:true})`, then click the first
  `.search-result` after a short timeout. Nebulae are searchable too
  ("Orion Nebula", "M 42").
- Layers: click `#layers-panel input[data-category]` checkboxes
  (`nebula` is the imaged-nebulae layer).
- Wheel zoom: dispatch `WheelEvent("wheel", {deltaY:120})` on the canvas —
  but wait ≥1.5 s after a search, because a wheel cancels a running
  centring animation (irrelevant with reduced motion).
- Single-click a star on the canvas: read a `.star-label`'s `style.left/top`
  (labels sit at projected star coords; nebula labels are lifted above the
  sprite), stub `canvas.setPointerCapture = () => {}` (synthetic pointers
  can't be captured and the app calls it in pointerdown), then dispatch
  `PointerEvent` pointerdown + pointerup at those coords.
- Observation mode: `KeyboardEvent("keydown", {code:"Space"})` on the iframe
  window; set `#visibility-slider` value + `input` event for the range; drag
  the canvas (pointerdown/move/up) to turn the view.
- Keyboard shortcuts: dispatch `new win.KeyboardEvent("keydown", {key:"r"})`
  on the iframe window.
- Touch with synthetic PointerEvents: pass `pointerType:"touch"` and distinct
  `pointerId`s; two pointers down = pinch/pan, a tap followed by a second tap
  within 350 ms / 30 px = double tap. The `dblclick` handler ignores touch.
- Write a status `<div>` ABOVE the iframe (JSON of `#star-name`,
  `#star-locality`, `#object-image` hidden state, `#visible-count`,
  `.nebula-ring` count, captured window errors) so the screenshot doubles as
  a state assertion. Placed below the iframe it falls off the capture.

Serve the driver from the same origin (tiny Node http server mapping
`/driver.html` to the scratchpad, everything else to the repo).

## Touch, mouse and phone layouts: CDP driver (preferred for input)

`cdp_touch.py` next to this file is a stdlib-only DevTools-protocol client
(own WebSocket framing; Node 18 has no WebSocket and npm is blocked). It
launches Chromium with `--remote-debugging-port`, enables touch emulation and
sends real `Input.dispatchTouchEvent` / `dispatchMouseEvent` input, so the
browser generates the pointer events itself (pointerType "touch", touch-action
honoured). Run:

```bash
python -m http.server 8000 &   # or the Node server above
python -I .claude/skills/verify/cdp_touch.py   "$LOCALAPPDATA/ms-playwright/chromium-<ver>/chrome-win/chrome.exe"   "http://127.0.0.1:8000/" "<shots-dir>"
```

It prints a JSON state summary (pinch in both modes, two-finger pan, tap,
double-tap centring, one-finger rotate, mouse click/dblclick/wheel/shift-drag,
window errors, service-worker scope, coarse-pointer footer) and writes
screenshots, including a 390×844 mobile emulation
(`Emulation.setDeviceMetricsOverride` with `mobile: true`, which also makes
`(pointer: coarse)` match). Expected: 15 → 7.5 → 30 ly after the two pinches,
observation range 10 ly with slider value 43, no errors.

Gotchas learned the hard way:

- Keep gesture start points on the sky: (400, 300) is inside the selection
  panel, (600, 600) is clear of every panel at 1600×850.
- Sol has no `.star-label`; probe movement with Sirius or Barnard's Star.
- The canvas centre is not (800, 425) under CDP (window chrome shrinks the
  viewport); read `#star-map.getBoundingClientRect()`.
- Under `--virtual-time-budget`, `requestAnimationFrame` callbacks are deferred
  irregularly: state read from the DOM right after a synthetic event is stale
  while the final screenshot is correct. Synchronous effects (`#star-name`
  after a pick, `#visibility-slider.value`) are reliable; rendered text
  (`#range-value`, label positions) is not. `--timeout` is ignored by the new
  headless mode. Use the CDP driver when you need rendered state.
- Headless `--window-size` cannot go below roughly 500 px wide; test phone
  layouts in an iframe of the driver page or with device metrics override.

## Flows worth driving

- Default load: Sol selected, `Locality` row reads "Milky Way", summary shows
  star and nebula counts, no errors.
- Search "Orion Nebula": image + credit + citation in the panel; the sprite
  fills the 5 ly view with the selection ring around it; zoom out to see it
  shrink to physical scale.
- Search "Sagittarius A*": type "Black hole", GRAVITY citation in the panel,
  and the black-hole icon (dark disc in an orange ring, `u_style` 1 in the
  point shader) instead of a star sprite; Cygnus X-1 reads
  "Black hole · O9.7Iabpvar".
- Search "Anon Lyr" or "Worthey 1": type "No spectral type · unclassified",
  the i-popup titled "Unclassified object".
- Search "Rigel", Space, slider to max, drag ~1200 px: Orion-complex sprites
  in the sky (Witch Head, Orion, Flame, Horsehead).
- Contact lines off/normal/prominent around Sol.
- All layers off → only Sol, no link, no errors (empty-neighbor path).
- Phone layouts: 390×844 and 375×667 portrait (compact rules ≤ 720 px wide),
  568×320 and 844×390 landscape (short rules ≤ 520 px high): no panel overlap,
  tool panels scroll, touch footer shown with a coarse pointer
  (`--blink-settings=primaryPointerType=2,availablePointerTypes=2,primaryHoverType=1,availableHoverTypes=1`).
- Service worker: registered only over http(s) (127.0.0.1 counts as secure);
  `file://` must keep working without it.

## Gotchas

- Kill the server task when done; port stays bound otherwise.
- Sandbox warning `Sandbox cannot access executable` + one network-service
  crash line at startup are harmless; the screenshot still writes.
- Wikimedia rate-limits image downloads (HTTP 429) if `build_nebulae.py` is
  re-run with `--refresh` too often; the builder waits and resumes.
