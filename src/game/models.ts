import * as THREE from 'three'
import { t as tr } from '../i18n'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { CHEM_COLOR, type Chem, type MoleculeDef, type TargetDef, type TargetId } from './data'
import PROTEINS from './proteins.json'

/** Distance from molecule/pocket center to each arm group / cavity center (meters). Mirrors scripts/proteins/build.py. */
export const ARM_R = 0.058
export const BALL_R = [0.008, 0.014, 0.022, 0.031]
export const HOLE_R = [0, 0.019, 0.027, 0.036]
export const POCKET_R = 0.118

export type ProteinMeta = {
  id: string; pdb: string; scale: number; faces: number
  bboxMin: [number, number, number]; bboxMax: [number, number, number]
  cavities: { size: number; chem: string }[]
  membrane?: {
    zOuter: number; zInner: number; xMin: number; xMax: number; yMin: number; yMax: number
    bottom: number; spacing: number; outer: [number, number][]; inner: [number, number][]
  }
  bottomCenter?: [number, number, number]
}
export const PROTEIN_META = PROTEINS as unknown as Record<TargetId, ProteinMeta>

/** Arm/cavity i direction in the local XY plane (arm 0 points up). */
export function armDir(i: number, out = new THREE.Vector3()): THREE.Vector3 {
  const a = Math.PI / 2 + (i * 2 * Math.PI) / 3
  return out.set(Math.cos(a), Math.sin(a), 0)
}

// ------------------------------------------------------------------ protein surfaces (real PDB structures)

const surfaces = new Map<TargetId, THREE.BufferGeometry>()

/** Loads the pre-computed molecular surfaces (public/proteins/*.glb). */
export async function loadProteins(onProgress: (f: number) => void): Promise<void> {
  const loader = new GLTFLoader()
  const ids = Object.keys(PROTEIN_META) as TargetId[]
  let done = 0
  await Promise.all(ids.map(async id => {
    const gltf = await loader.loadAsync(`${import.meta.env.BASE_URL}proteins/${id}.glb`)
    let mesh: THREE.Mesh | null = null
    gltf.scene.traverse(o => { if (!mesh && (o as THREE.Mesh).isMesh) mesh = o as THREE.Mesh })
    if (!mesh) throw new Error(`superfície vazia: ${id}`)
    const m = mesh as THREE.Mesh
    gltf.scene.updateMatrixWorld(true)
    // Files are quantized (KHR_mesh_quantization): decode positions/normals to float, then bake the node transform.
    const geo = new THREE.BufferGeometry()
    for (const [name, attr] of Object.entries(m.geometry.attributes)) {
      const src = attr as THREE.BufferAttribute
      if (name === 'color') { geo.setAttribute(name, src); continue }
      const out = new Float32Array(src.count * src.itemSize)
      for (let i = 0; i < src.count; i++) for (let k = 0; k < src.itemSize; k++) out[i * src.itemSize + k] = src.getComponent(i, k)
      geo.setAttribute(name, new THREE.BufferAttribute(out, src.itemSize))
    }
    if (m.geometry.index) geo.setIndex(m.geometry.index)
    geo.applyMatrix4(m.matrixWorld)
    surfaces.set(id, geo)
    onProgress(++done / ids.length)
  }))
}

// ------------------------------------------------------------------ icons

const iconCache = new Map<string, THREE.Texture>()
/** Small white glyph used inside cavities and on groups (helps color-blind players). */
export function chemIcon(chem: Chem): THREE.Texture {
  const hit = iconCache.get(chem)
  if (hit) return hit
  const c = document.createElement('canvas')
  c.width = c.height = 128
  const ctx = c.getContext('2d')!
  ctx.strokeStyle = ctx.fillStyle = '#ffffff'
  ctx.lineWidth = 18
  ctx.lineCap = 'round'
  ctx.beginPath()
  if (chem === 'pos') { ctx.moveTo(30, 64); ctx.lineTo(98, 64); ctx.moveTo(64, 30); ctx.lineTo(64, 98); ctx.stroke() }
  else if (chem === 'neg') { ctx.moveTo(30, 64); ctx.lineTo(98, 64); ctx.stroke() }
  else if (chem === 'oil') {
    ctx.lineWidth = 12
    for (const y of [40, 64, 88]) { ctx.moveTo(26, y); ctx.bezierCurveTo(48, y - 14, 80, y + 14, 102, y) }
    ctx.stroke()
  } else {
    ctx.moveTo(64, 20)
    ctx.bezierCurveTo(64, 20, 26, 66, 30, 84)
    ctx.arc(64, 82, 34, Math.PI, 0, true)
    ctx.bezierCurveTo(102, 66, 64, 20, 64, 20)
    ctx.fill()
  }
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  iconCache.set(chem, tex)
  return tex
}

const geoCache = new Map<string, THREE.BufferGeometry>()
function cached<T extends THREE.BufferGeometry>(key: string, make: () => T): T {
  let geo = geoCache.get(key)
  if (!geo) { geo = make(); geoCache.set(key, geo) }
  return geo as T
}

// ------------------------------------------------------------------ ligands (ball-and-stick, fictional)

const ATOM_R = 0.0074
const H_R = 0.0046
const BOND_R = 0.0027
const CORE_COLOR = 0xe4e7ef

const matCache = new Map<string, THREE.Material>()
function atomMat(color: number, emissive = 0.12): THREE.MeshStandardMaterial {
  const key = `a${color}`
  let m = matCache.get(key) as THREE.MeshStandardMaterial | undefined
  if (!m) {
    m = new THREE.MeshStandardMaterial({ color, roughness: 0.3, metalness: 0.0, emissive: color, emissiveIntensity: emissive })
    matCache.set(key, m)
  }
  return m
}

/** Glassy bubble whose edge glows in the group's chemistry color (fresnel): readable from any angle. */
function auraMat(color: number): THREE.ShaderMaterial {
  const key = `aura${color}`
  let m = matCache.get(key) as THREE.ShaderMaterial | undefined
  if (!m) {
    m = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false,
      uniforms: { color: { value: new THREE.Color(color) } },
      vertexShader: `varying vec3 vN; varying vec3 vV;
        void main(){ vec4 mv = modelViewMatrix * vec4(position,1.0); vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `uniform vec3 color; varying vec3 vN; varying vec3 vV;
        void main(){ float f = 1.0 - abs(dot(normalize(vN), normalize(vV))); float a = 0.2 + 0.75 * pow(f, 2.2);
          gl_FragColor = vec4(color * (0.9 + f * 0.6), a); }`,
    })
    matCache.set(key, m)
  }
  return m
}

export function buildMolecule(def: MoleculeDef): THREE.Group {
  const root = new THREE.Group()
  root.name = def.id
  const atomGeo = cached('atom', () => new THREE.SphereGeometry(1, 20, 14))
  const bondGeo = cached('bond', () => new THREE.CylinderGeometry(1, 1, 1, 8))
  const up = new THREE.Vector3(0, 1, 0)
  const atom = (p: THREE.Vector3, color: number, r = ATOM_R) => {
    const m = new THREE.Mesh(atomGeo, atomMat(color, color === CORE_COLOR ? 0.04 : 0.18))
    m.scale.setScalar(r)
    m.position.copy(p)
    root.add(m)
  }
  const bond = (a: THREE.Vector3, b: THREE.Vector3, color: number, r = BOND_R) => {
    const d = b.clone().sub(a)
    const m = new THREE.Mesh(bondGeo, atomMat(color, 0.05))
    m.scale.set(r, d.length(), r)
    m.position.copy(a).addScaledVector(d, 0.5)
    m.quaternion.setFromUnitVectors(up, d.normalize())
    root.add(m)
  }
  // Neutral core: a six-atom ring; arms leave from vertices 0, 2, 4 (= arm directions).
  const ringR = 0.017
  const ring: THREE.Vector3[] = []
  for (let k = 0; k < 6; k++) {
    const a = Math.PI / 2 + (k * Math.PI) / 3
    ring.push(new THREE.Vector3(Math.cos(a) * ringR, Math.sin(a) * ringR, 0))
  }
  ring.forEach((p, k) => { atom(p, CORE_COLOR); bond(p, ring[(k + 1) % 6], CORE_COLOR, k % 2 ? BOND_R : BOND_R * 1.3) })

  const dir = new THREE.Vector3()
  const side = new THREE.Vector3()
  def.groups.forEach((gr, i) => {
    armDir(i, dir)
    side.set(-dir.y, dir.x, 0)
    const start = ring[(i * 2) % 6]
    if (gr.size === 0) {
      const tip = dir.clone().multiplyScalar(ringR + 0.012)
      bond(start, tip, CORE_COLOR)
      atom(tip, CORE_COLOR, H_R)
      return
    }
    const color = CHEM_COLOR[gr.chem]
    const c = dir.clone().multiplyScalar(ARM_R)
    let pts: THREE.Vector3[]
    if (gr.size === 1) pts = [c.clone().addScaledVector(dir, -0.004)]
    else if (gr.size === 2) {
      const center = c.clone().addScaledVector(dir, -0.008)
      pts = [center,
        center.clone().addScaledVector(dir, 0.011).addScaledVector(side, 0.0115),
        center.clone().addScaledVector(dir, 0.011).addScaledVector(side, -0.0115)]
    } else {
      const rr = 0.0145
      pts = []
      for (let k = 0; k < 6; k++) {
        const a = Math.atan2(dir.y, dir.x) + Math.PI + (k * Math.PI) / 3
        pts.push(c.clone().add(new THREE.Vector3(Math.cos(a) * rr, Math.sin(a) * rr, 0)))
      }
    }
    const link = start.clone().lerp(pts[0], 0.5)
    bond(start, link, CORE_COLOR)
    atom(link, CORE_COLOR)
    bond(link, pts[0], color)
    pts.forEach((p, k) => {
      atom(p, color, gr.size === 1 ? ATOM_R * 1.25 : ATOM_R)
      if (gr.size === 2 && k > 0) bond(pts[0], p, color)
      if (gr.size === 3) bond(p, pts[(k + 1) % 6], color, k % 2 ? BOND_R : BOND_R * 1.3)
    })
    // Size + chemistry bubble (same size as the cavity it needs).
    const aura = new THREE.Mesh(atomGeo, auraMat(color))
    aura.scale.setScalar(HOLE_R[gr.size] * 0.86)
    aura.position.copy(c)
    aura.userData.arm = i
    aura.renderOrder = 1
    root.add(aura)
    for (const sgn of [1, -1]) {
      const icon = new THREE.Mesh(cached('icon', () => new THREE.PlaneGeometry(1, 1)),
        new THREE.MeshBasicMaterial({ map: chemIcon(gr.chem as Chem), color: 0xffffff, transparent: true, depthWrite: false, depthTest: false, toneMapped: false }))
      icon.scale.setScalar(Math.min(0.022, HOLE_R[gr.size] * 0.8))
      icon.position.copy(c).setZ(sgn * HOLE_R[gr.size] * 0.86)
      if (sgn < 0) icon.rotation.y = Math.PI
      icon.renderOrder = 3
      root.add(icon)
    }
  })
  const hit = new THREE.Mesh(cached('hit', () => new THREE.SphereGeometry(0.095, 12, 8)), new THREE.MeshBasicMaterial({ visible: false }))
  hit.userData.grab = true
  root.add(hit)
  root.userData.hit = hit
  return root
}

// ------------------------------------------------------------------ receptor

export type ReceptorModel = {
  root: THREE.Group
  /** Group whose origin is the pocket center, facing +Z. */
  pocket: THREE.Group
  rings: THREE.Mesh[]
  glow: THREE.Mesh
  body: THREE.Group
  bodyMat: THREE.MeshStandardMaterial
  meta: ProteinMeta
  /** Explanatory labels attached to the model (cell outside/inside). */
  labels: THREE.Sprite[]
}

/** Soft "clay" protein material: vertex colours, rim light (fresnel) and an activity glow. */
function proteinMaterial(glow: number): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, color: new THREE.Color(0.8, 0.8, 0.86), roughness: 0.55, metalness: 0.0, emissive: glow, emissiveIntensity: 0, envMapIntensity: 0.35 })
  m.onBeforeCompile = sh => {
    sh.fragmentShader = sh.fragmentShader.replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
      float rimF = pow(1.0 - clamp(dot(normalize(vNormal), normalize(vViewPosition)), 0.0, 1.0), 2.5);
      totalEmissiveRadiance += vec3(0.55, 0.68, 1.0) * rimF * 0.22;`)
  }
  return m
}

export function buildReceptor(def: TargetDef): ReceptorModel {
  const meta = PROTEIN_META[def.id]
  const root = new THREE.Group()
  root.name = def.id
  const body = new THREE.Group()
  root.add(body)
  const bodyMat = proteinMaterial(def.color)
  const geo = surfaces.get(def.id)
  if (geo) body.add(new THREE.Mesh(geo, bodyMat))

  const pocket = new THREE.Group()
  root.add(pocket)
  // Highlight shown when a held molecule is close enough to try the fit.
  const glow = new THREE.Mesh(cached('glowRing', () => new THREE.RingGeometry(POCKET_R - 0.006, POCKET_R, 64)),
    new THREE.MeshBasicMaterial({ color: 0x3ee6b0, transparent: true, opacity: 0, depthTest: false, toneMapped: false, side: THREE.DoubleSide }))
  glow.position.z = 0.03
  glow.renderOrder = 5
  pocket.add(glow)
  const rings: THREE.Mesh[] = []
  const dir = new THREE.Vector3()
  def.cavities.forEach((cav, i) => {
    armDir(i, dir).multiplyScalar(ARM_R)
    const r = HOLE_R[cav.size]
    const color = CHEM_COLOR[cav.chem]
    // Glowing ring at the depth where the group will sit, deep inside the carved well.
    const ring = new THREE.Mesh(cached(`ring${cav.size}`, () => new THREE.TorusGeometry(r - 0.004, 0.0028, 8, 40)),
      new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.6, roughness: 0.4 }))
    ring.position.set(dir.x, dir.y, -0.004)
    pocket.add(ring)
    rings.push(ring)
    const icon = new THREE.Mesh(cached('cavIcon', () => new THREE.PlaneGeometry(1, 1)),
      new THREE.MeshBasicMaterial({ map: chemIcon(cav.chem), transparent: true, opacity: 0.9, depthWrite: false, color: 0xffffff, toneMapped: false }))
    icon.scale.setScalar(Math.min(r * 1.0, 0.026))
    icon.position.set(dir.x, dir.y, -r * 0.7)
    pocket.add(icon)
    if (i === def.switchCavity) {
      // Dashed ring marks the on/off switch.
      const sw = new THREE.Group()
      const n = 12
      for (let k = 0; k < n; k++) {
        const seg = new THREE.Mesh(new THREE.RingGeometry(r + 0.003, r + 0.008, 6, 1, (k / n) * Math.PI * 2, (Math.PI * 2) / n * 0.55),
          new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85, side: THREE.DoubleSide, toneMapped: false }))
        sw.add(seg)
      }
      sw.position.set(dir.x, dir.y, 0.0)
      sw.userData.switch = true
      pocket.add(sw)
    }
  })

  const labels: THREE.Sprite[] = []
  if (meta.membrane) root.add(buildMembrane(meta.membrane, labels))
  return { root, pocket, rings, glow, body, bodyMat, meta, labels }
}

/**
 * Textbook cut-away of the cell membrane: two layers of lipid "heads" with the oily tails in between,
 * the cell's inside (cytoplasm) below and the outside above. Coordinates: pocket frame (+Z = outside).
 */
function buildMembrane(m: NonNullable<ProteinMeta['membrane']>, labels: THREE.Sprite[]): THREE.Group {
  const g = new THREE.Group()
  const headR = m.spacing * 0.5
  const headGeo = cached('lipidHead', () => new THREE.SphereGeometry(1, 14, 10))
  const headMat = new THREE.MeshStandardMaterial({ color: 0xffb98f, roughness: 0.5, emissive: 0xff8a5c, emissiveIntensity: 0.08 })
  const all = [...m.outer.map(h => [h[0], h[1], m.zOuter, -1]), ...m.inner.map(h => [h[0], h[1], m.zInner, 1])]
  const heads = new THREE.InstancedMesh(headGeo, headMat, all.length)
  const mat = new THREE.Matrix4()
  const q = new THREE.Quaternion()
  const sc = new THREE.Vector3(headR, headR, headR)
  all.forEach(([x, y, z], i) => heads.setMatrixAt(i, mat.compose(new THREE.Vector3(x, y, z), q, sc)))
  g.add(heads)
  // Oily tails, drawn on the cut faces (front and sides) where they can be seen.
  const tailLen = (m.zOuter - m.zInner) / 2 - headR * 0.6
  const tailGeo = cached('lipidTail', () => new THREE.CylinderGeometry(0.0042, 0.0032, 1, 6).rotateX(Math.PI / 2))
  const edge = all.filter(([x, y]) => y < m.yMin + m.spacing * 0.9 || x < m.xMin + m.spacing * 0.6 || x > m.xMax - m.spacing * 0.6)
  const tails = new THREE.InstancedMesh(tailGeo, new THREE.MeshStandardMaterial({ color: 0xf2d36b, roughness: 0.7 }), edge.length * 2)
  let t = 0
  for (const [x, y, z, sgn] of edge) {
    for (const dx of [-headR * 0.42, headR * 0.42]) {
      tails.setMatrixAt(t++, mat.compose(new THREE.Vector3(x + dx, y - 0.004, z + sgn * (headR * 0.6 + tailLen / 2)), q, new THREE.Vector3(1, 1, tailLen)))
    }
  }
  g.add(tails)
  // Oily core between the layers (yellow = oily, like the game's legend).
  const inset = headR * 0.7
  const core = new THREE.Mesh(new THREE.BoxGeometry(m.xMax - m.xMin - inset, m.yMax - m.yMin - inset, m.zOuter - m.zInner - headR * 1.2),
    new THREE.MeshStandardMaterial({ color: 0xe8c858, roughness: 0.85, transparent: true, opacity: 0.55, depthWrite: false }))
  core.position.set((m.xMin + m.xMax) / 2, (m.yMin + m.yMax) / 2 + inset * 0.5, (m.zOuter + m.zInner) / 2)
  core.renderOrder = -1
  g.add(core)
  // Inside of the cell: translucent cytoplasm block.
  const depth = m.zInner - headR - m.bottom
  const cyto = new THREE.Mesh(new THREE.BoxGeometry(m.xMax - m.xMin + headR * 2, m.yMax - m.yMin + headR * 2, depth),
    new THREE.MeshStandardMaterial({ color: 0xff8fc8, roughness: 0.9, transparent: true, opacity: 0.16, depthWrite: false, side: THREE.DoubleSide }))
  cyto.position.set((m.xMin + m.xMax) / 2, (m.yMin + m.yMax) / 2, m.zInner - headR - depth / 2)
  cyto.renderOrder = -2
  g.add(cyto)
  const edges = new THREE.LineSegments(new THREE.EdgesGeometry(cyto.geometry), new THREE.LineBasicMaterial({ color: 0xff9fd2, transparent: true, opacity: 0.45 }))
  edges.position.copy(cyto.position)
  g.add(edges)
  // Labels.
  const label = (text: string, color: string, x: number, y: number, z: number, w = 0.36) => {
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: labelTexture([{ text, size: 54, bold: true, color }], 720, 110), transparent: true, depthTest: false, toneMapped: false }))
    sp.scale.set(w, w * 110 / 720, 1)
    sp.position.set(x, y, z)
    sp.renderOrder = 8
    g.add(sp)
    labels.push(sp)
  }
  const lx = m.xMin + 0.12
  label(tr('FORA DA CÉLULA'), '#9fe8ff', lx, m.yMin + 0.03, m.zOuter + 0.12)
  label(tr('MEMBRANA'), '#ffd27a', m.xMin - 0.08, m.yMin, (m.zOuter + m.zInner) / 2, 0.26)
  label(tr('DENTRO DA CÉLULA'), '#ffb3dc', lx, m.yMin, m.zInner - 0.09)
  return g
}

export function labelTexture(lines: { text: string; size: number; color?: string; bold?: boolean }[], w = 512, h = 160): THREE.CanvasTexture {
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  const ctx = c.getContext('2d')!
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  const total = lines.reduce((s, l) => s + l.size * 1.2, 0)
  let y = h / 2 - total / 2
  for (const l of lines) {
    y += (l.size * 1.2) / 2
    ctx.font = `${l.bold ? 700 : 400} ${l.size}px ManusCC0, sans-serif`
    ctx.lineWidth = Math.max(4, l.size / 6)
    ctx.strokeStyle = 'rgba(10, 8, 30, 0.9)'
    ctx.strokeText(l.text, w / 2, y)
    ctx.fillStyle = l.color ?? '#ffffff'
    ctx.fillText(l.text, w / 2, y)
    y += (l.size * 1.2) / 2
  }
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}
