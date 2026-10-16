import { CONFIG, DEFAULT_CONFIG } from './config'

type Control = { id: string; type: 'number'; category: string; label: string; description: string; unit: string
  default: number; min: number; max: number; step: number; applyMode: 'LIVE'; integrity: 'COSMETIC' | 'GAMEPLAY' }
type Binding = { control: Control; read(): number; write(value: number): void }
const bindings: Binding[] = []

function number(key: keyof typeof CONFIG.play, label: string, description: string, min: number, max: number, step: number, unit: string): void {
  bindings.push({
    control: Object.freeze({ id: `play.${key}`, type: 'number', category: 'Jogo', label, description, unit,
      default: DEFAULT_CONFIG.play[key], min, max, step, applyMode: 'LIVE', integrity: 'GAMEPLAY' }),
    read: () => CONFIG.play[key],
    write: value => { CONFIG.play[key] = value },
  })
}

number('snapDistance', 'Distância de encaixe', 'Quão perto do bolso a molécula precisa ser solta.', 0.08, 0.35, 0.01, 'm')
number('weakHoldSeconds', 'Tempo do encaixe fraco', 'Quanto tempo um encaixe fraco fica antes de soltar.', 0.8, 6, 0.2, 's')
number('naturalInterval', 'Intervalo das moléculas naturais', 'Tempo entre chegadas da molécula natural.', 2, 10, 0.5, 's')
number('animSpeed', 'Velocidade das animações', 'Multiplica a velocidade dos movimentos.', 0.5, 2.5, 0.1, '×')

const byId = new Map(bindings.map(b => [b.control.id, b]))
let requested = Object.fromEntries(bindings.map(({ control }) => [control.id, control.default]))

export const tuning = {
  controls: Object.freeze(bindings.map(b => b.control)),
  read() {
    return { requested: { ...requested }, active: Object.fromEntries(bindings.map(b => [b.control.id, b.read()])) }
  },
  apply(patch: unknown): void {
    if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new Error('Invalid patch')
    const entries = Object.entries(patch)
    for (const [id, value] of entries) {
      const control = byId.get(id)?.control
      if (!control || typeof value !== 'number' || !Number.isFinite(value) || value < control.min || value > control.max) throw new Error('Invalid value')
    }
    requested = { ...requested, ...(patch as Record<string, number>) }
    for (const [id, value] of entries) byId.get(id)!.write(value as number)
  },
}
