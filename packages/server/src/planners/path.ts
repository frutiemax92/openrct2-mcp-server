// Planificateur de chemins (SPEC 3.4, 9.9) : polyligne → tuiles 4-connexes → hauteur et pente par tuile.
//
// Placement « sur le terrain », comme FootpathGetOnTerrainPlacement (world/Footpath.cpp) :
//  - terrain plat : chemin plat au niveau du terrain ;
//  - deux coins adjacents relevés : rampe (slopeDirection = côté haut) ;
//  - trois coins relevés : chemin plat un niveau au-dessus ;
//  - autres pentes : irrégulières, il faut aplanir.

import { DIRECTION_LABEL, directionBetween, reverseDirection, type Direction, type RegionTile, type TileXY } from "@openrct2-claude/protocol";

/** Index = coins relevés (N=1, E=2, S=4, W=8). Valeur : "flat", "raise", "irregular" ou direction de montée. */
const DEFAULT_PATH_SLOPE: (Direction | "flat" | "raise" | "irregular")[] = [
    "flat", "irregular", "irregular", 2,
    "irregular", "irregular", 3, "raise",
    "irregular", 1, "irregular", "raise",
    0, "raise", "raise", "irregular",
];

export interface PlannedPathTile {
    x: number;
    y: number;
    level: number;
    slopeDirection: Direction | null;
}

export interface PathProblem {
    x: number;
    y: number;
    code: "BAD_SLOPE" | "WATER" | "OFF_MAP" | "LEVEL_BREAK";
    message: string;
}

/** Remplit les tuiles entre les sommets (segments en L : d'abord X, puis Y). */
export function expandPolyline(points: TileXY[]): TileXY[] {
    const out: TileXY[] = [];
    const push = (t: TileXY) => {
        const last = out[out.length - 1];
        if (!last || last.x !== t.x || last.y !== t.y) out.push(t);
    };
    if (points.length === 0) return out;
    push({ x: points[0].x, y: points[0].y });
    for (let i = 1; i < points.length; i++) {
        let { x, y } = out[out.length - 1];
        const target = points[i];
        while (x !== target.x) {
            x += Math.sign(target.x - x);
            push({ x, y });
        }
        while (y !== target.y) {
            y += Math.sign(target.y - y);
            push({ x, y });
        }
    }
    return out;
}

/** Placement d'un chemin sur une tuile de terrain, ou null si la pente est irrégulière. */
export function onTerrain(t: RegionTile): { level: number; slopeDirection: Direction | null } | null {
    const slope = DEFAULT_PATH_SLOPE[t.s & 0xf];
    if (t.s & 0x10) return null;
    if (slope === "irregular") return null;
    if (slope === "flat") return { level: t.h, slopeDirection: null };
    if (slope === "raise") return { level: t.h + 1, slopeDirection: null };
    return { level: t.h, slopeDirection: slope };
}

/** Dégagement qu'un chemin exige au-dessus de son propre niveau (clearanceHeight standard d'un footpath, ≈ 2 niveaux). */
const PATH_CLEARANCE = 2;

/**
 * Placement d'un chemin surélevé (passerelle) à un niveau fixe, indépendant de la pente du terrain : valide si le
 * support peut porter le chemin (terrain et eau sous le niveau visé) et si le volume [level, level+PATH_CLEARANCE)
 * qu'occuperait le chemin ne chevauche aucune pièce d'attraction ni grande scénerie. Avec plusieurs pièces de
 * hauteurs différentes sur une même tuile (ex. un circuit qui se croise lui-même), un créneau libre entre deux
 * pièces reste utilisable (passerelle qui passe dessous l'une et au-dessus de l'autre).
 */
export function elevatedPlacement(t: RegionTile, level: number): { level: number; slopeDirection: null } | null {
    const groundTop = t.h + (t.s & 0xf ? 1 : 0);
    if (level < groundTop) return null;
    if (level < t.w) return null;
    const top = level + PATH_CLEARANCE;
    if (t.ri) {
        if (t.ri.some(([b, c]) => level < c && top > b)) return null;
    } else if (t.r?.length && level <= (t.rh ?? -1)) return null;
    if (t.lg && level <= (t.sh ?? -1)) return null;
    if (t.p?.some((p) => p.l === level)) return null;
    return { level, slopeDirection: null };
}

/** Hauteur (niveau) du bord d'une tuile de chemin du côté `side`, ou null si non raccordable. */
export function edgeLevel(p: { level: number; slopeDirection: Direction | null }, side: Direction): number | null {
    if (p.slopeDirection === null) return p.level;
    if (side === p.slopeDirection) return p.level + 1;
    if (side === reverseDirection(p.slopeDirection)) return p.level;
    return null;
}

export interface PathPlanOptions {
    /** Niveau imposé (chemin surélevé / pont) au lieu de suivre le terrain. */
    fixedLevel?: number;
    allowSlopes?: boolean;
}

export interface PathPlan {
    tiles: PlannedPathTile[];
    problems: PathProblem[];
    slopes: { x: number; y: number; dir: string; rise: number }[];
}

export function planPath(route: TileXY[], getTile: (x: number, y: number) => RegionTile | undefined, opts: PathPlanOptions = {}): PathPlan {
    const tiles: PlannedPathTile[] = [];
    const problems: PathProblem[] = [];
    const slopes: PathPlan["slopes"] = [];
    for (const t of route) {
        const tile = getTile(t.x, t.y);
        if (!tile) {
            problems.push({ x: t.x, y: t.y, code: "OFF_MAP", message: "Tuile hors carte." });
            continue;
        }
        if (opts.fixedLevel !== undefined) {
            if (opts.fixedLevel < tile.h + (tile.s ? 1 : 0)) {
                problems.push({ x: t.x, y: t.y, code: "BAD_SLOPE", message: `Niveau ${opts.fixedLevel} sous le terrain (niveau ${tile.h}).` });
                continue;
            }
            tiles.push({ x: t.x, y: t.y, level: opts.fixedLevel, slopeDirection: null });
            continue;
        }
        if (tile.w > tile.h) {
            problems.push({ x: t.x, y: t.y, code: "WATER", message: `Tuile sous l'eau (eau ${tile.w}, terrain ${tile.h}).` });
            continue;
        }
        const p = onTerrain(tile);
        if (!p || (p.slopeDirection !== null && opts.allowSlopes === false)) {
            problems.push({ x: t.x, y: t.y, code: "BAD_SLOPE", message: `Pente de terrain ${tile.s} incompatible avec un chemin.` });
            continue;
        }
        tiles.push({ x: t.x, y: t.y, ...p });
        if (p.slopeDirection !== null) slopes.push({ x: t.x, y: t.y, dir: DIRECTION_LABEL[p.slopeDirection], rise: 1 });
    }
    // Ruptures de niveau entre tuiles consécutives de la route
    for (let i = 1; i < tiles.length; i++) {
        const a = tiles[i - 1];
        const b = tiles[i];
        const d = directionBetween(a, b);
        if (d === null) continue;
        const la = edgeLevel(a, d);
        const lb = edgeLevel(b, reverseDirection(d));
        if (la === null || lb === null || la !== lb) {
            problems.push({
                x: b.x,
                y: b.y,
                code: "LEVEL_BREAK",
                message: `Raccord impossible entre (${a.x},${a.y}) et (${b.x},${b.y}) : niveaux ${la ?? "rampe de côté"} / ${lb ?? "rampe de côté"}.`,
            });
        }
    }
    return { tiles, problems, slopes };
}
