---
name: verify
description: Build/launch/drive recipe to verify StarMap changes end-to-end in headless Chromium.
---

# Verify StarMap

Static app, no build step. Surface is a browser GUI (WebGL canvas).
Data tests: `node tests/catalog.test.js` (validates `data/stars.js`,
`data/nebulae.js`, `data/star-types.js` and `CREDITS.md`).

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
- Write a status `<div>` ABOVE the iframe (JSON of `#star-name`,
  `#star-locality`, `#object-image` hidden state, `#visible-count`,
  `.nebula-ring` count, captured window errors) so the screenshot doubles as
  a state assertion. Placed below the iframe it falls off the capture.

Serve the driver from the same origin (tiny Node http server mapping
`/driver.html` to the scratchpad, everything else to the repo).

## Flows worth driving

- Default load: Sol selected, `Locality` row reads "Milky Way", summary shows
  star and nebula counts, no errors.
- Search "Orion Nebula": image + credit + citation in the panel; the sprite
  fills the 5 ly view with the selection ring around it; zoom out to see it
  shrink to physical scale.
- Search "Sagittarius A*": type "Black hole", GRAVITY citation in the panel.
- Search "Rigel", Space, slider to max, drag ~1200 px: Orion-complex sprites
  in the sky (Witch Head, Orion, Flame, Horsehead).
- Contact lines off/normal/prominent around Sol.
- All layers off → only Sol, no link, no errors (empty-neighbor path).

## Gotchas

- Kill the server task when done; port stays bound otherwise.
- Sandbox warning `Sandbox cannot access executable` + one network-service
  crash line at startup are harmless; the screenshot still writes.
- Wikimedia rate-limits image downloads (HTTP 429) if `build_nebulae.py` is
  re-run with `--refresh` too often; the builder waits and resumes.
