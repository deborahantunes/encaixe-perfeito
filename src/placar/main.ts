/**
 * "Desafio em grupo" teacher screen (placar.html): creates the room, shows the code for the headsets, sets the
 * difficulty and number of challenges, and shows the live view of every team, the ranking and the podium.
 * Meant for a notebook connected to a projector; no headset needed.
 */
import './placar.css'
import { LANGS, lang, setLang, t } from '../i18n'
import { localizeData } from '../game/localize'
import { LEVEL_BY_ID, MOLECULES, TIERS, TIER_ABOUT, TIER_NAME, stagesOf, type MoleculeId, type Tier } from '../game/data'
import { FIT_TITLE } from '../game/rules'
import { fmtTime } from '../game/event'
import { loadProteins } from '../game/models'
import { DEFAULT_SERVER, RoomClient, pingServer, serverUrl, setServerUrl, httpUrl, type RoomState, type TeamState } from '../net/room'
import { ranking, teamName } from '../net/ranking'
import { LiveView } from './view3d'

const LOGO = `<svg viewBox="0 0 100 100" aria-hidden="true"><polygon points="50,8 86,29 86,71 50,92 14,71 14,29" fill="none" stroke="#3ee6b0" stroke-width="10" stroke-linejoin="round"/><circle cx="50" cy="50" r="13" fill="#ffd23f"/></svg>`
const ROOM_KEY = 'encaixe-placar-sala'
const esc = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)

localizeData()
document.documentElement.lang = lang === 'pt' ? 'pt-BR' : lang
document.title = `${t('Placar')} · ${t('Desafio em grupo')} · ${t('Encaixe Molecular')}`

const app = document.getElementById('app')!
const canvas = document.getElementById('live') as HTMLCanvasElement
let server = serverUrl()
let client: RoomClient | null = null
let serverOk: boolean | null = null
let message = ''
let structure = ''
let confirmReset = 0
let view: LiveView | null = null
const toasts = new Map<number, number>()

app.innerHTML = `
  <header>
    <div class="brand">${LOGO}<div><b>${t('Encaixe Molecular')}</b><span>${t('Desafio em grupo')} · ${t('Placar')}</span></div></div>
    <div class="roomcode" data-k="room"></div>
    <div class="tools">
      <span class="pill" data-k="status"></span>
      ${LANGS.map(l => `<button class="lng${l.id === lang ? ' on' : ''}" data-lang="${l.id}">${l.flag}</button>`).join('')}
      <button class="btn ghost" data-act="full">${t('Tela cheia')}</button>
    </div>
  </header>
  <main data-k="main"></main>
  <footer data-k="footer"></footer>`
const $ = (k: string) => app.querySelector<HTMLElement>(`[data-k="${k}"]`)!

/** Address of the game for the headsets (same site, without placar.html), with ?sala=. */
function gameLink(room: string): string {
  const base = `${location.origin}${location.pathname.replace(/placar\.html$/, '')}`
  const q = new URLSearchParams({ sala: room })
  if (server !== DEFAULT_SERVER && !/^(localhost|127\.0\.0\.1)$/.test(location.hostname)) q.set('servidor', server)
  return `${base}?${q}`
}

// ------------------------------------------------------------------ connection

async function wake(): Promise<void> {
  serverOk = null
  render()
  serverOk = await pingServer(server)
  render()
}

function createRoom(resumeRoom = ''): void {
  client?.close()
  message = ''
  const c = new RoomClient(server, 'host', resumeRoom)
  client = c
  c.onWelcome = () => { try { sessionStorage.setItem(ROOM_KEY, c.room) } catch { /* ignore */ } render() }
  c.onState = s => onState(s)
  c.onStatus = () => render()
  c.onError = code => {
    message = code === 'no_teams' ? t('Nenhum óculos entrou na sala ainda.') : code === 'no_room' ? t('A sala expirou. Crie uma nova.') : ''
    render()
  }
  c.onEvent = e => {
    const mol = MOLECULES[e.mol as MoleculeId]?.name ?? e.mol
    const el = app.querySelector<HTMLElement>(`[data-k="toast-${e.team}"]`)
    if (el) {
      el.textContent = `${mol}: ${FIT_TITLE[e.fit] ?? e.fit}${e.ok ? ` ✓ +${e.points}` : ''}`
      el.style.color = e.ok ? '#3ee6b0' : e.fit === 'weak' ? '#ffb347' : '#ff9db5'
      el.classList.add('show')
      window.clearTimeout(toasts.get(e.team))
      toasts.set(e.team, window.setTimeout(() => el.classList.remove('show'), 3200))
    }
  }
  c.onPose = p => view?.pose(p)
  render()
}

function cmd(msg: Record<string, unknown>): void {
  client?.send(msg)
}

let lastLevel: number | null = -1
function onState(s: RoomState): void {
  const levelId = s.phase === 'round' || s.phase === 'countdown' ? s.levelId : null
  if (levelId !== lastLevel) { lastLevel = levelId; view?.clear(); view?.setLevel(levelId) }
  render()
}

// ------------------------------------------------------------------ rendering

function statusPill(): void {
  const el = $('status')
  let cls = 'pill'
  let text: string
  if (client) {
    if (client.status === 'open') { cls += ' ok'; text = t('Conectado') }
    else if (client.status === 'closed') { cls += ' bad'; text = t('Desconectado') }
    else { cls += ' warn'; text = t('Reconectando...') }
  } else if (serverOk === null) { cls += ' warn'; text = t('Acordando o servidor...') }
  else if (serverOk) { cls += ' ok'; text = t('Servidor pronto') }
  else { cls += ' bad'; text = t('Servidor fora do ar') }
  el.className = cls
  el.textContent = text
}

function keyOf(s: RoomState | null): string {
  if (!client || !s) return `none|${serverOk}|${client?.status ?? ''}|${(client?.failures ?? 0) >= 3}`
  return [s.phase, s.round, s.tier, s.count, s.levelId, s.teams.map(x => `${x.claimed ? 1 : 0}${x.online ? 1 : 0}`).join('')].join('|')
}

function render(): void {
  statusPill()
  const s = client?.state ?? null
  $('room').innerHTML = client?.room && s ? `${t('Sala')} <b>${esc(client.room)}</b>` : ''
  const key = keyOf(s) + message
  if (key !== structure) {
    structure = key
    // Keep what the teacher is typing (a headset connecting rebuilds the lobby).
    const typing = document.activeElement instanceof HTMLInputElement && document.activeElement.dataset.rename !== undefined
      ? { id: document.activeElement.dataset.rename, value: document.activeElement.value, at: document.activeElement.selectionStart ?? 0 } : null
    const main = $('main')
    if (!client || !s) main.innerHTML = connectHtml()
    else if (s.phase === 'lobby') main.innerHTML = lobbyHtml(s)
    else if (s.phase === 'countdown') main.innerHTML = countdownHtml(s)
    else if (s.phase === 'round') main.innerHTML = roundHtml(s)
    else if (s.phase === 'results') main.innerHTML = resultsHtml(s)
    else main.innerHTML = podiumHtml(s)
    $('footer').innerHTML = footerHtml(s)
    const again = typing && app.querySelector<HTMLInputElement>(`[data-rename="${typing.id}"]`)
    if (again && typing) { again.value = typing.value; again.focus(); again.setSelectionRange(typing.at, typing.at) }
  }
  patch(s)
}

function connectHtml(): string {
  // The room server does not answer: stop waiting and say so.
  if (client && client.failures >= 3 && !client.state) { client.close(); client = null; serverOk = false }
  const busy = serverOk === null || (client && client.status !== 'open')
  return `<div class="connect card">
    <h1>${t('Desafio em grupo')}</h1>
    <p>${t('Até 4 óculos jogam os mesmos desafios ao mesmo tempo. Esta tela mostra o código da sala, o que cada time está fazendo e o placar. Ligue-a no projetor.')}</p>
    <button class="btn big" data-act="create" ${busy ? 'disabled' : ''}>${client ? t('Conectando...') : serverOk === null ? t('Acordando o servidor...') : t('Criar sala')}</button>
    <p class="msg">${serverOk === false ? `${t('Não foi possível falar com o servidor. Confira a internet e tente de novo.')} ${t('Se continuar, o servidor ainda não foi instalado (veja o README, "Desafio em grupo").')}<br><small>${esc(httpUrl(server))}</small>` : esc(message)}</p>
    ${serverOk === false ? `<button class="btn ghost" data-act="wake">${t('Tentar de novo')}</button>` : ''}
    <p>${t('Na primeira vez do dia o servidor pode levar até 1 minuto para acordar.')}</p>
    <details><summary>${t('Servidor (avançado)')}</summary><input data-k="server" value="${esc(server)}" spellcheck="false"></details>
  </div>`
}

function teamCard(tm: TeamState): string {
  const state = !tm.claimed ? t('Livre: aguardando um óculos') : tm.online ? t('Conectado') : t('Sem conexão')
  return `<div class="team${tm.online ? ' online' : ''}" style="--c:${tm.color}">
    <span class="dot"></span>
    <input data-rename="${tm.index}" value="${esc(teamName(tm))}" maxlength="22" aria-label="${t('Nome do time')}">
    ${tm.claimed ? `<button class="btn ghost free" data-free="${tm.index}">${t('Liberar')}</button>` : '<span></span>'}
    <span class="state">${state}</span>
  </div>`
}

function lobbyHtml(s: RoomState): string {
  const link = gameLink(client!.room)
  const max = stagesOf(s.tier).length
  const titles = stagesOf(s.tier).slice(0, s.count).map(l => esc(l.title)).join(' · ')
  const ready = s.teams.some(x => x.claimed)
  return `<section class="lobby">
    <div class="join card">
      <p class="kicker">${t('Código da sala')}</p>
      <div class="code">${esc(client!.room)}</div>
      <ol>
        <li>${t('Nos óculos, abra o jogo:')} <b>${esc(link.replace(/^https?:\/\//, '').split('?')[0])}</b></li>
        <li>${t('Toque em <b>Desafio em grupo</b> e digite o código.')}</li>
        <li>${t('Cada óculos escolhe uma cor de time.')}</li>
      </ol>
      <p class="link">${t('Link direto:')} ${esc(link)}</p>
    </div>
    <div class="setup card">
      <h2>${t('Nível')}</h2>
      <div class="choices">${TIERS.map(x => `<button class="choice${x === s.tier ? ' on' : ''}" data-tier="${x}"><b>${t(TIER_NAME[x])}</b><small>${t(TIER_ABOUT[x])}</small></button>`).join('')}</div>
      <h2>${t('Número de desafios')}</h2>
      <div class="count">${Array.from({ length: max }, (_, i) => `<button class="${i + 1 === s.count ? 'on' : ''}" data-count="${i + 1}">${i + 1}</button>`).join('')}
        <span class="titles">${titles}</span></div>
      <h2>${t('Times')}</h2>
      <div class="teams">${s.teams.map(teamCard).join('')}</div>
      <p class="msg">${esc(message)}</p>
      <button class="btn big go" data-act="start" ${ready ? '' : 'disabled'}>${t('Começar o desafio')}</button>
    </div>
  </section>`
}

function countdownHtml(s: RoomState): string {
  const lv = s.levelId !== null ? LEVEL_BY_ID.get(s.levelId) : null
  return `<section class="count-down">
    <p class="kicker">${t('Desafio {n} de {total}', { n: s.round + 1, total: s.totalRounds })} · ${t('Nível {tier}', { tier: t(TIER_NAME[s.tier]) })}</p>
    <h1>${esc(lv?.title ?? '')}</h1>
    <div class="num" data-k="countdown">3</div>
    <p class="goal">${esc(lv?.goal ?? '')}</p>
  </section>`
}

function roundHtml(s: RoomState): string {
  const lv = s.levelId !== null ? LEVEL_BY_ID.get(s.levelId) : null
  const teams = s.teams.filter(x => x.claimed)
  return `<section class="round" style="display:flex;flex-direction:column;flex:1;min-height:0">
    <div class="round-head">
      <div><p class="kicker">${t('Desafio {n} de {total}', { n: s.round + 1, total: s.totalRounds })} · ${t('Nível {tier}', { tier: t(TIER_NAME[s.tier]) })}</p>
      <h1>${esc(lv?.title ?? '')}</h1><p class="goal">${t('Missão: {goal}', { goal: esc(lv?.goal ?? '') })}</p></div>
      <div class="timer" data-k="timer"></div>
    </div>
    <div class="grid n${teams.length}">${teams.map(tm => `<div class="cell" data-cell="${tm.index}" style="--c:${tm.color}">
      <div class="cell-top"><span class="dot"></span><b data-k="name-${tm.index}"></b><span class="pts" data-k="pts-${tm.index}"></span></div>
      <div class="cell-status" data-k="st-${tm.index}"></div>
      <div class="toast" data-k="toast-${tm.index}"></div>
    </div>`).join('')}</div>
  </section>`
}

function rankRows(s: RoomState, withRound: boolean): string {
  return ranking(s.teams).map((tm, i) => {
    const r = tm.solved ? `✓ +${tm.points} · ${fmtTime(tm.solvedMs)}` : `✗ ${t('não resolveu')}`
    return `<div class="row" style="--c:${tm.color}"><span class="pos">${i + 1}º</span><span class="dot"></span>
      <span class="name">${esc(teamName(tm))}</span>
      <span class="this${tm.solved ? ' ok' : ''}">${withRound ? r : t('tempo total {t}', { t: fmtTime(tm.totalMs) })}</span>
      <span class="total">${t('{n} pts', { n: tm.score })}</span></div>`
  }).join('')
}

function resultsHtml(s: RoomState): string {
  const lv = s.levelId !== null ? LEVEL_BY_ID.get(s.levelId) : null
  return `<section class="results">
    <p class="kicker">${t('Fim do desafio {n} de {total}', { n: s.round + 1, total: s.totalRounds })}</p>
    <h1>${esc(lv?.title ?? '')}</h1>
    <p class="next" data-k="next"></p>
    <div class="rank">${rankRows(s, true)}</div>
    ${lv ? `<div class="card"><p class="kicker">${t('O que aprendemos')}</p><p style="margin:0;line-height:1.45">${esc(lv.learned)}</p></div>` : ''}
  </section>`
}

function podiumHtml(s: RoomState): string {
  const order = ranking(s.teams)
  const step = (i: number) => {
    const tm = order[i]
    if (!tm) return ''
    return `<div class="step p${i + 1}" style="--c:${tm.color}"><div class="who">${esc(teamName(tm))}</div>
      <div class="block"><span class="place">${i + 1}º</span><span class="score">${t('{n} pts', { n: tm.score })}</span></div></div>`
  }
  return `<section class="results">
    <h1 style="text-align:center;color:var(--sun);font-size:3.2em">${t('Pódio!')}</h1>
    <div class="podium">${step(1)}${step(0)}${step(2)}</div>
    <div class="rank">${rankRows(s, false)}</div>
  </section>`
}

function footerHtml(s: RoomState | null): string {
  if (!client || !s) return `<span class="note">${t('Proteínas reais (banco PDB), moléculas inventadas.')}</span>`
  const b: string[] = []
  if (s.phase === 'round') b.push(`<button class="btn sun" data-act="next">${t('Encerrar rodada agora')}</button>`)
  if (s.phase === 'results' || s.phase === 'countdown') b.push(`<button class="btn sun" data-act="next">${t('Avançar')}</button>`)
  if (s.phase === 'podium') b.push(`<button class="btn big" data-act="again">${t('Jogar de novo')}</button>`)
  if (s.phase !== 'lobby') b.push(`<button class="btn ghost" data-act="reset">${confirmReset > Date.now() ? t('Clique de novo para zerar') : t('Zerar placar')}</button>`)
  b.push(`<button class="btn ghost" data-act="newroom">${t('Nova sala')}</button>`)
  return `<span class="note">${t('Sala {code}', { code: esc(client.room) })} · ${esc(httpUrl(server).replace(/^https?:\/\//, ''))}</span>${b.join('')}`
}

/** Updates the parts that change every second without rebuilding the page (keeps typing focus). */
function patch(s: RoomState | null): void {
  if (!client || !s) return
  const now = client.now()
  const left = (ms: number) => Math.max(0, Math.ceil((ms - now) / 1000))
  const timer = app.querySelector<HTMLElement>('[data-k="timer"]')
  if (timer) { const l = left(s.endsAt); timer.textContent = fmtTime(l * 1000); timer.classList.toggle('low', l <= 10) }
  const cd = app.querySelector<HTMLElement>('[data-k="countdown"]')
  if (cd) cd.textContent = String(Math.max(1, left(s.phaseEndsAt)))
  const next = app.querySelector<HTMLElement>('[data-k="next"]')
  if (next) next.textContent = s.round + 1 < s.totalRounds ? t('Próximo desafio em {n} s', { n: Math.max(1, left(s.phaseEndsAt)) }) : t('Pódio em {n} s', { n: Math.max(1, left(s.phaseEndsAt)) })
  for (const tm of s.teams) {
    const name = app.querySelector<HTMLElement>(`[data-k="name-${tm.index}"]`)
    if (name) name.textContent = teamName(tm) + (tm.online ? '' : ` (${t('sem conexão')})`)
    const pts = app.querySelector<HTMLElement>(`[data-k="pts-${tm.index}"]`)
    if (pts) pts.textContent = t('{n} pts', { n: tm.score })
    const st = app.querySelector<HTMLElement>(`[data-k="st-${tm.index}"]`)
    if (st) {
      st.className = `cell-status${tm.solved ? ' ok' : ''}`
      st.textContent = tm.solved ? t('✓ Resolveu! +{n} pts em {t}', { n: tm.points, t: fmtTime(tm.solvedMs) })
        : tm.attempts ? (tm.wrong === 1 ? t('1 tentativa errada') : t('{n} tentativas erradas', { n: tm.wrong })) : view && view.silence(tm.index) > 4 ? t('aguardando...') : ''
    }
    app.querySelector(`[data-cell="${tm.index}"]`)?.classList.toggle('solved', tm.solved)
    const input = app.querySelector<HTMLInputElement>(`[data-rename="${tm.index}"]`)
    if (input && document.activeElement !== input) input.value = teamName(tm)
  }
}

// ------------------------------------------------------------------ input

app.addEventListener('click', e => {
  const el = (e.target as HTMLElement).closest<HTMLElement>('button')
  if (!el) return
  const s = client?.state
  if (el.dataset.lang) { setLang(el.dataset.lang as typeof lang); location.reload(); return }
  if (el.dataset.tier && s) { const tier = el.dataset.tier as Tier; cmd({ type: 'config', tier, count: Math.min(s.count, stagesOf(tier).length) || stagesOf(tier).length }); return }
  if (el.dataset.count && s) { cmd({ type: 'config', tier: s.tier, count: Number(el.dataset.count) }); return }
  if (el.dataset.free) { cmd({ type: 'free', team: Number(el.dataset.free) }); return }
  switch (el.dataset.act) {
    case 'create': {
      const input = app.querySelector<HTMLInputElement>('[data-k="server"]')
      const v = input?.value.trim()
      if (v && /^wss?:\/\/\S+$/.test(v) && v !== server) { server = v.replace(/\/+$/, ''); setServerUrl(server === DEFAULT_SERVER ? null : server) }
      createRoom()
      break
    }
    case 'wake': void wake(); break
    case 'start': message = ''; cmd({ type: 'start' }); break
    case 'next': cmd({ type: 'next' }); break
    case 'again': cmd({ type: 'reset' }); break
    case 'reset':
      if (confirmReset > Date.now()) { confirmReset = 0; cmd({ type: 'reset' }) } else { confirmReset = Date.now() + 4000; structure = ''; render(); window.setTimeout(() => { structure = ''; render() }, 4100) }
      break
    case 'newroom':
      try { sessionStorage.removeItem(ROOM_KEY) } catch { /* ignore */ }
      client?.close(); client = null; structure = ''; lastLevel = -1; view?.setLevel(null)
      createRoom()
      break
    case 'full':
      if (document.fullscreenElement) void document.exitFullscreen(); else void document.documentElement.requestFullscreen?.().catch(() => {})
      break
  }
})

app.addEventListener('change', e => {
  const input = e.target as HTMLInputElement
  if (input.dataset.rename !== undefined) {
    const name = input.value.trim()
    if (name) cmd({ type: 'rename', team: Number(input.dataset.rename), name })
  }
})
app.addEventListener('keydown', e => {
  const input = e.target as HTMLInputElement
  if (e.key === 'Enter' && input.dataset.rename !== undefined) input.blur()
})

// ------------------------------------------------------------------ start

let last = performance.now()
function frame(): void {
  const now = performance.now()
  const dt = Math.min(0.1, (now - last) / 1000)
  last = now
  if (client?.state) patch(client.state)
  try { view?.render(dt) } catch (err) { console.warn('live view', err); view = null }
  requestAnimationFrame(frame)
}

render()
requestAnimationFrame(frame)
// Debug/test hook (read-only use by smoke tests).
;(window as unknown as { __placar: unknown }).__placar = { client: () => client, view: () => view }
// Keeps a free-tier server awake while this screen is open.
window.setInterval(() => { void pingServer(server, 20_000) }, 4 * 60_000)
void wake().then(() => {
  let saved = ''
  try { saved = sessionStorage.getItem(ROOM_KEY) ?? '' } catch { /* ignore */ }
  if (saved && serverOk) createRoom(saved)
})
void loadProteins(() => {}).then(() => {
  view = new LiveView(canvas, () => [0, 1, 2, 3].map(i => app.querySelector<HTMLElement>(`[data-cell="${i}"]`)))
  view.setLevel(lastLevel ?? null)
}).catch(err => console.warn('proteínas indisponíveis na tela do professor', err))
