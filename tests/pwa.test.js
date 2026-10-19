const fs = require("node:fs");
const vm = require("node:vm");
const assert = require("node:assert/strict");

function pngSize(file) {
  const bytes = fs.readFileSync(file);
  assert.equal(bytes.toString("latin1", 1, 4), "PNG", `${file}: not a PNG`);
  return `${bytes.readUInt32BE(16)}x${bytes.readUInt32BE(20)}`;
}

// --- manifest ------------------------------------------------------------------
const manifest = JSON.parse(fs.readFileSync("manifest.json", "utf8"));
assert.ok(manifest.name && manifest.short_name, "manifest needs name and short_name");
assert.equal(manifest.display, "standalone");
assert.equal(manifest.start_url, "./");
assert.equal(manifest.scope, "./");
assert.match(manifest.theme_color, /^#[0-9a-f]{6}$/i);
assert.match(manifest.background_color, /^#[0-9a-f]{6}$/i);
const iconSizes = new Set();
for (const icon of manifest.icons) {
  assert.ok(fs.existsSync(icon.src), `manifest icon ${icon.src} is missing`);
  assert.equal(pngSize(icon.src), icon.sizes, `${icon.src}: declared size differs from the file`);
  assert.equal(icon.type, "image/png");
  iconSizes.add(icon.sizes);
}
assert.ok(iconSizes.has("192x192") && iconSizes.has("512x512"), "Chrome requires 192 and 512 px icons");

// --- page head ------------------------------------------------------------------
const html = fs.readFileSync("index.html", "utf8");
assert.match(html, /<link rel="manifest" href="manifest\.json">/);
assert.match(html, /viewport-fit=cover/);
assert.match(html, /<meta name="apple-mobile-web-app-capable" content="yes">/);
assert.match(html, /<meta name="mobile-web-app-capable" content="yes">/);
const touchIcon = html.match(/<link rel="apple-touch-icon" href="([^"]+)">/);
assert.ok(touchIcon, "apple-touch-icon link missing");
assert.equal(pngSize(touchIcon[1]), "180x180");
assert.match(html, /<meta name="theme-color" content="#03070d">/);
assert.ok(html.includes("<script src=\"app.js\"></script>"));

// --- service worker -------------------------------------------------------------
const sw = fs.readFileSync("sw.js", "utf8");
const sandbox = { self: { addEventListener() {} } };
const { precache, version } = vm.runInNewContext(`${sw}\n;({ precache: PRECACHE_URLS, version: CACHE_VERSION })`, sandbox);
assert.ok(Array.isArray(precache) && precache.length > 5, "precache list missing");
assert.match(version, /^starmap-\d{4}-\d{2}-\d{2}/, "cache version should be dated");
for (const url of precache) {
  assert.ok(!url.startsWith("/") && !/^[a-z]+:/.test(url), `${url}: precache entries must be relative`);
  const file = url === "./" ? "index.html" : url;
  assert.ok(fs.existsSync(file), `precached file ${file} is missing`);
}
const referenced = [...html.matchAll(/<(?:script src|link rel="stylesheet" href)="([^"]+)"/g)].map(match => match[1]);
for (const file of referenced) assert.ok(precache.includes(file), `${file} is loaded by index.html but not precached`);
assert.ok(precache.includes("./") && precache.includes("index.html") && precache.includes("manifest.json"));
assert.ok(precache.includes(touchIcon[1]) && manifest.icons.every(icon => precache.includes(icon.src)), "icons must be precached");

// app.js registers the worker only over http(s), so file:// keeps working
const app = fs.readFileSync("app.js", "utf8");
assert.ok(app.includes('navigator.serviceWorker.register("sw.js")'), "app.js must register sw.js");
assert.ok(app.includes("location.protocol"), "registration must be guarded by protocol");

// --- application version ----------------------------------------------------------
const appVersion = app.match(/^window\.STAR_MAP_VERSION = "(\d+\.\d+)";$/m);
assert.ok(appVersion, "app.js must declare window.STAR_MAP_VERSION as major.minor at top level");
assert.ok(html.includes('<span id="app-version"'), "index.html must carry the #app-version element");
const readme = fs.readFileSync("README.md", "utf8");
assert.ok(readme.includes(`V${appVersion[1]}`), `README.md must mention the current version V${appVersion[1]}`);

console.log(`Validated manifest (${manifest.icons.length} icons), page head, service worker (${precache.length} precached files, ${version}) and app version V${appVersion[1]}.`);
