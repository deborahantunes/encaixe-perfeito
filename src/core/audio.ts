/** Tiny synthesized sound effects (no audio files). Call unlock() from a user gesture. */
export type Sfx = 'grab' | 'drop' | 'strong' | 'weak' | 'clash' | 'repel' | 'slip' | 'activate' | 'block' | 'win' | 'click' | 'sneeze'

export class Audio {
  private ctx: AudioContext | null = null
  private out: GainNode | null = null
  muted = false

  unlock(): void {
    if (!this.ctx) {
      const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
      if (!Ctx) return
      this.ctx = new Ctx()
      this.out = this.ctx.createGain()
      this.out.gain.value = 0.7
      this.out.connect(this.ctx.destination)
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume()
  }

  play(name: Sfx): void {
    try { this.playUnsafe(name) } catch (err) { console.warn('som falhou', err) }
  }

  private playUnsafe(name: Sfx): void {
    const ctx = this.ctx
    if (!ctx || !this.out || this.muted || ctx.state !== 'running') return
    const t = ctx.currentTime
    const out = this.out
    const tone = (f0: number, f1: number, dur: number, type: OscillatorType, vol: number, delay = 0) => {
      const o = ctx.createOscillator()
      const gain = ctx.createGain()
      o.type = type
      o.frequency.setValueAtTime(f0, t + delay)
      o.frequency.exponentialRampToValueAtTime(Math.max(f1, 20), t + delay + dur)
      gain.gain.setValueAtTime(0.0001, t + delay)
      gain.gain.exponentialRampToValueAtTime(vol, t + delay + 0.015)
      gain.gain.exponentialRampToValueAtTime(0.0001, t + delay + dur)
      o.connect(gain).connect(out)
      o.start(t + delay)
      o.stop(t + delay + dur + 0.05)
    }
    const noise = (dur: number, vol: number, freq: number, delay = 0) => {
      const len = Math.floor(ctx.sampleRate * dur)
      const buf = ctx.createBuffer(1, len, ctx.sampleRate)
      const data = buf.getChannelData(0)
      for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len)
      const src = ctx.createBufferSource()
      src.buffer = buf
      const filter = ctx.createBiquadFilter()
      filter.type = 'bandpass'
      filter.frequency.value = freq
      const gain = ctx.createGain()
      gain.gain.value = vol
      src.connect(filter).connect(gain).connect(out)
      src.start(t + delay)
    }
    switch (name) {
      case 'click': tone(700, 760, 0.06, 'triangle', 0.2); break
      case 'grab': tone(420, 640, 0.09, 'sine', 0.25); break
      case 'drop': tone(500, 300, 0.12, 'sine', 0.18); break
      case 'strong': [523, 784, 1047].forEach((f, i) => tone(f, f, 0.22, 'triangle', 0.25, i * 0.07)); tone(130, 90, 0.2, 'sine', 0.4); break
      case 'weak': tone(440, 520, 0.12, 'triangle', 0.2); tone(520, 400, 0.25, 'triangle', 0.15, 0.12); break
      case 'clash': tone(160, 60, 0.22, 'square', 0.18); noise(0.12, 0.3, 400); break
      case 'repel': tone(900, 200, 0.28, 'sawtooth', 0.12); noise(0.2, 0.15, 2500); break
      case 'slip': tone(600, 250, 0.35, 'sine', 0.18); break
      case 'activate': [660, 880, 990, 1320].forEach((f, i) => tone(f, f * 1.02, 0.14, 'sine', 0.14, i * 0.05)); break
      case 'block': tone(220, 200, 0.1, 'square', 0.15); tone(330, 300, 0.12, 'square', 0.12, 0.08); break
      case 'sneeze': noise(0.08, 0.2, 1200); noise(0.35, 0.45, 3000, 0.12); break
      case 'win': [523, 659, 784, 1047, 1319].forEach((f, i) => tone(f, f, 0.35, 'triangle', 0.22, i * 0.1)); break
    }
  }
}
