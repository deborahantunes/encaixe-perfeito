# Encaixe Molecular VR

**Play:** https://deborahantunes.github.io/encaixe-perfeito/
**Event mode (visitor queue, 3 stages):** https://deborahantunes.github.io/encaixe-perfeito/?evento=3

An educational WebXR game about how medicines work. Grab molecules with your hands and dock them into the
pocket of real proteins to see strong and weak fits, blocking, activation and selectivity. It runs on
**Meta Quest** (VR or mixed reality, with controllers or hand tracking) and in any browser (mouse or touch).
The game is available in Portuguese (pt-BR), English and Spanish.

- **Real proteins:** molecular surfaces generated from PDB structures: trypsin (1BJU), thrombin (1PPB) and the
  β2-adrenergic receptor (2RH1). Their pockets are simplified into three cavities that mirror real features
  (for example, Asp189 at the bottom of the trypsin/thrombin S1 pocket).
- **Fictional molecules:** every ligand is invented. The game does not show or recommend any real medicine.

## How to play on Meta Quest

1. Open the link above in the Quest browser.
2. Tap **Enter Virtual Reality** (or **Mixed Reality**).
3. Point and pull the trigger (or pinch with your fingers) to grab a molecule, turn your wrist to rotate it,
   and release it close to the protein pocket.

After one online visit the game is stored on the device and also works **offline**.

## Three ways to play

The main menu has three modes:

1. **Free lab (Laboratório livre):** choose a difficulty and any stage, or the free bench (any protein, any
   molecule, with a lab notebook).
2. **Event mode (Modo evento):** a visitor queue at fairs and open days (hands only, restarts by itself).
3. **Group challenge (Desafio em grupo):** up to 4 headsets play the same challenges at the same time, with a
   scoreboard on a projector.

### Difficulties and stages

| Difficulty | Stages | Idea |
| --- | --- | --- |
| **Fácil** (easy, children) | 1 A chave certa · 2 Trave a trombina · 3 Ligar ou bloquear? | Only shape + oil/water (no charges at all); turning is enough (turn-only docking) |
| **Padrão** (standard) | 1 Trave a tripsina · 2 A molécula que escolhe · 3 Bloqueie o receptor | +/− charges, agonist vs antagonist, selectivity; turn **and** flip |
| **Especialista** (expert) | 1 Quatro sub-bolsos · 2 Seletividade nos sub-bolsos · 3 Cinco pontos no receptor | Pockets with 4 (protease sub-sites S1–S4) and 5 (β2 receptor) contact points, 4- and 5-arm molecules, look-alike decoys (same arms in another order), a 0–100 fit score, no help |

Each difficulty has 3 stages and every stage has exactly one correct molecule (checked by `tests/rules.test.ts`).
The easy stages use uncharged versions of the real trypsin (PDB 1BJU), β2 receptor (PDB 2RH1) and thrombin (PDB 1PPB)
pockets. The expert pockets are carved on the same real surfaces with 4 or 5 wells. In the easy stages the
molecule settles on its correct face by itself, so it never has to be flipped over by hand. The β2 receptor
(PDB 2RH1) is tilted 40° towards the player so the wells are easy to see. The old tutorial was removed: the
first stage of each difficulty explains how to grab and turn a molecule.

## Event mode (visitor queue)

Designed for science fairs and open-house events with many visitors, including young children, using
**hand tracking only** (no controllers needed after the staff presses START once):

- Each visitor plays the first N stages of one difficulty in a row, with no menu. The next stage starts
  automatically after each win.
- At the end the panel shows **Congratulations!** and, after a few seconds, the game restarts by itself for the
  next person. If nobody interacts for 3 minutes, it also restarts from the first stage.
- There is no "end game" button during play, so a child cannot leave the game by accident.
- Staff choose the **difficulty** and the **number of stages** on the in-headset panel ("Nível" and "Fases"
  rows), on the start screen (difficulty), or with the URL: `?evento=3&nivel=facil` (`nivel` = `facil`,
  `padrao` or `especialista`; `?evento=0` turns it off). The choice is saved on the device.
- The language is chosen on the start screen (Português / English / Español); the whole game follows it.

## Group challenge (Desafio em grupo)

For a class or a group with up to **4 Meta Quest headsets** and one computer connected to a projector.
Everything runs in the browser; the headsets and the computer only need internet.

1. On the computer, open **https://deborahantunes.github.io/encaixe-perfeito/placar.html** (teacher screen) and
   click **Criar sala**. A 4-digit room code appears.
2. On each headset, open the game, choose **Desafio em grupo** and type the code (or type it on the start screen
   before entering VR, or open the direct link `?sala=1234`). Each headset picks a team color.
3. On the teacher screen, choose the difficulty and the number of challenges, rename the teams if you like, and
   click **Começar o desafio**.
4. All headsets play the same stage at the same time. Points: 100 for solving it, up to +100 for speed,
   +50 if it was the first try, −15 per wrong try (never below 50). Ties are broken by total time.
5. The teacher screen shows a live 3D view of each team's table, the timer, every docking attempt, the
   results after each challenge and the final podium. The headsets show the ranking too.

Each player handles only their own molecules, so a slow Wi-Fi does not affect the game; a headset that drops
comes back to the same team with its points. In **Mixed Reality** the players can see each other in the room.

### Room server (one-time setup)

The rooms live on a tiny Node.js server (`server/server.mjs`, WebSocket). It is deployed for free on
[Render](https://render.com) from this repository with the blueprint in `render.yaml`:

1. Open https://render.com/deploy?repo=https://github.com/deborahantunes/encaixe-perfeito and sign in with GitHub.
2. Confirm the service **encaixe-desafio** (free plan) and click **Deploy**.
3. The game uses `wss://encaixe-desafio.onrender.com` by default. If Render gives the service another address,
   put it in `DEFAULT_SERVER` (`src/net/room.ts`), or open the teacher screen and the game once with
   `?servidor=wss://<address>` (saved on each device).

On the free plan the server sleeps after about 15 minutes without use; the teacher screen wakes it up when it is
opened (the first time it can take up to a minute) and keeps it awake while it stays open.

To run it locally: `pnpm server` (port 8790). The game and the teacher screen served from `localhost` use the
local server automatically.

## Analytics

Visits are measured with Google Analytics 4 (property **EncaixePerfeito**, measurement ID `G-85PTRY5D21`).
The tag is loaded only on the published site (`deborahantunes.github.io`), never in local development.
Besides page views, the game sends a few custom events:

| Event | Parameters |
| --- | --- |
| `play_start` | `mode` (`vr`, `mixed_reality`, `browser`), `event_phases`, `tier`, `group` |
| `level_complete` | `level`, `tier`, `event_mode`, `group`, `xr` |
| `event_run_start` | `phases`, `tier` |
| `event_run_complete` | `phases`, `tier`, `total_seconds`, `day_record` |
| `group_join` | `xr` |

## Development

Requires Node.js 22 and pnpm.

```bash
pnpm install
pnpm dev                              # development server
pnpm test                             # docking rules, translations, event mode and room server tests (vitest)
pnpm run manus:build-source           # production build in dist/ (with offline service worker)
node scripts/smoke.mjs http://127.0.0.1:3000/   # end-to-end browser test (every stage)
node scripts/smoke-group.mjs http://127.0.0.1:3000/   # group challenge: server + teacher screen + 2 players
pnpm build:shared                     # after changing stages or rules: rebuild server/shared/challenges.mjs
python3 scripts/proteins/build.py     # regenerate public/proteins/*.glb and src/game/proteins.json
```

Every push to `main` is built and published to GitHub Pages by `.github/workflows/pages.yml`.

### Code map

| File | Contents |
| --- | --- |
| `src/game/data.ts` | Molecules, protein targets, difficulties and stages |
| `src/game/challenges.ts` | Stage judging shared by the game and the room server, group-challenge points |
| `src/game/rules.ts` | Docking rules (size + chemistry scoring) |
| `src/core/analytics.ts` | Google Analytics loader and custom events |
| `src/game/event.ts` | Event mode settings, timing and best time of the day |
| `src/game/game.ts` | Scene, menus, stages and animations |
| `src/game/models.ts` | Protein surfaces and 3D molecules |
| `src/net/room.ts` | Group-challenge client (WebSocket, reconnection, server clock) |
| `src/placar/` | Teacher screen (`placar.html`): room, settings, live 3D view, ranking and podium |
| `server/server.mjs` | Room server (rooms, teams, rounds, timers, scoring); `render.yaml` deploys it |
| `src/core/pointers.ts` | Controllers, hands and mouse |
| `src/i18n/*.json` | English and Spanish translations (Portuguese text is the key) |

## Credits

Developed by **NUBBICS** — Núcleo de Bioinformática e Biologia Computacional em Saúde.
