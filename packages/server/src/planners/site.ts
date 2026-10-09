// Choix du site d'une montagne russe (COASTER_SPACE 7 terdecies) : rectangles libres de la taille voulue sur toute la
// carte, eau comprise, avec la station proposée sur un bord. Fonctions pures.

import { DIRECTION_DELTA, type Direction, type TileRect, type TileXY } from "@openrct2-claude/protocol";
import { groundTopZ, type TileGetter } from "./track.js";

export interface SiteOptions {
    /** Emprise voulue (tuiles) ; les deux orientations sont essayées. */
    w: number;
    h: number;
    stationLength: number;
    sandbox: boolean;
    mapSize: TileXY;
    /** Zone de recherche (défaut : toute la carte). */
    area?: TileRect;
    results?: number;
}

export interface SiteStation {
    x: number;
    y: number;
    direction: Direction;
    level: number;
    entranceSide: "left" | "right";
    /** Tuiles libres devant la station dans le rectangle (lift, première chute). */
    ahead: number;
    /** Tuiles libres derrière (arrivée, freins). */
    behind: number;
}

export interface Site {
    bounds: TileRect;
    w: number;
    h: number;
    /** Part des tuiles sous l'eau (piste au-dessus de l'eau : bonus de proximité dans les notes). */
    water: number;
    /** Écart de niveau du sol (ou de l'eau) dans le rectangle. */
    relief: number;
    groundMin: number;
    groundMax: number;
    /** Tuiles occupées (chemin, autre attraction, entrée, grande scénerie, non possédé). */
    obstacles: number;
    /** Distance (tuiles) du flanc d'entrée de la station au chemin le plus proche ; null si aucun chemin. */
    access: number | null;
    station: SiteStation;
    score: number;
}

/** Tuile qu'aucune piste ne peut traverser au ras du sol : on veut un site vide, pas un site à contourner. */
function obstacle(t: ReturnType<TileGetter>, sandbox: boolean): boolean {
    if (!t) return true;
    if (!(t.o & 3) && !sandbox) return true;
    return !!(t.p?.length || t.e?.length || t.r?.length || t.lg);
}

const level = (t: NonNullable<ReturnType<TileGetter>>) => groundTopZ(t) / 16;
const isWater = (t: NonNullable<ReturnType<TileGetter>>) => t.w > t.h;

/** Distance de Manhattan de chaque tuile au chemin le plus proche (deux passes). */
function pathDistance(get: TileGetter, r: TileRect): (x: number, y: number) => number {
    const W = r.x2 - r.x1 + 1;
    const H = r.y2 - r.y1 + 1;
    const d = new Float64Array(W * H).fill(Infinity);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (get(r.x1 + x, r.y1 + y)?.p?.length) d[y * W + x] = 0;
    for (let y = 0; y < H; y++)
        for (let x = 0; x < W; x++) {
            const i = y * W + x;
            if (x > 0) d[i] = Math.min(d[i], d[i - 1] + 1);
            if (y > 0) d[i] = Math.min(d[i], d[i - W] + 1);
        }
    for (let y = H - 1; y >= 0; y--)
        for (let x = W - 1; x >= 0; x--) {
            const i = y * W + x;
            if (x < W - 1) d[i] = Math.min(d[i], d[i + 1] + 1);
            if (y < H - 1) d[i] = Math.min(d[i], d[i + W] + 1);
        }
    return (x, y) => (x < r.x1 || y < r.y1 || x > r.x2 || y > r.y2 ? Infinity : d[(y - r.y1) * W + (x - r.x1)]);
}

/** Sommes cumulées 2D d'un prédicat sur r. */
function prefix(r: TileRect, f: (x: number, y: number) => boolean): (x1: number, y1: number, x2: number, y2: number) => number {
    const W = r.x2 - r.x1 + 2;
    const H = r.y2 - r.y1 + 2;
    const s = new Int32Array(W * H);
    for (let y = 1; y < H; y++)
        for (let x = 1; x < W; x++) s[y * W + x] = (f(r.x1 + x - 1, r.y1 + y - 1) ? 1 : 0) + s[(y - 1) * W + x] + s[y * W + x - 1] - s[(y - 1) * W + x - 1];
    return (x1, y1, x2, y2) => {
        const a = x1 - r.x1;
        const b = y1 - r.y1;
        const c = x2 - r.x1 + 1;
        const e = y2 - r.y1 + 1;
        return s[e * W + c] - s[b * W + c] - s[e * W + a] + s[b * W + a];
    };
}

/**
 * Station sur un des deux grands bords, une rangée à l'intérieur (la rangée du bord reçoit entrée et sortie), dans le
 * sens du grand côté. Elle part au quart du côté pour laisser l'arrivée derrière et le lift devant. Préfère un flanc
 * sur la terre ferme (la file d'attente ne se pose pas sur l'eau) et proche d'un chemin.
 */
function placeStation(get: TileGetter, b: TileRect, len: number, dist: (x: number, y: number) => number): { station: SiteStation; access: number | null; cost: number } | null {
    const W = b.x2 - b.x1 + 1;
    const H = b.y2 - b.y1 + 1;
    const alongX = W >= H;
    const L = alongX ? W : H;
    const off = Math.max(4, Math.round(L * 0.25));
    if (off + len + 15 > L) return null;
    let best: { station: SiteStation; access: number | null; cost: number } | null = null;
    // edge : 0 = bord bas (x1 ou y1), 1 = bord haut ; forward : sens de marche vers les x/y croissants ou décroissants.
    for (const edge of [0, 1])
        for (const forward of [true, false]) {
            const direction: Direction = alongX ? (forward ? 2 : 0) : forward ? 1 : 3;
            const start = forward ? off : L - 1 - off;
            const row = edge === 0 ? 1 : (alongX ? H : W) - 2;
            const flankRow = edge === 0 ? 0 : (alongX ? H : W) - 1;
            const at = (i: number, r: number): TileXY => (alongX ? { x: b.x1 + i, y: b.y1 + r } : { x: b.x1 + r, y: b.y1 + i });
            const tiles = Array.from({ length: len }, (_, k) => at(start + (forward ? k : -k), row));
            const flank = Array.from({ length: len }, (_, k) => at(start + (forward ? k : -k), flankRow));
            const ts = [...tiles, ...flank].map((t) => get(t.x, t.y));
            if (ts.some((t) => !t)) continue;
            const lvl = Math.max(...ts.map((t) => level(t!)));
            const wet = ts.filter((t) => isWater(t!)).length;
            const access = Math.min(...flank.map((t) => dist(t.x, t.y)));
            // Côté de l'entrée par rapport au sens de marche : gauche = direction + 3.
            const left = DIRECTION_DELTA[((direction + 3) & 3) as Direction];
            const side = left.x === flank[0].x - tiles[0].x && left.y === flank[0].y - tiles[0].y ? "left" : "right";
            const cost = wet * 10 + (Number.isFinite(access) ? Math.min(access, 40) : 40) + (lvl - Math.min(...ts.map((t) => level(t!)))) * 2;
            if (!best || cost < best.cost)
                best = {
                    station: { ...tiles[0], direction, level: lvl, entranceSide: side, ahead: L - off - len, behind: off },
                    access: Number.isFinite(access) ? access : null,
                    cost,
                };
        }
    return best;
}

/**
 * Rectangles libres de w×h (ou h×w) sur la carte, classés : sans obstacle, peu de relief, beaucoup d'eau (proximité),
 * station près d'un chemin. Les rectangles retenus ne se chevauchent pas à plus de 25 %.
 */
export function findSites(get: TileGetter, opts: SiteOptions): Site[] {
    const area: TileRect = opts.area ?? { x1: 1, y1: 1, x2: opts.mapSize.x - 2, y2: opts.mapSize.y - 2 };
    const blocked = prefix(area, (x, y) => obstacle(get(x, y), opts.sandbox));
    const wet = prefix(area, (x, y) => {
        const t = get(x, y);
        return !!t && isWater(t);
    });
    const dist = pathDistance(get, { x1: 0, y1: 0, x2: opts.mapSize.x - 1, y2: opts.mapSize.y - 1 });
    const sizes = opts.w === opts.h ? [[opts.w, opts.h]] : [[opts.w, opts.h], [opts.h, opts.w]];
    const cands: Site[] = [];
    for (const [w, h] of sizes) {
        const tolerance = Math.floor((w * h) / 200);
        for (let y1 = area.y1; y1 + h - 1 <= area.y2; y1++)
            for (let x1 = area.x1; x1 + w - 1 <= area.x2; x1++) {
                const x2 = x1 + w - 1;
                const y2 = y1 + h - 1;
                const obstacles = blocked(x1, y1, x2, y2);
                if (obstacles > tolerance) continue;
                let gMin = Infinity;
                let gMax = -Infinity;
                for (let y = y1; y <= y2; y++)
                    for (let x = x1; x <= x2; x++) {
                        const t = get(x, y);
                        if (!t) continue;
                        const g = level(t);
                        if (g < gMin) gMin = g;
                        if (g > gMax) gMax = g;
                    }
                const bounds = { x1, y1, x2, y2 };
                const st = placeStation(get, bounds, opts.stationLength, dist);
                if (!st) continue;
                const water = wet(x1, y1, x2, y2) / (w * h);
                const relief = gMax - gMin;
                // Relief : la piste basse bute sur le terrain haut ; l'eau est plate et donne la proximité.
                const score = 100 + 30 * water - 3 * Math.max(0, relief - 2) - 8 * obstacles - st.cost * 0.5;
                cands.push({ bounds, w, h, water: Math.round(water * 100) / 100, relief, groundMin: gMin, groundMax: gMax, obstacles, access: st.access, station: st.station, score: Math.round(score * 10) / 10 });
            }
    }
    cands.sort((a, b) => b.score - a.score);
    const out: Site[] = [];
    const overlap = (a: TileRect, b: TileRect) => {
        const w = Math.min(a.x2, b.x2) - Math.max(a.x1, b.x1) + 1;
        const h = Math.min(a.y2, b.y2) - Math.max(a.y1, b.y1) + 1;
        return w > 0 && h > 0 ? (w * h) / ((a.x2 - a.x1 + 1) * (a.y2 - a.y1 + 1)) : 0;
    };
    for (const c of cands) {
        if (out.length >= (opts.results ?? 3)) break;
        if (out.some((o) => overlap(o.bounds, c.bounds) > 0.25)) continue;
        out.push(c);
    }
    return out;
}
