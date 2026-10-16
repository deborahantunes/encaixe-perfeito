import * as THREE from 'three'
import type { Audio } from '../core/audio'
import type { Pointer, Pointers } from '../core/pointers'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import { CONFIG } from './config'
import { CHEM_COLOR, LEVELS, MOLECULES, TARGETS, type LevelDef, type MoleculeDef, type MoleculeId, type TargetId } from './data'
import { Fx } from './fx'
import { armDir, buildMolecule, buildReceptor, labelTexture, type ReceptorModel } from './models'
import { MINT, Panel, fitFont, font, roundRect, wrapText } from './panel'
import { t } from '../i18n'
import { EVENT_LEVELS, bestToday, fmtTime, saveBest, saveEventSetting, type EventPhases } from './event'
import { recordError } from '../core/errlog'
import { FIT_TITLE, PERMS, bestFit, effectText, evaluate, rank, type FitResult, type Perm } from './rules'

const V3 = THREE.Vector3
const Q = THREE.Quaternion
const EYE = 1.5
const POCKET_Y = 1.3
const POCKET_Z = -0.72
const FIT_COLOR: Record<string, string> = { strong: '#3ee6b0', weak: '#ffb347', slip: '#c9c4e8', clash: '#ff6b6b', repel: '#ff6b6b' }
const SAVE_KEY = 'encaixe-molecular:v1'

type Ease = (x: number) => number
const easeOut: Ease = x => 1 - Math.pow(1 - x, 3)
const easeInOut: Ease = x => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2)
const easeBack: Ease = x => 1 + 2.2 * Math.pow(x - 1, 3) + 1.2 * Math.pow(x - 1, 2)

type Tween = {
  fromP: THREE.Vector3; toP: THREE.Vector3; fromQ: THREE.Quaternion; toQ: THREE.Quaternion
  t: number; dur: number; ease: Ease; lift: number; fade?: boolean; onDone?: () => void
}

class Mol {
  readonly obj: THREE.Group
  state: 'tray' | 'held' | 'anim' | 'docked' = 'tray'
  readonly home = new V3()
  readonly homeQuat = new Q()
  heldBy: Pointer | null = null
  sticky = false
  readonly grabRel = new Q()
  readonly mouseQuat = new Q()
  readonly dockQuat = new Q()
  tween: Tween | null = null
  dockedIn: Receptor | null = null
  result: FitResult | null = null
  weakTimer = 0
  fails = 0
  hover = 0
  constructor(readonly def: MoleculeDef, readonly disposable: boolean) {
    this.obj = buildMolecule(def)
    ;(this.obj.userData.hit as THREE.Object3D).userData.mol = this
  }
}

class Receptor {
  occupant: Mol | null = null
  pulse = 0
  meter = 0
  blocked = 0
  signalTimer = 0
  readonly center = new V3()
  /** Orientation of the pocket frame inside the level (identity = pocket faces the player). */
  readonly quat = new Q()
  readonly normal = new V3(0, 0, 1)
  readonly signalFrom = new V3()
  arrow: THREE.Object3D | null = null
  constructor(readonly def: (typeof TARGETS)[TargetId], readonly model: ReceptorModel, readonly board: Panel) {}
  /** Pocket-frame point to level coordinates. */
  toLevel(local: THREE.Vector3): THREE.Vector3 {
    return local.clone().applyQuaternion(this.quat).add(this.center)
  }
  get active(): boolean {
    return this.pulse > 0 || (!!this.occupant && this.occupant.state === 'docked' && !!this.occupant.result?.activates)
  }
}

type LastResult = { mol: MoleculeDef; target: string; r: FitResult; hint: string; extra?: string; enzyme?: boolean }

export type HudState = { holding: string | null; xr: boolean; mode: 'menu' | 'level'; event: boolean }

type EventRun = { phases: EventPhases; step: number; phaseStart: number; times: number[]; lastAction: number }
type EventResult = { phases: EventPhases; times: number[]; total: number; record: boolean; best: number; at: number }

export class Game {
  readonly root = new THREE.Group()
  readonly fx = new Fx()
  private levelGroup = new THREE.Group()
  private menuGroup = new THREE.Group()
  private env = new THREE.Group()
  private mols: Mol[] = []
  private receptors: Receptor[] = []
  private mission: Panel
  private legend: Panel
  private menu: Panel
  /** Event-mode lobby (queue of visitors): COMEÇAR button, language and the last visitor's result. */
  private lobby: Panel
  /** Event mode: 0 = off, otherwise how many levels each visitor plays. */
  eventPhases: EventPhases = 0
  private lastEventPhases: EventPhases = 3
  private run: EventRun | null = null
  private result: EventResult | null = null
  private clockSec = -1
  private popups: { sprite: THREE.Sprite; life: number }[] = []
  private raycaster = new THREE.Raycaster()
  private level: LevelDef | null = null
  mode: 'menu' | 'level' = 'menu'
  private last: LastResult | null = null
  private heldInfo: MoleculeDef | null = null
  private won = false
  /** Countdown to a single visit of the natural molecule (0 = none scheduled). */
  private natTimer = 0
  private tutStep = 0
  /** Seconds until the next level starts automatically after a win (0 = off). */
  private autoNext = 0
  /** NUBBICS logo (group that made the game), shown discreetly on the 3D menu. */
  private brand = new Image()
  private wallDt = 0
  private lastWall = performance.now()
  private labTarget: TargetId = 'tripsina'
  private notebook = new Map<MoleculeId, FitResult>()
  private done = new Set<number>()
  private needAlign = 0
  private isAR = false
  /** Set by the launcher before requesting an immersive-ar session. */
  nextSessionAR = false
  private time = 0
  private decor: THREE.Group[] = []
  private boardTimer = 0
  onHud: (s: HudState) => void = () => {}
  private hudKey = ''

  constructor(
    private scene: THREE.Scene,
    private camera: THREE.PerspectiveCamera,
    private renderer: THREE.WebGLRenderer,
    private pointers: Pointers,
    private audio: Audio,
  ) {
    try { for (const n of JSON.parse(localStorage.getItem(SAVE_KEY) ?? '[]') as number[]) this.done.add(n) } catch { /* ignore */ }
    scene.add(this.env, this.root)
    this.root.add(this.levelGroup, this.menuGroup, this.fx.group)
    this.buildEnvironment()

    this.mission = new Panel(0.56, 0.52, 1600)
    this.legend = new Panel(0.46, 0.52, 1600)
    this.layoutPanels(false)
    this.root.add(this.mission.mesh, this.legend.mesh)
    this.legend.setDraw((ctx, w, h) => this.drawLegend(ctx, w, h))
    this.mission.setDraw((ctx, w, h) => this.drawMission(ctx, w, h))

    this.menu = new Panel(0.86, 0.68, 1500)
    this.brand.onload = () => this.menu.invalidate()
    this.brand.src = `${import.meta.env.BASE_URL}brand/nubbics-wordmark.webp`
    this.menu.mesh.position.set(0, 1.36, -0.72)
    this.menuGroup.add(this.menu.mesh)
    this.menu.setDraw((ctx, w, h) => this.drawMenu(ctx, w, h))
    this.lobby = new Panel(0.9, 0.76, 1500)
    this.lobby.mesh.position.set(0, 1.45, -0.74)
    this.lobby.mesh.visible = false
    this.menuGroup.add(this.lobby.mesh)
    this.lobby.setDraw((ctx, w, h) => this.drawLobby(ctx, w, h))
    this.buildMenuDecor()

    renderer.xr.addEventListener('sessionstart', () => {
      this.isAR = this.nextSessionAR
      this.applyEnvironment()
      this.layoutPanels(true)
      this.needAlign = 1
      this.legend.invalidate()
      this.menu.invalidate()
      if (this.mode === 'menu') this.showMenu()
    })
    renderer.xr.addEventListener('sessionend', () => {
      this.isAR = false
      this.root.position.set(0, 0, 0)
      this.root.rotation.set(0, 0, 0)
      this.applyEnvironment()
      this.layoutDesktopCamera()
      this.legend.invalidate()
      this.menu.invalidate()
      if (this.mode === 'menu') this.showMenu()
    })
    this.showMenu()
  }

  // ---------------------------------------------------------------- environment

  private buildEnvironment(): void {
    const sky = new THREE.Mesh(new THREE.SphereGeometry(30, 32, 16), new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false,
      uniforms: { top: { value: new THREE.Color(0x2b2470) }, bottom: { value: new THREE.Color(0x0a0820) } },
      vertexShader: 'varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: 'uniform vec3 top; uniform vec3 bottom; varying vec3 vP; void main(){ float h = normalize(vP).y * 0.5 + 0.5; gl_FragColor = vec4(mix(bottom, top, smoothstep(0.2, 0.9, h)), 1.0); }',
    }))
    sky.name = 'sky'
    this.env.add(sky)
    const floor = new THREE.Group()
    const disc = new THREE.Mesh(new THREE.CircleGeometry(2.2, 64).rotateX(-Math.PI / 2),
      new THREE.MeshStandardMaterial({ color: 0x15123a, roughness: 0.95 }))
    floor.add(disc)
    for (const r of [0.5, 1, 1.5, 2]) {
      const ring = new THREE.Mesh(new THREE.RingGeometry(r - 0.006, r, 96).rotateX(-Math.PI / 2),
        new THREE.MeshBasicMaterial({ color: 0x3ee6b0, transparent: true, opacity: 0.18 }))
      ring.position.y = 0.002
      floor.add(ring)
    }
    this.env.add(floor)
    // Floating bubbles for atmosphere.
    const bubbles = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 12, 8),
      new THREE.MeshBasicMaterial({ color: 0x6f62ff, transparent: true, opacity: 0.18, depthWrite: false }), 70)
    const m = new THREE.Matrix4()
    for (let i = 0; i < 70; i++) {
      const a = Math.random() * Math.PI * 2
      const d = 2 + Math.random() * 5
      const s = 0.02 + Math.random() * 0.08
      m.compose(new V3(Math.cos(a) * d, 0.3 + Math.random() * 3.5, Math.sin(a) * d), new Q(), new V3(s, s, s))
      bubbles.setMatrixAt(i, m)
    }
    bubbles.name = 'bubbles'
    this.env.add(bubbles)
    const pmrem = new THREE.PMREMGenerator(this.renderer)
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture
    this.scene.environmentIntensity = 0.3
    pmrem.dispose()
    this.scene.add(new THREE.HemisphereLight(0xdcd6ff, 0x2a1f4a, 1.25))
    const key = new THREE.DirectionalLight(0xffffff, 1.6)
    key.position.set(0.6, 2.5, 1.4)
    this.scene.add(key)
    const rim = new THREE.DirectionalLight(0x7fe9ff, 0.6)
    rim.position.set(-1.5, 1, -1)
    this.scene.add(rim)
  }

  private applyEnvironment(): void {
    const ar = this.renderer.xr.isPresenting && this.isAR
    this.env.visible = !ar
    this.scene.background = ar ? null : new THREE.Color(0x0a0820)
  }

  /** In VR the side panels wrap around the player; on a flat screen they face the camera. */
  private layoutPanels(xr: boolean): void {
    if (xr) {
      this.mission.mesh.position.set(0.66, 1.33, -0.42)
      this.mission.mesh.rotation.set(0, -0.95, 0)
      this.legend.mesh.position.set(-0.66, 1.33, -0.42)
      this.legend.mesh.rotation.set(0, 0.95, 0)
    } else {
      this.mission.mesh.position.set(0.8, 1.3, -0.56)
      this.mission.mesh.rotation.set(0, -0.28, 0)
      this.legend.mesh.position.set(-0.78, 1.3, -0.56)
      this.legend.mesh.rotation.set(0, 0.28, 0)
    }
  }

  /** Desktop/phone camera framing (outside XR): fit the whole table on screen. */
  layoutDesktopCamera(): void {
    this.layoutPanels(false)
    const fov = 50
    const halfH = Math.atan(Math.tan(THREE.MathUtils.degToRad(fov / 2)) * this.camera.aspect)
    const z = Math.max(0.8, -0.5 + 1.16 / Math.tan(halfH))
    this.camera.fov = fov
    this.camera.position.set(0, 1.5 + Math.min(0.4, (z - 0.9) * 0.15), z)
    this.camera.updateProjectionMatrix()
    this.camera.lookAt(0, 1.22, -0.6)
  }

  // ---------------------------------------------------------------- menus & levels

  showMenu(): void {
    if (this.eventPhases > 0) { this.showLobby(); return }
    this.clearLevel()
    this.run = null
    this.mode = 'menu'
    this.level = null
    this.menuGroup.visible = true
    this.menu.mesh.visible = true
    this.lobby.mesh.visible = false
    this.mission.mesh.visible = false
    this.legend.mesh.visible = true
    const b = (id: string, x: number, y: number, w: number, h: number, label: string, onClick: () => void, color?: string) =>
      ({ id, x, y, w, h, label, onClick, color })
    const W = this.menu.canvas.width
    const cw = (W - 120 - 40) / 2
    this.menu.buttons = LEVELS.map((lv, i) => i === 0
      ? b(`lv${lv.id}`, 60, 362, W - 120, 108, `${this.done.has(lv.id) ? '✓ ' : ''}${t('Tutorial: aprenda a jogar (recomendado)')}`, () => this.startLevel(i), '#7fc8ff')
      : b(`lv${lv.id}`, 60 + ((i - 1) % 2) * (cw + 40), 496 + Math.floor((i - 1) / 2) * 132, cw, 110,
        `${this.done.has(lv.id) ? '✓ ' : ''}${lv.title}`, () => this.startLevel(i), lv.kind === 'lab' ? '#ffd23f' : undefined))
    this.menu.buttons.push(b('sound', 60, 768, 300, 86, this.audio.muted ? t('Som: desligado') : t('Som: ligado'), () => {
      this.audio.muted = !this.audio.muted
      this.showMenu()
    }, '#c9c4e8'))
    const xr = this.renderer.xr.isPresenting
    if (xr) {
      // Four buttons in VR: sound, recenter, event mode, exit (the logo moves to the top right).
      this.menu.buttons[this.menu.buttons.length - 1].w = 270
      this.menu.buttons.push(b('recenter', 350, 768, 270, 86, t('Recentralizar'), () => { this.needAlign = 1 }, '#c9c4e8'))
      this.menu.buttons.push(b('exit', 930, 768, 270, 86, t('Sair da RV'), () => { void this.renderer.xr.getSession()?.end() }, '#ff9db5'))
    }
    this.menu.buttons.push(b('event', xr ? 640 : 390, 768, 270, 86, t('Modo evento'), () => this.setEventPhases(this.lastEventPhases), '#ffd23f'))
    this.menu.invalidate()
    this.legend.invalidate()
    this.emitHud()
  }

  // ---------------------------------------------------------------- event mode (fila de visitantes)

  /** Turns event mode on (1, 2 or 3 levels per visitor) or off (0). */
  setEventPhases(n: EventPhases): void {
    this.eventPhases = n
    if (n > 0) this.lastEventPhases = n
    saveEventSetting(n)
    if (this.result && this.result.phases !== n) this.result = null
    if (this.mode === 'menu' || n === 0) { this.run = null; this.showMenu() }
    this.emitHud()
  }

  private showLobby(): void {
    this.clearLevel()
    this.run = null
    this.mode = 'menu'
    this.level = null
    this.autoNext = 0
    this.menuGroup.visible = true
    this.menu.mesh.visible = false
    this.lobby.mesh.visible = true
    this.mission.mesh.visible = false
    this.legend.mesh.visible = true
    const W = this.lobby.canvas.width
    const b = (id: string, x: number, y: number, w: number, h: number, label: string, onClick: () => void, color?: string, fontPx?: number) =>
      ({ id, x, y, w, h, label, onClick, color, fontPx })
    const n = this.eventPhases
    this.lobby.buttons = [b('start', 60, 640, W - 120, 150,
      n === 1 ? t('COMEÇAR · 1 fase') : t('COMEÇAR · {n} fases', { n }), () => this.startRun(), MINT, 70)]
    const opts: [EventPhases, string][] = [[1, t('1 fase')], [2, t('2 fases')], [3, t('3 fases')], [0, t('Modo livre')]]
    opts.forEach(([v, label], i) => this.lobby.buttons.push(b(`ev${v}`, 250 + i * 216, 846, 200, 66, label,
      () => this.setEventPhases(v), v === n ? '#ffd23f' : '#8f86c9')))
    this.lobby.buttons.push(b('sound', 60, 936, 280, 66, this.audio.muted ? t('Som: desligado') : t('Som: ligado'), () => {
      this.audio.muted = !this.audio.muted
      this.showLobby()
    }, '#c9c4e8'))
    if (this.renderer.xr.isPresenting) {
      this.lobby.buttons.push(b('recenter', 360, 936, 320, 66, t('Recentralizar'), () => { this.needAlign = 1 }, '#c9c4e8'))
      this.lobby.buttons.push(b('exit', W - 340, 936, 280, 66, t('Sair da RV'), () => { void this.renderer.xr.getSession()?.end() }, '#ff9db5'))
    }
    this.lobby.invalidate()
    this.legend.invalidate()
    this.emitHud()
  }

  private startRun(): void {
    const now = performance.now()
    this.result = null
    this.run = { phases: this.eventPhases, step: 0, phaseStart: now, times: [], lastAction: now }
    this.clockSec = -1
    this.startLevel(EVENT_LEVELS[0])
  }

  /** After the countdown that follows a win: next level, or the final result. */
  private advanceRun(): void {
    const run = this.run!
    run.step++
    if (run.step >= run.phases) { this.finishRun(); return }
    run.phaseStart = run.lastAction = performance.now()
    this.clockSec = -1
    this.startLevel(EVENT_LEVELS[run.step])
  }

  private finishRun(): void {
    const run = this.run!
    const total = run.times.reduce((a, x) => a + x, 0)
    const prev = bestToday(run.phases)
    const record = saveBest(run.phases, total)
    this.result = { phases: run.phases, times: [...run.times], total, record, best: record ? total : prev, at: performance.now() }
    this.showLobby()
    this.safe('som', () => this.audio.play('win'))
    for (let i = 0; i < 6; i++) {
      window.setTimeout(() => {
        const p = new V3((Math.random() - 0.5) * 1.0, 1.5 + Math.random() * 0.4, -0.6)
        for (const c of [0x3ee6b0, 0xffd23f, 0xff9db5, 0x7fc8ff]) this.fx.burst(this.worldOf(p), c, 8, 0.5, 0.02, 0.4)
      }, i * 180)
    }
  }

  /** Total play time of the current visitor (pauses between levels). */
  private runElapsed(): number {
    const run = this.run
    if (!run) return 0
    const done = run.times.slice(0, run.step).reduce((a, x) => a + x, 0)
    const cur = run.times[run.step] ?? (performance.now() - run.phaseStart)
    return done + cur
  }

  private tickEvent(): void {
    const now = performance.now()
    if (this.run && this.mode === 'level') {
      if (now - this.run.lastAction > CONFIG.play.eventIdleSeconds * 1000 && !this.won) { this.showLobby(); return }
      const sec = Math.floor(this.runElapsed() / 1000)
      if (sec !== this.clockSec) { this.clockSec = sec; this.mission.invalidate() }
    }
    if (this.result && this.mode === 'menu' && now - this.result.at > CONFIG.play.eventResultSeconds * 1000) {
      this.result = null
      this.showLobby()
    }
  }

  private drawLobby(ctx: CanvasRenderingContext2D, w: number, h: number): void {
    drawLogo(ctx, 60, 50, 110)
    ctx.textAlign = 'left'
    ctx.textBaseline = 'alphabetic'
    ctx.fillStyle = '#ffffff'
    ctx.font = font(84, 'bold')
    ctx.fillText(t('Encaixe Molecular'), 200, 120)
    ctx.fillStyle = MINT
    ctx.font = font(40, 'bold')
    ctx.fillText(t('Como uma molécula encontra seu alvo'), 200, 176)
    const n = this.eventPhases
    const r = this.result
    if (r) {
      ctx.fillStyle = MINT
      ctx.font = font(96, 'bold')
      ctx.fillText(t('Parabéns!'), 60, 320)
      ctx.fillStyle = '#ffffff'
      const done = r.phases === 1 ? t('Você completou 1 fase em {time}', { time: fmtTime(r.total) }) : t('Você completou {n} fases em {time}', { n: r.phases, time: fmtTime(r.total) })
      fitFont(ctx, done, w - 120, 50, 'bold')
      ctx.fillText(done, 60, 390)
      ctx.font = font(32)
      r.times.forEach((ms, i) => {
        const y = 452 + i * 44
        ctx.fillStyle = '#d8d3f5'
        ctx.textAlign = 'left'
        ctx.fillText(LEVELS[EVENT_LEVELS[i]].title, 90, y)
        ctx.textAlign = 'right'
        ctx.fillStyle = '#ffffff'
        ctx.fillText(fmtTime(ms), w - 90, y)
      })
      ctx.textAlign = 'left'
      ctx.fillStyle = '#ffd23f'
      ctx.font = font(36, 'bold')
      ctx.fillText(r.record ? t('Novo recorde do dia!') : t('Melhor tempo de hoje: {time}', { time: fmtTime(r.best) }), 60, 452 + r.times.length * 44 + 20)
    } else {
      ctx.fillStyle = MINT
      ctx.font = font(56, 'bold')
      ctx.fillText(t('Pronto para o próximo jogador!'), 60, 292)
      ctx.fillStyle = '#d8d3f5'
      ctx.font = font(32)
      let y = wrapText(ctx, t('Muitos remédios funcionam assim: uma molécula se encaixa numa proteína do corpo, como uma chave na fechadura. Pegue as moléculas, teste o encaixe e descubra o que acontece.'), 60, 352, w - 120, 42, 3)
      ctx.fillStyle = '#ffd23f'
      ctx.font = font(32, 'bold')
      y = wrapText(ctx, n === 1 ? t('Você vai jogar 1 fase. O relógio começa quando você apertar COMEÇAR.') : t('Você vai jogar {n} fases seguidas. O relógio começa quando você apertar COMEÇAR.', { n }), 60, y + 14, w - 120, 42, 2)
      const best = bestToday(n)
      if (best) {
        ctx.fillStyle = '#c9c4e8'
        ctx.font = font(30)
        ctx.fillText(t('Melhor tempo de hoje: {time}', { time: fmtTime(best) }), 60, y + 20)
      }
    }
    ctx.textAlign = 'left'
    ctx.fillStyle = '#9a93c9'
    ctx.font = font(28, 'bold')
    ctx.fillText(t('Equipe:'), 60, 890)
    ctx.font = font(24)
    ctx.fillText(t('Proteínas reais (banco PDB: tripsina 1BJU, trombina 1PPB, receptor β2 2RH1), com bolsos simplificados.'), 60, h - 84)
    ctx.fillText(t('Todas as moléculas são INVENTADAS: o jogo não mostra nem recomenda nenhum remédio de verdade.'), 60, h - 46)
  }

  private buildMenuDecor(): void {
    const ids: MoleculeId[] = ['cometa', 'raio', 'trevo', 'gota', 'escudo']
    ids.forEach((id, i) => {
      const m = buildMolecule(MOLECULES[id])
      const a = -1.1 + i * 0.55
      m.position.set(Math.sin(a) * 0.8, 0.85 + (i % 2) * 0.12, -Math.cos(a) * 0.8 - 0.1)
      m.scale.setScalar(1.3)
      m.userData.spin = 0.3 + Math.random() * 0.4
      this.menuGroup.add(m)
      this.decor.push(m)
    })
  }

  startLevel(index: number): void {
    this.clearLevel()
    const level = LEVELS[index]
    this.level = level
    this.mode = 'level'
    this.menuGroup.visible = false
    this.mission.mesh.visible = true
    this.legend.mesh.visible = true
    this.won = false
    this.last = null
    this.heldInfo = null
    this.natTimer = 0
    this.autoNext = 0
    this.tutStep = 0
    if (level.kind === 'tutorial') this.natTimer = 1.6
    this.notebook.clear()
    const targets = level.kind === 'lab' ? [this.labTarget] : level.targets
    targets.forEach((tid, i) => this.addReceptor(tid, targets.length === 1 ? 0 : (i === 0 ? -0.31 : 0.36)))
    level.tray.forEach((id, i) => this.addTrayMolecule(MOLECULES[id], i, level.tray.length))
    this.setMissionButtons()
    this.mission.invalidate()
    this.legend.invalidate()
    this.emitHud()
  }

  private clearLevel(): void {
    for (const p of [this.pointers.mouse, ...this.pointers.xr]) p.held = null
    this.heldInfo = null
    for (const m of this.mols) this.levelGroup.remove(m.obj)
    this.mols = []
    for (const r of this.receptors) this.levelGroup.remove(r.model.root, r.board.mesh)
    this.receptors = []
    this.levelGroup.clear()
    for (const p of this.popups) this.root.remove(p.sprite)
    this.popups = []
  }

  private addReceptor(tid: TargetId, x: number): void {
    const def = TARGETS[tid]
    const model = buildReceptor(def)
    const board = new Panel(0.36, 0.13, 1600, { radius: 30 })
    const rec = new Receptor(def, model, board)
    if (def.sideTilt) {
      // Side view: the pocket opens upwards (outside of the cell), tilted towards the player.
      const t = THREE.MathUtils.degToRad(def.sideTilt)
      rec.quat.setFromAxisAngle(new V3(1, 0, 0), -t)
      rec.center.set(x, 1.27, -0.86)
    } else rec.center.set(x, POCKET_Y, POCKET_Z)
    rec.normal.set(0, 0, 1).applyQuaternion(rec.quat)
    model.root.position.copy(rec.center)
    model.root.quaternion.copy(rec.quat)
    const bc = model.meta.bottomCenter
    rec.signalFrom.copy(rec.toLevel(bc ? new V3(bc[0], bc[1], bc[2]) : new V3(0, -0.3, -0.15)))
    model.root.updateMatrixWorld(true)
    const box = new THREE.Box3().setFromObject(model.body)
    board.mesh.position.set(x, box.max.y + 0.08, Math.min(box.max.z, rec.center.z + 0.12))
    board.setDraw((ctx, w, h) => this.drawBoard(rec, ctx, w, h))
    // Bobbing arrow that points into the pocket (hidden once something is docked).
    const arrow = new THREE.Group()
    const amat = new THREE.MeshBasicMaterial({ color: 0x3ee6b0, transparent: true, opacity: 0.9, toneMapped: false, depthTest: false })
    const cone = new THREE.Mesh(new THREE.ConeGeometry(0.018, 0.04, 16).rotateX(-Math.PI / 2), amat)
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.05, 8).rotateX(Math.PI / 2), amat)
    cone.position.z = 0.02
    shaft.position.z = 0.06
    arrow.add(cone, shaft)
    arrow.renderOrder = 6
    cone.renderOrder = shaft.renderOrder = 6
    arrow.quaternion.copy(rec.quat)
    this.levelGroup.add(arrow)
    rec.arrow = arrow
    this.levelGroup.add(model.root, board.mesh)
    this.receptors.push(rec)
  }

  private addTrayMolecule(def: MoleculeDef, i: number, n: number): void {
    const rows = n > 5 ? 2 : 1
    const perRow = Math.ceil(n / rows)
    const row = Math.floor(i / perRow)
    const col = i % perRow
    const count = Math.min(perRow, n - row * perRow)
    const side = this.receptors.some(r => r.def.sideTilt)
    const R = (row === 0 ? 0.52 : 0.4) - (side ? 0.08 : 0)
    const step = (row === 0 ? 0.36 : 0.44) * (side ? 1.12 : 1)
    const a = -((count - 1) * step) / 2 + col * step
    const y = (row === 0 ? 1.04 : 0.88) - (side ? 0.08 : 0)
    const pos = new V3(Math.sin(a) * R, y, -Math.cos(a) * R)
    const mol = new Mol(def, false)
    mol.home.copy(pos)
    const look = new THREE.Object3D()
    look.position.copy(pos)
    look.lookAt(0, y + 0.3, 0.3)
    look.rotateZ(Math.floor(Math.random() * 3) * ((2 * Math.PI) / 3))
    if (Math.random() < 0.5) look.rotateY(Math.PI)
    mol.homeQuat.copy(look.quaternion)
    mol.obj.position.copy(pos)
    mol.obj.quaternion.copy(mol.homeQuat)
    this.levelGroup.add(mol.obj)
    this.mols.push(mol)
    // Pedestal + name label.
    const ped = new THREE.Mesh(new THREE.TorusGeometry(0.045, 0.004, 8, 40).rotateX(Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: 0x3ee6b0, transparent: true, opacity: 0.55, toneMapped: false }))
    ped.position.set(pos.x, pos.y - 0.095, pos.z)
    this.levelGroup.add(ped)
    const label = new THREE.Mesh(new THREE.PlaneGeometry(0.2, 0.05),
      new THREE.MeshBasicMaterial({ map: labelTexture([{ text: def.name, size: 46, bold: true, color: def.natural ? '#ffc2d6' : '#ffffff' }], 512, 128), transparent: true, depthWrite: false, toneMapped: false }))
    const toPlayer = new V3(-pos.x, 0, -pos.z).normalize()
    label.position.set(pos.x, pos.y - 0.105, pos.z).addScaledVector(toPlayer, 0.06)
    label.lookAt(0, 1.5, 0.3)
    label.renderOrder = 2
    this.levelGroup.add(label)
  }

  private setMissionButtons(): void {
    const W = this.mission.canvas.width
    const H = this.mission.canvas.height
    const level = this.level
    if (!level) return
    const btn = (id: string, x: number, y: number, w: number, h: number, label: string, onClick: () => void, color?: string) =>
      ({ id, x, y, w, h, label, onClick, color })
    const idx = LEVELS.indexOf(level)
    this.mission.buttons = [
      this.run
        ? btn('menu', 40, H - 120, 220, 84, t('Encerrar'), () => this.showLobby(), '#ff9db5')
        : btn('menu', 40, H - 120, 220, 84, t('Menu'), () => this.showMenu(), '#c9c4e8'),
      btn('restart', 280, H - 120, 260, 84, t('Recomeçar'), () => this.startLevel(idx), '#c9c4e8'),
    ]
    if ((level.kind === 'block' || level.kind === 'tutorial') && !this.won && level.natural) {
      this.mission.buttons.push(btn('demo', 40, H - 216, W - 80, 80, t('Ver o que faz a molécula natural'), () => { this.natTimer = 0.05 }, '#7fc8ff'))
    }
    if (level.kind === 'lab') {
      const ids: TargetId[] = ['tripsina', 'trombina', 'beta2']
      const bw = (W - 80 - 2 * 16) / 3
      ids.forEach((tid, i) => this.mission.buttons.push(btn(`t-${tid}`, 40 + i * (bw + 16), 250, bw, 76,
        TARGETS[tid].short, () => { this.labTarget = tid; this.startLevel(idx) }, tid === this.labTarget ? '#ffd23f' : '#8f86c9')))
    }
    this.mission.invalidate()
  }

  // ---------------------------------------------------------------- drawing

  private drawMenu(ctx: CanvasRenderingContext2D, w: number, h: number): void {
    drawLogo(ctx, 70, 64, 110)
    ctx.textAlign = 'left'
    ctx.textBaseline = 'alphabetic'
    ctx.fillStyle = '#ffffff'
    ctx.font = font(84, 'bold')
    ctx.fillText(t('Encaixe Molecular'), 210, 132)
    ctx.fillStyle = MINT
    ctx.font = font(40, 'bold')
    ctx.fillText(t('Como uma molécula encontra seu alvo'), 210, 190)
    ctx.fillStyle = '#d8d3f5'
    ctx.font = font(31)
    wrapText(ctx, t('Muitos remédios funcionam assim: uma molécula se encaixa numa proteína do corpo, como uma chave na fechadura. Pegue as moléculas, teste o encaixe e descubra o que acontece.'), 60, 256, w - 120, 40, 3)
    ctx.font = font(24)
    ctx.fillStyle = '#9a93c9'
    ctx.fillText(t('Proteínas reais (banco PDB: tripsina 1BJU, trombina 1PPB, receptor β2 2RH1), com bolsos simplificados.'), 60, h - 84)
    ctx.fillText(t('Todas as moléculas são INVENTADAS: o jogo não mostra nem recomenda nenhum remédio de verdade.'), 60, h - 46)
    if (this.brand.complete && this.brand.naturalWidth > 0 && this.renderer.xr.isPresenting) {
      const lh = 80
      const lw = lh * this.brand.naturalWidth / this.brand.naturalHeight
      ctx.globalAlpha = 0.92
      ctx.drawImage(this.brand, w - 60 - lw, 56, lw, lh)
      ctx.globalAlpha = 1
    } else if (this.brand.complete && this.brand.naturalWidth > 0) {
      const lh = 120
      const lw = lh * this.brand.naturalWidth / this.brand.naturalHeight
      const lx = w - 60 - lw
      const ly = h - 130 - lh
      ctx.globalAlpha = 0.92
      ctx.drawImage(this.brand, lx, ly, lw, lh)
      ctx.globalAlpha = 1
      ctx.textAlign = 'right'
      ctx.fillStyle = '#9a93c9'
      ctx.font = font(24)
      ctx.fillText(t('Desenvolvido por'), lx - 22, ly + lh / 2 + 8)
      ctx.textAlign = 'left'
    }
  }

  private drawLegend(ctx: CanvasRenderingContext2D, w: number, _h: number): void {
    ctx.textAlign = 'left'
    ctx.textBaseline = 'alphabetic'
    ctx.fillStyle = MINT
    ctx.font = font(46, 'bold')
    ctx.fillText(t('Como encaixar'), 40, 76)
    const rows: [number, string, string][] = [
      [CHEM_COLOR.pos, '+', t('Carga positiva')],
      [CHEM_COLOR.neg, '−', t('Carga negativa')],
      [CHEM_COLOR.oil, '~', t('Oleosa (foge da água)')],
      [CHEM_COLOR.polar, '💧', t('Gosta de água')],
    ]
    let y = 124
    for (const [color, sym, text] of rows) {
      ctx.beginPath()
      ctx.arc(66, y + 6, 24, 0, Math.PI * 2)
      ctx.fillStyle = `#${color.toString(16).padStart(6, '0')}`
      ctx.fill()
      ctx.fillStyle = '#ffffff'
      ctx.textAlign = 'center'
      ctx.font = font(32, 'bold')
      if (sym === '💧') {
        ctx.beginPath(); ctx.moveTo(66, y - 10); ctx.quadraticCurveTo(52, y + 8, 56, y + 14); ctx.arc(66, y + 12, 10, Math.PI, 0, true); ctx.quadraticCurveTo(80, y + 8, 66, y - 10); ctx.fill()
      } else ctx.fillText(sym, 66, y + 17)
      ctx.textAlign = 'left'
      ctx.font = font(32)
      ctx.fillText(text, 108, y + 17)
      y += 66
    }
    y += 6
    ctx.fillStyle = '#ffffff'
    ctx.font = font(29)
    const rules = [
      t('• Opostos se atraem: + com −'),
      t('• Iguais se empurram: + com +'),
      t('• Óleo com óleo, água com água'),
      t('• A bolinha precisa CABER no buraco'),
      t('• Anel tracejado = interruptor'),
    ]
    for (const r of rules) { ctx.fillText(r, 40, y); y += 42 }
    y += 14
    ctx.fillStyle = MINT
    ctx.font = font(32, 'bold')
    ctx.fillText(t('Controles'), 40, y)
    y += 42
    ctx.fillStyle = '#d8d3f5'
    ctx.font = font(27)
    const xr = this.renderer.xr.isPresenting
    const text = xr
      ? t('Aponte e aperte o gatilho (ou faça pinça com os dedos) para pegar. Gire o pulso para girar a molécula. Solte bem perto do bolso da proteína.')
      : t('Clique para pegar. Roda do mouse ou Q/E: girar. Botão direito ou F: virar. Clique no bolso da proteína para soltar.')
    wrapText(ctx, text, 40, y, w - 80, 36, 5)
  }

  private drawMission(ctx: CanvasRenderingContext2D, w: number, h: number): void {
    const level = this.level
    if (!level) return
    ctx.textAlign = 'left'
    ctx.textBaseline = 'alphabetic'
    ctx.fillStyle = MINT
    fitFont(ctx, level.title, w - 80 - (this.run ? 190 : 0), 46, 'bold')
    ctx.fillText(level.title, 40, 72)
    if (this.run) {
      ctx.textAlign = 'right'
      ctx.fillStyle = '#ffd23f'
      ctx.font = font(48, 'bold')
      ctx.fillText(fmtTime(this.runElapsed()), w - 40, 74)
      ctx.textAlign = 'left'
    }
    ctx.fillStyle = '#ffffff'
    ctx.font = font(29)
    let y = 118
    if (!this.last && !this.heldInfo && !this.won) {
      y = wrapText(ctx, level.intro, 40, y, w - 80, 37, 4) + 6
    }
    ctx.fillStyle = '#ffd23f'
    ctx.font = font(29, 'bold')
    y = wrapText(ctx, t('Missão: {goal}', { goal: level.goal }), 40, level.kind === 'lab' ? y : y, w - 80, 37, 3)
    if (level.kind === 'lab') y = Math.max(y, 250) + 96
    y += 8
    ctx.strokeStyle = 'rgba(255,255,255,0.15)'
    ctx.lineWidth = 3
    ctx.beginPath(); ctx.moveTo(40, y - 18); ctx.lineTo(w - 40, y - 18); ctx.stroke()
    y += 18
    const bottom = h - (this.mission.buttons.some(b => b.id === 'demo') ? 236 : 140)
    if (level.kind === 'tutorial' && !this.won) {
      y = this.drawTutorial(ctx, y, w, bottom)
      if (!this.last || this.tutStep < 3) return
    }
    if (this.won) {
      ctx.fillStyle = MINT
      ctx.font = font(52, 'bold')
      ctx.fillText(t('Acertou! Muito bem!'), 40, y + 20)
      ctx.fillStyle = '#ffffff'
      ctx.font = font(29)
      const yy = wrapText(ctx, level.learned, 40, y + 74, w - 80, 38, Math.floor((bottom - y - 130) / 38))
      if (this.autoNext > 0) {
        ctx.fillStyle = '#ffd23f'
        ctx.font = font(34, 'bold')
        const last = !!this.run && this.run.step >= this.run.phases - 1
        const msg = last ? t('Resultado em {n} s...', { n: Math.ceil(this.autoNext) }) : t('Próxima fase em {n} s...', { n: Math.ceil(this.autoNext) })
        ctx.fillText(msg, 40, Math.min(bottom - 10, yy + 50))
      }
      return
    }
    if (this.heldInfo && level.kind !== 'tutorial') {
      ctx.fillStyle = '#c9c4e8'
      ctx.font = font(26, 'bold')
      ctx.fillText(t('NA SUA MÃO'), 40, y)
      ctx.fillStyle = '#ffffff'
      ctx.font = font(42, 'bold')
      ctx.fillText(this.heldInfo.name, 40, y + 50)
      ctx.font = font(29)
      ctx.fillStyle = '#d8d3f5'
      wrapText(ctx, this.heldInfo.about, 40, y + 96, w - 80, 37, 3)
      return
    }
    if (level.kind === 'lab' && this.notebook.size > 0 && !this.last) {
      this.drawNotebook(ctx, y, w)
      return
    }
    if (this.last) {
      const { r, mol, target, hint, extra } = this.last
      ctx.fillStyle = FIT_COLOR[r.fit]
      ctx.font = font(46, 'bold')
      ctx.fillText(FIT_TITLE[r.fit], 40, y + 18)
      ctx.fillStyle = '#c9c4e8'
      ctx.font = font(26)
      ctx.fillText(t('{mol} no {target}', { mol: mol.name, target }), 40, y + 56)
      ctx.fillStyle = '#ffffff'
      ctx.font = font(29)
      let yy = wrapText(ctx, r.reason, 40, y + 100, w - 80, 37, 3)
      const eff = effectText(r, this.last.enzyme)
      if (eff) {
        ctx.fillStyle = r.activates ? '#ffb347' : MINT
        ctx.font = font(29, 'bold')
        yy = wrapText(ctx, eff, 40, yy + 4, w - 80, 37, 2)
      }
      if (extra) {
        ctx.fillStyle = '#ffd23f'
        ctx.font = font(28, 'bold')
        yy = wrapText(ctx, extra, 40, yy + 4, w - 80, 36, 3)
      }
      if (hint && yy < bottom) {
        ctx.fillStyle = '#7fc8ff'
        ctx.font = font(27)
        wrapText(ctx, hint, 40, yy + 4, w - 80, 35, 2)
      }
    } else {
      ctx.fillStyle = '#c9c4e8'
      ctx.font = font(29)
      let yy = wrapText(ctx, t('Pegue uma molécula da bandeja e leve até o bolso da proteína (os três buracos coloridos na superfície).'), 40, y + 10, w - 80, 37, 3)
      if (level.kind === 'lab' && yy < bottom - 120) {
        ctx.fillStyle = '#7fc8ff'
        ctx.font = font(26, 'bold')
        ctx.fillText(t('Sabia que?'), 40, yy + 12)
        ctx.font = font(25)
        wrapText(ctx, t('Estas formas vêm de experimentos reais (banco PDB). Hoje, a inteligência artificial ajuda a planejar fármacos: o AlphaFold prevê a forma 3D das proteínas e ferramentas como o Boltz-2 estimam o quanto uma molécula se liga a elas.'), 40, yy + 48, w - 80, 33, Math.floor((bottom - yy - 48) / 33))
      }
    }
  }

  private drawTutorial(ctx: CanvasRenderingContext2D, y: number, w: number, bottom: number): number {
    const xr = this.renderer.xr.isPresenting
    const steps = [t('Ver a enzima trabalhar'), t('Pegar uma molécula'), t('Soltar no bolso'), t('Encaixar a Cometa'), t('Testar o bloqueio')]
    const help = [
      t('Observe: a "proteína do alimento" chega, encaixa no bolso e a tripsina a corta. Esse é o trabalho normal da enzima.'),
      xr ? t('Aponte para a Molécula Faísca e aperte o gatilho (ou faça pinça com os dedos) para pegar.') : t('Clique na Molécula Faísca para pegar.'),
      xr ? t('Leve a molécula até o bolso (os três buracos coloridos) e solte o gatilho.') : t('Leve até o bolso (os três buracos coloridos) e clique para soltar.'),
      xr ? t('Agora pegue a Cometa. Gire o pulso até a cor de cada ponta combinar com a cor do buraco e solte no bolso.') : t('Agora pegue a Cometa. Gire (roda do mouse, Q/E ou F) até a cor de cada ponta combinar com a do buraco e solte no bolso.'),
      t('Encaixou! Agora a molécula natural vai tentar entrar no bolso...'),
    ]
    ctx.font = font(27, 'bold')
    steps.forEach((st, i) => {
      const done = i < this.tutStep
      const cur = i === this.tutStep
      ctx.beginPath()
      ctx.arc(58, y + 2, 15, 0, Math.PI * 2)
      ctx.fillStyle = done ? MINT : cur ? '#ffd23f' : 'rgba(255,255,255,0.18)'
      ctx.fill()
      if (done) {
        ctx.strokeStyle = '#10102a'; ctx.lineWidth = 5
        ctx.beginPath(); ctx.moveTo(50, y + 2); ctx.lineTo(56, y + 9); ctx.lineTo(67, y - 5); ctx.stroke()
      }
      ctx.fillStyle = done ? '#9ff0d2' : cur ? '#ffffff' : '#8f89b8'
      ctx.fillText(st, 88, y + 12)
      y += 44
    })
    y += 8
    ctx.fillStyle = '#ffd23f'
    ctx.font = font(30, 'bold')
    y = wrapText(ctx, help[Math.min(this.tutStep, help.length - 1)], 40, y + 14, w - 80, 38, 4)
    void bottom
    return y + 30
  }

  private drawNotebook(ctx: CanvasRenderingContext2D, y: number, w: number): void {
    ctx.fillStyle = '#c9c4e8'
    ctx.font = font(26, 'bold')
    ctx.fillText(t('CADERNO · {name}', { name: TARGETS[this.labTarget].name }), 40, y)
    y += 40
    ctx.font = font(26)
    for (const [id, r] of this.notebook) {
      ctx.fillStyle = '#ffffff'
      ctx.fillText(MOLECULES[id].name, 40, y)
      ctx.fillStyle = FIT_COLOR[r.fit]
      const tag = FIT_TITLE[r.fit] + (r.fit === 'strong' || r.fit === 'weak' ? (r.activates ? t(' · ativa') : t(' · bloqueia')) : '')
      ctx.textAlign = 'right'
      ctx.fillText(tag, w - 40, y)
      ctx.textAlign = 'left'
      y += 34
    }
  }

  private drawBoard(rec: Receptor, ctx: CanvasRenderingContext2D, w: number, h: number): void {
    ctx.textAlign = 'left'
    ctx.textBaseline = 'alphabetic'
    ctx.fillStyle = `#${rec.def.color.toString(16).padStart(6, '0')}`
    fitFont(ctx, rec.def.name, w - 60, 40, 'bold')
    ctx.fillText(rec.def.name, 30, 56)
    ctx.fillStyle = '#d8d3f5'
    fitFont(ctx, rec.def.role, w - 60, 25)
    ctx.fillText(rec.def.role, 30, 94)
    // Meter / state.
    const level = this.level
    let label: string
    let value: number
    const occ = rec.occupant
    const blocked = !!occ && occ.state === 'docked' && !occ.result?.activates && (occ.result?.fit === 'strong' || occ.result?.fit === 'weak')
    if (level?.kind === 'selective') {
      const job = rec.def.id === 'trombina' ? t('Coagulação') : t('Digestão')
      label = blocked ? t('{job}: TRAVADA', { job }) : t('{job}: funcionando', { job })
      value = blocked ? 1 : 0.08
    } else {
      label = rec.active ? `${rec.def.effect}!` : blocked ? t('Bloqueada') : rec.def.effect
      value = level?.kind === 'block' ? rec.meter : rec.active ? 1 : 0.05
    }
    const bx = 30
    const by = 118
    const bw = w - 60
    roundRect(ctx, bx, by, bw, 46, 23)
    ctx.fillStyle = 'rgba(255,255,255,0.12)'
    ctx.fill()
    roundRect(ctx, bx, by, Math.max(46, bw * Math.min(1, value)), 46, 23)
    ctx.fillStyle = rec.active ? '#ffb347' : value > 0.5 ? '#ff6b6b' : MINT
    ctx.fill()
    ctx.font = font(28, 'bold')
    ctx.lineWidth = 6
    ctx.strokeStyle = 'rgba(10, 8, 30, 0.85)'
    ctx.strokeText(label, bx + 22, by + 33)
    ctx.fillStyle = '#ffffff'
    ctx.fillText(label, bx + 22, by + 33)
    void h
  }

  // ---------------------------------------------------------------- per-frame

  /** Runs one per-frame subsystem; an error there is logged instead of freezing the whole game. */
  private safe(where: string, fn: () => void): void {
    try { fn() } catch (err) { recordError(where, err) }
  }

  /** Automatic advance after a win. Runs first in every frame, so nothing else can block it. */
  private tickAutoNext(dt: number): void {
    const now = performance.now()
    this.wallDt = Math.min(0.5, (now - this.lastWall) / 1000)
    this.lastWall = now
    if (this.autoNext > 0 && this.mode === 'level') {
      const before = Math.ceil(this.autoNext)
      this.autoNext -= Math.max(dt, this.wallDt)
      if (Math.ceil(this.autoNext) !== before) this.mission.invalidate()
      if (this.autoNext <= 0) {
        this.autoNext = 0
        if (this.run) {
          try { this.advanceRun() } catch (err) { recordError('próxima fase', err); this.showLobby() }
          return
        }
        const idx = LEVELS.indexOf(this.level!)
        if (idx >= 0 && idx < LEVELS.length - 1) {
          try { this.startLevel(idx + 1) } catch (err) { recordError('próxima fase', err); this.showMenu() }
        }
      }
    }
  }

  update(dt: number): void {
    this.tickAutoNext(dt)
    this.safe('modo evento', () => this.tickEvent())
    this.time += dt
    if (this.renderer.xr.isPresenting && this.needAlign > 0) this.alignToHead()
    this.pointers.update()
    for (const p of this.pointers.list()) this.safe('ponteiro', () => this.updatePointer(p, dt))
    for (const m of [...this.mols]) this.safe('molécula', () => this.updateMol(m, dt))
    for (const r of this.receptors) this.safe('receptor', () => this.updateReceptor(r, dt))
    if (this.natTimer > 0) {
      this.natTimer -= dt
      if (this.natTimer <= 0) this.safe('molécula natural', () => this.spawnNatural())
    }
    if (this.mode === 'menu') {
      for (const d of this.decor) {
        d.rotation.y += dt * d.userData.spin
        d.rotation.x = Math.sin(this.time * 0.5 + d.position.x) * 0.3
        d.position.y += Math.sin(this.time * 1.2 + d.position.x * 3) * 0.0004
      }
    }
    for (let i = this.popups.length - 1; i >= 0; i--) {
      const p = this.popups[i]
      p.life -= dt
      p.sprite.position.y += dt * 0.06
      ;(p.sprite.material as THREE.SpriteMaterial).opacity = Math.min(1, p.life * 2)
      if (p.life <= 0) { this.root.remove(p.sprite); this.popups.splice(i, 1) }
    }
    this.safe('efeitos', () => this.fx.update(dt))
    this.boardTimer -= dt
    if (this.boardTimer <= 0) {
      this.boardTimer = 0.15
      for (const r of this.receptors) r.board.invalidate()
    }
    for (const r of this.receptors) r.board.update()
    this.mission.update()
    this.legend.update()
    this.menu.update()
    this.lobby.update()
    this.emitHud()
  }

  private alignToHead(): void {
    const cam = this.renderer.xr.getCamera()
    const head = new V3().setFromMatrixPosition(cam.matrixWorld)
    if (head.lengthSq() < 1e-6 && this.needAlign < 30) { this.needAlign++; return }
    const fwd = new V3(0, 0, -1).applyQuaternion(new Q().setFromRotationMatrix(cam.matrixWorld))
    fwd.y = 0
    if (fwd.lengthSq() < 1e-4) fwd.set(0, 0, -1)
    fwd.normalize()
    this.root.rotation.set(0, Math.atan2(-fwd.x, -fwd.z), 0)
    this.root.position.set(head.x, head.y - EYE, head.z)
    this.root.updateMatrixWorld(true)
    this.needAlign = 0
  }

  private emitHud(): void {
    const holding = this.pointers.mouse.held instanceof Mol ? (this.pointers.mouse.held as Mol).def.name : null
    const s: HudState = { holding, xr: this.renderer.xr.isPresenting, mode: this.mode, event: this.eventPhases > 0 }
    const key = JSON.stringify(s)
    if (key === this.hudKey) return
    this.hudKey = key
    this.onHud(s)
  }

  private interactables(): THREE.Object3D[] {
    const list: THREE.Object3D[] = []
    if (this.menuGroup.visible) list.push(this.lobby.mesh.visible ? this.lobby.mesh : this.menu.mesh)
    if (this.mission.mesh.visible) list.push(this.mission.mesh)
    for (const m of this.mols) if (!m.disposable && (m.state === 'tray' || m.state === 'docked')) list.push(m.obj.userData.hit)
    return list
  }

  private updatePointer(p: Pointer, dt: number): void {
    const held = p.held as Mol | null
    if (held) {
      this.followPointer(held, p, dt)
      const near = this.nearestReceptor(held, p)
      for (const r of this.receptors) {
        const mat = r.model.glow.material as THREE.MeshBasicMaterial
        mat.opacity = r === near ? 0.6 + Math.sin(this.time * 14) * 0.25 : 0
      }
      if (p.kind === 'mouse') {
        if (p.rotateSteps !== 0) {
          const axis = new V3(0, 0, 1)
          held.mouseQuat.premultiply(new Q().setFromAxisAngle(axis, -p.rotateSteps * ((2 * Math.PI) / 3)))
          p.rotateSteps = 0
          this.audio.play('click')
        }
        if (p.flip) {
          held.mouseQuat.premultiply(new Q().setFromAxisAngle(new V3(0, 1, 0), Math.PI))
          p.flip = false
          this.audio.play('click')
        }
        // Click-to-pick (sticky): a quick click keeps holding; next click drops.
        if (p.up && held.sticky === false && p.drag < 8) { held.sticky = true; this.hideLasers(p); return }
        if ((p.up && !held.sticky) || (p.down && held.sticky)) {
          const hit = p.down ? this.pick(p) : null
          if (hit?.button) { hit.button.onClick(); this.audio.play('click'); return }
          this.release(p)
        }
      } else if (p.up) this.release(p)
      this.hideLasers(p)
      return
    }
    p.rotateSteps = 0
    p.flip = false
    const hit = this.pick(p)
    // Hover visuals.
    for (const panel of [this.menu, this.lobby, this.mission]) panel.setHover(hit?.panel === panel ? hit.button?.id ?? null : null)
    for (const m of this.mols) if (m.hover > 0 && m !== hit?.mol) m.hover = 0
    if (hit?.mol) hit.mol.hover = 1
    if (p.line && p.cursor) {
      const dist = hit ? hit.dist : p.kind === 'hand' ? 0.25 : 1.2
      p.line.scale.z = dist
      p.line.visible = true
      ;(p.line.material as THREE.LineBasicMaterial).opacity = hit ? 0.9 : 0.35
      p.cursor.visible = !!hit
      if (hit) p.cursor.position.copy(p.ray.at(hit.dist, new V3()))
    }
    if (this.renderer.domElement.style) this.renderer.domElement.style.cursor = p.kind === 'mouse' && (hit?.button || hit?.mol) ? 'pointer' : 'default'
    if (p.down && hit) {
      if (hit.button) {
        this.audio.unlock()
        this.audio.play('click')
        p.haptic(0.3, 30)
        hit.button.onClick()
      } else if (hit.mol) this.grab(p, hit.mol)
    }
  }

  private hideLasers(p: Pointer): void {
    if (p.line) p.line.visible = false
    if (p.cursor) p.cursor.visible = false
  }

  private pick(p: Pointer): { dist: number; mol?: Mol; panel?: Panel; button?: ReturnType<Panel['buttonAt']> } | null {
    // Hands: direct touch grabs first.
    if (p.kind === 'hand') {
      const local = this.root.worldToLocal(p.holdPos.clone())
      let best: Mol | null = null
      let bd = 0.075
      for (const m of this.mols) {
        if (m.disposable || (m.state !== 'tray' && m.state !== 'docked')) continue
        const d = m.obj.position.distanceTo(local)
        if (d < bd) { bd = d; best = m }
      }
      if (best) return { dist: 0.05, mol: best }
    }
    this.raycaster.set(p.ray.origin, p.ray.direction)
    this.raycaster.far = 6
    const hits = this.raycaster.intersectObjects(this.interactables(), false)
    for (const h of hits) {
      const panel = h.object.userData.panel as Panel | undefined
      if (panel && h.uv) {
        const button = panel.buttonAt(h.uv)
        return { dist: h.distance, panel, button }
      }
      const mol = h.object.userData.mol as Mol | undefined
      if (mol) return { dist: h.distance, mol }
    }
    return null
  }

  private grab(p: Pointer, mol: Mol): void {
    this.audio.unlock()
    if (this.run) this.run.lastAction = performance.now()
    if (mol.dockedIn) this.undock(mol)
    mol.state = 'held'
    mol.tween = null
    mol.heldBy = p
    mol.sticky = false
    p.held = mol
    this.heldInfo = mol.def
    if (this.level?.kind === 'tutorial' && this.tutStep === 1) this.setTutStep(2)
    this.mission.invalidate()
    this.audio.play('grab')
    p.haptic(0.5, 40)
    if (p.kind === 'mouse') {
      // Face the camera, keeping the current roll/flip so rotation still matters.
      mol.mouseQuat.copy(mol.obj.quaternion)
      const z = new V3(0, 0, 1).applyQuaternion(mol.mouseQuat)
      if (Math.abs(z.z) < 0.98) {
        const fix = new Q().setFromUnitVectors(z, new V3(0, 0, Math.sign(z.z) || 1))
        mol.mouseQuat.premultiply(fix)
      }
    } else {
      const hq = this.toLocalQuat(p.holdQuat)
      mol.grabRel.copy(hq.invert()).multiply(mol.obj.quaternion)
    }
  }

  private toLocalQuat(q: THREE.Quaternion): THREE.Quaternion {
    return this.root.quaternion.clone().invert().multiply(q)
  }

  private followPointer(mol: Mol, p: Pointer, dt: number): void {
    const k = 1 - Math.exp(-dt * 18)
    if (p.kind === 'mouse') {
      const plane = new THREE.Plane(new V3(0, 0, 1), 0.36)
      const pt = p.ray.intersectPlane(plane, new V3())
      if (pt) {
        pt.y = THREE.MathUtils.clamp(pt.y, 0.8, 1.75)
        pt.x = THREE.MathUtils.clamp(pt.x, -0.8, 0.8)
        mol.obj.position.lerp(pt, k)
      }
      mol.obj.quaternion.slerp(mol.mouseQuat, 1 - Math.exp(-dt * 14))
    } else {
      const target = this.root.worldToLocal(p.holdPos.clone())
      mol.obj.position.lerp(target, k)
      const tq = this.toLocalQuat(p.holdQuat).multiply(mol.grabRel)
      mol.obj.quaternion.slerp(tq, k)
    }
  }

  private nearestReceptor(mol: Mol, p: Pointer): Receptor | null {
    let best: Receptor | null = null
    let bd = Infinity
    for (const r of this.receptors) {
      let d: number
      if (p.kind === 'mouse') {
        d = p.ray.distanceToPoint(r.center) * 1.3
      } else d = mol.obj.position.distanceTo(r.center)
      if (d < bd) { bd = d; best = r }
    }
    return bd < CONFIG.play.snapDistance ? best : null
  }

  private release(p: Pointer): void {
    const mol = p.held as Mol
    p.held = null
    mol.heldBy = null
    this.heldInfo = null
    const rec = this.nearestReceptor(mol, p)
    if (rec) this.dropOn(mol, rec)
    else {
      this.audio.play('drop')
      this.returnToTray(mol)
      this.mission.invalidate()
    }
  }

  // ---------------------------------------------------------------- docking

  /**
   * Which arm lands in which cavity, judged the way the player SEES it: arms and cavities are both projected
   * onto the view plane. (Projecting onto the pocket plane failed on tilted receptors, where a hand-held
   * molecule is almost edge-on to the pocket and the result looked random.)
   */
  private permFromOrientation(mol: Mol, rec: Receptor): Perm {
    const molQ = mol.obj.getWorldQuaternion(new Q())
    const recQ = this.levelGroup.getWorldQuaternion(new Q()).multiply(rec.quat)
    const cam = (this.renderer.xr.isPresenting ? this.renderer.xr.getCamera() : this.camera).getWorldQuaternion(new Q()).invert()
    const flat = (v: THREE.Vector3) => { v.applyQuaternion(cam); v.z = 0; return v.normalize() }
    const w = [0, 1, 2].map(i => flat(armDir(i).applyQuaternion(molQ)))
    const c = [0, 1, 2].map(i => flat(armDir(i).applyQuaternion(recQ)))
    let best = PERMS[0]
    let be = Infinity
    for (const p of PERMS) {
      const e = c.reduce((s, cj, j) => s + w[p[j]].angleTo(cj), 0)
      if (e < be) { be = e; best = p }
    }
    return best
  }

  private dockQuatFor(perm: Perm): THREE.Quaternion {
    const basis = (a: THREE.Vector3, b: THREE.Vector3) => {
      const x = a.clone().normalize()
      const z = a.clone().cross(b).normalize()
      const y = z.clone().cross(x)
      return new THREE.Matrix4().makeBasis(x, y, z)
    }
    const L = basis(armDir(perm[0]), armDir(perm[1]))
    const W = basis(armDir(0), armDir(1))
    const R = W.multiply(L.transpose())
    return new Q().setFromRotationMatrix(R)
  }

  private dropOn(mol: Mol, rec: Receptor): void {
    const level = this.level!
    const best = bestFit(mol.def, rec.def)
    let perm = this.permFromOrientation(mol, rec)
    let r = evaluate(mol.def, rec.def, perm)
    let hint = ''
    const auto = level.kind === 'selective'
    if (auto) { r = best; perm = best.perm }
    else if (rank(best.fit) > rank(r.fit)) {
      mol.fails++
      if (mol.fails >= 3) {
        r = best
        perm = best.perm
        hint = t('Ajudinha: girei a molécula para a melhor posição.')
        mol.fails = 0
      } else hint = t('Dica: gire ou vire a molécula. Em outra posição ela pode encaixar melhor!')
    }
    if (level.kind === 'lab') this.notebook.set(mol.def.id, bestFit(mol.def, rec.def))
    if (level.kind === 'tutorial' && this.tutStep <= 2 && r.fit !== 'strong') this.setTutStep(3)
    let extra: string | undefined
    if (level.kind === 'block' && !mol.def.natural) {
      if ((r.fit === 'strong' || r.fit === 'weak') && r.activates) extra = t('Encaixou, mas LIGOU o receptor. A missão é BLOQUEAR: tente outra molécula.')
      else if (r.fit === 'weak') extra = t('Ainda não: encaixe fraco, a molécula logo se solta. Tente outra.')
    }
    this.last = { mol: mol.def, target: rec.def.short, r, hint, extra, enzyme: rec.def.switchCavity < 0 }
    if (level.kind === 'selective') {
      // The same medicine reaches both organs through the blood.
      for (const other of this.receptors) if (other.occupant) this.eject(other.occupant)
      const results = this.receptors.map(t => ({ t, r: t === rec ? r : bestFit(mol.def, t.def) }))
      this.dockOrBounce(mol, rec, r, perm)
      for (const { t, r: rr } of results) {
        if (t === rec) continue
        const copy = new Mol(mol.def, true)
        copy.obj.position.copy(mol.obj.position)
        copy.obj.quaternion.copy(mol.obj.quaternion)
        this.levelGroup.add(copy.obj)
        this.mols.push(copy)
        this.dockOrBounce(copy, t, rr, rr.perm)
      }
      const want = level.blockTarget!
      const goal = results.find(x => x.t.def.id === want)!.r
      const others = results.filter(x => x.t.def.id !== want)
      const bound = (x: FitResult) => x.fit === 'strong' || x.fit === 'weak'
      const status = results.map(x => `${x.t.def.name}: ${FIT_TITLE[x.r.fit].toLowerCase()}`).join('. ') + '.'
      const otherHit = others.some(x => bound(x.r))
      let verdict: string
      const ok = goal.fit === 'strong' && !goal.activates && !otherHit
      if (ok) verdict = t('Perfeito: travou a {name} e deixou a outra enzima livre!', { name: TARGETS[want].name.toLowerCase() })
      else if (bound(goal) && otherHit) verdict = t('Travou as DUAS enzimas: isso causaria efeitos indesejados!')
      else if (goal.fit === 'weak') verdict = t('Encaixe fraco: logo se solta. Tente outra molécula.')
      else if (otherHit) verdict = t('Errou o alvo: travou a enzima que devia ficar livre!')
      else verdict = t('Não travou a {name}. Tente outra molécula.', { name: TARGETS[want].name.toLowerCase() })
      this.last = { mol: mol.def, target: t('as duas enzimas'), r: goal, hint: '', extra: `${status}\n${verdict}`, enzyme: true }
      if (ok) window.setTimeout(() => this.win(), 500)
    } else this.dockOrBounce(mol, rec, r, perm)
    this.mission.invalidate()
  }

  private dockOrBounce(mol: Mol, rec: Receptor, r: FitResult, perm: Perm): void {
    const n = rec.normal
    const speed = 1 / CONFIG.play.animSpeed
    mol.result = r
    if (r.fit === 'strong' || r.fit === 'weak') {
      if (rec.occupant && rec.occupant !== mol) this.eject(rec.occupant)
      rec.occupant = mol
      rec.blocked = 0
      mol.dockedIn = rec
      const toP = rec.center.clone()
      const toQ = rec.quat.clone().multiply(this.dockQuatFor(perm))
      mol.dockQuat.copy(toQ)
      this.tween(mol, toP, toQ, 0.42 * speed, easeBack, 0, () => {
        mol.state = 'docked'
        mol.weakTimer = r.fit === 'weak' ? CONFIG.play.weakHoldSeconds : 0
        this.safe('efeito do encaixe', () => {
          const at = this.worldOf(rec.center)
          this.fx.burst(at, r.fit === 'strong' ? 0x3ee6b0 : 0xffb347, r.fit === 'strong' ? 26 : 12, 0.3, 0.025)
          this.audio.play(r.fit === 'strong' ? 'strong' : 'weak')
          this.hapticAll(r.fit === 'strong' ? 0.8 : 0.4, 80)
        })
        const lk = this.level?.kind
        if (!mol.disposable && (lk === 'block' || lk === 'tutorial') && r.fit === 'strong' && !r.activates && !this.won) {
          if (lk === 'tutorial') this.setTutStep(4)
          // Correct answer: celebrate right away; the natural molecule then shows the block as a bonus.
          this.natTimer = 1.0
          this.win()
        }
        if (!mol.disposable || this.level?.kind === 'selective') {
          if (r.activates) {
            this.activate(rec, mol.def)
          } else if (!mol.def.natural) this.popup(r.fit === 'strong' ? t('Encaixou!') : t('Encaixe fraco...'), rec.center, r.fit === 'strong' ? '#3ee6b0' : '#ffb347')
        }
      })
      return
    }
    // Rejections: approach, then get pushed away.
    const approach = rec.center.clone().addScaledVector(n, 0.05)
    const cav = r.slots.findIndex(s => s.size === 'tooBig' || s.chem === 'repel')
    const away = rec.toLevel(new V3((Math.random() - 0.5) * 0.2, r.fit === 'slip' ? -0.16 : 0.06, 0.24))
    this.tween(mol, approach, mol.obj.quaternion.clone(), 0.18 * speed, easeOut, 0, () => {
      const spot = cav >= 0 ? rec.toLevel(armDir(cav).multiplyScalar(0.058)) : rec.center
      const at = this.worldOf(spot)
      if (r.fit === 'clash') { this.fx.burst(at, 0xff4a4a, 18, 0.35, 0.025); this.audio.play('clash'); this.flashRing(rec, cav) }
      else if (r.fit === 'repel') {
        this.fx.burst(at, 0x3b82ff, 12, 0.6, 0.02); this.fx.burst(at, 0xff4a4a, 12, 0.6, 0.02); this.audio.play('repel'); this.flashRing(rec, cav)
      } else this.audio.play('slip')
      this.hapticAll(0.6, 60)
      this.popup(r.fit === 'clash' ? t('Não cabe!') : r.fit === 'repel' ? t('Repelida!') : t('Escorregou...'), rec.center, '#ff8f8f')
      const spin = mol.obj.quaternion.clone().multiply(new Q().setFromEuler(new THREE.Euler(0.6, 0.4, 0.8)))
      this.tween(mol, away, spin, 0.45 * speed, easeOut, 0, () => this.returnToTray(mol))
    })
  }

  private flashRing(rec: Receptor, cav: number): void {
    const ring = rec.model.rings[cav]
    if (!ring) return
    ring.userData.flash = 0.8
  }

  private activate(rec: Receptor, def: MoleculeDef): void {
    rec.pulse = Math.max(rec.pulse, 1.8)
    if (this.level?.kind === 'block') rec.meter = Math.min(1, rec.meter + 0.3)
    this.audio.play('activate')
    this.popup(rec.def.word, rec.center.clone().add(new V3(0, 0.12, 0)), '#ffb347')
    void def
  }

  private undock(mol: Mol): void {
    const rec = mol.dockedIn
    if (rec && rec.occupant === mol) rec.occupant = null
    mol.dockedIn = null
    if (rec) rec.blocked = 0
  }

  private eject(mol: Mol): void {
    this.undock(mol)
    if (mol.heldBy) return
    if (mol.disposable) {
      const away = mol.obj.position.clone().add(new V3((Math.random() - 0.5) * 0.4, 0.35, -0.2))
      this.tween(mol, away, mol.obj.quaternion.clone(), 0.9, easeInOut, 0, () => this.removeMol(mol), true)
    } else {
      const out = mol.obj.position.clone().add(new V3(0, 0, 0.18))
      this.tween(mol, out, mol.obj.quaternion.clone(), 0.3, easeOut, 0, () => this.returnToTray(mol))
    }
  }

  private returnToTray(mol: Mol): void {
    if (mol.disposable) { this.removeMol(mol); return }
    mol.result = null
    this.tween(mol, mol.home.clone(), mol.homeQuat.clone(), 0.7 / CONFIG.play.animSpeed, easeInOut, 0.08, () => { mol.state = 'tray' })
  }

  private removeMol(mol: Mol): void {
    this.levelGroup.remove(mol.obj)
    const i = this.mols.indexOf(mol)
    if (i >= 0) this.mols.splice(i, 1)
  }

  private tween(mol: Mol, toP: THREE.Vector3, toQ: THREE.Quaternion, dur: number, ease: Ease, lift: number, onDone?: () => void, fade = false): void {
    mol.state = 'anim'
    mol.tween = { fromP: mol.obj.position.clone(), toP, fromQ: mol.obj.quaternion.clone(), toQ, t: 0, dur: Math.max(0.01, dur), ease, lift, onDone, fade }
  }

  private updateMol(m: Mol, dt: number): void {
    const s = 1 + m.hover * 0.12
    m.obj.scale.lerp(new V3(s, s, s), 1 - Math.exp(-dt * 14))
    if (m.tween) {
      const t = m.tween
      t.t += dt
      const x = Math.min(1, t.t / t.dur)
      const e = t.ease(x)
      m.obj.position.lerpVectors(t.fromP, t.toP, e)
      m.obj.position.y += Math.sin(Math.PI * x) * t.lift
      m.obj.quaternion.slerpQuaternions(t.fromQ, t.toQ, Math.min(1, e))
      if (t.fade) m.obj.scale.setScalar(1 - x * 0.9)
      if (x >= 1) {
        m.tween = null
        t.onDone?.()
      }
      return
    }
    if (m.state === 'tray') {
      m.obj.position.y = m.home.y + Math.sin(this.time * 1.6 + m.home.x * 7) * 0.006
    } else if (m.state === 'docked' && m.result) {
      if (m.result.fit === 'weak') {
        const wob = new Q().setFromEuler(new THREE.Euler(Math.sin(this.time * 9) * 0.08, Math.cos(this.time * 7) * 0.08, 0))
        m.obj.quaternion.copy(m.dockQuat).multiply(wob)
        m.weakTimer -= dt
        if (m.weakTimer <= 0 && !m.disposable) {
          this.popup(t('Soltou!'), m.obj.position, '#ffb347')
          this.eject(m)
        } else if (m.weakTimer <= 0 && m.disposable && this.level?.kind === 'selective') {
          // copies in the selective level stay so both organs can be compared
          m.weakTimer = 999
        }
      }
    }
  }

  private updateReceptor(r: Receptor, dt: number): void {
    if (r.arrow) {
      const show = !r.occupant && this.mode === 'level' && !this.won
      r.arrow.visible = show
      if (show) r.arrow.position.copy(r.center).addScaledVector(r.normal, 0.075 + Math.abs(Math.sin(this.time * 3)) * 0.04)
    }
    r.pulse = Math.max(0, r.pulse - dt)
    if (this.level?.kind === 'block') r.meter = Math.max(0, r.meter - dt * 0.05)
    const active = r.active
    r.model.bodyMat.emissiveIntensity = THREE.MathUtils.lerp(r.model.bodyMat.emissiveIntensity, active ? 0.3 + Math.sin(this.time * 10) * 0.1 : 0, 1 - Math.exp(-dt * 8))
    r.model.body.scale.setScalar(1 + Math.sin(this.time * 1.3 + r.center.x) * 0.006)
    for (const ring of r.model.rings) {
      const mat = ring.material as THREE.MeshStandardMaterial
      const f = (ring.userData.flash as number | undefined) ?? 0
      if (f > 0) {
        ring.userData.flash = f - dt
        mat.emissiveIntensity = 0.6 + Math.abs(Math.sin(this.time * 30)) * 2
      } else mat.emissiveIntensity = 0.6
    }
    if (active) {
      r.signalTimer -= dt
      if (r.signalTimer <= 0) {
        r.signalTimer = 0.07
        const p = r.signalFrom.clone().add(new V3((Math.random() - 0.5) * 0.08, 0, (Math.random() - 0.5) * 0.08))
        const d = r.normal.clone().multiplyScalar(-0.16).add(new V3((Math.random() - 0.5) * 0.12, 0, (Math.random() - 0.5) * 0.12))
        this.fx.spawn(this.worldOf(p), this.dirWorld(d), r.def.sideTilt ? 0xff9fd2 : r.def.color, 1.1, 0.03)
      }
    }
    // Block-level goal: a non-activating strong binder that turns away natural molecules.
    const occ = r.occupant
    if ((this.level?.kind === 'block' || this.level?.kind === 'tutorial') && !this.won && occ && !occ.disposable && occ.state === 'docked' && occ.result?.fit === 'strong' && !occ.result.activates && r.blocked >= 1) {
      this.win()
    }
  }

  private spawnNatural(): void {
    const level = this.level
    const rec = this.receptors[0]
    if (!level?.natural || !rec) return
    if (this.mols.some(m => m.disposable && m.def.natural && m.state === 'anim' && !m.dockedIn)) return
    const def = MOLECULES[level.natural]
    const mol = new Mol(def, true)
    const side = Math.random() < 0.5 ? -1 : 1
    mol.obj.position.copy(rec.toLevel(new V3(side * 0.4, 0.3, 0.32)))
    mol.obj.quaternion.setFromEuler(new THREE.Euler(Math.random() * 3, Math.random() * 3, Math.random() * 3))
    this.levelGroup.add(mol.obj)
    this.mols.push(mol)
    const approach = rec.toLevel(new V3(side * 0.05, 0.06, 0.1))
    this.tween(mol, approach, mol.obj.quaternion.clone(), 1.8 / CONFIG.play.animSpeed, easeInOut, 0.05, () => {
      const occ = rec.occupant
      if (occ && occ.state !== 'anim' && !occ.disposable && occ.result?.fit === 'strong' && !occ.result.activates) {
        rec.blocked++
        this.audio.play('block')
        this.popup(t('Bloqueado!'), rec.center.clone().add(new V3(0, 0.14, 0)), '#3ee6b0')
        this.fx.burst(this.worldOf(approach), 0xffffff, 10, 0.25, 0.02)
        this.eject(mol)
        this.mission.invalidate()
        return
      }
      if (occ && !occ.disposable) {
        this.popup(t('Empurrou para fora!'), rec.center.clone().add(new V3(0, 0.14, 0)), '#ffb347')
        this.eject(occ)
      } else if (occ) this.eject(occ)
      const r = bestFit(def, rec.def)
      rec.occupant = mol
      mol.dockedIn = rec
      mol.result = r
      const toP = rec.center.clone()
      this.tween(mol, toP, rec.quat.clone().multiply(this.dockQuatFor(r.perm)), 0.35, easeBack, 0, () => {
        mol.state = 'docked'
        if (r.activates) this.activate(rec, def)
        window.setTimeout(() => {
          if (mol.dockedIn !== rec) return
          if (def.substrate) {
            // The enzyme cuts it: it leaves as processed pieces.
            mol.obj.traverse(o => {
              const mat = (o as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined
              if (mat && 'emissive' in mat) { mat.color.setHex(0xff5a5a); mat.emissive.setHex(0xff2a2a) }
            })
            this.fx.burst(this.worldOf(rec.center), 0xffb347, 20, 0.4, 0.025)
          }
          this.eject(mol)
          if (level.kind === 'tutorial' && this.tutStep === 0) window.setTimeout(() => this.setTutStep(1), 900)
        }, 1500)
      })
    })
  }

  private setTutStep(n: number): void {
    if (this.level?.kind !== 'tutorial' || n <= this.tutStep) return
    this.tutStep = n
    this.audio.play('click')
    this.mission.invalidate()
  }

  private win(): void {
    if (this.won || !this.level) return
    this.won = true
    const idx = LEVELS.indexOf(this.level)
    if (this.run) {
      this.run.times[this.run.step] = performance.now() - this.run.phaseStart
      this.autoNext = CONFIG.play.autoNextSeconds
    } else if (idx >= 0 && idx < LEVELS.length - 1) this.autoNext = CONFIG.play.autoNextSeconds
    this.done.add(this.level.id)
    try { localStorage.setItem(SAVE_KEY, JSON.stringify([...this.done])) } catch { /* ignore */ }
    this.safe('som', () => this.audio.play('win'))
    this.safe('vibração', () => this.hapticAll(1, 200))
    const bp = this.receptors[0]?.board.mesh.position ?? new V3(0, 1.5, -0.7)
    this.popup(t('ACERTOU!'), bp.clone().add(new V3(0, 0.1, 0)), '#3ee6b0', 1.8)
    for (let i = 0; i < 5; i++) {
      window.setTimeout(() => {
        const p = new V3((Math.random() - 0.5) * 0.8, 1.4 + Math.random() * 0.3, -0.5)
        for (const c of [0x3ee6b0, 0xffd23f, 0xff9db5, 0x7fc8ff]) this.fx.burst(this.worldOf(p), c, 8, 0.5, 0.02, 0.4)
      }, i * 160)
    }
    this.setMissionButtons()
    this.mission.invalidate()
  }

  // ---------------------------------------------------------------- helpers

  private popup(text: string, at: THREE.Vector3, color: string, scale = 1): void {
    const tex = labelTexture([{ text, size: 64, bold: true, color }], 640, 120)
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false, toneMapped: false }))
    sprite.scale.set(0.32 * scale, 0.06 * scale, 1)
    sprite.position.copy(at).add(new V3(0, 0.05, 0.06))
    sprite.renderOrder = 10
    this.root.add(sprite)
    this.popups.push({ sprite, life: 1.5 })
  }

  private worldOf(local: THREE.Vector3): THREE.Vector3 {
    // fx group lives in root, so local coordinates are already correct.
    return local.clone()
  }

  private dirWorld(v: THREE.Vector3): THREE.Vector3 {
    return v
  }

  private hapticAll(intensity: number, ms: number): void {
    for (const p of this.pointers.xr) if (p.active) p.haptic(intensity, ms)
  }

  /** Desktop toolbar actions. */
  rotateHeld(steps: number): void { this.pointers.mouse.rotateSteps += steps }
  flipHeld(): void { this.pointers.mouse.flip = true }

  /** Test/debug hook: drop a tray molecule on the first receptor with its best orientation. */
  debugDock(id: MoleculeId, targetIndex = 0): FitResult | null {
    const mol = this.mols.find(m => m.def.id === id && !m.disposable)
    const rec = this.receptors[targetIndex]
    if (!mol || !rec) return null
    mol.obj.quaternion.copy(rec.quat.clone().multiply(this.dockQuatFor(bestFit(mol.def, rec.def).perm)))
    mol.obj.position.copy(rec.center).addScaledVector(rec.normal, 0.05)
    this.dropOn(mol, rec)
    return this.last?.r ?? null
  }
  get isWon(): boolean { return this.won }
}

function drawLogo(ctx: CanvasRenderingContext2D, x: number, y: number, s: number): void {
  // Hexagon ring with a key-shaped arm docking into a notch.
  ctx.save()
  ctx.translate(x + s / 2, y + s / 2)
  ctx.lineWidth = s * 0.11
  ctx.strokeStyle = MINT
  ctx.beginPath()
  for (let i = 0; i < 6; i++) {
    const a = Math.PI / 6 + (i * Math.PI) / 3
    const px = Math.cos(a) * s * 0.42
    const py = Math.sin(a) * s * 0.42
    if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py)
  }
  ctx.closePath()
  ctx.stroke()
  ctx.fillStyle = '#ffd23f'
  ctx.beginPath(); ctx.arc(0, 0, s * 0.13, 0, Math.PI * 2); ctx.fill()
  ctx.restore()
}
