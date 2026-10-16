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

Designed for science fairs and open-house events with many visitors:

- The headset waits on a **"Ready for the next player!"** panel with a big **START** button.
- Each visitor plays the stages in a row, with no menu. The next stage starts automatically after each win.
- At the end, the panel shows **Congratulations!**, the total time, the time per stage and the best time of the
  day. Then it is immediately ready for the next person.
- Staff choose how many stages each visitor plays: **1 stage** (Stage 1), **2 stages** (Stages 1–2) or
  **3 stages** (full game). Choose on the start screen, on the "Staff" row of the in-headset panel, or with the
  URL: `?evento=1`, `?evento=2`, `?evento=3` (`?evento=0` turns it off). The choice is saved on the device.
- The language is chosen on the start screen (Português / English / Español); the whole game follows it.
- The clock counts playing time only (not the 5 s pause between stages). "Restart" does not reset it.
- "End game" returns to the next-player screen. After 3 minutes with no interaction, the game returns there
  automatically. The result stays on screen for 90 s.
- "Free mode" returns to the regular menu (tutorial, stages and free lab).

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
| `src/game/event.ts` | Event mode settings, timing and best time of the day |
| `src/game/game.ts` | Scene, menus, stages and animations |
| `src/game/models.ts` | Protein surfaces and 3D molecules |
| `src/core/pointers.ts` | Controllers, hands and mouse |
| `src/i18n/*.json` | English and Spanish translations (Portuguese text is the key) |

## Credits

Developed by **NUBBICS** — Núcleo de Bioinformática e Biologia Computacional em Saúde.
