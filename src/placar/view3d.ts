/**
 * Teacher screen live view: one small 3D copy of each team's table (protein + molecules), rebuilt from the poses
 * the headsets send ~8 times per second. One WebGL canvas, one scissored viewport per team card.
 */
import * as THREE from 'three'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import { LEVEL_BY_ID, MOLECULES, TARGETS, type MoleculeId } from '../game/data'
import { buildMolecule, buildReceptor } from '../game/models'
import { placeReceptor, receptorX } from '../game/layout'
import type { PoseMsg } from '../net/room'

type Target = { p: THREE.Vector3; q: THREE.Quaternion; s: string }
type TeamView = {
  scene: THREE.Scene
  levelId: number | null
  mols: Map<string, { obj: THREE.Group; target: Target | null }>
  lastPose: number
}

const FIT_RING: Record<string, number> = { strong: 0x3ee6b0, weak: 0xffb347 }

export class LiveView {
  readonly renderer: THREE.WebGLRenderer
  private camera = new THREE.PerspectiveCamera(50, 1.6, 0.02, 30)
  teams: TeamView[] = []
  private env: THREE.Texture

  constructor(readonly canvas: HTMLCanvasElement, private cells: () => (HTMLElement | null)[]) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    this.renderer.outputColorSpace = THREE.SRGBColorSpace
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping
    this.renderer.setScissorTest(true)
    const pmrem = new THREE.PMREMGenerator(this.renderer)
    this.env = pmrem.fromScene(new RoomEnvironment(), 0.04).texture
    pmrem.dispose()
    for (let i = 0; i < 4; i++) this.teams.push(this.makeTeam())
  }

  private makeTeam(): TeamView {
    const scene = new THREE.Scene()
    scene.environment = this.env
    scene.environmentIntensity = 0.3
    scene.add(new THREE.HemisphereLight(0xdcd6ff, 0x2a1f4a, 1.25))
    const key = new THREE.DirectionalLight(0xffffff, 1.6)
    key.position.set(0.6, 2.5, 1.4)
    scene.add(key)
    return { scene, levelId: null, mols: new Map(), lastPose: 0 }
  }

  /** Shows the stage's proteins on every card (called when a round starts). */
  setLevel(levelId: number | null): void {
    for (let i = 0; i < this.teams.length; i++) {
      const old = this.teams[i]
      if (old.levelId === levelId) continue
      const tv = this.makeTeam()
      tv.levelId = levelId
      const level = levelId !== null ? LEVEL_BY_ID.get(levelId) : null
      if (level) {
        level.targets.forEach((tid, k) => {
          const model = buildReceptor(TARGETS[tid])
          placeReceptor(TARGETS[tid], receptorX(k, level.targets.length), model.root.position, model.root.quaternion)
          tv.scene.add(model.root)
        })
      }
      this.teams[i] = tv
    }
  }

  pose(msg: PoseMsg): void {
    const tv = this.teams[msg.team]
    if (!tv) return
    tv.lastPose = performance.now()
    const seen = new Set<string>()
    for (const m of msg.mols) {
      if (!(m.id in MOLECULES)) continue
      seen.add(m.id)
      let entry = tv.mols.get(m.id)
      if (!entry) {
        const obj = buildMolecule(MOLECULES[m.id as MoleculeId])
        obj.position.set(...m.p)
        obj.quaternion.set(...m.q)
        tv.scene.add(obj)
        const ring = new THREE.Mesh(new THREE.TorusGeometry(0.075, 0.005, 8, 40),
          new THREE.MeshBasicMaterial({ color: 0x3ee6b0, transparent: true, opacity: 0, toneMapped: false }))
        ring.name = 'fitRing'
        obj.add(ring)
        entry = { obj, target: null }
        tv.mols.set(m.id, entry)
      }
      entry.target = { p: new THREE.Vector3(...m.p), q: new THREE.Quaternion(...m.q).normalize(), s: m.s }
    }
    for (const [id, e] of tv.mols) if (!seen.has(id)) { tv.scene.remove(e.obj); tv.mols.delete(id) }
  }

  /** Clears the molecules of every card (between rounds). */
  clear(): void {
    for (const tv of this.teams) { for (const e of tv.mols.values()) tv.scene.remove(e.obj); tv.mols.clear() }
  }

  render(dt: number): void {
    const w = this.canvas.clientWidth
    const h = this.canvas.clientHeight
    if (this.canvas.width !== Math.floor(w * this.renderer.getPixelRatio()) || this.canvas.height !== Math.floor(h * this.renderer.getPixelRatio())) {
      this.renderer.setSize(w, h, false)
    }
    this.renderer.setScissor(0, 0, w, h)
    this.renderer.setClearColor(0x000000, 0)
    this.renderer.clear()
    const base = this.canvas.getBoundingClientRect()
    const k = 1 - Math.exp(-dt * 12)
    this.cells().forEach((cell, i) => {
      const tv = this.teams[i]
      if (!cell || !tv || cell.offsetParent === null) return
      const r = cell.getBoundingClientRect()
      const x = r.left - base.left
      const y = base.bottom - r.bottom
      if (r.width < 10 || r.height < 10) return
      for (const e of tv.mols.values()) {
        if (!e.target) continue
        e.obj.position.lerp(e.target.p, k)
        e.obj.quaternion.slerp(e.target.q, k)
        const s = e.target.s === 'held' ? 1.15 : 1
        e.obj.scale.lerp(new THREE.Vector3(s, s, s), k)
        const ring = e.obj.getObjectByName('fitRing') as THREE.Mesh | undefined
        if (ring) {
          const mat = ring.material as THREE.MeshBasicMaterial
          const c = FIT_RING[e.target.s]
          mat.opacity = c ? 0.9 : 0
          if (c) mat.color.setHex(c)
        }
      }
      // Player's view of the table (protein + tray), a bit closer than the game's flat-screen framing.
      const aspect = r.width / r.height
      const fov = 50
      const halfH = Math.atan(Math.tan(THREE.MathUtils.degToRad(fov / 2)) * aspect)
      const z = Math.max(0.5, -0.5 + 0.92 / Math.tan(halfH))
      this.camera.fov = fov
      this.camera.aspect = aspect
      this.camera.position.set(0, 1.46 + Math.min(0.3, (z - 0.6) * 0.15), z)
      this.camera.lookAt(0, 1.17, -0.62)
      this.camera.updateProjectionMatrix()
      this.renderer.setViewport(x, y, r.width, r.height)
      this.renderer.setScissor(x, y, r.width, r.height)
      this.renderer.render(tv.scene, this.camera)
    })
  }

  /** Seconds since this team's headset last sent its molecules. */
  silence(team: number): number {
    const tv = this.teams[team]
    return tv && tv.lastPose ? (performance.now() - tv.lastPose) / 1000 : Infinity
  }
}
