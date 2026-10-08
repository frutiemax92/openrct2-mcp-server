// Mesures d'espace d'un circuit (COASTER_SPACE.md, section 3) : découpage en éléments, proximité entre parties non
// voisines du parcours, empilement, plus grand vide et volume libre. Fonctions pures, à partir des pièces seules
// (et, pour le volume libre, du cache de carte). Unités : tuiles, niveaux (16 unités monde).

import type { TrackPieceInfo } from "@openrct2-claude/protocol";
import { elementKind } from "./speed.js";
import { SegmentTable, beginPose, blockSpan, endPose, groundTopZ, pieceElements, samePose, type TileGetter, type TrackBlock } from "./track.js";

/** Distance de Tchebychev au-delà de laquelle `nearestGap` vaut null (« > 4 »). */
export const GAP_LIMIT = 4;
/** Deux pièces dont les indices diffèrent d'au plus cette valeur (modulo la longueur) sont voisines dans le parcours. */
export const NEIGHBOUR_SPAN = 2;

type Piece = TrackPieceInfo & { chain?: boolean };

export interface SpaceElement {
    /** Genre : `lift`, `station`, `brakes`, ou `elementKind` sans côté ni préfixe banked/halfBanked. */
    kind: string;
    /** Indices de la première et de la dernière pièce. */
    from: number;
    to: number;
}

export interface SpaceCrossing {
    /** Index de l'autre élément dans `elements`, ou null si la pièce croisée n'appartient à aucun (droite, transition). */
    element: number | null;
    /** Genre de l'autre élément, ou noms des pièces de liaison croisées. */
    kind: string;
    /** Indices des pièces croisées. */
    from: number;
    to: number;
    tiles: number;
    /** Plus petit écart vertical (niveaux) entre les blocs de l'élément et ceux de l'autre sur les tuiles partagées. */
    minLevelGap: number;
    /** L'élément passe au-dessus de l'autre sur toutes les tuiles partagées, au-dessous, ou les deux selon la tuile. */
    side: "dessus" | "dessous" | "mêlé";
}

export interface ElementSpace extends SpaceElement {
    tiles: number;
    /** Plus petite distance de Tchebychev (tuiles) à une pièce non voisine hors de l'élément ; null au-delà de 4. */
    nearestGap: number | null;
    /** Tuiles de l'élément qui portent aussi une pièce non voisine. */
    shared: number;
    /** Plus petit écart vertical (niveaux) sur ces tuiles, null si aucune. */
    minLevelGap: number | null;
    crossings: SpaceCrossing[];
    /** Posé à 2 tuiles ou plus du reste sans rien partager. */
    isolated: boolean;
}

export interface SpaceRect {
    x: number;
    y: number;
    w: number;
    h: number;
}

export interface SpaceProfile {
    /** Circuit fermé : les indices de pièces se comptent modulo la longueur pour le voisinage. */
    closed: boolean;
    footprint: { x1: number; y1: number; x2: number; y2: number; w: number; h: number; area: number };
    trackTiles: number;
    /** Tuiles de piste distinctes / tuiles de l'emprise (0 à 1). */
    coverage: number;
    /** Tuiles portant au moins deux pièces non voisines. */
    stackedTiles: number;
    /** Plus grand rectangle de l'emprise sans piste, et sa part de l'emprise (0 à 1). */
    largestVoid: (SpaceRect & { share: number }) | null;
    /** Éléments hors station et freins, dans l'ordre du parcours. */
    elements: ElementSpace[];
    /** Indices (dans `elements`) des éléments isolés. */
    isolated: number[];
}

/** Genre d'une pièce pour le découpage, ou null pour une droite ou une transition. */
function pieceKind(p: Piece): string | null {
    if (p.chain) return "lift";
    const name = SegmentTable.nameOf(p.type);
    if (/Station/.test(name)) return "station";
    if (/[bB]rakes/.test(name)) return "brakes";
    const k = elementKind(name)?.replace(/^(banked|halfBanked)/, "");
    return k ? k.charAt(0).toLowerCase() + k.slice(1) : null;
}

/**
 * Découpe le circuit en éléments : pièces à chaîne (lift), station, freins, puis chaque suite de pièces du même
 * genre. Une pièce sans genre (droite, transition) ferme l'élément en cours et n'appartient à aucun élément.
 */
export function spaceElements(pieces: Piece[]): SpaceElement[] {
    const out: SpaceElement[] = [];
    let cur: (SpaceElement & { closed: boolean }) | null = null;
    pieces.forEach((p, i) => {
        const kind = pieceKind(p);
        if (!kind) {
            if (cur) cur.closed = true;
        } else if (cur && cur.kind === kind && !cur.closed) {
            cur.to = i;
        } else {
            cur = { kind, from: i, to: i, closed: false };
            out.push(cur);
        }
    });
    return out.map(({ kind, from, to }) => ({ kind, from, to }));
}

/** Noms distincts d'une suite de pièces de liaison (« flat+onRidePhoto+flatToLeftBank »), 3 au plus. */
function runLabel(pieces: Piece[], from: number, to: number): string {
    const names = [...new Set(pieces.slice(from, to + 1).map((p) => SegmentTable.nameOf(p.type)))];
    return names.length > 3 ? `${names.slice(0, 3).join("+")}…` : names.join("+");
}

/** La dernière pièce finit-elle là où commence la première ? */
export function isClosed(table: SegmentTable, pieces: Piece[]): boolean {
    const first = pieces[0] && table.get(pieces[0].type);
    const last = pieces[pieces.length - 1] && table.get(pieces[pieces.length - 1].type);
    return pieces.length > 1 && !!first && !!last && samePose(endPose(pieces[pieces.length - 1], last), beginPose(pieces[0], first));
}

const key = (x: number, y: number): string => `${x},${y}`;

/** Plus grand rectangle sans piste dans la grille w×h (`filled(x, y)`), par histogramme de colonnes vides. */
export function largestEmptyRect(w: number, h: number, filled: (x: number, y: number) => boolean): SpaceRect | null {
    const heights = new Array<number>(w).fill(0);
    let best: SpaceRect | null = null;
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) heights[x] = filled(x, y) ? 0 : heights[x] + 1;
        // Pile des colonnes de hauteur croissante.
        const stack: number[] = [];
        for (let x = 0; x <= w; x++) {
            const hx = x < w ? heights[x] : 0;
            while (stack.length && heights[stack[stack.length - 1]] >= hx) {
                const top = stack.pop()!;
                const rh = heights[top];
                const left = stack.length ? stack[stack.length - 1] + 1 : 0;
                const rw = x - left;
                if (rh > 0 && (!best || rw * rh > best.w * best.h)) best = { x: left, y: y - rh + 1, w: rw, h: rh };
            }
            stack.push(x);
        }
    }
    return best;
}

/**
 * Profil d'espace d'un circuit : mesures globales et par élément (COASTER_SPACE.md, section 3). Sur un circuit fermé
 * (détecté sur les poses, ou imposé par `closed`), le voisinage des pièces se compte modulo la longueur ; sur un tracé
 * en cours de construction, les indices ne bouclent pas.
 */
export function spaceProfile(table: SegmentTable, pieces: Piece[], opts: { closed?: boolean } = {}): SpaceProfile {
    const n = pieces.length;
    const closed = opts.closed ?? isClosed(table, pieces);
    const indexDistance = (a: number, b: number): number => (closed ? Math.min(Math.abs(a - b), n - Math.abs(a - b)) : Math.abs(a - b));
    const blocks: TrackBlock[][] = pieces.map((p) => {
        const seg = table.get(p.type);
        return seg ? pieceElements(p, seg) : [];
    });
    // Tuile -> blocs posés dessus, avec l'indice de leur pièce.
    const cells = new Map<string, { i: number; z: number }[]>();
    blocks.forEach((bs, i) =>
        bs.forEach((b) => {
            const k = key(b.x, b.y);
            const list = cells.get(k);
            if (list) list.push({ i, z: b.z });
            else cells.set(k, [{ i, z: b.z }]);
        }),
    );
    const all = blocks.flat();
    const fp = all.length
        ? { x1: Math.min(...all.map((b) => b.x)), y1: Math.min(...all.map((b) => b.y)), x2: Math.max(...all.map((b) => b.x)), y2: Math.max(...all.map((b) => b.y)) }
        : { x1: 0, y1: 0, x2: -1, y2: -1 };
    const w = fp.x2 - fp.x1 + 1;
    const h = fp.y2 - fp.y1 + 1;
    const area = Math.max(w * h, 0);

    const parts = spaceElements(pieces);
    const elementOf = new Array<number | null>(n).fill(null);
    parts.forEach((e, ei) => {
        for (let i = e.from; i <= e.to; i++) elementOf[i] = ei;
    });
    // Suites de pièces hors élément (droites, transitions) : un croisement par suite, pas par pièce.
    const runOf = new Array<number>(n).fill(-1);
    for (let i = 0, run = -1; i < n; i++) if (elementOf[i] === null) runOf[i] = i > 0 && elementOf[i - 1] === null ? run : (run = i);
    // Pièce hors de [a, b] et à plus de NEIGHBOUR_SPAN pièces de ses deux bouts.
    const far = (i: number, a: number, b: number): boolean => (i < a || i > b) && indexDistance(i, a) > NEIGHBOUR_SPAN && indexDistance(i, b) > NEIGHBOUR_SPAN;

    const elements: ElementSpace[] = [];
    for (const [ei, el] of parts.entries()) {
        if (el.kind === "station" || el.kind === "brakes") continue;
        const own = new Map<string, { x: number; y: number; zs: number[] }>();
        for (let i = el.from; i <= el.to; i++)
            for (const b of blocks[i]) {
                const k = key(b.x, b.y);
                const t = own.get(k);
                if (t) t.zs.push(b.z);
                else own.set(k, { x: b.x, y: b.y, zs: [b.z] });
            }
        let gap: number | null = null;
        let shared = 0;
        let minGap = Infinity;
        // Croisements groupés par élément croisé (ou par suite de pièces hors élément).
        const cross = new Map<string, { element: number | null; from: number; to: number; tiles: Set<string>; min: number; above: boolean; below: boolean }>();
        for (const [k, t] of own) {
            const here = (cells.get(k) ?? []).filter((o) => far(o.i, el.from, el.to));
            if (here.length) {
                shared++;
                for (const o of here) {
                    const ce = elementOf[o.i];
                    const ck = ce !== null ? `e${ce}` : `r${runOf[o.i]}`;
                    const c = cross.get(ck) ?? { element: ce, from: o.i, to: o.i, tiles: new Set<string>(), min: Infinity, above: false, below: false };
                    cross.set(ck, c);
                    c.from = Math.min(c.from, o.i);
                    c.to = Math.max(c.to, o.i);
                    c.tiles.add(k);
                    for (const z of t.zs) {
                        const d = Math.abs(z - o.z) / 16;
                        c.min = Math.min(c.min, d);
                        minGap = Math.min(minGap, d);
                        if (z > o.z) c.above = true;
                        else if (z < o.z) c.below = true;
                    }
                }
            }
            if (gap === 0) continue;
            // Anneaux de Tchebychev de rayon croissant, jusqu'au meilleur écart déjà trouvé.
            const limit = Math.min(GAP_LIMIT, (gap ?? GAP_LIMIT + 1) - 1);
            for (let r = 0; r <= limit; r++) {
                let hit = false;
                for (let dx = -r; dx <= r && !hit; dx++)
                    for (let dy = -r; dy <= r && !hit; dy++) {
                        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
                        if ((cells.get(key(t.x + dx, t.y + dy)) ?? []).some((o) => far(o.i, el.from, el.to))) hit = true;
                    }
                if (hit) {
                    gap = r;
                    break;
                }
            }
        }
        const crossings: SpaceCrossing[] = [...cross.values()]
            .map((c) => ({
                element: c.element,
                kind: c.element !== null ? parts[c.element].kind : runLabel(pieces, c.from, c.to),
                from: c.element !== null ? parts[c.element].from : c.from,
                to: c.element !== null ? parts[c.element].to : c.to,
                tiles: c.tiles.size,
                minLevelGap: c.min,
                side: (c.above && c.below ? "mêlé" : c.below ? "dessous" : "dessus") as SpaceCrossing["side"],
            }))
            .sort((a, b) => b.tiles - a.tiles || a.from - b.from);
        elements.push({
            ...el,
            tiles: own.size,
            nearestGap: gap,
            shared,
            minLevelGap: shared ? minGap : null,
            crossings,
            isolated: shared === 0 && (gap === null || gap >= 2),
        });
    }

    let stackedTiles = 0;
    for (const list of cells.values()) if (list.some((a) => list.some((b) => indexDistance(a.i, b.i) > NEIGHBOUR_SPAN))) stackedTiles++;

    const v = area ? largestEmptyRect(w, h, (x, y) => cells.has(key(fp.x1 + x, fp.y1 + y))) : null;
    return {
        closed,
        footprint: { ...fp, w: Math.max(w, 0), h: Math.max(h, 0), area },
        trackTiles: cells.size,
        coverage: area ? cells.size / area : 0,
        stackedTiles,
        largestVoid: v ? { x: fp.x1 + v.x, y: fp.y1 + v.y, w: v.w, h: v.h, share: v.w * v.h / area } : null,
        elements,
        isolated: elements.flatMap((e, i) => (e.isolated ? [i] : [])),
    };
}

/** Intervalles libres [bas, haut[ (niveaux) d'une tuile. */
export type FreeIntervals = [number, number][];

/**
 * Volume libre (P6) : pour chaque tuile du rectangle, les intervalles de niveaux libres entre le sol et `maxLevel`,
 * compte tenu du dégagement réel des blocs du circuit (`blockSpan`) et, si `get` est donné, du terrain, de l'eau,
 * des chemins (3 niveaux, comme `blockProblem`) et des pièces d'attraction déjà posées (`ri`). Sert à proposer où empiler.
 */
export function freeVolume(
    table: SegmentTable,
    pieces: Piece[],
    rect: { x1: number; y1: number; x2: number; y2: number },
    opts: { clearance: number; maxLevel: number; get?: TileGetter },
): Map<string, FreeIntervals> {
    const busy = new Map<string, [number, number][]>();
    const add = (x: number, y: number, a: number, b: number): void => {
        const k = key(x, y);
        const list = busy.get(k);
        if (list) list.push([a, b]);
        else busy.set(k, [[a, b]]);
    };
    for (const p of pieces) {
        const seg = table.get(p.type);
        if (!seg) continue;
        for (const b of pieceElements(p, seg)) {
            const [a, c] = blockSpan(b, opts.clearance);
            add(b.x, b.y, a / 16, c / 16);
        }
    }
    const out = new Map<string, FreeIntervals>();
    for (let x = rect.x1; x <= rect.x2; x++)
        for (let y = rect.y1; y <= rect.y2; y++) {
            const t = opts.get?.(x, y);
            const floor = t ? groundTopZ(t) / 16 : 0;
            const spans = [...(busy.get(key(x, y)) ?? [])];
            for (const p of t?.p ?? []) spans.push([p.l, p.l + 3]);
            // `ri` inclut aussi les pièces déjà posées du circuit : elles recouvrent leurs propres blocs, sans effet.
            for (const s of t?.ri ?? []) spans.push([s[0], s[1]]);
            spans.sort((a, b) => a[0] - b[0]);
            const free: FreeIntervals = [];
            let lo = floor;
            for (const [a, b] of spans) {
                if (a > lo) free.push([lo, Math.min(a, opts.maxLevel)]);
                lo = Math.max(lo, b);
                if (lo >= opts.maxLevel) break;
            }
            if (lo < opts.maxLevel) free.push([lo, opts.maxLevel]);
            out.set(key(x, y), free.filter(([a, b]) => b > a));
        }
    return out;
}
