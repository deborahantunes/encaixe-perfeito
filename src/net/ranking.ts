import { t } from '../i18n'
import { TEAM_NAMES } from '../game/challenges'
import type { TeamState } from './room'

/** Default team names are translated on screen; names typed by the teacher are shown as they are. */
export const teamName = (tm: Pick<TeamState, 'name'>): string => ((TEAM_NAMES as readonly string[]).includes(tm.name) ? t(tm.name) : tm.name)

/** Ranking: points, then less total time, then team order. */
export const ranking = (teams: TeamState[]): TeamState[] =>
  teams.filter(x => x.claimed).sort((a, b) => b.score - a.score || a.totalMs - b.totalMs || a.index - b.index)
