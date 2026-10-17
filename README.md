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

## Event mode (visitor queue)

Designed for science fairs and open-house events with many visitors, including young children, using
**hand tracking only** (no controllers needed after the staff presses START once):

- Each visitor plays the stages in a row, with no menu. The next stage starts automatically after each win.
- At the end the panel shows only **Congratulations!** (no clock) and, after a few seconds, the game restarts
  by itself for the next person. If nobody interacts for 3 minutes, it also restarts from the first stage.
- There is no "end game" button during play, so a child cannot leave the game by accident.
- Staff choose how many stages each visitor plays: **1 stage** (Stage 1), **2 stages** (Stages 1–2) or
  **3 stages** (full game). Choose on the start screen, on the "Staff" row of the in-headset panel (shown on the
  start panel and during the congratulations screen), or with the URL: `?evento=1`, `?evento=2`, `?evento=3`
  (`?evento=0` turns it off). The choice is saved on the device.
- The language is chosen on the start screen (Português / English / Español); the whole game follows it.

### Stage 1 is designed for young children

Stage 1 uses the real trypsin surface (PDB 1BJU) with a simplified pocket that has **no charges**: two
medium water-loving wells and one large oily well. All tray molecules are uncharged, too, so the only ideas are
size and oil/water. The correct molecule (Leaf) has two identical water-loving arms, so it always docks by
**turning** it; it never needs to be flipped over. Stages 2 and 3 keep the +/− charge rules.

In Stage 2 the β2 receptor is tilted towards the player (40°) so the colours and sizes of the wells are easy to
see, and the Stage 2 "Bolt" (Raio) has a **red (−) tip**, so it is clearly different from Shield (Escudo), the
right answer.

Stages 1 and 2 use **turn-only docking**: which face of the molecule the player shows does not matter. Turning it
until the tip with the dot (or the right colour) points at the matching hole is enough; the molecule settles on
its correct face by itself, so it never needs to be flipped over by hand.

## Analytics

Visits are measured with Google Analytics 4 (property **EncaixePerfeito**, measurement ID `G-85PTRY5D21`).
The tag is loaded only on the published site (`deborahantunes.github.io`), never in local development.
Besides page views, the game sends a few custom events:

| Event | Parameters |
| --- | --- |
| `play_start` | `mode` (`vr`, `mixed_reality`, `browser`), `event_phases` |
| `level_complete` | `level`, `event_mode`, `xr` |
| `event_run_start` | `phases` |
| `event_run_complete` | `phases`, `total_seconds`, `day_record` |

## Development

Requires Node.js 22 and pnpm.

```bash
pnpm install
pnpm dev                              # development server
pnpm test                             # docking rules, translations and event-mode tests (vitest)
pnpm run manus:build-source           # production build in dist/ (with offline service worker)
node scripts/smoke.mjs http://127.0.0.1:3000/   # end-to-end browser test
python3 scripts/proteins/build.py     # regenerate public/proteins/*.glb and src/game/proteins.json
```

Every push to `main` is built and published to GitHub Pages by `.github/workflows/pages.yml`.

### Code map

| File | Contents |
| --- | --- |
| `src/game/data.ts` | Molecules, protein targets and stages |
| `src/game/rules.ts` | Docking rules (size + chemistry scoring) |
| `src/core/analytics.ts` | Google Analytics loader and custom events |
| `src/game/event.ts` | Event mode settings, timing and best time of the day |
| `src/game/game.ts` | Scene, menus, stages and animations |
| `src/game/models.ts` | Protein surfaces and 3D molecules |
| `src/core/pointers.ts` | Controllers, hands and mouse |
| `src/i18n/*.json` | English and Spanish translations (Portuguese text is the key) |

## Credits

Developed by **NUBBICS** — Núcleo de Bioinformática e Biologia Computacional em Saúde.
