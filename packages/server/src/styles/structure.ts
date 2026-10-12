// Constructions en terrain d'un style (SPEC 13.7) : colonnes de terrain surélevées à bords à pic, comme les
// gratte-ciel de RCT1 (bordure « Skyscraper », « Brick »…). Un style ainsi construit n'a aucun objet de scénerie ;
// sans ce relevé, il passe pour un style vide ou une simple colline.

import type { StyleRecord } from "@openrct2-claude/protocol";
import { cornerLevels } from "../planners/heightmap.js";

/** Hauteur minimale (en niveaux) d'un bord à pic pour compter comme construction. */
export const STRUCTURE_MIN_CLIFF = 4;

/** Bordures de terrain qui figurent un bâtiment (façades), d'après l'identifiant ou le nom de l'objet. */
const BUILDING_EDGE = /skyscraper|building|brick|window|office|house|castle|tower|apartment|concrete|iron|wood|plank|metal|glass|facade|façade/i;

export interface TerrainStructure {
    /** building : bordure de façade ; cliff : falaise naturelle (roche…). */
    kind: "building" | "cliff";
    /** Tuiles surélevées au-dessus d'un bord à pic. */
    tiles: number;
    /** Plus haut bord à pic, en niveaux. */
    height: number;
    /** Bordures de ces tuiles (identifiants d'objets terrain_edge). */
    edges: string[];
}

/** Bords partagés : voisin (+1, 0) et (0, +1), paires de coins (S, E, N, W) qui se touchent. */
const SHARED: [number, number, [number, number][]][] = [
    [1, 0, [[1, 0], [2, 3]]],
    [0, 1, [[3, 0], [2, 1]]],
];

/** Colonnes de terrain d'un style : tuiles plus hautes qu'une voisine du style d'au moins STRUCTURE_MIN_CLIFF niveaux sur tout un bord. */
export function terrainStructure(r: Pick<StyleRecord, "surfaces" | "objects">): TerrainStructure | null {
    if (r.surfaces.length === 0) return null;
    const byTile = new Map(r.surfaces.map((s) => [`${s.dx},${s.dy}`, s]));
    const raised = new Set<string>();
    let height = 0;
    for (const s of r.surfaces) {
        const a = cornerLevels({ h: s.baseHeight / 2, s: s.slope });
        for (const [dx, dy, pairs] of SHARED) {
            const n = byTile.get(`${s.dx + dx},${s.dy + dy}`);
            if (!n) continue;
            const b = cornerLevels({ h: n.baseHeight / 2, s: n.slope });
            const diffs = pairs.map(([i, j]) => a[i] - b[j]);
            const drop = Math.min(...diffs.map(Math.abs));
            // À pic sur tout le bord, et du même côté.
            if (drop < STRUCTURE_MIN_CLIFF || Math.sign(diffs[0]) !== Math.sign(diffs[1])) continue;
            raised.add(diffs[0] > 0 ? `${s.dx},${s.dy}` : `${n.dx},${n.dy}`);
            height = Math.max(height, drop);
        }
    }
    if (raised.size === 0) return null;
    const edges = new Map<string, number>();
    for (const k of raised) {
        const e = byTile.get(k)?.edge;
        if (e) edges.set(e, (edges.get(e) ?? 0) + 1);
    }
    const ids = [...edges.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => id);
    const building = ids.some((id) => BUILDING_EDGE.test(id) || BUILDING_EDGE.test(r.objects[id]?.name ?? ""));
    return { kind: building ? "building" : "cliff", tiles: raised.size, height, edges: ids };
}

/**
 * Rangées identiques consécutives d'un style, le long de x (colonnes) ou de y (rangées) : la partie répétable d'un
 * mur ou d'une façade. Signature d'une rangée : ses éléments de scénerie (position dans la rangée, type, objet,
 * direction, quadrant, écart au sol, couleurs) et son terrain. Rend les suites d'au moins 2 rangées identiques.
 */
export function repeatingBands(r: Pick<StyleRecord, "tiles" | "surfaces" | "elements">): { axis: "x" | "y"; from: number; to: number }[] {
    const out: { axis: "x" | "y"; from: number; to: number }[] = [];
    for (const axis of ["x", "y"] as const) {
        const sig = new Map<number, string[]>();
        const at = (dx: number, dy: number) => (axis === "y" ? [dy, dx] : [dx, dy]);
        for (const [dx, dy] of r.tiles) {
            const [band, pos] = at(dx, dy);
            (sig.get(band) ?? sig.set(band, []).get(band)!).push(`t${pos}`);
        }
        for (const s of r.surfaces) {
            const [band, pos] = at(s.dx, s.dy);
            sig.get(band)?.push(`s${pos}:${s.baseHeight}:${s.slope}:${s.water}:${s.surface}:${s.edge}`);
        }
        for (const e of r.elements) {
            if (!(e.t === "small_scenery" || e.t === "wall" || e.t === "large_scenery")) continue;
            const [band, pos] = at(e.dx, e.dy);
            sig.get(band)?.push(`e${pos}:${e.t}:${e.object}:${e.direction}:${e.quadrant}:${e.dz}:${(e.colours ?? []).join("/")}`);
        }
        const bands = [...sig.keys()].sort((a, b) => a - b);
        const text = new Map(bands.map((b) => [b, sig.get(b)!.sort().join("|")]));
        for (let i = 0; i < bands.length; ) {
            let j = i;
            while (j + 1 < bands.length && bands[j + 1] === bands[j] + 1 && text.get(bands[j + 1]) === text.get(bands[i])) j++;
            if (j > i) out.push({ axis, from: bands[i], to: bands[j] });
            i = j + 1;
        }
    }
    return out;
}

/** Part minimale des éléments de scénerie surélevés pour qu'un style soit une construction en objets. */
export const STRUCTURE_RAISED_SHARE = 0.3;
/** Nombre minimal d'éléments surélevés (un nid d'oiseau dans un arbre n'est pas un château). */
export const STRUCTURE_MIN_RAISED = 6;

export interface StyleKind {
    /** structure : bloc rigide (posé entier, à une seule hauteur, sol nivelé) ; natural : tamponné en patchs, coupables. */
    kind: "structure" | "natural";
    /** user : choisi dans le Style Picker ou par style_update ; auto : déduit du relevé. */
    source: "user" | "auto";
    /** Éléments de scénerie surélevés (empilés, sur pilier, sur une autre pièce) et total. */
    raised: number;
    scenery: number;
    reason: string;
}

/**
 * Nature d'un style : construction (château, tour, maison faite d'objets empilés avec Zero Clearances, ou bâtiment
 * en terrain) ou nature (forêt, rochers, fleurs). Une construction coupée ou posée tuile par tuile sur un terrain
 * en pente perd ses appuis : ses étages flottent. Le choix de l'utilisateur (StyleRecord.kind) l'emporte.
 */
export function styleKind(r: Pick<StyleRecord, "surfaces" | "objects" | "elements" | "kind">): StyleKind {
    const flat = new Map(r.surfaces.map((s) => [`${s.dx},${s.dy}`, (s.slope & 0x1f) === 0]));
    let raised = 0;
    let scenery = 0;
    for (const e of r.elements) {
        if (!(e.t === "small_scenery" || e.t === "wall" || (e.t === "large_scenery" && (e.sequence ?? 0) === 0))) continue;
        scenery++;
        // Sur une pente, le jeu pose un objet « au sol » jusqu'à 2 unités au-dessus de la base de la surface.
        if (e.dz >= 3 || (e.dz >= 2 && flat.get(`${e.dx},${e.dy}`) !== false)) raised++;
    }
    if (r.kind === "structure" || r.kind === "natural")
        return { kind: r.kind, source: "user", raised, scenery, reason: r.kind === "structure" ? "choisi par l'utilisateur" : "choisi par l'utilisateur (nature)" };
    if (terrainStructure(r)?.kind === "building") return { kind: "structure", source: "auto", raised, scenery, reason: "bâtiment en terrain (bordure de façade)" };
    if (raised >= STRUCTURE_MIN_RAISED && raised / Math.max(1, scenery) >= STRUCTURE_RAISED_SHARE)
        return { kind: "structure", source: "auto", raised, scenery, reason: `${raised} élément(s) sur ${scenery} surélevé(s) : construction empilée` };
    return { kind: "natural", source: "auto", raised, scenery, reason: raised ? `${raised} élément(s) sur ${scenery} surélevé(s) seulement` : "rien d'empilé" };
}
