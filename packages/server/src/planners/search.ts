// Recherche de section sous contraintes (COASTER_REFERENCE P4, COASTER_SPACE étape 5) : recherche en faisceau sur des
// suites de macros, du bout du circuit jusqu'à la station, dans une emprise imposée. Chaque branche est compilée
// (compileMacros), contrôlée (collisions, terrain, bounds), simulée par morceaux, puis notée sur l'empilement (piste
// au-dessus ou au-dessous d'un autre élément, dessous du lift), la longueur et le style (S-bends, longues droites,
// répétitions, éléments hors de leur fenêtre de vitesse). L'arrivée en gare est imposée : freins droits puis frein de
// bloc collés à la station. Quand les trains exigés demandent plus de sections que la station, le lift et cette arrivée,
// le vocabulaire gagne des freins de bloc de mi-parcours (`blockElements`), contrôlés à la fermeture (repartie,
// espacement). Les branches assez longues sont refermées par A* sans chaîne (un seul lift) jusqu'au début de ces
// freins, et le circuit complet est simulé d'un seul tenant. Fonctions pures : la simulation et le jugement de vitesse
// sont fournis par l'appelant.

import type { TrackPieceInfo, TrackSegmentInfo } from "@openrct2-claude/protocol";
import { slowBanks, type PieceSpeed } from "./speed.js";
import { spaceProfile, type SpaceProfile } from "./space.js";
import { BLOCK_BRAKE_NAMES, RESTART_WINDOW, TAIL_CONTEXT, blockBrakeRestartWarnings } from "./stall.js";
import {
    beginPose,
    blockProblem,
    blockBrakesBeforeLift,
    blockBoundaries,
    blockSections,
    boundsProblem,
    compileMacros,
    exitProblem,
    layoutStats,
    leadInProblem,
    pieceElements,
    pieceEndingAt,
    planClosure,
    poseKey,
    samePose,
    SegmentTable,
    type LayoutStats,
    type Macro,
    type Occupancy,
    type PlannedPiece,
    type RideTrackInfo,
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
    /**
     * Simulation depuis une pièce (`simulate(…, { startPiece })`) : repartie d'un frein de bloc fermé, queue du train
     * comprise (`blockBrakeRestartWarnings`). Sans elle, les freins de bloc de mi-parcours ne sont pas contrôlés.
     */
    simulateFrom?: (pieces: Piece[], vStartMph: number, startPiece: number) => PieceSpeed[];
    /** Avertissements de vitesse (fenêtres des designs RCT2) d'une suite de pièces nouvelles et de leurs vitesses. */
    judge: (pieces: PlannedPiece[], sim: PieceSpeed[], macros: Macro[]) => string[];
    /** Vitesse au bout du préfixe (mph). */
    vStart: number;
    /** Longueur totale du circuit fermé, en tuiles de piste. */
    minTiles: number;
    maxTiles: number;
    /** Trains permis exigés (sections de bloc − 1). */
    minTrains?: number;
    /** Pièces à 60° et à 90° exigées dans le circuit fermé, préfixe compris (forme de la référence). */
    minSteep?: number;
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
    /** Lancé depuis la station (pas de lift) : les freins de bloc peuvent suivre la station (`blockBrakesBeforeLift`). */
    stationLaunch?: boolean;
    /** Longueur du train (tuiles) : un frein de bloc au pied du lift doit le tenir hors de la station. */
    trainTiles?: number;
    /**
     * Inversions exigées dans le circuit fermé, préfixe compris (« avec une boucle verticale ») : récompensées dans le
     * faisceau, fermeture refusée en dessous. Le vocabulaire doit en contenir.
     */
    minInversions?: number;
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
    /** Arrivée imposée impossible (piste ou obstacle devant la station) : tuile fautive et cause. */
    approachBlocked?: string;
    /** Bout du début en impasse : aucun élément ne peut en partir (tuile fautive et cause, voir `exitProblem`). */
    exitBlocked?: string;
    /** Freins de l'arrivée imposée (n brakes + block_brakes), donnés même si elle est bloquée. */
    approachBrakes?: number;
    /** Freins de bloc de mi-parcours qu'il fallait poser en plus de l'arrivée pour `minTrains`. */
    midBlocks: number;
    /** Fermetures écartées, par cause (diagnostic quand aucune variante ne reste). */
    rejected: Record<string, number>;
    /** Passes du faisceau (largeur doublée à chaque passe tant qu'il manque des variantes et qu'il reste du temps). */
    passes?: number;
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
    /** Pièces à 60° et à 90° posées par la branche. */
    steep: number;
    /** Inversions posées par la branche. */
    inversions: number;
    straightRun: number;
    lastTurn: TurnSide | null;
    lastOp: string | null;
    /** Freins de bloc de mi-parcours posés par la branche. */
    blocks: number;
    /** Indice (dans `pieces`) du dernier frein de bloc de mi-parcours, -1 sans. */
    blockAt: number;
    /** Piste depuis la dernière limite de section (préfixe compris), en tuiles. */
    sinceMark: number;
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
        // Chaque taille : sans taille, compileMacros prend la plus grande, qui cale souvent (boucle de bois large ou medium :
        // plus de 80 km/h à l'entrée, quand la boucle verticale small des designs RCT2 passe à ~65 km/h).
        for (const kind of opts.inversions ?? [])
            for (const size of ["small", "medium", "large"] as const) v.push([{ op: "inversion", kind: kind as never, dir, size }]);
    }
    for (const steep of [false, true]) {
        for (const height of [2, 4, 6, 8, 10]) v.push([{ op: "hill", height, steep }]);
        for (const height of [2, 4, 6, 8]) v.push([{ op: "climb", height, steep }]);
        for (const height of [2, 4, 6, 8, 10]) v.push([{ op: "drop", height, steep }]);
    }
    v.push([{ op: "straight", length: 1 }], [{ op: "straight", length: 2 }], [{ op: "level" }]);
    return v;
}

/**
 * Freins de bloc de mi-parcours (une section de plus par élément) : freins droits ou plat, puis le frein de bloc. Le
 * frein arrêté tient la tête du train, la queue repose sur les pièces d'avant : il faut un plat au moins aussi long
 * que le train, sinon la queue restée dans la montée le tire en arrière (`blockBrakeRestartWarnings`).
 */
export function blockElements(): Macro[][] {
    const v: Macro[][] = [];
    for (const length of [1, 2, 3, 4]) v.push([{ op: "brakes", length }, { op: "block_brakes" }]);
    for (const length of [2, 3, 4]) v.push([{ op: "straight", length }, { op: "block_brakes" }]);
    return v;
}
const isBlockElement = (m: Macro[]) => m.some((x) => x.op === "block_brakes");
const isInversionMacro = (m: Macro): boolean => m.op === "inversion" || m.op === "loop";
/** Élément qui commence par descendre : seul permis après un frein de bloc (le train en repart à ~7 km/h). */
const startsDown = (m: Macro): boolean =>
    m.op === "drop" || (m.op === "turn" && (m.slope === "down" || m.slope === "steep_down")) || (m.op === "helix" && m.down !== false);

// Poids de la note d'une branche.
/** Seuil de la pénalité de G latéraux (RideRatings.cpp, penaltyLateralGs : 2,8 G). */
const LATERAL_G_PENALTY = 2.8;
const W_STACK = 3;
const W_LIFT = 2;
const W_TILE = 0.4;
const W_WARN = 6;
const W_SBEND = 12;
const W_STRAIGHT = 2;
const W_REPEAT = 4;
/** Chutes (collines, descentes) récompensées jusqu'à `targetDrops` : le style « camelback » de Black Widow. */
const W_DROP = 6;
/** Frein de bloc de mi-parcours exigé par les trains : sans lui, aucune fermeture n'est acceptée. */
const W_BLOCK = 20;
/** Par inversion manquante (minInversions) : sans ce poids, la branche qui cale le moins (sans boucle) l'emporte. */
const W_INV = 20;
/** Par pièce raide manquante (minSteep) : Black Widow plonge et remonte à 60°, une seconde moitié à 25° ne lui ressemble pas. */
const W_STEEP = 8;
/**
 * Retour vers la station : par tuile de distance (Manhattan) que la longueur encore à poser ne couvre plus. Sans ce
 * terme, le faisceau large garde les branches qui s'éloignent et meurent au plafond de longueur (Black Widow Plus de
 * Haiku, 8 octobre 2026 : longueur atteinte à 21-31 tuiles de la station, 9 fermetures tentées sur 120 branches).
 */
const W_HOME = 3;
/** Largeur maximale du faisceau atteinte par les passes successives. */
const MAX_BEAM = 640;
const isSteepPiece = (type: number): boolean => /60|90/.test(SegmentTable.nameOf(type));

function styleScore(b: Branch, targetDrops: number): number {
    return W_DROP * Math.min(b.drops, targetDrops) - W_REPEAT * b.repeats;
}

function rescore(b: Branch, targetDrops: number, midBlocks: number, steepNeed = 0, home?: { distance: number; minTiles: number }, invNeed = 0): number {
    // La longueur ne rapporte que jusqu'à la cible ; au-delà, seul le retour compte.
    const tiles = home ? Math.min(b.tiles, home.minTiles) : b.tiles;
    const overshoot = home ? Math.max(0, home.distance - Math.max(0, home.minTiles - b.tiles)) : 0;
    return (
        styleScore(b, targetDrops) +
        W_STEEP * Math.min(b.steep, steepNeed) +
        W_INV * Math.min(b.inversions, invNeed) +
        W_BLOCK * Math.min(b.blocks, midBlocks) +
        W_STACK * b.stack +
        W_LIFT * b.liftStack +
        W_TILE * tiles -
        W_HOME * overshoot -
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
 * Arrivée en gare imposée par les trains (`brakes` freins droits + frein de bloc devant la station) et sa place :
 * pièces d'arrivée dans bounds et libres, puis assez de place derrière pour y entrer (`leadInProblem`). `occ` contient
 * l'arrivée ; `target` est la pose où la fin du circuit doit la rejoindre ; `blocked` dit pourquoi aucune fin ne peut y
 * arriver (contrôlé par coaster_build_plan dès le début du circuit, et par searchSection avant le faisceau).
 */
export function arrivalFor(input: {
    table: SegmentTable;
    ride: RideTrackInfo;
    goal: TrackPose;
    prefix: Piece[];
    minTrains?: number;
    approachBrakes?: number;
    closureCatalog: TrackSegmentInfo[];
    occupancy: Occupancy;
    env: TrackEnv;
    bounds?: TrackBounds;
    zMin?: number;
}): { approach: PlannedPiece[]; target: TrackPose; occ: Occupancy; brakes: number; blocked?: string } {
    const { table } = input;
    const needBlock = blockSections(input.prefix).maxTrains < (input.minTrains ?? 1);
    const brakes = input.approachBrakes ?? (needBlock ? 2 : 0);
    const occ = input.occupancy.clone();
    let approach: PlannedPiece[] = [];
    let target = input.goal;
    if (needBlock || input.approachBrakes) {
        const a = approachPieces(table, input.ride, input.goal, brakes);
        const why = !a
            ? "pièces de frein indisponibles"
            : a
                  .flatMap((p) => pieceElements(p, table.require(p.type)))
                  .map((e) => {
                      const cause = occ.conflict([e]) ? "piste" : (blockProblem(input.env, e) ?? (input.bounds ? boundsProblem(input.bounds, e) : null));
                      return cause && `(${e.x},${e.y}) niveau ${e.z / 16} : ${cause}`;
                  })
                  .find((x) => x);
        if (!a || why) return { approach, target, occ, brakes, blocked: why ?? "pièces de frein impossibles devant la station" };
        approach = a;
        target = beginPose(a[0], table.require(a[0].type));
        for (const p of a) occ.add(pieceElements(p, table.require(p.type)));
    }
    // Pas la place d'entrer dans l'arrivée (bord de bounds, terrain, piste juste derrière) : toute fermeture A* échouerait.
    const leadIn = leadInProblem(input.closureCatalog, target, occ, input.env, input.bounds, input.zMin);
    if (leadIn) return { approach, target, occ, brakes, blocked: `entrée de l'arrivée en (${target.x},${target.y}) : aucune pièce n'y mène, ${leadIn}` };
    return { approach, target, occ, brakes };
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

    // Arrivée imposée, réservée dans l'occupation avant toute branche.
    const arrival = arrivalFor({ ...input, closureCatalog, prefix: input.prefix, minTrains, approachBrakes: input.approachBrakes, zMin });
    if (arrival.blocked)
        return {
            candidates: [],
            expansions: 0,
            closures: 0,
            elapsedMs: elapsed(),
            timedOut: false,
            approachBlocked: arrival.blocked,
            approachBrakes: arrival.brakes,
            midBlocks: 0,
            rejected: {},
        };
    const { approach, target, occ: occ0, brakes } = arrival;
    // Impasse au bout du début : inutile de lancer le faisceau (et d'accuser bounds ou la référence).
    const exitBlocked = exitProblem(table, input.ride, input.start, occ0, input.env, input.bounds, zMin);
    if (exitBlocked)
        return { candidates: [], expansions: 0, closures: 0, elapsedMs: elapsed(), timedOut: false, exitBlocked, approachBrakes: brakes, midBlocks: 0, rejected: {} };
    const approachTiles = approach.reduce((s, p) => s + Math.max(table.require(p.type).length, 1) / 32, 0);
    // Sections encore à créer à mi-parcours : station, sommets de lift et freins du début, plus le frein d'arrivée.
    const midBlocks = Math.max(0, minTrains + 1 - prefixBlocks.sections - (approach.length ? 1 : 0));
    const steepNeed = Math.max(0, (input.minSteep ?? 0) - input.prefix.filter((p) => isSteepPiece(p.type)).length);
    const invNeed = Math.max(0, (input.minInversions ?? 0) - layoutStats(table, input.prefix).inversions);
    const vocabAll = midBlocks && !vocab.some(isBlockElement) ? [...vocab, ...blockElements()] : vocab;
    // Section minimale (comme `blockSpacing`) : 2 trains, ou la moitié de la section moyenne du circuit visé. Un frein de
    // bloc n'est proposé qu'à cette distance de la dernière limite (sommet du lift, frein précédent) ; la note le
    // récompense, et sans ce seuil le faisceau le pose collé au lift, ce que la fermeture refuse ensuite.
    const minSection = Math.max(2 * (input.trainTiles ?? 4), input.minTiles / (minTrains + 1) / 2);
    const prefixMarks = blockBoundaries(input.prefix);
    const lastMark = prefixMarks.length ? prefixMarks[prefixMarks.length - 1].index : 0;
    const prefixTail = input.prefix.slice(lastMark + 1).reduce((t, p) => t + Math.max(table.get(p.type)?.length ?? 32, 1) / 32, 0);
    const rejected: Record<string, number> = {};
    const reject = (why: string) => {
        rejected[why] = (rejected[why] ?? 0) + 1;
    };

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
        steep: 0,
        inversions: 0,
        straightRun: 0,
        lastTurn: null,
        lastOp: null,
        blocks: 0,
        blockAt: -1,
        sinceMark: prefixTail,
        tailSim: [],
        score: 0,
    };

    const candidates: SearchCandidate[] = [];
    const seenClosures = new Set<string>();
    let expansions = 0;
    let closures = 0;
    let timedOut = false;
    const manhattan = (p: TrackPose) => Math.abs(p.x - target.x) + Math.abs(p.y - target.y);

    const len = (p: Piece) => Math.max(table.get(p.type)?.length ?? 32, 1) / 32;
    /**
     * Freins de bloc de mi-parcours de la branche (indices [from, to[ du circuit fermé) : sections voisines d'au moins
     * max(2 × train, moitié de la section moyenne) tuiles (comme `blockSpacing`), et repartie sans calage ni recul.
     */
    const midBlockProblem = (all: Piece[], from: number, to: number): string | null => {
        const marks = blockBoundaries(all);
        const total = all.reduce((t, p) => t + len(p), 0);
        const minTiles = Math.max(2 * (input.trainTiles ?? 4), total / marks.length / 2);
        // Le seuil de la branche (`minSection`) suit la longueur visée ; ici la longueur réelle : 10 % de marge.
        const minGap = Math.min(minTiles, minSection) * 0.9;
        const tilesBetween = (a: number, z: number) => {
            let t = 0;
            for (let i = a; i !== z; i = (i + 1) % all.length) t += len(all[i]);
            return t;
        };
        for (let k = 0; k < marks.length; k++) {
            const m = marks[k];
            if (m.kind !== "block" || m.index < from || m.index >= to) continue;
            const prev = marks[(k - 1 + marks.length) % marks.length];
            const next = marks[(k + 1) % marks.length];
            if (tilesBetween(prev.index, m.index) < minGap || tilesBetween(m.index, next.index) < minGap) return "freins de bloc mal espacés";
        }
        if (input.simulateFrom) {
            const restart = blockBrakeRestartWarnings(all, (slice, v, startPiece) => input.simulateFrom!(slice, v, startPiece));
            if (restart.length) return "frein de bloc qui ne repart pas";
        }
        return null;
    };

    const tryClose = (b: Branch) => {
        if (b.tiles + manhattan(b.end) < input.minTiles || b.tiles > input.maxTiles) return;
        if (manhattan(b.end) > 14) return;
        const ck = poseKey(b.end) + "|" + Math.round(b.tiles);
        if (seenClosures.has(ck)) return;
        seenClosures.add(ck);
        closures++;
        if (b.blocks < midBlocks) return reject("frein de bloc de mi-parcours manquant");
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
            if (!res) return reject("fermeture A* introuvable");
            link = res.pieces;
        }
        const closure = [...link, ...approach];
        const all = [...input.prefix, ...b.pieces, ...closure];
        const layout = layoutStats(table, all);
        if (layout.lengthTiles < input.minTiles || layout.lengthTiles > input.maxTiles) return reject("longueur hors cible");
        if (layout.blocks.maxTrains < minTrains) return reject("trop peu de sections de bloc");
        const steep = all.filter((p) => isSteepPiece(p.type)).length;
        if (input.minSteep && steep < input.minSteep) return reject("trop peu de pièces raides");
        if (input.minInversions && layout.inversions < input.minInversions) return reject("trop peu d'inversions");
        if (blockBrakesBeforeLift(all, { stationLaunch: input.stationLaunch, table, trainTiles: input.trainTiles }).some((b) => b.index >= input.prefix.length))
            return reject("frein de bloc avant le lift");
        // Un frein de bloc déjà posé dans le début repart aussi sur la section cherchée : contrôlé même sans midBlocks.
        if (midBlocks || prefixBlocks.blockBrakes) {
            const why = midBlockProblem(all, input.prefix.length, input.prefix.length + b.pieces.length);
            if (why) return reject(why);
        }
        const sim = input.simulateCircuit(all);
        if (sim.some((s) => s.stall || s.reached === false)) return reject("calage");
        const newPieces = [...b.pieces, ...closure];
        const newSim = sim.slice(input.prefix.length);
        // G latéraux prédits au-delà de la pénalité du jeu (+3,75 d'intensité) : candidat écarté, quel que soit le score.
        if (newSim.some((s) => (s.gLat ?? 0) > LATERAL_G_PENALTY)) return reject("G latéraux > 2,8");
        // Virage incliné à plat abordé au pas (sommet du lift) : écarté comme à la pose.
        if (slowBanks(table, all, sim, input.prefix.length).length) return reject("virage incliné trop lent");
        const warnings = input.judge(newPieces, newSim, b.macros);
        const sBends = b.sBends;
        const space = spaceProfile(table, all, { closed: true });
        const liftShared = space.elements.find((e) => e.kind === "lift")?.shared ?? 0;
        const minKmh = Math.round(Math.min(...newSim.map((s) => s.vMin)) * 1.609);
        const score =
            W_STACK * space.stackedTiles +
            (input.minSteep ? W_STEEP * Math.min(steep, 2 * input.minSteep) : 0) +
            W_LIFT * liftShared +
            40 * space.coverage -
            W_WARN * warnings.length -
            W_SBEND * sBends +
            styleScore(b, targetDrops) -
            0.5 * link.length -
            8 * space.isolated.length;
        candidates.push({ macros: b.macros, pieces: b.pieces, closure, score, layout, space, liftShared, warnings, sBends, minKmh });
    };

    // Passes successives, faisceau doublé à chaque fois, tant qu'il manque des variantes et qu'il reste du temps : une
    // passe s'arrête à maxDepth (ou quand le faisceau s'éteint) bien avant timeMs, et la largeur qui ferme varie d'un
    // site à l'autre (Black Widow Plus : 24 à 60 ne ferment pas, 90 oui).
    const distinct = () => new Set(candidates.map((c) => JSON.stringify(c.macros.slice(0, -1)))).size;
    let passes = 0;
    for (let width = beamWidth; width <= MAX_BEAM && !timedOut && distinct() < wanted; width *= 2) {
        passes++;
        let beam: Branch[] = [root];
        for (let depth = 0; depth < maxDepth && beam.length && !timedOut; depth++) {
            const next = new Map<string, Branch>();
            for (const b of beam) {
                if (elapsed() > timeMs) {
                    timedOut = true;
                    break;
                }
                const macroIndex = b.macros.length;
                for (const m of vocabAll) {
                    const block = isBlockElement(m);
                    if (block && (b.blocks >= midBlocks || b.sinceMark < minSection)) continue;
                    if (b.lastOp === "block_brakes" && !startsDown(m[0])) continue;
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
                    // Plus assez de longueur pour rentrer : branche morte.
                    if (!ok || b.tiles + tiles + manhattan(compiled.end) > input.maxTiles) continue;
                    occ.add(prev);
                    // Vitesse par morceaux : les 3 dernières pièces de la branche donnent l'élan du train.
                    const tail = b.pieces.slice(b.pieces.length - b.tailSim.length);
                    const sim = input.speedOf([...tail, ...compiled.pieces], b.tailSim[0]?.vIn ?? b.v).slice(tail.length);
                    if (sim.some((s) => s.stall || s.reached === false)) continue;
                    // Virage incliné au pas (après un frein de bloc, au sommet d'une colline) : branche morte dès la pose.
                    if (slowBanks(table, compiled.pieces, sim).length) continue;
                    const macros = [...b.macros, ...m];
                    const pieces = [...b.pieces, ...compiled.pieces.map((p) => ({ ...p, macro: p.macro === undefined ? undefined : macroIndex + p.macro }))];
                    // Repartie du frein de bloc de mi-parcours contrôlée dès la pose, puis à chaque élément tant qu'il est dans la
                    // fenêtre de repartie : un calage ne disparaît pas avec les pièces suivantes. Sans ce contrôle, le faisceau
                    // garde des centaines de descendantes d'un frein condamné, toutes refusées à la fermeture (Black Widow Loop
                    // de Haiku, 8 octobre 2026 : 493 fermetures sur 745 écartées pour le même frein en (43,70)).
                    let blockAt = b.blockAt;
                    if (block) for (let i = b.pieces.length; i < pieces.length; i++) if (BLOCK_BRAKE_NAMES.has(SegmentTable.nameOf(pieces[i].type))) blockAt = i;
                    if (blockAt >= 0 && input.simulateFrom && b.pieces.length - blockAt <= RESTART_WINDOW) {
                        const all = [...input.prefix, ...pieces];
                        const at = input.prefix.length + blockAt;
                        const slice = all.slice(Math.max(0, at - TAIL_CONTEXT));
                        if (blockBrakeRestartWarnings(slice, (s, v, start) => input.simulateFrom!(s, v, start)).length) continue;
                    }
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
                        steep: b.steep + compiled.pieces.filter((p) => isSteepPiece(p.type)).length,
                        inversions: b.inversions + m.filter(isInversionMacro).length,
                        straightRun,
                        lastTurn: m.every((x) => sideOf(x)) ? side : null,
                        lastOp: m[m.length - 1].op,
                        blocks: b.blocks + (block ? 1 : 0),
                        blockAt,
                        sinceMark: block ? 0 : b.sinceMark + tiles,
                        tailSim: [...b.tailSim, ...sim].slice(-3),
                        score: 0,
                    };
                    nb.score = rescore(nb, targetDrops, midBlocks, steepNeed, { distance: manhattan(nb.end), minTiles: input.minTiles }, invNeed);
                    const k = poseKey(nb.end);
                    const cur = next.get(k);
                    if (!cur || cur.score < nb.score) next.set(k, nb);
                }
            }
            beam = [...next.values()].sort((a, b) => b.score - a.score).slice(0, width);
            for (const b of beam) {
                if (elapsed() > timeMs) {
                    timedOut = true;
                    break;
                }
                tryClose(b);
            }
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
    return { candidates: out, expansions, closures, elapsedMs: elapsed(), timedOut, midBlocks, rejected, passes };
}

