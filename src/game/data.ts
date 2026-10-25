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
  | 'alimento' | 'folha' | 'grao' | 'nuvem'
  | 'fibrinogenio' | 'laco' | 'mensageiro_f' | 'raio_f' | 'escudo_f'
  // Expert stages: 4 arms (protease sub-pockets S1-S4) and 5 arms (β2 receptor contact points).
  | 'estrela' | 'cruz' | 'helice' | 'tranca' | 'garra' | 'polvo' | 'ponte'
  | 'farol' | 'coroa' | 'flor' | 'leque' | 'martelo' | 'sombra'

export type TargetId = 'tripsina' | 'tripsina_facil' | 'trombina' | 'trombina_facil' | 'beta2' | 'beta2_facil'
  | 'tripsina_exp' | 'trombina_exp' | 'beta2_exp'

export type MoleculeDef = {
  id: MoleculeId
  name: string
  /** Short, everyday description. */
  about: string
  /** 3 arms (classic), 4 or 5 (expert stages); the pocket of the target must have the same number of wells. */
  groups: Group[]
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
  cavities: Cavity[]
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
  // Easy Stage 2 (β2 receptor without charges): only size and oil/water decide.
  mensageiro_f: {
    id: 'mensageiro_f', name: 'Mensageiro natural', natural: true, tint: 0xffc2d6,
    about: 'Molécula que o próprio corpo fabrica para "ligar" o receptor e mandar um recado para a célula.',
    groups: [g(1, 'polar'), g(2, 'oil'), g(2, 'polar')],
  },
  raio_f: {
    id: 'raio_f', name: 'Molécula Raio', tint: 0xfff3a0,
    about: 'Molécula inventada parecida com o mensageiro natural, mas com uma parte oleosa maior.',
    groups: [g(1, 'polar'), g(3, 'oil'), g(2, 'polar')],
  },
  escudo_f: {
    id: 'escudo_f', name: 'Molécula Escudo', tint: 0xa8d8ff,
    about: 'Molécula inventada parecida com a Raio, mas com a ponta que gosta de água bem curtinha.',
    groups: [g(1, 'polar'), g(3, 'oil'), g(1, 'polar')],
  },
  // Expert, 4 arms (S1 + S2 + S3 + S4 sub-pockets of trypsin / thrombin).
  estrela: {
    id: 'estrela', name: 'Molécula Estrela', tint: 0xfff0b3,
    about: 'Molécula inventada de 4 pontas: positiva média, oleosa média, média que gosta de água e oleosa média.',
    groups: [g(2, 'pos'), g(2, 'oil'), g(2, 'polar'), g(2, 'oil')],
  },
  cruz: {
    id: 'cruz', name: 'Molécula Cruz', tint: 0xd4f0ff,
    about: 'Molécula inventada de 4 pontas, igual à Estrela mas com a ponta que gosta de água pequena.',
    groups: [g(2, 'pos'), g(2, 'oil'), g(1, 'polar'), g(2, 'oil')],
  },
  helice: {
    id: 'helice', name: 'Molécula Hélice', tint: 0xe8d4ff,
    about: 'Molécula inventada de 4 pontas, igual à Estrela mas com a ponta positiva pequena.',
    groups: [g(1, 'pos'), g(2, 'oil'), g(2, 'polar'), g(2, 'oil')],
  },
  tranca: {
    id: 'tranca', name: 'Molécula Trança', tint: 0xffd9c2,
    about: 'Molécula inventada com as MESMAS pontas da Estrela, mas em outra ordem ao redor do anel.',
    groups: [g(2, 'pos'), g(2, 'oil'), g(2, 'oil'), g(2, 'polar')],
  },
  garra: {
    id: 'garra', name: 'Molécula Garra', tint: 0xffc4c4,
    about: 'Molécula inventada de 4 pontas com a ponta principal NEGATIVA (−).',
    groups: [g(2, 'neg'), g(2, 'oil'), g(2, 'polar'), g(2, 'oil')],
  },
  polvo: {
    id: 'polvo', name: 'Molécula Polvo', tint: 0xc9f2d9,
    about: 'Molécula inventada de 4 pontas: positiva média, oleosa PEQUENA, média que gosta de água e oleosa GRANDE.',
    groups: [g(2, 'pos'), g(1, 'oil'), g(2, 'polar'), g(3, 'oil')],
  },
  ponte: {
    id: 'ponte', name: 'Molécula Ponte', tint: 0xf2e2c9,
    about: 'Molécula inventada parecida com a Polvo, mas com a última ponta oleosa média.',
    groups: [g(2, 'pos'), g(1, 'oil'), g(2, 'polar'), g(2, 'oil')],
  },
  // Expert, 5 arms (β2 receptor: Asp113 anchor, aromatic cluster, Ser203/207 switch, hydrophobic and polar contacts).
  farol: {
    id: 'farol', name: 'Molécula Farol', tint: 0xfff3a0,
    about: 'Molécula inventada de 5 pontas com uma ponta média que gosta de água, do tamanho exato do interruptor.',
    groups: [g(1, 'pos'), g(3, 'oil'), g(2, 'polar'), g(2, 'oil'), g(1, 'polar')],
  },
  coroa: {
    id: 'coroa', name: 'Molécula Coroa', tint: 0xa8d8ff,
    about: 'Molécula inventada de 5 pontas, parecida com a Farol, mas com a ponta do meio que gosta de água PEQUENA.',
    groups: [g(1, 'pos'), g(3, 'oil'), g(1, 'polar'), g(2, 'oil'), g(1, 'polar')],
  },
  flor: {
    id: 'flor', name: 'Molécula Flor', tint: 0xffd1ec,
    about: 'Molécula inventada de 5 pontas, parecida com a Farol, mas com uma ponta oleosa pequena.',
    groups: [g(1, 'pos'), g(3, 'oil'), g(2, 'polar'), g(1, 'oil'), g(1, 'polar')],
  },
  leque: {
    id: 'leque', name: 'Molécula Leque', tint: 0xd9f7c4,
    about: 'Molécula inventada com as mesmas pontas da Farol, mas em outra ordem ao redor do anel.',
    groups: [g(1, 'pos'), g(3, 'oil'), g(2, 'oil'), g(2, 'polar'), g(1, 'polar')],
  },
  martelo: {
    id: 'martelo', name: 'Molécula Martelo', tint: 0xe4e0ff,
    about: 'Molécula inventada de 5 pontas com a ponta positiva MÉDIA.',
    groups: [g(2, 'pos'), g(3, 'oil'), g(1, 'polar'), g(2, 'oil'), g(1, 'polar')],
  },
  sombra: {
    id: 'sombra', name: 'Molécula Sombra', tint: 0xcfd6e6,
    about: 'Molécula inventada de 5 pontas sem nenhuma carga.',
    groups: [g(1, 'polar'), g(3, 'oil'), g(1, 'polar'), g(2, 'oil'), g(1, 'polar')],
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
  beta2_facil: {
    id: 'beta2_facil', name: 'Receptor β2', short: 'receptor β2', pdb: '2RH1', color: 0x8fc8ff,
    role: 'Receptor na parede da célula. Ligado, manda a célula do pulmão relaxar.',
    cavities: [{ size: 1, chem: 'polar' }, { size: 3, chem: 'oil' }, { size: 2, chem: 'polar' }],
    anchor: -1, switchCavity: 2, effect: 'Recado enviado', word: 'Ligou!', sideTilt: 40,
  },
  // Expert pockets: the sub-sites around the real ligands. Trypsin and thrombin share S1 (Asp189) and S3; thrombin's
  // S2 is small (closed by the 60-loop) and its S4 "aryl-binding site" is large and oily.
  tripsina_exp: {
    id: 'tripsina_exp', name: 'Tripsina', short: 'tripsina', pdb: '1BJU', color: 0xb9a8ff,
    role: 'Enzima da digestão: corta as proteínas dos alimentos.',
    cavities: [{ size: 2, chem: 'neg' }, { size: 2, chem: 'oil' }, { size: 2, chem: 'polar' }, { size: 2, chem: 'oil' }],
    anchor: 0, switchCavity: -1, effect: 'Cortando proteínas', word: 'Cortou!',
  },
  trombina_exp: {
    id: 'trombina_exp', name: 'Trombina', short: 'trombina', pdb: '1PPB', color: 0xffb08f,
    role: 'Enzima da coagulação: ajuda a formar coágulos no sangue.',
    cavities: [{ size: 2, chem: 'neg' }, { size: 1, chem: 'oil' }, { size: 2, chem: 'polar' }, { size: 3, chem: 'oil' }],
    anchor: 0, switchCavity: -1, effect: 'Formando coágulo', word: 'Coágulo!',
  },
  beta2_exp: {
    id: 'beta2_exp', name: 'Receptor β2', short: 'receptor β2', pdb: '2RH1', color: 0x8fc8ff,
    role: 'Receptor na parede da célula. Ligado, manda a célula do pulmão relaxar.',
    cavities: [{ size: 1, chem: 'neg' }, { size: 3, chem: 'oil' }, { size: 2, chem: 'polar' }, { size: 2, chem: 'oil' }, { size: 1, chem: 'polar' }],
    anchor: 0, switchCavity: 2, effect: 'Recado enviado', word: 'Ligou!', sideTilt: 40,
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
  especialista: 'Para quem conhece docking: bolsos com 4 e 5 pontos de contato, nota do encaixe e nenhuma ajuda.',
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
    targets: ['beta2_facil'], tray: ['gota', 'raio_f', 'folha', 'grao', 'escudo_f'], natural: 'mensageiro_f', turnOnly: true,
    learned: 'Moléculas que encaixam e LIGAM o receptor se chamam agonistas (a Raio). As que encaixam e só BLOQUEIAM se chamam antagonistas (a Escudo). As duas encaixam, mas fazem coisas opostas! A Escudo tem a ponta que gosta de água curtinha demais: não alcança o interruptor.',
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
    id: 13, tier: 'padrao', kind: 'selective', title: 'Fase 3 · A molécula que escolhe', seconds: 100,
    intro: 'Trombina e tripsina são enzimas "primas": os bolsos são parecidos. Queremos travar a trombina (coagulação) sem atrapalhar a tripsina (digestão).',
    goal: 'Trave a TROMBINA e deixe a TRIPSINA livre. A molécula testa as duas ao mesmo tempo.',
    targets: ['tripsina', 'trombina'], tray: ['faisca', 'cometa', 'gigante', 'trevo'], blockTarget: 'trombina',
    learned: 'Moléculas SELETIVAS encaixam bem só no alvo certo. A Trevo tem uma parte média oleosa que cabe no bolsinho da trombina, mas é grande demais para o da tripsina. Menos efeitos indesejados!',
  },
  // ------------------------------------------------------------------ Especialista (4 and 5 contact points)
  {
    id: 21, tier: 'especialista', kind: 'best', title: 'Fase 1 · Quatro sub-bolsos', seconds: 150,
    intro: 'Remédios de verdade tocam vários sub-bolsos da enzima ao mesmo tempo. Aqui o bolso da tripsina tem QUATRO (S1 a S4) e as moléculas têm quatro pontas. Várias encaixam forte: cada encaixe ganha uma nota de 0 a 100.',
    goal: 'Encontre a molécula com a MAIOR nota de encaixe nos quatro sub-bolsos da tripsina.',
    targets: ['tripsina_exp'], tray: ['cruz', 'tranca', 'estrela', 'garra', 'helice', 'polvo'],
    learned: 'Cruz e Hélice encaixam forte, mas sobra espaço em um sub-bolso (nota 95). A Trança tem as mesmas pontas da Estrela em outra ordem: a ORDEM ao redor do anel importa. Só a Estrela preenche os quatro sub-bolsos com tamanho e química exatos (nota 100).',
  },
  {
    id: 22, tier: 'especialista', kind: 'block', title: 'Fase 2 · Cinco pontos no receptor', seconds: 150,
    intro: 'O bolso do receptor β2 tem CINCO pontos de contato: a âncora negativa (Asp113), um grupo oleoso grande, o interruptor (serinas da hélice 5), um ponto oleoso médio e um pequeno que gosta de água. Três moléculas encaixam forte. Só uma bloqueia.',
    goal: 'Ocupe os cinco pontos do β2 SEM apertar o interruptor.',
    targets: ['beta2_exp'], tray: ['farol', 'leque', 'coroa', 'martelo', 'flor', 'sombra'],
    learned: 'Farol e Flor encaixam e apertam o interruptor: agonistas. A Coroa encaixa nos cinco pontos, mas a ponta do meio é pequena demais para o interruptor: antagonista. Uma única ponta decide entre ligar e bloquear.',
  },
  {
    id: 23, tier: 'especialista', kind: 'selective', title: 'Fase 3 · Seletividade nos sub-bolsos', seconds: 150,
    intro: 'Tripsina e trombina têm os mesmos sub-bolsos S1 e S3. A diferença está no S2 (pequeno na trombina) e no S4 (grande e oleoso na trombina). A molécula testa as duas enzimas ao mesmo tempo.',
    goal: 'Trave a TROMBINA e deixe a TRIPSINA totalmente livre.',
    targets: ['tripsina_exp', 'trombina_exp'], tray: ['estrela', 'ponte', 'tranca', 'polvo', 'garra', 'cruz'], blockTarget: 'trombina_exp',
    learned: 'A Ponte gruda nas duas enzimas. Estrela e Cruz não cabem no S2 pequeno da trombina. A Polvo tem a ponta oleosa pequena para o S2 e a GRANDE para o S4 da trombina, que não cabe no S4 da tripsina: é seletiva. Anticoagulantes seletivos de verdade exploram diferenças como essas.',
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
