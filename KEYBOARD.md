# Keyboard and Mouse Reference

Complete input mapping of the star map, derived from `app.js`. The map has two
modes: **map mode** (default, isometric orthographic view) and **observation
mode** (first-person sky view from the focused object). Bindings that differ
between modes are listed separately. Mouse, keyboard and touch input are all
active at the same time.

The **reference plane** (Z = 0, the grid) is the Galactic plane in the default
Galactic frame and the celestial equator in the equatorial frame; the frame is
chosen in the Settings panel.

## General rules

- Shortcuts are suspended while a form control (search field, checkbox, radio
  button, the visibility slider, the contact-line transparency slider) holds
  keyboard focus. Exception: `Space` on the visibility slider still toggles
  observation mode.
- `R` and `F` are bound to the typed character and also fire with `Shift`.
  `W`, `A`, `S`, `D`, `Q`, `E` are bound to physical key positions
  (`event.code`); on non-QWERTY layouts the same physical cluster applies.
- Held movement keys are released on key-up and when the window loses focus.
- Starting a key movement, a wheel action, or a pointer drag cancels a running
  centring animation.
- When the operating system requests reduced motion, every animation (centring,
  observer travel, mode transition) is replaced by an instant jump.

## Keys in map mode

| Key | Action |
| --- | --- |
| `W` / `S` | Move the view centre forward / backward along the reference plane, relative to the camera heading. |
| `A` / `D` | Move the view centre left / right along the reference plane. |
| `Q` / `E` | Move the view centre down / up (−Z / +Z), perpendicular to the reference plane. |
| `Space` | Enter observation mode (ignored on key repeat). |
| `R` | Reset: Sol at the centre, 15 ly radius, the frame's initial rotation (yaw 225° Galactic, 45° equatorial, pitch 35.26°), selection cleared, observation direction reset. Display settings, including the frame, are unaffected. |
| `F` | Toggle fullscreen for the map viewport. |
| `Esc` | Close the type information popup. |
| `←` `→` `↑` `↓` `Home` `End` (transparency slider focused) | Native range-slider steps for the contact-line transparency, 0 to 100 % in steps of 1. |

Movement notes: keys combine for diagonal motion (normalised to unit speed).
Speed is 0.9 × radius per second, with a floor of 0.8 ly/s.

## Keys in observation mode

| Key | Action |
| --- | --- |
| `Space` | Return to map mode (ignored on key repeat). |
| `R` | Reset as above; observation mode is left without animation. |
| `F` | Toggle fullscreen. |
| `Esc` | Close the type information popup. |
| `←` `→` `↑` `↓` `Home` `End` (slider focused) | Native range-slider steps for the maximum visibility distance (200 logarithmic steps, 1 to 50,000 ly). |

`W`, `A`, `S`, `D`, `Q`, `E` are inactive in observation mode. The viewing
direction starts along the frame's X axis: toward the Galactic centre in the
Galactic frame, toward RA 0h in the equatorial frame.

## Keys in the search panel

| Key | Action |
| --- | --- |
| `↓` / `↑` | Move the highlight through the result list (wraps around). |
| `Enter` | Open the highlighted result, or the first result if none is highlighted. |
| `Esc` | Close all tool panels and return focus to the Search button. |

Typing filters Sol, every positioned star and every nebula by name, alias
(Messier / NGC), and SIMBAD / HIP / HD identifier. At most nine results are
listed.

## Mouse in map mode

| Input | Action |
| --- | --- |
| Drag | Rotate the view. Yaw is unlimited; pitch is clamped to ±1.42 rad (≈ ±81°). |
| `Shift` + drag | Pan the view centre along the reference plane. |
| Wheel | Scale the visibility radius exponentially between 1 and 50,000 ly. The grid interval follows (1, 5, 10, 50, 100, 500, 1,000, 5,000, 10,000 ly); the galaxy background fades in between 100 and 20,000 ly. |
| Click (pointer moved ≤ 4 px) | Select the nearest object within 14 px. Sol and stars take precedence; a nebula is hit anywhere within its sprite, up to 70 px from its centre. A click on empty sky clears the selection and shows Sol. |
| Double-click | Centre the view on the object (it becomes the focused object). The radius is unchanged; a hidden layer containing the object is re-enabled. |
| Hover | A targeting reticle replaces the pointer over a selectable object. |

## Mouse in observation mode

| Input | Action |
| --- | --- |
| Drag | Turn the viewing direction. Altitude is clamped to ±1.55 rad (≈ ±89°). `Shift` has no effect. |
| Wheel | Change the maximum visibility distance between 1 and 50,000 ly; the slider mirrors the value. |
| Click | Select the object (details panel only). |
| Double-click | Move the observer to the object with an animated transition. |

## Buttons

| Control | Equivalent key | Action |
| --- | --- | --- |
| Observe | `Space` | Toggle observation mode. |
| Reset | `R` | Reset the view. |
| Fullscreen | `F` | Toggle fullscreen. Hidden where the browser lacks the Fullscreen API (iPhone) and when the map runs as an installed app. |
| Search / Layers / Settings | – | Open one tool panel; opening one closes the others. A click outside closes all. |
| All (Layers panel) | – | Enable every layer. |
| Reference frame (Settings panel) | – | Galactic or Equatorial (ICRS). The view centre, the observer and both viewing directions are converted: the line of sight is kept and the image only turns about the screen centre, since screen-up follows the other pole. |
| Defaults (Settings panel) | – | Restore the default display settings and save them. |
| Contact-line transparency slider (Settings panel) | arrow keys when focused | Set the transparency of the contact lines from 0 % (opaque) to 100 % (invisible); the value is shown beside the slider and saved immediately. Disabled while the contact-line switch is off. |
| Nearest stars (below the title) | – | Expand or collapse the list of visible stars ordered by distance from the selected object. A row click selects the star; a double-click centres the view on it. |
| i (next to the object type) | – | Open the type information popup. |
| × (popup) | `Esc` | Close the type information popup. |

Every control in the Settings panel writes its value to `localStorage`
(`star-map.settings`) at once; the next visit of the same browser profile
restores it.

## Touch input

Touch and pen input are handled through pointer events; the browser's own
pinch-zoom, double-tap zoom and long-press menu are suppressed on the map.

| Gesture | Map mode | Observation mode |
| --- | --- | --- |
| One-finger drag | Rotate the view. | Turn the viewing direction. |
| Two-finger pinch | Scale the visibility radius (1 to 50,000 ly) by the ratio of the finger distances. | Scale the maximum visibility distance; the slider follows. |
| Two-finger drag | Pan the view centre along the reference plane with the midpoint of the fingers. | Turn the viewing direction with the midpoint. |
| Tap (movement ≤ 10 px) | Select the object under the finger, with the same pick rules as a click. | Select the object. |
| Double-tap (second tap within 350 ms and 30 px) | Centre the view on the object. | Move the observer to the object. |

Notes:

- Pinch and two-finger drag are one gesture: the distance scales, the midpoint
  pans or turns. Once a second finger touches, no tap is registered; after one
  finger lifts, the remaining finger is ignored until it lifts too.
- Double-taps are detected from the pointer events, so they do not depend on
  the browser delivering `dblclick` (which iOS does not).
- The on-screen buttons (Observe, Reset, Search, Layers, Settings) and the
  sliders replace the keyboard. Vertical movement (`Q` / `E`) has no touch
  equivalent; double-tap an object to centre the view on it instead.
- On devices whose primary pointer is coarse, the footer shows touch hints
  instead of mouse and keyboard hints.
