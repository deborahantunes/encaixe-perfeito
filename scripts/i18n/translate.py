"""Translate the game's Portuguese UI/data strings to English and Spanish (one structured call per language)."""
import json
import sys
from concurrent.futures import ThreadPoolExecutor

from openai import OpenAI

keys = json.load(open('/tmp/keys.json'))
client = OpenAI()

GUIDE = """You translate the texts of an educational VR game (Meta Quest 3) that shows how a medicine works:
a small molecule binds to the pocket of a real protein, like a key in a lock. Audience: everyone from children
(about 8 years old) to adults, including school visits. Keep the tone friendly, short and clear; keep emphasis
in CAPITAL LETTERS where the Portuguese uses it; keep symbols (+, −, ✓, •, ·, ⟵, β2) and punctuation style.

Rules:
- Keep placeholders like {name}, {n}, {goal}, {mol}, {target}, {job}, {part}, {hole}, {sign}, {want}, {why} EXACTLY.
- Keep HTML tags like <b>…</b> exactly.
- Invented molecule names: translate the word "Molécula" and the nickname consistently
  (EN: Comet, Clover, Shield, Bolt, Drop, Giant, Spark, Feather -> "Comet Molecule", "Spark Molecule" ...;
   ES: Cometa, Trébol, Escudo, Rayo, Gota, Gigante, Chispa, Pluma -> "Molécula Cometa", "Molécula Chispa" ...).
  When a text mentions just "a Cometa"/"a Faísca", use the translated nickname (Comet / Cometa, Spark / Chispa).
- Real protein names: tripsina -> trypsin / tripsina; trombina -> thrombin / trombina;
  "Receptor β2" -> "β2 receptor" / "Receptor β2". Keep PDB codes, Asp189, AlphaFold, Boltz-2.
- Didactic vocabulary: "bolso" = binding pocket (EN "pocket", ES "bolsillo"); "buraco" = hole (EN "hole", ES "hueco");
  "interruptor" = switch (EN "switch", ES "interruptor"); "oleosa" = oily (EN "oily", ES "aceitosa");
  "gosta de água" = water-loving (EN "likes water", ES "le gusta el agua"); "encaixe forte/fraco" = strong/weak fit
  (ES "encaje fuerte/débil"); "agonistas/antagonistas" = agonists/antagonists (ES agonistas/antagonistas);
  "RV" = VR (ES "RV"); "Realidade Mista" = Mixed Reality (ES "Realidad Mixta"); gatilho = trigger (ES "gatillo").
- Spanish: neutral Latin American Spanish suitable for Uruguay; use "tú" forms (no voseo), e.g. "Toma", "Gira", "Suelta".
- Fragments must still fit the sentence they are inserted into, e.g. "{mol} no {target}" means "{mol} in the {target}";
  size words "pequena/média/grande" describe a molecule PART (feminine), "pequeno/médio/grande" describe a HOLE.
- Do not add explanations. Return one translation per input index."""

SCHEMA = {
    'type': 'object',
    'properties': {'items': {'type': 'array', 'items': {
        'type': 'object', 'properties': {'i': {'type': 'integer'}, 'text': {'type': 'string'}},
        'required': ['i', 'text'], 'additionalProperties': False}}},
    'required': ['items'], 'additionalProperties': False,
}


def run(lang_name: str) -> dict:
    numbered = '\n'.join(f'{i}\t{json.dumps(k, ensure_ascii=False)}' for i, k in enumerate(keys))
    resp = client.chat.completions.create(
        model='gpt-5',
        messages=[{'role': 'system', 'content': GUIDE},
                  {'role': 'user', 'content': f'Translate every item from Brazilian Portuguese to {lang_name}. '
                   f'Input lines are "index<TAB>JSON string".\n\n{numbered}'}],
        response_format={'type': 'json_schema', 'json_schema': {'name': 'tr', 'strict': True, 'schema': SCHEMA}},
        max_completion_tokens=40000,
        extra_body={'reasoning': {'effort': 'low'}},
    )
    items = json.loads(resp.choices[0].message.content)['items']
    out = {keys[it['i']]: it['text'] for it in items if 0 <= it['i'] < len(keys)}
    print(lang_name, len(out), '/', len(keys), resp.usage.completion_tokens, file=sys.stderr)
    return out


with ThreadPoolExecutor(2) as ex:
    en, es = ex.map(run, ['English', 'Spanish (Latin American, suitable for Uruguay)'])
for name, table in [('en', en), ('es', es)]:
    json.dump(dict(sorted(table.items())), open(f'src/i18n/{name}.json', 'w'), ensure_ascii=False, indent=2)
