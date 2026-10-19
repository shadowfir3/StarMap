# Star Map

A static, dependency-free WebGL star map with Sol at the origin, reaching from
the nearest stars to the Galactic centre and the Magellanic Clouds. The browser
renders a checked-in catalog snapshot of 3,174 positioned
stars and 56 imaged nebulae; two Python builders regenerate that snapshot from
WGSN, SIMBAD, Gaia DR3, VizieR and Wikimedia Commons.

Current version: **V1.0** (see [Versioning](#versioning)).

![Default view: Sol inside the 15 light-year visibility sphere](star-map-preview.png)

## Contents

- [Features](#features)
- [Running the map](#running-the-map)
- [Installing as an app](#installing-as-an-app)
- [Controls](#controls)
- [Interface](#interface)
- [Observation mode](#observation-mode)
- [Data](#data)
- [Rebuilding the data](#rebuilding-the-data)
- [Verification](#verification)
- [Sources and cautions](#sources-and-cautions)
- [Versioning](#versioning)
- [Licence](#licence)

## Features

- Isometric orthographic view (yaw 45°, pitch 35.26°); default visibility
  sphere of 15 ly over a 10 ly reference grid; wheel scaling from 1 to
  50,000 ly with a grid interval of 1, 5, 10, 50 or 100 ly.
- 3,174 positioned stars in nine layers, including a curated set of famous
  objects: Sagittarius A\*, VY Canis Majoris, Cygnus X-1, the Gaia black holes,
  the Crab and Vela pulsars, Kepler exoplanet hosts.
- 56 nebulae and supernova remnants drawn as their telescope images (public
  domain, CC0 or CC BY files from Wikimedia Commons), scaled to physical size.
- Observation mode: a first-person view of the sky from any focused object.
- Search with aliases and identifiers, layer switches, display settings and an
  offline type-information popup.
- Touch input for phones and tablets: pinch, two-finger pan, tap and
  double-tap, with layouts for narrow and short screens.
- Installable as a home-screen web app (PWA) with an offline cache.
- No build step, no third-party packages; runs from `file://`.

## Running the map

Requirement: a browser with WebGL. Python 3 is needed only to serve the
directory or to rebuild the data.

Open `index.html` directly, or serve the repository root:

```powershell
python -m http.server 8000
```

Then visit `http://localhost:8000`.

The layout is designed for a 1600 × 850 px viewport and shrinks to the browser
window; a compact layout applies below 720 px width, a short layout below
520 px height, and 320 px is the minimum width. **Fullscreen** (`F`) uses the
entire display; the button is hidden where the browser has no Fullscreen API
(iPhone) and when the map runs as an installed app. Rendering is capped at a
device pixel ratio of 2.

## Installing as an app

The map is a progressive web app: `manifest.json` declares the name, icons
(`icons/`) and standalone display, and `sw.js` is a service worker that caches
every file on first load (about 7.5 MB) and serves it cache-first afterwards,
so an installed copy starts and runs without a network connection.

Requirements: the page must be served over HTTPS (or from `localhost`);
service workers are not registered over plain HTTP or from `file://`, where
the map still runs as before, only without the offline cache. Any static host
is sufficient, for example GitHub Pages for this repository.

- **iOS and iPadOS:** open the page in Safari, choose **Share**, then **Add to
  Home Screen**. The icon opens the map as a standalone app. Safari 26
  installs any page this way; older versions rely on the meta tags and the
  manifest included here.
- **Android:** Chrome offers **Install app** (or **Add to Home screen**) in
  its menu once the page has loaded over HTTPS.
- **Desktop Chrome and Edge:** the install icon in the address bar creates a
  windowed app.

Updates: the worker precaches the files listed in `PRECACHE_URLS` in `sw.js`
under the name in `CACHE_VERSION`. After changing any of those files, change
`CACHE_VERSION`; the next visit installs the new cache and removes the old one.
`node tests/pwa.test.js` checks that the manifest, icons, page head and
precache list are consistent.

## Controls

| Input | Map mode | Observation mode |
| --- | --- | --- |
| Drag | Rotate | Turn the viewing direction |
| `Shift` + drag | Pan along the reference plane | – |
| Wheel | Visibility radius (1 to 50,000 ly) | Maximum visibility distance |
| Click | Select the object | Select the object |
| Double-click | Centre the view on the object | Move the observer to the object |
| `W` `A` `S` `D` / `Q` `E` | Move the view centre on / off the plane | – |
| `Space` | Enter observation mode | Return to map mode |
| `R` | Reset the view | Reset the view |
| `F` | Toggle fullscreen | Toggle fullscreen |
| Touch: one-finger drag | Rotate | Turn the viewing direction |
| Touch: pinch | Visibility radius | Maximum visibility distance |
| Touch: two-finger drag | Pan along the reference plane | Turn the viewing direction |
| Touch: tap / double-tap | Select / centre | Select / move the observer |

Mouse, keyboard and touch work side by side on hybrid devices. The complete
mapping, including search-panel keys, pick rules and touch details, is
documented in [KEYBOARD.md](KEYBOARD.md).

## Interface

### Selection panel (upper left)

A click shows the object's name, type, distance from Sol, Cartesian position
and **locality** (host galaxy: "Milky Way" for almost every object, "Large
Magellanic Cloud" for R136a1, WOH G64, S Doradus, the Tarantula Nebula and
SN 1987A). The type is the SIMBAD spectral type; black holes and neutron stars
show their class first, followed by the companion's spectral type where SIMBAD
records one. Objects without a spectral type (616 of the positioned rows, such
as Anon Lyr or Worthey 1) read "No spectral type · unclassified". The source line lists the SIMBAD and Gaia DR3 identifiers, the
astrometry source, the distance quality flag and, where applicable, the
literature citation. Nebulae additionally show their image with author,
licence and a link to the Wikimedia Commons file page, the physical and
angular extent, and the distance with its error and source. Stars take
precedence over nebulae when both lie within the pick radius. The panel shows
Sol until an object is selected.

The circular **i** beside the type opens a compact offline description of the
stellar family or nebula class. The descriptions in `data/star-types.js` are
locally stored paraphrases of the linked English Wikipedia articles (stellar
families retrieved 2026-07-11, nebula classes 2026-08-26); the popup keeps the
catalog code visible and links to the source article.

### Labels and Sol indicator

Up to 28 labels are drawn for objects with a fame score of at least 100 and
for the selected object, with a minimum separation of 55 px. When the Sol
indicator is enabled, the selected object receives a gold line toward Sol and
a label with its distance in light-years (map mode only).

### Nearest stars (right edge, below the title)

A collapsible list of the stars currently visible on the map, ordered by
ascending distance from the selected object (Sol when nothing is selected).
Collapsed by default, the control is a borderless label and performs no
computation. Opened, it gains a dim frame and lists at most 20 stars, or as
many as fit above the scale panel without scrolling, each with its colour,
name and distance from the reference object. Sol is listed when another object
is selected. The list follows every change of view and selection. A click on a
row selects that star, so the list re-orders around it; a double-click centres
the view on it.

### Search

The search field matches Sol, every positioned star and every nebula by name,
alias (Messier and NGC designations) and SIMBAD, HIP or HD identifier. Results
are ranked by match quality (exact, prefix, word prefix, substring,
identifier), then fame, then distance; nine are listed. Selecting a result
centres the view on the object and reduces the visibility radius to 5 ly if it
is larger; a hidden layer containing the object is re-enabled. In observation
mode the observer travels to the object instead.

### Layers

Ten layers with object counts, all enabled on start: red dwarfs, yellow
dwarfs, other main-sequence stars, white dwarfs, neutron stars and pulsars,
black holes, giants and supergiants, brown dwarfs, other or unknown objects,
and imaged nebulae. **All** re-enables every layer.

Stars are drawn as point sprites with a bright core and halo in their spectral
colour, blended additively. Black holes use a distinct icon: a dark disc inside
a bright, one-sided accretion ring in a warm orange tint, drawn with ordinary
alpha blending so that the disc occludes what lies behind it. The same tint
marks their drop lines and contact lines.

### Settings

The gear menu changes display emphasis only; catalog data is unaffected.

- **Grid:** off, light (default) or prominent neon blue. In observation mode
  the same setting controls the sky globe.
- **Grid normals:** off, light (default) or prominent. Each visible object
  receives a drop line in its spectral colour from the Z = 0 plane to its
  position; objects within 0.2 % of the radius of the plane receive none.
- **Contact lines:** off, normal (default) or prominent. Lines are drawn flat
  on the Z = 0 plane from the focused object's foot point (the base of its
  perpendicular) to the foot point of every other visible object, each in that
  object's spectral colour. If the focused object lies off the plane, its own
  perpendicular is drawn first so that it stays connected to the fan. The
  focused object is the one centred by double-click, search or reset (Sol on
  start); a single click changes the selection but not the focus.
- **Star size:** normal, large (default) or accurate. Accurate derives a
  compressed logarithmic visual-luminosity scale (2.5 to 28 px) from apparent
  magnitude and distance; objects without photometry use a neutral size.
  Black-hole icons use a fixed size per mode (17, 22 or 14 px).
- **Sol indicator:** show or hide the direction line and distance label.
- **Cropping sphere:** show or hide the wireframe visibility boundary; the
  spherical cutoff itself remains active.

### Scale panel and status

The scale panel shows the visibility radius with a logarithmic scale bar (a
slider in observation mode), the current grid interval and the number of
visible objects including Sol. The title block reports the positioned star
count, the nebula count and the snapshot date. An overlay reports a missing
WebGL context or a missing catalog.

The wire sphere is the active three-dimensional crop boundary. The Z = 0 plane
is the equatorial plane implied by the ICRS axes; it is a visual reference
plane, not the Galactic plane.

## Observation mode

`Space` or **Observe** switches to a first-person perspective view (60°
vertical field of view) from the focused object, Sol on start. The observer is
treated as a point; nothing is occluded and the observer's own object is not
drawn. The planar grid, cropping sphere, normals, contact lines and Sol
indicator fade out; the grid setting instead draws a sky globe divided into
45° azimuth and altitude sectors in the same equatorial frame.

- Dragging turns the viewing direction only. The direction starts at the
  frame's north (azimuth 0° toward RA 0h, altitude 0°) and is retained when
  switching between modes; Reset restores it.
- The scale panel replaces its bar with a logarithmic slider (1 to 50,000 ly)
  for the maximum visibility distance; the wheel changes the same value. The
  distance is initialised from the map radius on first entry and retained
  thereafter. Objects beyond 75 % of the distance fade linearly and vanish at
  the limit; Sol is subject to the same rule when observed from elsewhere.
- Double-clicking an object, or choosing a search result, moves the observer
  to that object with an animated transition.
- Nebula sprites are scaled to their apparent angular size from the observer.
- Entering and leaving the mode is animated like double-click navigation; the
  transition blends from a narrow-field perspective that approximates the
  orthographic map.

## Data

### Files

| File | Content |
| --- | --- |
| `data/stars.js` | Browser payload: positioned rows in compact form; loads from `file://` without fetch or CORS. |
| `data/stars.csv` | Auditable table of every candidate row, including rows without coordinates or distance. |
| `data/catalog-metadata.json` | Generation time, selection constants, source endpoints, row counts, coordinate frame and distance policy. |
| `data/nebulae.js` | Browser payload: 56 nebulae with embedded base64 JPEG images. |
| `data/nebulae.csv` | Audit table of the nebulae without image bytes. |
| `data/nebulae/` | Downloaded Wikimedia thumbnails and the cached `sources.json`. |
| `data/star-types.js` | Offline type descriptions for the information popup. |
| `manifest.json`, `sw.js`, `icons/` | Web app manifest, offline service worker and app icons (180, 192, 512 px). |
| `CREDITS.md` | Per-image attribution and licence list. |

### Catalog selection

"SIMBAD named" denotes a stellar SIMBAD object with at least one identifier
whose literal prefix is `NAME `. SIMBAD pads identifiers internally (`HD  95735`,
`Wolf   28`); all identifier matching in the builder is whitespace-insensitive.
Every such object is retained in the CSV, including entries without
coordinates or without a defensible distance. Only the subset with finite,
quality-accepted 3D coordinates is emitted to `stars.js`; a later rebuild
places an object automatically once its source astrometry improves.

The candidate union comprises:

1. Every star in the current IAU/WGSN Catalog of Star Names.
2. Every SIMBAD stellar object with at least one identifier beginning `NAME `.
3. Bright Star Catalogue V/50 stars with Johnson V below 4.0, resolved to
   SIMBAD by HR identifier.
4. Stellar SIMBAD objects whose catalog parallax places them within 50 ly.
5. The explicit famous-object list `CURATED` in `scripts/build_catalog.py`:
   the Galactic-centre black hole Sagittarius A\* with the star S2 and the
   Pistol Star; hypergiants such as VY Canis Majoris, NML Cygni,
   Westerlund 1-26, RW and VV Cephei, Rho Cassiopeiae, HR 5171 A,
   V838 Monocerotis, WR 104 and WR 124, and the LMC members WOH G64 and
   S Doradus; stellar-mass black holes (Cygnus X-1, V404 Cygni, Gaia BH1 to
   BH3, SS 433, V4641 Sgr, A0620-00, GRS 1915+105, MAXI J1820+070); pulsars
   (Crab, Vela, Geminga, PSR B1919+21, PSR J0437-4715); and exoplanet hosts and
   nearby classics (Kepler-186, -452, -22 and -90, HD 209458, the Methuselah
   star HD 140283, T CrB, RR Lyrae, Wolf 359, Gliese 581, Lalande 21185,
   Kapteyn's, Luyten's, Teegarden's and Van Maanen's stars, WISE 0855−0714).
   Curated labels take precedence over SIMBAD `NAME` identifiers but never
   over an official IAU name (Mu Cephei therefore appears as "Garnet Star",
   T CrB as "Blaze Star").

### Row semantics

Resolved rows are deduplicated by SIMBAD `oid`, never by display name. A row
represents the SIMBAD object that was resolved: a component remains a
component, an unresolved system remains a system. Non-stellar objects such as
exoplanets are excluded by requiring stellar membership in SIMBAD's object-type
hierarchy. Every current WGSN entry is retained even if it cannot be uniquely
resolved in SIMBAD; such rows carry WGSN coordinates but no invented distance.
Stephenson 2-18 is retained as a clearly marked literature-only exception
because no unique SIMBAD object resolves under that popular name.

Display names use, in order: official IAU name, curated label, `NAME`
identifier, Bayer designation, Flamsteed designation, HD, HIP, Gaia DR3, SIMBAD
main identifier. The CSV retains every SIMBAD identifier for audit.
`stellar_category` is derived reproducibly from the SIMBAD object type and the
primary component of the spectral type (a companion's `+B2V` does not turn
Antares into a dwarf; legacy `dM6` denotes a red dwarf, not a white dwarf).
SIMBAD types black holes as X-ray or spectroscopic binaries, so the black-hole
layer is populated from the explicit `CATEGORY_OVERRIDES` table.
"Main-sequence star" is the English term for German *Hauptreihenstern*; red
and yellow dwarfs are exposed as sublayers of that class.

`locality` names the host galaxy. It defaults to "Milky Way", is curated for
known Large Magellanic Cloud members, and any positioned row beyond 100,000 ly
without a curated host is flagged rather than called Galactic.

### Nebulae and supernova remnants

`data/nebulae.js` and `data/nebulae.csv` hold 56 imaged objects: H II
regions, planetary nebulae, supernova remnants, reflection and dark nebulae,
two protoplanetary nebulae and the Homunculus. They are curated in `NEBULAE`
in `scripts/build_nebulae.py` with, per object:

- **Position** from the SIMBAD basic table for the pinned identifier; curated
  coordinates only for the Pillars of Creation, which SIMBAD does not list
  separately.
- **Distance** as an explicit literature value with asymmetric error, citation
  and ADS bibcode, and a quality flag in the stars' vocabulary
  (`literature_distance`, `uncertain_literature_distance`,
  `host_system_distance`). Typical sources are Gaia parallaxes of the
  ionizing stars or planetary-nebula central stars (Kuhn et al. 2019, Zucker
  et al. 2020, Bailer-Jones et al. 2021, Chornay & Walton 2021), VLBI maser
  parallaxes, expansion parallaxes and the LMC eclipsing-binary distance.
  Objects without a defensible distance (Boomerang, Stingray, Egg and Necklace
  nebulae, the Gum Nebula) are omitted.
- **Extent** as an apparent size in arcminutes (SIMBAD `galdim_majaxis` where
  preferred, otherwise curated). The sprite is drawn `2 · d · tan(θ/2)`
  light-years across: the Orion Nebula fills a 5 ly view, the Ring Nebula is a
  1 ly speck. A minimum on-screen size of 22 px keeps small nebulae visible
  and selectable; the maximum is 90 % of the canvas height.
- **Image:** a pinned Wikimedia Commons file. The builder reads the licence
  from the file's `extmetadata` and accepts only public domain, CC0 and
  CC BY; any other licence aborts the build. The standard 500 px thumbnail
  (Wikimedia serves only its standard widths to external requests) is stored
  in `data/nebulae/` and embedded in `nebulae.js` as a base64 data URI so the
  map works offline. `CREDITS.md` lists every file with author, licence and
  link; the selection panel shows the same attribution.

Sprites are blended additively over the black sky with a soft circular edge,
which removes the black background of the source images. The **Nebulae** layer
hides them all.

### Astrometry and coordinates

Gaia DR3 astrometry is accepted only when the parallax is positive,
`parallax_over_error >= 10`, RUWE is absent or at most 1.4, and the duplicate
source flag is false. Otherwise the builder uses a positive SIMBAD parallax
with adequate signal-to-noise, an explicit literature distance from the
`LITERATURE_DISTANCE_PC` table (each entry carries the citation shown in the
selection panel, e.g. Sgr A\* at 8.277 kpc from the GRAVITY Collaboration 2022
S2 orbit, VY CMa at 1.20 kpc from the VLBA maser parallax of Zhang et al.
2012, V404 Cygni from its VLBI parallax), or leaves distance and coordinates
blank. A low-quality distant parallax is never inverted blindly; a literature
entry can also be forced over a formally acceptable but known-spurious
parallax (WR 104).

For an accepted parallax `p` in milliarcseconds:

```text
distance_pc = 1000 / p
distance_ly = distance_pc × 3.261563777
x = distance_ly × cos(dec) × cos(ra)
y = distance_ly × cos(dec) × sin(ra)
z = distance_ly × sin(dec)
```

The Sun-centred equatorial frame has X toward RA 0° / Dec 0°, Y toward
RA 90° / Dec 0°, and Z toward Dec +90°. The snapshot also stores spherical
`r`, `phi = RA` and `theta = 90° − Dec`.

## Rebuilding the data

Python 3.10 or later; standard library only.

```powershell
python scripts/build_catalog.py
python scripts/build_nebulae.py
```

`build_catalog.py` reads the current WGSN and VizieR Bright Star tables (TAP
with automatic fallback to the classic ASU service), adds every SIMBAD `NAME`
star, resolves and deduplicates in SIMBAD, collects all alternate identifiers,
then queries Gaia DR3 by resolved source ID. The remote services are live
dependencies; a later rebuild may produce a different snapshot. Generation
time, selection constants, endpoints, row counts, coordinate frame and
distance policy are recorded in `data/catalog-metadata.json`. `--skip-gaia`
performs a fast diagnostic rebuild from SIMBAD astrometry only; `--output`
selects another data directory.

`build_nebulae.py` queries SIMBAD and the Commons API with a descriptive
User-Agent, pauses between downloads, honours `Retry-After`, and skips files
already present in `data/nebulae/`. Options: `--refresh` re-downloads images;
`--offline` rebuilds `nebulae.js`, `nebulae.csv` and `CREDITS.md` from the
cached `sources.json` and images without network access; `--width` selects
another standard thumbnail width; `--output`, `--images` and `--credits`
override the destinations.

## Verification

```powershell
node tests/catalog.test.js
node tests/pwa.test.js
```

The catalog test validates `data/stars.js`, `data/nebulae.js`,
`data/star-types.js` and `CREDITS.md`: finite coordinates consistent with the
stored distances, known categories and localities, required objects, cited
distances, allowed image licences and complete attribution. The PWA test
validates the manifest, the icons, the page head and the service worker's
precache list. A headless-Chromium recipe for visual and touch verification is
kept in `.claude/skills/verify/`.

## Sources and cautions

- [IAU/WGSN Catalog of Star Names](https://exopla.net/star-names/modern-iau-star-names/)
- [SIMBAD astronomical database](https://simbad.cds.unistra.fr/simbad/)
- [Gaia DR3 archive and documentation](https://gea.esac.esa.int/archive/documentation/GDR3/)
- [VizieR Bright Star Catalogue V/50](https://vizier.cds.unistra.fr/viz-bin/VizieR?-source=V/50/catalog)
- [Wikimedia Commons](https://commons.wikimedia.org/) for nebula imagery
  (per-file credits in `CREDITS.md`); NASA/ESA/STScI, ESO, ESA/Webb and
  NOIRLab images are used under their public-domain or CC BY terms.
- Literature distances are cited per object in `data/stars.csv` (`notes`)
  and `data/nebulae.csv` (`distance_source`, `distance_bibcode`).

"Best-known" is a documented selection policy, not an astronomical class.
Gaia, SIMBAD and WGSN have different purposes and update schedules. Multiple
systems, saturated bright stars, variables, crowded fields and distant
supergiants are especially likely to need component-level or literature
review. Several famous distances remain contested (Mu Cephei, Rho Cas,
HR 5171 A, Tycho's remnant, the dispersion-measure distance of PSR B1919+21);
they are included with the `uncertain_literature_distance` flag and the
competing values in their notes rather than omitted or presented as settled.
The quality and provenance columns are part of the result, not optional notes.

## Versioning

The application carries a two-part version number, major.minor, declared as
the global `window.STAR_MAP_VERSION` at the top of `app.js` and shown dimly as
`V1.0` in the lower-right corner of the map. The minor number is raised for
new features and visible changes in behaviour; the major number is raised for
changes that alter data formats, the coordinate frame or established
behaviour. Patch levels are not used. The data snapshot has its own date in
`data/catalog-metadata.json`, and the offline cache has its own
`CACHE_VERSION` in `sw.js`; neither is tied to the application version.
`node tests/pwa.test.js` checks that the declaration, the footer element and
this file agree.

| Version | Date | Content |
| --- | --- | --- |
| V1.0 | 2026-10-19 | First numbered version: observation mode, contact lines, display settings, nearest-stars list, touch input, installable web app with offline cache, black-hole icon. |

## Licence

Code and data tables are released under the MIT licence (see `LICENSE`).
Nebula images retain their individual licences listed in `CREDITS.md`.
