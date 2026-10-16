import { t } from '../i18n'
import { CHEM_LABEL, LEVELS, MOLECULES, TARGETS } from './data'
import { FIT_TITLE } from './rules'

type Table = Record<string, Record<string, unknown>>
/** Portuguese originals, captured on the first call, so the language can be switched at any time. */
let originals: { table: Table; fields: string[]; pt: Record<string, string>[] }[] | null = null
let labels: { obj: Record<string, string>; pt: Record<string, string> }[] = []

/** Translates the (Portuguese) data tables in place for the current language. Safe to call again after setLang(). */
export function localizeData(): void {
  if (!originals) {
    const snap = (table: Table, fields: string[]) => ({
      table, fields,
      pt: Object.values(table).map(item => Object.fromEntries(fields.filter(f => typeof item[f] === 'string').map(f => [f, item[f] as string]))),
    })
    originals = [
      snap(MOLECULES as unknown as Table, ['name', 'about']),
      snap(TARGETS as unknown as Table, ['name', 'short', 'role', 'effect', 'word']),
      snap(LEVELS as unknown as Table, ['title', 'intro', 'goal', 'learned']),
    ]
    labels = [CHEM_LABEL, FIT_TITLE].map(obj => ({ obj: obj as Record<string, string>, pt: { ...obj } as Record<string, string> }))
  }
  for (const { table, pt } of originals) {
    Object.values(table).forEach((item, i) => { for (const [f, v] of Object.entries(pt[i])) item[f] = t(v) })
  }
  for (const { obj, pt } of labels) for (const k of Object.keys(pt)) obj[k] = t(pt[k])
}
