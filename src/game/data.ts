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

export type TargetId = 'tripsina' | 'tripsina_facil' | 'trombina' | 'beta2'

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
  beta2: {
    id: 'beta2', name: 'Receptor β2', short: 'receptor β2', pdb: '2RH1', color: 0x8fc8ff,
    role: 'Receptor na parede da célula. Ligado, manda a célula do pulmão relaxar.',
    cavities: [{ size: 1, chem: 'neg' }, { size: 3, chem: 'oil' }, { size: 2, chem: 'polar' }],
    anchor: 0, switchCavity: 2, effect: 'Recado enviado', word: 'Ligou!', sideTilt: 58,
  },
}

export type LevelKind = 'tutorial' | 'block' | 'activate' | 'selective' | 'lab'

export type LevelDef = {
  id: number
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
}

export const LEVELS: LevelDef[] = [
  {
    id: 0, kind: 'tutorial', title: 'Tutorial · Como jogar',
    intro: 'Aprenda a pegar, girar e encaixar uma molécula no bolso de uma proteína de verdade.',
    goal: 'Siga os passos abaixo.',
    targets: ['tripsina'], tray: ['faisca', 'cometa'], natural: 'substrato',
    learned: 'Pronto, você já sabe jogar! A molécula certa ocupou o bolso e a molécula natural não conseguiu entrar: a enzima ficou travada. É assim que muitos remédios funcionam. Agora tente as fases.',
  },
  {
    id: 1, kind: 'block', title: 'Fase 1 · A chave certa',
    intro: 'A tripsina é uma enzima de verdade: ela corta proteínas. Uma molécula pode entrar no bolso dela e travá-la, como uma chave errada presa na fechadura.',
    goal: 'Teste as moléculas no bolso da tripsina e descubra qual trava a enzima de vez.',
    targets: ['tripsina_facil'], tray: ['gota', 'gigante', 'folha', 'grao', 'nuvem'], natural: 'alimento',
    learned: 'Para encaixar, a molécula precisa ter o TAMANHO e a QUÍMICA certos para o bolso: parte oleosa no buraco oleoso e parte que gosta de água no buraco que gosta de água. A Folha encaixou direitinho e travou a enzima!',
  },
  {
    id: 2, kind: 'block', title: 'Fase 2 · Ligar ou bloquear?',
    intro: 'O receptor β2 atravessa a membrana da célula. O bolso fica do lado de FORA. Quando o mensageiro natural encaixa e aperta o "interruptor" (anel tracejado), um recado passa para DENTRO da célula.',
    goal: 'Encontre a molécula que ocupa o receptor SEM apertar o interruptor, para o recado parar.',
    targets: ['beta2'], tray: ['gota', 'raio', 'cometa', 'pluma', 'escudo'], natural: 'mensageiro',
    learned: 'Moléculas que encaixam e LIGAM o receptor se chamam agonistas. As que encaixam e só BLOQUEIAM se chamam antagonistas. As duas encaixam, mas fazem coisas opostas! A Escudo tem a ponta que gosta de água curtinha demais: não alcança o interruptor.',
  },
  {
    id: 3, kind: 'selective', title: 'Fase 3 · A molécula que escolhe',
    intro: 'Trombina e tripsina são enzimas "primas": os bolsos são parecidos. Queremos travar a trombina (coagulação) sem atrapalhar a tripsina (digestão).',
    goal: 'Trave a TROMBINA e deixe a TRIPSINA livre. A molécula testa as duas ao mesmo tempo.',
    targets: ['tripsina', 'trombina'], tray: ['faisca', 'cometa', 'gigante', 'trevo'], blockTarget: 'trombina',
    learned: 'Moléculas SELETIVAS encaixam bem só no alvo certo. A Trevo tem uma parte média oleosa que cabe no bolsinho da trombina, mas é grande demais para o da tripsina. Menos efeitos indesejados!',
  },
  {
    id: 4, kind: 'lab', title: 'Laboratório livre',
    intro: 'Agora você é cientista! Escolha uma proteína e teste qualquer molécula.',
    goal: 'Escolha o alvo nos botões e teste todas as moléculas. O caderno anota os resultados.',
    targets: ['tripsina'], tray: ['cometa', 'trevo', 'escudo', 'raio', 'pluma', 'gota', 'gigante', 'faisca', 'substrato', 'mensageiro'],
    learned: '',
  },
]

export const CHEM_LABEL: Record<Chem, string> = {
  pos: 'carga +', neg: 'carga −', oil: 'oleosa', polar: 'gosta de água',
}
export const SIZE_LABEL = ['vazia', 'pequena', 'média', 'grande'] as const
export const CHEM_COLOR: Record<Chem | 'none', number> = {
  pos: 0x3b82ff, neg: 0xff4a4a, oil: 0xffd23f, polar: 0x2fd49a, none: 0xeeeeee,
}
