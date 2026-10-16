import * as THREE from 'three'

type Particle = { sprite: THREE.Sprite; vel: THREE.Vector3; life: number; max: number; size: number; gravity: number }

function dotTexture(): THREE.Texture {
  const c = document.createElement('canvas')
  c.width = c.height = 64
  const ctx = c.getContext('2d')!
  const grad = ctx.createRadialGradient(32, 32, 0, 32, 32, 32)
  grad.addColorStop(0, 'rgba(255,255,255,1)')
  grad.addColorStop(0.35, 'rgba(255,255,255,0.8)')
  grad.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = grad
  ctx.fillRect(0, 0, 64, 64)
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

/** Pooled additive sprites for bursts, sparks and signal pulses. */
export class Fx {
  readonly group = new THREE.Group()
  private pool: Particle[] = []
  private live: Particle[] = []
  private tex = dotTexture()

  burst(at: THREE.Vector3, color: number, count = 16, speed = 0.35, size = 0.02, gravity = 0): void {
    for (let i = 0; i < count; i++) {
      const dir = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize()
      this.spawn(at, dir.multiplyScalar(speed * (0.4 + Math.random() * 0.6)), color, 0.5 + Math.random() * 0.4, size, gravity)
    }
  }

  spawn(at: THREE.Vector3, vel: THREE.Vector3, color: number, life: number, size: number, gravity = 0): void {
    let p = this.pool.pop()
    if (!p) {
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.tex, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }))
      p = { sprite, vel: new THREE.Vector3(), life: 0, max: 1, size, gravity }
    }
    p.sprite.position.copy(at)
    p.vel.copy(vel)
    p.life = p.max = life
    p.size = size
    p.gravity = gravity
    ;(p.sprite.material as THREE.SpriteMaterial).color.setHex(color)
    this.group.add(p.sprite)
    this.live.push(p)
  }

  update(dt: number): void {
    for (let i = this.live.length - 1; i >= 0; i--) {
      const p = this.live[i]
      p.life -= dt
      if (p.life <= 0) {
        this.group.remove(p.sprite)
        this.live.splice(i, 1)
        this.pool.push(p)
        continue
      }
      p.vel.y -= p.gravity * dt
      p.sprite.position.addScaledVector(p.vel, dt)
      const k = p.life / p.max
      p.sprite.scale.setScalar(p.size * (0.4 + k * 0.6))
      ;(p.sprite.material as THREE.SpriteMaterial).opacity = Math.min(1, k * 1.5)
    }
  }
}
