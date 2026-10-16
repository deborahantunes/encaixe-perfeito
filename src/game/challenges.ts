/**
 * "Desafio em grupo": the rounds every team plays at the same time, and the pure judge shared by the game
 * (instant local feedback) and the room server (authoritative scoring). No DOM / three.js here.
 */
import { MOLECULES, TARGETS, type LevelDef, type MoleculeId } from './data'
import { PERMS, bestFit, evaluate, type FitClass, type Perm } from './rules'

export type ChallengeKind = 'block' | 'activate' | 'selective'
export type ChallengeDef = LevelDef & { cid: string; kind: ChallengeKind; seconds: number }

export const CHALLENGES: ChallengeDef[] = [
  {
    id: 101, cid: 'trave-tripsina', kind: 'block', seconds: 90,
    title: 'Desafio 1 · Trave a tripsina',
    intro: 'A tripsina corta proteínas. Encontre a molécula que entra no bolso e trava a enzima.',
    goal: 'Encaixe FORTE no bolso da tripsina.',
    targets: ['tripsina'], tray: ['gota', 'faisca', 'cometa', 'pluma', 'gigante'],
    learned: 'A Cometa tem ponta positiva para a âncora negativa, parte oleosa grande e uma pontinha que gosta de água.',
  },
  {
    id: 102, cid: 'bloqueie-beta2', kind: 'block', seconds: 90,
    title: 'Desafio 2 · Bloqueie o receptor',
    intro: 'O receptor β2 manda recados para dentro da célula quando o interruptor é apertado.',
    goal: 'Ocupe o receptor β2 SEM apertar o interruptor.',
    targets: ['beta2'], tray: ['raio', 'gota', 'escudo', 'cometa', 'pluma'],
    learned: 'A Escudo encaixa mas não alcança o interruptor: é um antagonista (bloqueador).',
  },
  {
    id: 103, cid: 'ligue-beta2', kind: 'activate', seconds: 90,
    title: 'Desafio 3 · Ligue o receptor',
    intro: 'Agora é o contrário: queremos que o receptor β2 mande o recado.',
    goal: 'Encaixe FORTE e aperte o interruptor do receptor β2.',
    targets: ['beta2'], tray: ['escudo', 'pluma', 'raio', 'faisca', 'gota'],
    learned: 'A Raio encaixa e aperta o interruptor: é um agonista, faz o mesmo que o mensageiro natural.',
  },
  {
    id: 104, cid: 'trave-trombina', kind: 'block', seconds: 90,
    title: 'Desafio 4 · Trave a trombina',
    intro: 'A trombina ajuda o sangue a coagular. O bolso dela tem DOIS buracos oleosos.',
    goal: 'Encaixe FORTE no bolso da trombina.',
    targets: ['trombina'], tray: ['cometa', 'gota', 'trevo', 'faisca', 'pluma'],
    learned: 'A Trevo tem duas partes oleosas, uma grande e uma média: combina com os dois buracos oleosos.',
  },
  {
    id: 105, cid: 'seletiva', kind: 'selective', seconds: 100,
    title: 'Desafio 5 · A molécula que escolhe',
    intro: 'O remédio chega às duas enzimas pelo sangue. Só uma delas deve ser travada.',
    goal: 'Trave a TROMBINA e deixe a TRIPSINA livre.',
    targets: ['tripsina', 'trombina'], tray: ['faisca', 'cometa', 'gigante', 'trevo'], blockTarget: 'trombina',
    learned: 'Moléculas seletivas encaixam só no alvo certo: menos efeitos indesejados.',
  },
]

export const CHALLENGE_BY_ID = new Map(CHALLENGES.map(c => [c.cid, c]))

export type Judgement = { ok: boolean; fit: FitClass; activates: boolean }

export function validPerm(p: unknown): p is Perm {
  return Array.isArray(p) && p.length === 3 && PERMS.some(q => q[0] === p[0] && q[1] === p[1] && q[2] === p[2])
}

/** Is this molecule, dropped with this orientation, the solution of the challenge? */
export function judge(ch: ChallengeDef, molId: MoleculeId, perm: Perm): Judgement {
  const mol = MOLECULES[molId]
  if (ch.kind === 'selective') {
    const want = ch.blockTarget!
    const goal = bestFit(mol, TARGETS[want])
    const otherHit = ch.targets.filter(t => t !== want).some(t => {
      const f = bestFit(mol, TARGETS[t]).fit
      return f === 'strong' || f === 'weak'
    })
    return { ok: goal.fit === 'strong' && !goal.activates && !otherHit, fit: goal.fit, activates: goal.activates }
  }
  const r = evaluate(mol, TARGETS[ch.targets[0]], perm)
  const strong = r.fit === 'strong'
  return { ok: strong && (ch.kind === 'activate' ? r.activates : !r.activates), fit: r.fit, activates: r.activates }
}

/** Points for a solved round: base + speed + first-try bonus - wrong tries (never below 50). */
export function roundPoints(elapsedMs: number, seconds: number, wrong: number): number {
  const left = Math.max(0, 1 - elapsedMs / (seconds * 1000))
  const pts = 100 + Math.round(100 * left) + (wrong === 0 ? 50 : 0) - Math.min(60, wrong * 15)
  return Math.max(50, pts)
}

export const TEAM_COLORS = ['#3b82ff', '#ff4a4a', '#2fd49a', '#ffd23f'] as const
export const TEAM_NAMES = ['Time Azul', 'Time Vermelho', 'Time Verde', 'Time Amarelo'] as const
