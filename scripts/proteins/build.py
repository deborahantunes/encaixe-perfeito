"""
Build game-ready molecular surfaces from real PDB structures.

    python3 scripts/proteins/build.py  (PDB files are downloaded to scripts/proteins/pdb/)

For each target:
  1. Read heavy protein atoms and the co-crystallised ligand.
  2. Define a "pocket frame": origin = ligand centroid, +Z = out of the pocket (towards the player),
     +Y = towards the charged anchor residue (projected), matching the game's 3-arm geometry.
  3. Compute a Gaussian molecular surface, carve the game's three wells exactly where the
     game's ligand arms go (so docking never clips), and colour it by residue chemistry,
     with the well walls tinted by the game's chemistry colours and baked ambient occlusion.
  4. Export public/proteins/<id>.glb (metres, pocket frame) and src/game/proteins.json.
"""
import json, math, os, urllib.request
import numpy as np
from scipy.spatial import cKDTree
from skimage import measure
import trimesh
import fast_simplification

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
OUT_GLB = os.path.join(ROOT, 'public', 'proteins')
OUT_JSON = os.path.join(ROOT, 'src', 'game', 'proteins.json')

SCALE = 0.009            # metres per Ångström in the game
ARM_R = 0.058 / SCALE    # game arm length in Å
HOLE_R = [0, 0.019, 0.027, 0.036]
CHEM_RGB = {'pos': (0.23, 0.51, 1.0), 'neg': (1.0, 0.29, 0.29), 'oil': (1.0, 0.82, 0.25), 'polar': (0.18, 0.83, 0.6)}

# Keep in sync with src/game/data.ts (checked by tests/proteins.test.ts).
TARGETS = [
    dict(id='tripsina', pdb='1BJU', chains='A', ligand='GP6', anchor=('A', 189, 'CG'),
         tint=(0.70, 0.60, 1.0), faces=60000,
         cavities=[(2, 'neg'), (3, 'oil'), (1, 'polar')]),
    dict(id='trombina', pdb='1PPB', chains='HL', ligand='0G6', anchor=('H', 189, 'CG'),
         tint=(1.0, 0.68, 0.55), faces=60000,
         cavities=[(2, 'neg'), (3, 'oil'), (2, 'oil')]),
    dict(id='beta2', pdb='2RH1', chains='A', ligand='CAU', anchor=('A', 113, 'CG'), maxres=999,
         tint=(0.52, 0.76, 1.0), faces=70000, membrane=True,
         cavities=[(1, 'neg'), (3, 'oil'), (2, 'polar')]),
]

NEG = {('ASP', 'OD1'), ('ASP', 'OD2'), ('GLU', 'OE1'), ('GLU', 'OE2')}
POS = {('LYS', 'NZ'), ('ARG', 'NE'), ('ARG', 'NH1'), ('ARG', 'NH2')}
HYDRO = {'ALA', 'VAL', 'LEU', 'ILE', 'PHE', 'TRP', 'MET', 'PRO', 'CYS', 'TYR'}
BACKBONE = {'N', 'CA', 'C', 'O'}


def arm_dir(i):
    a = math.pi / 2 + i * 2 * math.pi / 3
    return np.array([math.cos(a), math.sin(a), 0.0])


def read_pdb(t):
    path = os.path.join(HERE, 'pdb', f"{t['pdb']}.pdb")
    if not os.path.exists(path):
        os.makedirs(os.path.dirname(path), exist_ok=True)
        urllib.request.urlretrieve(f"https://files.rcsb.org/download/{t['pdb']}.pdb", path)
    atoms, lig, anchor = [], [], None
    lig_key = None
    for line in open(path):
        rec = line[:6].strip()
        if rec not in ('ATOM', 'HETATM'):
            continue
        name = line[12:16].strip(); res = line[17:20].strip(); chain = line[21]
        seq = int(line[22:26]); alt = line[16]
        el = (line[76:78].strip() or name[0]).upper()
        if el == 'H' or alt not in (' ', 'A'):
            continue
        xyz = (float(line[30:38]), float(line[38:46]), float(line[46:54]))
        if rec == 'ATOM' and chain in t['chains'] and seq <= t.get('maxres', 99999):
            atoms.append((xyz, res, name, el))
            if (chain, seq, name) == t['anchor']:
                anchor = np.array(xyz)
        elif rec == 'HETATM' and res == t['ligand']:
            key = (chain, seq)
            lig_key = lig_key or key
            if key == lig_key:
                lig.append(xyz)
    assert anchor is not None and lig, t['id']
    return atoms, np.array(lig), anchor


def frame(atoms_xyz, lig, anchor):
    o = lig.mean(axis=0)
    near = atoms_xyz[np.linalg.norm(atoms_xyz - o, axis=1) < 12]
    z = o - near.mean(axis=0); z /= np.linalg.norm(z)
    a = anchor - o; a -= z * a.dot(z); y = a / np.linalg.norm(a)
    x = np.cross(y, z)
    return o, np.stack([x, y, z])  # rows = axes


def carve_sdf(p, cavities):
    """Signed distance (Å) to the region the game ligand occupies, extruded towards +Z."""
    x, y, z = p[..., 0], p[..., 1], p[..., 2]
    zneg = np.minimum(z, 0)

    zpos = np.maximum(z, 0)

    def column(cx, cy, r):
        # Crater: straight well below the ligand plane, opening like a funnel above it.
        d2 = np.hypot(x - cx, y - cy)
        return np.sqrt(d2 ** 2 + zneg ** 2) - (r + zpos * 0.55)

    def capsule(ax, ay, bx, by, r):
        abx, aby = bx - ax, by - ay
        t = np.clip(((x - ax) * abx + (y - ay) * aby) / (abx * abx + aby * aby), 0, 1)
        d2 = np.hypot(x - (ax + t * abx), y - (ay + t * aby))
        return np.sqrt(d2 ** 2 + zneg ** 2) - (r + zpos * 0.55)

    d = column(0, 0, 2.9)
    for i, (size, _) in enumerate(cavities):
        c = arm_dir(i) * ARM_R
        d = np.minimum(d, column(c[0], c[1], HOLE_R[size] / SCALE + 0.35))
        d = np.minimum(d, capsule(0, 0, c[0], c[1], 1.4))
    return d


def build(t):
    atoms, lig, anchor = read_pdb(t)
    xyz = np.array([a[0] for a in atoms])
    o, R = frame(xyz, lig, anchor)
    local = (xyz - o) @ R.T
    lig_local = (lig - o) @ R.T

    # --- Gaussian density on a grid (pocket frame)
    h = 0.6
    pad = 6
    lo = local.min(axis=0) - pad; hi = local.max(axis=0) + pad
    shape = np.ceil((hi - lo) / h).astype(int) + 1
    rho = np.zeros(shape, np.float32)
    sigma = 1.45
    rad = int(math.ceil(4.2 / h))
    offs = np.arange(-rad, rad + 1)
    for p in local:
        idx = np.round((p - lo) / h).astype(int)
        sl = tuple(slice(max(0, idx[k] - rad), min(shape[k], idx[k] + rad + 1)) for k in range(3))
        gx = lo[0] + np.arange(sl[0].start, sl[0].stop) * h - p[0]
        gy = lo[1] + np.arange(sl[1].start, sl[1].stop) * h - p[1]
        gz = lo[2] + np.arange(sl[2].start, sl[2].stop) * h - p[2]
        g = np.exp(-(gx[:, None, None] ** 2 + gy[None, :, None] ** 2 + gz[None, None, :] ** 2) / (2 * sigma ** 2))
        rho[sl] += g
    iso = 0.55
    gi = np.indices(shape).transpose(1, 2, 3, 0) * h + lo
    sdf = carve_sdf(gi, t['cavities'])
    # Field > 0 inside protein. Carving: inside the ligand volume the field is forced negative.
    field = np.minimum(rho - iso, sdf * 0.6)
    verts, faces, _, _ = measure.marching_cubes(field, 0.0, spacing=(h, h, h))
    verts += lo
    mesh = trimesh.Trimesh(verts, faces[:, ::-1], process=True)
    # keep the largest connected piece (drop floating specks)
    parts = mesh.split(only_watertight=False)
    mesh = max(parts, key=lambda m: len(m.faces))
    trimesh.smoothing.filter_taubin(mesh, iterations=8)
    target = t['faces']
    if len(mesh.faces) > target:
        v, f = fast_simplification.simplify(mesh.vertices, mesh.faces, 1 - target / len(mesh.faces))
        mesh = trimesh.Trimesh(v, f, process=True)
    mesh.fix_normals()
    v = mesh.vertices; n = mesh.vertex_normals

    # --- colours
    tree = cKDTree(local)
    base = np.array(t['tint'])
    props = []
    for (_, res, name, el) in atoms:
        if (res, name) in NEG: props.append(((0.95, 0.32, 0.36), 0.9))
        elif (res, name) in POS: props.append(((0.32, 0.52, 1.0), 0.9))
        elif el == 'C' and res in HYDRO and name not in BACKBONE: props.append(((1.0, 0.86, 0.45), 0.55))
        elif el in ('N', 'O'): props.append(((0.62, 0.90, 0.84), 0.35))
        else: props.append(((0.96, 0.96, 0.98), 0.0))
    pcol = np.array([p[0] for p in props]); pw = np.array([p[1] for p in props])
    dist, ids = tree.query(v, k=6)
    w = 1 / np.maximum(dist, 0.5) ** 2
    w /= w.sum(axis=1, keepdims=True)
    mixw = (pw[ids] * w).sum(axis=1)
    mixc = (pcol[ids] * (pw[ids] * w)[..., None]).sum(axis=1) / np.maximum(mixw, 1e-6)[:, None]
    col = base * (1 - mixw[:, None]) + mixc * mixw[:, None]
    # Well walls show the game's chemistry clearly.
    for i, (size, chem) in enumerate(t['cavities']):
        c = arm_dir(i) * ARM_R
        r = HOLE_R[size] / SCALE
        d2 = np.hypot(v[:, 0] - c[0], v[:, 1] - c[1])
        dz = np.minimum(v[:, 2], 0)
        d = np.sqrt(d2 ** 2 + dz ** 2)
        wgt = np.clip(1 - (d - r - 0.8) / 3.0, 0, 1) * (v[:, 2] > -r - 4.0)
        col = col * (1 - 0.95 * wgt[:, None]) + np.array(CHEM_RGB[chem]) * 0.95 * wgt[:, None]
    # A touch more saturation so the clay colours survive tone mapping.
    gray = col.mean(axis=1, keepdims=True)
    col = np.clip(gray + (col - gray) * 1.45, 0, 1)
    # Baked ambient occlusion from atom crowding around the vertex.
    probe = v + n * 2.5
    cnt = np.array([len(x) for x in tree.query_ball_point(probe, 9.0)])
    lo_c, hi_c = np.percentile(cnt, 5), np.percentile(cnt, 97)
    ao = 1 - 0.55 * np.clip((cnt - lo_c) / (hi_c - lo_c), 0, 1)
    col = np.clip(col * ao[:, None], 0, 1)

    # --- export (metres)
    out = trimesh.Trimesh(v * SCALE, mesh.faces, vertex_normals=n, process=False)
    out.visual = trimesh.visual.ColorVisuals(out, vertex_colors=(np.c_[col, np.ones(len(col))] * 255).astype(np.uint8))
    os.makedirs(OUT_GLB, exist_ok=True)
    out.export(os.path.join(OUT_GLB, f"{t['id']}.glb"), include_normals=True)
    # Quantize (KHR_mesh_quantization) to halve the download; models.ts decodes it on load.
    glb = os.path.join(OUT_GLB, f"{t['id']}.glb")
    import subprocess
    subprocess.run(['npx', '-y', '@gltf-transform/cli@4', 'quantize', glb, glb, '--quantize-position', '14',
                    '--quantize-normal', '8', '--quantize-color', '8'], check=True, capture_output=True)
    bmin = (v.min(axis=0) * SCALE).round(4).tolist(); bmax = (v.max(axis=0) * SCALE).round(4).tolist()
    meta = dict(id=t['id'], pdb=t['pdb'], scale=SCALE, faces=int(len(mesh.faces)), bboxMin=bmin, bboxMax=bmax,
                cavities=[dict(size=s, chem=c) for s, c in t['cavities']],
                ligandDepth=round(float(lig_local[:, 2].min() * SCALE), 4))
    if t.get('membrane'):
        # Membrane plane is perpendicular to the receptor's long (helix bundle) axis; the pocket
        # opens to the outside of the cell, so the bilayer sits behind it along -Z.
        # Textbook cut-away of the bilayer: a rectangular patch, outer + inner head layers.
        z_out, z_in = -3.0, -33.0
        x0, x1, y0, y1 = -46.0, 46.0, -3.0, 40.0
        sp = 5.4
        m = dict(zOuter=z_out * SCALE, zInner=z_in * SCALE, xMin=x0 * SCALE, xMax=x1 * SCALE,
                 yMin=y0 * SCALE, yMax=y1 * SCALE, bottom=-56.0 * SCALE, spacing=sp * SCALE)
        for key, zl in (('outer', z_out), ('inner', z_in)):
            band = local[np.abs(local[:, 2] - zl) < 6]
            t2 = cKDTree(band[:, :2])
            heads = []
            for k, gy in enumerate(np.arange(y0, y1 + 0.01, sp * 0.866)):
                for gx in np.arange(x0 + (sp / 2 if k % 2 else 0), x1 + 0.01, sp):
                    if t2.query([gx, gy])[0] < 4.2: continue
                    heads.append([round(gx * SCALE, 4), round(gy * SCALE, 4)])
            m[key] = heads
        meta['membrane'] = {k: (round(v, 4) if isinstance(v, float) else v) for k, v in m.items()}
        meta['bottomCenter'] = [round(float(c) * SCALE, 4) for c in local[local[:, 2] < local[:, 2].min() + 8].mean(axis=0)]
    print(t['id'], 'atoms', len(atoms), 'faces', len(mesh.faces), 'bbox', bmin, bmax)
    return meta


if __name__ == '__main__':
    metas = {t['id']: build(t) for t in TARGETS}
    json.dump(metas, open(OUT_JSON, 'w'), indent=2)
    print('wrote', OUT_JSON)
