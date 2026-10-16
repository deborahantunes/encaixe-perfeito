import * as THREE from 'three'

export const FONT = 'ManusCC0'
export const INK = '#f4f1ff'
export const MINT = '#3ee6b0'

export type Button = {
  id: string
  x: number; y: number; w: number; h: number
  label: string
  color?: string
  /** Label size in canvas px (default: up to 44). */
  fontPx?: number
  visible?: boolean
  onClick: () => void
}

/**
 * A flat 3D panel rendered from a 2D canvas. Works for VR rays, hand pokes and the mouse:
 * the raycast UV is mapped to canvas pixels to find the button under the pointer.
 */
export class Panel {
  readonly mesh: THREE.Mesh
  readonly canvas: HTMLCanvasElement
  readonly ctx: CanvasRenderingContext2D
  readonly texture: THREE.CanvasTexture
  buttons: Button[] = []
  hovered: string | null = null
  private drawFn: (ctx: CanvasRenderingContext2D, w: number, h: number) => void = () => {}
  private dirty = true

  constructor(readonly widthM: number, readonly heightM: number, readonly pxPerM = 1400, opts: { background?: string; radius?: number } = {}) {
    this.canvas = document.createElement('canvas')
    this.canvas.width = Math.round(widthM * pxPerM)
    this.canvas.height = Math.round(heightM * pxPerM)
    this.ctx = this.canvas.getContext('2d')!
    this.texture = new THREE.CanvasTexture(this.canvas)
    this.texture.colorSpace = THREE.SRGBColorSpace
    this.texture.anisotropy = 4
    const mat = new THREE.MeshBasicMaterial({ map: this.texture, transparent: true, depthWrite: true, side: THREE.DoubleSide, toneMapped: false })
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(widthM, heightM), mat)
    this.mesh.userData.panel = this
    this.background = opts.background ?? 'rgba(16, 14, 44, 0.9)'
    this.radius = opts.radius ?? 36
  }
  background: string
  radius: number

  setDraw(fn: (ctx: CanvasRenderingContext2D, w: number, h: number) => void): void {
    this.drawFn = fn
    this.dirty = true
  }

  invalidate(): void {
    this.dirty = true
  }

  /** Redraw if needed; call once per frame. */
  update(): void {
    if (!this.dirty) return
    this.dirty = false
    const { ctx } = this
    const w = this.canvas.width
    const h = this.canvas.height
    ctx.clearRect(0, 0, w, h)
    if (this.background !== 'transparent') {
      roundRect(ctx, 4, 4, w - 8, h - 8, this.radius)
      ctx.fillStyle = this.background
      ctx.fill()
      ctx.lineWidth = 4
      ctx.strokeStyle = 'rgba(62, 230, 176, 0.55)'
      ctx.stroke()
    }
    this.drawFn(ctx, w, h)
    for (const b of this.buttons) if (b.visible !== false) this.drawButton(b)
    this.texture.needsUpdate = true
  }

  private drawButton(b: Button): void {
    const { ctx } = this
    const hover = this.hovered === b.id
    roundRect(ctx, b.x, b.y, b.w, b.h, Math.min(28, b.h / 2))
    ctx.fillStyle = hover ? '#ffffff' : b.color ?? MINT
    ctx.fill()
    ctx.lineWidth = hover ? 8 : 0
    if (hover) { ctx.strokeStyle = b.color ?? MINT; ctx.stroke() }
    ctx.fillStyle = '#14112e'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    fitFont(ctx, b.label, b.w - 30, b.fontPx ?? Math.min(44, b.h * 0.48), 'bold')
    ctx.fillText(b.label, b.x + b.w / 2, b.y + b.h / 2 + 2)
  }

  buttonAt(uv: THREE.Vector2): Button | null {
    const x = uv.x * this.canvas.width
    const y = (1 - uv.y) * this.canvas.height
    for (const b of this.buttons) {
      if (b.visible === false) continue
      if (x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) return b
    }
    return null
  }

  setHover(id: string | null): void {
    if (id === this.hovered) return
    this.hovered = id
    this.dirty = true
  }
}

export function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}

export function font(px: number, weight: 'bold' | 'normal' = 'normal'): string {
  return `${weight === 'bold' ? 700 : 400} ${Math.round(px)}px ${FONT}, sans-serif`
}

export function fitFont(ctx: CanvasRenderingContext2D, text: string, maxW: number, px: number, weight: 'bold' | 'normal' = 'normal'): void {
  let size = px
  ctx.font = font(size, weight)
  while (size > 12 && ctx.measureText(text).width > maxW) {
    size -= 2
    ctx.font = font(size, weight)
  }
}

/** Draws wrapped text and returns the y after the last line. */
export function wrapText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, maxW: number, lineH: number, maxLines = 99): number {
  const paragraphs = text.split('\n')
  let lines = 0
  for (const para of paragraphs) {
    const words = para.split(' ')
    let line = ''
    for (const word of words) {
      const test = line ? `${line} ${word}` : word
      if (ctx.measureText(test).width > maxW && line) {
        if (lines < maxLines) ctx.fillText(line, x, y)
        lines++
        y += lineH
        line = word
      } else line = test
    }
    if (lines < maxLines) ctx.fillText(line, x, y)
    lines++
    y += lineH
  }
  return y
}
