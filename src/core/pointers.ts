import * as THREE from 'three'
import { XRControllerModelFactory } from 'three/examples/jsm/webxr/XRControllerModelFactory.js'
import { XRHandModelFactory } from 'three/examples/jsm/webxr/XRHandModelFactory.js'

export type PointerKind = 'mouse' | 'controller' | 'hand'

/** One thing that can point, press and hold: a VR controller, a tracked hand or the mouse/touch. */
export class Pointer {
  active = false
  kind: PointerKind = 'controller'
  readonly ray = new THREE.Ray()
  /** World-space pose where held objects attach. */
  readonly holdPos = new THREE.Vector3()
  readonly holdQuat = new THREE.Quaternion()
  pressed = false
  down = false
  up = false
  /** Screen pixels moved since the press (mouse only). */
  drag = 0
  /** Accumulated wheel / key rotation steps (mouse only). */
  rotateSteps = 0
  flip = false
  held: unknown = null
  hover: unknown = null
  hoverDist = 0
  line: THREE.Line | null = null
  cursor: THREE.Mesh | null = null
  source: XRInputSource | null = null
  private wasPressed = false
  /** A press that may have started and ended between two frames. */
  queuedDown = false

  constructor(readonly id: string) {}

  /** Latch edges once per frame. */
  latch(): void {
    if (this.queuedDown) {
      this.queuedDown = false
      this.down = true
      this.up = false
      this.wasPressed = true
      return
    }
    this.down = false
    this.up = this.wasPressed && !this.pressed
    this.wasPressed = this.pressed
  }

  haptic(intensity = 0.4, ms = 40): void {
    const act = this.source?.gamepad?.hapticActuators?.[0] as unknown as { pulse?: (i: number, d: number) => void } | undefined
    try { act?.pulse?.(intensity, ms) } catch { /* not supported */ }
  }
}

export class Pointers {
  readonly mouse = new Pointer('mouse')
  readonly xr: Pointer[] = []
  private controllers: THREE.Group[] = []
  private grips: THREE.Group[] = []
  private hands: THREE.XRHandSpace[] = []
  private ndc = new THREE.Vector2(9, 9)
  private downAt = new THREE.Vector2()
  private tmp = new THREE.Vector3()
  private tmp2 = new THREE.Vector3()

  constructor(private renderer: THREE.WebGLRenderer, scene: THREE.Scene, private camera: THREE.PerspectiveCamera, canvas: HTMLCanvasElement) {
    this.mouse.kind = 'mouse'
    const controllerModels = new XRControllerModelFactory()
    const handModels = new XRHandModelFactory()
    for (let i = 0; i < 2; i++) {
      const p = new Pointer(`xr${i}`)
      const controller = renderer.xr.getController(i)
      const grip = renderer.xr.getControllerGrip(i)
      const hand = renderer.xr.getHand(i)
      grip.add(controllerModels.createControllerModel(grip))
      hand.add(handModels.createHandModel(hand, 'spheres'))
      scene.add(controller, grip, hand)
      let selecting = false
      let squeezing = false
      const sync = () => { p.pressed = selecting || squeezing }
      controller.addEventListener('connected', (e: { data?: XRInputSource }) => {
        p.source = e.data ?? null
        p.kind = e.data?.hand ? 'hand' : 'controller'
        p.active = true
        if (p.line) p.line.visible = true
      })
      controller.addEventListener('disconnected', () => {
        p.active = false
        p.source = null
        selecting = squeezing = false
        sync()
        if (p.line) p.line.visible = false
        if (p.cursor) p.cursor.visible = false
      })
      controller.addEventListener('selectstart', () => { if (!p.pressed) p.queuedDown = true; selecting = true; sync() })
      controller.addEventListener('selectend', () => { selecting = false; sync() })
      controller.addEventListener('squeezestart', () => { if (!p.pressed) p.queuedDown = true; squeezing = true; sync() })
      controller.addEventListener('squeezeend', () => { squeezing = false; sync() })
      // Laser pointer + cursor dot.
      const geo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, -1)])
      const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0x3ee6b0, transparent: true, opacity: 0.7 }))
      line.visible = false
      controller.add(line)
      p.line = line
      const cursor = new THREE.Mesh(new THREE.SphereGeometry(0.006, 12, 8), new THREE.MeshBasicMaterial({ color: 0xffffff }))
      cursor.visible = false
      scene.add(cursor)
      p.cursor = cursor
      this.xr.push(p)
      this.controllers.push(controller)
      this.grips.push(grip)
      this.hands.push(hand)
    }

    const toNdc = (e: PointerEvent) => {
      const r = canvas.getBoundingClientRect()
      this.ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1)
    }
    canvas.addEventListener('pointermove', e => {
      toNdc(e)
      this.mouse.active = true
      if (this.mouse.pressed) this.mouse.drag = Math.max(this.mouse.drag, this.downAt.distanceTo(new THREE.Vector2(e.clientX, e.clientY)))
    })
    canvas.addEventListener('pointerdown', e => {
      if (e.button !== 0) return
      toNdc(e)
      this.mouse.active = true
      this.mouse.pressed = true
      this.mouse.queuedDown = true
      this.mouse.drag = 0
      this.downAt.set(e.clientX, e.clientY)
      canvas.setPointerCapture(e.pointerId)
    })
    const release = (e: PointerEvent) => {
      if (e.button !== 0 && e.type === 'pointerup') return
      this.mouse.pressed = false
    }
    canvas.addEventListener('pointerup', release)
    canvas.addEventListener('pointercancel', release)
    canvas.addEventListener('pointerleave', e => { if (e.pointerType === 'mouse' && !this.mouse.pressed) this.ndc.set(9, 9) })
    canvas.addEventListener('wheel', e => {
      e.preventDefault()
      this.mouse.rotateSteps += e.deltaY > 0 ? 1 : -1
    }, { passive: false })
    canvas.addEventListener('contextmenu', e => { e.preventDefault(); this.mouse.flip = true })
    window.addEventListener('keydown', e => {
      if (e.key === 'q' || e.key === 'Q' || e.key === 'ArrowLeft') this.mouse.rotateSteps -= 1
      if (e.key === 'e' || e.key === 'E' || e.key === 'ArrowRight') this.mouse.rotateSteps += 1
      if (e.key === 'f' || e.key === 'F' || e.key === 'ArrowUp' || e.key === 'ArrowDown') this.mouse.flip = true
    })
  }

  get inXR(): boolean {
    return this.renderer.xr.isPresenting
  }

  /** Pointers that should be processed this frame. */
  list(): Pointer[] {
    return this.inXR ? this.xr.filter(p => p.active) : [this.mouse]
  }

  update(): void {
    if (this.inXR) {
      this.xr.forEach((p, i) => {
        if (!p.active) return
        const c = this.controllers[i]
        c.updateMatrixWorld()
        p.ray.origin.setFromMatrixPosition(c.matrixWorld)
        p.ray.direction.set(0, 0, -1).transformDirection(c.matrixWorld)
        const hand = this.hands[i]
        const tip = hand.joints['index-finger-tip']
        const thumb = hand.joints['thumb-tip']
        const wrist = hand.joints['wrist']
        if (p.kind === 'hand' && tip && thumb && wrist && tip.visible) {
          p.holdPos.copy(tip.getWorldPosition(this.tmp)).add(thumb.getWorldPosition(this.tmp2)).multiplyScalar(0.5)
          wrist.getWorldQuaternion(p.holdQuat)
        } else {
          const g = this.grips[i]
          g.updateMatrixWorld()
          g.getWorldPosition(p.holdPos)
          g.getWorldQuaternion(p.holdQuat)
          // Hold slightly in front of the controller.
          p.holdPos.add(this.tmp.set(0, -0.01, -0.07).applyQuaternion(p.holdQuat))
        }
        p.latch()
      })
    } else {
      const m = this.mouse
      if (this.ndc.x < 5) {
        m.ray.origin.setFromMatrixPosition(this.camera.matrixWorld)
        m.ray.direction.set(this.ndc.x, this.ndc.y, 0.5).unproject(this.camera).sub(m.ray.origin).normalize()
      } else {
        m.ray.direction.set(0, 1, 0)
        m.ray.origin.set(0, 100, 0)
      }
      m.latch()
    }
  }
}
