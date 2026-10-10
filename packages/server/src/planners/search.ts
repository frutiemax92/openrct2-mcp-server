// Recherche de section sous contraintes (COASTER_REFERENCE P4, COASTER_SPACE étape 5) : recherche en faisceau sur des
// suites de macros, du bout du circuit jusqu'à la station, dans une emprise imposée. Chaque branche est compilée
// (compileMacros), contrôlée (collisions, terrain, bounds), simulée par morceaux, puis notée sur la compacité (trous que
// la piste enferme vu de dessus, COASTER_SPACE 7 tervicies), la longueur et le style (S-bends, longues droites,
// répétitions, éléments hors de leur fenêtre de vitesse). L'arrivée en gare est imposée : freins droits puis frein de
// bloc collés à la station. Quand les trains exigés demandent plus de sections que la station, le lift et cette arrivée,
// le vocabulaire gagne des freins de bloc de mi-parcours (`blockElements`), contrôlés à la fermeture (repartie,
// espacement). Les branches assez longues sont refermées par A* sans chaîne (un seul lift) jusqu'au début de ces
// freins, et le circuit complet est simulé d'un seul tenant. Fonctions pures : la simulation et le jugement de vitesse
// sont fournis par l'appelant.

import type { TrackPieceInfo, TrackSegmentInfo } from "@openrct2-claude/protocol";
import type { RatingEstimate } from "./estimate.js";
import { slowBanks, type PieceSpeed } from "./speed.js";
import { spaceProfile, type SpaceProfile } from "./space.js";
import { BLOCK_BRAKE_NAMES, RESTART_WINDOW, TAIL_CONTEXT, blockBrakeRestartWarnings } from "./stall.js";
import {
    beginPose,
    blockProblem,
    GROUND_MIX,
    groundMix,
    blockBrakesBeforeLift,
    blockBoundaries,
    blockSections,
    boundsProblem,
    groundTopZ,
    compileMacros,
    costToGoal,
    endPose,
    exitProblem,
    isSBend,
    layoutStats,
    leadInProblem,
    pieceElements,
    pieceEndingAt,
    planClosure,
    poseKey,
    samePose,
    SegmentTable,
    STATION_TYPES,
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
    /**
     * Notes estimées du circuit fermé (estimateRatings) : chaque fermeture est notée sur son excitation estimée, et
     * écartée sous `minExcitement` (COASTER_SPACE 7 novodecies).
     */
    estimate?: (all: Piece[]) => RatingEstimate | null;
    /**
     * Notes du circuit ouvert (début + branche, estimateRatings { open }) : avec `targetExcitement`, le faisceau classe ses
     * meilleures branches sur leur excitation jusque-là (plafonnée à l'objectif), pas seulement sur la compacité.
     */
    estimatePartial?: (all: Piece[]) => RatingEstimate | null;
    minExcitement?: number;
    /**
     * Début qui finit au sommet du lift avec une excitation demandée : le premier élément est la première chute (raide,
     * droite ou en diagonale, de la plus haute à la plus basse), gardée seulement si `speed` (vitesse au bas de la chute,
     * circuit entier) atteint `minKmh`. Sans elle, la recherche partait d'un virage au pas au sommet (« Custom Wooden
     * Loop », Haiku, 9 octobre 2026 : 6,35 au mieux pour 7,5).
     */
    firstDrop?: { minKmh: number; speed: (all: Piece[]) => number | null };
    /** Excitation visée : tant qu'aucune variante ne l'atteint (estimation), les passes continuent jusqu'à timeMs. */
    targetExcitement?: number;
    /**
     * mph² par niveau de hauteur (SpeedModel.K) : hauteur d'énergie d'une branche = niveau + v² / K. Le frottement ne
     * fait que la baisser ; sans chaîne, une branche dont la hauteur d'énergie est sous l'entrée de l'arrivée ne peut plus
     * y monter : coupée dès la pose. Sans elle, la recherche de Timber Loop (Haiku, 9 octobre 2026, station à 15
     * niveaux du sol) gardait des centaines de branches arrivées 3 à 9 niveaux sous la station à 30-45 km/h, toutes
     * refusées par la fermeture A*.
     */
    energyK?: number;
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
    /** Notes estimées du circuit fermé (si `estimate`). */
    estimate?: RatingEstimate;
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
    /**
     * Début sans élan : le bout du circuit est quasi arrêté (freins, frein de bloc) au ras du sol ou du niveau le plus bas
     * permis. Sans chaîne, aucune descente ne peut redonner de vitesse : tout le reste roulerait au pas.
     */
    deadStart?: string;
    /** Meilleure excitation estimée parmi les fermetures écartées pour `minExcitement` (diagnostic). */
    bestRejectedExcitement?: number;
    /** Avec `firstDrop` : vitesse de la plus rapide des premières chutes qui passent (km/h), 0 si aucune ne passe. */
    firstDropKmh?: number;
}

/**
 * Premières chutes essayées depuis le sommet du lift (`SearchInput.firstDrop`) : raide puis à 25°, de `maxHeight` à 2
 * niveaux, en ligne droite ou en diagonale (huitième sans inclinaison au sommet, le train y roule au pas, huitième
 * incliné en bas).
 */
export function firstDropVocabulary(maxHeight: number): Macro[][] {
    const v: Macro[][] = [];
    for (let height = maxHeight; height >= 2; height--)
        for (const steep of [true, false]) {
            v.push([{ op: "drop", height, steep }]);
            for (const dir of ["left", "right"] as const) {
                v.push([{ op: "turn", dir, size: "large", eighths: 1 }, { op: "drop", height, steep }, { op: "turn", dir, size: "large", eighths: 1, banked: true }]);
                // Chute raide qui tourne de 90° à 60° : sans elle, la recherche ne tournait jamais en plongeant.
                if (steep) v.push([{ op: "drop", height, turn: dir }]);
            }
        }
    return v;
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
    /** Tuiles posées à côté (Tchebychev 1) d'une piste plus ancienne, sans être dessus ni dessous. */
    touch: number;
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
    /** Niveaux au-dessus de la station des freins de bloc de mi-parcours posés : la chute qui suit chacun. */
    blockLift: number;
    /** Branche mère (ses macros) : diversité du faisceau. */
    parentKey: string;
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
        for (const height of [10, 14]) v.push([{ op: "drop", height, turn: dir }]);
        for (const size of ["small", "large"] as const) for (const quarters of [2, 4]) for (const down of [false, true]) v.push([{ op: "helix", dir, quarters, down, size }]);
        // Chaque taille : sans taille, compileMacros prend la plus grande, qui cale souvent (boucle de bois large ou medium :
        // plus de 80 km/h à l'entrée, quand la boucle verticale small des designs RCT2 passe à ~65 km/h).
        for (const kind of opts.inversions ?? [])
            for (const size of ["small", "medium", "large"] as const) v.push([{ op: "inversion", kind: kind as never, dir, size }]);
        // Collines et chutes en diagonale : huitième de virage, élément diagonal, huitième de sortie (même côté = virage
        // de 90°, côté opposé = décalage). Sans elles, aucun tracé ne quittait jamais l'orthogonale.
        const eighth = (d: TurnSide): Macro => ({ op: "turn", dir: d, size: "large", eighths: 1, banked: true });
        const other: TurnSide = dir === "left" ? "right" : "left";
        for (const steep of [false, true]) {
            for (const height of [2, 4, 6, 8]) v.push([eighth(dir), { op: "hill", height, steep }, eighth(dir)]);
            for (const height of [4, 8]) v.push([eighth(dir), { op: "drop", height, steep }, eighth(dir)]);
        }
        for (const height of [4, 6]) v.push([eighth(dir), { op: "hill", height }, eighth(other)]);
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
export function blockElements(opts: { climbs?: boolean } = {}): Macro[][] {
    const v: Macro[][] = [];
    for (const length of [1, 2, 3, 4]) v.push([{ op: "brakes", length }, { op: "block_brakes" }]);
    for (const length of [2, 3, 4]) v.push([{ op: "straight", length }, { op: "block_brakes" }]);
    // Montée sur l'élan puis frein de bloc (`blockBrakeWindow`) : au pied d'une grande chute (~90 km/h), il faut 14 à 18
    // niveaux de montée pour l'aborder sous BLOCK_MAX_KMH. Sans cet élément, le faisceau devait empiler des climb de 8
    // au plus avant un frein de bloc à plat, et la chute la plus haute ne se refermait jamais (Timber Ridge, 10 octobre
    // 2026). Seulement quand le faisceau suit l'excitation : ailleurs, ces 8 éléments de plus ralentissaient le faisceau
    // au point de perdre des fins (Black Widow Sidewinder, Timber Loop).
    if (opts.climbs) for (const height of [6, 10, 14, 18]) for (const length of [2, 4]) v.push([{ op: "climb", height }, { op: "brakes", length }, { op: "block_brakes" }]);
    return v;
}
const isBlockElement = (m: Macro[]) => m.some((x) => x.op === "block_brakes");

/**
 * Vitesse d'entrée maximale d'un frein de bloc de mi-parcours. Designs RCT2 : de 7 à 47 km/h (un seul à 52, couvert) ;
 * Haiku (Black Widow Trinity Wood, 9 octobre 2026) en a posé un au bout de 8 droites, à 3 niveaux du sol : abordé à
 * 65 km/h, il en sortait à 39, et la seconde moitié n'avait plus de quoi remonter. Même règle pour la recherche et
 * coaster_build_plan (FREIN DE BLOC LANCÉ).
 */
export const BLOCK_MAX_KMH = 50;
/**
 * Freins droits juste avant un frein de bloc de mi-parcours : au-delà de cette perte (km/h), ils jettent l'énergie qu'une
 * montée garderait en hauteur (FREINS AVANT LE FREIN DE BLOC de coaster_build_plan, même règle dans la recherche).
 */
export const BLOCK_LEAD_SCRUB_KMH = 20;
/** Freins (droits, en diagonale, en descente) et freins de bloc : la course de freinage d'une arrivée ou d'un frein de bloc. */
export const BRAKE_RUN: ReadonlySet<string> = new Set(["brakes", "blockBrakes", "diagBrakes", "diagBlockBrakes", "down25Brakes"]);
const kmhOf = (mph: number): number => Math.round(mph * 1.609);

/**
 * Freins de bloc de mi-parcours mal placés, avec l'indice de la pièce où commence leur approche (freins compris) :
 * - abordés lancés (au-delà de BLOCK_MAX_KMH) : ils freinent pour rien un train rapide, et la suite n'a plus de quoi remonter ;
 * - précédés de freins qui ôtent plus de BLOCK_LEAD_SCRUB_KMH : même défaut, masqué (« Custom Wooden », Haiku, 9 octobre
 *   2026 : 3 brakes au niveau de la station, 92 → 52 km/h, puis le frein de bloc ; il passait parce que le circuit ouvert
 *   finissant sur des freins était pris pour l'arrivée en gare).
 * Permis : arrivée en gare (freins puis station, ou bout du circuit ouvert au niveau de la station à 4 tuiles au plus),
 * avant une chaîne (second lift).
 */
export function fastBlockBrakes(
    pieces: (TrackPieceInfo & { chain?: boolean })[],
    sim: { vIn: number; reached?: boolean }[],
    from: number,
    table: SegmentTable,
    stationStart: TrackPose | null,
): { message: string; approach: number }[] {
    const out: { message: string; approach: number }[] = [];
    for (let i = from; i < pieces.length; i++) {
        const name = SegmentTable.nameOf(pieces[i].type);
        if ((name !== "blockBrakes" && name !== "diagBlockBrakes") || sim[i]?.reached === false) continue;
        let j = i + 1;
        while (j < pieces.length && BRAKE_RUN.has(SegmentTable.nameOf(pieces[j].type))) j++;
        if (j < pieces.length && (STATION_TYPES.has(pieces[j].type) || pieces[j].chain)) continue;
        // Bout de circuit ouvert sur des freins, au niveau de la station et tout près d'elle : l'arrivée, jugée à la fermeture.
        if (j >= pieces.length && stationStart) {
            const last = pieces[pieces.length - 1];
            const end = endPose(last, table.require(last.type));
            if (end.z === stationStart.z && Math.abs(end.x - stationStart.x) + Math.abs(end.y - stationStart.y) <= 4) continue;
        }
        let k = i;
        while (k > 0 && BRAKE_RUN.has(SegmentTable.nameOf(pieces[k - 1].type)) && SegmentTable.nameOf(pieces[k - 1].type) !== "blockBrakes") k--;
        const v = kmhOf(sim[i].vIn);
        const where = `pièce ${i} en (${pieces[i].x},${pieces[i].y}) niveau ${pieces[i].z / 16}`;
        if (v > BLOCK_MAX_KMH)
            out.push({
                approach: k,
                message:
                    `FREIN DE BLOC LANCÉ : ${where}, abordé à ${v} km/h (au plus ${BLOCK_MAX_KMH}) : il freine un train rapide pour rien, et la suite n'a plus de quoi remonter. ` +
                    "Un frein de bloc de mi-parcours se pose là où le train est déjà lent : plat court en haut d'une montée, suivi d'une descente ; ou au pied d'un second lift.",
            });
        else if (k < i && kmhOf(sim[k].vIn) - v > BLOCK_LEAD_SCRUB_KMH)
            out.push({
                approach: k,
                message:
                    `FREINS AVANT LE FREIN DE BLOC : ${where}, les ${i - k} brakes d'avant font tomber le train de ${kmhOf(sim[k].vIn)} à ${v} km/h (au plus ${BLOCK_LEAD_SCRUB_KMH} km/h de perte) : ` +
                    "c'est un frein de bloc lancé déguisé, l'énergie est perdue pour la suite. Une montée sur l'élan ralentit le train autant et garde l'énergie en hauteur.",
            });
    }
    return out;
}

const RESTART_FAIL = "frein de bloc qui ne repart pas";
const isInversionMacro = (m: Macro): boolean => m.op === "inversion" || m.op === "loop";
/** Élément qui commence par descendre : seul permis après un frein de bloc (le train en repart à ~7 km/h). */
const startsDown = (m: Macro): boolean =>
    m.op === "drop" || (m.op === "turn" && (m.slope === "down" || m.slope === "steep_down")) || (m.op === "helix" && m.down !== false);

// Poids de la note d'une branche.
/** Seuil de la pénalité de G latéraux (RideRatings.cpp, penaltyLateralGs : 2,8 G). */
const LATERAL_G_PENALTY = 2.8;
/**
 * Compacité (COASTER_SPACE 7 tervicies). Une fermeture est notée sur son contour vu de dessus (tuiles de piste + trous
 * enfermés) ; une branche ouverte, sur ses tuiles posées sur, sous (W_STACK) ou contre (W_TOUCH) une piste plus
 * ancienne : ni l'un ni l'autre ne laisse de trou. Des trous estimés dans le faisceau (corde droite jusqu'à l'arrivée)
 * l'égaraient : sur le site de Black Widow Sidewinder (backtrack.test.ts), même à 0,25 par tuile, plus aucune fin.
 */
const W_OUTLINE = 2;
const W_STACK = 3;
const W_TOUCH = 1.5;
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
/**
 * Par point d'excitation estimée (sur 10) d'une fermeture : 1 point vaut ~30 tuiles de contour. Sans ce terme, la
 * recherche classait sur l'empilement seul et pouvait garder un tracé lent (Black Widow Diagonal de Haiku, 9 octobre
 * 2026 : 5 km/h de moyenne après des freins de mi-parcours, excitation 2,67).
 */
const W_EXC = 60;
/**
 * Par point d'excitation estimée d'une branche ouverte (`estimatePartial`), jusqu'à l'objectif : une inversion (+0,11)
 * vaut ~10 tuiles empilées. Plus faible, le faisceau gardait les virages compacts plutôt que la boucle au pied de la chute.
 */
const W_EXC_BEAM = 300;
/** Niveaux qu'une première chute posée par la recherche peut laisser au-dessus de la plus haute qui tient. */
export const DROP_SLACK = 2;
/** Branches notées par `estimatePartial` à chaque profondeur : POOL_FACTOR × la largeur du faisceau. */
const POOL_FACTOR = 2;
/**
 * Styles de passe quand le faisceau suit l'excitation (`estimatePartial`) : les passes alternent, puis doublent la
 * largeur. Un frein de bloc baisse la vitesse moyenne, donc l'excitation partielle ; sans une note qui le compense, le
 * faisceau le repoussait au bout du circuit, sans élan pour la fin. Le second style le récompense davantage, d'autant
 * plus haut qu'il est posé (la chute qui le suit), et plafonne les enfants d'une même branche (`maxChildren`). Sur le
 * site de Timber Ridge (10 octobre 2026), chacun trouve l'objectif là où l'autre échoue : depuis le bas de la chute de
 * 24 niveaux, le premier (7,60) ; depuis le sommet du lift, le second (7,79).
 */
interface PassStyle {
    block: number;
    blockLift: number;
    maxChildren: number;
}
const PASS_STYLES: PassStyle[] = [
    { block: W_BLOCK, blockLift: 0, maxChildren: 0 },
    { block: 60, blockLift: 4, maxChildren: 4 },
];
/** Vitesse (mph, ~10 km/h) sous laquelle le train roule au pas (`deadStart`). */
const DEAD_START_MPH = 6.2;
/** Part de la piste qui reste que l'élan d'un bout au sol doit couvrir à plat (`deadStart`). */
const DEAD_START_SHARE = 0.35;
/** Largeur maximale du faisceau atteinte par les passes successives. */
const MAX_BEAM = 640;
const isSteepPiece = (type: number): boolean => /60|90/.test(SegmentTable.nameOf(type));

function styleScore(b: Branch, targetDrops: number): number {
    return W_DROP * Math.min(b.drops, targetDrops) - W_REPEAT * b.repeats;
}

function rescore(
    b: Branch,
    targetDrops: number,
    midBlocks: number,
    steepNeed = 0,
    home?: { distance: number; minTiles: number },
    invNeed = 0,
    style: PassStyle = PASS_STYLES[0],
): number {
    // La longueur ne rapporte que jusqu'à la cible ; au-delà, seul le retour compte.
    const tiles = home ? Math.min(b.tiles, home.minTiles) : b.tiles;
    const overshoot = home ? Math.max(0, home.distance - Math.max(0, home.minTiles - b.tiles)) : 0;
    return (
        styleScore(b, targetDrops) +
        W_STEEP * Math.min(b.steep, steepNeed) +
        W_INV * Math.min(b.inversions, invNeed) +
        style.block * Math.min(b.blocks, midBlocks) +
        style.blockLift * b.blockLift +
        W_STACK * b.stack +
        W_TOUCH * b.touch +
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
                  .flatMap((p) => {
                      const el = pieceElements(p, table.require(p.type));
                      const mix = groundMix(input.env, el);
                      return el.map((e) => {
                          const cause = occ.conflict([e]) ? "piste" : (blockProblem(input.env, e) ?? (input.bounds ? boundsProblem(input.bounds, e) : null) ?? (e === mix ? GROUND_MIX : null));
                          return cause && `(${e.x},${e.y}) niveau ${e.z / 16} : ${cause}`;
                      });
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
    // Fermeture sans S-bend (décalage latéral sans changer de direction) ; les droites diagonales restent.
    const closureCatalog = input.closureCatalog.filter((seg) => !isSBend(seg));
    const { table } = input;
    const elapsed = () => Date.now() - t0;

    const prefixTiles = input.prefix.reduce((a, p) => a + Math.max(table.get(p.type)?.length ?? 32, 1) / 32, 0);
    const prefixTileSet = new Set<string>();
    for (const p of input.prefix) {
        const seg = table.get(p.type);
        if (!seg) continue;
        for (const e of pieceElements(p, seg)) prefixTileSet.add(tkey(e.x, e.y));
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
    // Début sans élan (Black Widow Diagonal de Haiku, 9 octobre 2026 : 6 freins à 10 et un frein de bloc au sol juste après
    // la première chute, puis 3 recherches de 48 s sans fin ; à l'essai, 5 à 7 km/h sur toute la seconde moitié). Au ras
    // du sol, sans chaîne, seul l'élan reste : s'il ne porte pas le train sur une bonne part de la piste qui reste (plat
    // simulé jusqu'à 10 km/h), toute fin roulerait au pas. Inutile de lancer le faisceau.
    const remaining = input.minTiles - prefixTiles - approach.reduce((s, p) => s + Math.max(table.require(p.type).length, 1) / 32, 0);
    if (input.prefix.some((p) => p.chain) && remaining > 0) {
        const ground = input.env.get(input.start.x, input.start.y);
        const floor = Math.max(zMin, ground ? groundTopZ(ground) : zMin);
        if (input.start.z - floor < 32) {
            const coast = compileMacros(table, input.ride, input.start, [{ op: "level" }, { op: "straight", length: 60 }]);
            // Début et plat simulés d'un seul tenant : au bout d'un circuit ouvert, la vitesse de sortie de la dernière pièce
            // est prise avant que le frein (de bloc) n'agisse sur le train.
            const sim = coast.errors.length ? [] : input.simulateCircuit([...input.prefix, ...coast.pieces]).slice(input.prefix.length);
            let tiles = 0;
            for (let i = 0; i < sim.length && sim[i].vOut >= DEAD_START_MPH && !sim[i].stall; i++) tiles += Math.max(table.require(coast.pieces[i].type).length, 1) / 32;
            if (sim.length && tiles < DEAD_START_SHARE * remaining) {
                const deadStart =
                    `le bout du circuit (${input.start.x},${input.start.y}) niveau ${input.start.z / 16} est à ${(input.start.z - floor) / 16} niveau(x) du sol, le train en repart à ${Math.round((sim[0]?.vIn ?? 0) * 1.609)} km/h : ` +
                    `sans chaîne, son élan ne porte le train que sur ~${Math.round(tiles)} tuiles de plat avant 10 km/h, pour ~${Math.round(remaining)} tuiles de piste qui restent`;
                return { candidates: [], expansions: 0, closures: 0, elapsedMs: elapsed(), timedOut: false, deadStart, approachBrakes: brakes, midBlocks: 0, rejected: {} };
            }
        }
    }
    // Coût restant jusqu'à l'arrivée, à rebours, une fois pour toute la recherche (l'arrivée et le début sont fixes) :
    // heuristique exacte de la fermeture A* près de la station, où l'heuristique géométrique s'enlisait dans les poches
    // entre l'arrivée, la station et le bord de bounds (Timber Loop, 10 octobre 2026 : fermetures de 7 à 15 pièces qui
    // demandaient 8 000 à 30 000 expansions, au-delà des 4 000 permises).
    const toGoal = costToGoal(closureCatalog, target, occ0, input.env, { zMin, bounds: input.bounds });
    const approachTiles = approach.reduce((s, p) => s + Math.max(table.require(p.type).length, 1) / 32, 0);
    // Sections encore à créer à mi-parcours : station, sommets de lift et freins du début, plus le frein d'arrivée.
    const midBlocks = Math.max(0, minTrains + 1 - prefixBlocks.sections - (approach.length ? 1 : 0));
    const steepNeed = Math.max(0, (input.minSteep ?? 0) - input.prefix.filter((p) => isSteepPiece(p.type)).length);
    const invNeed = Math.max(0, (input.minInversions ?? 0) - layoutStats(table, input.prefix).inversions);
    const excitementBeam = !!input.estimatePartial && input.targetExcitement !== undefined;
    const vocabAll = midBlocks && !vocab.some(isBlockElement) ? [...vocab, ...blockElements({ climbs: excitementBeam })] : vocab;
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
    let bestRejectedExcitement: number | undefined;
    const dropVocab = input.firstDrop ? firstDropVocabulary(Math.floor((input.start.z - zMin) / 16)) : [];
    let firstDropKmh: number | undefined = input.firstDrop ? 0 : undefined;

    const root: Branch = {
        macros: [],
        pieces: [],
        end: input.start,
        occ: occ0,
        tiles: prefixTiles + approachTiles,
        v: input.vStart,
        own: new Map(),
        stack: 0,
        touch: 0,
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
        blockLift: 0,
        parentKey: "",
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
    // Retour vers la station : la distance au sol plus les niveaux à remonter (une tuile par niveau à 25°).
    const homeDistance = (p: TrackPose) => manhattan(p) + Math.max(0, (target.z - p.z) / 16);
    // Hauteur d'énergie (niveaux) sous l'entrée de l'arrivée : la branche ne peut plus y monter sans chaîne.
    const belowTarget = (z: number, vMph: number) => input.energyK !== undefined && z / 16 + (vMph * vMph) / input.energyK < target.z / 16;

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
            if (restart.length) return RESTART_FAIL;
        }
        return null;
    };

    const tryClose = (b: Branch) => {
        if (b.tiles + manhattan(b.end) < input.minTiles || b.tiles > input.maxTiles) return;
        if (manhattan(b.end) > 14) return;
        // Un frein de bloc de mi-parcours est suivi d'une descente (startsDown), jamais de la fermeture A*, qui repart à plat.
        if (b.lastOp === "block_brakes") return;
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
                costToGo: toGoal,
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
            // Frein de bloc qui repart sur la branche seule : c'est la fermeture A* (montée juste après) qui l'en empêche.
            if (why === RESTART_FAIL && !blockBrakeRestartWarnings([...input.prefix, ...b.pieces], (slice, v, at) => input.simulateFrom!(slice, v, at)).length)
                return reject("fermeture qui empêche la repartie du frein de bloc");
            if (why) return reject(why);
        }
        const sim = input.simulateCircuit(all);
        if (sim.some((s) => s.stall || s.reached === false)) return reject("calage");
        // Freins de bloc jugés sur le circuit entier, comme coaster_build_plan : la vitesse par morceaux du faisceau (élan
        // des 3 dernières pièces) sous-estimait l'entrée (Timber Loop, 10 octobre 2026 : 50 km/h dans le faisceau, 56 à la pose).
        if (fastBlockBrakes(all, sim, input.prefix.length, table, input.goal).length) return reject("frein de bloc abordé trop vite");
        const newPieces = [...b.pieces, ...closure];
        const newSim = sim.slice(input.prefix.length);
        // G latéraux prédits au-delà de la pénalité du jeu (+3,75 d'intensité) : candidat écarté, quel que soit le score.
        if (newSim.some((s) => (s.gLat ?? 0) > LATERAL_G_PENALTY)) return reject("G latéraux > 2,8");
        // Virage incliné à plat abordé au pas (sommet du lift) : écarté comme à la pose.
        if (slowBanks(table, all, sim, input.prefix.length).length) return reject("virage incliné trop lent");
        // Excitation estimée (formule du jeu sur la simulation exacte) : écartée sous le minimum demandé.
        const estimate = input.estimate?.(all) ?? undefined;
        if (input.minExcitement !== undefined && input.estimate) {
            if (!estimate) return reject("notes non estimables");
            if (estimate.excitement < input.minExcitement) {
                bestRejectedExcitement = Math.max(bestRejectedExcitement ?? 0, estimate.excitement);
                return reject(`excitation estimée < ${input.minExcitement}`);
            }
        }
        const warnings = input.judge(newPieces, newSim, b.macros);
        const sBends = b.sBends;
        const space = spaceProfile(table, all, { closed: true });
        const liftShared = space.elements.find((e) => e.kind === "lift")?.shared ?? 0;
        const minKmh = Math.round(Math.min(...newSim.map((s) => s.vMin)) * 1.609);
        // Compacité : le contour vu de dessus (piste + trous enfermés) ; empilé ou côte à côte, c'est lui qui compte.
        // S-bend : 3 × la pénalité du faisceau, sinon 6 tuiles de contour en moins le faisaient passer (search.test.ts).
        const score =
            -W_OUTLINE * space.outline.area +
            (input.minSteep ? W_STEEP * Math.min(steep, 2 * input.minSteep) : 0) -
            W_WARN * warnings.length -
            3 * W_SBEND * sBends +
            styleScore(b, targetDrops) -
            0.5 * link.length -
            8 * space.isolated.length +
            (estimate ? W_EXC * estimate.excitement : 0);
        candidates.push({ macros: b.macros, pieces: b.pieces, closure, score, layout, space, liftShared, warnings, sBends, minKmh, estimate });
    };

    // Passes successives, faisceau doublé à chaque fois, tant qu'il manque des variantes et qu'il reste du temps : une
    // passe s'arrête à maxDepth (ou quand le faisceau s'éteint) bien avant timeMs, et la largeur qui ferme varie d'un
    // site à l'autre (Black Widow Plus : 24 à 60 ne ferment pas, 90 oui).
    const distinct = () => new Set(candidates.map((c) => JSON.stringify(c.macros.slice(0, -1)))).size;
    let passes = 0;
    const short = () => input.targetExcitement !== undefined && !candidates.some((c) => (c.estimate?.excitement ?? 0) >= input.targetExcitement!);
    const styles = excitementBeam ? PASS_STYLES : PASS_STYLES.slice(0, 1);
    for (let pass = 0; ; pass++) {
        const width = beamWidth * 2 ** Math.floor(pass / styles.length);
        const style = styles[pass % styles.length];
        if (width > MAX_BEAM || timedOut || (distinct() >= wanted && !short())) break;
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
                const dropFirst = !!input.firstDrop && b.pieces.length === 0;
                for (const m of dropFirst ? dropVocab : vocabAll) {
                    const block = isBlockElement(m);
                    if (block && (b.blocks >= midBlocks || b.sinceMark < minSection)) continue;
                    if (b.lastOp === "block_brakes" && !startsDown(m[0])) continue;
                    if (b.helixQuarters + m.reduce((a, x) => a + (x.op === "helix" ? x.quarters : 0), 0) > maxHelix) continue;
                    const compiled = compileMacros(table, input.ride, b.end, m);
                    if (compiled.errors.length || !compiled.pieces.length) continue;
                    // Après un frein de bloc, la première pièce descend : un train arrêté en repart à ~7 km/h, et une hélice
                    // ou un virage incliné « en descente » commence par une pièce d'inclinaison à plat.
                    if (b.lastOp === "block_brakes") {
                        const s0 = table.require(compiled.pieces[0].type);
                        if (!(s0.endZ < s0.beginZ)) continue;
                    }
                    expansions++;
                    const occ = b.occ.clone();
                    // Les blocs de la pièce précédente sont voisins par construction (tuiles partagées par les huitièmes).
                    const last = b.pieces[b.pieces.length - 1] ?? input.prefix[input.prefix.length - 1];
                    let prev = last ? pieceElements(last, table.require(last.type)) : [];
                    const isPrev = (x: number, y: number) => prev.some((q) => q.x === x && q.y === y);
                    let ok = true;
                    // Piste plus ancienne : le circuit existant, ou un élément de la branche posé au moins 2 macros plus tôt.
                    const older = (k: string) => {
                        const m = b.own.get(k);
                        return prefixTileSet.has(k) || (m !== undefined && m <= macroIndex - 2);
                    };
                    let stack = 0;
                    let touch = 0;
                    let tiles = 0;
                    const placed = new Set<string>();
                    for (const p of compiled.pieces) {
                        const el = pieceElements(p, table.require(p.type));
                        if (occ.conflict(el) || groundMix(input.env, el)) {
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
                            if (older(k)) stack++;
                            else {
                                // Côte à côte : une tuile voisine porte une piste plus ancienne.
                                let near = false;
                                for (let dx = -1; dx <= 1 && !near; dx++) for (let dy = -1; dy <= 1 && !near; dy++) if ((dx || dy) && older(tkey(e.x + dx, e.y + dy))) near = true;
                                if (near) touch++;
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
                    if (belowTarget(compiled.end.z, sim[sim.length - 1].vOut)) {
                        reject("sous la station sans élan");
                        continue;
                    }
                    // Virage incliné au pas (après un frein de bloc, au sommet d'une colline) : branche morte dès la pose.
                    if (slowBanks(table, compiled.pieces, sim).length) continue;
                    // Première chute trop lente pour l'excitation demandée : aucune fin ne rattraperait l'écart.
                    if (dropFirst) {
                        const kmh = input.firstDrop!.speed([...input.prefix, ...compiled.pieces]) ?? 0;
                        firstDropKmh = Math.max(firstDropKmh ?? 0, kmh);
                        if (kmh < input.firstDrop!.minKmh) {
                            reject("première chute trop lente");
                            continue;
                        }
                    }
                    // Frein de bloc abordé lancé (FREIN DE BLOC LANCÉ de coaster_build_plan) : les freins de l'élément le ralentissent
                    // d'abord. Les freins qui ôtent trop avant lui sont jugés à la fermeture, sur le circuit entier (`fastBlockBrakes`) :
                    // la vitesse par morceaux exagère leur perte et coupait des branches viables (Black Widow Diagonal, estimate.test.ts).
                    if (block && compiled.pieces.some((p, i) => BLOCK_BRAKE_NAMES.has(SegmentTable.nameOf(p.type)) && sim[i].vIn * 1.609 > BLOCK_MAX_KMH)) continue;
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
                    for (const p of compiled.pieces) straightRun = p.name === "flat" || p.name === "diagFlat" ? straightRun + 1 : 0;
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
                        touch: b.touch + touch,
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
                        blockLift: b.blockLift + (block ? Math.max(0, (compiled.end.z - input.goal.z) / 16) : 0),
                        parentKey: b.macros.length + ":" + b.end.x + "," + b.end.y + "," + b.end.z + "," + b.score.toFixed(3),
                        sinceMark: block ? 0 : b.sinceMark + tiles,
                        tailSim: [...b.tailSim, ...sim].slice(-3),
                        score: 0,
                    };
                    nb.score = rescore(nb, targetDrops, midBlocks, steepNeed, { distance: homeDistance(nb.end), minTiles: input.minTiles }, invNeed, style);
                    const k = poseKey(nb.end);
                    const cur = next.get(k);
                    if (!cur || cur.score < nb.score) next.set(k, nb);
                }
            }
            // Au plus style.maxChildren enfants d'une même branche : sans ce plafond, le faisceau ne gardait plus qu'une lignée
            // (variantes d'un même début) dès la 4e profondeur, et la boucle posée au pied de la chute en sortait.
            const diverse = (list: Branch[], n: number): Branch[] => {
                if (!style.maxChildren) return list.slice(0, n);
                const out: Branch[] = [];
                const per = new Map<string, number>();
                for (const b of list) {
                    const k = b.parentKey;
                    const c = per.get(k) ?? 0;
                    if (c >= style.maxChildren) continue;
                    per.set(k, c + 1);
                    out.push(b);
                    if (out.length >= n) break;
                }
                return out;
            };
            let ranked = [...next.values()].sort((a, b) => b.score - a.score);
            // Première chute posée par la recherche : seulement les plus hautes qui tiennent (à DROP_SLACK niveaux près). La
            // vitesse de la première chute fait l'élan du circuit ; la note de compacité préférait une chute courte.
            if (depth === 0 && input.firstDrop) {
                const dropHeight = (b: Branch) => Math.max(0, ...b.macros.map((m) => (m.op === "drop" ? m.height : 0)));
                const top = Math.max(0, ...ranked.map(dropHeight));
                ranked = ranked.filter((b) => dropHeight(b) >= top - DROP_SLACK);
            }
            // Excitation jusque-là (circuit ouvert, formule du jeu) sur le haut du classement : sans elle, la compacité seule
            // classait le faisceau, et l'élan d'une grande chute partait en virages plats et hélices avant le frein de bloc,
            // les inversions venant ensuite, lentes (Timber Ridge, 10 octobre 2026 : chute de 24 niveaux, 0 fin à 7,55).
            if (excitementBeam && input.estimatePartial && input.targetExcitement !== undefined) {
                const pool = ranked.slice(0, POOL_FACTOR * width);
                for (const b of pool) {
                    const e = input.estimatePartial([...input.prefix, ...b.pieces]);
                    b.score += e ? W_EXC_BEAM * Math.min(e.excitement, input.targetExcitement) : -Infinity;
                }
                beam = diverse(pool.filter((b) => b.score > -Infinity).sort((a, b) => b.score - a.score), width);
            } else beam = diverse(ranked, width);
            for (const b of beam) {
                if (elapsed() > timeMs) {
                    timedOut = true;
                    break;
                }
                tryClose(b);
            }
        }
    }
    // Celles qui atteignent l'excitation visée d'abord : sinon une fin à l'objectif, moins compacte, sortait des `results`
    // gardées alors qu'elle arrêtait les passes (Timber Ridge, 10 octobre 2026 : 7,60 trouvée, 7,49 rendue).
    const meets = (c: SearchCandidate) => (input.targetExcitement !== undefined && (c.estimate?.excitement ?? 0) >= input.targetExcitement ? 1 : 0);
    candidates.sort((a, b) => meets(b) - meets(a) || b.score - a.score);
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
    return { candidates: out, expansions, closures, elapsedMs: elapsed(), timedOut, midBlocks, rejected, passes, bestRejectedExcitement, firstDropKmh };
}

