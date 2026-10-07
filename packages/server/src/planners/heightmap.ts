// Terraformage de haut niveau (SPEC 11.5) : calcul sur une grille de sommets (coins de tuiles), puis conversion
// en hauteur + pente par tuile pour landsetheight.
//
// Coins d'une tuile (x, y) en repère carte (world/Map.cpp, TileElementHeight et MapGetCornerHeight) :
//   S = (x, y)      bit 4   (coin −x, −y)
//   E = (x+1, y)    bit 2   (coin +x, −y)
//   N = (x+1, y+1)  bit 1   (coin +x, +y)
//   W = (x, y+1)    bit 8   (coin −x, +y)
// Une tuile est valide si ses coins diffèrent d'au plus 1 niveau, ou de 2 entre deux coins opposés (drapeau
// diagonal 16, les deux autres coins à mi-hauteur). Il suffit donc que deux sommets voisins sur un bord de tuile
// diffèrent d'au plus 1 niveau (grille « 1-lipschitzienne ») : c'est l'invariant maintenu ici.

import { MAX_LEVEL, MIN_LEVEL, SLOPE, type RegionTile, type TerrainHeightItem, type TileRect } from "@openrct2-claude/protocol";

/** Ordre des coins : S, E, N, W (décalage du sommet, bit de pente). */
const CORNERS: readonly { dx: number; dy: number; bit: number }[] = [
    { dx: 0, dy: 0, bit: SLOPE.S },
    { dx: 1, dy: 0, bit: SLOPE.E },
    { dx: 1, dy: 1, bit: SLOPE.N },
    { dx: 0, dy: 1, bit: SLOPE.W },
];

/** Niveaux des quatre coins (S, E, N, W) d'une tuile de surface. */
export function cornerLevels(t: Pick<RegionTile, "h" | "s">): [number, number, number, number] {
    const out = CORNERS.map((c) => t.h + (t.s & c.bit ? 1 : 0)) as [number, number, number, number];
    if (t.s & SLOPE.DIAGONAL) {
        // Le coin opposé au seul coin non relevé monte de 2 (MapGetCornerHeight).
        const down = CORNERS.findIndex((c) => !(t.s & c.bit));
        if (down >= 0) out[(down + 2) & 3] = t.h + 2;
    }
    return out;
}

/** Hauteur et pente d'une tuile à partir de ses coins (S, E, N, W), ou null si la combinaison est invalide. */
export function tileFromCorners(c: readonly number[]): { level: number; slope: number } | null {
    const min = Math.min(...c);
    const max = Math.max(...c);
    if (max - min > 2) return null;
    let slope = 0;
    for (let i = 0; i < 4; i++) if (c[i] > min) slope |= CORNERS[i].bit;
    if (max - min === 2) {
        // Seule forme valide : un coin à +2, son opposé à 0, les deux autres à +1.
        const top = c.indexOf(max);
        if (c[(top + 2) & 3] !== min || c[(top + 1) & 3] !== min + 1 || c[(top + 3) & 3] !== min + 1) return null;
        return { level: min, slope: slope | SLOPE.DIAGONAL };
    }
    return { level: min, slope };
}

/** Grille de sommets d'un rectangle de tuiles : (x2 − x1 + 2) × (y2 − y1 + 2) valeurs. */
export class VertexGrid {
    readonly w: number;
    readonly h: number;
    readonly v: Float64Array;
    /** Sommets fixés (bord de zone, tuiles occupées) : jamais modifiés. */
    readonly fixed: Uint8Array;

    constructor(readonly rect: TileRect) {
        this.w = rect.x2 - rect.x1 + 2;
        this.h = rect.y2 - rect.y1 + 2;
        this.v = new Float64Array(this.w * this.h);
        this.fixed = new Uint8Array(this.w * this.h);
    }

    idx(vx: number, vy: number): number {
        return (vy - this.rect.y1) * this.w + (vx - this.rect.x1);
    }

    get(vx: number, vy: number): number {
        return this.v[this.idx(vx, vy)];
    }

    set(vx: number, vy: number, value: number): void {
        const i = this.idx(vx, vy);
        if (!this.fixed[i]) this.v[i] = value;
    }

    forEach(fn: (vx: number, vy: number, i: number) => void): void {
        for (let vy = this.rect.y1; vy <= this.rect.y2 + 1; vy++)
            for (let vx = this.rect.x1; vx <= this.rect.x2 + 1; vx++) fn(vx, vy, this.idx(vx, vy));
    }

    /** Niveaux des coins (S, E, N, W) de la tuile (x, y). */
    corners(x: number, y: number): number[] {
        return CORNERS.map((c) => this.get(x + c.dx, y + c.dy));
    }
}

/**
 * Construit la grille de sommets à partir du terrain actuel. Un sommet partagé par des tuiles en désaccord
 * (falaise) prend la moyenne arrondie. Le bord du rectangle et les coins des tuiles occupées (chemins,
 * attractions, entrées) sont fixés, pour ne rien casser autour.
 */
export function vertexGridFromTerrain(rect: TileRect, get: (x: number, y: number) => RegionTile | undefined, opts: { fixOccupied?: boolean } = {}): VertexGrid {
    const g = new VertexGrid(rect);
    const sum = new Float64Array(g.v.length);
    const count = new Uint8Array(g.v.length);
    for (let y = rect.y1 - 1; y <= rect.y2 + 1; y++) {
        for (let x = rect.x1 - 1; x <= rect.x2 + 1; x++) {
            const t = get(x, y);
            if (!t) continue;
            const c = cornerLevels(t);
            for (let i = 0; i < 4; i++) {
                const vx = x + CORNERS[i].dx;
                const vy = y + CORNERS[i].dy;
                if (vx < rect.x1 || vy < rect.y1 || vx > rect.x2 + 1 || vy > rect.y2 + 1) continue;
                const k = g.idx(vx, vy);
                sum[k] += c[i];
                count[k]++;
            }
        }
    }
    for (let i = 0; i < g.v.length; i++) g.v[i] = count[i] ? Math.round(sum[i] / count[i]) : MIN_LEVEL;
    g.forEach((vx, vy, i) => {
        if (vx === rect.x1 || vy === rect.y1 || vx === rect.x2 + 1 || vy === rect.y2 + 1) g.fixed[i] = 1;
    });
    if (opts.fixOccupied !== false) {
        for (let y = rect.y1; y <= rect.y2; y++)
            for (let x = rect.x1; x <= rect.x2; x++) {
                if (!isOccupied(get(x, y))) continue;
                for (const c of CORNERS) g.fixed[g.idx(x + c.dx, y + c.dy)] = 1;
            }
    }
    return g;
}

/** Tuile portant un chemin, une attraction, une entrée ou de la grande scénerie : son terrain ne bouge pas. */
export function isOccupied(t: RegionTile | undefined): boolean {
    return !!t && !!(t.p?.length || t.r?.length || t.e?.length || t.lg);
}

/**
 * Rend la grille entière et 1-lipschitzienne (voisins sur un bord de tuile : écart ≤ 1), sans toucher aux sommets
 * fixés. `prefer` choisit l'enveloppe : "up" conserve les sommets hauts (collines : les pentes s'élargissent),
 * "down" conserve les creux (vallées, lacs). Renvoie le nombre d'arêtes encore en défaut (falaises inévitables
 * contre un sommet fixé).
 */
export function enforceSlopeLimit(g: VertexGrid, prefer: "up" | "down"): number {
    for (let i = 0; i < g.v.length; i++) {
        if (!g.fixed[i]) g.v[i] = Math.max(MIN_LEVEL, Math.min(MAX_LEVEL, Math.round(g.v[i])));
    }
    const neighbours = (vx: number, vy: number): number[] => {
        const out: number[] = [];
        if (vx > g.rect.x1) out.push(g.idx(vx - 1, vy));
        if (vx < g.rect.x2 + 1) out.push(g.idx(vx + 1, vy));
        if (vy > g.rect.y1) out.push(g.idx(vx, vy - 1));
        if (vy < g.rect.y2 + 1) out.push(g.idx(vx, vy + 1));
        return out;
    };
    // Enveloppe (distance de Chebyshev ≡ 4-voisinage itéré) : passes alternées jusqu'à stabilité.
    for (let pass = 0; pass < 4 * (g.w + g.h); pass++) {
        let changed = false;
        g.forEach((vx, vy, i) => {
            if (g.fixed[i]) return;
            for (const n of neighbours(vx, vy)) {
                if (prefer === "up" && g.v[n] - 1 > g.v[i]) {
                    g.v[i] = g.v[n] - 1;
                    changed = true;
                } else if (prefer === "down" && g.v[n] + 1 < g.v[i]) {
                    g.v[i] = g.v[n] + 1;
                    changed = true;
                }
            }
        });
        if (!changed) break;
    }
    // Les sommets fixés peuvent encore contredire l'enveloppe : on tire les sommets libres vers eux.
    for (let pass = 0; pass < 2 * (g.w + g.h); pass++) {
        let changed = false;
        g.forEach((vx, vy, i) => {
            if (g.fixed[i]) return;
            const ns = neighbours(vx, vy).map((n) => g.v[n]);
            const lo = Math.max(...ns) - 1;
            const hi = Math.min(...ns) + 1;
            const target = lo <= hi ? Math.min(hi, Math.max(lo, g.v[i])) : Math.round((lo + hi) / 2);
            if (target !== g.v[i]) {
                g.v[i] = target;
                changed = true;
            }
        });
        if (!changed) break;
    }
    let violations = 0;
    g.forEach((vx, vy, i) => {
        if (vx <= g.rect.x2 && Math.abs(g.v[i] - g.v[g.idx(vx + 1, vy)]) > 1) violations++;
        if (vy <= g.rect.y2 && Math.abs(g.v[i] - g.v[g.idx(vx, vy + 1)]) > 1) violations++;
    });
    return violations;
}

/** Tuiles dont la hauteur ou la pente change, avec leur état d'avant (pour l'inverse du journal). */
export function diffTiles(
    g: VertexGrid,
    get: (x: number, y: number) => RegionTile | undefined,
): { after: TerrainHeightItem[]; before: TerrainHeightItem[]; invalid: { x: number; y: number }[] } {
    const after: TerrainHeightItem[] = [];
    const before: TerrainHeightItem[] = [];
    const invalid: { x: number; y: number }[] = [];
    for (let y = g.rect.y1; y <= g.rect.y2; y++) {
        for (let x = g.rect.x1; x <= g.rect.x2; x++) {
            const t = get(x, y);
            if (!t || isOccupied(t)) continue;
            const tile = tileFromCorners(g.corners(x, y));
            if (!tile) {
                invalid.push({ x, y });
                continue;
            }
            const cur = tileFromCorners(cornerLevels(t));
            if (cur && cur.level === tile.level && cur.slope === tile.slope) continue;
            after.push({ x, y, level: tile.level, slope: tile.slope });
            before.push({ x, y, level: t.h, slope: t.s });
        }
    }
    return { after, before, invalid };
}

// ---------------------------------------------------------------------------
// Formes
// ---------------------------------------------------------------------------

export type Profile = "cone" | "dome" | "gaussian";

/** Profil radial normalisé : 1 au centre, 0 à d = 1. */
export function profileAt(profile: Profile, d: number): number {
    if (d >= 1) return 0;
    switch (profile) {
        case "cone":
            return 1 - d;
        case "dome":
            return Math.sqrt(1 - d * d);
        case "gaussian":
            // Ramené à 0 au bord pour éviter une marche.
            return (Math.exp(-4 * d * d) - Math.exp(-4)) / (1 - Math.exp(-4));
    }
}

/** Bruit de valeur 2D déterministe (interpolation lissée), dans [−1, 1]. */
export function valueNoise(seed: number): (x: number, y: number) => number {
    const hash = (ix: number, iy: number): number => {
        let h = (ix * 374761393 + iy * 668265263 + seed * 2147483647) | 0;
        h = Math.imul(h ^ (h >>> 13), 1274126177);
        h ^= h >>> 16;
        return ((h >>> 0) / 4294967295) * 2 - 1;
    };
    const smooth = (t: number) => t * t * (3 - 2 * t);
    return (x, y) => {
        const ix = Math.floor(x);
        const iy = Math.floor(y);
        const fx = smooth(x - ix);
        const fy = smooth(y - iy);
        const a = hash(ix, iy);
        const b = hash(ix + 1, iy);
        const c = hash(ix, iy + 1);
        const d = hash(ix + 1, iy + 1);
        return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
    };
}

/** Bruit fractal (plusieurs octaves), dans [−1, 1] environ. */
export function fractalNoise(seed: number, octaves = 3): (x: number, y: number) => number {
    const layers = Array.from({ length: octaves }, (_, i) => valueNoise(seed + i * 1013));
    return (x, y) => {
        let sum = 0;
        let amp = 1;
        let norm = 0;
        let freq = 1;
        for (const n of layers) {
            sum += n(x * freq, y * freq) * amp;
            norm += amp;
            amp /= 2;
            freq *= 2;
        }
        return sum / norm;
    };
}

/** Lissage par moyenne 3×3 (sommets libres seulement), `iterations` fois. */
export function smoothGrid(g: VertexGrid, iterations: number): void {
    for (let it = 0; it < iterations; it++) {
        const copy = Float64Array.from(g.v);
        g.forEach((vx, vy, i) => {
            if (g.fixed[i]) return;
            let s = 0;
            let n = 0;
            for (let dy = -1; dy <= 1; dy++)
                for (let dx = -1; dx <= 1; dx++) {
                    const x = vx + dx;
                    const y = vy + dy;
                    if (x < g.rect.x1 || y < g.rect.y1 || x > g.rect.x2 + 1 || y > g.rect.y2 + 1) continue;
                    s += copy[g.idx(x, y)];
                    n++;
                }
            g.v[i] = s / n;
        });
    }
}
