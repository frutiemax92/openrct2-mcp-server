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
