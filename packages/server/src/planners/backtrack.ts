import type { TrackPieceInfo } from "@openrct2-claude/protocol";
import { firstDrop } from "./target.js";
import {
    Occupancy,
    blockProblem,
    groundMix,
    boundsProblem,
    compileMacros,
    endPose,
    pieceElements,
    type Macro,
    type RideTrackInfo,
    type SegmentTable,
    type TrackBlock,
    type TrackBounds,
    type TrackEnv,
    type TrackPose,
} from "./track.js";

type Piece = TrackPieceInfo & { chain?: boolean; brakeSpeed?: number; name?: string };

/** Pièces retirées au plus par un repli (une première chute de 60 niveaux et ce qui suit). */
const MAX_UNDO = 40;
/** Points de coupe essayés, du plus proche du bout au plus lointain. */
const MAX_CUTS = 3;
/** Hauteurs de première chute essayées par coupe. */
const MAX_DROPS = 4;
/** Pas entre deux hauteurs de chute essayées (niveaux). */
const DROP_STEP = 3;

export interface Retreat {
    /** Pièces à retirer au bout du circuit (coaster_undo { count }). */
    undo: number;
    /** Macros à poser après le retrait (avant la fin cherchée). */
    macros: Macro[];
    /** Circuit après retrait et relance : préfixe de la nouvelle recherche. */
    prefix: Piece[];
    start: TrackPose;
    occupancy: Occupancy;
    label: string;
}

/**
 * Replis possibles quand aucune fin ne part du bout du circuit (« Black Widow Sidewinder », Haiku, 9 octobre 2026 : la
 * première chute droite finissait au sol entre une autre attraction et deux chemins, 150 fermetures sans issue ; la
 * chute arrêtée 7 niveaux plus haut tournait au-dessus des chemins). Coupe le circuit sur une pose plate et droite,
 * jamais dans le lift, au plus `MAX_UNDO` pièces en arrière. Si la coupe retire la première chute, la relance la refait
 * moins haute (de `DROP_STEP` en `DROP_STEP` jusqu'à `dropMin`) : la fin cherchée peut alors tourner au-dessus des
 * obstacles du sol. Sinon la recherche repart de la coupe telle quelle. Chaque relance est vérifiée (circuit gardé,
 * terrain, chemins, autres attractions, bounds).
 */
export function retreatOptions(
    table: SegmentTable,
    ride: RideTrackInfo,
    pieces: Piece[],
    env: TrackEnv,
    clearance: number,
    opts: { bounds?: TrackBounds; zMin?: number; dropMin?: number } = {},
): Retreat[] {
    const fd = firstDrop(table, pieces);
    let lastChain = -1;
    pieces.forEach((p, i) => {
        if (p.chain) lastChain = i;
    });
    // On garde au moins le lift entier (sommet compris) : sa hauteur fait la vitesse du circuit.
    const minKeep = (fd ? fd.liftEnd : lastChain) + 1;
    if (minKeep <= 0) return [];
    const cuts: number[] = [];
    for (let k = pieces.length - 1; k >= minKeep && pieces.length - k <= MAX_UNDO && cuts.length < MAX_CUTS; k--) {
        const pose = endPose(pieces[k - 1], table.require(pieces[k - 1].type));
        if (pose.slope === 0 && pose.bank === 0 && (pose.rot & 4) === 0) cuts.push(k);
    }
    const out: Retreat[] = [];
    for (const k of cuts) {
        const kept = pieces.slice(0, k);
        const start = endPose(kept[k - 1], table.require(kept[k - 1].type));
        const restarts: { macros: Macro[]; label: string }[] = [];
        if (fd && fd.height > 0 && k <= fd.end) {
            const min = Math.max(4, opts.dropMin ?? Math.ceil(fd.height * 0.6));
            const heights: number[] = [];
            for (let h = fd.height - DROP_STEP; h >= min && heights.length < MAX_DROPS; h -= DROP_STEP) heights.push(h);
            if (heights.length < MAX_DROPS && min < fd.height && !heights.includes(min)) heights.push(min);
            for (const h of heights)
                restarts.push({
                    macros: [{ op: "drop", height: h, steep: fd.steep > 0 }],
                    label: `première chute refaite moins haute : ${h} niveaux au lieu de ${fd.height}, la fin tourne plus haut`,
                });
        } else {
            restarts.push({ macros: [], label: `${pieces.length - k} dernière(s) pièce(s) retirée(s), fin cherchée depuis la pose plate précédente` });
        }
        for (const r of restarts) {
            const c = r.macros.length ? compileMacros(table, ride, start, r.macros) : { pieces: [], end: start, errors: [] };
            if (c.errors.length) continue;
            const occ = new Occupancy(clearance);
            for (const p of kept) occ.add(pieceElements(p, table.require(p.type)));
            if (!fitsAfter(table, c.pieces, occ, env, opts.bounds, opts.zMin ?? 16)) continue;
            out.push({ undo: pieces.length - k, macros: r.macros, prefix: [...kept, ...c.pieces], start: c.end, occupancy: occ, label: r.label });
        }
    }
    return out;
}

/** Pose `added` dans `occ` (déjà rempli du circuit gardé) si chaque pièce passe ; faux au premier obstacle. */
function fitsAfter(table: SegmentTable, added: Piece[], occ: Occupancy, env: TrackEnv, bounds: TrackBounds | undefined, zMin: number): boolean {
    // La pièce posée juste avant partage ses tuiles de bord avec la suivante : on la compare au circuit sans elle.
    let prev: TrackBlock[] = [];
    const pending = new Occupancy(occ.clearance);
    for (const p of added) {
        const el = pieceElements(p, table.require(p.type));
        if (pending.conflict(el)) return false;
        for (const e of el) if (e.z < zMin || blockProblem(env, e) || (bounds && boundsProblem(bounds, e))) return false;
        if (groundMix(env, el)) return false;
        pending.add(prev);
        prev = el;
    }
    // Circuit gardé : seulement à partir de la deuxième pièce (la première touche la dernière pièce gardée).
    for (const p of added.slice(1)) if (occ.conflict(pieceElements(p, table.require(p.type)))) return false;
    for (const p of added) occ.add(pieceElements(p, table.require(p.type)));
    return true;
}

/**
 * Tuiles libres atteignables, au niveau de `pose`, depuis le bout d'un circuit ouvert (remplissage 4-connexe, sans
 * monter ni descendre). Obstacles : terrain, chemins et files d'attente, entrées, autres attractions, grande scénerie
 * (`blockProblem`), circuit déjà posé à ce niveau, bounds. S'arrête à `limit`. Une petite valeur signale une poche :
 * la fin du circuit devra remonter au-dessus des obstacles avant de pouvoir tourner.
 */
export function roomAhead(env: TrackEnv, occ: Occupancy, pose: TrackPose, bounds: TrackBounds | undefined, limit: number): number {
    const seen = new Set<string>();
    const queue: [number, number][] = [[pose.x, pose.y]];
    seen.add(`${pose.x},${pose.y}`);
    let n = 0;
    while (queue.length && n < limit) {
        const [x, y] = queue.shift()!;
        const b: TrackBlock = { x, y, z: pose.z, cz: 0 };
        if (blockProblem(env, b) || (bounds && boundsProblem(bounds, b)) || occ.conflict([b])) continue;
        n++;
        for (const [dx, dy] of [
            [1, 0],
            [-1, 0],
            [0, 1],
            [0, -1],
        ]) {
            const key = `${x + dx},${y + dy}`;
            if (seen.has(key)) continue;
            seen.add(key);
            queue.push([x + dx, y + dy]);
        }
    }
    return n;
}
