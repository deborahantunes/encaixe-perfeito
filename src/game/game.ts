import * as THREE from 'three'
import type { Audio } from '../core/audio'
import type { Pointer, Pointers } from '../core/pointers'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import { CONFIG } from './config'
import { CHEM_COLOR, LAB_LEVEL, LEVEL_BY_ID, MOLECULES, TARGETS, TIERS, TIER_ABOUT, TIER_NAME, stagesOf, type LevelDef, type MoleculeDef, type MoleculeId, type TargetId, type Tier } from './data'
import { Fx } from './fx'
import { armDir, buildMolecule, buildReceptor, labelTexture, type ReceptorModel } from './models'
import { MINT, Panel, fitFont, font, roundRect, wrapText } from './panel'
import { placeReceptor, receptorX } from './layout'
import { t } from '../i18n'
import { bestToday, fmtTime, lastEventSetting, normalizeEvent, rememberEventSetting, saveBest, saveEventSetting, type EventSetting } from './event'
import { TEAM_NAMES, bestAffinity } from './challenges'
import { RoomClient, serverUrl, type Judged, type PoseMol, type RoomState, type TeamState } from '../net/room'
import { ranking, teamName } from '../net/ranking'
import { recordError } from '../core/errlog'
import { track } from '../core/analytics'
import { FIT_TITLE, PERMS, bestFit, effectText, evaluate, evaluateTurnOnly, rank, type FitResult, type Perm } from './rules'

const V3 = THREE.Vector3
const Q = THREE.Quaternion
const EYE = 1.5
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

export type HudState = { holding: string | null; xr: boolean; mode: 'menu' | 'level'; event: boolean; group?: boolean }

type EventRun = { setting: EventSetting; levels: LevelDef[]; step: number; phaseStart: number; times: number[]; lastAction: number }
type EventResult = { setting: EventSetting; times: number[]; total: number; record: boolean; best: number; at: number }
type GroupView = 'join' | 'room'
const FREE_TIER_KEY = 'encaixe-nivel-livre'

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
  /** Group challenge panel: room code keypad, team colors, countdown, results and podium. */
  private groupPanel: Panel
  /** Event mode: null = off, otherwise the difficulty and how many stages each visitor plays. */
  event: EventSetting | null = null
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
  /** Main menu page: the three modes, or the free lab (difficulty tabs + stages). */
  private menuPage: 'home' | 'free' = 'home'
  private freeTier: Tier = 'facil'
  // ---- group challenge ("Desafio em grupo")
  room: RoomClient | null = null
  private groupView: GroupView = 'join'
  private joinCode = ''
  private joinError = ''
  private groupRound = -1
  private groupSolved = false
  private groupPoints = 0
  private groupFeedback = ''
  private poseTimer = 0
  private groupClock = ''
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
    this.groupPanel = new Panel(0.9, 0.76, 1500)
    this.groupPanel.mesh.position.set(0, 1.45, -0.74)
    this.groupPanel.mesh.visible = false
    this.menuGroup.add(this.groupPanel.mesh)
    this.groupPanel.setDraw((ctx, w, h) => this.drawGroup(ctx, w, h))
    try { const ft = localStorage.getItem(FREE_TIER_KEY); if ((TIERS as string[]).includes(ft ?? '')) this.freeTier = ft as Tier } catch { /* ignore */ }
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

  /** Shows one of the three 2D panels of the menu area (main menu, event lobby, group challenge). */
  private showPanel(which: 'menu' | 'lobby' | 'group'): void {
    this.clearLevel()
    this.mode = 'menu'
    this.level = null
    this.autoNext = 0
    this.menuGroup.visible = true
    this.menu.mesh.visible = which === 'menu'
    this.lobby.mesh.visible = which === 'lobby'
    this.groupPanel.mesh.visible = which === 'group'
    this.mission.mesh.visible = false
    this.legend.mesh.visible = true
  }

  showMenu(page: 'home' | 'free' = this.menuPage): void {
    if (this.room) { this.showGroup(); return }
    if (this.event) { this.showLobby(); return }
    this.run = null
    this.menuPage = page
    this.showPanel('menu')
    const b = (id: string, x: number, y: number, w: number, h: number, label: string, onClick: () => void, color?: string, fontPx?: number) =>
      ({ id, x, y, w, h, label, onClick, color, fontPx })
    const W = this.menu.canvas.width
    const xr = this.renderer.xr.isPresenting
    if (page === 'home') {
      this.menu.buttons = [
        b('free', 60, 372, W - 120, 108, t('Laboratório livre'), () => this.showMenu('free'), MINT, 50),
        b('event', 60, 498, W - 120, 108, t('Modo evento (fila de visitantes)'), () => this.setEvent(lastEventSetting()), '#ffd23f', 50),
        b('group', 60, 624, W - 120, 108, t('Desafio em grupo (até 4 óculos)'), () => this.openJoin(), '#7fc8ff', 50),
      ]
    } else {
      const tw = (W - 120 - 2 * 24) / 3
      this.menu.buttons = TIERS.map((tier, i) => b(`tier-${tier}`, 60 + i * (tw + 24), 226, tw, 84, t(TIER_NAME[tier]), () => {
        this.freeTier = tier
        try { localStorage.setItem(FREE_TIER_KEY, tier) } catch { /* ignore */ }
        this.showMenu('free')
      }, tier === this.freeTier ? '#ffd23f' : '#8f86c9', 42))
      const items: LevelDef[] = [...stagesOf(this.freeTier), LAB_LEVEL]
      const cw = (W - 120 - 30) / 2
      const rows = Math.ceil(items.length / 2)
      const bh = rows > 3 ? 78 : 96
      const gap = rows > 3 ? 12 : 16
      items.forEach((lv, i) => this.menu.buttons.push(b(`lv${lv.id}`, 60 + (i % 2) * (cw + 30), 386 + Math.floor(i / 2) * (bh + gap), cw, bh,
        `${this.done.has(lv.id) ? '✓ ' : ''}${lv.title}`, () => this.startLevel(lv), lv.kind === 'lab' ? '#7fc8ff' : undefined, 34)))
    }
    const row = 768
    if (page === 'free') this.menu.buttons.push(b('back', 60, row, 250, 86, t('Voltar'), () => this.showMenu('home'), '#c9c4e8'))
    this.menu.buttons.push(b('sound', page === 'free' ? 330 : 60, row, 270, 86, this.audio.muted ? t('Som: desligado') : t('Som: ligado'), () => {
      this.audio.muted = !this.audio.muted
      this.showMenu()
    }, '#c9c4e8'))
    if (xr) {
      // In VR the logo moves to the top right; recenter and exit join the bottom row.
      this.menu.buttons.push(b('recenter', page === 'free' ? 620 : 350, row, 290, 86, t('Recentralizar'), () => { this.needAlign = 1 }, '#c9c4e8'))
      this.menu.buttons.push(b('exit', W - 330, row, 270, 86, t('Sair da RV'), () => { void this.renderer.xr.getSession()?.end() }, '#ff9db5'))
    }
    this.menu.invalidate()
    this.legend.invalidate()
    this.emitHud()
  }

  // ---------------------------------------------------------------- event mode (fila de visitantes)

  /** Turns event mode on (difficulty + number of stages per visitor) or off (null). */
  setEvent(s: EventSetting | null): void {
    if (s) { s = normalizeEvent(s); rememberEventSetting(s) }
    if (s && this.room) this.leaveGroup(false)
    this.event = s
    saveEventSetting(s)
    if (this.result && (!s || this.result.setting.tier !== s.tier || this.result.setting.count !== s.count)) this.result = null
    if (this.mode === 'menu' || !s) { this.run = null; this.showMenu('home') }
    this.emitHud()
  }

  private showLobby(): void {
    this.run = null
    this.showPanel('lobby')
    const W = this.lobby.canvas.width
    const b = (id: string, x: number, y: number, w: number, h: number, label: string, onClick: () => void, color?: string, fontPx?: number) =>
      ({ id, x, y, w, h, label, onClick, color, fontPx })
    const ev = this.event!
    const n = ev.count
    this.lobby.buttons = [b('start', 60, 590, W - 120, 140,
      n === 1 ? t('COMEÇAR · 1 fase') : t('COMEÇAR · {n} fases', { n }), () => this.startRun(), MINT, 66)]
    // Staff rows: difficulty, number of stages, free mode.
    const tiers: [Tier | null, string][] = [...TIERS.map(x => [x, t(TIER_NAME[x])] as [Tier, string]), [null, t('Modo livre')]]
    tiers.forEach(([tier, label], i) => this.lobby.buttons.push(b(`tier-${tier ?? 'off'}`, 250 + i * 262, 770, 246, 62, label,
      () => this.setEvent(tier ? { tier, count: tier === ev.tier ? ev.count : stagesOf(tier).length } : null),
      tier === ev.tier ? '#ffd23f' : tier ? '#8f86c9' : '#c9c4e8', 32)))
    const max = stagesOf(ev.tier).length
    for (let k = 1; k <= max; k++) {
      this.lobby.buttons.push(b(`n${k}`, 250 + (k - 1) * 150, 848, 134, 62, String(k), () => this.setEvent({ tier: ev.tier, count: k }), k === n ? '#ffd23f' : '#8f86c9', 34))
    }
    this.lobby.buttons.push(b('sound', 60, 940, 280, 62, this.audio.muted ? t('Som: desligado') : t('Som: ligado'), () => {
      this.audio.muted = !this.audio.muted
      this.showLobby()
    }, '#c9c4e8', 30))
    if (this.renderer.xr.isPresenting) {
      this.lobby.buttons.push(b('recenter', 360, 940, 320, 62, t('Recentralizar'), () => { this.needAlign = 1 }, '#c9c4e8', 30))
      this.lobby.buttons.push(b('exit', W - 340, 940, 280, 62, t('Sair da RV'), () => { void this.renderer.xr.getSession()?.end() }, '#ff9db5', 30))
    }
    this.lobby.invalidate()
    this.legend.invalidate()
    this.emitHud()
  }

  private startRun(): void {
    const now = performance.now()
    const setting = this.event!
    this.result = null
    const levels = stagesOf(setting.tier).slice(0, setting.count)
    this.run = { setting, levels, step: 0, phaseStart: now, times: [], lastAction: now }
    track('event_run_start', { phases: setting.count, tier: setting.tier })
    this.clockSec = -1
    this.startLevel(levels[0])
  }

  /** After the countdown that follows a win: next level, or the final result. */
  private advanceRun(): void {
    const run = this.run!
    run.step++
    if (run.step >= run.levels.length) { this.finishRun(); return }
    run.phaseStart = run.lastAction = performance.now()
    this.clockSec = -1
    this.startLevel(run.levels[run.step])
  }

  private finishRun(): void {
    const run = this.run!
    const total = run.times.reduce((a, x) => a + x, 0)
    const prev = bestToday(run.setting)
    const record = saveBest(run.setting, total)
    this.result = { setting: run.setting, times: [...run.times], total, record, best: record ? total : prev, at: performance.now() }
    this.clockSec = -1
    track('event_run_complete', { phases: run.setting.count, tier: run.setting.tier, total_seconds: Math.round(total / 1000), day_record: record })
    this.showLobby()
    this.safe('som', () => this.audio.play('win'))
    this.confetti(6, 1.5, -0.6)
  }

  private confetti(n: number, y: number, z: number): void {
    for (let i = 0; i < n; i++) {
      window.setTimeout(() => {
        const p = new V3((Math.random() - 0.5) * 1.0, y + Math.random() * 0.4, z)
        for (const c of [0x3ee6b0, 0xffd23f, 0xff9db5, 0x7fc8ff]) this.fx.burst(this.worldOf(p), c, 8, 0.5, 0.02, 0.4)
      }, i * 180)
    }
  }

  private tickEvent(): void {
    const now = performance.now()
    if (this.run && this.mode === 'level') {
      // Visitor left the headset mid-game: start over from the first level, ready for the next person.
      if (now - this.run.lastAction > CONFIG.play.eventIdleSeconds * 1000 && !this.won) { this.startRun(); return }
    }
    if (this.result && this.mode === 'menu' && this.lobby.mesh.visible) {
      const left = CONFIG.play.eventResultSeconds - (now - this.result.at) / 1000
      // Hands-only flow: after "Parabéns!" the next game starts by itself (no button to press).
      if (left <= 0) { this.startRun(); return }
      const sec = Math.ceil(left)
      if (sec !== this.clockSec) { this.clockSec = sec; this.lobby.invalidate() }
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
    const ev = this.event
    if (!ev) return
    const n = ev.count
    const r = this.result
    if (r) {
      ctx.textAlign = 'center'
      ctx.fillStyle = MINT
      ctx.font = font(150, 'bold')
      ctx.fillText(t('Parabéns!'), w / 2, 380)
      ctx.fillStyle = '#ffffff'
      ctx.font = font(48, 'bold')
      ctx.fillText(r.setting.count === 1 ? t('Você completou o desafio!') : t('Você completou as {n} fases!', { n: r.setting.count }), w / 2, 460)
      ctx.fillStyle = '#ffd23f'
      ctx.font = font(36, 'bold')
      const left = Math.max(1, Math.ceil(CONFIG.play.eventResultSeconds - (performance.now() - r.at) / 1000))
      ctx.fillText(t('Próximo jogador em {n} s...', { n: left }), w / 2, 540)
      ctx.textAlign = 'left'
    } else {
      ctx.fillStyle = MINT
      ctx.font = font(56, 'bold')
      ctx.fillText(t('Pronto para o próximo jogador!'), 60, 284)
      ctx.fillStyle = '#d8d3f5'
      ctx.font = font(32)
      const y = wrapText(ctx, t('Muitos remédios funcionam assim: uma molécula se encaixa numa proteína do corpo, como uma chave na fechadura. Pegue as moléculas, teste o encaixe e descubra o que acontece.'), 60, 340, w - 120, 42, 3)
      ctx.fillStyle = '#ffd23f'
      ctx.font = font(32, 'bold')
      const tier = t(TIER_NAME[ev.tier])
      wrapText(ctx, n === 1 ? t('Nível {tier}: você vai jogar 1 fase.', { tier }) : t('Nível {tier}: você vai jogar {n} fases seguidas.', { tier, n }), 60, y + 14, w - 120, 42, 2)
    }
    ctx.textAlign = 'left'
    ctx.fillStyle = '#9a93c9'
    ctx.font = font(28, 'bold')
    ctx.fillText(t('Nível:'), 60, 812)
    ctx.fillText(t('Fases:'), 60, 890)
    ctx.font = font(24)
    ctx.fillText(t('Proteínas reais (banco PDB: tripsina 1BJU, trombina 1PPB, receptor β2 2RH1), com bolsos simplificados.'), 60, h - 84)
    ctx.fillText(t('Todas as moléculas são INVENTADAS: o jogo não mostra nem recomenda nenhum remédio de verdade.'), 60, h - 46)
  }

  // ---------------------------------------------------------------- group challenge ("Desafio em grupo")

  /** Opens the room-code keypad (or joins right away with a code from the URL / start screen). */
  openJoin(code = ''): void {
    if (this.event) { this.event = null; saveEventSetting(null) }
    this.run = null
    this.groupView = 'join'
    this.joinError = ''
    this.joinCode = code.replace(/\D/g, '').slice(0, 4)
    if (this.joinCode.length === 4) { this.joinRoom(this.joinCode); return }
    this.showGroup()
  }

  joinRoom(code: string): void {
    this.room?.close()
    this.joinError = ''
    this.groupRound = -1
    const room = new RoomClient(serverUrl(), 'player', code)
    this.room = room
    this.groupView = 'room'
    try { sessionStorage.setItem('encaixe-sala-atual', code) } catch { /* ignore */ }
    room.onState = s => this.safe('desafio em grupo', () => this.applyRoomState(s))
    room.onStatus = () => this.safe('desafio em grupo', () => { this.groupPanel.invalidate(); this.mission.invalidate() })
    room.onWelcome = () => this.safe('desafio em grupo', () => this.refreshGroup())
    room.onJudged = j => this.safe('desafio em grupo', () => this.onJudged(j))
    room.onError = code => this.safe('desafio em grupo', () => {
      if (code === 'no_room') {
        this.leaveGroup(false)
        this.joinError = t('Sala {code} não encontrada. Confira o código no telão.', { code: room.room })
        this.groupView = 'join'
        this.joinCode = ''
        this.showGroup()
      } else if (code === 'team_taken') { this.joinError = t('Essa cor já foi escolhida por outro óculos.'); this.groupPanel.invalidate() }
    })
    track('group_join', { xr: this.renderer.xr.isPresenting })
    this.showGroup()
  }

  /** Leaves the room (the seat stays on the teacher's board until freed there). */
  leaveGroup(show = true): void {
    const room = this.room
    this.room = null
    room?.close()
    try { sessionStorage.removeItem('encaixe-sala-atual') } catch { /* ignore */ }
    this.groupRound = -1
    if (show) this.showMenu('home')
  }

  private applyRoomState(s: RoomState): void {
    const room = this.room
    if (!room) return
    const playing = s.phase === 'round' && room.team >= 0 && s.levelId !== null
    if (playing) {
      const lv = LEVEL_BY_ID.get(s.levelId!)
      if (lv && (this.groupRound !== s.round || this.mode !== 'level' || this.level !== lv)) {
        this.groupRound = s.round
        this.groupSolved = false
        this.groupPoints = 0
        this.groupFeedback = ''
        this.startLevel(lv)
      }
      const me = s.teams[room.team]
      if (me?.solved && !this.groupSolved) { this.groupSolved = true; this.groupPoints = me.points; this.setMissionButtons() }
      this.mission.invalidate()
      return
    }
    if (s.phase === 'podium' && this.groupClock !== 'podium') { this.confetti(6, 1.5, -0.6); this.safe('som', () => this.audio.play('win')) }
    this.groupClock = s.phase
    this.showGroup()
  }

  private onJudged(j: Judged): void {
    if (j.late || j.duplicate) return
    if (j.ok) {
      this.groupSolved = true
      this.groupPoints = j.points ?? 0
      this.groupFeedback = t('+{n} pontos!', { n: this.groupPoints })
      if (!this.won) this.win()
      this.setMissionButtons()
    } else if (j.wrong) {
      this.groupFeedback = j.wrong === 1 ? t('1 tentativa errada (−15 pontos no acerto).') : t('{n} tentativas erradas (−{p} pontos no acerto).', { n: j.wrong, p: Math.min(60, j.wrong * 15) })
    }
    this.mission.invalidate()
  }

  /** Shows the group panel for the current state (keypad, team colors, waiting, countdown, results, podium). */
  private showGroup(): void {
    this.showPanel('group')
    this.refreshGroup()
  }

  private refreshGroup(): void {
    const P = this.groupPanel
    const W = P.canvas.width
    const H = P.canvas.height
    const b = (id: string, x: number, y: number, w: number, h: number, label: string, onClick: () => void, color?: string, fontPx?: number) =>
      ({ id, x, y, w, h, label, onClick, color, fontPx })
    const room = this.room
    const s = room?.state
    P.buttons = []
    if (this.groupView === 'join' || !room) {
      // Numeric keypad for the 4-digit room code.
      const kw = 210, kh = 104, gap = 22
      const x0 = (W - 3 * kw - 2 * gap) / 2
      const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '⌫', '0', 'OK']
      keys.forEach((k, i) => {
        const x = x0 + (i % 3) * (kw + gap)
        const y = 420 + Math.floor(i / 3) * (kh + 18)
        const ok = k === 'OK'
        P.buttons.push(b(`key${k}`, x, y, kw, kh, ok ? t('Entrar') : k, () => {
          if (ok) { if (this.joinCode.length === 4) this.joinRoom(this.joinCode); return }
          if (k === '⌫') this.joinCode = this.joinCode.slice(0, -1)
          else if (this.joinCode.length < 4) this.joinCode += k
          this.joinError = ''
          this.refreshGroup()
        }, ok ? (this.joinCode.length === 4 ? MINT : '#5f5a86') : k === '⌫' ? '#c9c4e8' : '#e8e4ff', ok ? 40 : 56))
      })
      P.buttons.push(b('back', 60, H - 130, 280, 80, t('Voltar'), () => this.leaveGroup(), '#c9c4e8', 34))
    } else if (room.team < 0) {
      // Team (color) choice. Taken colors are greyed out.
      const cw = (W - 120 - 30) / 2
      ;(s?.teams ?? TEAM_NAMES.map((name, index) => ({ index, name, claimed: false, online: false } as TeamState))).forEach((tm, i) => {
        const taken = tm.claimed && tm.online
        P.buttons.push(b(`team${i}`, 60 + (i % 2) * (cw + 30), 380 + Math.floor(i / 2) * 190, cw, 160,
          taken ? `${teamName(tm)} · ${t('ocupado')}` : teamName(tm), () => { if (!taken) room.pick(i) }, taken ? '#4a4670' : s?.teams[i]?.color ?? '#8f86c9', 46))
      })
      P.buttons.push(b('leave', 60, H - 130, 340, 80, t('Sair do desafio'), () => this.leaveGroup(), '#ff9db5', 34))
    } else if (!s || s.phase === 'lobby' || s.phase === 'podium') {
      if (s?.phase !== 'podium') P.buttons.push(b('swap', 60, H - 130, 340, 80, t('Trocar de cor'), () => { room.team = -1; this.refreshGroup() }, '#c9c4e8', 34))
      P.buttons.push(b('leave', W - 400, H - 130, 340, 80, t('Sair do desafio'), () => this.leaveGroup(), '#ff9db5', 34))
    }
    if (this.renderer.xr.isPresenting && (this.groupView === 'join' || !room || room.team < 0 || s?.phase === 'lobby')) {
      P.buttons.push(b('recenter', W / 2 - 160, H - 130, 320, 80, t('Recentralizar'), () => { this.needAlign = 1 }, '#c9c4e8', 32))
    }
    P.invalidate()
    this.legend.invalidate()
    this.emitHud()
  }

  private drawGroup(ctx: CanvasRenderingContext2D, w: number, h: number): void {
    drawLogo(ctx, 60, 50, 110)
    ctx.textAlign = 'left'
    ctx.textBaseline = 'alphabetic'
    ctx.fillStyle = '#ffffff'
    ctx.font = font(76, 'bold')
    ctx.fillText(t('Desafio em grupo'), 200, 118)
    const room = this.room
    const s = room?.state
    ctx.fillStyle = MINT
    ctx.font = font(38, 'bold')
    ctx.fillText(room ? t('Sala {code}', { code: room.room }) : t('Até 4 óculos jogando juntos'), 200, 172)
    if (room && room.status !== 'open') {
      ctx.fillStyle = '#ffb347'
      ctx.font = font(32, 'bold')
      ctx.textAlign = 'right'
      ctx.fillText(room.status === 'closed' ? t('Desconectado') : t('Conectando...'), w - 60, 172)
      ctx.textAlign = 'left'
    }
    const center = (text: string, y: number, px: number, color = '#ffffff', weight: 'bold' | 'normal' = 'bold') => {
      ctx.textAlign = 'center'; ctx.fillStyle = color; fitFont(ctx, text, w - 120, px, weight); ctx.fillText(text, w / 2, y); ctx.textAlign = 'left'
    }
    if (this.groupView === 'join' || !room) {
      center(t('Digite o código da sala que aparece no telão'), 262, 40, '#d8d3f5')
      const bw = 120, gap = 26
      const x0 = (w - 4 * bw - 3 * gap) / 2
      for (let i = 0; i < 4; i++) {
        roundRect(ctx, x0 + i * (bw + gap), 290, bw, 104, 20)
        ctx.fillStyle = 'rgba(255,255,255,0.1)'; ctx.fill()
        ctx.strokeStyle = i === this.joinCode.length ? '#ffd23f' : 'rgba(255,255,255,0.3)'; ctx.lineWidth = 5; ctx.stroke()
        if (this.joinCode[i]) { ctx.fillStyle = '#ffffff'; ctx.font = font(72, 'bold'); ctx.textAlign = 'center'; ctx.fillText(this.joinCode[i], x0 + i * (bw + gap) + bw / 2, 368); ctx.textAlign = 'left' }
      }
      if (this.joinError) center(this.joinError, h - 160, 32, '#ff9db5')
      return
    }
    if (room.team < 0) {
      center(s ? t('Escolha a cor do seu time') : t('Conectando à sala...'), 300, 52)
      if (this.joinError) center(this.joinError, h - 160, 32, '#ff9db5')
      return
    }
    const me = s?.teams[room.team]
    if (!s || !me) return
    const tier = t(TIER_NAME[s.tier])
    if (s.phase === 'lobby') {
      ctx.textAlign = 'center'
      ctx.fillStyle = me.color
      fitFont(ctx, t('Seu time: {team}', { team: teamName(me) }), w - 120, 84, 'bold')
      ctx.fillText(t('Seu time: {team}', { team: teamName(me) }), w / 2, 320)
      ctx.textAlign = 'left'
      center(t('Aguardando o professor começar...'), 400, 44, '#ffd23f')
      center(t('Nível {tier} · {n} desafios', { tier, n: s.totalRounds }), 460, 36, '#d8d3f5', 'normal')
      this.drawTeamRows(ctx, s, 530, w, false)
      return
    }
    const left = Math.max(0, Math.ceil((s.phaseEndsAt - room.now()) / 1000))
    if (s.phase === 'countdown') {
      const lv = s.levelId !== null ? LEVEL_BY_ID.get(s.levelId) : null
      center(t('Desafio {n} de {total}', { n: s.round + 1, total: s.totalRounds }), 290, 52, '#d8d3f5')
      if (lv) center(lv.title, 370, 56, MINT)
      center(String(Math.max(1, left)), 640, 260, '#ffd23f')
      if (lv) { ctx.fillStyle = '#ffffff'; ctx.font = font(34); ctx.textAlign = 'center'; wrapText(ctx, lv.goal, w / 2, 760, w - 160, 44, 3); ctx.textAlign = 'left' }
      return
    }
    if (s.phase === 'results') {
      center(t('Fim do desafio {n} de {total}', { n: s.round + 1, total: s.totalRounds }), 286, 52, '#ffffff')
      center(s.round + 1 < s.totalRounds ? t('Próximo desafio em {n} s', { n: Math.max(1, left) }) : t('Pódio em {n} s', { n: Math.max(1, left) }), 346, 36, '#ffd23f')
      this.drawTeamRows(ctx, s, 420, w, true)
      return
    }
    // Podium.
    const order = ranking(s.teams)
    center(t('Pódio!'), 280, 96, '#ffd23f')
    const place = order.findIndex(x => x.index === me.index)
    if (place >= 0) center(place === 0 ? t('Seu time venceu! Parabéns!') : t('Seu time ficou em {n}º lugar.', { n: place + 1 }), 352, 42, me.color)
    const slots = [1, 0, 2].filter(i => order[i])
    const bw = 300
    const base = 900
    slots.forEach((rankIdx, k) => {
      const tm = order[rankIdx]
      const x = w / 2 - (slots.length * bw + (slots.length - 1) * 30) / 2 + k * (bw + 30)
      const bh = [300, 220, 160][rankIdx]
      roundRect(ctx, x, base - bh, bw, bh, 18)
      ctx.fillStyle = tm.color; ctx.fill()
      ctx.textAlign = 'center'
      ctx.fillStyle = '#14112e'
      ctx.font = font(90, 'bold')
      ctx.fillText(`${rankIdx + 1}º`, x + bw / 2, base - bh + 100)
      ctx.font = font(34, 'bold')
      ctx.fillText(t('{n} pts', { n: tm.score }), x + bw / 2, base - 26)
      ctx.fillStyle = '#ffffff'
      fitFont(ctx, teamName(tm), bw, 36, 'bold')
      ctx.fillText(teamName(tm), x + bw / 2, base - bh - 18)
      ctx.textAlign = 'left'
    })
  }

  /** Ranking rows (color dot, team, points, ✓ for this round). */
  private drawTeamRows(ctx: CanvasRenderingContext2D, s: RoomState, y: number, w: number, round: boolean, rowH = 76, x0 = 120, px = 40): number {
    const rows = s.phase === 'lobby' ? s.teams.filter(x => x.claimed) : ranking(s.teams)
    rows.forEach((tm, i) => {
      const yy = y + i * rowH
      ctx.beginPath(); ctx.arc(x0, yy - px * 0.32, px * 0.42, 0, Math.PI * 2); ctx.fillStyle = tm.color; ctx.fill()
      ctx.textAlign = 'left'
      ctx.fillStyle = tm.online ? '#ffffff' : '#8f89b8'
      ctx.font = font(px, 'bold')
      const label = s.phase === 'lobby' ? teamName(tm) : `${i + 1}º  ${teamName(tm)}`
      ctx.fillText(tm.online ? label : `${label} (${t('sem conexão')})`, x0 + px, yy)
      if (s.phase !== 'lobby') {
        ctx.textAlign = 'right'
        ctx.fillStyle = '#ffd23f'
        ctx.fillText(t('{n} pts', { n: tm.score }), w - x0 + 40, yy)
        if (round) {
          ctx.fillStyle = tm.solved ? MINT : '#ff9db5'
          ctx.font = font(px * 0.8, 'bold')
          ctx.fillText(tm.solved ? `✓ +${tm.points} · ${fmtTime(tm.solvedMs)}` : '✗', w - x0 - px * 4.2, yy)
        }
        ctx.textAlign = 'left'
      }
    })
    return y + rows.length * rowH
  }

  /** Sends this headset's molecule poses to the teacher screen (live view), ~8 times per second. */
  private sendPoses(dt: number): void {
    const room = this.room
    if (!room || room.state?.phase !== 'round' || this.mode !== 'level' || room.team < 0) return
    this.poseTimer -= dt
    if (this.poseTimer > 0) return
    this.poseTimer = 0.125
    const r3 = (x: number) => Math.round(x * 1000) / 1000
    const mols: PoseMol[] = this.mols.filter(m => !m.disposable).slice(0, 8).map(m => ({
      id: m.def.id,
      p: [r3(m.obj.position.x), r3(m.obj.position.y), r3(m.obj.position.z)],
      q: [r3(m.obj.quaternion.x), r3(m.obj.quaternion.y), r3(m.obj.quaternion.z), r3(m.obj.quaternion.w)],
      s: m.state === 'docked' ? (m.result?.fit ?? 'docked') : m.state,
    }))
    const held = this.mols.find(m => m.state === 'held')?.def.id ?? null
    room.send({ type: 'pose', held, mols })
  }

  /** Per-frame: countdown numbers on the group panel and the round clock on the mission panel. */
  private tickGroup(dt: number): void {
    const room = this.room
    const s = room?.state
    if (!room || !s) return
    this.sendPoses(dt)
    const key = s.phase === 'round' ? `r${Math.ceil((s.endsAt - room.now()) / 1000)}` : `${s.phase}${Math.ceil((s.phaseEndsAt - room.now()) / 1000)}`
    if (key === this.groupClock) return
    this.groupClock = key
    if (s.phase === 'round' && this.mode === 'level') this.mission.invalidate()
    else if (this.groupPanel.mesh.visible) this.groupPanel.invalidate()
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

  /** Starts a stage (a LevelDef, or its id). */
  startLevel(which: LevelDef | number): void {
    const level = typeof which === 'number' ? LEVEL_BY_ID.get(which) : which
    if (!level) throw new Error(`fase desconhecida: ${String(which)}`)
    this.clearLevel()
    this.level = level
    this.mode = 'level'
    this.menuGroup.visible = false
    this.groupPanel.mesh.visible = false
    this.mission.mesh.visible = true
    this.legend.mesh.visible = true
    this.won = false
    this.last = null
    this.heldInfo = null
    this.natTimer = 0
    this.autoNext = 0
    this.notebook.clear()
    const targets = level.kind === 'lab' ? [this.labTarget] : level.targets
    targets.forEach((tid, i) => this.addReceptor(tid, receptorX(i, targets.length)))
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
    placeReceptor(def, x, rec.center, rec.quat)
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
    // Event mode and the group challenge are self-running: no "end" button a child could bump by accident.
    const restart = () => { const keep = this.groupSolved; this.startLevel(level); this.groupSolved = keep }
    this.mission.buttons = this.run || this.room
      ? (this.room && this.groupSolved ? [] : [btn('restart', 40, H - 120, 260, 84, t('Recomeçar'), restart, '#c9c4e8')])
      : [
        btn('menu', 40, H - 120, 220, 84, t('Menu'), () => this.showMenu('free'), '#c9c4e8'),
        btn('restart', 280, H - 120, 260, 84, t('Recomeçar'), restart, '#c9c4e8'),
      ]
    if ((level.kind === 'block' || level.kind === 'activate') && !this.won && level.natural && !this.room) {
      this.mission.buttons.push(btn('demo', 40, H - 216, W - 80, 80, t('Ver o que faz a molécula natural'), () => { this.natTimer = 0.05 }, '#7fc8ff'))
    }
    if (level.kind === 'lab') {
      const ids: TargetId[] = ['tripsina', 'trombina', 'beta2']
      const bw = (W - 80 - 2 * 16) / 3
      ids.forEach((tid, i) => this.mission.buttons.push(btn(`t-${tid}`, 40 + i * (bw + 16), 250, bw, 76,
        TARGETS[tid].short, () => { this.labTarget = tid; this.startLevel(level) }, tid === this.labTarget ? '#ffd23f' : '#8f86c9')))
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
    if (this.menuPage === 'free') {
      ctx.fillStyle = '#d8d3f5'
      ctx.font = font(30)
      wrapText(ctx, t(TIER_ABOUT[this.freeTier]), 60, 356, w - 120, 36, 1)
    } else {
      ctx.fillStyle = '#d8d3f5'
      ctx.font = font(31)
      wrapText(ctx, t('Muitos remédios funcionam assim: uma molécula se encaixa numa proteína do corpo, como uma chave na fechadura. Pegue as moléculas, teste o encaixe e descubra o que acontece.'), 60, 256, w - 120, 40, 3)
    }
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

  /** Oil/water-only legend: levels with no charged cavity (Stage 1), or the lobby of a 1-stage event. */
  private simpleLegend(): boolean {
    const isCharge = (c: string) => c === 'pos' || c === 'neg'
    if (this.level) return (this.level.kind === 'lab' ? [this.labTarget] : this.level.targets).every(id => !TARGETS[id].cavities.some(c => isCharge(c.chem)))
    return !!this.event && this.event.tier === 'facil' && this.event.count === 1
  }

  private drawLegend(ctx: CanvasRenderingContext2D, w: number, _h: number): void {
    ctx.textAlign = 'left'
    ctx.textBaseline = 'alphabetic'
    ctx.fillStyle = MINT
    ctx.font = font(46, 'bold')
    ctx.fillText(t('Como encaixar'), 40, 76)
    const simple = this.simpleLegend()
    const rows: [number, string, string][] = [
      ...(simple ? [] : [[CHEM_COLOR.pos, '+', t('Carga positiva')], [CHEM_COLOR.neg, '−', t('Carga negativa')]] as [number, string, string][]),
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
    const rules = simple ? [
      t('• Óleo com óleo, água com água'),
      t('• A bolinha precisa CABER no buraco'),
      t('• Gire a molécula até as cores combinarem'),
    ] : [
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
    fitFont(ctx, level.title, w - 80, 46, 'bold')
    ctx.fillText(level.title, 40, 72)
    const room = this.room
    const rs = room?.state
    const group = !!room && rs?.phase === 'round'
    let y = 118
    if (group) {
      // Round clock and this team's status.
      const left = Math.max(0, Math.ceil((rs!.endsAt - room!.now()) / 1000))
      ctx.font = font(34, 'bold')
      ctx.fillStyle = '#c9c4e8'
      ctx.fillText(t('Desafio {n} de {total}', { n: rs!.round + 1, total: rs!.totalRounds }), 40, y)
      ctx.textAlign = 'right'
      ctx.fillStyle = left <= 10 ? '#ff6b6b' : '#ffd23f'
      ctx.font = font(44, 'bold')
      ctx.fillText(`⏱ ${fmtTime(left * 1000)}`, w - 40, y + 4)
      ctx.textAlign = 'left'
      y += 52
    }
    ctx.fillStyle = '#ffffff'
    ctx.font = font(29)
    if (!this.last && !this.heldInfo && !this.won && !group) {
      y = wrapText(ctx, level.intro, 40, y, w - 80, 37, 4) + 6
    }
    ctx.fillStyle = '#ffd23f'
    ctx.font = font(29, 'bold')
    y = wrapText(ctx, t('Missão: {goal}', { goal: level.goal }), 40, y, w - 80, 37, 3)
    if (level.kind === 'lab') y = Math.max(y, 250) + 96
    y += 8
    ctx.strokeStyle = 'rgba(255,255,255,0.15)'
    ctx.lineWidth = 3
    ctx.beginPath(); ctx.moveTo(40, y - 18); ctx.lineTo(w - 40, y - 18); ctx.stroke()
    y += 18
    let bottom = h - (this.mission.buttons.some(b => b.id === 'demo') ? 236 : this.mission.buttons.length ? 140 : 40)
    if (group) {
      // Live ranking at the bottom of the panel.
      const n = rs!.teams.filter(x => x.claimed).length
      const top = bottom - n * 46 - 10
      ctx.strokeStyle = 'rgba(255,255,255,0.15)'
      ctx.beginPath(); ctx.moveTo(40, top - 6); ctx.lineTo(w - 40, top - 6); ctx.stroke()
      ranking(rs!.teams).forEach((tm, i) => {
        const yy = top + 38 + i * 46
        ctx.beginPath(); ctx.arc(56, yy - 10, 13, 0, Math.PI * 2); ctx.fillStyle = tm.color; ctx.fill()
        ctx.textAlign = 'left'
        ctx.fillStyle = tm.index === room!.team ? '#ffffff' : '#c9c4e8'
        ctx.font = font(28, tm.index === room!.team ? 'bold' : 'normal')
        ctx.fillText(`${i + 1}º ${teamName(tm)}${tm.solved ? '  ✓' : ''}`, 82, yy)
        ctx.textAlign = 'right'
        ctx.fillStyle = '#ffd23f'
        ctx.font = font(28, 'bold')
        ctx.fillText(t('{n} pts', { n: tm.score }), w - 40, yy)
        ctx.textAlign = 'left'
      })
      bottom = top - 16
    }
    if (this.won) {
      ctx.fillStyle = MINT
      ctx.font = font(52, 'bold')
      ctx.fillText(group && this.groupPoints ? t('Acertou! +{n} pontos', { n: this.groupPoints }) : t('Acertou! Muito bem!'), 40, y + 20)
      let yy = y + 74
      if (group) {
        ctx.fillStyle = '#ffd23f'
        ctx.font = font(30, 'bold')
        yy = wrapText(ctx, t('Aguarde os outros times...'), 40, yy, w - 80, 38, 1) + 6
      }
      ctx.fillStyle = '#ffffff'
      ctx.font = font(29)
      yy = wrapText(ctx, level.learned, 40, yy, w - 80, 38, Math.max(0, Math.floor((bottom - yy - 56) / 38)))
      if (this.autoNext > 0) {
        ctx.fillStyle = '#ffd23f'
        ctx.font = font(34, 'bold')
        const last = !!this.run && this.run.step >= this.run.levels.length - 1
        const msg = last ? t('Parabéns em {n} s...', { n: Math.ceil(this.autoNext) }) : t('Próxima fase em {n} s...', { n: Math.ceil(this.autoNext) })
        ctx.fillText(msg, 40, Math.min(bottom - 10, yy + 50))
      }
      return
    }
    if (group && this.groupFeedback && !this.heldInfo) {
      ctx.fillStyle = '#ff9db5'
      ctx.font = font(26, 'bold')
      ctx.fillText(this.groupFeedback, 40, bottom - 4)
      bottom -= 40
    }
    if (this.heldInfo) {
      ctx.fillStyle = '#c9c4e8'
      ctx.font = font(26, 'bold')
      ctx.fillText(t('NA SUA MÃO'), 40, y)
      ctx.fillStyle = '#ffffff'
      ctx.font = font(42, 'bold')
      ctx.fillText(this.heldInfo.name, 40, y + 50)
      ctx.font = font(29)
      ctx.fillStyle = '#d8d3f5'
      wrapText(ctx, this.heldInfo.about, 40, y + 96, w - 80, 37, Math.max(1, Math.min(3, Math.floor((bottom - y - 96) / 37))))
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
      if (level.tier === 'especialista' && level.kind !== 'selective') {
        // Docking-score style grade for experts.
        ctx.textAlign = 'right'
        ctx.fillStyle = '#ffffff'
        ctx.font = font(36, 'bold')
        ctx.fillText(t('Nota {n}/100', { n: Math.round(r.affinity * 100) }), w - 40, y + 18)
        ctx.textAlign = 'left'
      }
      ctx.fillStyle = '#c9c4e8'
      ctx.font = font(26)
      ctx.fillText(t('{mol} no {target}', { mol: mol.name, target }), 40, y + 56)
      ctx.fillStyle = '#ffffff'
      ctx.font = font(29)
      const lines = (yy: number, lh: number) => Math.max(0, Math.floor((bottom - yy) / lh))
      let yy = wrapText(ctx, r.reason, 40, y + 100, w - 80, 37, Math.min(3, lines(y + 100, 37)))
      const eff = effectText(r, this.last.enzyme)
      if (eff && yy < bottom) {
        ctx.fillStyle = r.activates ? '#ffb347' : MINT
        ctx.font = font(29, 'bold')
        yy = wrapText(ctx, eff, 40, yy + 4, w - 80, 37, Math.min(2, lines(yy + 4, 37)))
      }
      if (extra && yy < bottom) {
        ctx.fillStyle = '#ffd23f'
        ctx.font = font(28, 'bold')
        yy = wrapText(ctx, extra, 40, yy + 4, w - 80, 36, Math.min(3, lines(yy + 4, 36)))
      }
      if (hint && yy < bottom) {
        ctx.fillStyle = '#7fc8ff'
        ctx.font = font(27)
        wrapText(ctx, hint, 40, yy + 4, w - 80, 35, Math.min(2, lines(yy + 4, 35)))
      }
    } else {
      ctx.fillStyle = '#c9c4e8'
      ctx.font = font(29)
      let yy = wrapText(ctx, t('Pegue uma molécula da bandeja e leve até o bolso da proteína (os três buracos coloridos na superfície).'), 40, y + 10, w - 80, 37, Math.min(3, Math.max(0, Math.floor((bottom - y - 10) / 37))))
      if (level.kind === 'lab' && yy < bottom - 120) {
        ctx.fillStyle = '#7fc8ff'
        ctx.font = font(26, 'bold')
        ctx.fillText(t('Sabia que?'), 40, yy + 12)
        ctx.font = font(25)
        wrapText(ctx, t('Estas formas vêm de experimentos reais (banco PDB). Hoje, a inteligência artificial ajuda a planejar fármacos: o AlphaFold prevê a forma 3D das proteínas e ferramentas como o Boltz-2 estimam o quanto uma molécula se liga a elas.'), 40, yy + 48, w - 80, 33, Math.floor((bottom - yy - 48) / 33))
      } else if (yy < bottom - 80) {
        ctx.fillStyle = '#7fc8ff'
        ctx.font = font(26)
        yy += 8
        const xr = this.renderer.xr.isPresenting
        wrapText(ctx, xr
          ? t('Como pegar: aponte e aperte o gatilho, ou faça pinça com os dedos. Gire o pulso para girar a molécula.')
          : t('Como pegar: clique na molécula. Roda do mouse ou Q/E giram, botão direito ou F vira.'), 40, yy, w - 80, 34, Math.floor((bottom - yy) / 34))
      }
    }
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
        const next = this.nextStage()
        if (next) {
          try { this.startLevel(next) } catch (err) { recordError('próxima fase', err); this.showMenu() }
        }
      }
    }
  }

  update(dt: number): void {
    this.tickAutoNext(dt)
    this.safe('modo evento', () => this.tickEvent())
    this.safe('desafio em grupo', () => this.tickGroup(dt))
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
    this.groupPanel.update()
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
    const s: HudState = { holding, xr: this.renderer.xr.isPresenting, mode: this.mode, event: !!this.event, group: !!this.room }
    const key = JSON.stringify(s)
    if (key === this.hudKey) return
    this.hudKey = key
    this.onHud(s)
  }

  private interactables(): THREE.Object3D[] {
    const list: THREE.Object3D[] = []
    if (this.menuGroup.visible) for (const p of [this.menu, this.lobby, this.groupPanel]) if (p.mesh.visible) list.push(p.mesh)
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
    for (const panel of [this.menu, this.lobby, this.groupPanel, this.mission]) panel.setHover(hit?.panel === panel ? hit.button?.id ?? null : null)
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
    let r = level.turnOnly ? evaluateTurnOnly(mol.def, rec.def, perm) : evaluate(mol.def, rec.def, perm)
    perm = r.perm
    let hint = ''
    const auto = level.kind === 'selective'
    if (auto) { r = best; perm = best.perm }
    else if (rank(best.fit) > rank(r.fit) && level.tier !== 'especialista') {
      mol.fails++
      // "Ajudinha" would hand out answers in a competition, so the group challenge only gives the hint.
      if (mol.fails >= 3 && !this.room) {
        r = best
        perm = best.perm
        hint = t('Ajudinha: girei a molécula para a melhor posição.')
        mol.fails = 0
      } else hint = this.simpleLegend() || level.turnOnly
        ? t('Dica: gire a molécula até as cores combinarem!')
        : t('Dica: gire ou vire a molécula. Em outra posição ela pode encaixar melhor!')
    }
    if (level.kind === 'lab') this.notebook.set(mol.def.id, bestFit(mol.def, rec.def))
    let extra: string | undefined
    const bound = r.fit === 'strong' || r.fit === 'weak'
    if (level.kind === 'block' && !mol.def.natural) {
      if (bound && r.activates) extra = t('Encaixou, mas LIGOU o receptor. A missão é BLOQUEAR: tente outra molécula.')
      else if (r.fit === 'weak') extra = t('Ainda não: encaixe fraco, a molécula logo se solta. Tente outra.')
    } else if (level.kind === 'activate') {
      if (bound && !r.activates) extra = t('Encaixou, mas NÃO apertou o interruptor: isso só bloqueia. A missão é LIGAR o receptor.')
      else if (r.fit === 'weak') extra = t('Ainda não: encaixe fraco, a molécula logo se solta. Tente outra.')
    } else if (level.kind === 'best' && r.fit === 'strong' && !this.solves(level, r)) {
      extra = t('Encaixe forte, mas existe uma molécula com nota ainda maior. Continue procurando!')
    } else if (level.kind === 'best' && r.fit === 'weak') extra = t('Encaixe fraco: procure uma molécula que encaixe forte.')
    // Group challenge: the room server re-judges the same drop and gives the points.
    const room = this.room
    if (room?.state?.phase === 'round' && room.team >= 0 && !this.groupSolved && !mol.def.natural && level.kind !== 'lab') {
      room.attempt(room.state.round, mol.def.id, perm)
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
      const isBound = (x: FitResult) => x.fit === 'strong' || x.fit === 'weak'
      const status = results.map(x => `${x.t.def.name}: ${FIT_TITLE[x.r.fit].toLowerCase()}`).join('. ') + '.'
      const otherHit = others.some(x => isBound(x.r))
      let verdict: string
      const ok = goal.fit === 'strong' && !goal.activates && !otherHit
      if (ok) verdict = t('Perfeito: travou a {name} e deixou a outra enzima livre!', { name: TARGETS[want].name.toLowerCase() })
      else if (isBound(goal) && otherHit) verdict = t('Travou as DUAS enzimas: isso causaria efeitos indesejados!')
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
        if (!mol.disposable && !this.won && this.level && this.solves(this.level, r)) {
          // Correct answer: celebrate right away; for blockers the natural molecule then shows the block as a bonus.
          if (lk === 'block') this.natTimer = 1.0
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
    if (this.level?.kind === 'block' && !this.won && occ && !occ.disposable && occ.state === 'docked' && occ.result?.fit === 'strong' && !occ.result.activates && r.blocked >= 1) {
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
        }, 1500)
      })
    })
  }

  /** Free play: the next stage of the same difficulty, if any. */
  private nextStage(): LevelDef | null {
    const lv = this.level
    if (!lv || lv.tier === 'lab') return null
    const list = stagesOf(lv.tier)
    return list[list.indexOf(lv) + 1] ?? null
  }

  /** Does this result complete the stage? Same rule as the group-challenge judge (challenges.ts). */
  private solves(level: LevelDef, r: FitResult): boolean {
    const strong = r.fit === 'strong'
    if (level.kind === 'block') return strong && !r.activates
    if (level.kind === 'activate') return strong && r.activates
    if (level.kind === 'best') return strong && !r.activates && r.affinity >= bestAffinity(level) - 1e-9
    return false
  }

  private win(): void {
    if (this.won || !this.level) return
    this.won = true
    if (this.run) {
      this.run.times[this.run.step] = performance.now() - this.run.phaseStart
      this.autoNext = CONFIG.play.autoNextSeconds
    } else if (!this.room && this.nextStage()) this.autoNext = CONFIG.play.autoNextSeconds
    if (!this.room) {
      this.done.add(this.level.id)
      try { localStorage.setItem(SAVE_KEY, JSON.stringify([...this.done])) } catch { /* ignore */ }
    }
    track('level_complete', { level: this.level.id, tier: this.level.tier, event_mode: !!this.run, group: !!this.room, xr: this.renderer.xr.isPresenting })
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
