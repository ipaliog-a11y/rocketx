import * as THREE from "three";

/**
 * The title screen's launch pad: a rocket on its mount beside the service
 * tower at dusk, floodlit and venting, filmed by a run of cameras that cut
 * from one to the next like a launch broadcast. Everything is built from
 * primitives here; nothing is loaded.
 */

export type PadScene = {
  /** Camera names, in the order they cut. */
  shots: string[];
  /** Paint a company name down the first stage. */
  setName(name: string): void;
  /** Cut to a camera now. */
  cut(index: number): void;
  dispose(): void;
};

type ShotSpec = { name: string; from: THREE.Vector3Tuple; to: THREE.Vector3Tuple; lookFrom: THREE.Vector3Tuple; lookTo: THREE.Vector3Tuple; fov: [number, number] };

// Heights, m. The rocket stands on the mount with its engines hanging into the hole.
const R = 1.85;
const DECK = 2;
const MOUNT_TOP = 6.4;
const S1_TOP = MOUNT_TOP + 30;
const INTER_TOP = S1_TOP + 3;
const S2_TOP = INTER_TOP + 9;
const NOSE = S2_TOP + 8.6;
const TOWER_X = -9.5;
const TOWER_TOP = 66;

const SHOTS: ShotSpec[] = [
  { name: "Pad wide", from: [96, 16, 122], to: [78, 19, 100], lookFrom: [0, 27, 0], lookTo: [0, 30, 0], fov: [34, 32] },
  { name: "Mount", from: [7.5, 3.4, 9], to: [9.5, 3.2, 4.5], lookFrom: [0, 40, 0], lookTo: [0, 46, 0], fov: [62, 60] },
  { name: "Engines", from: [4.2, 3.4, 7.5], to: [-4.2, 3.6, 7.5], lookFrom: [0, 5, 0], lookTo: [0, 5.2, 0], fov: [42, 40] },
  { name: "Tower", from: [-7, 67, 8], to: [-4, 65, 11], lookFrom: [0, 44, 0], lookTo: [0, 38, 0], fov: [52, 50] },
  { name: "Long lens", from: [-185, 9, 140], to: [-165, 9, 165], lookFrom: [0, 33, 0], lookTo: [0, 32, 0], fov: [13, 13] },
  { name: "Drone", from: [15, 8, 15], to: [10, 60, 10], lookFrom: [0, 10, 0], lookTo: [0, 56, 0], fov: [46, 46] },
  { name: "Dusk", from: [170, 5, 120], to: [158, 5, 134], lookFrom: [0, 30, 0], lookTo: [0, 31, 0], fov: [21, 20] },
];
const SHOT_SECONDS = 6.5;
const FADE_SECONDS = 0.35;

const ease = (t: number) => t * t * (3 - 2 * t);

export function mountLaunchPad(host: HTMLElement, { reduced, name, onShot }: { reduced: boolean; name: string; onShot: (index: number) => void }): PadScene {
  const narrow = host.clientWidth < 700;
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, narrow ? 2 : 1.75));
  renderer.setSize(host.clientWidth, host.clientHeight);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.domElement.className = "pad-canvas";
  host.appendChild(renderer.domElement);

  const fade = document.createElement("div");
  fade.className = "pad-fade";
  host.appendChild(fade);

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0x2d2f48, 160, 1100);
  const camera = new THREE.PerspectiveCamera(40, host.clientWidth / host.clientHeight, 0.3, 4000);

  // ── Sky, sun and stars ──
  const sunDir = new THREE.Vector3(-300, 16, -210).normalize();
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(1800, 32, 16),
    new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: { sun: { value: sunDir } },
      vertexShader: `varying vec3 vDir; void main() { vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: `
        uniform vec3 sun; varying vec3 vDir;
        void main() {
          float h = clamp(vDir.y, -0.2, 1.0);
          vec3 top = vec3(0.035, 0.06, 0.15);
          vec3 mid = vec3(0.19, 0.17, 0.36);
          vec3 low = vec3(0.98, 0.52, 0.27);
          vec3 col = mix(low, mid, smoothstep(0.0, 0.16, h));
          col = mix(col, top, smoothstep(0.14, 0.75, h));
          float s = max(dot(normalize(vDir), sun), 0.0);
          col += vec3(1.0, 0.5, 0.2) * pow(s, 28.0) * 0.5 + vec3(1.0, 0.72, 0.42) * smoothstep(0.99975, 0.9999, s) * 2.2;
          if (h < 0.0) col = mix(col, vec3(0.08, 0.07, 0.11), smoothstep(0.0, -0.08, h));
          gl_FragColor = vec4(col, 1.0);
        }`,
    }),
  );
  scene.add(sky);

  const starPos: number[] = [];
  for (let i = 0; i < 1400; i++) {
    const u = Math.random() * Math.PI * 2;
    const v = 0.18 + Math.random() * 0.82;
    const r = 1700;
    starPos.push(r * Math.cos(u) * Math.sqrt(1 - v * v), r * v, r * Math.sin(u) * Math.sqrt(1 - v * v));
  }
  const stars = new THREE.Points(
    new THREE.BufferGeometry().setAttribute("position", new THREE.Float32BufferAttribute(starPos, 3)),
    new THREE.PointsMaterial({ color: 0xdfe6ff, size: 1.6, sizeAttenuation: false, transparent: true, opacity: 0.75, fog: false, depthWrite: false }),
  );
  scene.add(stars);

  scene.add(new THREE.HemisphereLight(0xa3b0e0, 0x3a2c20, 1.25));
  const sun = new THREE.DirectionalLight(0xffa36b, 2.6);
  sun.position.set(-300, 70, -210).normalize().multiplyScalar(140);
  sun.castShadow = true;
  sun.shadow.mapSize.set(narrow ? 1024 : 2048, narrow ? 1024 : 2048);
  Object.assign(sun.shadow.camera, { left: -70, right: 70, top: 90, bottom: -20, near: 1, far: 400 });
  sun.shadow.bias = -0.0004;
  scene.add(sun);

  // ── Ground, sea and pad ──
  const mat = (color: number, roughness = 0.8, metalness = 0) => new THREE.MeshStandardMaterial({ color, roughness, metalness });
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(3000, 3000), mat(0x2c3324, 1));
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);
  const sea = new THREE.Mesh(new THREE.PlaneGeometry(3000, 1400), new THREE.MeshStandardMaterial({ color: 0x1b2c44, roughness: 0.18, metalness: 0.4 }));
  sea.rotation.x = -Math.PI / 2;
  sea.position.set(0, 0.05, -900);
  scene.add(sea);
  const road = new THREE.Mesh(new THREE.PlaneGeometry(7, 600), mat(0x3a3a3c, 0.95));
  road.rotation.x = -Math.PI / 2;
  road.position.set(24, 0.03, 330);
  road.receiveShadow = true;
  scene.add(road);

  const box = (w: number, h: number, d: number, x: number, y: number, z: number, m: THREE.Material) => {
    const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
    b.position.set(x, y, z);
    b.castShadow = true;
    b.receiveShadow = true;
    scene.add(b);
    return b;
  };
  const concrete = mat(0x8c8a84, 0.92);
  // The hardstand, split by the flame trench that runs out under the rocket toward +z.
  box(26, DECK, 64, -17, DECK / 2, 0, concrete);
  box(26, DECK, 64, 17, DECK / 2, 0, concrete);
  box(8, DECK, 28, 0, DECK / 2, -18, concrete);
  box(8, 0.4, 36, 0, -1.6, 14, mat(0x1d1c1b, 1));
  box(8, 3.6, 0.5, 0, 0.2, -4.2, mat(0x5b4f45, 0.9)).rotation.x = 0.6; // flame deflector

  // The mount: a steel table over the trench with a hole for the engines.
  const steel = mat(0x4d535b, 0.55, 0.6);
  for (const [x, z] of [[-3.6, -3.6], [3.6, -3.6], [-3.6, 3.6], [3.6, 3.6]] as const) box(0.9, MOUNT_TOP - DECK - 0.5, 0.9, x, (DECK + MOUNT_TOP - 0.5) / 2, z, steel);
  box(8.4, 0.6, 1.8, 0, MOUNT_TOP - 0.3, -3.3, steel);
  box(8.4, 0.6, 1.8, 0, MOUNT_TOP - 0.3, 3.3, steel);
  box(1.8, 0.6, 4.8, -3.3, MOUNT_TOP - 0.3, 0, steel);
  box(1.8, 0.6, 4.8, 3.3, MOUNT_TOP - 0.3, 0, steel);
  for (let i = 0; i < 4; i++) {
    const a = Math.PI / 4 + (i * Math.PI) / 2;
    box(0.5, 0.9, 0.5, Math.cos(a) * (R + 0.15), MOUNT_TOP + 0.3, Math.sin(a) * (R + 0.15), mat(0x2a2d31, 0.5, 0.7));
  }

  // ── The rocket ──
  const rocket = new THREE.Group();
  scene.add(rocket);
  const bodyCanvas = document.createElement("canvas");
  bodyCanvas.width = 512;
  bodyCanvas.height = 1324;
  const bodyTexture = new THREE.CanvasTexture(bodyCanvas);
  bodyTexture.colorSpace = THREE.SRGBColorSpace;
  bodyTexture.anisotropy = renderer.capabilities.getMaxAnisotropy();
  const paintBody = (label: string) => {
    const g = bodyCanvas.getContext("2d")!;
    const { width: w, height: h } = bodyCanvas;
    g.fillStyle = "#eceef0";
    g.fillRect(0, 0, w, h);
    // Frost on the oxygen tank, lower down.
    const frost = g.createLinearGradient(0, h * 0.45, 0, h);
    frost.addColorStop(0, "rgba(214,226,238,0)");
    frost.addColorStop(1, "rgba(214,226,238,0.9)");
    g.fillStyle = frost;
    g.fillRect(0, h * 0.45, w, h * 0.55);
    g.strokeStyle = "rgba(60,70,80,0.18)";
    g.lineWidth = 2;
    for (let y = 70; y < h; y += 132) {
      g.beginPath();
      g.moveTo(0, y);
      g.lineTo(w, y);
      g.stroke();
    }
    g.fillStyle = "#e8a33a";
    g.fillRect(0, 26, w, 16);
    // The name, twice, reading up the side.
    const text = label.toUpperCase();
    for (const u of [0.125, 0.625]) {
      g.save();
      g.translate(u * w, h * 0.52);
      g.rotate(-Math.PI / 2);
      g.fillStyle = "#16181b";
      let size = 64;
      g.font = `700 ${size}px "Barlow Semi Condensed", "Arial Narrow", sans-serif`;
      const max = h * 0.78;
      const measured = g.measureText(text).width;
      if (measured > max) {
        size = Math.floor((size * max) / measured);
        g.font = `700 ${size}px "Barlow Semi Condensed", "Arial Narrow", sans-serif`;
      }
      g.textAlign = "center";
      g.textBaseline = "middle";
      g.fillText(text, 0, 0);
      g.restore();
    }
    bodyTexture.needsUpdate = true;
  };
  paintBody(name);

  const white = new THREE.MeshStandardMaterial({ color: 0xeceef0, roughness: 0.42 });
  const black = new THREE.MeshStandardMaterial({ color: 0x17191c, roughness: 0.5, metalness: 0.2 });
  const cyl = (top: number, bottom: number, height: number, y: number, m: THREE.Material, segments = 48) => {
    const c = new THREE.Mesh(new THREE.CylinderGeometry(top, bottom, height, segments, 1, true), m);
    c.position.y = y;
    c.castShadow = true;
    c.receiveShadow = true;
    rocket.add(c);
    return c;
  };
  cyl(R, R, S1_TOP - MOUNT_TOP, (MOUNT_TOP + S1_TOP) / 2, new THREE.MeshStandardMaterial({ map: bodyTexture, roughness: 0.45 }));
  cyl(R, R, INTER_TOP - S1_TOP, (S1_TOP + INTER_TOP) / 2, black);
  cyl(R, R, S2_TOP - INTER_TOP, (INTER_TOP + S2_TOP) / 2, white);
  // Fairing: an ogive turned on a lathe, with its seam.
  const ogive: THREE.Vector2[] = [];
  for (let i = 0; i <= 24; i++) {
    const t = i / 24;
    ogive.push(new THREE.Vector2(R * Math.sqrt(Math.max(0, 1 - t * t)) * (1 - 0.04 * t), S2_TOP + t * (NOSE - S2_TOP)));
  }
  const fairing = new THREE.Mesh(new THREE.LatheGeometry(ogive, 48), white);
  fairing.castShadow = true;
  rocket.add(fairing);
  cyl(R + 0.02, R + 0.02, 0.12, S2_TOP + 0.5, black);
  const base = new THREE.Mesh(new THREE.CircleGeometry(R, 48), black);
  base.rotation.x = Math.PI / 2;
  base.position.y = MOUNT_TOP;
  rocket.add(base);
  // Grid fins and folded legs: this one comes back.
  for (let i = 0; i < 4; i++) {
    const a = (i * Math.PI) / 2 + Math.PI / 4;
    const fin = new THREE.Mesh(new THREE.BoxGeometry(1.3, 1.1, 0.12), black);
    fin.position.set(Math.cos(a) * (R + 0.45), S1_TOP - 0.9, Math.sin(a) * (R + 0.45));
    fin.rotation.y = -a + Math.PI / 2;
    fin.castShadow = true;
    rocket.add(fin);
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.55, 9, 0.35), black);
    leg.position.set(Math.cos(a + Math.PI / 4) * (R + 0.12), MOUNT_TOP + 4.8, Math.sin(a + Math.PI / 4) * (R + 0.12));
    leg.rotation.y = -(a + Math.PI / 4) + Math.PI / 2;
    leg.castShadow = true;
    rocket.add(leg);
  }
  // Nine engines hanging into the mount.
  const bell: THREE.Vector2[] = [];
  for (let i = 0; i <= 12; i++) {
    const t = i / 12;
    bell.push(new THREE.Vector2(0.18 + 0.4 * t ** 1.6, -t * 1.7));
  }
  const bellGeo = new THREE.LatheGeometry(bell, 28);
  const bellMat = new THREE.MeshStandardMaterial({ color: 0x3a3634, roughness: 0.35, metalness: 0.85, side: THREE.DoubleSide });
  const bellPos: Array<[number, number]> = [[0, 0]];
  for (let i = 0; i < 8; i++) bellPos.push([Math.cos((i * Math.PI) / 4) * 1.22, Math.sin((i * Math.PI) / 4) * 1.22]);
  for (const [x, z] of bellPos) {
    const b = new THREE.Mesh(bellGeo, bellMat);
    b.position.set(x, MOUNT_TOP - 0.05, z);
    b.castShadow = true;
    rocket.add(b);
  }

  // ── The service tower: a lattice, arms to the rocket, a mast on top ──
  const beamGeo = new THREE.BoxGeometry(1, 1, 1);
  const beams: THREE.Matrix4[] = [];
  const beam = (a: THREE.Vector3, b: THREE.Vector3, w: number) => {
    const d = b.clone().sub(a);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.clone().normalize());
    m.compose(a.clone().add(b).multiplyScalar(0.5), q, new THREE.Vector3(w, d.length(), w));
    beams.push(m);
  };
  const half = 2.6;
  const corners = [[-half, -half], [half, -half], [half, half], [-half, half]] as const;
  const at = (i: number, y: number) => new THREE.Vector3(TOWER_X + corners[i % 4]![0], y, corners[i % 4]![1]);
  for (let i = 0; i < 4; i++) beam(at(i, DECK), at(i, TOWER_TOP), 0.45);
  for (let y = DECK; y < TOWER_TOP; y += 3.5) {
    const y2 = Math.min(TOWER_TOP, y + 3.5);
    for (let i = 0; i < 4; i++) {
      beam(at(i, y2), at(i + 1, y2), 0.22);
      beam(at(i, y), at(i + 1, y2), 0.14);
    }
  }
  const tower = new THREE.InstancedMesh(beamGeo, mat(0x6b4a3a, 0.7, 0.35), beams.length);
  beams.forEach((m, i) => tower.setMatrixAt(i, m));
  tower.castShadow = true;
  tower.receiveShadow = true;
  scene.add(tower);
  const towerSteel = mat(0x5c6168, 0.6, 0.5);
  // Crew access arm with its white room, and an umbilical arm lower down.
  const face = TOWER_X + half;
  box(Math.abs(face + R + 2.3), 1.2, 1.8, (face - R - 2.3) / 2, NOSE - 12, 0, towerSteel);
  box(2.2, 2.6, 2.4, -(R + 1.2), NOSE - 10.8, 0, mat(0xd8dadc, 0.6));
  box(Math.abs(TOWER_X + half + R + 0.3), 0.7, 0.8, (TOWER_X + half - R - 0.3) / 2, INTER_TOP + 1, 0.9, towerSteel);
  box(Math.abs(TOWER_X + half + R + 0.3), 0.7, 0.8, (TOWER_X + half - R - 0.3) / 2, MOUNT_TOP + 8, -0.6, towerSteel);
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.35, 16, 8), towerSteel);
  mast.position.set(TOWER_X, TOWER_TOP + 8, 0);
  scene.add(mast);
  const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.45, 12, 8), new THREE.MeshBasicMaterial({ color: 0xff2a1a }));
  beacon.position.set(TOWER_X, TOWER_TOP + 16.3, 0);
  scene.add(beacon);

  // A water tower across the pad, and the lightning masts.
  const waterLeg = mat(0x7e8287, 0.7, 0.3);
  for (let i = 0; i < 4; i++) {
    const a = (i * Math.PI) / 2;
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, 34, 8), waterLeg);
    leg.position.set(58 + Math.cos(a) * 3.5, 17, -58 + Math.sin(a) * 3.5);
    leg.castShadow = true;
    scene.add(leg);
  }
  const tank = new THREE.Mesh(new THREE.SphereGeometry(6.5, 24, 16), mat(0xc9ccd0, 0.5, 0.2));
  tank.position.set(58, 38, -58);
  tank.castShadow = true;
  scene.add(tank);

  // ── Floodlights: poles at the corners, two of them really lighting the rocket ──
  const glowCanvas = document.createElement("canvas");
  glowCanvas.width = glowCanvas.height = 64;
  const gg = glowCanvas.getContext("2d")!;
  const grad = gg.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, "rgba(255,255,255,1)");
  grad.addColorStop(0.2, "rgba(220,232,255,0.55)");
  grad.addColorStop(1, "rgba(200,215,255,0)");
  gg.fillStyle = grad;
  gg.fillRect(0, 0, 64, 64);
  const glowMat = new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(glowCanvas), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, fog: false });
  const lamps: Array<[number, number, boolean]> = [[32, 30, true], [-30, 34, true], [30, -32, true], [-34, -30, false]];
  for (const [x, z, lit] of lamps) {
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.4, 26, 8), mat(0x55595e, 0.6, 0.4));
    pole.position.set(x, DECK + 13, z);
    pole.castShadow = true;
    scene.add(pole);
    const head = new THREE.Mesh(new THREE.BoxGeometry(2.4, 1.2, 0.5), new THREE.MeshStandardMaterial({ color: 0x222222, emissive: 0xf4f7ff, emissiveIntensity: 1.6 }));
    head.position.set(x, DECK + 26.5, z);
    head.lookAt(0, 30, 0);
    scene.add(head);
    const glow = new THREE.Sprite(glowMat);
    glow.position.copy(head.position).lerp(new THREE.Vector3(0, 30, 0), 0.02);
    glow.scale.setScalar(9);
    scene.add(glow);
    if (!lit) continue;
    const spot = new THREE.SpotLight(0xdfe8ff, 3800, 0, 0.5, 0.7, 1.6);
    spot.position.copy(head.position);
    spot.target.position.set(0, 36, 0);
    scene.add(spot, spot.target);
  }
  // Work lights in the flame trench, on the engines.
  const trench = new THREE.PointLight(0xffc48a, 90, 18, 1.6);
  trench.position.set(0, 3.4, 4);
  scene.add(trench);

  // ── Vapour: oxygen boiling off at the vents, and steam round the mount ──
  const N = 320;
  const vPos = new Float32Array(N * 3);
  const vAlpha = new Float32Array(N);
  const vSize = new Float32Array(N);
  const vel = new Float32Array(N * 3);
  const age = new Float32Array(N);
  const life = new Float32Array(N);
  const vents: Array<{ y: number; r: number; sink: number; spread: number; weight: number }> = [
    { y: S1_TOP + 0.6, r: R, sink: -0.9, spread: 0.9, weight: 0.4 },
    { y: S2_TOP - 1, r: R, sink: -0.7, spread: 0.6, weight: 0.2 },
    { y: MOUNT_TOP - 1.4, r: 3.5, sink: 0.25, spread: 1.8, weight: 0.4 },
  ];
  const spawn = (i: number, warm: boolean) => {
    let pick = Math.random();
    const v = vents.find((x) => (pick -= x.weight) < 0) ?? vents[0]!;
    const a = v === vents[2] ? Math.random() * Math.PI * 2 : -0.4 + Math.random() * 1.4 + (Math.random() < 0.5 ? 0 : Math.PI);
    vPos[i * 3] = Math.cos(a) * v.r;
    vPos[i * 3 + 1] = v.y + (Math.random() - 0.5) * 0.5;
    vPos[i * 3 + 2] = Math.sin(a) * v.r;
    vel[i * 3] = Math.cos(a) * v.spread + 0.6;
    vel[i * 3 + 1] = v.sink;
    vel[i * 3 + 2] = Math.sin(a) * v.spread;
    life[i] = 3 + Math.random() * 3;
    age[i] = warm ? Math.random() * life[i] : 0;
  };
  for (let i = 0; i < N; i++) spawn(i, true);
  const vGeo = new THREE.BufferGeometry();
  vGeo.setAttribute("position", new THREE.BufferAttribute(vPos, 3));
  vGeo.setAttribute("alpha", new THREE.BufferAttribute(vAlpha, 1));
  vGeo.setAttribute("size", new THREE.BufferAttribute(vSize, 1));
  const vapour = new THREE.Points(
    vGeo,
    new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: { scale: { value: host.clientHeight } },
      vertexShader: `
        attribute float alpha; attribute float size; uniform float scale; varying float vAlpha;
        void main() { vAlpha = alpha; vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_PointSize = size * scale / -mv.z; gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `
        varying float vAlpha;
        void main() { float d = length(gl_PointCoord - 0.5); float a = smoothstep(0.5, 0.0, d) * vAlpha; gl_FragColor = vec4(vec3(0.78, 0.81, 0.88), a); }`,
    }),
  );
  vapour.frustumCulled = false;
  scene.add(vapour);
  const stepVapour = (dt: number) => {
    for (let i = 0; i < N; i++) {
      age[i]! += dt;
      if (age[i]! > life[i]!) spawn(i, false);
      const t = age[i]! / life[i]!;
      vel[i * 3 + 1]! -= 0.12 * dt; // cold vapour sinks
      vel[i * 3]! *= 1 - 0.3 * dt;
      vel[i * 3 + 2]! *= 1 - 0.3 * dt;
      vPos[i * 3]! += (vel[i * 3]! + 0.5) * dt; // a light breeze toward +x
      vPos[i * 3 + 1] = Math.max(DECK + 0.3, vPos[i * 3 + 1]! + vel[i * 3 + 1]! * dt);
      vPos[i * 3 + 2]! += vel[i * 3 + 2]! * dt;
      vAlpha[i] = Math.sin(Math.PI * t) * 0.17;
      vSize[i] = 1.6 + t * 5.5;
    }
    vGeo.attributes.position!.needsUpdate = true;
    vGeo.attributes.alpha!.needsUpdate = true;
    vGeo.attributes.size!.needsUpdate = true;
  };

  // ── Cameras ──
  let shot = 0;
  let shotStart = performance.now();
  const look = new THREE.Vector3();
  const place = (t: number) => {
    const s = SHOTS[shot]!;
    const e = ease(t);
    camera.position.set(...s.from).lerp(new THREE.Vector3(...s.to), e);
    look.set(...s.lookFrom).lerp(new THREE.Vector3(...s.lookTo), e);
    camera.fov = s.fov[0] + (s.fov[1] - s.fov[0]) * e;
    camera.updateProjectionMatrix();
    camera.lookAt(look);
  };
  const cut = (index: number) => {
    shot = ((index % SHOTS.length) + SHOTS.length) % SHOTS.length;
    shotStart = performance.now();
    onShot(shot);
  };

  const resize = () => {
    const w = host.clientWidth;
    const h = host.clientHeight;
    if (w === 0 || h === 0) return;
    renderer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    (vapour.material as THREE.ShaderMaterial).uniforms.scale!.value = h * renderer.getPixelRatio();
  };
  const observer = new ResizeObserver(resize);
  observer.observe(host);
  resize();

  // Warm the vapour up so the first frame isn't empty.
  for (let i = 0; i < 60; i++) stepVapour(1 / 30);

  let frame = 0;
  let last = performance.now();
  const loop = (now: number) => {
    frame = requestAnimationFrame(loop);
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    if (document.hidden) return;
    const elapsed = (now - shotStart) / 1000;
    if (reduced) {
      place(0.5);
      fade.style.opacity = "0";
    } else {
      if (elapsed > SHOT_SECONDS) cut(shot + 1);
      const into = (now - shotStart) / 1000;
      place(Math.min(1, into / SHOT_SECONDS));
      const edge = Math.min(into, SHOT_SECONDS - into);
      fade.style.opacity = String(Math.max(0, 1 - edge / FADE_SECONDS));
      stepVapour(dt);
    }
    beacon.visible = Math.floor(now / 900) % 2 === 0;
    renderer.render(scene, camera);
  };
  frame = requestAnimationFrame(loop);
  onShot(0);

  return {
    shots: SHOTS.map((s) => s.name),
    setName: paintBody,
    cut,
    dispose() {
      cancelAnimationFrame(frame);
      observer.disconnect();
      scene.traverse((o) => {
        const m = o as THREE.Mesh;
        m.geometry?.dispose();
        const mats = Array.isArray(m.material) ? m.material : m.material ? [m.material] : [];
        for (const x of mats) {
          (x as THREE.MeshStandardMaterial).map?.dispose();
          x.dispose();
        }
      });
      renderer.dispose();
      renderer.domElement.remove();
      fade.remove();
    },
  };
}

/** Whether this browser can draw the pad at all. */
export function canDraw(): boolean {
  try {
    const c = document.createElement("canvas");
    return !!(c.getContext("webgl2") ?? c.getContext("webgl"));
  } catch {
    return false;
  }
}

export const SHOT_NAMES = SHOTS.map((s) => s.name);
