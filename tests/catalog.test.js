const fs = require("node:fs");
const vm = require("node:vm");
const assert = require("node:assert/strict");

const sandbox = { window: {} };
vm.runInNewContext(fs.readFileSync("data/stars.js", "utf8"), sandbox);
vm.runInNewContext(fs.readFileSync("data/nebulae.js", "utf8"), sandbox);
vm.runInNewContext(fs.readFileSync("data/star-types.js", "utf8"), sandbox);
const stars = sandbox.window.STAR_CATALOG;
const meta = sandbox.window.STAR_CATALOG_META;
const nebulae = sandbox.window.NEBULA_CATALOG;
const nebulaMeta = sandbox.window.NEBULA_CATALOG_META;
const typeDescriptions = sandbox.window.STAR_TYPE_DESCRIPTIONS;
const categories = new Set(["red_dwarf", "yellow_dwarf", "other_main_sequence", "white_dwarf",
  "neutron_star", "black_hole", "giant_or_supergiant", "brown_dwarf", "other"]);
const nebulaKinds = new Set(["hii", "planetary", "snr", "reflection", "dark", "protoplanetary", "lbv"]);
const allowedLicense = /^(Public domain|CC0(?: 1\.0)?|CC BY(?: \d(?:\.\d)?)?(?: [A-Za-z]+)?)$/i;

// --- stars -------------------------------------------------------------------
assert.ok(Array.isArray(stars) && stars.length > 400, "expected a substantial positioned catalog");
assert.equal(meta.coordinateFrame.startsWith("Sun-centered ICRS"), true);

for (const star of stars) {
  for (const key of ["x", "y", "z", "distanceLy"]) assert.equal(Number.isFinite(star[key]), true, `${star.name}: ${key}`);
  assert.ok(categories.has(star.category), `${star.name}: unknown category ${star.category}`);
  assert.ok(typeof star.locality === "string" && star.locality.length > 0, `${star.name}: locality missing`);
  const radius = Math.hypot(star.x, star.y, star.z);
  assert.ok(Math.abs(radius - star.distanceLy) < Math.max(1e-4, star.distanceLy * 2e-6), `${star.name}: Cartesian radius mismatch`);
  if (star.distanceLy > 100000) assert.notEqual(star.locality, "Milky Way", `${star.name}: ${star.distanceLy} ly cannot be inside the Milky Way`);
}

for (const required of ["Sirius", "Vega", "Betelgeuse", "Proxima Centauri", "Barnard's Star",
  "Sagittarius A*", "VY Canis Majoris", "Cygnus X-1", "Crab Pulsar", "Vela Pulsar", "Gaia BH1"]) {
  assert.ok(stars.some(star => star.name === required), `missing ${required}`);
}
const sgrA = stars.find(star => star.name === "Sagittarius A*");
assert.equal(sgrA.category, "black_hole");
assert.ok(Math.abs(sgrA.distanceLy - 8277 * 3.261563777) < 1, "Sgr A* should sit at the GRAVITY 2022 distance");
assert.equal(sgrA.locality, "Milky Way");
assert.ok(sgrA.distanceNote.includes("GRAVITY"), "Sgr A* should carry its distance citation");
assert.equal(stars.find(star => star.name === "Antares").category, "giant_or_supergiant", "composite spectral types classify by primary");
assert.equal(stars.find(star => star.name === "Wolf 359").category, "red_dwarf", "dM notation is not a white dwarf");
assert.equal(stars.find(star => star.name === "R136a1").locality, "Large Magellanic Cloud");

assert.ok(stars.some(star => star.distanceLy < 15), "default sphere should contain stars");
for (const category of ["red_dwarf", "yellow_dwarf", "white_dwarf", "other_main_sequence", "black_hole", "neutron_star"]) {
  assert.ok(stars.some(star => star.category === category), `missing populated layer ${category}`);
}
for (const category of categories) {
  assert.ok(typeDescriptions[category]?.summary, `missing type description ${category}`);
  assert.match(typeDescriptions[category]?.sourceUrl || "", /^https:\/\/en\.wikipedia\.org\/wiki\//, `invalid type source ${category}`);
}

// --- nebulae -------------------------------------------------------------------
assert.ok(Array.isArray(nebulae) && nebulae.length >= 40, "expected a substantial nebula catalog");
assert.equal(nebulaMeta.count, nebulae.length);
const keys = new Set();
for (const nebula of nebulae) {
  assert.ok(!keys.has(nebula.key), `${nebula.name}: duplicate key`);
  keys.add(nebula.key);
  for (const key of ["x", "y", "z", "distanceLy", "sizeLy", "sizeArcmin", "ra", "dec"]) {
    assert.equal(Number.isFinite(nebula[key]), true, `${nebula.name}: ${key}`);
  }
  assert.ok(nebula.sizeLy > 0 && nebula.sizeLy < nebula.distanceLy, `${nebula.name}: implausible extent`);
  const radius = Math.hypot(nebula.x, nebula.y, nebula.z);
  assert.ok(Math.abs(radius - nebula.distanceLy) < Math.max(1e-3, nebula.distanceLy * 2e-6), `${nebula.name}: Cartesian radius mismatch`);
  assert.ok(nebulaKinds.has(nebula.kind), `${nebula.name}: unknown kind ${nebula.kind}`);
  assert.ok(typeDescriptions[`nebula_${nebula.kind}`]?.summary, `${nebula.name}: missing type description nebula_${nebula.kind}`);
  assert.ok(nebula.distanceSource.length > 20 && /\d{4}/.test(nebula.distanceSource), `${nebula.name}: distance needs a dated citation`);
  assert.match(nebula.distanceBibcode, /^\d{4}[A-Za-z&.]+/, `${nebula.name}: bibcode`);
  assert.ok(["literature_distance", "uncertain_literature_distance", "host_system_distance"].includes(nebula.distanceQuality), `${nebula.name}: quality flag`);
  assert.ok(nebula.locality === "Milky Way" || nebula.distanceLy > 100000, `${nebula.name}: locality/distance mismatch`);
  const image = nebula.image;
  assert.ok(image?.dataUri?.startsWith("data:image/jpeg;base64,"), `${nebula.name}: embedded JPEG`);
  assert.ok(image.width > 0 && image.height > 0 && image.width <= 3840, `${nebula.name}: image dimensions`);
  assert.match(image.license, allowedLicense, `${nebula.name}: licence ${image.license} is not PD/CC0/CC BY`);
  assert.ok(image.pageUrl.startsWith("https://commons.wikimedia.org/"), `${nebula.name}: Commons page URL`);
  assert.ok((image.author || image.credit).length > 0, `${nebula.name}: attribution missing`);
}
for (const required of ["Orion Nebula", "Crab Nebula", "Eagle Nebula", "Ring Nebula", "Helix Nebula", "Carina Nebula", "Cassiopeia A", "Tarantula Nebula"]) {
  assert.ok(nebulae.some(nebula => nebula.name === required), `missing nebula ${required}`);
}
assert.equal(nebulae.find(nebula => nebula.name === "Tarantula Nebula").locality, "Large Magellanic Cloud");

const credits = fs.readFileSync("CREDITS.md", "utf8");
for (const nebula of nebulae) {
  assert.ok(credits.includes(nebula.image.file), `CREDITS.md lacks ${nebula.image.file}`);
}

// --- galaxy background -----------------------------------------------------------
vm.runInNewContext(fs.readFileSync("data/galaxy.js", "utf8"), sandbox);
const galaxy = sandbox.window.GALAXY_IMAGE;
assert.ok(galaxy?.dataUri?.startsWith("data:image/jpeg;base64,"), "galaxy: embedded JPEG");
assert.ok(galaxy.width === galaxy.height && galaxy.width >= 1920 && galaxy.width <= 4096, "galaxy: square picture between 1920 and 4096 px");
assert.match(galaxy.license, allowedLicense, `galaxy: licence ${galaxy.license} is not PD/CC0/CC BY`);
assert.ok(galaxy.pageUrl.startsWith("https://commons.wikimedia.org/"), "galaxy: Commons page URL");
assert.ok((galaxy.author || galaxy.credit).length > 0, "galaxy: attribution missing");
const calibration = galaxy.calibration;
assert.equal(calibration.width, galaxy.width, "galaxy: calibration width must match the embedded picture");
for (const key of ["lyPerPx", "sunDistanceLy", "ringSpacingPx", "ringSpacingLy"]) {
  assert.ok(Number.isFinite(calibration[key]) && calibration[key] > 0, `galaxy: calibration ${key}`);
}
assert.ok(calibration.centerPx.length === 2 && calibration.sunPx.length === 2, "galaxy: centre and Sun pixels");
const sunPx = Math.hypot(calibration.sunPx[0] - calibration.centerPx[0], calibration.sunPx[1] - calibration.centerPx[1]);
assert.ok(Math.abs(sunPx * calibration.lyPerPx - calibration.sunDistanceLy) < 2, "galaxy: Sun distance inconsistent with the scale");
assert.ok(Math.abs(calibration.sunDistanceLy - sgrA.distanceLy) / sgrA.distanceLy < 0.06, "galaxy: painted Sun distance must be within 6 % of the catalog Sgr A* distance");
assert.equal(calibration.viewpoint, "north Galactic pole");
assert.ok(credits.includes(galaxy.file), "CREDITS.md lacks the galaxy picture");

console.log(`Validated ${stars.length} positioned stars, ${nebulae.length} imaged nebulae and the ${galaxy.width} px galaxy picture.`);
