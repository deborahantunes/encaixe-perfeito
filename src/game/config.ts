export type PlayConfig = { snapDistance: number; weakHoldSeconds: number; naturalInterval: number; animSpeed: number; autoNextSeconds: number; eventIdleSeconds: number; eventResultSeconds: number }

export const DEFAULT_CONFIG: { readonly play: Readonly<PlayConfig> } = Object.freeze({
  play: Object.freeze({
    /** How close (m) a released molecule must be to the pocket to try docking. */
    snapDistance: 0.17,
    /** Seconds a weak fit stays in the pocket before it slips away. */
    weakHoldSeconds: 2.6,
    autoNextSeconds: 5,
    /** Event mode: a run with no grab for this long goes back to the lobby (visitor left the headset). */
    eventIdleSeconds: 180,
    /** Event mode: how long "Parabéns!" stays on screen before the game restarts by itself for the next person. */
    eventResultSeconds: 7,
    /** Seconds between natural molecules arriving at the protein. */
    naturalInterval: 4.5,
    /** Molecule flight speed multiplier. */
    animSpeed: 1,
  }),
})

export const CONFIG: { play: PlayConfig } = { play: { ...DEFAULT_CONFIG.play } }
