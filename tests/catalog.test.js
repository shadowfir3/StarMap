const fs = require("node:fs");
const vm = require("node:vm");
const assert = require("node:assert/strict");

const sandbox = { window: {} };
vm.runInNewContext(fs.readFileSync("data/stars.js", "utf8"), sandbox);
vm.runInNewContext(fs.readFileSync("data/star-types.js", "utf8"), sandbox);
const stars = sandbox.window.STAR_CATALOG;
const meta = sandbox.window.STAR_CATALOG_META;
const typeDescriptions = sandbox.window.STAR_TYPE_DESCRIPTIONS;
const categories = new Set(["red_dwarf", "yellow_dwarf", "other_main_sequence", "white_dwarf",
  "neutron_star", "black_hole", "giant_or_supergiant", "brown_dwarf", "other"]);

assert.ok(Array.isArray(stars) && stars.length > 400, "expected a substantial positioned catalog");
assert.equal(meta.coordinateFrame.startsWith("Sun-centered ICRS"), true);

for (const star of stars) {
  for (const key of ["x", "y", "z", "distanceLy"]) assert.equal(Number.isFinite(star[key]), true, `${star.name}: ${key}`);
  assert.ok(categories.has(star.category), `${star.name}: unknown category ${star.category}`);
  const radius = Math.hypot(star.x, star.y, star.z);
  assert.ok(Math.abs(radius - star.distanceLy) < Math.max(1e-4, star.distanceLy * 2e-6), `${star.name}: Cartesian radius mismatch`);
}

for (const required of ["Sirius", "Vega", "Betelgeuse", "Proxima Centauri", "Barnard's Star"]) {
  assert.ok(stars.some(star => star.name === required), `missing ${required}`);
}

assert.ok(stars.some(star => star.distanceLy < 15), "default sphere should contain stars");
for (const category of ["red_dwarf", "yellow_dwarf", "white_dwarf", "other_main_sequence"]) {
  assert.ok(stars.some(star => star.category === category), `missing populated layer ${category}`);
}
for (const category of categories) {
  assert.ok(typeDescriptions[category]?.summary, `missing type description ${category}`);
  assert.match(typeDescriptions[category]?.sourceUrl || "", /^https:\/\/en\.wikipedia\.org\/wiki\//, `invalid type source ${category}`);
}
console.log(`Validated ${stars.length} positioned stars.`);
