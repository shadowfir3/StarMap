# Solar Neighborhood Star Map

A dependency-free, static WebGL star map with Sol at the origin. The default
view is an isometric 15-light-year visibility sphere over a 10-light-year
reference grid. The browser renders a checked-in catalog snapshot; the Python
builders make that snapshot reproducible from astronomical source services.

Besides ~3,150 positioned stars the map carries a curated set of famous
objects — Sagittarius A\*, VY Canis Majoris, Cygnus X-1 and the Gaia black
holes, the Crab and Vela pulsars, Kepler exoplanet hosts — and 56 nebulae and
supernova remnants that are drawn as their actual telescope images (public
domain / CC BY files from Wikimedia Commons) scaled to their physical size.

## Run the map

Open `index.html` directly, or serve the directory locally:

```powershell
python -m http.server 8000
```

Then visit `http://localhost:8000`. The map is designed for a 1600 × 850
viewport and adapts down to the available browser size. Use **Fullscreen** for
the entire display.

Controls:

- Mouse drag: rotate the isometric view.
- Mouse wheel: change both map scale and the spherical visibility cutoff. The
  grid adapts through 1, 5, 10, 50, and 100 ly intervals.
- Hold `Shift` and drag: move the view center along the X/Y reference plane.
- Hold `W`, `A`, `S`, or `D`: continuously move the view center along that
  plane, relative to the current camera direction. `Q` moves below the plane
  and `E` moves above it.
- Hover within 14 pixels of a star (or anywhere over a nebula sprite): change
  the pointer to a targeting reticle.
- Click a star or nebula: show its name, type, distance, Cartesian position
  and **locality** (host galaxy: "Milky Way" for almost everything, "Large
  Magellanic Cloud" for R136a1, WOH G64, S Doradus, the Tarantula Nebula and
  SN 1987A) in the upper-left panel. Nebulae also show their image with the
  author, licence and a link to the Wikimedia Commons file page, plus the
  physical extent and the literature source of the adopted distance. Stars
  positioned by a literature distance show the citation the same way. Stars
  win over nebulae when both are within the pick radius.
- Double-click a star or nebula: select it and center the view on its 3D
  position.
- Search: autocomplete Sol, a positioned star or nebula name (including
  Messier/NGC aliases), or an identifier, then center it in a five-light-year
  view.
- Layers: independently show or hide red, yellow, and other main-sequence stars;
  white dwarfs; neutron stars/pulsars; black holes; giants/supergiants; brown
  dwarfs; uncategorized objects; and the imaged nebulae & remnants. All layers
  start enabled.
- `R`: restore Sol, the 15 ly range, and the initial rotation.
- `F`: enter or leave fullscreen mode.
- `Space` or the **Observe** button: toggle observation mode.

Observation mode switches to a first-person view of the sky from the focused
star (the one centered by double-click, search, or reset; Sol on start). The
star is treated as a point in space, so nothing is occluded. Instead of the
planar reference grid, the blue grid is projected as a sky globe divided into
45° azimuth/altitude sectors in the same equatorial frame. Dragging pans the
viewing direction only; the direction starts at the coordinate system's north
(azimuth 0° toward RA 0h, altitude 0°) and is remembered when switching between
map and observation mode. Both switches are animated like double-click
navigation. The visibility-sphere panel swaps its scale bar for a slider (the
mouse wheel works too) that sets the maximum visibility distance; stars beyond
75 % of that distance fade out progressively until they vanish at the limit.
Double-clicking a star in observation mode moves the observer to that star.

The gear menu controls display emphasis without changing catalog data:

- **Grid:** off, the original light grid, or a prominent neon-blue grid.
- **Grid normals:** off, light, or prominent spectral-color height lines.
- **Contact lines:** off, normal (the default), or prominent. Contact lines
  are drawn flat on the Z=0 grid plane: from the focused star's foot point —
  where its perpendicular meets the plane — one line runs to the foot point
  of every other visible star, each line in that star's spectral color. If
  the focused star sits off the plane, its own perpendicular is drawn first,
  in its spectral color, so the star stays connected to its planar fan even
  when grid normals are off. The focused star is the one centered by
  double-click, search, or reset (Sol on start); single-clicking a star only
  shows its details and does not move the contact lines.
- **Star size:** normal, large (the default), or accurate. Accurate uses a compressed
  logarithmic visual-luminosity scale derived from apparent magnitude and
  distance; stars without the required photometry use a neutral fallback size.
- **Sol indicator:** when enabled, a selected star gets a gold direction line
  toward Sol with its Sun distance labelled in light-years.
- **Cropping sphere:** show or hide the wireframe visibility boundary without
  changing the active spherical star cutoff.

The circular **i** beside the selected object's type opens a compact, offline
description of that stellar family or nebula class. These summaries are locally
stored paraphrases of the linked English Wikipedia articles (stellar families
retrieved 2026-07-11, nebula classes 2026-08-26); the popup keeps the exact
catalog code visible and links to the source article for more detail.

The wire sphere is the active three-dimensional crop boundary. Spectral-color
drop lines show each star's perpendicular offset from the Z=0 plane. This is the
equatorial plane implied by the requested ICRS axes; it is a visual reference
plane, not the Milky Way's physical galactic plane.

## Catalog selection and row semantics

`data/stars.csv` is the auditable table. `data/stars.js` contains the same
positioned rows in a compact browser-ready form and works from `file://` without
fetch/CORS restrictions.

“SIMBAD named” means a stellar SIMBAD object with at least one identifier whose
literal prefix is `NAME `. SIMBAD pads identifiers internally (`HD  95735`,
`Wolf   28`); all identifier matching in the builder is whitespace-insensitive. Every such object is retained in the CSV, including
entries with missing coordinates or no defensible distance. Only the subset
with finite, quality-accepted 3D coordinates is emitted to `stars.js`; this
keeps the map truthful and lets a later rebuild place an object automatically
when its source astrometry improves.

The candidate union is:

1. Every star in the current IAU/WGSN Catalog of Star Names.
2. Every SIMBAD stellar object with at least one identifier beginning `NAME `.
3. Bright Star Catalogue V/50 stars with Johnson V magnitude below 4.0,
   resolved to SIMBAD by HR identifier.
4. Stellar SIMBAD objects whose catalog parallax places them within 50 ly.
5. The explicit famous-object list `CURATED` in `scripts/build_catalog.py`:
   the Galactic-centre black hole Sagittarius A\* with the star S2 and the
   Pistol Star; hypergiants such as VY Canis Majoris, NML Cygni, Westerlund 1-26,
   RW/VV Cephei, Rho Cassiopeiae, HR 5171 A, V838 Monocerotis, WR 104/124 and
   the LMC members WOH G64 and S Doradus; stellar-mass black holes (Cygnus X-1,
   V404 Cygni, Gaia BH1–BH3, SS 433, V4641 Sgr, A0620-00, GRS 1915+105,
   MAXI J1820+070); pulsars (Crab, Vela, Geminga, PSR B1919+21, PSR J0437-4715);
   and exoplanet hosts / nearby classics (Kepler-186/452/22/90, HD 209458,
   the Methuselah star HD 140283, T CrB, RR Lyrae, Wolf 359, Gliese 581,
   Lalande 21185, Kapteyn's, Luyten's, Teegarden's and Van Maanen's stars,
   WISE 0855−0714). Curated labels take precedence over SIMBAD `NAME`
   identifiers but never over an official IAU name (Mu Cephei therefore
   appears as "Garnet Star", T CrB as "Blaze Star").

Resolved rows are deduplicated by SIMBAD `oid`, never by display name. A row represents
the SIMBAD object that was resolved: a component stays a component, while an
unresolved system stays a system. Non-stellar objects such as exoplanets are
excluded by requiring stellar membership in SIMBAD's object-type hierarchy.
Every current WGSN entry is retained even if it cannot be uniquely resolved in
SIMBAD; those rows have WGSN coordinates but no invented distance. Stephenson
2-18 is retained as a clearly marked literature-only exception because a unique
SIMBAD object could not be resolved under that popular name.

Display names use official IAU name, curated common label, `NAME` identifier,
Bayer designation, Flamsteed designation, HD, HIP, Gaia DR3, then SIMBAD main ID.
The CSV retains every SIMBAD identifier so the choice can be audited.
`stellar_category` is derived reproducibly from SIMBAD object type and the
primary component of the spectral type (a companion's `+B2V` no longer turns
Antares into a dwarf, and legacy `dM6` notation is a red dwarf, not a white
dwarf). SIMBAD types black holes as X-ray or spectroscopic binaries, so the
black-hole layer is populated by the explicit `CATEGORY_OVERRIDES` table.
“Main-sequence star” is the English term for German *Hauptreihenstern*; red
and yellow dwarfs are exposed as useful sublayers of that broader class.

`locality` names the host galaxy. It defaults to "Milky Way", is curated for
known Large Magellanic Cloud members, and any positioned row beyond 100,000 ly
without a curated host is flagged rather than silently called Galactic.

## Nebulae and supernova remnants

`data/nebulae.js` (browser payload) and `data/nebulae.csv` (audit table) hold
56 imaged objects: H II regions, planetary nebulae, supernova remnants,
reflection and dark nebulae, two protoplanetary nebulae and the Homunculus.
They are curated in `NEBULAE` in `scripts/build_nebulae.py` with, per object:

- **Position** from the SIMBAD basic table for the pinned identifier
  (curated coordinates only for the Pillars of Creation, which SIMBAD does
  not list separately).
- **Distance** as an explicit literature value with plus/minus error, the
  citation and ADS bibcode, and a quality flag using the same vocabulary as
  the stars (`literature_distance`, `uncertain_literature_distance`,
  `host_system_distance`). Typical sources are Gaia parallaxes of the
  ionizing stars or planetary-nebula central stars (Kuhn et al. 2019, Zucker
  et al. 2020, Bailer-Jones et al. 2021, Chornay & Walton 2021), VLBI maser
  parallaxes, expansion parallaxes, and the LMC eclipsing-binary distance.
  Objects whose distance is not defensibly known (Boomerang, Stingray, Egg,
  Necklace nebulae, the Gum Nebula) are deliberately left out.
- **Extent** as an apparent size in arcminutes; the sprite is drawn
  `2 · d · tan(θ/2)` light-years across, so the Orion Nebula fills a 5 ly view
  while the Ring Nebula is a 1 ly speck. A minimum on-screen size keeps small
  nebulae visible and clickable. In observation mode the sprite is scaled to
  its apparent angular size from the observer's star instead.
- **Image**: a pinned Wikimedia Commons file. The builder reads the licence
  from the file's `extmetadata` at build time and accepts only public domain,
  CC0 and CC BY; anything else aborts the build. The standard 500 px
  thumbnail is downloaded (Wikimedia serves only its standard widths to
  external requests), kept in `data/nebulae/` for auditing, and embedded in
  `nebulae.js` as a base64 data URI so the map works offline and from
  `file://`. `CREDITS.md` lists every file with author, licence and link; the
  same attribution is shown in the selection panel.

Nebula sprites are blended additively over the black sky with a soft circular
edge, so the black background of the source images disappears. The
`nebula` layer switch hides them all.

## Rebuild the data

Python 3.10+ is enough; the builders have no third-party packages.

```powershell
python scripts/build_catalog.py
python scripts/build_nebulae.py
```

`build_catalog.py` reads the current WGSN and VizieR Bright Star tables (the
TAP service with an automatic fallback to the classic ASU service), adds every
SIMBAD `NAME` star, resolves/deduplicates in SIMBAD, collects all alternate
identifiers, then queries Gaia DR3 by resolved source ID. Remote catalog
services are live dependencies, so a later rebuild may produce a different
snapshot. The exact generation time, selection constants, source endpoints,
row counts, coordinate frame, and distance policy are recorded in
`data/catalog-metadata.json`.

`build_nebulae.py` queries SIMBAD and the Commons API with a descriptive
User-Agent, pauses between downloads and honours `Retry-After`, and skips
files already present in `data/nebulae/` (`--refresh` re-downloads them).
`--offline` rebuilds `nebulae.js`, `nebulae.csv` and `CREDITS.md` from the
cached `data/nebulae/sources.json` and images without any network access;
`--width` selects another standard thumbnail width.

For a fast diagnostic rebuild that uses SIMBAD astrometry only:

```powershell
python scripts/build_catalog.py --skip-gaia
```

## Astrometry and coordinates

Gaia DR3 astrometry is accepted only when parallax is positive,
`parallax_over_error >= 10`, RUWE is absent or at most 1.4, and the duplicate
source flag is false. Otherwise the builder uses a positive SIMBAD parallax
with adequate signal-to-noise, an explicit literature distance from the
`LITERATURE_DISTANCE_PC` table (each entry carries its citation, which the
map shows in the selection panel — e.g. Sgr A\* at 8.277 kpc from the GRAVITY
Collaboration 2022 S2 orbit, VY CMa at 1.20 kpc from the VLBA maser parallax
of Zhang et al. 2012, Cygnus X-1 from Gaia, V404 Cygni from its VLBI
parallax), or leaves distance/coordinates blank. It never blindly inverts a
low-quality distant parallax; a literature entry can also be forced over a
formally acceptable but known-spurious parallax (WR 104).

For accepted parallax `p` in milliarcseconds:

```text
distance_pc = 1000 / p
distance_ly = distance_pc × 3.261563777
x = distance_ly × cos(dec) × cos(ra)
y = distance_ly × cos(dec) × sin(ra)
z = distance_ly × sin(dec)
```

The Sun-centered equatorial frame is X toward RA 0°/Dec 0°, Y toward RA
90°/Dec 0°, and Z toward Dec +90°. The snapshot also stores spherical `r`,
`phi = RA`, and `theta = 90° - Dec`.

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

“Best-known” is a documented selection policy here, not an astronomical class.
Gaia, SIMBAD, and WGSN have different purposes and update schedules. Multiple
systems, saturated bright stars, variables, crowded fields, and distant
supergiants are especially likely to need component-level or literature review.
Several famous distances remain genuinely contested (Mu Cephei, Rho Cas,
HR 5171 A, Tycho's remnant, the dispersion-measure distance of PSR B1919+21);
they are included with the `uncertain_literature_distance` flag and the
competing values in their notes rather than omitted or presented as settled.
The quality and provenance columns are part of the result, not optional notes.
