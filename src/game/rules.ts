import { t } from '../i18n'
import { CHEM_LABEL, SIZE_LABEL, type Cavity, type Group, type MoleculeDef, type TargetDef } from './data'

export type FitClass = 'clash' | 'repel' | 'slip' | 'weak' | 'strong'
/** perm[cavityIndex] = arm index of the molecule placed in that cavity. */
export type Perm = [number, number, number]

export const PERMS: Perm[] = [
  [0, 1, 2], [1, 2, 0], [2, 0, 1], // rotations
  [0, 2, 1], [2, 1, 0], [1, 0, 2], // flipped
]

export const THRESHOLDS = { strong: 0.78, weak: 0.45 }

export type SlotResult = {
  cavity: Cavity
  group: Group
  size: 'perfect' | 'loose' | 'veryLoose' | 'empty' | 'tooBig'
  chem: 'attract' | 'repel' | 'match' | 'hbond' | 'mismatch' | 'neutral'
  score: number
}

export type FitResult = {
  fit: FitClass
  affinity: number
  activates: boolean
  slots: SlotResult[]
  perm: Perm
  /** Main reason in plain Portuguese. */
  reason: string
}

const isCharge = (c: string) => c === 'pos' || c === 'neg'

export function scoreSlot(cavity: Cavity, group: Group): SlotResult {
  let size: SlotResult['size']
  let sizeScore: number
  if (group.size === 0) { size = 'empty'; sizeScore = 0 }
  else if (group.size > cavity.size) { size = 'tooBig'; sizeScore = 0 }
  else if (group.size === cavity.size) { size = 'perfect'; sizeScore = 1 }
  else if (cavity.size - group.size === 1) { size = 'loose'; sizeScore = 0.6 }
  else { size = 'veryLoose'; sizeScore = 0.25 }

  let chem: SlotResult['chem']
  let chemScore: number
  const gc = group.chem
  const cc = cavity.chem
  if (gc === 'none') { chem = 'neutral'; chemScore = 0 }
  else if (isCharge(gc) && isCharge(cc)) {
    if (gc !== cc) { chem = 'attract'; chemScore = 1.5 } else { chem = 'repel'; chemScore = -2 }
  } else if (gc === 'oil' && cc === 'oil') { chem = 'match'; chemScore = 1 }
  else if (gc === 'polar' && cc === 'polar') { chem = 'match'; chemScore = 0.8 }
  else if ((gc === 'polar' && isCharge(cc)) || (isCharge(gc) && cc === 'polar')) { chem = 'hbond'; chemScore = 0.5 }
  else { chem = 'mismatch'; chemScore = -0.4 }
  return { cavity, group, size, chem, score: sizeScore + chemScore }
}

export function perfectScore(target: TargetDef): number {
  return target.cavities.reduce((sum, c) => sum + 1 + (isCharge(c.chem) ? 1.5 : c.chem === 'oil' ? 1 : 0.8), 0)
}

export function evaluate(mol: MoleculeDef, target: TargetDef, perm: Perm): FitResult {
  const slots = target.cavities.map((c, i) => scoreSlot(c, mol.groups[perm[i]]))
  const total = slots.reduce((s, r) => s + r.score, 0)
  const affinity = Math.max(0, Math.min(1, total / perfectScore(target)))
  const base = { slots, perm, affinity }
  const big = slots.findIndex(s => s.size === 'tooBig')
  if (big >= 0) {
    return { ...base, affinity: 0, fit: 'clash', activates: false,
      reason: t('Não coube! A parte {part} é grande demais para um buraco {hole}.', { part: t(SIZE_LABEL[slots[big].group.size]), hole: cavityAdj(slots[big].cavity.size) }) }
  }
  const rep = slots.findIndex(s => s.chem === 'repel')
  if (rep >= 0) {
    const sign = slots[rep].group.chem === 'pos' ? t('+ com +') : t('− com −')
    return { ...base, affinity: 0, fit: 'repel', activates: false,
      reason: t('Opa! Cargas iguais se empurram ({sign}). A molécula foi repelida.', { sign }) }
  }
  const anchor = target.anchor >= 0 ? slots[target.anchor] : null
  if (anchor && anchor.chem !== 'attract') {
    const want = target.cavities[target.anchor].chem === 'pos' ? t('negativa (−)') : t('positiva (+)')
    return { ...base, fit: 'slip', activates: false,
      reason: t('Não grudou. A âncora do bolso precisa de uma carga {want} e não encontrou.', { want }) }
  }
  if (affinity < THRESHOLDS.weak) {
    return { ...base, fit: 'slip', activates: false, reason: t('Não grudou: o formato e a química quase não combinam.') }
  }
  // Enzymes "work" only on their natural substrate; receptors are switched on by an exact fit in the switch cavity.
  const sw = target.switchCavity >= 0 ? slots[target.switchCavity] : null
  const activates = mol.substrate ? true : !!sw && sw.size === 'perfect' && sw.chem === 'match'
  if (affinity < THRESHOLDS.strong) {
    const loose = slots.find(s => s.size !== 'perfect')
    const bad = slots.find(s => s.chem === 'mismatch')
    const why = bad ? t('uma parte {part} caiu num buraco {hole}', { part: CHEM_LABEL[bad.group.chem as keyof typeof CHEM_LABEL], hole: CHEM_LABEL[bad.cavity.chem] })
      : loose ? t('sobrou espaço em um buraco') : t('a química não combina muito bem')
    return { ...base, fit: 'weak', activates, reason: t('Encaixe fraco: {why}. Entra, mas logo se solta.', { why }) }
  }
  return { ...base, fit: 'strong', activates, reason: t('Encaixe forte! Formato e química combinam muito bem.') }
}

function cavityAdj(size: number): string {
  return size === 1 ? t('pequeno') : size === 2 ? t('médio') : t('grande')
}

const RANK: Record<FitClass, number> = { clash: 0, repel: 0, slip: 1, weak: 2, strong: 3 }

export function rank(fit: FitClass): number {
  return RANK[fit]
}

/** Best result over all orientations (used for hints and the lab notebook). */
export function bestFit(mol: MoleculeDef, target: TargetDef): FitResult {
  let best = evaluate(mol, target, PERMS[0])
  for (const p of PERMS.slice(1)) {
    const r = evaluate(mol, target, p)
    if (rank(r.fit) > rank(best.fit) || (rank(r.fit) === rank(best.fit) && r.affinity > best.affinity)) best = r
  }
  return best
}

export function effectText(r: FitResult, enzyme = false): string {
  if (r.fit === 'weak' || r.fit === 'strong') {
    if (enzyme) return r.activates ? t('A enzima trabalhou: cortou a molécula!') : t('Ocupou o bolso: a enzima ficou TRAVADA.')
    return r.activates ? t('Apertou o interruptor: a proteína ATIVOU!') : t('Ocupou o lugar sem apertar o interruptor: proteína BLOQUEADA.')
  }
  return ''
}

export const FIT_TITLE: Record<FitClass, string> = {
  clash: 'Não cabe', repel: 'Repelida', slip: 'Não gruda', weak: 'Encaixe fraco', strong: 'Encaixe forte',
}
