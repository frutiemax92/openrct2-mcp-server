// Mesures d'espace d'un circuit (COASTER_SPACE.md, section 3) : découpage en éléments, proximité entre parties non
// voisines du parcours, empilement, plus grand vide et volume libre. Fonctions pures, à partir des pièces seules
// (et, pour le volume libre, du cache de carte). Unités : tuiles, niveaux (16 unités monde).

import type { TrackPieceInfo } from "@openrct2-claude/protocol";
import { elementKind } from "./speed.js";
import { STATION_TYPES, SegmentTable, beginPose, blockSpan, endPose, groundTopZ, pieceElements, samePose, type TileGetter, type TrackBlock } from "./track.js";

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

// ---------------------------------------------------------------------------
// Relief : verticalité du circuit (COASTER_SPACE.md, section 8)
// ---------------------------------------------------------------------------

export interface ReliefElement {
    kind: string;
    from: number;
    to: number;
    /** Plus bas et plus haut niveau atteints (au-dessus de la station), et l'écart. */
    low: number;
    high: number;
    span: number;
}

export interface ReliefProfile {
    /** Pièces à 60° et à 90° (virages d'1 tuile compris), pièces qui passent ou restent à l'envers. */
    steepPieces: number;
    verticalPieces: number;
    invertedPieces: number;
    /** Montée totale sur l'élan, hors chaîne (niveaux) : l'énergie que le parcours rend en hauteur. */
    climbAfterLift: number;
    /** Hauteur moyenne au-dessus du point le plus bas du circuit (niveaux, pondérée par la longueur). */
    meanHeight: number;
    /** Point le plus haut de chaque cinquième du parcours (niveaux au-dessus de la station). */
    peakByFifth: number[];
    /** Éléments hors station, lift et freins, avec leur écart de hauteur. */
    elements: ReliefElement[];
}

/** Relief d'un circuit (pièces dans l'ordre de marche) : verticalité, hauteur par section, écart de hauteur par élément. */
export function reliefProfile(table: SegmentTable, pieces: Piece[]): ReliefProfile {
    const station = pieces.find((p) => STATION_TYPES.has(p.type));
    const z0 = station ? (station.z + table.require(station.type).beginZ) / 16 : 0;
    let steep = 0;
    let vertical = 0;
    let inverted = 0;
    let climb = 0;
    let length = 0;
    const rows: { s: number; len: number; begin: number; end: number; low: number; high: number }[] = [];
    for (const p of pieces) {
        const seg = table.get(p.type);
        if (!seg) continue;
        const name = SegmentTable.nameOf(p.type);
        if (/90/.test(name)) vertical++;
        else if (/60/.test(name)) steep++;
        if (seg.beginBank === 15 || seg.endBank === 15) inverted++;
        const begin = (p.z + seg.beginZ) / 16 - z0;
        const end = (p.z + seg.endZ) / 16 - z0;
        const zs = [seg.beginZ, seg.endZ, ...seg.elements.map((e) => e.z)].map((z) => (p.z + z) / 16 - z0);
        const len = Math.max(seg.length, 1) / 32;
        // Montée sur l'élan : jusqu'au point haut de la pièce (sommet d'une inversion), hors chaîne et station.
        if (!p.chain && !STATION_TYPES.has(p.type)) climb += Math.max(0, Math.max(...zs) - begin);
        rows.push({ s: length, len, begin, end, low: Math.min(...zs), high: Math.max(...zs) });
        length += len;
    }
    const lowest = rows.length ? Math.min(...rows.map((r) => r.low)) : 0;
    const meanHeight = length ? rows.reduce((a, r) => a + r.len * ((r.begin + r.end) / 2 - lowest), 0) / length : 0;
    const peakByFifth = [0, 1, 2, 3, 4].map((f) => {
        const inFifth = rows.filter((r) => r.s >= (f * length) / 5 && r.s < ((f + 1) * length) / 5);
        return inFifth.length ? Math.max(...inFifth.map((r) => r.high)) : 0;
    });
    const indexOf = new Map<number, number>();
    let k = 0;
    pieces.forEach((p, i) => {
        if (table.get(p.type)) indexOf.set(i, k++);
    });
    const elements = spaceElements(pieces)
        .filter((e) => e.kind !== "station" && e.kind !== "lift" && e.kind !== "brakes")
        .map((e) => {
            const rs = rows.slice(indexOf.get(e.from) ?? 0, (indexOf.get(e.to) ?? 0) + 1);
            const low = Math.min(...rs.map((r) => r.low));
            const high = Math.max(...rs.map((r) => r.high));
            return { ...e, low, high, span: high - low };
        });
    return { steepPieces: steep, verticalPieces: vertical, invertedPieces: inverted, climbAfterLift: climb, meanHeight, peakByFifth, elements };
}

/** Écart de hauteur à partir duquel un élément compte comme « haut » (grande demi-boucle, quart de boucle, montée verticale). */
export const TALL_SPAN = 8;

/** Vue compacte du relief pour les réponses des outils (1 ligne par élément haut). */
export function reliefView(r: ReliefProfile): Record<string, unknown> {
    return {
        steepPieces: r.steepPieces,
        verticalPieces: r.verticalPieces,
        invertedPieces: r.invertedPieces,
        climbAfterLift: r.climbAfterLift,
        meanHeight: Math.round(r.meanHeight * 10) / 10,
        peakByFifth: r.peakByFifth,
        tallElements: r.elements.filter((e) => e.span >= TALL_SPAN).map((e) => `${e.kind} (pièces ${e.from}-${e.to}) L${e.low}→${e.high}`),
    };
}

/**
 * Leviers de relief : ce qui rend le circuit plus plat que la référence, rédigé comme les leviers de note. Rien si le
 * circuit est aussi vertical qu'elle.
 */
export function reliefLevers(ride: ReliefProfile, ref: ReliefProfile): string[] {
    const out: string[] = [];
    const tall = (r: ReliefProfile) => r.elements.filter((e) => e.span >= TALL_SPAN);
    if (ref.verticalPieces > ride.verticalPieces)
        out.push(`pièces verticales (90°) ${ride.verticalPieces} contre ${ref.verticalPieces} dans la référence : dive, quarter_loop ou vertical_drop`);
    if (tall(ref).length > tall(ride).length)
        out.push(`éléments hauts (≥ ${TALL_SPAN} niveaux) ${tall(ride).length} contre ${tall(ref).length} : ${tall(ref).map((e) => `${e.kind} L${e.low}→${e.high}`).join(", ")}`);
    ref.peakByFifth.forEach((h, f) => {
        if (h - ride.peakByFifth[f] >= 4) out.push(`${f + 1}e cinquième du parcours : point haut L${ride.peakByFifth[f]} contre L${h} ; remonte plus haut sur l'élan (quart de boucle, demi-boucle, montée raide)`);
    });
    if (ref.climbAfterLift - ride.climbAfterLift >= 8) out.push(`montée totale sur l'élan ${ride.climbAfterLift} niveaux contre ${ref.climbAfterLift}`);
    return out;
}

// ---------------------------------------------------------------------------
// Vue et leviers d'espace (COASTER_SPACE.md, sections 4.1 et 4.2)
// ---------------------------------------------------------------------------

const pct = (x: number): number => Math.round(x * 100);
const lvl = (x: number): number => Math.round(x * 10) / 10;

/** Une ligne par élément : écart au reste du circuit, tuiles partagées et croisement principal. */
function elementLine(e: ElementSpace): string {
    const c = e.crossings[0];
    return (
        `${e.kind} (${e.from}-${e.to}) : voisin ${e.nearestGap ?? ">4"}, partagées ${e.shared}` +
        (e.minLevelGap !== null ? ` à ${lvl(e.minLevelGap)} niv` : "") +
        (c ? ` ; ${c.side} ${c.kind} (${c.tiles} t)` : "") +
        (e.isolated ? " — ISOLÉ" : "")
    );
}

/** Vue compacte du profil d'espace pour les réponses des outils. */
export function spaceView(p: SpaceProfile, opts: { elements?: boolean } = {}): Record<string, unknown> {
    const lift = p.elements.find((e) => e.kind === "lift");
    return {
        footprint: `${p.footprint.w}×${p.footprint.h} (${p.footprint.area} tuiles)`,
        coveragePct: pct(p.coverage),
        stackedTiles: p.stackedTiles,
        largestVoid: p.largestVoid ? `${p.largestVoid.w}×${p.largestVoid.h} en (${p.largestVoid.x},${p.largestVoid.y}), ${pct(p.largestVoid.share)} %` : null,
        liftShared: lift ? lift.shared : undefined,
        isolated: p.isolated.map((i) => elementLine(p.elements[i])),
        elements: opts.elements === false ? undefined : p.elements.map(elementLine),
    };
}

/**
 * Rectangle à imposer (`bounds` de coaster_build_plan) pour imiter une référence : son emprise majorée de `margin`
 * (10 % par défaut, COASTER_SPACE 4.2), en largeur × hauteur. À placer sur une zone libre.
 */
export function suggestedBounds(p: SpaceProfile, margin = 0.1): { w: number; h: number; hint: string } {
    const w = Math.ceil(p.footprint.w * (1 + margin));
    const h = Math.ceil(p.footprint.h * (1 + margin));
    return {
        w,
        h,
        hint:
            `coaster_build_plan { bounds: { x1, y1, x2: x1 + ${w - 1}, y2: y1 + ${h - 1} }, reference: { ride | design } } (ou ${h}×${w} tourné) : ` +
            "bounds borne l'emprise, reference impose la longueur de piste (fermeture refusée sous 90 %) ; la même longueur dans la même emprise donne la densité. " +
            "Laisse de la place des deux côtés du lift : la seconde moitié passe dessous.",
    };
}

/**
 * Leviers d'espace : ce qui rend le circuit moins compact que la référence, rédigé comme les leviers de note
 * (COASTER_SPACE 4.1). Vide si le circuit est au moins aussi compact.
 */
export function spaceLevers(ride: SpaceProfile, ref: SpaceProfile): string[] {
    const out: string[] = [];
    const ratio = ref.footprint.area ? ride.footprint.area / ref.footprint.area : 1;
    const sides = [ride.footprint.w, ride.footprint.h].sort((a, b) => b - a);
    const refSides = [ref.footprint.w, ref.footprint.h].sort((a, b) => b - a);
    if (ratio > 1.1 || sides[0] > refSides[0] * 1.2 || sides[1] > refSides[1] * 1.2) {
        out.push(
            `emprise ${ride.footprint.w}×${ride.footprint.h} = ${ride.footprint.area} tuiles, ${ratio.toFixed(2)} × la référence (${ref.footprint.w}×${ref.footprint.h}) : ` +
                `reconstruis dans bounds ${suggestedBounds(ref).w}×${suggestedBounds(ref).h}`,
        );
    }
    if (ref.coverage - ride.coverage >= 0.05) out.push(`couverture ${pct(ride.coverage)} % contre ${pct(ref.coverage)} % : la piste occupe trop peu de son emprise`);
    if (ride.stackedTiles < ref.stackedTiles * 0.7)
        out.push(`tuiles empilées ${ride.stackedTiles} contre ${ref.stackedTiles} : fais passer la seconde moitié sous le lift, sous la première chute et à travers les grandes inversions`);
    const refLift = ref.elements.find((e) => e.kind === "lift");
    const lift = ride.elements.find((e) => e.kind === "lift");
    if (refLift && lift && refLift.shared > 0 && lift.shared < refLift.shared / 2) {
        const under = refLift.crossings.map((c) => `${c.kind} ${c.tiles} t à ${lvl(c.minLevelGap)} niv`).join(", ");
        out.push(`lift : ${lift.shared} tuile(s) partagée(s) contre ${refLift.shared} dans la référence (${under})`);
    }
    if (ride.largestVoid && (!ref.largestVoid || ride.largestVoid.share > ref.largestVoid.share + 0.05)) {
        const v = ride.largestVoid;
        out.push(`vide ${v.w}×${v.h} en (${v.x},${v.y}), ${pct(v.share)} % de l'emprise (référence : ${ref.largestVoid ? pct(ref.largestVoid.share) : 0} %) : remplis-le (hélice, virages en pente) ou resserre l'emprise`);
    }
    if (ride.isolated.length > ref.isolated.length)
        out.push(`éléments isolés ${ride.isolated.length} contre ${ref.isolated.length} : ${ride.isolated.map((i) => `${ride.elements[i].kind} (${ride.elements[i].from}-${ride.elements[i].to})`).join(", ")}`);
    return out;
}
