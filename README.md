# Solar Neighborhood Star Map

A dependency-free, static WebGL star map with Sol at the origin. The default
view is an isometric 15-light-year visibility sphere over a 10-light-year
reference grid. The browser renders a checked-in catalog snapshot; the Python
builder makes that snapshot reproducible from astronomical source services.

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
- Hold `Space` and drag: move the view center along the X/Y reference plane.
- Hold `W`, `A`, `S`, or `D`: continuously move the view center along that
  plane, relative to the current camera direction. `Q` moves below the plane
  and `E` moves above it.
- Hover within 14 pixels of a star: change the pointer to a targeting reticle.
- Click within 14 pixels of a star: show its name, spectral type, distance, and
  Cartesian position in the upper-left panel.
- Double-click a star: select it and center the view on its 3D position.
- Search: autocomplete Sol, a positioned star name, or an identifier, then
  center it in a five-light-year view.
- Layers: independently show or hide red, yellow, and other main-sequence stars;
  white dwarfs; neutron stars/pulsars; black holes; giants/supergiants; brown
  dwarfs; and uncategorized objects. All layers start enabled.
- `R`: restore Sol, the 15 ly range, and the initial rotation.
- `F`: enter or leave fullscreen mode.

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

The circular **i** beside the selected object's spectral type opens a compact,
offline description of that stellar family. These summaries are locally stored
paraphrases of the linked English Wikipedia articles, retrieved on 2026-07-11;
the popup keeps the exact catalog spectral code visible and links to the source
article for more detail.

The wire sphere is the active three-dimensional crop boundary. Spectral-color
drop lines show each star's perpendicular offset from the Z=0 plane. This is the
equatorial plane implied by the requested ICRS axes; it is a visual reference
plane, not the Milky Way's physical galactic plane.

## Catalog selection and row semantics

`data/stars.csv` is the auditable table. `data/stars.js` contains the same
positioned rows in a compact browser-ready form and works from `file://` without
fetch/CORS restrictions.

“SIMBAD named” means a stellar SIMBAD object with at least one identifier whose
literal prefix is `NAME `. Every such object is retained in the CSV, including
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
5. The explicit famous-star list in `scripts/build_catalog.py`.

Resolved rows are deduplicated by SIMBAD `oid`, never by display name. A row represents
the SIMBAD object that was resolved: a component stays a component, while an
unresolved system stays a system. Non-stellar objects such as exoplanets are
excluded by requiring stellar membership in SIMBAD's object-type hierarchy.
Every current WGSN entry is retained even if it cannot be uniquely resolved in
SIMBAD; those rows have WGSN coordinates but no invented distance. Stephenson
2-18 is retained as a clearly marked literature-only exception because a unique
SIMBAD object could not be resolved under that popular name.

Display names use official IAU name, `NAME` identifier, curated common label,
Bayer designation, Flamsteed designation, HD, HIP, Gaia DR3, then SIMBAD main ID.
The CSV retains every SIMBAD identifier so the choice can be audited.
`stellar_category` is derived reproducibly from SIMBAD object type and spectral
type. “Main-sequence star” is the English term for German *Hauptreihenstern*;
red and yellow dwarfs are exposed as useful sublayers of that broader class.

## Rebuild the data

Python 3.10+ is enough; the builder has no third-party packages.

```powershell
python scripts/build_catalog.py
```

The command reads the current WGSN and VizieR Bright Star tables, adds every
SIMBAD `NAME` star, resolves/deduplicates in SIMBAD,
collects all alternate identifiers, then queries Gaia DR3 by resolved source ID.
Remote catalog services are live dependencies, so a later rebuild may produce
a different snapshot. The exact generation time, selection constants, source
endpoints, row counts, coordinate frame, and distance policy are recorded in
`data/catalog-metadata.json`.

For a fast diagnostic rebuild that uses SIMBAD astrometry only:

```powershell
python scripts/build_catalog.py --skip-gaia
```

## Astrometry and coordinates

Gaia DR3 astrometry is accepted only when parallax is positive,
`parallax_over_error >= 10`, RUWE is absent or at most 1.4, and the duplicate
source flag is false. Otherwise the builder uses a positive SIMBAD parallax
with adequate signal-to-noise, an explicit literature distance for a few
distant curated objects, or leaves distance/coordinates blank. It never blindly
inverts a low-quality distant parallax.

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

“Best-known” is a documented selection policy here, not an astronomical class.
Gaia, SIMBAD, and WGSN have different purposes and update schedules. Multiple
systems, saturated bright stars, variables, crowded fields, and distant
supergiants are especially likely to need component-level or literature review.
The quality and provenance columns are part of the result, not optional notes.
