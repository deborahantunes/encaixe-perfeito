/**
 * Shared, DOM-free judging of a stage: used by the game (instant local feedback) and by the "Desafio em grupo"
 * room server (authoritative scoring; bundled to server/shared/challenges.mjs by scripts/build-shared.mjs).
 */
import { LEVELS, MOLECULES, TARGETS, TIERS, stagesOf, type LevelDef, type MoleculeId, type Tier } from './data'
import { PERMS, bestFit, evaluate, evaluateTurnOnly, type FitClass, type FitResult, type Perm } from './rules'

export { LEVELS, TIERS }
export type { Tier }

export type Judgement = { ok: boolean; fit: FitClass; activates: boolean; affinity: number }

export function validPerm(p: unknown): p is Perm {
  return Array.isArray(p) && p.length === 3 && PERMS.some(q => q[0] === p[0] && q[1] === p[1] && q[2] === p[2])
}

/** The fit the game shows for a molecule dropped with this orientation (turn-only stages forgive the face). */
export function dropFit(level: LevelDef, molId: MoleculeId, perm: Perm, targetIndex = 0): FitResult {
  const mol = MOLECULES[molId]
  const target = TARGETS[level.targets[targetIndex]]
  if (level.kind === 'selective') return bestFit(mol, target)
  return level.turnOnly ? evaluateTurnOnly(mol, target, perm) : evaluate(mol, target, perm)
}

/** Highest affinity a non-activating strong binder of the tray reaches on the stage's target ('best' stages). */
export function bestAffinity(level: LevelDef): number {
  const target = TARGETS[level.targets[0]]
  let best = 0
  for (const id of level.tray) {
    const r = bestFit(MOLECULES[id], target)
    if (r.fit === 'strong' && !r.activates) best = Math.max(best, r.affinity)
  }
  return best
}

/** Is this molecule, dropped with this orientation, the solution of the stage? */
export function judge(level: LevelDef, molId: MoleculeId, perm: Perm): Judgement {
  const mol = MOLECULES[molId]
  if (level.kind === 'selective') {
    const want = level.blockTarget!
    const goal = bestFit(mol, TARGETS[want])
    const otherHit = level.targets.filter(t => t !== want).some(t => {
      const f = bestFit(mol, TARGETS[t]).fit
      return f === 'strong' || f === 'weak'
    })
    return { ok: goal.fit === 'strong' && !goal.activates && !otherHit, fit: goal.fit, activates: goal.activates, affinity: goal.affinity }
  }
  const r = dropFit(level, molId, perm)
  const strong = r.fit === 'strong'
  let ok: boolean
  if (level.kind === 'activate') ok = strong && r.activates
  else if (level.kind === 'best') ok = strong && !r.activates && r.affinity >= bestAffinity(level) - 1e-9
  else if (level.kind === 'block') ok = strong && !r.activates
  else ok = false
  return { ok, fit: r.fit, activates: r.activates, affinity: r.affinity }
}

/** Stages played in a group challenge of this difficulty (the first `count`). */
export function challengeList(tier: Tier, count: number): LevelDef[] {
  const all = stagesOf(tier)
  return all.slice(0, Math.max(1, Math.min(all.length, Math.floor(count) || all.length)))
}

/** Points for a solved round: base + speed + first-try bonus - wrong tries (never below 50). */
export function roundPoints(elapsedMs: number, seconds: number, wrong: number): number {
  const left = Math.max(0, 1 - elapsedMs / (seconds * 1000))
  const pts = 100 + Math.round(100 * left) + (wrong === 0 ? 50 : 0) - Math.min(60, wrong * 15)
  return Math.max(50, pts)
}

export const TEAM_COLORS = ['#3b82ff', '#ff4a4a', '#2fd49a', '#ffd23f'] as const
export const TEAM_NAMES = ['Time Azul', 'Time Vermelho', 'Time Verde', 'Time Amarelo'] as const
