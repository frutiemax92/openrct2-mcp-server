// Recherche de section sous contraintes (COASTER_REFERENCE P4, COASTER_SPACE étape 5) : recherche en faisceau sur des
// suites de macros, du bout du circuit jusqu'à la station, dans une emprise imposée. Chaque branche est compilée
// (compileMacros), contrôlée (collisions, terrain, bounds), simulée par morceaux, puis notée sur l'empilement (piste
// au-dessus ou au-dessous d'un autre élément, dessous du lift), la longueur et le style (S-bends, longues droites,
// répétitions, éléments hors de leur fenêtre de vitesse). L'arrivée en gare est imposée : freins droits puis frein de
// bloc collés à la station. Les branches assez longues sont refermées par A* sans chaîne (un seul lift) jusqu'au début
// de ces freins, et le circuit complet est simulé d'un seul tenant. Fonctions pures : la simulation et le jugement de
// vitesse sont fournis par l'appelant.

import type { TrackPieceInfo, TrackSegmentInfo } from "@openrct2-claude/protocol";
import type { PieceSpeed } from "./speed.js";
import { spaceProfile, type SpaceProfile } from "./space.js";
import {
    beginPose,
    blockProblem,
    blockSections,
    boundsProblem,
    compileMacros,
    layoutStats,
    pieceElements,
    pieceEndingAt,
    planClosure,
    poseKey,
    samePose,
    type LayoutStats,
    type Macro,
    type Occupancy,
    type PlannedPiece,
    type RideTrackInfo,
    type SegmentTable,
    type TrackBounds,
    type TrackEnv,
    type TrackPose,
    type TurnSide,
} from "./track.js";

type Piece = TrackPieceInfo & { chain?: boolean; brakeSpeed?: number };

export interface SearchInput {
    table: SegmentTable;
    ride: RideTrackInfo;
    /** Circuit déjà posé, station comprise, dans l'ordre (le dernier finit à `start`). */
    prefix: Piece[];
    start: TrackPose;
    /** Pose d'entrée de la station. */
    goal: TrackPose;
    occupancy: Occupancy;
    env: TrackEnv;
    bounds?: TrackBounds;
    /** Catalogue de la fermeture (searchCatalog). */
    closureCatalog: TrackSegmentInfo[];
    /** Vitesses d'une suite de pièces à partir de vStart (mph) ; sert par morceaux pendant la recherche. */
    speedOf: (pieces: Piece[], vStart: number) => PieceSpeed[];
    /** Vitesses du circuit complet depuis la station (vérification finale). */
    simulateCircuit: (pieces: Piece[]) => PieceSpeed[];
    /** Avertissements de vitesse (fenêtres des designs RCT2) d'une suite de pièces nouvelles et de leurs vitesses. */
    judge: (pieces: PlannedPiece[], sim: PieceSpeed[], macros: Macro[]) => string[];
    /** Vitesse au bout du préfixe (mph). */
    vStart: number;
    /** Longueur totale du circuit fermé, en tuiles de piste. */
    minTiles: number;
    maxTiles: number;
    /** Trains permis exigés (sections de bloc − 1). */
    minTrains?: number;
    /**
     * Freins droits avant le frein de bloc collé à la station (défaut 2 si un frein de bloc manque pour minTrains,
     * sinon aucune arrivée imposée).
     */
    approachBrakes?: number;
    vocabulary?: Macro[][];
    beamWidth?: number;
    maxDepth?: number;
    timeMs?: number;
    results?: number;
    /** Niveau absolu minimal des blocs (unités monde). */
    zMin?: number;
    /** Collines et descentes souhaitées dans la section (défaut 5). */
    targetDrops?: number;
    /** Quarts d'hélice permis dans la section (défaut 4 : une hélice complète au plus). */
    maxHelixQuarters?: number;
}

export interface SearchCandidate {
    macros: Macro[];
    pieces: PlannedPiece[];
    /** Fermeture A* puis arrivée imposée (freins, frein de bloc). */
    closure: PlannedPiece[];
    score: number;
    layout: LayoutStats;
    space: SpaceProfile;
    liftShared: number;
    warnings: string[];
    sBends: number;
    minKmh: number;
}

export interface SearchResult {
    candidates: SearchCandidate[];
    expansions: number;
    closures: number;
    elapsedMs: number;
    timedOut: boolean;
    /** Arrivée imposée impossible (piste ou obstacle devant la station). */
    approachBlocked?: string;
}

interface Branch {
    macros: Macro[];
    pieces: PlannedPiece[];
    end: TrackPose;
    occ: Occupancy;
    tiles: number;
    v: number;
    /** Tuile -> indice de la dernière macro qui y a posé de la piste. */
    own: Map<string, number>;
    stack: number;
    liftStack: number;
    warnings: number;
    sBends: number;
    repeats: number;
    helixQuarters: number;
    drops: number;
    straightRun: number;
    lastTurn: TurnSide | null;
    lastOp: string | null;
    /** Vitesses des 3 dernières pièces : élan du morceau suivant. */
    tailSim: PieceSpeed[];
    score: number;
}

const tkey = (x: number, y: number) => `${x},${y}`;
const sideOf = (m: Macro): TurnSide | null => (m.op === "turn" || m.op === "helix" ? m.dir : null);

/** Vocabulaire par défaut : virages inclinés, hélices, collines, montées et descentes, courtes droites. */
export function defaultVocabulary(opts: { inversions?: string[] } = {}): Macro[][] {
    const v: Macro[][] = [];
    for (const dir of ["left", "right"] as const) {
        for (const size of ["small", "medium", "large"] as const)
            for (const quarters of [1, 2])
                for (const slope of ["flat", "up", "down"] as const) v.push([{ op: "turn", dir, size, banked: true, quarters, slope }]);
        for (const slope of ["steep_up", "steep_down"] as const) v.push([{ op: "turn", dir, slope }]);
        for (const size of ["small", "large"] as const) for (const quarters of [2, 4]) for (const down of [false, true]) v.push([{ op: "helix", dir, quarters, down, size }]);
        for (const kind of opts.inversions ?? []) v.push([{ op: "inversion", kind: kind as never, dir }]);
    }
    for (const steep of [false, true]) {
        for (const height of [2, 4, 6, 8, 10]) v.push([{ op: "hill", height, steep }]);
        for (const height of [2, 4, 6, 8]) v.push([{ op: "climb", height, steep }]);
        for (const height of [2, 4, 6, 8, 10]) v.push([{ op: "drop", height, steep }]);
    }
    v.push([{ op: "straight", length: 1 }], [{ op: "straight", length: 2 }], [{ op: "level" }]);
    return v;
}

// Poids de la note d'une branche.
const W_STACK = 3;
const W_LIFT = 2;
const W_TILE = 0.4;
const W_WARN = 6;
const W_SBEND = 12;
const W_STRAIGHT = 2;
const W_REPEAT = 4;
/** Chutes (collines, descentes) récompensées jusqu'à `targetDrops` : le style « camelback » de Black Widow. */
const W_DROP = 6;

function styleScore(b: Branch, targetDrops: number): number {
    return W_DROP * Math.min(b.drops, targetDrops) - W_REPEAT * b.repeats;
}

function rescore(b: Branch, targetDrops: number): number {
    return (
        styleScore(b, targetDrops) +
        W_STACK * b.stack +
        W_LIFT * b.liftStack +
        W_TILE * b.tiles -
        W_WARN * b.warnings -
        W_SBEND * b.sBends -
        W_STRAIGHT * Math.max(0, b.straightRun - 3)
    );
}

/**
 * Arrivée imposée : `brakes` freins droits puis un frein de bloc qui finit à l'entrée de la station, construits à
 * rebours depuis la station puis recompilés (drapeaux de freins). null si une pièce manque dans la table.
 */
function approachPieces(table: SegmentTable, ride: RideTrackInfo, goal: TrackPose, brakes: number): PlannedPiece[] | null {
    const block = table.byName("blockBrakes");
    const brake = table.byName("brakes");
    if (!block || !brake) return null;
    let pose = goal;
    for (const seg of [block, ...Array.from({ length: brakes }, () => brake)]) {
        const p = pieceEndingAt(pose, seg);
        if (!p) return null;
        pose = beginPose(p, seg);
    }
    const macros: Macro[] = brakes ? [{ op: "brakes", length: brakes }, { op: "block_brakes" }] : [{ op: "block_brakes" }];
    const r = compileMacros(table, ride, pose, macros);
    if (r.errors.length || !samePose(r.end, goal)) return null;
    return r.pieces.map((p) => ({ ...p, macro: undefined }));
}

/**
 * Cherche les meilleures fins de circuit. Le faisceau garde `beamWidth` branches par profondeur (une par pose, la
 * mieux notée) ; chaque branche dont la longueur permet de fermer est refermée par A* (sans chaîne) jusqu'à l'arrivée
 * imposée, et le circuit complet est simulé : refusé s'il cale, noté sinon sur l'empilement, la couverture et le style.
 */
export function searchSection(input: SearchInput): SearchResult {
    const t0 = Date.now();
    const timeMs = input.timeMs ?? 40_000;
    const beamWidth = input.beamWidth ?? 40;
    const maxDepth = input.maxDepth ?? 16;
    const wanted = input.results ?? 5;
    const vocab = input.vocabulary ?? defaultVocabulary();
    const zMin = input.zMin ?? 16;
    const targetDrops = input.targetDrops ?? 5;
    const maxHelix = input.maxHelixQuarters ?? 4;
    // Fermeture sans S-bend (décalage latéral sans changer de direction).
    const closureCatalog = input.closureCatalog.filter((seg) => !(seg.endY !== 0 && seg.endDirection === seg.beginDirection));
    const { table } = input;
    const elapsed = () => Date.now() - t0;

    const prefixTiles = input.prefix.reduce((a, p) => a + Math.max(table.get(p.type)?.length ?? 32, 1) / 32, 0);
    const liftTiles = new Set<string>();
    const prefixTileSet = new Set<string>();
    for (const p of input.prefix) {
        const seg = table.get(p.type);
        if (!seg) continue;
        for (const e of pieceElements(p, seg)) {
            prefixTileSet.add(tkey(e.x, e.y));
            if (p.chain) liftTiles.add(tkey(e.x, e.y));
        }
    }
    const minTrains = input.minTrains ?? 1;
    const prefixBlocks = blockSections(input.prefix);
    const needBlock = prefixBlocks.maxTrains < minTrains;
    const brakes = input.approachBrakes ?? (needBlock ? 2 : 0);

    // Arrivée imposée, réservée dans l'occupation avant toute branche.
    const occ0 = input.occupancy.clone();
    let approach: PlannedPiece[] = [];
    let target = input.goal;
    if (needBlock || input.approachBrakes) {
        const a = approachPieces(table, input.ride, input.goal, brakes);
        const why = !a
            ? "pièces de frein indisponibles"
            : a.flatMap((p) => pieceElements(p, table.require(p.type))).map((e) => (occ0.conflict([e]) ? "piste" : blockProblem(input.env, e) ?? (input.bounds ? boundsProblem(input.bounds, e) : null))).find((x) => x);
        if (!a || why) return { candidates: [], expansions: 0, closures: 0, elapsedMs: elapsed(), timedOut: false, approachBlocked: why ?? "?" };
        approach = a;
        target = beginPose(a[0], table.require(a[0].type));
        for (const p of a) occ0.add(pieceElements(p, table.require(p.type)));
    }
    const approachTiles = approach.reduce((s, p) => s + Math.max(table.require(p.type).length, 1) / 32, 0);

    const root: Branch = {
        macros: [],
        pieces: [],
        end: input.start,
        occ: occ0,
        tiles: prefixTiles + approachTiles,
        v: input.vStart,
        own: new Map(),
        stack: 0,
        liftStack: 0,
        warnings: 0,
        sBends: 0,
        repeats: 0,
        helixQuarters: 0,
        drops: 0,
        straightRun: 0,
        lastTurn: null,
        lastOp: null,
        tailSim: [],
        score: 0,
    };

    const candidates: SearchCandidate[] = [];
    const seenClosures = new Set<string>();
    let expansions = 0;
    let closures = 0;
    let timedOut = false;
    const manhattan = (p: TrackPose) => Math.abs(p.x - target.x) + Math.abs(p.y - target.y);

    const tryClose = (b: Branch) => {
        if (b.tiles + manhattan(b.end) < input.minTiles || b.tiles > input.maxTiles) return;
        if (manhattan(b.end) > 14) return;
        const ck = poseKey(b.end) + "|" + Math.round(b.tiles);
        if (seenClosures.has(ck)) return;
        seenClosures.add(ck);
        closures++;
        let link: PlannedPiece[];
        if (samePose(b.end, target)) link = [];
        else {
            const res = planClosure(closureCatalog, b.end, target, b.occ, input.env, {
                maxPieces: 16,
                maxExpansions: 4000,
                zMin,
                bounds: input.bounds,
                chainClimbs: false,
            });
            if (!res) return;
            link = res.pieces;
        }
        const closure = [...link, ...approach];
        const all = [...input.prefix, ...b.pieces, ...closure];
        const layout = layoutStats(table, all);
        if (layout.lengthTiles < input.minTiles || layout.lengthTiles > input.maxTiles) return;
        if (layout.blocks.maxTrains < minTrains) return;
        const sim = input.simulateCircuit(all);
        if (sim.some((s) => s.stall || s.reached === false)) return;
        const newPieces = [...b.pieces, ...closure];
        const newSim = sim.slice(input.prefix.length);
        const warnings = input.judge(newPieces, newSim, b.macros);
        const sBends = b.sBends;
        const space = spaceProfile(table, all, { closed: true });
        const liftShared = space.elements.find((e) => e.kind === "lift")?.shared ?? 0;
        const minKmh = Math.round(Math.min(...newSim.map((s) => s.vMin)) * 1.609);
        const score =
            W_STACK * space.stackedTiles +
            W_LIFT * liftShared +
            40 * space.coverage -
            W_WARN * warnings.length -
            W_SBEND * sBends +
            styleScore(b, targetDrops) -
            0.5 * link.length -
            8 * space.isolated.length;
        candidates.push({ macros: b.macros, pieces: b.pieces, closure, score, layout, space, liftShared, warnings, sBends, minKmh });
    };

    let beam: Branch[] = [root];
    for (let depth = 0; depth < maxDepth && beam.length && !timedOut; depth++) {
        const next = new Map<string, Branch>();
        for (const b of beam) {
            if (elapsed() > timeMs) {
                timedOut = true;
                break;
            }
            const macroIndex = b.macros.length;
            for (const m of vocab) {
                if (b.helixQuarters + m.reduce((a, x) => a + (x.op === "helix" ? x.quarters : 0), 0) > maxHelix) continue;
                const compiled = compileMacros(table, input.ride, b.end, m);
                if (compiled.errors.length || !compiled.pieces.length) continue;
                expansions++;
                const occ = b.occ.clone();
                // Les blocs de la pièce précédente sont voisins par construction (tuiles partagées par les huitièmes).
                const last = b.pieces[b.pieces.length - 1] ?? input.prefix[input.prefix.length - 1];
                let prev = last ? pieceElements(last, table.require(last.type)) : [];
                const isPrev = (x: number, y: number) => prev.some((q) => q.x === x && q.y === y);
                let ok = true;
                let stack = 0;
                let liftStack = 0;
                let tiles = 0;
                const placed = new Set<string>();
                for (const p of compiled.pieces) {
                    const el = pieceElements(p, table.require(p.type));
                    if (occ.conflict(el)) {
                        ok = false;
                        break;
                    }
                    for (const e of el) {
                        if (e.z < zMin || blockProblem(input.env, e) || (input.bounds && boundsProblem(input.bounds, e))) {
                            ok = false;
                            break;
                        }
                        const k = tkey(e.x, e.y);
                        if (placed.has(k) || isPrev(e.x, e.y)) continue;
                        placed.add(k);
                        // Empilement : sur le circuit existant, ou sur un élément de la branche posé au moins 2 macros plus tôt.
                        const mine = b.own.get(k);
                        if (prefixTileSet.has(k) || (mine !== undefined && mine <= macroIndex - 2)) {
                            stack++;
                            if (liftTiles.has(k)) liftStack++;
                        }
                    }
                    if (!ok) break;
                    occ.add(prev);
                    prev = el;
                    tiles += Math.max(table.require(p.type).length, 1) / 32;
                }
                if (!ok || b.tiles + tiles > input.maxTiles) continue;
                occ.add(prev);
                // Vitesse par morceaux : les 3 dernières pièces de la branche donnent l'élan du train.
                const tail = b.pieces.slice(b.pieces.length - b.tailSim.length);
                const sim = input.speedOf([...tail, ...compiled.pieces], b.tailSim[0]?.vIn ?? b.v).slice(tail.length);
                if (sim.some((s) => s.stall || s.reached === false)) continue;
                const macros = [...b.macros, ...m];
                const pieces = [...b.pieces, ...compiled.pieces.map((p) => ({ ...p, macro: p.macro === undefined ? undefined : macroIndex + p.macro }))];
                const warn = input.judge(pieces.slice(b.pieces.length), sim, macros).length;
                const side = m.map(sideOf).find((s) => s) ?? null;
                // S-bend : virage opposé juste après un virage, sans élément entre les deux.
                const sBend = sideOf(m[0]) && b.lastTurn && side && side !== b.lastTurn ? 1 : 0;
                let straightRun = b.straightRun;
                for (const p of compiled.pieces) straightRun = p.name === "flat" ? straightRun + 1 : 0;
                const own = new Map(b.own);
                for (const k of placed) own.set(k, macroIndex);
                const nb: Branch = {
                    macros,
                    pieces,
                    end: compiled.end,
                    occ,
                    tiles: b.tiles + tiles,
                    v: sim[sim.length - 1].vOut,
                    own,
                    stack: b.stack + stack,
                    liftStack: b.liftStack + liftStack,
                    warnings: b.warnings + warn,
                    sBends: b.sBends + sBend,
                    repeats: b.repeats + (m[0].op === b.lastOp ? 1 : 0),
                    helixQuarters: b.helixQuarters + m.reduce((a, x) => a + (x.op === "helix" ? x.quarters : 0), 0),
                    drops: b.drops + m.filter((x) => (x.op === "hill" || x.op === "drop") && x.height >= 3).length,
                    straightRun,
                    lastTurn: m.every((x) => sideOf(x)) ? side : null,
                    lastOp: m[m.length - 1].op,
                    tailSim: [...b.tailSim, ...sim].slice(-3),
                    score: 0,
                };
                nb.score = rescore(nb, targetDrops);
                const k = poseKey(nb.end);
                const cur = next.get(k);
                if (!cur || cur.score < nb.score) next.set(k, nb);
            }
        }
        beam = [...next.values()].sort((a, b) => b.score - a.score).slice(0, beamWidth);
        for (const b of beam) {
            if (elapsed() > timeMs) {
                timedOut = true;
                break;
            }
            tryClose(b);
        }
    }
    candidates.sort((a, b) => b.score - a.score);
    // Variantes distinctes : une par suite de macros jusqu'à l'avant-dernière.
    const out: SearchCandidate[] = [];
    const seen = new Set<string>();
    for (const c of candidates) {
        const k = JSON.stringify(c.macros.slice(0, -1));
        if (seen.has(k)) continue;
        seen.add(k);
        out.push(c);
        if (out.length >= wanted) break;
    }
    return { candidates: out, expansions, closures, elapsedMs: elapsed(), timedOut };
}

