(() => {
  "use strict";

  const canvas = document.querySelector("#star-map");
  const viewport = document.querySelector("#viewport");
  const gl = canvas.getContext("webgl", { alpha: false, antialias: true });
  const stars = Array.isArray(window.STAR_CATALOG) ? window.STAR_CATALOG : [];
  const meta = window.STAR_CATALOG_META || {};
  const typeDescriptions = window.STAR_TYPE_DESCRIPTIONS || {};
  const solSearchObject = Object.freeze({
    name:"Sol", simbadId:"Solar System origin", hipId:"", hdId:"", gaiaId:"",
    x:0, y:0, z:0, distanceLy:0, spectralType:"G2V", category:"yellow_dwarf",
    fameScore:1000, isSol:true,
  });
  const PICK_RADIUS_PX = 14;
  const NAVIGATION_DURATION_MS = 440;
  const DEFAULT = Object.freeze({ radius: 15, yaw: Math.PI / 4, pitch: Math.atan(1 / Math.sqrt(2)), target: [0, 0, 0] });

  const ui = {
    name: document.querySelector("#star-name"), type: document.querySelector("#star-type"),
    distance: document.querySelector("#star-distance"), position: document.querySelector("#star-position"),
    source: document.querySelector("#star-source"), range: document.querySelector("#range-value"),
    visible: document.querySelector("#visible-count"), grid: document.querySelector("#grid-value"), fill: document.querySelector("#scale-fill"),
    labels: document.querySelector("#labels"), summary: document.querySelector("#catalog-summary"),
    error: document.querySelector("#error-message"),
    searchButton: document.querySelector("#search-button"), searchPanel: document.querySelector("#search-panel"),
    searchInput: document.querySelector("#star-search"), searchResults: document.querySelector("#search-results"),
    layersButton: document.querySelector("#layers-button"), layersPanel: document.querySelector("#layers-panel"),
    settingsButton: document.querySelector("#settings-button"), settingsPanel: document.querySelector("#settings-panel"),
    identity: document.querySelector("#identity"), typeInfoButton: document.querySelector("#type-info-button"),
    typeInfoPopup: document.querySelector("#type-info-popup"), typeInfoClose: document.querySelector("#type-info-close"),
    typeInfoTitle: document.querySelector("#type-info-title"), typeInfoCode: document.querySelector("#type-info-code"),
    typeInfoSummary: document.querySelector("#type-info-summary"), typeInfoFacts: document.querySelector("#type-info-facts"),
    typeInfoSources: document.querySelector("#type-info-sources"),
  };

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
  let pointer = null;
  let spaceHeld = false;
  let viewProjection = new Float32Array(16);
  let visibleStars = [];
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
    varying vec4 v_color;
    void main() {
      if (u_points) {
        vec2 p = gl_PointCoord * 2.0 - 1.0;
        float d = dot(p, p);
        if (d > 1.0) discard;
        float core = 1.0 - smoothstep(0.02, 0.28, d);
        float halo = 1.0 - smoothstep(0.15, 1.0, d);
        gl_FragColor = vec4(v_color.rgb * (0.85 + core * 1.7), v_color.a * (halo * 0.72 + core));
      } else {
        gl_FragColor = v_color;
      }
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
  };
  const buffers = { position: gl.createBuffer(), color: gl.createBuffer(), size: gl.createBuffer() };

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

  function starSize(star) {
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

  function drawGeometry(mode, positions, colors, sizes, points = false) {
    if (!positions.length) return;
    bindAttribute(buffers.position, locations.position, positions, 3);
    bindAttribute(buffers.color, locations.color, colors, 4);
    bindAttribute(buffers.size, locations.size, sizes || new Array(positions.length / 3).fill(1), 1);
    gl.uniform1i(locations.points, points ? 1 : 0);
    gl.drawArrays(mode, 0, positions.length / 3);
  }

  function line(a, b, color, positions, colors) {
    positions.push(...a, ...b); colors.push(...color, ...color);
  }

  function buildGrid() {
    const positions = [], colors = [];
    if (displaySettings.grid === "off") return { positions, colors };
    const step = gridStep();
    const extent = Math.ceil(radius / step + 1) * step;
    const minX = Math.floor((target[0] - extent) / step) * step;
    const maxX = Math.ceil((target[0] + extent) / step) * step;
    const minY = Math.floor((target[1] - extent) / step) * step;
    const maxY = Math.ceil((target[1] + extent) / step) * step;
    const grid = displaySettings.grid === "prominent" ? [0.05,0.72,1,0.62] : [0.22,0.55,0.68,0.12];
    for (let x = minX; x <= maxX; x += step) line([x,minY,0],[x,maxY,0],grid,positions,colors);
    for (let y = minY; y <= maxY; y += step) line([minX,y,0],[maxX,y,0],grid,positions,colors);
    return { positions, colors };
  }

  function buildSphere() {
    const positions = [], colors = [], segments = 96;
    if (!displaySettings.cropSphere) return { positions, colors };
    const color = [0.22, 0.64, 0.82, 0.13];
    for (let ring = 0; ring < 3; ring++) for (let i = 0; i < segments; i++) {
      const a = i / segments * Math.PI * 2, b = (i + 1) / segments * Math.PI * 2;
      const points = ring === 0 ? [[Math.cos(a),Math.sin(a),0],[Math.cos(b),Math.sin(b),0]]
        : ring === 1 ? [[Math.cos(a),0,Math.sin(a)],[Math.cos(b),0,Math.sin(b)]]
        : [[0,Math.cos(a),Math.sin(a)],[0,Math.cos(b),Math.sin(b)]];
      line(points[0].map((v,j)=>target[j]+v*radius), points[1].map((v,j)=>target[j]+v*radius), color, positions, colors);
    }
    return { positions, colors };
  }

  function project(point) {
    const p = transform(viewProjection, point);
    if (p[3] === 0) return null;
    const nx = p[0] / p[3], ny = p[1] / p[3], nz = p[2] / p[3];
    return { x: (nx * .5 + .5) * canvas.clientWidth, y: (1 - (ny * .5 + .5)) * canvas.clientHeight, visible: nz >= -1 && nz <= 1 };
  }

  function updateLabels() {
    ui.labels.replaceChildren();
    const labeled = visibleStars.filter(star => star === selected || star.fameScore >= 100)
      .sort((a,b) => (b === selected) - (a === selected) || b.fameScore - a.fameScore).slice(0, 24);
    const occupied = [];
    for (const star of labeled) {
      const screen = project([star.x, star.y, star.z]);
      if (!screen?.visible || screen.x < 0 || screen.y < 0 || screen.x > canvas.clientWidth || screen.y > canvas.clientHeight) continue;
      if (star !== selected && occupied.some(p => Math.hypot(p.x-screen.x,p.y-screen.y) < 55)) continue;
      occupied.push(screen);
      const label = document.createElement("span");
      label.className = "star-label";
      label.textContent = star.name;
      label.style.left = `${screen.x}px`; label.style.top = `${screen.y}px`;
      ui.labels.append(label);
    }
    if (displaySettings.solIndicator && selected) {
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
    const halfHeight = radius * 1.08;
    const eyeDistance = Math.max(100, radius * 4);
    const direction = [Math.cos(pitch)*Math.cos(yaw), Math.cos(pitch)*Math.sin(yaw), Math.sin(pitch)];
    const eye = target.map((value, i) => value + direction[i] * eyeDistance);
    viewProjection = multiply(ortho(-halfHeight*aspect,halfHeight*aspect,-halfHeight,halfHeight,-eyeDistance*2,eyeDistance*2), lookAt(eye,target,[0,0,1]));

    gl.clearColor(0.006, 0.018, 0.032, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL);
    gl.useProgram(program);
    gl.uniformMatrix4fv(locations.matrix, false, viewProjection);
    gl.uniform1f(locations.pixelRatio, dpr);

    const grid = buildGrid();
    drawGeometry(gl.LINES, grid.positions, grid.colors);
    const sphere = buildSphere();
    drawGeometry(gl.LINES, sphere.positions, sphere.colors);

    visibleStars = stars.filter(star => enabledCategories.has(star.category || "other")
      && Math.hypot(star.x-target[0], star.y-target[1], star.z-target[2]) <= radius);
    const verticalPositions = [], verticalColors = [];
    if (displaySettings.normals !== "off") {
      const normalAlpha = displaySettings.normals === "prominent" ? .88 : .38;
      for (const star of visibleStars) {
        const color = spectralColor(star.spectralType);
        if (Math.abs(star.z) > radius * .002) line([star.x,star.y,0],[star.x,star.y,star.z],[...color,normalAlpha],verticalPositions,verticalColors);
      }
    }
    gl.disable(gl.DEPTH_TEST);
    drawGeometry(gl.LINES, verticalPositions, verticalColors);

    if (displaySettings.contactLines !== "off") {
      const contactAlpha = displaySettings.contactLines === "prominent" ? .88 : .38;
      const foot = focused ? [focused.x,focused.y,0] : [0,0,0];
      const contactPositions = [], contactColors = [];
      if (focused && Math.abs(focused.z) > radius*.002) {
        line([focused.x,focused.y,focused.z],foot,[...spectralColor(focused.spectralType),contactAlpha],contactPositions,contactColors);
      }
      for (const star of visibleStars) {
        if (star === focused) continue;
        const color = spectralColor(star.spectralType);
        line(foot,[star.x,star.y,0],[...color,contactAlpha],contactPositions,contactColors);
      }
      drawGeometry(gl.LINES,contactPositions,contactColors);
    }

    if (displaySettings.solIndicator && selected) {
      const solLinePositions = [], solLineColors = [];
      line([selected.x,selected.y,selected.z],[0,0,0],[1,.68,.16,.76],solLinePositions,solLineColors);
      drawGeometry(gl.LINES,solLinePositions,solLineColors);
    }
    gl.enable(gl.DEPTH_TEST);

    const positions = [0,0,0], colors = [1,.84,.35,1], sizes = [solPointSize()];
    for (const star of visibleStars) {
      positions.push(star.x,star.y,star.z);
      const color = spectralColor(star.spectralType);
      const alpha = star === selected ? 1 : .92;
      colors.push(...color,alpha); sizes.push(star === selected ? starSize(star)+4 : starSize(star));
    }
    gl.disable(gl.DEPTH_TEST);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
    drawGeometry(gl.POINTS, positions, colors, sizes, true);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

    ui.visible.textContent = String(visibleStars.length + 1);
    const step = gridStep();
    ui.grid.textContent = `${step} light-year${step === 1 ? "" : "s"}`;
    ui.range.textContent = radius < 100 ? `${radius.toFixed(1)} ly` : `${Math.round(radius).toLocaleString()} ly`;
    ui.fill.style.width = `${Math.max(4, Math.min(100, (Math.log10(radius)-Math.log10(1))/(Math.log10(50000))*100))}%`;
    updateLabels();
  }

  function requestRender() { if (!needsRender) { needsRender = true; requestAnimationFrame(render); } }

  function populateTypeInfo() {
    const description = typeDescriptions[currentTypeContext.category] || typeDescriptions.other;
    if (!description) return;
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

  function selectStar(star) {
    selected = star;
    if (!star) {
      ui.name.textContent = "Sol"; ui.type.textContent = "G2V · Yellow dwarf";
      ui.distance.textContent = "0.000 ly"; ui.position.textContent = "Origin";
      ui.source.textContent = "Reference frame origin";
      currentTypeContext = {category:"yellow_dwarf",code:"G2V"};
    } else {
      ui.name.textContent = star.name;
      ui.type.textContent = star.spectralType || "Spectral type unavailable";
      ui.distance.textContent = `${Number(star.distanceLy).toLocaleString(undefined,{maximumFractionDigits:3})} ly from Sol`;
      ui.position.textContent = `X ${star.x.toFixed(2)} · Y ${star.y.toFixed(2)} · Z ${star.z.toFixed(2)} ly`;
      const ids = [star.simbadId, star.gaiaId ? `Gaia DR3 ${star.gaiaId}` : ""].filter(Boolean).join(" · ");
      ui.source.textContent = `${ids}\nAstrometry: ${star.astrometrySource} · ${star.distanceQuality}`;
      currentTypeContext = {category:star.category || "other",code:star.spectralType || "unclassified"};
    }
    ui.name.classList.toggle("long-name",ui.name.textContent.length > 22);
    if (!ui.typeInfoPopup.hidden) { populateTypeInfo(); positionTypeInfoPopup(); }
    requestRender();
  }

  function findPick(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    const x = clientX - rect.left, y = clientY - rect.top;
    let best, bestDistance = PICK_RADIUS_PX;
    const sol = project([0,0,0]);
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
    animateViewTo(destinationTarget,zoomIn ? Math.min(radius,5) : radius);
  }

  function reset() {
    cancelNavigationAnimation();
    radius = DEFAULT.radius; yaw = DEFAULT.yaw; pitch = DEFAULT.pitch; target = [...DEFAULT.target]; focused = null; selectStar(null); requestRender();
  }

  async function toggleFullscreen() {
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
    const id = `${star.simbadId || ""} ${star.hipId || ""} ${star.hdId || ""}`.toLocaleLowerCase();
    if (name === query) return 0;
    if (name.startsWith(query)) return 1;
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
    searchMatches = [solSearchObject,...stars].map(star => ({star, score:searchScore(star,query)}))
      .filter(match => match.score < 99)
      .sort((a,b) => a.score-b.score || b.star.fameScore-a.star.fameScore || a.star.distanceLy-b.star.distanceLy)
      .slice(0, 9).map(match => match.star);
    if (!searchMatches.length) {
      const empty = document.createElement("p");
      empty.className = "search-empty"; empty.textContent = "No positioned stars match that search.";
      ui.searchResults.append(empty); return;
    }
    searchMatches.forEach((star,index) => {
      const result = document.createElement("button");
      result.type = "button"; result.className = "search-result"; result.setAttribute("role","option");
      const name = document.createElement("span"); name.textContent = star.name;
      const id = document.createElement("small"); id.textContent = star.isSol ? "Sun · coordinate origin" : (star.simbadId || (star.gaiaId ? `Gaia DR3 ${star.gaiaId}` : "Catalog object"));
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

  canvas.addEventListener("pointerdown", event => {
    cancelNavigationAnimation();
    canvas.setPointerCapture(event.pointerId);
    pointer = { id:event.pointerId, x:event.clientX, y:event.clientY, startX:event.clientX, startY:event.clientY, moved:false, pan:spaceHeld };
    canvas.classList.add("dragging");
  });
  canvas.addEventListener("pointermove", event => {
    if (!pointer) { updateHover(event.clientX,event.clientY); return; }
    if (pointer.id !== event.pointerId) return;
    const dx = event.clientX-pointer.x, dy = event.clientY-pointer.y;
    pointer.x=event.clientX; pointer.y=event.clientY;
    if (Math.hypot(event.clientX-pointer.startX,event.clientY-pointer.startY) > 4) pointer.moved=true;
    if (pointer.pan) {
      const scale = (radius*2.16)/canvas.clientHeight;
      const right = [-Math.sin(yaw), Math.cos(yaw), 0];
      const forwardPlane = [-Math.cos(yaw),-Math.sin(yaw),0];
      target[0] += (-dx*right[0]+dy*forwardPlane[0])*scale;
      target[1] += (-dx*right[1]+dy*forwardPlane[1])*scale;
    } else {
      yaw -= dx*.006; pitch = Math.max(-1.42,Math.min(1.42,pitch+dy*.006));
    }
    requestRender();
  });
  function finishPointer(event) {
    if (!pointer || pointer.id !== event.pointerId) return;
    if (!pointer.moved) pick(event.clientX,event.clientY);
    pointer=null; canvas.classList.remove("dragging");
  }
  canvas.addEventListener("pointerup", finishPointer);
  canvas.addEventListener("pointercancel", finishPointer);
  canvas.addEventListener("pointerleave", () => {
    if (!pointer) { hovered=null; canvas.classList.remove("targetable"); }
  });
  canvas.addEventListener("dblclick", event => {
    event.preventDefault();
    const hit = findPick(event.clientX,event.clientY);
    if (hit) centerOnStar(hit.star, false);
  });
  canvas.addEventListener("wheel", event => {
    event.preventDefault();
    cancelNavigationAnimation();
    radius = Math.max(1,Math.min(50000,radius*Math.exp(event.deltaY*.0012)));
    requestRender();
  }, { passive:false });
  window.addEventListener("keydown", event => {
    if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
    if (["KeyW","KeyA","KeyS","KeyD","KeyQ","KeyE"].includes(event.code)) {
      event.preventDefault(); movementKeys.add(event.code); startMovement();
    }
    if (event.code === "Space") { spaceHeld=true; event.preventDefault(); }
    if (event.key.toLowerCase() === "r") reset();
    if (event.key.toLowerCase() === "f") { event.preventDefault(); toggleFullscreen().catch(() => {}); }
    if (event.key === "Escape") closeTypeInfo();
  });
  window.addEventListener("keyup", event => {
    if (event.code === "Space") spaceHeld=false;
    movementKeys.delete(event.code);
  });
  window.addEventListener("blur", () => { spaceHeld=false; movementKeys.clear(); });
  window.addEventListener("resize", () => {
    requestRender();
    if (!ui.typeInfoPopup.hidden) positionTypeInfoPopup();
  });
  document.querySelector("#reset-button").addEventListener("click", reset);
  document.querySelector("#fullscreen-button").addEventListener("click", () => toggleFullscreen().catch(() => {}));
  document.addEventListener("fullscreenchange", requestRender);

  ui.summary.textContent = `${meta.renderableRowCount ?? stars.length} positioned objects · snapshot ${(meta.generatedUtc || "unknown").slice(0,10)}`;
  if (!stars.length) {
    ui.error.hidden = false;
    ui.error.textContent = "The star catalog is missing. Run: python scripts/build_catalog.py";
  }
  requestAnimationFrame(render);
})();
