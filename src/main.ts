import './styles/main.css'
import * as THREE from 'three'
import { Audio } from './core/audio'
import { Pointers } from './core/pointers'
import { Game } from './game/game'
import { loadProteins } from './game/models'
import { localizeData } from './game/localize'
import { LANGS, lang, setLang, t } from './i18n'
import { readEventSetting, saveEventSetting, type EventPhases } from './game/event'
import { APP_VERSION, clearError, installGlobalErrorLog, lastError } from './core/errlog'
/** Set by boot(): true when reloading would not interrupt anyone (not in VR, not mid-level). */
let canReload = (): boolean => true

const LOGO = `<svg viewBox="0 0 100 100" aria-hidden="true"><polygon points="50,8 86,29 86,71 50,92 14,71 14,29" fill="none" stroke="#3ee6b0" stroke-width="10" stroke-linejoin="round"/><circle cx="50" cy="50" r="13" fill="#ffd23f"/></svg>`

/** Service worker: after one online visit every file is stored on the device, so the game runs without internet. */
function setupOffline(el: HTMLElement): void {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return
  const show = (html: string, ok: boolean) => { el.hidden = false; el.innerHTML = html; el.classList.toggle('ok', ok) }
  if (!navigator.onLine) show(t('Sem internet: jogando com a cópia guardada no aparelho.'), true)
  navigator.serviceWorker.addEventListener('message', e => {
    if (e.data?.type === 'offline-status' && e.data.ready) {
      show(t('✓ Pronto para jogar offline: este aparelho já guardou o jogo.'), true)
    }
  })
  const ask = () => navigator.serviceWorker.controller?.postMessage('status')
  // A newer version replaces the stored copy; switch to it as soon as that does not interrupt a game.
  const hadController = !!navigator.serviceWorker.controller
  let pending = false
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (hadController) pending = true })
  window.setInterval(() => { if (pending && canReload()) location.reload() }, 2000)
  navigator.serviceWorker.register('./sw.js').then(reg => {
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') reg.update().catch(() => {}) })
    window.setInterval(() => { if (navigator.onLine) reg.update().catch(() => {}) }, 5 * 60 * 1000)
    if (!navigator.serviceWorker.controller) show(t('Guardando o jogo para uso offline...'), false)
    navigator.serviceWorker.ready.then(() => { ask(); window.setTimeout(ask, 1500) })
    reg.addEventListener('updatefound', () => show(t('Atualizando a cópia offline...'), false))
  }).catch(err => console.warn('offline indisponível', err))
  navigator.serviceWorker.addEventListener('controllerchange', ask)
  navigator.storage?.persist?.().catch(() => {})
}

async function boot(): Promise<void> {
  installGlobalErrorLog()
  localizeData()
  document.documentElement.lang = lang === 'pt' ? 'pt-BR' : lang
  const canvas = document.querySelector<HTMLCanvasElement>('#game')!
  const ui = document.getElementById('ui')!
  ui.innerHTML = `
    <div class="start" data-screen="title">
      <div class="card">
        <div class="langs" role="group" aria-label="Idioma / Language / Idioma">${LANGS.map(l => `<button class="lang${l.id === lang ? ' on' : ''}" data-lang="${l.id}">${l.label}</button>`).join('')}</div>
        <div class="brand">${LOGO}<h1>${t('Encaixe')}<br><span>${t('Molecular')}</span></h1></div>
        <p class="tagline">${t('Muitos remédios funcionam assim: uma molécula se encaixa numa proteína do corpo, como uma chave na fechadura. Aqui as proteínas são reais e as moléculas são inventadas. Pegue-as com as mãos e teste o encaixe!')}</p>
        <div class="actions">
          <button class="btn" data-act="vr" hidden>${t('Entrar na Realidade Virtual')} <small>${t('óculos')}</small></button>
          <button class="btn alt" data-act="ar" hidden>${t('Realidade Mista')} <small>${t('vendo sua sala')}</small></button>
          <button class="btn ghost" data-act="flat">${t('Jogar aqui no navegador')} <small>${t('mouse ou toque')}</small></button>
        </div>
        <div class="evento" role="group" aria-label="${t('Modo evento (fila de visitantes)')}">
          <span>${t('Modo evento (fila de visitantes)')}</span>
          ${([[0, t('Desligado')], [1, t('1 fase')], [2, t('2 fases')], [3, t('3 fases')]] as [EventPhases, string][])
            .map(([n, label]) => `<button class="lang${n === readEventSetting() ? ' on' : ''}" data-evento="${n}">${label}</button>`).join('')}
        </div>
        <div class="progress"><i></i></div>
        <p class="offline" hidden></p>
        <p class="note">${t('No <b>Meta Quest 3</b>: abra este endereço no navegador do óculos e toque em <b>Entrar na Realidade Virtual</b>. Funciona com os controles ou só com as mãos (pinça com os dedos).')}</p>
        <div class="credit"><span>${t('Desenvolvido por')}</span><img src="${import.meta.env.BASE_URL}brand/nubbics-wordmark.webp" alt="NUBBICS - Núcleo de Bioinformática e Biologia Computacional em Saúde" width="720" height="279"></div>
        <p class="ver">${t('Versão')} ${APP_VERSION}<span class="lasterr"></span></p>
      </div>
    </div>
    <div class="hud" hidden>
      <span class="tip">${t('Clique numa molécula para pegar')}</span>
      <button class="btn tool" data-act="rotl" hidden>${t('Girar')} ⟵</button>
      <button class="btn tool" data-act="rotr" hidden>${t('Girar')} ⟶</button>
      <button class="btn tool alt" data-act="flip" hidden>${t('Virar')}</button>
    </div>
    <div class="corner"><button class="btn" data-act="vr2" hidden>${t('Entrar em RV')}</button></div>`
  const $ = <T extends HTMLElement>(sel: string) => ui.querySelector<T>(sel)!
  // Language buttons work right away, even while the proteins are still loading.
  ui.addEventListener('click', e => {
    const lng = (e.target as HTMLElement).closest<HTMLElement>('[data-lang]')?.dataset.lang
    if (lng && lng !== lang) { setLang(lng as typeof lang); location.reload() }
    const ev = (e.target as HTMLElement).closest<HTMLElement>('[data-evento]')?.dataset.evento
    if (ev !== undefined) {
      const n = Number(ev) as EventPhases
      saveEventSetting(n)
      ui.querySelectorAll<HTMLElement>('[data-evento]').forEach(b => b.classList.toggle('on', b.dataset.evento === ev))
      applyEvent(n)
    }
  })
  let applyEvent: (n: EventPhases) => void = () => {}
  setupOffline($('.offline'))
  const bar = $('.progress i')
  bar.style.width = '10%'
  await Promise.all([document.fonts.load('700 40px ManusCC0'), document.fonts.load('400 40px ManusCC0')]).catch(() => {})
  bar.style.width = '25%'
  try {
    await loadProteins(f => { bar.style.width = `${25 + f * 70}%` })
  } catch (err) {
    console.error(err)
    $('.note').innerHTML = `${t('Não foi possível carregar as proteínas. Conecte à internet uma vez para o aparelho guardar o jogo.')} <button class="btn ghost" data-act="retry">${t('Tentar de novo')}</button>`
    $('[data-act="retry"]').addEventListener('click', () => location.reload())
    return
  }

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
  renderer.setSize(window.innerWidth, window.innerHeight)
  renderer.outputColorSpace = THREE.SRGBColorSpace
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.toneMappingExposure = 1.05
  renderer.xr.enabled = true
  renderer.xr.setReferenceSpaceType('local-floor')
  const scene = new THREE.Scene()
  const camera = new THREE.PerspectiveCamera(52, window.innerWidth / window.innerHeight, 0.02, 60)
  const audio = new Audio()
  const pointers = new Pointers(renderer, scene, camera, canvas)
  const game = new Game(scene, camera, renderer, pointers, audio)
  game.setEventPhases(readEventSetting())
  applyEvent = n => game.setEventPhases(n)
  canReload = () => !renderer.xr.isPresenting && (!ui.querySelector('.start')?.classList.contains('is-hidden') || game.mode === 'menu')
  const le = lastError()
  if (le) {
    const box = ui.querySelector<HTMLElement>('.lasterr')!
    box.innerHTML = ` · <b>${t('Último erro')}:</b> ${le.msg.replace(/[<>&]/g, '')} <small>(${le.version}, ${le.time.slice(0, 16).replace('T', ' ')})</small> <button class="linkbtn" data-act="clearerr">${t('limpar')}</button>`
    box.querySelector('button')!.addEventListener('click', () => { clearError(); box.innerHTML = '' })
  }
  game.layoutDesktopCamera()
  bar.style.width = '100%'

  const start = $('.start')
  const hud = $('.hud')
  const tip = $('.hud .tip')
  const tools = [...ui.querySelectorAll<HTMLElement>('.hud .tool')]
  game.onHud = s => {
    hud.hidden = s.xr || !start.classList.contains('is-hidden')
    tools.forEach(el => { el.hidden = !s.holding })
    tip.textContent = s.holding
      ? t('{name}: gire e clique no bolso da proteína', { name: s.holding })
      : s.mode === 'menu' ? (s.event ? t('Clique em COMEÇAR no painel') : t('Escolha uma fase no painel')) : t('Clique numa molécula para pegar')
  }

  const xr = navigator.xr
  const [vrOk, arOk] = await Promise.all([
    xr?.isSessionSupported('immersive-vr').catch(() => false) ?? false,
    xr?.isSessionSupported('immersive-ar').catch(() => false) ?? false,
  ])
  $('[data-act="vr"]').hidden = !vrOk
  $('[data-act="ar"]').hidden = !arOk
  const vr2 = $('[data-act="vr2"]')
  // Language switched inside the game (event lobby): update the few HTML texts that stay on screen.
  game.onLang = () => {
    document.documentElement.lang = lang === 'pt' ? 'pt-BR' : lang
    vr2.textContent = t('Entrar em RV')
    ui.querySelectorAll<HTMLElement>('.hud .tool').forEach(el => {
      el.textContent = el.dataset.act === 'flip' ? t('Virar') : `${t('Girar')} ${el.dataset.act === 'rotl' ? '⟵' : '⟶'}`
    })
    ui.querySelectorAll<HTMLElement>('[data-lang]').forEach(b => b.classList.toggle('on', b.dataset.lang === lang))
    game.onHud({ holding: null, xr: renderer.xr.isPresenting, mode: game.mode, event: game.eventPhases > 0 })
  }

  let session: XRSession | null = null
  const enter = async (mode: 'immersive-vr' | 'immersive-ar') => {
    if (!xr || session) return
    audio.unlock()
    try {
      game.nextSessionAR = mode === 'immersive-ar'
      const s = await xr.requestSession(mode, { optionalFeatures: ['local-floor', 'bounded-floor', 'hand-tracking'] })
      session = s
      s.addEventListener('end', () => {
        session = null
        start.classList.add('is-hidden')
        vr2.hidden = !vrOk
        game.onHud({ holding: null, xr: false, mode: game.mode, event: game.eventPhases > 0 })
      })
      await renderer.xr.setSession(s)
      start.classList.add('is-hidden')
      vr2.hidden = true
    } catch (err) {
      console.warn('XR session failed', err)
      alert(t('Não foi possível iniciar a realidade virtual neste navegador.'))
    }
  }
  const flat = () => {
    audio.unlock()
    start.classList.add('is-hidden')
    vr2.hidden = !vrOk
    game.onHud({ holding: null, xr: false, mode: game.mode, event: game.eventPhases > 0 })
  }
  ui.addEventListener('click', e => {
    const act = (e.target as HTMLElement).closest<HTMLElement>('[data-act]')?.dataset.act
    if (act === 'vr' || act === 'vr2') void enter('immersive-vr')
    else if (act === 'ar') void enter('immersive-ar')
    else if (act === 'flat') flat()
    else if (act === 'rotl') game.rotateHeld(-1)
    else if (act === 'rotr') game.rotateHeld(1)
    else if (act === 'flip') game.flipHeld()
  })

  window.addEventListener('resize', () => {
    if (renderer.xr.isPresenting) return
    camera.aspect = window.innerWidth / window.innerHeight
    renderer.setSize(window.innerWidth, window.innerHeight)
    game.layoutDesktopCamera()
  })

  if (import.meta.env.DEV) {
    const [{ registerGameTuning }, { tuning }] = await Promise.all([
      import('../scripts/manus-tuning/adapter.js'), import('./game/tuning'),
    ])
    await registerGameTuning(tuning)
  }

  const clock = new THREE.Clock()
  renderer.setAnimationLoop(() => {
    const dt = Math.min(clock.getDelta(), 0.05)
    game.update(dt)
    renderer.render(scene, camera)
  })
  // Debug/test hook (read-only use by smoke tests).
  ;(window as unknown as { __game: unknown }).__game = { game, renderer }
}

boot().catch(err => {
  console.error(err)
  const el = document.getElementById('ui')
  if (el) el.innerHTML = `<div class="fatal">${t('Não foi possível iniciar:')} ${String((err as Error)?.message ?? err).replace(/[<>&]/g, '')}</div>`
})
