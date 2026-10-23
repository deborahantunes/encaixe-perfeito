/**
 * Didactic model of ligands and real protein targets.
 *
 * IMPORTANT: every molecule here is FICTIONAL (invented names and shapes), on purpose, so the game never
 * suggests that a real medicine does something. The proteins are real structures from the Protein Data Bank;
 * their pockets are simplified into 3 cavities that mirror real features (e.g. the negative Asp189 at the
 * bottom of the trypsin/thrombin S1 pocket, Asp113 and the TM5 serines of the β2 receptor).
 *
 * Size: 1 = pequeno, 2 = médio, 3 = grande. Chemistry: pos (+), neg (−), oil (oleosa), polar (gosta de água).
 */
export type Chem = 'pos' | 'neg' | 'oil' | 'polar'
export type Group = { size: 0 | 1 | 2 | 3; chem: Chem | 'none' }
export type Cavity = { size: 1 | 2 | 3; chem: Chem }

export type MoleculeId =
  | 'substrato' | 'mensageiro'
  | 'cometa' | 'trevo' | 'escudo' | 'raio' | 'gota' | 'gigante' | 'faisca' | 'pluma'
  | 'alimento' | 'folha' | 'grao' | 'nuvem' | 'raio2'
  | 'fibrinogenio' | 'laco' | 'seta'

export type TargetId = 'tripsina' | 'tripsina_facil' | 'trombina' | 'trombina_facil' | 'beta2'

export type MoleculeDef = {
  id: MoleculeId
  name: string
  /** Short, everyday description. */
  about: string
  groups: [Group, Group, Group]
  /** Core ring tint (identity color, no chemical meaning). */
  tint: number
  /** Molecule made by the body itself (arrives on its own during block levels). */
  natural?: boolean
  /** Natural substrate of an enzyme: when it binds, the enzyme works on it. */
  substrate?: boolean
}

export type TargetDef = {
  id: TargetId
  name: string
  short: string
  /** Real structure used for the 3D surface. */
  pdb: string
  /** What the protein does in the body. */
  role: string
  cavities: [Cavity, Cavity, Cavity]
  /** Charged "anchor" cavity: needs the opposite charge, otherwise the molecule slips out (-1 = no anchor). */
  anchor: number
  /** Receptor on/off switch: touching it exactly (size + chemistry) activates the protein. -1 for enzymes. */
  switchCavity: number
  color: number
  /** Short label of what happens when the protein is working. */
  effect: string
  /** Popup word when it works. */
  word: string
  /** Side view (membrane receptors): tilt of the pocket axis above the horizontal, in degrees. */
  sideTilt?: number
}

const g = (size: Group['size'], chem: Group['chem']): Group => ({ size, chem })
const NONE = g(0, 'none')

export const MOLECULES: Record<MoleculeId, MoleculeDef> = {
  substrato: {
    id: 'substrato', name: 'Proteína do alimento', natural: true, substrate: true, tint: 0xffd6a5,
    about: 'Pedaço natural de proteína que a enzima corta. É o "trabalho" normal da enzima.',
    groups: [g(2, 'pos'), g(2, 'oil'), g(1, 'polar')],
  },
  mensageiro: {
    id: 'mensageiro', name: 'Mensageiro natural', natural: true, tint: 0xffc2d6,
    about: 'Molécula que o próprio corpo fabrica para "ligar" o receptor e mandar um recado para a célula.',
    groups: [g(1, 'pos'), g(2, 'oil'), g(2, 'polar')],
  },
  cometa: {
    id: 'cometa', name: 'Molécula Cometa', tint: 0xffe1a8,
    about: 'Molécula inventada: ponta positiva, parte oleosa grande e uma pontinha que gosta de água.',
    groups: [g(2, 'pos'), g(3, 'oil'), g(1, 'polar')],
  },
  trevo: {
    id: 'trevo', name: 'Molécula Trevo', tint: 0xb9f5c9,
    about: 'Molécula inventada com DUAS partes oleosas: uma grande e uma média.',
    groups: [g(2, 'pos'), g(3, 'oil'), g(2, 'oil')],
  },
  escudo: {
    id: 'escudo', name: 'Molécula Escudo', tint: 0xa8d8ff,
    about: 'Molécula inventada parecida com a Raio, mas com a parte que gosta de água bem curtinha.',
    groups: [g(1, 'pos'), g(3, 'oil'), g(1, 'polar')],
  },
  raio: {
    id: 'raio', name: 'Molécula Raio', tint: 0xfff3a0,
    about: 'Molécula inventada parecida com o mensageiro natural, mas com uma parte oleosa maior.',
    groups: [g(1, 'pos'), g(3, 'oil'), g(2, 'polar')],
  },
  // Stage 2 version of Raio: NEGATIVE tip (red), so children tell it apart from Escudo at a glance
  // (it is pushed away by the receptor's negative anchor). The original Raio stays in the lab and challenges.
  raio2: {
    id: 'raio2', name: 'Molécula Raio', tint: 0xfff3a0,
    about: 'Molécula inventada parecida com a Escudo, mas com a ponta NEGATIVA (−).',
    groups: [g(1, 'neg'), g(3, 'oil'), g(2, 'polar')],
  },
  gota: {
    id: 'gota', name: 'Molécula Gota', tint: 0xc8f7ff,
    about: 'Molécula inventada que só gosta de água. Não tem nenhuma carga.',
    groups: [g(2, 'polar'), g(2, 'polar'), g(1, 'polar')],
  },
  gigante: {
    id: 'gigante', name: 'Molécula Gigante', tint: 0xf3e9d2,
    about: 'Molécula inventada enorme. Será que cabe em algum lugar?',
    groups: [g(3, 'polar'), g(3, 'polar'), g(3, 'oil')],
  },
  faisca: {
    id: 'faisca', name: 'Molécula Faísca', tint: 0xffc9b0,
    about: 'Molécula inventada com uma ponta NEGATIVA (−).',
    groups: [g(2, 'neg'), g(2, 'oil'), g(1, 'polar')],
  },
  // Stage 1 (young players): no charges at all, only oil / water and sizes.
  alimento: {
    id: 'alimento', name: 'Proteína do alimento', natural: true, substrate: true, tint: 0xffd6a5,
    about: 'Pedaço natural de proteína que a enzima corta. É o "trabalho" normal da enzima.',
    groups: [g(2, 'polar'), g(2, 'oil'), g(1, 'polar')],
  },
  folha: {
    id: 'folha', name: 'Molécula Folha', tint: 0xc6f5a8,
    about: 'Molécula inventada com uma parte oleosa grande entre duas partes médias que gostam de água.',
    groups: [g(2, 'polar'), g(3, 'oil'), g(2, 'polar')],
  },
  grao: {
    id: 'grao', name: 'Molécula Grão', tint: 0xffe9b8,
    about: 'Molécula inventada bem pequena e oleosa.',
    groups: [g(1, 'oil'), g(1, 'oil'), NONE],
  },
  nuvem: {
    id: 'nuvem', name: 'Molécula Nuvem', tint: 0xdfe6ff,
    about: 'Molécula inventada que é toda oleosa: não tem nenhuma parte que gosta de água.',
    groups: [g(2, 'oil'), g(3, 'oil'), g(2, 'oil')],
  },
  // Easy Stage 3 (thrombin without charges): natural substrate and the right answer.
  fibrinogenio: {
    id: 'fibrinogenio', name: 'Fibrinogênio', natural: true, substrate: true, tint: 0xffd6a5,
    about: 'Proteína natural do sangue. A trombina corta o fibrinogênio para formar o coágulo.',
    groups: [g(2, 'polar'), g(3, 'oil'), g(1, 'oil')],
  },
  laco: {
    id: 'laco', name: 'Molécula Laço', tint: 0xffc6e0,
    about: 'Molécula inventada com DUAS partes oleosas (uma grande e uma média) e uma parte que gosta de água.',
    groups: [g(2, 'polar'), g(3, 'oil'), g(2, 'oil')],
  },
  // Expert decoy: binds strongly to both enzymes, but never as well as the best answer.
  seta: {
    id: 'seta', name: 'Molécula Seta', tint: 0xd7f0a8,
    about: 'Molécula inventada: ponta positiva, parte oleosa grande e uma pontinha oleosa.',
    groups: [g(2, 'pos'), g(3, 'oil'), g(1, 'oil')],
  },
  pluma: {
    id: 'pluma', name: 'Molécula Pluma', tint: 0xe6c8ff,
    about: 'Molécula inventada bem pequena e leve.',
    groups: [g(1, 'pos'), g(1, 'polar'), NONE],
  },
}

export const TARGETS: Record<TargetId, TargetDef> = {
  tripsina: {
    id: 'tripsina', name: 'Tripsina', short: 'tripsina', pdb: '1BJU', color: 0xb9a8ff,
    role: 'Enzima da digestão: corta as proteínas dos alimentos.',
    cavities: [{ size: 2, chem: 'neg' }, { size: 3, chem: 'oil' }, { size: 1, chem: 'polar' }],
    anchor: 0, switchCavity: -1, effect: 'Cortando proteínas', word: 'Cortou!',
  },
  tripsina_facil: {
    id: 'tripsina_facil', name: 'Tripsina', short: 'tripsina', pdb: '1BJU', color: 0xb9a8ff,
    role: 'Enzima da digestão: corta as proteínas dos alimentos.',
    cavities: [{ size: 2, chem: 'polar' }, { size: 3, chem: 'oil' }, { size: 2, chem: 'polar' }],
    anchor: -1, switchCavity: -1, effect: 'Cortando proteínas', word: 'Cortou!',
  },
  trombina: {
    id: 'trombina', name: 'Trombina', short: 'trombina', pdb: '1PPB', color: 0xffb08f,
    role: 'Enzima da coagulação: ajuda a formar coágulos no sangue.',
    cavities: [{ size: 2, chem: 'neg' }, { size: 3, chem: 'oil' }, { size: 2, chem: 'oil' }],
    anchor: 0, switchCavity: -1, effect: 'Formando coágulo', word: 'Coágulo!',
  },
  trombina_facil: {
    id: 'trombina_facil', name: 'Trombina', short: 'trombina', pdb: '1PPB', color: 0xffb08f,
    role: 'Enzima da coagulação: ajuda a formar coágulos no sangue.',
    cavities: [{ size: 2, chem: 'polar' }, { size: 3, chem: 'oil' }, { size: 2, chem: 'oil' }],
    anchor: -1, switchCavity: -1, effect: 'Formando coágulo', word: 'Coágulo!',
  },
  beta2: {
    id: 'beta2', name: 'Receptor β2', short: 'receptor β2', pdb: '2RH1', color: 0x8fc8ff,
    role: 'Receptor na parede da célula. Ligado, manda a célula do pulmão relaxar.',
    cavities: [{ size: 1, chem: 'neg' }, { size: 3, chem: 'oil' }, { size: 2, chem: 'polar' }],
    anchor: 0, switchCavity: 2, effect: 'Recado enviado', word: 'Ligou!', sideTilt: 40,
  },
}

export type LevelKind = 'block' | 'activate' | 'best' | 'selective' | 'lab'

/** Difficulty: Fácil (children: shape + oil/water, turning is enough), Padrão (charges, turn AND flip), Especialista. */
export type Tier = 'facil' | 'padrao' | 'especialista'
export const TIERS: Tier[] = ['facil', 'padrao', 'especialista']
export const TIER_NAME: Record<Tier, string> = { facil: 'Fácil', padrao: 'Padrão', especialista: 'Especialista' }
export const TIER_ABOUT: Record<Tier, string> = {
  facil: 'Para crianças: só formato, óleo e água. Basta girar a molécula.',
  padrao: 'Cargas + e −, interruptor do receptor e seletividade. É preciso girar e virar.',
  especialista: 'Para quem conhece docking: mais moléculas parecidas, nota do encaixe e nenhuma ajuda.',
}

export type LevelDef = {
  /** Stable id (saved progress, analytics, group-challenge protocol). */
  id: number
  tier: Tier | 'lab'
  title: string
  intro: string
  goal: string
  kind: LevelKind
  targets: TargetId[]
  tray: MoleculeId[]
  /** Natural molecule of the target: arrives once to test a blocker, or on demand. */
  natural?: MoleculeId
  /** Selective levels: the protein that must be blocked; every other one must stay free. */
  blockTarget?: TargetId
  learned: string
  /** Turn-only docking: flipping the molecule over is never needed (hands-only play with children). */
  turnOnly?: boolean
  /** Time limit of this stage in the group challenge (s). */
  seconds: number
}

export const LEVELS: LevelDef[] = [
  // ------------------------------------------------------------------ Fácil (children)
  {
    id: 1, tier: 'facil', kind: 'block', title: 'Fase 1 · A chave certa', seconds: 90,
    intro: 'A tripsina é uma enzima de verdade: ela corta proteínas. Uma molécula pode entrar no bolso dela e travá-la, como uma chave errada presa na fechadura.',
    goal: 'Teste as moléculas no bolso da tripsina e descubra qual trava a enzima de vez.',
    targets: ['tripsina_facil'], tray: ['gota', 'gigante', 'folha', 'grao', 'nuvem'], natural: 'alimento', turnOnly: true,
    learned: 'Para encaixar, a molécula precisa ter o TAMANHO e a QUÍMICA certos para o bolso: parte oleosa no buraco oleoso e parte que gosta de água no buraco que gosta de água. A Folha encaixou direitinho e travou a enzima!',
  },
  {
    id: 2, tier: 'facil', kind: 'block', title: 'Fase 2 · Ligar ou bloquear?', seconds: 90,
    intro: 'O receptor β2 atravessa a membrana da célula. O bolso fica do lado de FORA. Quando o mensageiro natural encaixa e aperta o "interruptor" (anel tracejado), um recado passa para DENTRO da célula.',
    goal: 'Encontre a molécula que ocupa o receptor SEM apertar o interruptor, para o recado parar.',
    targets: ['beta2'], tray: ['gota', 'raio2', 'cometa', 'pluma', 'escudo'], natural: 'mensageiro', turnOnly: true,
    learned: 'Moléculas que encaixam e LIGAM o receptor se chamam agonistas. As que encaixam e só BLOQUEIAM se chamam antagonistas. As duas encaixam, mas fazem coisas opostas! A Escudo tem a ponta que gosta de água curtinha demais: não alcança o interruptor.',
  },
  {
    id: 3, tier: 'facil', kind: 'block', title: 'Fase 3 · Trave a trombina', seconds: 90,
    intro: 'A trombina é a enzima que ajuda o sangue a coagular: ela corta o fibrinogênio. O bolso dela tem DOIS buracos oleosos.',
    goal: 'Encontre a molécula que trava a trombina.',
    targets: ['trombina_facil'], tray: ['gota', 'folha', 'laco', 'gigante', 'grao'], natural: 'fibrinogenio', turnOnly: true,
    learned: 'Cada proteína tem um bolso diferente. A Laço tem duas partes oleosas, do tamanho certo para os dois buracos oleosos da trombina. A Folha só tem uma: encaixou fraco.',
  },
  // ------------------------------------------------------------------ Padrão
  {
    id: 11, tier: 'padrao', kind: 'block', title: 'Fase 1 · Trave a tripsina', seconds: 90,
    intro: 'A tripsina corta proteínas. No fundo do bolso dela há uma âncora com carga NEGATIVA (−): só gruda quem tiver uma ponta positiva (+).',
    goal: 'Encaixe FORTE no bolso da tripsina para travar a enzima.',
    targets: ['tripsina'], tray: ['gota', 'faisca', 'cometa', 'pluma', 'gigante'], natural: 'substrato',
    learned: 'A Cometa tem ponta positiva para a âncora negativa, parte oleosa grande e uma pontinha que gosta de água. Muitos remédios travam enzimas assim: ocupam o bolso e a molécula natural não entra.',
  },
  {
    id: 12, tier: 'padrao', kind: 'block', title: 'Fase 2 · Bloqueie o receptor', seconds: 90,
    intro: 'O receptor β2 manda um recado para dentro da célula quando o interruptor (anel tracejado) é apertado.',
    goal: 'Ocupe o receptor β2 SEM apertar o interruptor.',
    targets: ['beta2'], tray: ['raio', 'gota', 'escudo', 'cometa', 'pluma'], natural: 'mensageiro',
    learned: 'A Escudo encaixa, mas a ponta que gosta de água é curta demais para apertar o interruptor: é um antagonista (bloqueador).',
  },
  {
    id: 13, tier: 'padrao', kind: 'activate', title: 'Fase 3 · Ligue o receptor', seconds: 90,
    intro: 'Agora é o contrário: queremos que o receptor β2 mande o recado, como faz o mensageiro natural.',
    goal: 'Encaixe FORTE e aperte o interruptor do receptor β2.',
    targets: ['beta2'], tray: ['escudo', 'pluma', 'raio', 'faisca', 'gota'], natural: 'mensageiro',
    learned: 'A Raio encaixa e aperta o interruptor: é um agonista, faz o mesmo que o mensageiro natural.',
  },
  {
    id: 14, tier: 'padrao', kind: 'block', title: 'Fase 4 · Trave a trombina', seconds: 90,
    intro: 'A trombina ajuda o sangue a coagular. O bolso dela parece com o da tripsina, mas tem DOIS buracos oleosos.',
    goal: 'Encaixe FORTE no bolso da trombina.',
    targets: ['trombina'], tray: ['cometa', 'gota', 'trevo', 'faisca', 'pluma'], natural: 'substrato',
    learned: 'A Trevo tem duas partes oleosas, uma grande e uma média: combina com os dois buracos oleosos da trombina.',
  },
  {
    id: 15, tier: 'padrao', kind: 'selective', title: 'Fase 5 · A molécula que escolhe', seconds: 100,
    intro: 'Trombina e tripsina são enzimas "primas": os bolsos são parecidos. Queremos travar a trombina (coagulação) sem atrapalhar a tripsina (digestão).',
    goal: 'Trave a TROMBINA e deixe a TRIPSINA livre. A molécula testa as duas ao mesmo tempo.',
    targets: ['tripsina', 'trombina'], tray: ['faisca', 'cometa', 'gigante', 'trevo'], blockTarget: 'trombina',
    learned: 'Moléculas SELETIVAS encaixam bem só no alvo certo. A Trevo tem uma parte média oleosa que cabe no bolsinho da trombina, mas é grande demais para o da tripsina. Menos efeitos indesejados!',
  },
  // ------------------------------------------------------------------ Especialista
  {
    id: 21, tier: 'especialista', kind: 'best', title: 'Fase 1 · O melhor encaixe', seconds: 120,
    intro: 'Várias moléculas encaixam forte na tripsina. Num projeto de fármaco, escolhemos a de MAIOR afinidade. Aqui cada encaixe recebe uma nota de 0 a 100.',
    goal: 'Encontre a molécula com a MAIOR nota de encaixe na tripsina.',
    targets: ['tripsina'], tray: ['escudo', 'seta', 'cometa', 'raio', 'gota', 'trevo'],
    learned: 'Escudo, Seta e Cometa encaixam forte, mas só a Cometa preenche os três buracos com o tamanho e a química exatos (nota 100). É o mesmo raciocínio de ordenar moléculas por pontuação num docking virtual.',
  },
  {
    id: 22, tier: 'especialista', kind: 'activate', title: 'Fase 2 · Agonista entre impostores', seconds: 120,
    intro: 'Seis moléculas parecidas. Várias escorregam, uma encaixa mas só bloqueia. Apenas uma LIGA o receptor β2.',
    goal: 'Encontre o agonista: encaixe forte que aperta o interruptor do β2.',
    targets: ['beta2'], tray: ['escudo', 'cometa', 'raio', 'faisca', 'pluma', 'gota'],
    learned: 'O interruptor só é apertado quando a parte que gosta de água tem o tamanho EXATO do buraco. A Escudo encaixa tão bem quanto, mas sem ativar: antagonista.',
  },
  {
    id: 23, tier: 'especialista', kind: 'best', title: 'Fase 3 · O melhor na trombina', seconds: 120,
    intro: 'Na trombina, mais de uma molécula encaixa forte. Compare as notas de encaixe.',
    goal: 'Encontre a molécula com a MAIOR nota de encaixe na trombina.',
    targets: ['trombina'], tray: ['cometa', 'seta', 'trevo', 'escudo', 'nuvem', 'gigante'],
    learned: 'A Seta encaixa forte, mas a pontinha oleosa sobra no buraco médio. A Trevo preenche os dois buracos oleosos por inteiro: nota 100.',
  },
  {
    id: 24, tier: 'especialista', kind: 'selective', title: 'Fase 4 · Seletividade fina', seconds: 120,
    intro: 'Agora várias moléculas grudam nas DUAS enzimas. Pense no buraco que é diferente entre elas.',
    goal: 'Trave a TROMBINA e deixe a TRIPSINA totalmente livre.',
    targets: ['tripsina', 'trombina'], tray: ['cometa', 'seta', 'trevo', 'escudo', 'faisca', 'gigante'], blockTarget: 'trombina',
    learned: 'Cometa, Seta e Escudo cabem no buraco pequeno da tripsina: grudam nas duas enzimas. Só a Trevo, com a parte média oleosa, é grande demais para a tripsina. Seletividade vem de explorar a diferença entre os bolsos.',
  },
  // ------------------------------------------------------------------ free lab bench
  {
    id: 90, tier: 'lab', kind: 'lab', title: 'Bancada livre', seconds: 0,
    intro: 'Agora você é cientista! Escolha uma proteína e teste qualquer molécula.',
    goal: 'Escolha o alvo nos botões e teste todas as moléculas. O caderno anota os resultados.',
    targets: ['tripsina'], tray: ['cometa', 'trevo', 'escudo', 'raio', 'pluma', 'gota', 'gigante', 'faisca', 'substrato', 'mensageiro'],
    learned: '',
  },
]

export const LEVEL_BY_ID = new Map(LEVELS.map(l => [l.id, l]))
export const LAB_LEVEL = LEVELS.find(l => l.kind === 'lab')!

/** The stages of one difficulty, in play order. */
export function stagesOf(tier: Tier): LevelDef[] {
  return LEVELS.filter(l => l.tier === tier)
}

export const CHEM_LABEL: Record<Chem, string> = {
  pos: 'carga +', neg: 'carga −', oil: 'oleosa', polar: 'gosta de água',
}
export const SIZE_LABEL = ['vazia', 'pequena', 'média', 'grande'] as const
export const CHEM_COLOR: Record<Chem | 'none', number> = {
  pos: 0x3b82ff, neg: 0xff4a4a, oil: 0xffd23f, polar: 0x2fd49a, none: 0xeeeeee,
}
