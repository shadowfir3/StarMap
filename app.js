// Application version, major.minor only.  Raise the minor number for new
// features and the major number for changes that alter data formats, the
// coordinate frame or established behaviour.  Shown in the lower-right corner.
window.STAR_MAP_VERSION = "1.0";

(() => {
  "use strict";

  const APP_VERSION = window.STAR_MAP_VERSION;
  const canvas = document.querySelector("#star-map");
  const viewport = document.querySelector("#viewport");
  const gl = canvas.getContext("webgl", { alpha: false, antialias: true });
  const stars = Array.isArray(window.STAR_CATALOG) ? window.STAR_CATALOG : [];
  const meta = window.STAR_CATALOG_META || {};
  const typeDescriptions = window.STAR_TYPE_DESCRIPTIONS || {};
  const NEBULA_COLOR = [0.85, 0.6, 1];
  const NEBULA_MIN_HALF_PX = 11;
  const nebulae = (Array.isArray(window.NEBULA_CATALOG) ? window.NEBULA_CATALOG : []).map(item => Object.assign(item, {
    category:"nebula", isNebula:true, spectralType:"", fameScore:120, typeKey:`nebula_${item.kind}`, screen:null,
  }));
  const solSearchObject = Object.freeze({
    name:"Sol", simbadId:"Solar System origin", hipId:"", hdId:"", gaiaId:"",
    x:0, y:0, z:0, distanceLy:0, spectralType:"G2V", category:"yellow_dwarf",
    fameScore:1000, isSol:true,
  });
  const PICK_RADIUS_PX = 14;
  const NAVIGATION_DURATION_MS = 440;
  const DEFAULT = Object.freeze({ radius: 15, yaw: Math.PI / 4, pitch: Math.atan(1 / Math.sqrt(2)), target: [0, 0, 0] });
  const OBSERVE_FOV = Math.PI / 3;
  const OBSERVE_START_FOV = 0.06; // narrow enough to approximate the orthographic map view
  const OBSERVE_MIN_RANGE = 1;
  const OBSERVE_MAX_RANGE = 50000;
  const OBSERVE_SLIDER_STEPS = 200;

  const ui = {
    name: document.querySelector("#star-name"), type: document.querySelector("#star-type"),
    distance: document.querySelector("#star-distance"), position: document.querySelector("#star-position"),
    source: document.querySelector("#star-source"), range: document.querySelector("#range-value"),
    locality: document.querySelector("#star-locality"), image: document.querySelector("#object-image"),
    imageImg: document.querySelector("#object-image-img"), imageCredit: document.querySelector("#object-image-credit"),
    typeInfoEyebrow: document.querySelector("#type-info-eyebrow"),
    visible: document.querySelector("#visible-count"), grid: document.querySelector("#grid-value"), fill: document.querySelector("#scale-fill"),
    labels: document.querySelector("#labels"), summary: document.querySelector("#catalog-summary"),
    error: document.querySelector("#error-message"), version: document.querySelector("#app-version"),
    scalePanel: document.querySelector("#scale-panel"), titleBlock: document.querySelector("#title-block"),
    starList: document.querySelector("#star-list"), starListToggle: document.querySelector("#star-list-toggle"),
    starListBody: document.querySelector("#star-list-body"), starListCaption: document.querySelector("#star-list-caption"),
    starListRows: document.querySelector("#star-list-rows"),
    searchButton: document.querySelector("#search-button"), searchPanel: document.querySelector("#search-panel"),
    searchInput: document.querySelector("#star-search"), searchResults: document.querySelector("#search-results"),
    layersButton: document.querySelector("#layers-button"), layersPanel: document.querySelector("#layers-panel"),
    settingsButton: document.querySelector("#settings-button"), settingsPanel: document.querySelector("#settings-panel"),
    identity: document.querySelector("#identity"), typeInfoButton: document.querySelector("#type-info-button"),
    typeInfoPopup: document.querySelector("#type-info-popup"), typeInfoClose: document.querySelector("#type-info-close"),
    typeInfoTitle: document.querySelector("#type-info-title"), typeInfoCode: document.querySelector("#type-info-code"),
    typeInfoSummary: document.querySelector("#type-info-summary"), typeInfoFacts: document.querySelector("#type-info-facts"),
    typeInfoSources: document.querySelector("#type-info-sources"),
    observeButton: document.querySelector("#observe-button"), visibilitySlider: document.querySelector("#visibility-slider"),
  };

  ui.version.textContent = `V${APP_VERSION}`;
  if (!gl) {
    ui.error.hidden = false;
    ui.error.textContent = "WebGL is unavailable. Enable hardware acceleration or use a WebGL-capable browser.";
    return;
  }

  let radius = DEFAULT.radius;
  let yaw = DEFAULT.yaw;
  let pitch = DEFAULT.pitch;
  let target = [...DEFAULT.target];
  let selected = null;
  let focused = null;
  let hovered = null;
  const activePointers = new Map(); // pointerId -> current client position
  let gesture = null; // { kind: "drag" | "pinch" | "idle", ... }
  let lastPointerType = "mouse";
  let lastTap = null;
  let starListOpen = false; // the nearest-stars panel computes nothing while collapsed
  let starListKey = "";
  const STAR_LIST_ROW_PX = 23;
  const STAR_LIST_MAX = 20;
  let viewProjection = new Float32Array(16);
  let mode = "map";
  let observeBlend = 0;
  let observeYaw = 0; // azimuth 0 = +X (RA 0h), the coordinate system's north
  let observePitch = 0;
  let observerStar = null; // null = observing from Sol
  let observerPos = [0, 0, 0];
  let observeRange = null;
  let blendStartTarget = [...DEFAULT.target];
  let blendFrame = 0;
  let solDrawAlpha = 1;
  let visibleStars = [];
  let visibleNebulae = [];
  let needsRender = true;
  let searchMatches = [];
  let activeSearchIndex = -1;
  let currentTypeContext = { category:"yellow_dwarf", code:"G2V" };
  const displaySettings = { grid:"light", normals:"light", contactLines:"normal", starSize:"large", solIndicator:true, cropSphere:true };
  const movementKeys = new Set();
  let movementFrame = 0;
  let lastMovementTime = 0;
  let navigationFrame = 0;
  const layerCheckboxes = [...document.querySelectorAll("#layers-panel input[data-category]")];
  const enabledCategories = new Set(layerCheckboxes.map(input => input.dataset.category));

  const vertexShader = `
    attribute vec3 a_position;
    attribute vec4 a_color;
    attribute float a_size;
    uniform mat4 u_matrix;
    uniform float u_pixelRatio;
    varying vec4 v_color;
    void main() {
      gl_Position = u_matrix * vec4(a_position, 1.0);
      gl_PointSize = a_size * u_pixelRatio;
      v_color = a_color;
    }
  `;
  const fragmentShader = `
    precision mediump float;
    uniform bool u_points;
    uniform int u_style; // 0 = star: bright core and halo; 1 = black hole: dark disc inside a bright ring
    varying vec4 v_color;
    void main() {
      if (!u_points) { gl_FragColor = v_color; return; }
      vec2 p = gl_PointCoord * 2.0 - 1.0;
      float d = dot(p, p);
      if (d > 1.0) discard;
      if (u_style == 1) {
        float r = sqrt(d);
        float disc = 1.0 - smoothstep(0.36, 0.44, r);
        float ring = smoothstep(0.38, 0.47, r) * (1.0 - smoothstep(0.56, 0.70, r));
        float glow = (1.0 - smoothstep(0.55, 1.0, r)) * 0.3 * (1.0 - disc);
        float beaming = 0.7 + 0.5 * clamp(-0.8 * p.x - 0.5 * p.y, -1.0, 1.0); // one side of the ring is brighter
        float weight = disc + ring + glow;
        vec3 color = (v_color.rgb * (1.1 + 0.7 * beaming) * ring + v_color.rgb * 0.5 * glow) / max(weight, 1e-3);
        gl_FragColor = vec4(color, min(1.0, weight) * v_color.a);
        return;
      }
      float core = 1.0 - smoothstep(0.02, 0.28, d);
      float halo = 1.0 - smoothstep(0.15, 1.0, d);
      gl_FragColor = vec4(v_color.rgb * (0.85 + core * 1.7), v_color.a * (halo * 0.72 + core));
    }
  `;

  function compile(type, source) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader));
    return shader;
  }

  const program = gl.createProgram();
  gl.attachShader(program, compile(gl.VERTEX_SHADER, vertexShader));
  gl.attachShader(program, compile(gl.FRAGMENT_SHADER, fragmentShader));
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program));
  const locations = {
    position: gl.getAttribLocation(program, "a_position"), color: gl.getAttribLocation(program, "a_color"),
    size: gl.getAttribLocation(program, "a_size"), matrix: gl.getUniformLocation(program, "u_matrix"),
    pixelRatio: gl.getUniformLocation(program, "u_pixelRatio"), points: gl.getUniformLocation(program, "u_points"),
    style: gl.getUniformLocation(program, "u_style"),
  };
  const buffers = { position: gl.createBuffer(), color: gl.createBuffer(), size: gl.createBuffer() };

  // Nebulae are drawn as screen-aligned textured quads.  The quad corners are
  // computed in normalised device coordinates on the CPU from the projected
  // centre and the desired pixel size, so the same path serves the
  // orthographic map and the perspective observation view.
  const spriteVertexShader = `
    attribute vec2 a_ndc;
    attribute vec2 a_uv;
    varying vec2 v_uv;
    void main() { gl_Position = vec4(a_ndc, 0.0, 1.0); v_uv = a_uv; }
  `;
  const spriteFragmentShader = `
    precision mediump float;
    uniform sampler2D u_texture;
    uniform float u_alpha;
    varying vec2 v_uv;
    void main() {
      vec4 color = texture2D(u_texture, v_uv);
      vec2 p = v_uv * 2.0 - 1.0;
      float fade = 1.0 - smoothstep(0.55, 1.0, length(p));
      float a = u_alpha * fade;
      gl_FragColor = vec4(color.rgb * a, a);
    }
  `;
  const spriteProgram = gl.createProgram();
  gl.attachShader(spriteProgram, compile(gl.VERTEX_SHADER, spriteVertexShader));
  gl.attachShader(spriteProgram, compile(gl.FRAGMENT_SHADER, spriteFragmentShader));
  gl.linkProgram(spriteProgram);
  if (!gl.getProgramParameter(spriteProgram, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(spriteProgram));
  const spriteLocations = {
    ndc: gl.getAttribLocation(spriteProgram, "a_ndc"), uv: gl.getAttribLocation(spriteProgram, "a_uv"),
    texture: gl.getUniformLocation(spriteProgram, "u_texture"), alpha: gl.getUniformLocation(spriteProgram, "u_alpha"),
  };
  const spriteBuffers = { ndc: gl.createBuffer(), uv: gl.createBuffer() };
  const spriteTextures = new Map();

  function spriteTexture(nebula) {
    let entry = spriteTextures.get(nebula);
    if (entry) return entry.ready ? entry.texture : null;
    entry = { texture: gl.createTexture(), ready: false };
    spriteTextures.set(nebula, entry);
    const image = new Image();
    image.onload = () => {
      gl.bindTexture(gl.TEXTURE_2D, entry.texture);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      entry.ready = true;
      requestRender();
    };
    image.src = nebula.image?.dataUri || "";
    return null;
  }
  nebulae.forEach(spriteTexture);

  function normalize(v) { const n = Math.hypot(...v) || 1; return v.map(x => x / n); }
  function subtract(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
  function cross(a, b) { return [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]]; }

  function lookAt(eye, center, up) {
    const z = normalize(subtract(eye, center));
    const x = normalize(cross(up, z));
    const y = cross(z, x);
    return new Float32Array([
      x[0], y[0], z[0], 0, x[1], y[1], z[1], 0, x[2], y[2], z[2], 0,
      -(x[0]*eye[0]+x[1]*eye[1]+x[2]*eye[2]),
      -(y[0]*eye[0]+y[1]*eye[1]+y[2]*eye[2]),
      -(z[0]*eye[0]+z[1]*eye[1]+z[2]*eye[2]), 1,
    ]);
  }

  function ortho(left, right, bottom, top, near, far) {
    return new Float32Array([
      2/(right-left),0,0,0, 0,2/(top-bottom),0,0, 0,0,-2/(far-near),0,
      -(right+left)/(right-left),-(top+bottom)/(top-bottom),-(far+near)/(far-near),1,
    ]);
  }

  function perspective(fovY, aspect, near, far) {
    const f = 1 / Math.tan(fovY / 2), nf = 1 / (near - far);
    return new Float32Array([
      f/aspect,0,0,0, 0,f,0,0, 0,0,(far+near)*nf,-1, 0,0,2*far*near*nf,0,
    ]);
  }

  function multiply(a, b) {
    const out = new Float32Array(16);
    for (let column = 0; column < 4; column++) for (let row = 0; row < 4; row++) {
      out[column*4+row] = a[row]*b[column*4] + a[4+row]*b[column*4+1] + a[8+row]*b[column*4+2] + a[12+row]*b[column*4+3];
    }
    return out;
  }

  function transform(matrix, point) {
    const [x, y, z] = point;
    return [
      matrix[0]*x + matrix[4]*y + matrix[8]*z + matrix[12],
      matrix[1]*x + matrix[5]*y + matrix[9]*z + matrix[13],
      matrix[2]*x + matrix[6]*y + matrix[10]*z + matrix[14],
      matrix[3]*x + matrix[7]*y + matrix[11]*z + matrix[15],
    ];
  }

  function spectralColor(type = "") {
    const letter = type.trim().toUpperCase()[0];
    return ({ O:[0.58,0.69,1], B:[0.65,0.76,1], A:[0.82,0.87,1], F:[0.96,0.95,1],
      G:[1,0.91,0.65], K:[1,0.72,0.4], M:[1,0.34,0.22], D:[1,1,1],
      L:[0.75,0.28,0.16], T:[0.55,0.32,0.48], Y:[0.48,0.28,0.38] })[letter] || [0.78,0.88,1];
  }

  const BLACK_HOLE_COLOR = [1, 0.76, 0.42]; // accretion-ring tint of the black-hole icon and its lines
  const CATEGORY_COLORS = { black_hole: BLACK_HOLE_COLOR, neutron_star: [0.78, 0.6, 1] };

  function objectColor(object) {
    if (object.isNebula) return NEBULA_COLOR;
    if (object.category === "black_hole") return BLACK_HOLE_COLOR; // SIMBAD's spectral type belongs to the companion
    if (!object.spectralType && CATEGORY_COLORS[object.category]) return CATEGORY_COLORS[object.category];
    return spectralColor(object.spectralType);
  }

  function spriteHalfSize(nebula, distanceFromObserver, blend) {
    const mapHalf = (nebula.sizeLy / 2) * (canvas.clientHeight / (2 * radius * 1.08));
    let half = mapHalf;
    if (blend > 0) {
      const fov = OBSERVE_START_FOV + (OBSERVE_FOV - OBSERVE_START_FOV) * blend;
      const focal = (canvas.clientHeight / 2) / Math.tan(fov / 2);
      const skyHalf = distanceFromObserver > 1e-6 ? ((nebula.sizeLy / 2) / distanceFromObserver) * focal : canvas.clientHeight;
      half = mapHalf * (1 - blend) + skyHalf * blend;
    }
    return Math.max(NEBULA_MIN_HALF_PX, Math.min(canvas.clientHeight * 0.45, half));
  }

  function drawSprite(nebula, screen, halfW, halfH, alpha) {
    const texture = spriteTexture(nebula);
    if (!texture) return;
    const width = canvas.clientWidth, height = canvas.clientHeight;
    const cx = screen.x / width * 2 - 1, cy = 1 - screen.y / height * 2;
    const dx = halfW / width * 2, dy = halfH / height * 2;
    gl.useProgram(spriteProgram);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.uniform1i(spriteLocations.texture, 0);
    gl.uniform1f(spriteLocations.alpha, alpha);
    bindAttribute(spriteBuffers.ndc, spriteLocations.ndc, [cx-dx,cy+dy, cx+dx,cy+dy, cx-dx,cy-dy, cx-dx,cy-dy, cx+dx,cy+dy, cx+dx,cy-dy], 2);
    bindAttribute(spriteBuffers.uv, spriteLocations.uv, [0,0, 1,0, 0,1, 0,1, 1,0, 1,1], 2);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }

  function gridStep() {
    if (radius <= 4) return 1;
    if (radius < 15) return 5;
    if (radius <= 60) return 10;
    if (radius <= 300) return 50;
    return 100;
  }

  function normalStarSize(star) {
    const magnitude = Number(star.magnitude);
    return Math.max(3.1, Math.min(10, 7.2 - (Number.isFinite(magnitude) ? magnitude * .48 : 2)));
  }

  function blackHoleSize() {
    if (displaySettings.starSize === "large") return 22;
    if (displaySettings.starSize === "accurate") return 14;
    return 17;
  }

  function starSize(star) {
    if (star.category === "black_hole") return blackHoleSize();
    const normal = normalStarSize(star);
    if (displaySettings.starSize === "large") return normal * 1.75;
    if (displaySettings.starSize !== "accurate") return normal;
    const magnitude = star.magnitude === "" ? NaN : Number(star.magnitude);
    const distancePc = Number(star.distanceLy) / 3.261563777;
    if (!Number.isFinite(magnitude) || !Number.isFinite(distancePc) || distancePc <= 0) return 3.2;
    const absoluteMagnitude = magnitude - 5 * Math.log10(distancePc / 10);
    const logVisualLuminosity = (4.83 - absoluteMagnitude) / 2.5;
    return Math.max(2.5,Math.min(28,6 + logVisualLuminosity * 2.3));
  }

  function solPointSize() {
    if (displaySettings.starSize === "large") return 18;
    if (displaySettings.starSize === "accurate") return 6;
    return 12;
  }

  function bindAttribute(buffer, location, values, size) {
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(values), gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(location);
    gl.vertexAttribPointer(location, size, gl.FLOAT, false, 0, 0);
  }

  function drawGeometry(mode, positions, colors, sizes, points = false, style = 0) {
    if (!positions.length) return;
    bindAttribute(buffers.position, locations.position, positions, 3);
    bindAttribute(buffers.color, locations.color, colors, 4);
    bindAttribute(buffers.size, locations.size, sizes || new Array(positions.length / 3).fill(1), 1);
    gl.uniform1i(locations.points, points ? 1 : 0);
    gl.uniform1i(locations.style, style);
    gl.drawArrays(mode, 0, positions.length / 3);
  }

  function line(a, b, color, positions, colors) {
    positions.push(...a, ...b); colors.push(...color, ...color);
  }

  function buildGrid(center) {
    const positions = [], colors = [];
    if (displaySettings.grid === "off") return { positions, colors };
    const step = gridStep();
    const extent = Math.ceil(radius / step + 1) * step;
    const minX = Math.floor((center[0] - extent) / step) * step;
    const maxX = Math.ceil((center[0] + extent) / step) * step;
    const minY = Math.floor((center[1] - extent) / step) * step;
    const maxY = Math.ceil((center[1] + extent) / step) * step;
    const grid = displaySettings.grid === "prominent" ? [0.05,0.72,1,0.62] : [0.22,0.55,0.68,0.12];
    for (let x = minX; x <= maxX; x += step) line([x,minY,0],[x,maxY,0],grid,positions,colors);
    for (let y = minY; y <= maxY; y += step) line([minX,y,0],[maxX,y,0],grid,positions,colors);
    return { positions, colors };
  }

  function buildSphere(center) {
    const positions = [], colors = [], segments = 96;
    if (!displaySettings.cropSphere) return { positions, colors };
    const color = [0.22, 0.64, 0.82, 0.13];
    for (let ring = 0; ring < 3; ring++) for (let i = 0; i < segments; i++) {
      const a = i / segments * Math.PI * 2, b = (i + 1) / segments * Math.PI * 2;
      const points = ring === 0 ? [[Math.cos(a),Math.sin(a),0],[Math.cos(b),Math.sin(b),0]]
        : ring === 1 ? [[Math.cos(a),0,Math.sin(a)],[Math.cos(b),0,Math.sin(b)]]
        : [[0,Math.cos(a),Math.sin(a)],[0,Math.cos(b),Math.sin(b)]];
      line(points[0].map((v,j)=>center[j]+v*radius), points[1].map((v,j)=>center[j]+v*radius), color, positions, colors);
    }
    return { positions, colors };
  }

  function buildSkyGrid(alphaScale) {
    const positions = [], colors = [];
    if (displaySettings.grid === "off" || alphaScale <= 0) return { positions, colors };
    const prominent = displaySettings.grid === "prominent";
    const base = prominent ? [0.05, 0.72, 1] : [0.24, 0.58, 0.74];
    const R = 900, segments = 96, sector = Math.PI / 4;
    const point = (azimuth, altitude) => [
      observerPos[0] + Math.cos(altitude) * Math.cos(azimuth) * R,
      observerPos[1] + Math.cos(altitude) * Math.sin(azimuth) * R,
      observerPos[2] + Math.sin(altitude) * R,
    ];
    for (let ring = -1; ring <= 1; ring++) {
      const altitude = ring * sector;
      const alpha = (ring === 0 ? (prominent ? .72 : .42) : (prominent ? .5 : .26)) * alphaScale;
      for (let i = 0; i < segments; i++) {
        line(point(i/segments*Math.PI*2, altitude), point((i+1)/segments*Math.PI*2, altitude), [...base, alpha], positions, colors);
      }
    }
    const meridianAlpha = (prominent ? .5 : .26) * alphaScale;
    for (let m = 0; m < 8; m++) {
      const azimuth = m * sector;
      for (let i = 0; i < segments / 2; i++) {
        const a = -Math.PI/2 + i/(segments/2)*Math.PI, b = -Math.PI/2 + (i+1)/(segments/2)*Math.PI;
        line(point(azimuth, a), point(azimuth, b), [...base, meridianAlpha], positions, colors);
      }
    }
    return { positions, colors };
  }

  function scaleAlpha(colors, factor) {
    if (factor < 1) for (let i = 3; i < colors.length; i += 4) colors[i] *= factor;
    return colors;
  }

  function project(point) {
    const p = transform(viewProjection, point);
    if (p[3] < 1e-6) return null;
    const nx = p[0] / p[3], ny = p[1] / p[3], nz = p[2] / p[3];
    return { x: (nx * .5 + .5) * canvas.clientWidth, y: (1 - (ny * .5 + .5)) * canvas.clientHeight, visible: nz >= -1 && nz <= 1 };
  }

  function updateLabels() {
    ui.labels.replaceChildren();
    if (selected?.isNebula && selected.screen) {
      const ring = document.createElement("span");
      ring.className = "nebula-ring";
      const diameter = selected.screen.half * 2 + 10;
      ring.style.left = `${selected.screen.x}px`; ring.style.top = `${selected.screen.y}px`;
      ring.style.width = `${diameter}px`; ring.style.height = `${diameter}px`;
      ui.labels.append(ring);
    }
    const labeled = [...visibleStars, ...visibleNebulae].filter(star => star === selected || star.fameScore >= 100)
      .sort((a,b) => (b === selected) - (a === selected) || b.fameScore - a.fameScore).slice(0, 28);
    const occupied = [];
    for (const star of labeled) {
      const screen = project([star.x, star.y, star.z]);
      if (!screen?.visible || screen.x < 0 || screen.y < 0 || screen.x > canvas.clientWidth || screen.y > canvas.clientHeight) continue;
      if (star !== selected && occupied.some(p => Math.hypot(p.x-screen.x,p.y-screen.y) < 55)) continue;
      occupied.push(screen);
      const label = document.createElement("span");
      label.className = star.isNebula ? "star-label nebula-label" : "star-label";
      label.textContent = star.name;
      const lift = star.isNebula && star.screen ? Math.min(star.screen.half, 90) * .7 : 0;
      label.style.left = `${screen.x}px`; label.style.top = `${screen.y - lift}px`;
      ui.labels.append(label);
    }
    if (displaySettings.solIndicator && selected && observeBlend === 0) {
      const distance = Number(selected.distanceLy) || Math.hypot(selected.x,selected.y,selected.z);
      if (distance > 0) {
        const fractionTowardSol = Math.min(.5,(radius * .48) / distance);
        const labelPoint = [selected.x*(1-fractionTowardSol),selected.y*(1-fractionTowardSol),selected.z*(1-fractionTowardSol)];
        const screen = project(labelPoint);
        if (screen?.visible && screen.x >= 0 && screen.y >= 0 && screen.x <= canvas.clientWidth && screen.y <= canvas.clientHeight) {
          const label = document.createElement("span");
          label.className = "sol-distance-label";
          label.textContent = `${distance.toLocaleString(undefined,{maximumFractionDigits:2})} ly to Sol`;
          label.style.left = `${screen.x}px`; label.style.top = `${screen.y}px`;
          ui.labels.append(label);
        }
      }
    }
  }

  // Nearest-stars panel: visible stars (and Sol) ordered by distance from the
  // selected object, Sol when nothing is selected.  Rows are limited to what
  // fits above the scale panel, at most STAR_LIST_MAX.
  function positionStarList() {
    if (!window.matchMedia?.("(max-width: 720px)").matches) { ui.starList.style.top = ""; return; }
    const card = ui.identity.getBoundingClientRect();
    const frame = viewport.getBoundingClientRect();
    ui.starList.style.top = `${card.bottom - frame.top + 10}px`;
  }

  function starListLimit() {
    let floor = ui.scalePanel.getBoundingClientRect().top;
    const listTop = ui.starList.getBoundingClientRect().top;
    if (ui.titleBlock.offsetParent !== null) {
      const title = ui.titleBlock.getBoundingClientRect();
      if (title.top > listTop) floor = Math.min(floor, title.top);
    }
    const start = ui.starListCaption.getBoundingClientRect().bottom;
    return Math.max(1, Math.min(STAR_LIST_MAX, Math.floor((floor - 14 - start) / STAR_LIST_ROW_PX)));
  }

  function updateStarList(force = false) {
    if (!starListOpen) return;
    const reference = selected || solSearchObject;
    const candidates = [];
    for (const star of visibleStars) {
      if (star === selected) continue;
      candidates.push({ star, distance: Math.hypot(star.x-reference.x, star.y-reference.y, star.z-reference.z) });
    }
    if (selected && solDrawAlpha > 0.02) candidates.push({ star: solSearchObject, distance: Math.hypot(reference.x, reference.y, reference.z) });
    candidates.sort((a, b) => a.distance - b.distance);
    const shown = candidates.slice(0, starListLimit());
    const key = `${reference.name}|${candidates.length}|${shown.map(item => `${item.star.name}:${item.distance.toFixed(4)}`).join("|")}`;
    if (!force && key === starListKey) return;
    starListKey = key;
    ui.starListCaption.textContent = `From ${reference.name} · ${shown.length} of ${candidates.length} visible`;
    ui.starListRows.replaceChildren(...shown.map(({ star, distance }) => {
      const row = document.createElement("tr");
      const swatchCell = document.createElement("td"); swatchCell.className = "swatch-cell";
      const dot = document.createElement("i"); dot.className = "swatch";
      const [r, g, b] = star.isSol ? [1, .84, .35] : objectColor(star);
      dot.style.color = `rgb(${Math.round(r*255)}, ${Math.round(g*255)}, ${Math.round(b*255)})`;
      swatchCell.append(dot);
      const name = document.createElement("td"); name.className = "name"; name.textContent = star.name; name.title = star.name;
      const dist = document.createElement("td"); dist.className = "dist";
      dist.textContent = `${formatLy(distance, distance < 10 ? 2 : distance < 1000 ? 1 : 0)} ly`;
      row.append(swatchCell, name, dist);
      row.addEventListener("click", () => selectStar(star.isSol ? null : star));
      row.addEventListener("dblclick", () => centerOnStar(star.isSol ? null : star, false));
      return row;
    }));
  }

  function setStarListOpen(open) {
    starListOpen = open;
    ui.starList.classList.toggle("open", open);
    ui.starListBody.hidden = !open;
    ui.starListToggle.setAttribute("aria-expanded", String(open));
    if (open) { positionStarList(); updateStarList(true); }
    else { starListKey = ""; ui.starListRows.replaceChildren(); }
  }

  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const width = Math.round(canvas.clientWidth * dpr), height = Math.round(canvas.clientHeight * dpr);
    if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
    gl.viewport(0, 0, width, height);
    return dpr;
  }

  function render() {
    needsRender = false;
    const dpr = resize();
    const aspect = canvas.clientWidth / Math.max(1, canvas.clientHeight);
    const blend = observeBlend;
    const mapAlpha = 1 - blend;
    let mapCenter = target;
    if (blend === 0) {
      const halfHeight = radius * 1.08;
      const eyeDistance = Math.max(100, radius * 4);
      const direction = [Math.cos(pitch)*Math.cos(yaw), Math.cos(pitch)*Math.sin(yaw), Math.sin(pitch)];
      const eye = target.map((value, i) => value + direction[i] * eyeDistance);
      viewProjection = multiply(ortho(-halfHeight*aspect,halfHeight*aspect,-halfHeight,halfHeight,-eyeDistance*2,eyeDistance*2), lookAt(eye,target,[0,0,1]));
    } else {
      const fov = OBSERVE_START_FOV + (OBSERVE_FOV - OBSERVE_START_FOV) * blend;
      const eyeDistance = (radius * 1.08) / Math.tan(OBSERVE_START_FOV / 2) * (1 - blend);
      const mapForward = [-Math.cos(pitch)*Math.cos(yaw), -Math.cos(pitch)*Math.sin(yaw), -Math.sin(pitch)];
      const skyForward = observeDirection();
      const mixed = mapForward.map((value, i) => value * (1 - blend) + skyForward[i] * blend);
      const forward = Math.hypot(...mixed) < 1e-4 ? skyForward : normalize(mixed);
      mapCenter = blendStartTarget.map((value, i) => value + (observerPos[i] - value) * blend);
      const eye = mapCenter.map((value, i) => value - forward[i] * eyeDistance);
      viewProjection = multiply(perspective(fov, aspect, 0.05, eyeDistance * 1.2 + 400000),
        lookAt(eye, eye.map((value, i) => value + forward[i]), [0, 0, 1]));
    }

    gl.clearColor(0.006, 0.018, 0.032, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL);
    gl.useProgram(program);
    gl.uniformMatrix4fv(locations.matrix, false, viewProjection);
    gl.uniform1f(locations.pixelRatio, dpr);

    if (mapAlpha > 0) {
      const grid = buildGrid(mapCenter);
      drawGeometry(gl.LINES, grid.positions, scaleAlpha(grid.colors, mapAlpha));
      const sphere = buildSphere(mapCenter);
      drawGeometry(gl.LINES, sphere.positions, scaleAlpha(sphere.colors, mapAlpha));
    }
    if (blend > 0) {
      const sky = buildSkyGrid(blend);
      drawGeometry(gl.LINES, sky.positions, sky.colors);
    }

    const fadeSpan = Math.max(observeRange * .25, 1e-6);
    visibleStars = [];
    const starAlphas = [];
    for (const star of stars) {
      if (!enabledCategories.has(star.category || "other")) continue;
      let alpha = 0;
      if (mapAlpha > 0 && Math.hypot(star.x-mapCenter[0], star.y-mapCenter[1], star.z-mapCenter[2]) <= radius) alpha += mapAlpha;
      if (blend > 0 && star !== observerStar) {
        const distance = Math.hypot(star.x-observerPos[0], star.y-observerPos[1], star.z-observerPos[2]);
        if (distance <= observeRange) alpha += blend * Math.min(1, (observeRange - distance) / fadeSpan);
      }
      if (alpha < 0.02) continue;
      visibleStars.push(star);
      starAlphas.push(Math.min(1, alpha));
    }

    // Nebulae: same visibility rules as stars (their extent counts toward the
    // crop sphere), drawn additively as textured sprites scaled to physical
    // size in the map and to apparent angular size in observation mode.
    visibleNebulae = [];
    const nebulaAlphas = [];
    for (const nebula of nebulae) {
      nebula.screen = null;
      if (!enabledCategories.has("nebula")) continue;
      let alpha = 0;
      if (mapAlpha > 0 && Math.hypot(nebula.x-mapCenter[0], nebula.y-mapCenter[1], nebula.z-mapCenter[2]) <= radius + nebula.sizeLy / 2) alpha += mapAlpha;
      if (blend > 0 && nebula !== observerStar) {
        const distance = Math.hypot(nebula.x-observerPos[0], nebula.y-observerPos[1], nebula.z-observerPos[2]);
        if (distance <= observeRange) alpha += blend * Math.min(1, (observeRange - distance) / fadeSpan);
      }
      if (alpha < 0.02) continue;
      visibleNebulae.push(nebula);
      nebulaAlphas.push(Math.min(1, alpha));
    }
    gl.disable(gl.DEPTH_TEST);
    gl.blendFunc(gl.ONE, gl.ONE);
    visibleNebulae.forEach((nebula, index) => {
      const screen = project([nebula.x, nebula.y, nebula.z]);
      if (!screen?.visible) return;
      const distance = Math.hypot(nebula.x-observerPos[0], nebula.y-observerPos[1], nebula.z-observerPos[2]);
      const half = spriteHalfSize(nebula, distance, blend);
      const aspect = nebula.image?.width && nebula.image?.height ? nebula.image.width / nebula.image.height : 1;
      nebula.screen = { x: screen.x, y: screen.y, half };
      drawSprite(nebula, screen, aspect >= 1 ? half : half * aspect, aspect >= 1 ? half / aspect : half, nebulaAlphas[index] * (nebula === selected ? 1 : .9));
    });
    gl.useProgram(program);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.enable(gl.DEPTH_TEST);

    const verticalPositions = [], verticalColors = [];
    if (displaySettings.normals !== "off" && mapAlpha > 0) {
      const normalAlpha = (displaySettings.normals === "prominent" ? .88 : .38) * mapAlpha;
      for (const star of [...visibleStars, ...visibleNebulae]) {
        const color = objectColor(star);
        if (Math.abs(star.z) > radius * .002) line([star.x,star.y,0],[star.x,star.y,star.z],[...color,normalAlpha],verticalPositions,verticalColors);
      }
    }
    gl.disable(gl.DEPTH_TEST);
    drawGeometry(gl.LINES, verticalPositions, verticalColors);

    if (displaySettings.contactLines !== "off" && mapAlpha > 0) {
      const contactAlpha = (displaySettings.contactLines === "prominent" ? .88 : .38) * mapAlpha;
      const foot = focused ? [focused.x,focused.y,0] : [0,0,0];
      const contactPositions = [], contactColors = [];
      if (focused && Math.abs(focused.z) > radius*.002) {
        line([focused.x,focused.y,focused.z],foot,[...objectColor(focused),contactAlpha],contactPositions,contactColors);
      }
      for (const star of [...visibleStars, ...visibleNebulae]) {
        if (star === focused) continue;
        const color = objectColor(star);
        line(foot,[star.x,star.y,0],[...color,contactAlpha],contactPositions,contactColors);
      }
      drawGeometry(gl.LINES,contactPositions,contactColors);
    }

    if (displaySettings.solIndicator && selected && mapAlpha > 0) {
      const solLinePositions = [], solLineColors = [];
      line([selected.x,selected.y,selected.z],[0,0,0],[1,.68,.16,.76*mapAlpha],solLinePositions,solLineColors);
      drawGeometry(gl.LINES,solLinePositions,solLineColors);
    }
    gl.enable(gl.DEPTH_TEST);

    solDrawAlpha = mapAlpha;
    if (blend > 0 && observerStar) {
      const solDistance = Math.hypot(observerPos[0], observerPos[1], observerPos[2]);
      if (solDistance <= observeRange) solDrawAlpha += blend * Math.min(1, (observeRange - solDistance) / fadeSpan);
    }
    solDrawAlpha = Math.min(1, solDrawAlpha);
    const positions = [], colors = [], sizes = [];
    const holePositions = [], holeColors = [], holeSizes = [];
    if (solDrawAlpha > 0.02) { positions.push(0,0,0); colors.push(1,.84,.35,solDrawAlpha); sizes.push(solPointSize()); }
    visibleStars.forEach((star, index) => {
      const hole = star.category === "black_hole";
      const color = objectColor(star);
      const alpha = (star === selected ? 1 : .92) * starAlphas[index];
      (hole ? holePositions : positions).push(star.x,star.y,star.z);
      (hole ? holeColors : colors).push(...color,alpha);
      (hole ? holeSizes : sizes).push(star === selected ? starSize(star)+4 : starSize(star));
    });
    gl.disable(gl.DEPTH_TEST);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
    drawGeometry(gl.POINTS, positions, colors, sizes, true);
    // Black holes are drawn last with ordinary alpha blending so that their
    // dark disc occludes what lies behind it instead of adding light.
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    drawGeometry(gl.POINTS, holePositions, holeColors, holeSizes, true, 1);

    ui.visible.textContent = String(visibleStars.length + visibleNebulae.length + (solDrawAlpha > 0.02 ? 1 : 0));
    if (mode === "observe") {
      ui.grid.textContent = "45° sky sectors";
      ui.range.textContent = observeRange < 100 ? `${observeRange.toFixed(1)} ly` : `${Math.round(observeRange).toLocaleString()} ly`;
    } else {
      const step = gridStep();
      ui.grid.textContent = `${step} light-year${step === 1 ? "" : "s"}`;
      ui.range.textContent = radius < 100 ? `${radius.toFixed(1)} ly` : `${Math.round(radius).toLocaleString()} ly`;
      ui.fill.style.width = `${Math.max(4, Math.min(100, (Math.log10(radius)-Math.log10(1))/(Math.log10(50000))*100))}%`;
    }
    updateLabels();
    if (starListOpen) updateStarList();
  }

  function requestRender() { if (!needsRender) { needsRender = true; requestAnimationFrame(render); } }

  function populateTypeInfo() {
    const description = typeDescriptions[currentTypeContext.category] || typeDescriptions.other;
    if (!description) return;
    ui.typeInfoEyebrow.textContent = description.group === "nebula" ? "Nebula type" : "Stellar type";
    ui.typeInfoTitle.textContent = description.title;
    ui.typeInfoCode.textContent = `Catalog type · ${currentTypeContext.code || "unclassified"}`;
    ui.typeInfoSummary.textContent = description.summary;
    ui.typeInfoFacts.replaceChildren(...(description.facts || []).map(fact => {
      const item = document.createElement("li"); item.textContent = fact; return item;
    }));
    ui.typeInfoSources.replaceChildren();
    for (const [title,url] of [[description.sourceTitle,description.sourceUrl],[description.secondaryTitle,description.secondaryUrl]]) {
      if (!title || !url) continue;
      const link = document.createElement("a");
      link.textContent = title; link.href = url; link.target = "_blank"; link.rel = "noopener noreferrer";
      ui.typeInfoSources.append(link);
    }
  }

  function positionTypeInfoPopup() {
    const card = ui.identity.getBoundingClientRect();
    const frame = viewport.getBoundingClientRect();
    const desiredTop = card.bottom - frame.top + 10;
    const maxTop = viewport.clientHeight - ui.typeInfoPopup.offsetHeight - 16;
    ui.typeInfoPopup.style.top = `${Math.max(14,Math.min(desiredTop,maxTop))}px`;
  }

  function openTypeInfo() {
    populateTypeInfo();
    ui.typeInfoPopup.hidden = false;
    ui.typeInfoButton.setAttribute("aria-expanded","true");
    positionTypeInfoPopup();
  }

  function closeTypeInfo() {
    ui.typeInfoPopup.hidden = true;
    ui.typeInfoButton.setAttribute("aria-expanded","false");
  }

  function formatLy(value, digits = 3) {
    return Number(value).toLocaleString(undefined, { maximumFractionDigits: digits });
  }

  function showObjectImage(nebula) {
    const image = nebula.image;
    if (!image?.dataUri) { ui.image.hidden = true; return; }
    ui.imageImg.src = image.dataUri;
    ui.imageImg.alt = `${nebula.name} — ${image.author || image.credit || "Wikimedia Commons"}`;
    ui.imageCredit.replaceChildren();
    const credit = document.createElement("span");
    credit.textContent = `Image: ${image.author || image.credit || "see source"} · `;
    const licenseLink = document.createElement("a");
    licenseLink.textContent = image.license || "licence";
    licenseLink.href = image.licenseUrl || image.pageUrl; licenseLink.target = "_blank"; licenseLink.rel = "noopener noreferrer license";
    const separator = document.createTextNode(" · ");
    const sourceLink = document.createElement("a");
    sourceLink.textContent = "Wikimedia Commons"; sourceLink.href = image.pageUrl; sourceLink.target = "_blank"; sourceLink.rel = "noopener noreferrer";
    ui.imageCredit.append(credit, licenseLink, separator, sourceLink);
    ui.image.hidden = false;
  }

  function selectStar(star) {
    selected = star;
    ui.image.hidden = true;
    if (!star) {
      ui.name.textContent = "Sol"; ui.type.textContent = "G2V · Yellow dwarf";
      ui.distance.textContent = "0.000 ly"; ui.position.textContent = "Origin";
      ui.locality.textContent = "Milky Way";
      ui.source.textContent = "Reference frame origin";
      currentTypeContext = {category:"yellow_dwarf",code:"G2V"};
    } else if (star.isNebula) {
      ui.name.textContent = star.name;
      ui.type.textContent = star.kindLabel;
      const minus = Number(star.distanceErrMinusLy), plus = Number(star.distanceErrPlusLy);
      const error = Math.abs(minus - plus) < 1e-6 ? `±${formatLy(plus, 0)}` : `+${formatLy(plus, 0)}/−${formatLy(minus, 0)}`;
      ui.distance.textContent = `${formatLy(star.distanceLy, 0)} ly from Sol (${error} ly)`;
      ui.position.textContent = `X ${star.x.toFixed(1)} · Y ${star.y.toFixed(1)} · Z ${star.z.toFixed(1)} ly`;
      ui.locality.textContent = star.locality || "Milky Way";
      const extent = `${formatLy(star.sizeLy, star.sizeLy < 10 ? 1 : 0)} ly across (${star.sizeArcmin}′)`;
      ui.source.textContent = `${star.simbadId || "Curated position"} · ${extent}\nDistance: ${star.distanceQuality} · ${star.distanceSource}`;
      currentTypeContext = {category:star.typeKey,code:star.kindLabel};
      showObjectImage(star);
    } else {
      ui.name.textContent = star.name;
      const category = star.category || "other";
      const title = typeDescriptions[category]?.title;
      if (category === "black_hole" || category === "neutron_star") ui.type.textContent = star.spectralType ? `${title} · ${star.spectralType}` : title;
      else if (star.spectralType) ui.type.textContent = star.spectralType;
      else ui.type.textContent = category === "other" ? "No spectral type · unclassified" : title || "Spectral type unavailable";
      ui.distance.textContent = `${formatLy(star.distanceLy)} ly from Sol`;
      ui.position.textContent = `X ${star.x.toFixed(2)} · Y ${star.y.toFixed(2)} · Z ${star.z.toFixed(2)} ly`;
      ui.locality.textContent = star.locality || "Milky Way";
      const ids = [star.simbadId, star.gaiaId ? `Gaia DR3 ${star.gaiaId}` : ""].filter(Boolean).join(" · ");
      const note = star.distanceNote ? `\n${star.distanceNote}` : "";
      ui.source.textContent = `${ids}\nAstrometry: ${star.astrometrySource} · ${star.distanceQuality}${note}`;
      currentTypeContext = {category:category === "other" && !star.spectralType ? "other_unclassified" : category,code:star.spectralType || "unclassified"};
    }
    ui.name.classList.toggle("long-name",ui.name.textContent.length > 22);
    if (!ui.typeInfoPopup.hidden) { populateTypeInfo(); positionTypeInfoPopup(); }
    positionStarList();
    requestRender();
  }

  function findPick(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    const x = clientX - rect.left, y = clientY - rect.top;
    let best, bestDistance = PICK_RADIUS_PX;
    const sol = solDrawAlpha > 0.02 ? project([0,0,0]) : null;
    if (sol && Math.hypot(sol.x-x,sol.y-y) <= bestDistance) {
      best = { star: null, point: [0,0,0] };
      bestDistance = Math.hypot(sol.x-x,sol.y-y);
    }
    for (const star of visibleStars) {
      const p = project([star.x,star.y,star.z]);
      if (!p?.visible) continue;
      const distance = Math.hypot(p.x-x,p.y-y);
      if (distance < bestDistance) { best = { star, point: [star.x,star.y,star.z] }; bestDistance = distance; }
    }
    if (best) return best;
    // Stars and Sol win inside the pick radius; otherwise a nebula sprite is hit
    // anywhere within its drawn extent (capped so huge sprites do not swallow clicks).
    let bestScore = 1;
    for (const nebula of visibleNebulae) {
      if (!nebula.screen) continue;
      const reach = Math.max(PICK_RADIUS_PX, Math.min(nebula.screen.half, 70));
      const score = Math.hypot(nebula.screen.x-x, nebula.screen.y-y) / reach;
      if (score <= bestScore) { best = { star: nebula, point: [nebula.x,nebula.y,nebula.z] }; bestScore = score; }
    }
    return best;
  }

  function pick(clientX, clientY) {
    const hit = findPick(clientX, clientY);
    selectStar(hit?.star || null);
    return hit;
  }

  function updateHover(clientX, clientY) {
    const hit = findPick(clientX, clientY);
    hovered = hit?.star || (hit ? "sol" : null);
    canvas.classList.toggle("targetable", Boolean(hit));
  }

  function cancelNavigationAnimation() {
    if (!navigationFrame) return;
    cancelAnimationFrame(navigationFrame);
    navigationFrame = 0;
  }

  function animateViewTo(destinationTarget, destinationRadius) {
    cancelNavigationAnimation();
    const startTarget = [...target];
    const startRadius = radius;
    const distance = Math.hypot(
      destinationTarget[0]-startTarget[0],
      destinationTarget[1]-startTarget[1],
      destinationTarget[2]-startTarget[2],
    );
    const zoomDistance = Math.abs(Math.log(destinationRadius/startRadius));

    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches || (distance < 1e-6 && zoomDistance < 1e-6)) {
      target = [...destinationTarget];
      radius = destinationRadius;
      requestRender();
      return;
    }

    const duration = Math.min(680, NAVIGATION_DURATION_MS + Math.log10(1+distance)*42 + Math.min(70,zoomDistance*45));
    const startTime = performance.now();
    const startLogRadius = Math.log(startRadius);
    const destinationLogRadius = Math.log(destinationRadius);

    function step(now) {
      const progress = Math.min(1,(now-startTime)/duration);
      const eased = 1-Math.pow(1-progress,3);
      target = startTarget.map((value,index) => value+(destinationTarget[index]-value)*eased);
      radius = Math.exp(startLogRadius+(destinationLogRadius-startLogRadius)*eased);
      requestRender();
      if (progress < 1) {
        navigationFrame = requestAnimationFrame(step);
      } else {
        navigationFrame = 0;
        target = [...destinationTarget];
        radius = destinationRadius;
        requestRender();
      }
    }

    navigationFrame = requestAnimationFrame(step);
  }

  function observeDirection() {
    return [Math.cos(observePitch)*Math.cos(observeYaw), Math.cos(observePitch)*Math.sin(observeYaw), Math.sin(observePitch)];
  }

  function sliderToDistance(value) {
    return OBSERVE_MIN_RANGE * Math.exp(value / OBSERVE_SLIDER_STEPS * Math.log(OBSERVE_MAX_RANGE / OBSERVE_MIN_RANGE));
  }

  function distanceToSlider(distance) {
    return Math.round(Math.log(distance / OBSERVE_MIN_RANGE) / Math.log(OBSERVE_MAX_RANGE / OBSERVE_MIN_RANGE) * OBSERVE_SLIDER_STEPS);
  }

  function animateBlend(destination, animate = true) {
    if (blendFrame) { cancelAnimationFrame(blendFrame); blendFrame = 0; }
    const start = observeBlend;
    const span = destination - start;
    if (!animate || window.matchMedia?.("(prefers-reduced-motion: reduce)").matches || Math.abs(span) < 1e-4) {
      observeBlend = destination;
      requestRender();
      return;
    }
    const duration = NAVIGATION_DURATION_MS * Math.max(.4, Math.abs(span));
    const startTime = performance.now();
    function step(now) {
      const progress = Math.min(1,(now-startTime)/duration);
      const eased = 1-Math.pow(1-progress,3);
      observeBlend = start + span * eased;
      requestRender();
      if (progress < 1) {
        blendFrame = requestAnimationFrame(step);
      } else {
        blendFrame = 0;
        observeBlend = destination;
        requestRender();
      }
    }
    blendFrame = requestAnimationFrame(step);
  }

  function setObserveMode(observe, animate = true) {
    if ((mode === "observe") === observe) return;
    cancelNavigationAnimation();
    movementKeys.clear();
    mode = observe ? "observe" : "map";
    if (observe) {
      observerStar = focused;
      observerPos = focused ? [focused.x,focused.y,focused.z] : [0,0,0];
      if (observeRange === null) observeRange = Math.max(OBSERVE_MIN_RANGE, Math.min(OBSERVE_MAX_RANGE, radius));
      ui.visibilitySlider.value = String(distanceToSlider(observeRange));
      blendStartTarget = [...target];
      target = [...observerPos];
    } else {
      blendStartTarget = [...target];
    }
    ui.observeButton.setAttribute("aria-pressed", String(observe));
    viewport.classList.toggle("observing", observe);
    ui.visibilitySlider.hidden = !observe;
    animateBlend(observe ? 1 : 0, animate);
  }

  function travelToStar(star) {
    cancelNavigationAnimation();
    const destination = star ? [star.x,star.y,star.z] : [0,0,0];
    observerStar = star;
    target = [...destination];
    blendStartTarget = [...destination];
    const startPosition = [...observerPos];
    const distance = Math.hypot(destination[0]-startPosition[0], destination[1]-startPosition[1], destination[2]-startPosition[2]);
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches || distance < 1e-6) {
      observerPos = destination;
      requestRender();
      return;
    }
    const duration = Math.min(680, NAVIGATION_DURATION_MS + Math.log10(1+distance)*42);
    const startTime = performance.now();
    function step(now) {
      const progress = Math.min(1,(now-startTime)/duration);
      const eased = 1-Math.pow(1-progress,3);
      observerPos = startPosition.map((value,index) => value+(destination[index]-value)*eased);
      requestRender();
      navigationFrame = progress < 1 ? requestAnimationFrame(step) : 0;
    }
    navigationFrame = requestAnimationFrame(step);
  }

  function centerOnStar(star, zoomIn = false) {
    let destinationTarget = [0,0,0];
    if (star) {
      destinationTarget = [star.x,star.y,star.z];
      if (!enabledCategories.has(star.category || "other")) {
        enabledCategories.add(star.category || "other");
        const checkbox = layerCheckboxes.find(input => input.dataset.category === (star.category || "other"));
        if (checkbox) checkbox.checked = true;
      }
    }
    selectStar(star);
    focused = star;
    if (mode === "observe") { travelToStar(star); return; }
    animateViewTo(destinationTarget,zoomIn ? Math.min(radius,5) : radius);
  }

  function reset() {
    cancelNavigationAnimation();
    if (mode === "observe") setObserveMode(false, false);
    else if (observeBlend > 0) animateBlend(0, false);
    observeYaw = 0; observePitch = 0;
    radius = DEFAULT.radius; yaw = DEFAULT.yaw; pitch = DEFAULT.pitch; target = [...DEFAULT.target]; focused = null; selectStar(null); requestRender();
  }

  async function toggleFullscreen() {
    if (typeof viewport.requestFullscreen !== "function") return;
    if (document.fullscreenElement) await document.exitFullscreen(); else await viewport.requestFullscreen();
  }

  function movementTick(timestamp) {
    if (!movementKeys.size) { movementFrame=0; lastMovementTime=0; return; }
    const dt = lastMovementTime ? Math.min(.05,(timestamp-lastMovementTime)/1000) : 0;
    lastMovementTime=timestamp;
    let forward = (movementKeys.has("KeyW") ? 1 : 0) - (movementKeys.has("KeyS") ? 1 : 0);
    let sideways = (movementKeys.has("KeyD") ? 1 : 0) - (movementKeys.has("KeyA") ? 1 : 0);
    let vertical = (movementKeys.has("KeyE") ? 1 : 0) - (movementKeys.has("KeyQ") ? 1 : 0);
    const length = Math.hypot(forward,sideways,vertical) || 1;
    forward/=length; sideways/=length; vertical/=length;
    const forwardPlane = [-Math.cos(yaw),-Math.sin(yaw)];
    const rightPlane = [-Math.sin(yaw),Math.cos(yaw)];
    const speed = Math.max(.8,radius*.9);
    target[0]+=(forward*forwardPlane[0]+sideways*rightPlane[0])*speed*dt;
    target[1]+=(forward*forwardPlane[1]+sideways*rightPlane[1])*speed*dt;
    target[2]+=vertical*speed*dt;
    requestRender();
    movementFrame=requestAnimationFrame(movementTick);
  }

  function startMovement() {
    cancelNavigationAnimation();
    if (!movementFrame) movementFrame=requestAnimationFrame(movementTick);
  }

  function closeToolPanels(except = null) {
    for (const [button, panel] of [[ui.searchButton,ui.searchPanel],[ui.layersButton,ui.layersPanel],[ui.settingsButton,ui.settingsPanel]]) {
      if (panel === except) continue;
      panel.hidden = true;
      button.setAttribute("aria-expanded", "false");
    }
  }

  function toggleToolPanel(button, panel) {
    const open = panel.hidden;
    closeToolPanels(panel);
    panel.hidden = !open;
    button.setAttribute("aria-expanded", String(open));
    return open;
  }

  function searchScore(star, query) {
    const name = star.name.toLocaleLowerCase();
    const aliases = (star.aliases || []).map(alias => alias.toLocaleLowerCase());
    const id = `${star.simbadId || ""} ${star.hipId || ""} ${star.hdId || ""} ${aliases.join(" ")}`.toLocaleLowerCase();
    if (name === query || aliases.includes(query)) return 0;
    if (name.startsWith(query) || aliases.some(alias => alias.startsWith(query))) return 1;
    if (name.split(/\s+/).some(word => word.startsWith(query))) return 2;
    if (name.includes(query)) return 3;
    if (id.includes(query)) return 4;
    return 99;
  }

  function renderSearchResults() {
    const query = ui.searchInput.value.trim().toLocaleLowerCase();
    ui.searchResults.replaceChildren();
    activeSearchIndex = -1;
    if (!query) { searchMatches=[]; return; }
    searchMatches = [solSearchObject,...stars,...nebulae].map(star => ({star, score:searchScore(star,query)}))
      .filter(match => match.score < 99)
      .sort((a,b) => a.score-b.score || b.star.fameScore-a.star.fameScore || a.star.distanceLy-b.star.distanceLy)
      .slice(0, 9).map(match => match.star);
    if (!searchMatches.length) {
      const empty = document.createElement("p");
      empty.className = "search-empty"; empty.textContent = "No positioned objects match that search.";
      ui.searchResults.append(empty); return;
    }
    searchMatches.forEach((star,index) => {
      const result = document.createElement("button");
      result.type = "button"; result.className = "search-result"; result.setAttribute("role","option");
      const name = document.createElement("span"); name.textContent = star.name;
      const id = document.createElement("small");
      id.textContent = star.isSol ? "Sun · coordinate origin"
        : star.isNebula ? `${star.kindLabel}${star.simbadId ? ` · ${star.simbadId}` : ""}`
        : (star.simbadId || (star.gaiaId ? `Gaia DR3 ${star.gaiaId}` : "Catalog object"));
      const distance = document.createElement("b"); distance.textContent = `${Number(star.distanceLy).toLocaleString(undefined,{maximumFractionDigits:1})} ly`;
      result.append(name,id,distance);
      result.addEventListener("click", () => chooseSearchResult(index));
      ui.searchResults.append(result);
    });
  }

  function chooseSearchResult(index) {
    const star = searchMatches[index];
    if (!star) return;
    centerOnStar(star.isSol ? null : star,true);
    ui.searchPanel.hidden = true;
    ui.searchButton.setAttribute("aria-expanded","false");
    ui.searchInput.value = star.name;
  }

  function updateSearchActive(delta) {
    if (!searchMatches.length) return;
    activeSearchIndex = (activeSearchIndex + delta + searchMatches.length) % searchMatches.length;
    [...ui.searchResults.querySelectorAll(".search-result")].forEach((item,index) => item.classList.toggle("active",index===activeSearchIndex));
  }

  const categoryCounts = stars.reduce((counts,star) => {
    const category = star.category || "other";
    counts[category] = (counts[category] || 0) + 1;
    return counts;
  },{});
  categoryCounts.nebula = nebulae.length;
  document.querySelectorAll("[data-count]").forEach(item => { item.textContent = categoryCounts[item.dataset.count] || 0; });

  ui.searchButton.addEventListener("click", () => {
    if (toggleToolPanel(ui.searchButton,ui.searchPanel)) {
      setTimeout(() => { ui.searchInput.focus(); ui.searchInput.select(); },0);
    }
  });
  ui.layersButton.addEventListener("click", () => toggleToolPanel(ui.layersButton,ui.layersPanel));
  ui.settingsButton.addEventListener("click", () => toggleToolPanel(ui.settingsButton,ui.settingsPanel));
  ui.searchInput.addEventListener("input", renderSearchResults);
  ui.searchInput.addEventListener("keydown", event => {
    if (event.key === "ArrowDown") { event.preventDefault(); updateSearchActive(1); }
    else if (event.key === "ArrowUp") { event.preventDefault(); updateSearchActive(-1); }
    else if (event.key === "Enter" && searchMatches.length) { event.preventDefault(); chooseSearchResult(activeSearchIndex < 0 ? 0 : activeSearchIndex); }
    else if (event.key === "Escape") { closeToolPanels(); ui.searchButton.focus(); }
  });
  layerCheckboxes.forEach(input => input.addEventListener("change", () => {
    if (input.checked) enabledCategories.add(input.dataset.category); else enabledCategories.delete(input.dataset.category);
    requestRender();
  }));
  document.querySelector("#layers-all").addEventListener("click", () => {
    layerCheckboxes.forEach(input => { input.checked=true; enabledCategories.add(input.dataset.category); });
    requestRender();
  });
  document.querySelectorAll('input[name="grid-strength"]').forEach(input => input.addEventListener("change", () => {
    if (input.checked) { displaySettings.grid=input.value; requestRender(); }
  }));
  document.querySelectorAll('input[name="normal-strength"]').forEach(input => input.addEventListener("change", () => {
    if (input.checked) { displaySettings.normals=input.value; requestRender(); }
  }));
  document.querySelectorAll('input[name="contact-lines"]').forEach(input => input.addEventListener("change", () => {
    if (input.checked) { displaySettings.contactLines=input.value; requestRender(); }
  }));
  document.querySelectorAll('input[name="star-size"]').forEach(input => input.addEventListener("change", () => {
    if (input.checked) { displaySettings.starSize=input.value; requestRender(); }
  }));
  document.querySelector("#sol-indicator-setting").addEventListener("change", event => {
    displaySettings.solIndicator=event.target.checked; requestRender();
  });
  document.querySelector("#crop-sphere-setting").addEventListener("change", event => {
    displaySettings.cropSphere=event.target.checked; requestRender();
  });
  document.addEventListener("pointerdown", event => {
    if (!event.target.closest(".tool-control")) closeToolPanels();
    if (!event.target.closest("#type-info-popup") && !event.target.closest("#type-info-button")) closeTypeInfo();
  });
  ui.typeInfoButton.addEventListener("click", () => {
    if (ui.typeInfoPopup.hidden) openTypeInfo(); else closeTypeInfo();
  });
  ui.typeInfoClose.addEventListener("click", closeTypeInfo);
  ui.starListToggle.addEventListener("click", () => setStarListOpen(!starListOpen));
  positionStarList();

  // Pointer handling.  Mouse: drag rotates (map) or turns (observation),
  // Shift+drag pans, wheel scales, dblclick centres.  Touch and pen: one
  // finger drags, two fingers pinch to scale and pan with their midpoint, a
  // tap selects and a double tap centres (iOS does not deliver dblclick).
  function isTouchLike(type) { return type === "touch" || type === "pen"; }
  function rotateBy(dx, dy) {
    yaw -= dx*.006; pitch = Math.max(-1.42,Math.min(1.42,pitch+dy*.006));
  }
  function panBy(dx, dy) {
    const scale = (radius*2.16)/canvas.clientHeight;
    const right = [-Math.sin(yaw), Math.cos(yaw), 0];
    const forwardPlane = [-Math.cos(yaw),-Math.sin(yaw),0];
    target[0] += (-dx*right[0]+dy*forwardPlane[0])*scale;
    target[1] += (-dx*right[1]+dy*forwardPlane[1])*scale;
  }
  function turnBy(dx, dy) {
    const lookScale = OBSERVE_FOV / Math.max(1, canvas.clientHeight);
    observeYaw += dx*lookScale;
    observePitch = Math.max(-1.55,Math.min(1.55,observePitch+dy*lookScale));
  }
  function setRadius(value) {
    radius = Math.max(1,Math.min(50000,value));
  }
  function setObserveRange(value) {
    observeRange = Math.max(OBSERVE_MIN_RANGE,Math.min(OBSERVE_MAX_RANGE,value));
    ui.visibilitySlider.value = String(distanceToSlider(observeRange));
  }
  function pinchGeometry() {
    const [a, b] = activePointers.values();
    return { distance: Math.max(1, Math.hypot(b.x-a.x, b.y-a.y)), x: (a.x+b.x)/2, y: (a.y+b.y)/2 };
  }
  function handleTap(event) {
    const x = event.clientX, y = event.clientY;
    if (isTouchLike(event.pointerType)) {
      const now = performance.now();
      if (lastTap && now-lastTap.time < 350 && Math.hypot(x-lastTap.x,y-lastTap.y) < 30) {
        lastTap = null;
        const hit = findPick(x,y);
        if (hit) centerOnStar(hit.star,false); else pick(x,y);
        return;
      }
      lastTap = { time:now, x, y };
    }
    pick(x,y);
  }

  canvas.addEventListener("pointerdown", event => {
    cancelNavigationAnimation();
    try { canvas.setPointerCapture(event.pointerId); } catch { /* synthetic pointers cannot be captured */ }
    lastPointerType = event.pointerType || "mouse";
    activePointers.set(event.pointerId, { x:event.clientX, y:event.clientY });
    canvas.classList.add("dragging");
    if (activePointers.size === 1) {
      gesture = { kind:"drag", id:event.pointerId, startX:event.clientX, startY:event.clientY, moved:false,
        pan:event.shiftKey, slop:isTouchLike(event.pointerType) ? 10 : 4 };
    } else if (activePointers.size === 2) {
      const start = pinchGeometry();
      gesture = { kind:"pinch", distance:start.distance, x:start.x, y:start.y, radius, range:observeRange };
    } else {
      gesture = { kind:"idle" };
    }
  });
  canvas.addEventListener("pointermove", event => {
    const tracked = activePointers.get(event.pointerId);
    if (!tracked) {
      if (!activePointers.size && !isTouchLike(event.pointerType)) updateHover(event.clientX,event.clientY);
      return;
    }
    const dx = event.clientX-tracked.x, dy = event.clientY-tracked.y;
    tracked.x = event.clientX; tracked.y = event.clientY;
    if (gesture?.kind === "pinch") {
      if (activePointers.size < 2) return;
      const now = pinchGeometry();
      const factor = gesture.distance / now.distance;
      if (mode === "observe") { setObserveRange(gesture.range*factor); turnBy(now.x-gesture.x, now.y-gesture.y); }
      else { setRadius(gesture.radius*factor); panBy(now.x-gesture.x, now.y-gesture.y); }
      gesture.x = now.x; gesture.y = now.y;
    } else if (gesture?.kind === "drag" && gesture.id === event.pointerId) {
      if (Math.hypot(event.clientX-gesture.startX,event.clientY-gesture.startY) > gesture.slop) gesture.moved = true;
      if (mode === "observe") turnBy(dx, dy);
      else if (gesture.pan) panBy(dx, dy);
      else rotateBy(dx, dy);
    } else {
      return;
    }
    requestRender();
  });
  function finishPointer(event) {
    if (!activePointers.delete(event.pointerId)) return;
    if (gesture?.kind === "drag" && gesture.id === event.pointerId) {
      if (!gesture.moved && event.type === "pointerup") handleTap(event);
      gesture = null;
    } else if (gesture?.kind === "pinch") {
      gesture = { kind:"idle" }; // the remaining finger does nothing until lifted
    }
    if (!activePointers.size) { gesture = null; canvas.classList.remove("dragging"); }
  }
  canvas.addEventListener("pointerup", finishPointer);
  canvas.addEventListener("pointercancel", finishPointer);
  canvas.addEventListener("pointerleave", () => {
    if (!activePointers.size) { hovered=null; canvas.classList.remove("targetable"); }
  });
  canvas.addEventListener("dblclick", event => {
    event.preventDefault();
    if (isTouchLike(lastPointerType)) return; // double taps are handled in handleTap
    const hit = findPick(event.clientX,event.clientY);
    if (hit) centerOnStar(hit.star, false);
  });
  canvas.addEventListener("contextmenu", event => event.preventDefault());
  canvas.addEventListener("wheel", event => {
    event.preventDefault();
    if (mode === "observe") {
      setObserveRange(observeRange*Math.exp(event.deltaY*.0012));
      requestRender();
      return;
    }
    cancelNavigationAnimation();
    setRadius(radius*Math.exp(event.deltaY*.0012));
    requestRender();
  }, { passive:false });
  window.addEventListener("keydown", event => {
    if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) {
      if (event.target === ui.visibilitySlider && event.code === "Space") {
        event.preventDefault();
        if (!event.repeat) setObserveMode(mode !== "observe");
      }
      return;
    }
    if (event.code === "Space") {
      event.preventDefault();
      if (!event.repeat) setObserveMode(mode !== "observe");
      return;
    }
    if (mode === "map" && ["KeyW","KeyA","KeyS","KeyD","KeyQ","KeyE"].includes(event.code)) {
      event.preventDefault(); movementKeys.add(event.code); startMovement();
    }
    if (event.key.toLowerCase() === "r") reset();
    if (event.key.toLowerCase() === "f") { event.preventDefault(); toggleFullscreen().catch(() => {}); }
    if (event.key === "Escape") closeTypeInfo();
  });
  window.addEventListener("keyup", event => {
    movementKeys.delete(event.code);
  });
  window.addEventListener("blur", () => { movementKeys.clear(); });
  window.addEventListener("resize", () => {
    requestRender();
    if (!ui.typeInfoPopup.hidden) positionTypeInfoPopup();
    positionStarList();
  });
  ui.observeButton.addEventListener("click", () => setObserveMode(mode !== "observe"));
  ui.visibilitySlider.addEventListener("input", () => {
    observeRange = sliderToDistance(Number(ui.visibilitySlider.value));
    requestRender();
  });
  document.querySelector("#reset-button").addEventListener("click", reset);
  const fullscreenButton = document.querySelector("#fullscreen-button");
  const standaloneDisplay = window.matchMedia?.("(display-mode: standalone)").matches || window.navigator.standalone === true;
  if (typeof viewport.requestFullscreen !== "function" || standaloneDisplay) fullscreenButton.hidden = true; // iPhone has no Fullscreen API; an installed app is already full screen
  fullscreenButton.addEventListener("click", () => toggleFullscreen().catch(() => {}));
  if ("serviceWorker" in navigator && /^https?:$/.test(location.protocol)) {
    window.addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => {}));
  }
  document.addEventListener("fullscreenchange", requestRender);

  ui.summary.textContent = `${meta.renderableRowCount ?? stars.length} positioned stars · ${nebulae.length} imaged nebulae · snapshot ${(meta.generatedUtc || "unknown").slice(0,10)}`;
  if (!stars.length) {
    ui.error.hidden = false;
    ui.error.textContent = "The star catalog is missing. Run: python scripts/build_catalog.py";
  }
  requestAnimationFrame(render);
})();
