// Montagnes russes (SPEC 12.4) : création de la station, macros, pièces suivantes, fermeture A*, test.

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
    DIRECTION_DELTA,
    MAX_LEVEL,
    MIN_LEVEL,
    RIDE_FLAGS,
    RIDE_SETTINGS,
    RIDE_TYPES,
    reverseDirection,
    tileKey,
    type BatchOp,
    type BatchResult,
    type Direction,
    type ObjectInfo,
    type PieceSample,
    type RideDetail,
    type TileXY,
    type TrackPieceInfo,
    type TrackSegmentInfo,
} from "@openrct2-claude/protocol";
import { z } from "zod";
import type { PlannedPathTile } from "../planners/path.js";
import {
    Occupancy,
    SegmentTable,
    STATION_TYPES,
    TRACK_PLACE_FLAGS,
    beginPose,
    blockProblem,
    INVERSION_KINDS,
    QUARTER_LOOP_EXITS,
    availableInversions,
    exitProblem,
    compileMacros,
    describePose,
    describeSequence,
    endPose,
    fits,
    groundTopZ,
    STATION_LAUNCH_MODES,
    blockBrakesBeforeLift,
    blockSections,
    boundsProblem,
    layoutStats,
    originAt,
    pieceAllowed,
    pieceElements,
    pieceKey,
    planClosure,
    planWarnings,
    removeZ,
    rideTrackInfo,
    samePose,
    searchCatalog,
    type BlockSections,
    type Macro,
    type PlannedPiece,
    type RideTrackInfo,
    type TrackBlock,
    type TrackBounds,
    type TrackEnv,
    type TrackPose,
    rideClearance,
} from "../planners/track.js";
import { reliefLevers, reliefProfile, reliefView, spaceLevers, spaceProfile, spaceView, suggestedBounds, type SpaceProfile } from "../planners/space.js";
import { designDirs, designLayout, loadLibrary, type DesignEntry, type DesignLayout, type DesignPiece, type TrackDesign } from "../planners/td6.js";
import {
    SpeedModels,
    TRACK_SPEED_TO_MPH,
    blockSpacing,
    brakeRuns,
    trainLength,
    type BlockSpacing,
    trainShape,
    composeTrain,
    designTrain,
    elementKind,
    elementMinSpeed,
    fitModel,
    matchSamples,
    modelError,
    mphToKmh,
    simulate,
    speedWindows,
    forRide,
    DEFAULT_TRAIN,
    windowFor,
    type MeasuredPiece,
    type PieceSpeed,
    type SpeedModel,
    type SpeedWindow,
    type TrainShape,
} from "../planners/speed.js";
import { STALL_STEPS, blockBrakeRestartWarnings, findStall, lapCompleted, reachedCount, type StallInfo } from "../planners/stall.js";
import {
    ENTRY_FLAG,
    RIDE_FLAG_REVERSED,
    countTrackFeatures,
    ratingLevers,
    ratingsDataFor,
    resolveSpeeds,
    segmentUnits,
    shelterFromBlocks,
    shelterPoints,
    type RatingInputs,
} from "../planners/ratings.js";
import { searchSection, defaultVocabulary } from "../planners/search.js";
import { findSites, type Site } from "../planners/site.js";
import { LENGTH_MAX, LENGTH_MIN, STEEP_MIN, applyMods, checkTarget, firstDrop, grownFootprint, firstDropProblems, referenceTarget, steepCount, targetLevers, type ReferenceMods, type ReferenceTarget } from "../planners/target.js";
import { circuitFingerprint, elementSequence, gSections, ratingGaps, speedProfile, topLevers, type CoasterMeasure, type StoredTerm } from "../planners/compare.js";
import type { InverseOp } from "../state/journal.js";
import { MeasureStore } from "../state/measures.js";
import { BUDGET, defineTool, result, toolError, zDirection, zDryRun, type ToolContext } from "./context.js";
import { chunks, placePathTiles, routeToNetwork } from "./helpers.js";

// ---------------------------------------------------------------------------
// Table des segments : data/track_segments.json, sinon lue dans le jeu (une fois)
// ---------------------------------------------------------------------------

let tableCache: SegmentTable | null = null;

async function segmentTable(ctx: ToolContext): Promise<SegmentTable> {
    if (tableCache) return tableCache;
    const fromFile = SegmentTable.fromFile();
    if (fromFile) return (tableCache = fromFile);
    const items: TrackSegmentInfo[] = [];
    let cursor: number | null = 0;
    while (cursor !== null) {
        const page: { items: TrackSegmentInfo[]; nextCursor: number | null } = await ctx.bridge.call("track.segments", { cursor, limit: 100 });
        items.push(...page.items);
        cursor = page.nextCursor;
    }
    return (tableCache = new SegmentTable(items));
}

// ---------------------------------------------------------------------------
// Vitesse : simulateur exact du jeu (planners/vehicle.ts), sinon modèle d'énergie calé sur les mesures (planners/speed.ts),
// et fenêtres d'entrée relevées sur les designs RCT2
// ---------------------------------------------------------------------------

let modelsCache: SpeedModels | null = null;
const speedModels = (ctx: ToolContext): SpeedModels => (modelsCache ??= SpeedModels.inUserDir(ctx.config.userDir));

let windowsCache: { key: string; windows: Map<string, SpeedWindow> } | null = null;

/**
 * Fenêtres de vitesse d'entrée par genre d'élément, sur les circuits fermés de la bibliothèque de designs. Chaque
 * design est simulé avec son propre train (objet de véhicule et nombre de voitures, designTrain) : un train de bois
 * léger et long ne prend pas les éléments aux mêmes vitesses qu'un train d'acier.
 */
function elementWindows(ctx: ToolContext, table: SegmentTable, model: SpeedModel): Map<string, SpeedWindow> {
    // Clé par valeurs : SpeedModels.get rend un nouvel objet à chaque appel.
    const key = [model.rideType, model.K, model.k1, model.k2, model.invExtra, model.launchK, model.massRef].join("|");
    if (windowsCache && windowsCache.key === key) return windowsCache.windows;
    const designs = designLibrary(ctx)
        .filter((e): e is DesignEntry & { design: TrackDesign } => !!e.design && !!rideTrackInfo(e.design.rideType))
        .map((e) => ({ e, l: designLayout(e.design, table, { x: 0, y: 0, z: 0 }, 0) }))
        .filter(({ l }) => l.closed && !l.unknownPieces.length);
    const trains = designs.map(({ e }) => designTrain(e.design));
    // Simulateur exact : chaque design avec son type (poussée des pièces motorisées) et sa vitesse de chaîne.
    const perDesign = designs.map(({ e }) => forRide({ ...model, rideType: e.design.rideType }, { liftHillSpeed: e.design.liftHillSpeed, mode: e.design.rideMode }));
    const windows = speedWindows(model, table, designs.map(({ l }) => l.pieces), trains, perDesign);
    windowsCache = { key, windows };
    return windows;
}

const trainCache = new Map<number, TrainShape>();
/** Voitures par train demandées par ride_configure (proposedNumCarsPerTrain), tant qu'aucun train ne les confirme. */
const wantedCars = new Map<number, number>();

/** ride_configure { carsPerTrain } : le train composé pour une attraction fermée en tient compte. */
export function rememberCarsPerTrain(rideId: number, cars: number): void {
    wantedCars.set(rideId, cars);
}

/**
 * Train d'une attraction (longueur et masse) : lu sur la piste s'il y en a un (essai ou ouverte) ; sinon composé à
 * partir des voitures de son objet comme le jeu le fera au prochain essai (composeTrain : un train de bois MFT de
 * 12 voitures n'a ni la longueur ni la masse du train par défaut) ; sinon le dernier vu par ce serveur ou gardé avec
 * la dernière mesure. undefined : modèle ponctuel.
 */
async function rideTrain(ctx: ToolContext, rideId: number): Promise<TrainShape | undefined> {
    try {
        const r = await ctx.bridge.call("ride.train", { ride: rideId });
        const t = trainShape(r.cars.filter((c) => c.spacing > 0));
        if (t) {
            trainCache.set(rideId, t);
            wantedCars.delete(rideId);
            return t;
        }
        if (r.object && r.stationTiles) {
            const wanted = wantedCars.get(rideId) ?? trainCache.get(rideId)?.cars;
            const composed = composeTrain(r.object, { stationTiles: r.stationTiles, rideType: r.rideType, mode: r.mode, wantedCars: wanted });
            if (composed) return composed;
        }
    } catch {
        // Plugin sans ride.train (ancienne version, redémarrer le jeu) : on garde la dernière forme connue.
    }
    return trainCache.get(rideId) ?? measures(ctx).latest(rideId)?.train;
}

/** Avertissements : section de freins plus courte que le train (il s'y arrête la queue dans la section précédente). */
/** Rectangle imposé par circuit (coaster_build_plan bounds), gardé entre les appels jusqu'à bounds: null. */
const rideBounds = new Map<number, TrackBounds>();

const zBounds = z
    .object({
        x1: z.number().int().min(0),
        y1: z.number().int().min(0),
        x2: z.number().int().min(0),
        y2: z.number().int().min(0),
        minLevel: z.number().int().min(0).max(255).optional(),
        maxLevel: z.number().int().min(0).max(255).optional(),
    })
    .nullable()
    .optional()
    .describe(
        "Rectangle de tuiles (bornes incluses) et niveaux absolus optionnels hors duquel aucune pièce n'est posée, fermeture comprise. " +
            "Gardé pour les appels suivants sur ce circuit ; null l'efface. Pour imiter une référence : suggestedBounds de coaster_describe.",
    );

/** Cibles de référence par circuit (coaster_build_plan reference), gardées entre les appels jusqu'à reference: null. */
const rideTargets = new Map<number, ReferenceTarget>();

/**
 * Entrée et sortie posées par coaster_create sans raccord (connectToPath: false, défaut) : raccordées au chemin quand
 * le circuit se ferme, en contournant la piste. Raccordées tout de suite, elles posaient file d'attente et chemin en
 * travers de l'emprise encore vide (Black Widow XXL et Black Widow Plus de Haiku, 8 octobre 2026).
 */
const pendingAccess = new Map<number, { entrance: PlacedAccess | null; exit: PlacedAccess | null; level: number }>();

/** Oublie l'état gardé pour un id d'attraction : le jeu réutilise les ids des attractions démolies. */
function forgetRide(rideId: number): void {
    trainCache.delete(rideId);
    pendingAccess.delete(rideId);
    rideBounds.delete(rideId);
    rideTargets.delete(rideId);
}

/**
 * reference: null sur un circuit qui en garde une : refusé sans allowBelowReference (COASTER_SPACE 7 quinquies). Effacer la
 * référence coupe toutes les cibles (longueur, emprise, densité, empilement, trains) ; un échec de recherche n'en est pas la raison.
 */
function guardReferenceDrop(rideId: number, reference: unknown, allowBelowReference: boolean): void {
    const kept = rideTargets.get(rideId);
    if (reference !== null || !kept || allowBelowReference) return;
    toolError("INVALID_PARAMS", `reference: null refusé : le circuit garde la référence ${kept.name}, et l'effacer couperait les cibles de longueur, d'emprise, de densité, d'empilement et de trains.`, {
        hint:
            "Si une recherche échoue, lis approachBlocked et la cause (bounds trop serré derrière la station, début trop long), corrige le circuit ou bounds, " +
            "et garde la référence. allowBelowReference: true seulement si l'utilisateur a demandé d'abandonner la ressemblance.",
    });
}

const zReference = z
    .object({
        ride: z.number().int().min(0).optional(),
        design: z.string().min(1).max(256).optional(),
        trains: z.number().int().min(1).max(32).optional().describe("Trains à faire tourner, au total (ex. 3 quand la référence n'en permet que 2) : fermeture refusée avec moins de sections de bloc."),
        taller: z.number().int().min(1).max(60).optional().describe("Niveaux de plus que l'écart de hauteur de la référence (sommet − point bas) : fermeture refusée en dessous, avertissement HAUTEUR dès le lift posé."),
        faster: z.number().min(1).max(100).optional().describe("km/h de plus que la vitesse de pointe de la référence (prédite avec le train de ce circuit) : fermeture refusée en dessous, avertissement VITESSE dès le lift posé."),
        longer: z.number().min(1).max(200).optional().describe("% de piste en plus que la référence ; l'emprise permise grandit d'autant (densité inchangée)."),
    })
    .nullable()
    .optional()
    .describe(
        "Circuit de référence (ride du parc ou design .td6) dont le serveur suit la longueur de piste, la densité, l'empilement, le dessous du lift " +
            "et les trains. Gardé pour les appels suivants ; null l'efface, avec allowBelowReference: true seulement. La fermeture est refusée si le circuit fait moins de 90 % de la longueur " +
            "de la référence, permet moins de trains, dépasse 1,3 × son emprise, ou n'atteint pas 75 % de sa densité (emprise et densité ajustées par les modifications : taller, faster et trains allongent le lift et la chute et élargissent les virages ; target.footprint donne l'emprise permise), 40 % de ses tuiles empilées, 25 % de son dessous du lift et 50 % de ses pièces raides (60°). Dès qu'elle est posée, la première chute doit ressembler à la sienne (target.firstDrop) : pas plus de 3 tuiles à plat au sommet du lift en plus d'elle, raide si elle l'est, au moins 80 % de sa hauteur ; sinon le plan est refusé, circuit ouvert compris (allowBelowReference: true pour passer outre).",
    );

/** Cibles d'une référence : circuit du parc (fermé) ou design .td6. */
type ReferenceArg = { ride?: number; design?: string } & ReferenceMods;

/**
 * Cibles d'une référence et ses modifications (trains, taller, faster, longer). topSpeed simule la référence avec le
 * modèle et le train du circuit construit : « plus rapide » compare la même physique, pas deux trains différents.
 */
async function loadReference(ctx: ToolContext, table: SegmentTable, ref: ReferenceArg, topSpeed?: (pieces: TrackPieceInfo[]) => number): Promise<ReferenceTarget> {
    const { name, pieces } = await referencePieces(ctx, table, ref);
    const base = referenceTarget(name, table, pieces);
    const mods: ReferenceMods = { trains: ref.trains, taller: ref.taller, faster: ref.faster, longer: ref.longer };
    if (mods.trains !== undefined && mods.trains < base.maxTrains)
        toolError("INVALID_PARAMS", `reference.trains ${mods.trains} : ${name} en permet déjà ${base.maxTrains}.`, { hint: "trains est le total visé, au moins celui de la référence." });
    return applyMods({ ...base, ...(topSpeed ? { topSpeedKmh: Math.round(topSpeed(pieces) * 10) / 10 } : {}) }, mods);
}

/** Nom et pièces d'une référence : circuit fermé du parc ou design .td6. */
async function referencePieces(ctx: ToolContext, table: SegmentTable, ref: { ride?: number; design?: string }): Promise<{ name: string; pieces: TrackPieceInfo[] }> {
    if ((ref.ride === undefined) === (ref.design === undefined)) toolError("INVALID_PARAMS", "reference : donne soit ride, soit design.");
    if (ref.design !== undefined) {
        const entry = findDesign(ctx, ref.design);
        if (!entry.design) toolError("NOT_SUPPORTED_IN_MODE", `Design ${entry.name} illisible : ${entry.error}.`);
        return { name: entry.name, pieces: designLayout(entry.design, table, { x: 0, y: 0, z: 0 }, 0).pieces };
    }
    const detail = await ctx.bridge.call("ride.get", { id: ref.ride! });
    const circuit = await ctx.bridge.call("track.circuit", { ride: ref.ride! });
    if (!circuit.closed) toolError("INVALID_PARAMS", `La référence ${detail.name} n'est pas un circuit fermé.`);
    return { name: detail.name, pieces: circuit.pieces };
}

/** Vitesse de pointe prédite d'un circuit (km/h) avec le modèle et le train de l'attraction st. */
async function topSpeedOf(ctx: ToolContext, st: CoasterState): Promise<(pieces: TrackPieceInfo[]) => number> {
    const model = forRide(speedModels(ctx).get(st.rideType), st);
    const train = await rideTrain(ctx, st.rideId);
    return (pieces) => kmh(Math.max(0, ...simulate(model, st.table, pieces, model.stationSpeed, train).filter((x) => x.reached !== false).map((x) => Math.max(x.vIn, x.vOut))));
}

/**
 * Avertissements ISOLÉ (COASTER_SPACE 4.2) : éléments du plan posés à 2 tuiles ou plus du reste du circuit sans rien
 * partager, avec ce que fait la référence pour le même genre d'élément si on la connaît.
 */
function isolationWarnings(p: SpaceProfile, firstNew: number): string[] {
    const fresh = p.isolated.map((i) => p.elements[i]).filter((e) => e.to >= firstNew && e.kind !== "lift");
    if (!fresh.length) return [];
    return [
        `ISOLÉ : ${fresh.map((e) => `${e.kind} (pièces ${e.from}-${e.to}, voisin ${e.nearestGap ?? ">4"})`).join(", ")} posé(s) à côté du reste sans le croiser. ` +
            "Frightmare passe presque chaque élément au-dessus ou au-dessous d'une autre partie (sous le lift, à travers la boucle) : tourne vers l'intérieur de l'emprise.",
    ];
}

/** RideMode : continuousCircuitBlockSectioned, poweredLaunchBlockSectioned (Ride.h). */
const BLOCK_SECTIONED_MODES = new Set([34, 36]);

/** Avertissements d'un circuit fermé qui ne peut faire tourner qu'un train, ou dont le mode à sections reste à régler. */
function blockWarnings(b: BlockSections, mode?: number): string[] {
    if (b.maxTrains <= 1) {
        return [
            `UN SEUL TRAIN possible (sections : ${b.boundaries || "aucune"}). Pour en faire tourner plusieurs, pose block_brakes sur du plat ` +
                "en hauteur, avant les éléments de fin de parcours : chaque frein de bloc et chaque sommet de lift ferme une section ; trains permis = sections − 1.",
        ];
    }
    if (!b.autoBlockMode && (mode === undefined || !BLOCK_SECTIONED_MODES.has(mode))) {
        return [
            `Aucun frein de bloc : ${b.maxTrains} trains possibles seulement en mode à sections de bloc, que le jeu ne règle pas seul ` +
                "(ride_configure settings.mode: 34). Sinon, pose block_brakes.",
        ];
    }
    return [];
}

/** Écart de sections de bloc avec la référence (trains permis). */
function blockLevers(ride: BlockSections, ref: BlockSections): string[] {
    if (ride.maxTrains >= ref.maxTrains) return [];
    return [
        `Trains permis ${ride.maxTrains} contre ${ref.maxTrains} dans la référence (sections ${ride.sections} contre ${ref.sections} ; ` +
            `référence : ${ref.boundaries}). Ajoute ${ref.maxTrains - ride.maxTrains} frein(s) de bloc (block_brakes) aux endroits correspondants.`,
    ];
}

/**
 * Placement des freins de bloc (`blockSpacing`) : deux freins de bloc trop proches, pas de frein de bloc sur le plat
 * d'arrivée en gare. Le second conseil reprend le frein de bloc en trop quand il y en a un.
 */
function blockSpacingWarnings(sp: BlockSpacing, trainTiles?: number): string[] {
    const out = sp.close.map(
        (c) =>
            `FREINS DE BLOC TROP PROCHES : pièces ${c.first} et ${c.second}, à ${c.tiles.toFixed(0)} tuiles l'un de l'autre (au moins ${c.minTiles.toFixed(0)} : ` +
            `${trainTiles ? "2 trains de long, " : ""}moitié de la section moyenne de ${sp.meanSectionTiles.toFixed(0)} tuiles). Le second n'ajoute presque rien au débit : ` +
            "le train suivant attend quand même la plus longue section. Garde-en un seul ici ; il faut sections = trains + 1, et la section qui manque se place juste avant la station.",
    );
    const nb = sp.noStationBlock;
    if (nb) {
        const last = nb.lastBoundary ? `le dernier ${nb.lastBoundary.kind === "block" ? "frein de bloc" : "sommet de lift"} (pièce ${nb.lastBoundary.index}) est à ${nb.tilesToStation.toFixed(0)} tuiles de la station` : "aucune limite de section avant la station";
        const swap = nb.brakes.length
            ? `Remplace la dernière pièce des freins d'arrivée (pièce ${nb.brakes[nb.brakes.length - 1]}) par un frein de bloc : brakes { length: ${nb.brakes.length - 1} } puis block_brakes (même longueur de freinage${trainTiles ? `, au moins ${trainTiles.toFixed(1)} tuiles pour le train` : ""}).`
            : `Pose brakes { length } puis block_brakes sur le plat d'arrivée${trainTiles ? ` (au moins ${trainTiles.toFixed(1)} tuiles pour le train)` : ""}.`;
        const moved = sp.close.length ? ` Le frein de bloc en trop (pièce ${sp.close[0].second}) peut alors être retiré sans perdre de train.` : "";
        out.push(`PAS DE FREIN DE BLOC AVANT LA STATION : ${last}, le train qui revient ne peut pas attendre hors de la gare. ${swap}${moved}`);
    }
    return out;
}

function brakeRunWarnings(table: SegmentTable, pieces: TrackPieceInfo[], train: TrainShape | undefined): string[] {
    if (!train) return [];
    const need = trainLength(train);
    return brakeRuns(table, pieces)
        .filter((r) => r.tiles + 0.01 < need)
        .map(
            (r) =>
                `FREINS TROP COURTS : ${r.beforeStation ? "freins avant la station" : `section du frein de bloc (pièce ${r.index})`} sur ${r.tiles.toFixed(1)} tuile(s), le train en fait ${need.toFixed(1)} (${train.cars} voitures). Allonge la ligne droite de freins (brakes { length }).`,
        );
}

const kmh = (v: number) => mphToKmh(v);

/** Fusionne les relevés de plusieurs time.run (même pièce : min/max, première vitesse gardée). */
function mergeSample(map: Map<string, PieceSample>, raw: PieceSample): void {
    // Relevés du plugin en velocity >> 16 : conversion en mph affichés.
    const c = TRACK_SPEED_TO_MPH;
    const s = { ...raw, vFirst: raw.vFirst * c, vMin: raw.vMin * c, vMax: raw.vMax * c };
    const k = `${s.x},${s.y},${s.z},${s.direction},${s.trackType}`;
    const o = map.get(k);
    if (!o) {
        map.set(k, { ...s });
        return;
    }
    if (o.n === 0 && s.n > 0) o.vFirst = s.vFirst;
    o.n += s.n;
    if (s.n > 0) {
        o.vMin = o.n === s.n ? s.vMin : Math.min(o.vMin, s.vMin);
        o.vMax = Math.max(o.vMax, s.vMax);
    }
    o.gVertMax = Math.max(o.gVertMax, s.gVertMax);
    o.gVertMin = Math.min(o.gVertMin, s.gVertMin);
    o.gLatMax = Math.max(o.gLatMax, s.gLatMax);
}

/** Conseil d'un calage dans une inversion qui n'est pas la plus petite (sans size, la plus grande est prise). */
function smallerInversion(m: Macro | undefined): string {
    if (!m || m.op !== "inversion" || m.size === "small") return "";
    return ` Inversion ${m.size ?? "sans size (la plus grande)"} : essaie size: '${m.size === "large" ? "medium' ou 'small" : "small"}', bien moins haute (boucle de bois small ~65 km/h à l'entrée, medium ~80, large plus encore).`;
}

/** Contrôle de vitesse d'un plan : calage, ou élément abordé hors de la plage des designs RCT2. */
function speedWarnings(table: SegmentTable, pieces: PlannedPiece[], sim: PieceSpeed[], windows: Map<string, SpeedWindow>, macros: Macro[]): string[] {
    const out: string[] = [];
    const seen = new Set<string>();
    pieces.forEach((p, i) => {
        const where = p.macro !== undefined ? `macro ${p.macro} (${macros[p.macro]?.op ?? "?"}${(macros[p.macro] as { kind?: string })?.kind ? ` ${(macros[p.macro] as { kind?: string }).kind}` : ""})` : "fermeture";
        if (sim[i].reached === false) return;
        if (sim[i].stall && !seen.has(`stall${p.macro}`)) {
            seen.add(`stall${p.macro}`);
            const unreached = sim.filter((x) => x.reached === false).length;
            out.push(
                sim[i].exact
                    ? `CALAGE sur ${where}, pièce ${p.name} en (${p.x},${p.y}) : le train y arrive à ${kmh(sim[i].vIn)} km/h et recule (simulateur exact du jeu)${unreached ? ` ; ${unreached} pièce(s) après jamais atteintes` : ""}. Descends avant, réduis la hauteur de l'élément, ou avance-le dans le parcours.${smallerInversion(macros[p.macro ?? -1])}`
                    : `CALAGE probable sur ${where}, pièce ${p.name} en (${p.x},${p.y}) : entrée à ${kmh(sim[i].vIn)} km/h, pas assez d'élan. Descends avant, réduis la hauteur de l'élément, ou avance-le dans le parcours.${smallerInversion(macros[p.macro ?? -1])}`,
            );
            return;
        }
        const kind = elementKind(p.name);
        const w = kind ? windowFor(windows, kind) : undefined;
        if (!w || p.chain || seen.has(`${kind}${p.macro}`)) return;
        const v = sim[i].vIn;
        const vMin = elementMinSpeed(table, pieces, sim, i);
        if (vMin < w.min50 * 0.8 && !seen.has(`min${kind}${p.macro}`)) {
            seen.add(`min${kind}${p.macro}`);
            out.push(`TROP LENT AU SOMMET : ${where}, ${p.name} : ${kmh(vMin)} km/h au plus bas dans l'élément ; dans les designs RCT2, ${kmh(w.min50)} km/h en médiane (10 % sous ${kmh(w.min10)}). Le train se traîne : prends l'élément plus vite (moins de montée avant, plus de descente) ou choisis-le plus petit.`);
        }
        if (v > w.p90 * 1.15 + 3) {
            seen.add(`${kind}${p.macro}`);
            out.push(`TROP RAPIDE : ${where}, ${p.name} abordé à ${kmh(v)} km/h ; les designs RCT2 l'abordent entre ${kmh(w.p10)} et ${kmh(w.p90)} km/h (médiane ${kmh(w.p50)}). G élevés et intensité excessive : place une colline (climb puis drop) ou une montée avant, ou garde cet élément pour plus tard dans le parcours.`);
        } else if (v < w.p10 * 0.85 - 2) {
            seen.add(`${kind}${p.macro}`);
            out.push(`TROP LENT : ${where}, ${p.name} abordé à ${kmh(v)} km/h ; les designs RCT2 l'abordent entre ${kmh(w.p10)} et ${kmh(w.p90)} km/h. Place-le plus bas ou après une descente.`);
        }
    });
    out.push(...gWarnings(pieces, sim, macros));
    return out;
}

/** Seuils de G latéraux des pénalités d'intensité (RideRatings.cpp, penaltyLateralGs) et de G verticaux de coaster_test. */
const LATERAL_G_PENALTY = 2.8;
const LATERAL_G_SEVERE = 3.1;
const VERTICAL_G_HIGH = 5;

/**
 * G prédits par le simulateur exact (GetGForces, lissés comme les statistiques du jeu) : une pièce au-delà de 2,8 G
 * latéraux ajoute 3,75 à l'intensité, au-delà de 3,1 G 12,25 et retire la moitié de l'excitation des G. Le cas
 * typique : un virage plat (facteur 59 pour le petit, 98 pour le moyen) pris vite, souvent posé par la fermeture
 * juste avant les freins d'arrivée.
 */
function gWarnings(pieces: PlannedPiece[], sim: PieceSpeed[], macros: Macro[]): string[] {
    const out: string[] = [];
    const seen = new Set<string>();
    pieces.forEach((p, i) => {
        const s = sim[i];
        if (!s || s.reached === false || s.gLat === undefined) return;
        const where = p.macro !== undefined ? `macro ${p.macro} (${macros[p.macro]?.op ?? "?"})` : "fermeture";
        if (s.gLat > LATERAL_G_PENALTY && !seen.has(`lat${p.macro}`)) {
            seen.add(`lat${p.macro}`);
            const flatTurn = /Turn|Eighth|SBend/.test(p.name) && !/Bank/.test(p.name);
            const fix = flatTurn
                ? "ce virage n'est pas incliné : prends-le banked (turn { banked: true }, facteur 100 au lieu de 59 pour un petit virage), plus large (medium/large), ou ralentis avant (montée, freins)"
                : "élargis l'élément ou ralentis le train avant (montée, colline, freins)";
            out.push(
                `G LATÉRAUX ${s.gLat.toFixed(2)} sur ${where}, ${p.name} en (${p.x},${p.y}) à ${kmh(s.vIn)} km/h : ` +
                    (s.gLat > LATERAL_G_SEVERE ? "au-delà de 3,1 G, intensité +12,25 et excitation des G divisée par deux" : "au-delà de 2,8 G, intensité +3,75 et nausée +2") +
                    ` (simulateur exact). ${fix[0].toUpperCase()}${fix.slice(1)}.`,
            );
        }
        if ((s.gVertMax ?? 0) > VERTICAL_G_HIGH && !seen.has(`vert${p.macro}`)) {
            seen.add(`vert${p.macro}`);
            out.push(`G VERTICAUX ${s.gVertMax!.toFixed(2)} sur ${where}, ${p.name} en (${p.x},${p.y}) à ${kmh(s.vIn)} km/h : bas de chute ou boucle trop serrés pour cette vitesse (intensité). Adoucis la ressource (drop moins raide, élément plus grand) ou ralentis avant.`);
        }
    });
    return out;
}

/** G prédits d'un circuit (centièmes comme Ride : max latéraux, verticaux max et min) ; null hors simulateur exact. */
function predictedG(sim: PieceSpeed[]): { maxLatG: number; maxPosG: number; maxNegG: number } | null {
    const g = sim.filter((s) => s.gLat !== undefined && s.reached !== false);
    if (!g.length) return null;
    const r = (x: number) => Math.round(x * 100) / 100;
    return { maxLatG: r(Math.max(...g.map((s) => s.gLat!))), maxPosG: r(Math.max(...g.map((s) => s.gVertMax!))), maxNegG: r(Math.min(...g.map((s) => s.gVertMin!))) };
}

/** Profil de vitesse par macro : entrée, sortie, minimum (km/h), niveau de sortie, G latéraux prédits max (latG). */
function macroProfile(pieces: PlannedPiece[], sim: PieceSpeed[], macros: Macro[]): { macro: number; op: string; inKmh: number; outKmh: number; minKmh: number; endLevel: number; latG?: number; stall?: true; unreached?: true }[] {
    const out: { macro: number; op: string; inKmh: number; outKmh: number; minKmh: number; endLevel: number; latG?: number; stall?: true; unreached?: true }[] = [];
    pieces.forEach((p, i) => {
        if (p.macro === undefined) return;
        if (sim[i].reached === false) {
            // Le train cale avant : la macro n'est jamais atteinte.
            const last = out[out.length - 1];
            if (!last || last.macro !== p.macro) out.push({ macro: p.macro, op: (macros[p.macro] as { op: string }).op, inKmh: 0, outKmh: 0, minKmh: 0, endLevel: p.z / 16, unreached: true });
            return;
        }
        let row = out[out.length - 1];
        if (!row || row.macro !== p.macro) {
            const m = macros[p.macro] as { op: string; kind?: string };
            row = { macro: p.macro, op: m.kind ? `${m.op} ${m.kind}` : m.op, inKmh: kmh(sim[i].vIn), outKmh: 0, minKmh: kmh(sim[i].vIn), endLevel: 0 };
            // minKmh : point le plus lent de la macro (sommet d'une inversion), à surveiller autant que l'entrée.
            out.push(row);
        }
        row.outKmh = kmh(sim[i].vOut);
        row.minKmh = Math.min(row.minKmh, kmh(sim[i].vMin));
        row.endLevel = p.z / 16;
        if (sim[i].gLat !== undefined) row.latG = Math.max(row.latG ?? 0, Math.round(sim[i].gLat! * 100) / 100);
        if (sim[i].stall) row.stall = true;
    });
    return out;
}

/**
 * Avant de modifier la piste : fermer deux fois retire les trains et efface un accident (RideSetStatusAction n'efface
 * l'indicateur que sur une attraction déjà fermée). Sinon, retirer une pièce sous un train en essai le fait s'écraser,
 * et l'essai suivant échoue aussitôt.
 */
async function clearTrains(ctx: ToolContext, rideId: number): Promise<void> {
    for (let i = 0; i < 2; i++) await ctx.bridge.call("ride.set_status", { ride: rideId, status: "closed" });
}

// ---------------------------------------------------------------------------
// État d'un circuit, lu dans le jeu à chaque appel (le jeu fait foi)
// ---------------------------------------------------------------------------

interface CoasterState {
    rideId: number;
    name: string;
    rideType: number;
    ride: RideTrackInfo;
    table: SegmentTable;
    pieces: TrackPieceInfo[];
    closed: boolean;
    /** Pose d'entrée de la première pièce de station (but de la fermeture). */
    stationStart: TrackPose | null;
    /** Pose après la dernière pièce (null si le circuit est fermé). */
    cursor: TrackPose | null;
    occupancy: Occupancy;
    status: string;
    /** RideMode (34 = circuit continu à sections de bloc). */
    mode: number;
    /** Vitesse de la chaîne (Ride.liftHillSpeed) ; absente avec un plugin ancien (défaut du type). */
    liftHillSpeed?: number;
    hasEntrance: boolean;
    hasExit: boolean;
}

async function loadCoaster(ctx: ToolContext, rideId: number): Promise<CoasterState> {
    const table = await segmentTable(ctx);
    const detail = await ctx.bridge.call("ride.get", { id: rideId });
    const ride = rideTrackInfo(detail.type);
    if (!ride) {
        toolError("NOT_SUPPORTED_IN_MODE", `${detail.name} n'est pas une attraction à circuit.`, { hint: "Les attractions plates et boutiques se gèrent avec ride_place." });
    }
    const circuit = await ctx.bridge.call("track.circuit", { ride: rideId });
    const occupancy = new Occupancy(rideClearance(detail.type));
    for (const p of circuit.pieces) {
        const seg = table.get(p.type);
        if (seg) occupancy.add(pieceElements(p, seg));
    }
    const first = circuit.pieces.find((p) => STATION_TYPES.has(p.type)) ?? circuit.pieces[0];
    const last = circuit.pieces[circuit.pieces.length - 1];
    const station = detail.stations[0];
    return {
        rideId,
        name: detail.name,
        rideType: detail.type,
        ride,
        table,
        pieces: circuit.pieces,
        closed: circuit.closed,
        stationStart: first ? beginPose(first, table.require(first.type)) : null,
        cursor: !circuit.closed && last ? endPose(last, table.require(last.type)) : null,
        mode: detail.mode,
        liftHillSpeed: detail.liftHillSpeed,
        occupancy,
        status: detail.status,
        hasEntrance: !!station?.entrance,
        hasExit: !!station?.exit,
    };
}

async function trackEnv(ctx: ToolContext, st: CoasterState, extra: TileXY[] = [], margin = 24): Promise<TrackEnv> {
    const pts: TileXY[] = [...st.pieces, ...extra];
    if (st.cursor) pts.push(st.cursor);
    const xs = pts.map((p) => p.x);
    const ys = pts.map((p) => p.y);
    const rect = { x1: Math.min(...xs) - margin, y1: Math.min(...ys) - margin, x2: Math.max(...xs) + margin, y2: Math.max(...ys) + margin };
    const reg = await ctx.cache.region(rect);
    return { get: reg.get, rideId: st.rideId, sandbox: ctx.state.mode === "sandbox", mapSize: await ctx.cache.mapSize(), clearance: st.occupancy.clearance };
}

// ---------------------------------------------------------------------------
// Décomposition des notes (COASTER_REFERENCE P1)
// ---------------------------------------------------------------------------

const r2 = (v: number) => Math.round(v) / 100;

export interface RatingReport {
    /** Notes recalculées et notes du jeu (sur 10). */
    computed: { excitement: number; intensity: number; nausea: number };
    game: { excitement: number; intensity: number; nausea: number };
    /** Écart d'excitation recalculé − jeu. */
    excitementError: number;
    terms: { term: string; E: number; I: number; N: number; input?: string; cap?: string }[];
    levers: { lever: string; E: number; I: number; N: number }[];
    notes: string[];
    /** Entrées complètes et termes bruts en centièmes (réutilisés par coaster_compare). */
    inputs: RatingInputs;
    raw: StoredTerm[];
}

/**
 * Recalcule les notes d'un circuit testé et leurs composantes. Les mesures du jeu (vitesses, G, durée, chutes) viennent
 * de ride.get ; virages, inversions et hélices des pièces ; proximité, abri et scénerie de track.rating_scan.
 */
async function ratingBreakdown(ctx: ToolContext, st: CoasterState, detail: RideDetail): Promise<RatingReport> {
    const data = ratingsDataFor(st.rideType);
    if (!data) toolError("NOT_SUPPORTED_IN_MODE", `Pas de formule de note « normale » pour ${st.ride.name}.`);
    if (detail.excitement === null || detail.intensity === null || detail.nausea === null) {
        toolError("INVALID_PARAMS", `${st.name} n'a pas encore de notes.`, { hint: `coaster_test { ride: ${st.rideId} } d'abord.` });
    }
    const table = st.table;
    const pieces = st.pieces;
    const zOff = data.heights?.vehicleZOffset ?? 8;
    const scan = await ctx.bridge.call("track.rating_scan", {
        ride: st.rideId,
        pieces: pieces.map((p) => ({ x: p.x, y: p.y, z: p.z + (table.require(p.type).elements[0]?.z ?? 0), type: p.type })),
        shelter: shelterPoints(table, pieces, zOff),
    });
    const s = detail.stats;
    const units = segmentUnits(table, pieces);
    const features = countTrackFeatures(table, pieces);
    const inputs: RatingInputs = {
        lengthM: Math.floor(s.rideLength),
        totalTime: s.rideTime,
        maxSpeed16: 0,
        avgSpeed16: 0,
        carsPerTrain: scan.carsPerTrain,
        maxPosG: Math.round(s.maxPositiveVerticalGs * 100),
        maxNegG: Math.round(s.maxNegativeVerticalGs * 100),
        maxLatG: Math.round(s.maxLateralGs * 100),
        features,
        drops: s.numDrops,
        highestDrop: s.highestDropHeight,
        shelter: shelterFromBlocks(table, pieces, scan.sheltered, units ? s.rideLength / units : 0, s.rideLength),
        proximity: scan.proximity,
        scenery: scan.scenery,
        reversedTrains: (scan.rideFlags & RIDE_FLAG_REVERSED) !== 0,
        synchronised: false,
        airTime: Math.round((s.totalAirTime * 100) / 3),
        entry: {
            excitement: scan.entry.excitement,
            intensity: scan.entry.intensity,
            nausea: scan.entry.nausea,
            limitAirTimeBonus: (scan.entry.flags & ENTRY_FLAG.limitAirTimeBonus) !== 0,
            coveredRide: (scan.entry.flags & ENTRY_FLAG.isACoveredRide) !== 0,
        },
        numStations: detail.stations.length,
    };
    const game = { excitement: Math.round(detail.excitement! * 100), intensity: Math.round(detail.intensity! * 100), nausea: Math.round(detail.nausea! * 100) };
    const best = resolveSpeeds(data!, inputs, s.maxSpeed, s.averageSpeed, game);
    const notes: string[] = [];
    if (scan.missing.length) notes.push(`${scan.missing.length} pièce(s) introuvable(s) sur la carte (proximité incomplète) : le circuit a changé depuis la lecture ?`);
    if (scan.noEntrance) notes.push("Station sans entrée : le jeu ne compte aucune proximité.");
    notes.push("Abri estimé bloc par bloc (le jeu le mesure à chaque tick) ; vitesses brutes déduites des mph entiers de l'API.");
    const res = best.result;
    return {
        computed: { excitement: r2(res.excitement), intensity: r2(res.intensity), nausea: r2(res.nausea) },
        game: { excitement: detail.excitement!, intensity: detail.intensity!, nausea: detail.nausea! },
        excitementError: r2(res.excitement - game.excitement),
        terms: res.terms.map((t) => ({ term: t.key, E: r2(t.excitement), I: r2(t.intensity), N: r2(t.nausea), input: t.input, cap: t.cap })),
        levers: ratingLevers(data!, best.inputs)
            .filter((l) => l.excitement || l.intensity)
            .slice(0, 8)
            .map((l) => ({ lever: l.lever, E: r2(l.excitement), I: r2(l.intensity), N: r2(l.nausea) })),
        notes,
        inputs: best.inputs,
        raw: res.terms,
    };
}

/** Ride.flags (absent du type RideDetail). */
const flagsOf = (d: RideDetail): number => ((d as unknown as { flags?: number }).flags ?? 0) as number;

/**
 * Essai : ferme deux fois (efface trains et accident), passe en test, fait tourner le jeu à vitesse 4 en relevant la
 * vitesse et les G de chaque pièce, jusqu'à la fin des essais et au moins 90 % des pièces relevées (ou maxTicks).
 * S'arrête dès que le train est bloqué : aucune nouvelle pièce parcourue pendant STALL_STEPS pas (le jeu ne lève pas
 * hasStalledVehicle sur un circuit à sections de bloc) ; `stall` dit alors où.
 */
async function runCoasterTest(ctx: ToolContext, st: CoasterState, maxTicks: number): Promise<{ detail: RideDetail; ticks: number; samples: Map<string, PieceSample>; stall?: StallInfo }> {
    const ride = st.rideId;
    await clearTrains(ctx, ride);
    const before = await ctx.bridge.call("ride.get", { id: ride });
    if (before.status !== "testing") {
        const s = await ctx.bridge.call("ride.set_status", { ride, status: "testing" });
        if (!s.ok) toolError("GAME_ACTION_FAILED", `Test refusé : ${s.error?.message}`, { hint: "Entrée/sortie manquantes ? Circuit incomplet ? Lis le message du jeu." });
    }
    const step = 800;
    let ticks = 0;
    let detail = before;
    const samples = new Map<string, PieceSample>();
    let stall: StallInfo | undefined;
    let reached = 0;
    let still = 0;
    while (ticks < maxTicks) {
        const run = await ctx.bridge.call("time.run", { ticks: step, speed: 4, sample: { ride } }, { timeoutMs: (step / 40 / 4) * 2000 + 30_000 });
        for (const sm of run.samples ?? []) mergeSample(samples, sm);
        ticks += step;
        detail = await ctx.bridge.call("ride.get", { id: ride });
        const f = flagsOf(detail);
        if (f & RIDE_FLAGS.crashed) break;
        // « tested » peut rester d'un essai précédent : on attend aussi que le premier train ait parcouru le
        // circuit (au moins 90 % des pièces relevées), pour avoir un profil de vitesse complet.
        const measured = matchSamples(st.pieces, [...samples.values()]);
        const covered = reachedCount(measured);
        if (f & RIDE_FLAGS.tested && covered >= st.pieces.length * 0.9) break;
        still = covered > reached ? 0 : still + 1;
        reached = Math.max(reached, covered);
        if (f & RIDE_FLAGS.hasStalledVehicle) {
            stall = findStall(measured);
            break;
        }
        if (still >= STALL_STEPS) {
            // Tour fini : les pièces sans relevé sont trop courtes, pas un arrêt. On attend la fin des essais.
            if (!lapCompleted(measured)) {
                stall = findStall(measured);
                break;
            }
            if (f & RIDE_FLAGS.tested) break;
        }
    }
    return { detail, ticks, samples, stall };
}

let measuresCache: MeasureStore | null = null;
const measures = (ctx: ToolContext): MeasureStore => (measuresCache ??= MeasureStore.inUserDir(ctx.config.userDir));

/** Garde les mesures d'un essai réussi (coaster_compare les réutilise tant que le circuit ne change pas). */
function recordMeasure(ctx: ToolContext, st: CoasterState, detail: RideDetail, measured: MeasuredPiece[], rating: RatingReport | undefined, train?: TrainShape): CoasterMeasure {
    const m: CoasterMeasure = {
        rideId: st.rideId,
        name: st.name,
        rideType: st.rideType,
        fingerprint: circuitFingerprint(st.pieces),
        measuredAt: new Date().toISOString(),
        ratings: { excitement: detail.excitement ?? 0, intensity: detail.intensity ?? 0, nausea: detail.nausea ?? 0 },
        stats: detail.stats,
        layout: layoutStats(st.table, st.pieces, false),
        pieces: st.pieces,
        speedsKmh: measured.map((x) => (x.sample && x.sample.n > 0 ? kmh(x.sample.vFirst) : -1)),
        g: measured.map((x) => (x.sample ? { vertMax: x.sample.gVertMax, vertMin: x.sample.gVertMin, latMax: x.sample.gLatMax } : null)),
        rating: rating ? { terms: rating.raw, inputs: rating.inputs, computed: rating.computed } : undefined,
        train,
    };
    measures(ctx).set(m);
    return m;
}

/**
 * Mesures d'une attraction pour la comparaison : celles gardées si le circuit n'a pas changé, sinon un nouvel essai
 * (sans recaler le modèle de vitesse).
 */
async function measureFor(ctx: ToolContext, rideId: number, maxTicks: number, retest: boolean): Promise<{ m: CoasterMeasure; fresh: boolean }> {
    const st = await loadCoaster(ctx, rideId);
    if (!st.closed) toolError("INVALID_PARAMS", `${st.name} : circuit ouvert (${st.pieces.length} pièces).`);
    const kept = retest ? undefined : measures(ctx).get(rideId, circuitFingerprint(st.pieces));
    if (kept?.rating) return { m: kept, fresh: false };
    const run = await runCoasterTest(ctx, st, maxTicks);
    ctx.cache.invalidateAll();
    if (run.stall) toolError("GAME_ACTION_FAILED", `${st.name} : ${run.stall.message}`, { hint: "Corrige le circuit à cet endroit (coaster_undo puis reconstruis avec plus d'élan), puis relance.", details: { stall: run.stall } });
    if (!(flagsOf(run.detail) & RIDE_FLAGS.tested) || flagsOf(run.detail) & RIDE_FLAGS.crashed) {
        toolError("GAME_ACTION_FAILED", `${st.name} : essai non concluant (accident ou essais incomplets).`, { hint: `coaster_test { ride: ${rideId} } pour le détail.` });
    }
    const rating = await ratingBreakdown(ctx, st, run.detail);
    const train = await rideTrain(ctx, rideId);
    return { m: recordMeasure(ctx, st, run.detail, matchSamples(st.pieces, [...run.samples.values()]), rating, train), fresh: true };
}

/** Version compacte pour les réponses d'outils (sans les entrées brutes). */
/** `space` et `suggestedBounds` de coaster_describe. */
const spaceSection = (p: SpaceProfile) => ({ space: spaceView(p), suggestedBounds: suggestedBounds(p) });

const reportView = (r: RatingReport) => ({ ...r, inputs: undefined, raw: undefined });

// ---------------------------------------------------------------------------
// Pose et retrait de pièces (batch.execute : trackplace / trackremove en unités monde)
// ---------------------------------------------------------------------------

function placeOp(rideId: number, rideType: number, p: PlannedPiece | DesignPiece): BatchOp {
    const d = "inverted" in p ? p : null;
    return {
        action: "trackplace",
        args: {
            x: p.x * 32,
            y: p.y * 32,
            z: p.z,
            direction: p.direction,
            ride: rideId,
            trackType: p.type,
            rideType,
            brakeSpeed: p.brakeSpeed ?? 0,
            colour: d?.colourScheme ?? 0,
            seatRotation: d?.seatRotation ?? 4,
            trackPlaceFlags: (p.chain ? TRACK_PLACE_FLAGS.liftHill : 0) | (d?.inverted ? TRACK_PLACE_FLAGS.inverted : 0),
            // Comme TrackDesignPlaceRide : le jeu ignore alors le circuit lui-même dans les contrôles de dégagement.
            isFromTrackDesign: !!d,
        },
    };
}

function removeOp(p: TrackPieceInfo, seg: TrackSegmentInfo): BatchOp {
    return { action: "trackremove", args: { x: p.x * 32, y: p.y * 32, z: removeZ(p, seg), direction: p.direction, trackType: p.type, sequence: 0 } };
}

async function runBatch(ctx: ToolContext, ops: BatchOp[], dryRun: boolean): Promise<BatchResult> {
    const out: BatchResult = { dryRun, results: [], totalCost: 0, firstFailureIndex: null };
    let offset = 0;
    for (const c of chunks(ops)) {
        const r = await ctx.bridge.call("batch.execute", { ops: c, dryRun, stopOnError: !dryRun });
        for (const res of r.results) out.results.push({ ...res, index: res.index + offset });
        out.totalCost += r.totalCost;
        if (r.firstFailureIndex !== null) {
            out.firstFailureIndex = r.firstFailureIndex + offset;
            if (!dryRun) break;
        }
        offset += c.length;
    }
    return out;
}

const PAUSE_HINT = "Construction refusée en pause : session_set_mode sandbox (buildInPauseMode) ou session_set_paused false.";

function failureMessage(pieces: PlannedPiece[], r: BatchResult, offset = 0): { index: number; piece: string; tile: TileXY; message: string; hint?: string }[] {
    return r.results
        .filter((x) => !x.ok)
        .slice(0, 5)
        .map((x) => {
            const p = pieces[x.index - offset];
            const msg = x.error?.message ?? "refusé";
            return { index: x.index, piece: p?.name ?? "?", tile: { x: p?.x ?? -1, y: p?.y ?? -1 }, message: msg, hint: /paus/i.test(msg) ? PAUSE_HINT : x.error?.hint };
        });
}

/** Contrôles côté serveur : continuité, collisions avec le circuit, terrain et obstacles. */
/**
 * Conseil quand le bout d'un circuit ouvert est une impasse : retirer le dernier élément qui y mène (la première chute
 * quand le curseur est juste après elle) et le refaire ailleurs, plutôt qu'élargir bounds ou relancer la recherche.
 */
/**
 * Inversions du type de piste, dans le résumé de coaster_describe : en fin de réponse (inversionsAvailable), Haiku ne les
 * lisait pas et changeait de type en croyant que le bois n'a pas de boucle (« Black Widow Loop », 8 octobre 2026).
 */
function inversionNote(table: SegmentTable, ride: RideTrackInfo): string {
    const inv = availableInversions(table, ride);
    return inv.length
        ? ` Inversions possibles sur ce type de piste (${ride.name}) : ${inv.join(", ")} (macro inversion) ; inutile de changer de type pour celles-ci.`
        : ` Aucune inversion sur ce type de piste (${ride.name}).`;
}

function exitBlockedHint(st: CoasterState): string {
    let lastChain = -1;
    st.pieces.forEach((p, i) => {
        if (p.chain) lastChain = i;
    });
    const after = lastChain >= 0 ? st.pieces.length - 1 - lastChain : 0;
    const undo =
        after > 0 && after <= 24
            ? `coaster_undo { ride: ${st.rideId}, count: ${after} } retire tout ce qui suit le sommet du lift (la chute qui mène à l'impasse)`
            : `coaster_undo { ride: ${st.rideId}, count: <pièces du dernier élément> } retire le dernier élément`;
    return (
        `Ce n'est ni bounds, ni la référence, ni timeMs : l'obstacle nommé dans exitBlocked est juste devant le bout du circuit. ${undo} ; ` +
        "refais-le pour qu'il débouche sur des tuiles libres (chute plus courte ou plus longue, virage au sommet avant de descendre, autre direction), " +
        "ou libère la tuile (path_remove pour un chemin ou une file d'attente), puis relance coaster_search_section avec la même référence."
    );
}

function checkPieces(
    st: CoasterState,
    env: TrackEnv,
    start: TrackPose,
    pieces: PlannedPiece[],
    occ: Occupancy,
    bounds?: TrackBounds,
): { index: number; piece: string; tile: TileXY; message: string }[] {
    const problems: { index: number; piece: string; tile: TileXY; message: string }[] = [];
    let pose = start;
    // Les blocs de la pièce précédente ne comptent pas : deux pièces voisines peuvent partager une tuile
    // (huitièmes de virage par la diagonale), comme dans selfConflict de la fermeture.
    let previous: TrackBlock[] = [];
    pieces.forEach((p, i) => {
        const seg = st.table.require(p.type);
        if (!samePose(beginPose(p, seg), pose)) problems.push({ index: i, piece: p.name, tile: p, message: "discontinuité avec la pièce précédente" });
        if (!pieceAllowed(st.ride, seg)) problems.push({ index: i, piece: p.name, tile: p, message: `pièce non disponible pour ${st.ride.name}` });
        const el = pieceElements(p, seg);
        const c = occ.conflict(el);
        if (c) problems.push({ index: i, piece: p.name, tile: c, message: `croise le circuit (bloc au niveau ${c.z / 16} : les dégagements se chevauchent)` });
        for (const e of el) {
            const why = blockProblem(env, e) ?? (bounds ? boundsProblem(bounds, e) : null);
            if (why) {
                problems.push({ index: i, piece: p.name, tile: e, message: `${why} (niveau ${e.z / 16})` });
                break;
            }
        }
        occ.add(previous);
        previous = el;
        pose = endPose(p, seg);
    });
    occ.add(previous);
    return problems;
}

/**
 * Refuse les freins de bloc posés entre la station et le premier lift (`blockBrakesBeforeLift`), dryRun compris, sauf
 * au pied du lift avec assez de piste pour que le train arrêté sorte de la station.
 */
async function refuseBlockBrakesBeforeLift(ctx: ToolContext, st: CoasterState, pieces: PlannedPiece[]): Promise<void> {
    const all = [...st.pieces, ...pieces];
    if (!pieces.some((p) => p.name === "blockBrakes" || p.name === "diagBlockBrakes")) return;
    const train = await rideTrain(ctx, st.rideId);
    const bad = blockBrakesBeforeLift(all, { stationLaunch: STATION_LAUNCH_MODES.has(st.mode), table: st.table, trainTiles: train ? trainLength(train) : undefined }).filter(
        (b) => b.index >= st.pieces.length,
    );
    if (!bad.length) return;
    const b = bad[0];
    const p = pieces[b.index - st.pieces.length];
    const trainText = train ? `le train fait ${trainLength(train).toFixed(1)} tuiles (${train.cars} voitures)` : "train inconnu : longueur de la station";
    toolError(
        "INVALID_PARAMS",
        b.needTiles !== undefined
            ? `Frein de bloc refusé : pièce ${b.index - st.pieces.length} (${p.name}) en (${p.x},${p.y}), au pied du lift, n'a que ${b.gapTiles} tuile(s) de piste depuis la station ; ` +
                  `il en faut ${b.needTiles} (${trainText}) pour que le train qui y attend ne reste pas dans la station.`
            : `Frein de bloc refusé : pièce ${b.index - st.pieces.length} (${p.name}) en (${p.x},${p.y}) est entre la station et le premier lift, sans être au pied du lift. ` +
                  "Les sections de bloc se placent après le premier lift ; avant, seul un frein de bloc collé au début de la chaîne est permis.",
        {
            details: { blockBrakes: bad.map((x) => ({ ...x, index: x.index - st.pieces.length })) },
            hint:
                b.needTiles !== undefined
                    ? "Éloigne le lift de la station (straight ou virages avant block_brakes) d'au moins la longueur du train, ou pose les freins de bloc après le sommet du lift."
                    : "Pose block_brakes juste avant lift dans le même plan (le train attend au pied de la chaîne, hors de la station), ou après le sommet du lift, sur un plat en hauteur suivi d'une descente, ou juste avant la station.",
        },
    );
}

function compactPieces(pieces: PlannedPiece[]): string {
    // « 3×flat, flatToUp25, 6×up25⛓ … » : lisible et court.
    const out: string[] = [];
    let i = 0;
    while (i < pieces.length) {
        let j = i;
        while (j + 1 < pieces.length && pieces[j + 1].name === pieces[i].name && !!pieces[j + 1].chain === !!pieces[i].chain) j++;
        const n = j - i + 1;
        out.push(`${n > 1 ? `${n}×` : ""}${pieces[i].name}${pieces[i].chain ? "(chaîne)" : ""}`);
        i = j + 1;
    }
    return out.join(", ");
}

// ---------------------------------------------------------------------------
// Fermeture avec validation par le jeu (queryAction) et nouvelle recherche en cas de refus
// ---------------------------------------------------------------------------

interface ClosureOutcome {
    pieces: PlannedPiece[] | null;
    expansions: number;
    attempts: number;
    rejected: { piece: string; tile: TileXY; message: string }[];
    /** Pièces de fermeture écartées pour leurs G prédits (virage plat pris trop vite) avant d'en trouver une autre. */
    gRejected?: { piece: string; tile: TileXY; latG: number }[];
}

/**
 * Pièces d'une fermeture candidate dont les G latéraux prédits dépassent le seuil de pénalité (circuit entier simulé :
 * la vitesse dépend de tout ce qui précède).
 */
type ClosureGCheck = (closure: PlannedPiece[]) => { piece: PlannedPiece; latG: number }[];

async function closeCircuit(
    ctx: ToolContext,
    st: CoasterState,
    env: TrackEnv,
    from: TrackPose,
    occ: Occupancy,
    opts: { inversions: boolean; diagonals: boolean; maxPieces: number; bounds?: TrackBounds; gCheck?: ClosureGCheck },
): Promise<ClosureOutcome> {
    if (!st.stationStart) return { pieces: null, expansions: 0, attempts: 0, rejected: [] };
    // Le plan aboutit déjà à l'entrée de la station : rien à ajouter, le circuit est fermé.
    if (samePose(from, st.stationStart)) return { pieces: [], expansions: 0, attempts: 0, rejected: [] };
    const catalog = searchCatalog(st.table, st.ride, { inversions: opts.inversions, diagonals: opts.diagonals, steep: true, chainedClimbsOnly: true });
    const forbidden = new Set<string>();
    const rejected: ClosureOutcome["rejected"] = [];
    const gRejected: NonNullable<ClosureOutcome["gRejected"]> = [];
    let expansions = 0;
    const zMin = Math.min(st.stationStart.z, from.z, ...st.pieces.map((p) => p.z)) - 16 * 4;
    // Fermeture acceptée par le jeu mais aux G trop forts : rendue en dernier recours (avec l'avertissement G LATÉRAUX).
    let fallback: PlannedPiece[] | null = null;
    const done = (pieces: PlannedPiece[] | null, attempts: number): ClosureOutcome => ({ pieces, expansions, attempts, rejected, ...(gRejected.length ? { gRejected } : {}) });
    const maxAttempts = opts.gCheck ? 10 : 5;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        const res = planClosure(catalog, from, st.stationStart, occ, env, { forbidden, maxPieces: opts.maxPieces, zMin: Math.max(16, zMin), bounds: opts.bounds });
        expansions += res?.expansions ?? 0;
        if (!res) return done(fallback, attempt);
        const q = await runBatch(ctx, res.pieces.map((p) => placeOp(st.rideId, st.rideType, p)), true);
        if (q.firstFailureIndex === null) {
            // Le jeu accepte : on vérifie les G avant de la retenir ; les pièces fautives sont interdites et on recherche.
            const bad = opts.gCheck?.(res.pieces) ?? [];
            if (!bad.length) return done(res.pieces, attempt);
            fallback ??= res.pieces;
            for (const b of bad) {
                forbidden.add(pieceKey(b.piece));
                if (gRejected.length < 5) gRejected.push({ piece: b.piece.name, tile: { x: b.piece.x, y: b.piece.y }, latG: Math.round(b.latG * 100) / 100 });
            }
            continue;
        }
        for (const f of q.results.filter((x) => !x.ok)) {
            const p = res.pieces[f.index];
            forbidden.add(pieceKey(p));
            if (rejected.length < 5) rejected.push({ piece: p.name, tile: { x: p.x, y: p.y }, message: f.error?.message ?? "refusé" });
            if (/paus/i.test(f.error?.message ?? "")) toolError("GAME_ACTION_FAILED", f.error?.message ?? "Construction en pause refusée.", { hint: PAUSE_HINT });
        }
    }
    return done(fallback, maxAttempts);
}

// ---------------------------------------------------------------------------
// Schémas des macros
// ---------------------------------------------------------------------------

const zSide = z.enum(["left", "right"]);
const zMacro = z.discriminatedUnion("op", [
    z.object({ op: z.literal("straight"), length: z.number().int().min(1).max(30) }),
    z.object({
        op: z.literal("lift"),
        height: z.number().int().min(1).max(60).describe("Niveaux gagnés, chaîne de levage."),
        steep: z.boolean().optional().describe("Chaîne raide 60° (défaut : oui si le type le permet). false = lift 25° classique, 1 niveau par tuile."),
    }),
    z.object({
        op: z.literal("launch"),
        height: z
            .number()
            .int()
            .min(2)
            .max(40)
            .describe("Lancement motorisé : montée 25° de poweredLift (height − 1 pièces), qui accélère le train (Lunar Launcher : 7 niveaux, 21 → 63 km/h)."),
    }),
    z.object({
        op: z.literal("booster"),
        length: z.number().int().min(1).max(10),
        speed: z.number().int().min(1).max(30).optional().describe("Consigne (comme brakes) ; vitesse cible = consigne × BoosterSpeedFactor / 2, en unités de 2,25 mph. Défaut 20."),
    }),
    z.object({ op: z.literal("climb"), height: z.number().int().min(1).max(40), steep: z.boolean().optional() }),
    z.object({ op: z.literal("drop"), height: z.number().int().min(1).max(60), steep: z.boolean().optional() }),
    z.object({
        op: z.literal("hill"),
        height: z.number().int().min(1).max(30).describe("Colline : monte puis redescend de height niveaux (airtime, freine le train avant un élément)."),
        steep: z.boolean().optional(),
    }),
    z.object({
        op: z.literal("turn"),
        dir: zSide,
        size: z.enum(["small", "medium", "large"]).optional().describe("small = 3 tuiles (lent), medium = 5 tuiles (défaut), large = par la diagonale (huitièmes, rapide)."),
        banked: z.boolean().optional(),
        quarters: z.number().int().min(1).max(4).optional().describe("Nombre de quarts de tour (défaut 1 = 90°)."),
        slope: z
            .enum(["flat", "up", "down", "steep_up", "steep_down"])
            .optional()
            .describe("steep_up/steep_down = virage d'1 tuile en pente 60° (chute vrillée), jamais incliné, size ignorée."),
    }),
    z.object({
        op: z.literal("helix"),
        dir: zSide,
        quarters: z.number().int().min(1).max(8),
        down: z.boolean().optional(),
        size: z.enum(["small", "large"]).optional().describe("large par défaut ; small (rayon 3) seulement à basse vitesse."),
    }),
    z.object({ op: z.literal("s_bend"), dir: zSide }),
    z.object({ op: z.literal("loop"), dir: zSide }),
    z.object({
        op: z.literal("inversion"),
        kind: z.enum(INVERSION_KINDS as unknown as [string, ...string[]]),
        dir: zSide,
        size: z.enum(["small", "medium", "large"]).optional().describe("Défaut : la plus grande disponible pour ce type."),
    }),
    z.object({ op: z.literal("vertical_drop"), height: z.number().int().min(7).max(60).describe("Chute totale en niveaux, entrée et ressource comprises."), turn: zSide.optional() }),
    z.object({
        op: z.literal("quarter_loop"),
        exit: z.enum(QUARTER_LOOP_EXITS as unknown as [string, ...string[]]),
        dir: zSide,
        height: z.number().int().min(0).max(20).optional().describe("Niveaux de verticale avant le quart de boucle (2 par pièce up90), 2 par défaut."),
        turn: zSide.optional().describe("Virage d'1 tuile à 90° sur la verticale."),
    }),
    z.object({
        op: z.literal("dive"),
        dir: zSide,
        size: z.enum(["small", "medium", "large"]).optional().describe("Taille de la demi-boucle montante, large par défaut."),
        height: z.number().int().min(0).max(20).optional().describe("Niveaux de verticale descendante en plus (2 par pièce down90)."),
        turn: zSide.optional().describe("Virage d'1 tuile à 90° sur la verticale descendante (Frightmare)."),
    }),
    z.object({
        op: z.literal("brakes"),
        length: z.number().int().min(1).max(10),
        speed: z
            .number()
            .int()
            .min(1)
            .max(30)
            .optional()
            .describe("Consigne du jeu, PAS des km/h : vitesse de sortie ≈ consigne × 3,6 km/h (6 → 22 km/h, 18 → 65 km/h, 24 → 87 km/h). Défaut 10 (36 km/h)."),
    }),
    z.object({ op: z.literal("block_brakes") }),
    z.object({ op: z.literal("photo") }),
    z.object({ op: z.literal("level") }),
    z.object({ op: z.literal("piece"), name: z.string(), chain: z.boolean().optional() }),
]);

const MACRO_DOC =
    "Macros : straight{length} ; lift{height,steep?} (montée à chaîne droite, en niveaux) ; launch{height} (montée motorisée poweredLift, propulse le train : remplace le lift sur les types qui l'ont, ex. twister) ; booster{length,speed?} (accélère sur le plat jusqu'à la vitesse cible) ; climb{height,steep?} (montée sans chaîne, sur l'élan) ; " +
    "drop{height,steep?} ; hill{height,steep?} (colline : monte puis redescend, freine le train et donne de l'airtime) ; turn{dir:left|right,size:small|medium|large,banked?,quarters?,slope:flat|up|down|steep_up|steep_down} ; " +
    "helix{dir,quarters,down?,size:small|large} ; inversion{kind:loop|immelmann|dive_loop|corkscrew|zero_g_roll|barrel_roll,dir,size?:small|medium|large} " +
    "(inversion complète, entrée et sortie à l'endroit ; sans size, la plus grande disponible, qui demande le plus d'élan : une boucle de bois large ou medium cale sous ~80 km/h, " +
    "la boucle verticale size: 'small' des designs RCT2 passe à ~65 km/h, par exemple après block_brakes et une descente raide de 8 niveaux) ; loop{dir} (petite boucle verticale) ; s_bend{dir} ; " +
    "Verticalité (Frightmare) : dive{dir,size?,height?,turn?} (demi-boucle montante puis quart de boucle vers la verticale descendante, virage d'1 tuile à 90° si turn, ressource) ; " +
    "quarter_loop{exit:corkscrew|large_corkscrew|half_loop|medium_half_loop|large_half_loop|barrel_roll|zero_g_roll|dive,dir,height?,turn?} (montée verticale, quart de boucle sur le dos, sortie à l'endroit) ; " +
    "vertical_drop{height,turn?} (chute verticale ; height = chute totale, entrée à 60° et ressource comprises : 18 niveaux au moins depuis le plat). " +
    "brakes{length,speed?} ; block_brakes (après le premier lift ; avant lui, seulement juste avant lift, avec la longueur du train depuis la station ; un au bout des freins d'arrivée en gare, les autres espacés, jamais deux à la suite) ; photo ; level (revient à plat) ; piece{name,chain?} (pièce brute, nom TrackElemType). " +
    "Les transitions de pente et d'inclinaison sont insérées automatiquement. Rayon et vitesse : turn small et helix small seulement à basse vitesse " +
    "(fin de parcours) ; après une grande chute, turn medium/large banked, helix large, ou un virage raide slope steep_down.";

// ---------------------------------------------------------------------------
// Outils
// ---------------------------------------------------------------------------


// ---------------------------------------------------------------------------
// Designs .td6 (SPEC 12.7) : bibliothèque et correspondance avec les objets installés
// ---------------------------------------------------------------------------

let libraryCache: { key: string; entries: DesignEntry[] } | null = null;

function designLibrary(ctx: ToolContext, refresh = false): DesignEntry[] {
    const dirs = designDirs(ctx.config.userDir);
    const key = dirs.join("|");
    if (!libraryCache || refresh || libraryCache.key !== key) libraryCache = { key, entries: loadLibrary(dirs) };
    return libraryCache.entries;
}

function findDesign(ctx: ToolContext, query: string): DesignEntry {
    const lib = designLibrary(ctx);
    const q = query.toLowerCase();
    const exact = lib.filter((e) => e.name.toLowerCase() === q || e.file === query);
    const hits = exact.length ? exact : lib.filter((e) => e.name.toLowerCase().includes(q));
    if (hits.length === 1) return hits[0];
    if (!hits.length) toolError("NOT_FOUND", `Aucun design « ${query} » (${lib.length} dans la bibliothèque).`, { hint: "coaster_list_designs { query } pour chercher." });
    toolError("INVALID_PARAMS", `« ${query} » est ambigu : ${hits.slice(0, 8).map((e) => e.name).join(", ")}${hits.length > 8 ? "…" : ""}.`, { hint: "Donne le nom exact." });
}

/** Objets d'attraction installés, indexés par nom DAT (« ARRT1 »). Rafraîchi si un nom manque. */
let rideObjectsCache: Map<string, ObjectInfo> | null = null;

async function installedRideObjects(ctx: ToolContext, refresh = false): Promise<Map<string, ObjectInfo>> {
    if (rideObjectsCache && !refresh) return rideObjectsCache;
    const map = new Map<string, ObjectInfo>();
    let cursor: number | null = 0;
    while (cursor !== null) {
        const page: { items: ObjectInfo[]; nextCursor: number | null } = await ctx.bridge.call("objects.list", { type: "ride", cursor, limit: 200 });
        for (const o of page.items) if (o.legacyIdentifier) map.set(o.legacyIdentifier.toUpperCase(), o);
        cursor = page.nextCursor;
    }
    return (rideObjectsCache = map);
}

function rideTypeName(t: number): string {
    return RIDE_TYPES.find((r) => r.rideType === t)?.name ?? `type ${t}`;
}

/** Type OpenRCT2 : celui du design s'il est déclaré par l'objet, sinon le premier type à circuit de l'objet (RCT2RideTypeToOpenRCT2RideType). */
function resolveRideType(td: TrackDesign, obj: ObjectInfo): number | null {
    const types = ((obj.extra?.rideType as number[] | undefined) ?? []).filter((t) => t !== 255);
    if (types.includes(td.rideType)) return td.rideType;
    return types.find((t) => RIDE_TYPES.find((r) => r.rideType === t)?.trackGroups.length) ?? types[0] ?? null;
}

function layoutSize(l: DesignLayout): { x: number; y: number } {
    return { x: l.bbox.x2 - l.bbox.x1 + 1, y: l.bbox.y2 - l.bbox.y1 + 1 };
}


interface PlacedAccess {
    tile: TileXY;
    /** Côté extérieur : la tuile de raccord est tile + delta[outward]. */
    outward: Direction;
}

/** Raccorde entrée (en file d'attente) et sortie au réseau de chemins le plus proche. */
async function connectEntrances(
    ctx: ToolContext,
    opts: {
        entrance: PlacedAccess | null;
        exit: PlacedAccess | null;
        avoid: Set<string>;
        level: number;
        sandbox: boolean;
        /** Emprise du circuit : le raccord essaie d'abord de la contourner avant d'accepter de la traverser (entre les poteaux, etc.). */
        footprint?: { x1: number; y1: number; x2: number; y2: number };
    },
): Promise<{ connections: Record<string, unknown>; placedPaths: PlannedPathTile[]; cost: number }> {
    const connections: Record<string, unknown> = {};
    const placedPaths: PlannedPathTile[] = [];
    let cost = 0;
    const { avoid } = opts;
    if (opts.entrance) avoid.add(tileKey(opts.entrance.tile));
    if (opts.exit) avoid.add(tileKey(opts.exit.tile));
    const connect = async (label: string, from: PlacedAccess, queue: boolean) => {
        const startTile = { x: from.tile.x + DIRECTION_DELTA[from.outward].x, y: from.tile.y + DIRECTION_DELTA[from.outward].y };
        const g = await ctx.cache.region({ x1: startTile.x - 42, y1: startTile.y - 42, x2: startTile.x + 42, y2: startTile.y + 42 });
        let route: PlannedPathTile[] | null = null;
        if (opts.footprint) {
            // Essai 1 : contourne l'emprise du circuit (évite de slalomer entre les poteaux, invisibles du serveur).
            const outsideAvoid = new Set(avoid);
            const startKey = tileKey(startTile);
            for (let y = opts.footprint.y1; y <= opts.footprint.y2; y++)
                for (let x = opts.footprint.x1; x <= opts.footprint.x2; x++) {
                    const k = tileKey({ x, y });
                    if (k !== startKey) outsideAvoid.add(k);
                }
            route = routeToNetwork(startTile, g.get, { sandbox: opts.sandbox, avoid: outsideAvoid, startLevel: opts.level });
        }
        // Essai 2 (repli) : autorise à traverser l'emprise (sous ou au-dessus des pièces) si le contournement est impossible.
        if (route === null) route = routeToNetwork(startTile, g.get, { sandbox: opts.sandbox, avoid, startLevel: opts.level });
        if (route === null) {
            connections[label] = { connected: false, access: startTile };
            return;
        }
        if (!route.length) {
            connections[label] = { connected: true, access: startTile, tiles: 0 };
            return;
        }
        // Le modèle de dégagement du serveur (cache) est une approximation : simuler avant de poser évite de
        // laisser un tronçon de chemin à moitié posé si le jeu refuse une tuile que le planificateur croyait libre.
        const sim = await placePathTiles(ctx, route, { queue, dryRun: true });
        if (sim.failed > 0) {
            connections[label] = { connected: false, access: startTile };
            return;
        }
        const res = await placePathTiles(ctx, route, { queue, dryRun: false });
        const ok = route.filter((t) => res.results.find((r) => r.x === t.x && r.y === t.y && r.ok));
        placedPaths.push(...ok);
        for (const t of ok) avoid.add(tileKey(t));
        cost += res.totalCost;
        connections[label] = { connected: res.failed === 0, access: startTile, tiles: ok.length };
    };
    if (opts.entrance) await connect("entrance", opts.entrance, true);
    if (opts.exit) await connect("exit", opts.exit, false);
    return { connections, placedPaths, cost };
}

/**
 * Raccorde au chemin l'entrée et la sortie laissées en attente par coaster_create, une fois le circuit fermé : le
 * raccord contourne d'abord l'emprise de la piste. undefined si rien n'attendait.
 */
async function connectPendingAccess(ctx: ToolContext, rideId: number, name: string, footprint: { x1: number; y1: number; x2: number; y2: number }): Promise<Record<string, unknown> | undefined> {
    const pending = pendingAccess.get(rideId);
    if (!pending) return undefined;
    pendingAccess.delete(rideId);
    const c = await connectEntrances(ctx, { entrance: pending.entrance, exit: pending.exit, avoid: new Set(), level: pending.level, sandbox: ctx.state.mode === "sandbox", footprint });
    if (c.placedPaths.length) {
        ctx.journal.record({
            tool: "coaster_create",
            summary: `raccord entrée/sortie de ${name} (${c.placedPaths.length} tuile(s))`,
            params: { ride: rideId },
            inverse: [{ method: "path.remove_tiles", params: { tiles: c.placedPaths.map((t) => ({ x: t.x, y: t.y, level: t.level })) } }],
            cost: c.cost,
        });
    }
    return c.connections;
}

function stationTiles(start: TileXY, dir: Direction, n: number): TileXY[] {
    return Array.from({ length: n }, (_, i) => ({ x: start.x + DIRECTION_DELTA[dir].x * i, y: start.y + DIRECTION_DELTA[dir].y * i }));
}

export function registerCoasterTools(server: McpServer, ctx: ToolContext): void {
    defineTool(
        server,
        ctx,
        "coaster_create",
        {
            title: "Créer une montagne russe (station)",
            description:
                "Crée une attraction à circuit (montagne russe, train…) et sa station droite de stationLength tuiles, à partir de (x, y) dans le sens " +
                "de marche `direction` (0 = −x, 1 = +y, 2 = +x, 3 = −y), puis place entrée et sortie le long de la station. Le raccord au chemin (passerelle sur supports si level surélève " +
                "la station) se fait quand le circuit se ferme, en contournant la piste ; connectToPath: true le fait tout de suite. " +
                "Ensuite : coaster_build_plan (macros, puis fermeture automatique), coaster_test. Laisse au moins 15 tuiles libres devant et autour : coaster_find_site donne (x, y, direction, level) sur un site vide. " +
                "object = objet 'ride' chargé d'un type à circuit (list_objects type ride ; ex. looping coaster). " +
                "Exemple : { object: 'rct2.ride.arrt1', x: 60, y: 40, direction: 2, stationLength: 6 }.",
            input: {
                object: z.string(),
                x: z.number().int().min(1),
                y: z.number().int().min(1),
                direction: zDirection,
                level: z.number().int().min(MIN_LEVEL).max(MAX_LEVEL).optional().describe("Défaut : point le plus haut du terrain sous la station."),
                stationLength: z.number().int().min(2).max(16).default(6),
                entranceSide: z.enum(["left", "right"]).optional().describe("Côté de l'entrée par rapport au sens de marche (défaut : côté le plus proche d'un chemin)."),
                connectToPath: z
                    .boolean()
                    .default(false)
                    .describe("Raccorde tout de suite entrée et sortie au chemin. Défaut false : le raccord se fait à la fermeture du circuit, autour de la piste, pour ne pas couper l'emprise."),
                name: z.string().min(1).max(64).optional(),
                dryRun: zDryRun,
            },
        },
        async (args) => {
            const warnings: string[] = [];
            const sandbox = ctx.state.mode === "sandbox";
            const objs = await ctx.bridge.call("objects.list", { type: "ride", query: args.object, loadedOnly: true, limit: 50 });
            const obj = (objs.items as ObjectInfo[]).find((o) => o.identifier === args.object) ?? (objs.items.length === 1 ? objs.items[0] : undefined);
            if (!obj) toolError("OBJECT_NOT_LOADED", `Objet d'attraction ${args.object} non chargé.`, { hint: "list_objects { type: 'ride', query } puis load_objects." });
            const rideTypes = (obj.extra?.rideType as number[] | undefined) ?? [];
            const rideType = rideTypes.find((t) => rideTrackInfo(t));
            const ride = rideType === undefined ? null : rideTrackInfo(rideType);
            if (rideType === undefined || !ride) {
                toolError("NOT_SUPPORTED_IN_MODE", `${obj.name} n'est pas une attraction à circuit.`, { hint: "Attractions plates et boutiques : ride_place." });
            }
            const table = await segmentTable(ctx);
            const dir = args.direction as Direction;
            const tiles = stationTiles(args, dir, args.stationLength);
            const reg = await ctx.cache.region({
                x1: Math.min(...tiles.map((t) => t.x)) - 14,
                y1: Math.min(...tiles.map((t) => t.y)) - 14,
                x2: Math.max(...tiles.map((t) => t.x)) + 14,
                y2: Math.max(...tiles.map((t) => t.y)) + 14,
            });
            const ground = Math.max(...tiles.map((t) => (reg.get(t.x, t.y) ? groundTopZ(reg.get(t.x, t.y)!) : 0))) / 16;
            const level = args.level ?? ground;
            const env: TrackEnv = { get: reg.get, rideId: -1, sandbox, mapSize: await ctx.cache.mapSize() };
            const stationSeg = table.byName("endStation")!;
            const start: TrackPose = { x: args.x, y: args.y, z: level * 16, rot: dir, slope: 0, bank: 0 };
            const pieces: PlannedPiece[] = [];
            let pose = start;
            for (let i = 0; i < args.stationLength; i++) {
                const p = originAt(pose, stationSeg);
                pieces.push({ ...p, name: "endStation" });
                pose = endPose(p, stationSeg);
            }
            const problems = pieces.flatMap((p) => pieceElements(p, stationSeg).map((e) => ({ e, why: blockProblem(env, e) }))).filter((x) => x.why);
            if (problems.length) {
                toolError("OBSTRUCTED", `Station impossible : ${problems.slice(0, 4).map((x) => `(${x.e.x},${x.e.y}) ${x.why}`).join(", ")}.`, {
                    hint: "Choisis une bande libre et possédée, ou relève la station (level) au-dessus du terrain, ou terrain_flatten.",
                });
            }
            if (args.dryRun) {
                const q = await ctx.bridge.call("ride.create", { object: obj.identifier, dryRun: true });
                return result({
                    budget: BUDGET.write,
                    response: { summary: `[simulation] ${obj.name} : station de ${args.stationLength} tuiles posable au niveau ${level} ; coût de création ${q.cost}.` },
                });
            }
            const created = await ctx.bridge.call("ride.create", { object: obj.identifier, rideType });
            const rideId = created.rideId;
            if (rideId === null) toolError("INTERNAL", "ridecreate n'a pas renvoyé d'identifiant.");
            forgetRide(rideId);
            const rollback = async () => {
                await ctx.bridge.call("ride.demolish", { ride: rideId }).catch(() => undefined);
            };
            let cost = created.cost;
            const placed = await runBatch(ctx, pieces.map((p) => placeOp(rideId, rideType, p)), false);
            if (placed.firstFailureIndex !== null) {
                await rollback();
                const f = failureMessage(pieces, placed)[0];
                toolError("GAME_ACTION_FAILED", `Station refusée en (${f.tile.x},${f.tile.y}) : ${f.message}`, { hint: f.hint ?? "Vérifie la bande avec get_region_map / inspect_tile." });
            }
            cost += placed.totalCost;
            ctx.cache.invalidateTiles(tiles, 2);
            // Entrée et sortie : sur les flancs de la station.
            const reg2 = await ctx.cache.region({ x1: Math.min(...tiles.map((t) => t.x)) - 14, y1: Math.min(...tiles.map((t) => t.y)) - 14, x2: Math.max(...tiles.map((t) => t.x)) + 14, y2: Math.max(...tiles.map((t) => t.y)) + 14 });
            const sides: Record<"left" | "right", Direction> = { left: ((dir + 3) & 3) as Direction, right: ((dir + 1) & 3) as Direction };
            const pathTiles: TileXY[] = [];
            for (let y = reg2.rect.y1; y <= reg2.rect.y2; y++) for (let x = reg2.rect.x1; x <= reg2.rect.x2; x++) if (reg2.get(x, y)?.p?.length) pathTiles.push({ x, y });
            const nearest = (t: TileXY) => pathTiles.reduce((m, p) => Math.min(m, Math.abs(p.x - t.x) + Math.abs(p.y - t.y)), Infinity);
            const order = (["left", "right"] as const).slice().sort((a, b) => {
                if (args.entranceSide) return a === args.entranceSide ? -1 : 1;
                const mid = tiles[Math.floor(tiles.length / 2)];
                const ta = { x: mid.x + DIRECTION_DELTA[sides[a]].x * 2, y: mid.y + DIRECTION_DELTA[sides[a]].y * 2 };
                const tb = { x: mid.x + DIRECTION_DELTA[sides[b]].x * 2, y: mid.y + DIRECTION_DELTA[sides[b]].y * 2 };
                return nearest(ta) - nearest(tb);
            });
            const midIdx = Math.floor((tiles.length - 1) / 2);
            const byCloseness = tiles.map((t, i) => ({ t, i })).sort((a, b) => Math.abs(a.i - midIdx) - Math.abs(b.i - midIdx));
            let entrance: { tile: TileXY; outward: Direction } | null = null;
            let exit: { tile: TileXY; outward: Direction } | null = null;
            const tryPlace = async (isExit: boolean, exclude: TileXY | null): Promise<{ tile: TileXY; outward: Direction } | null> => {
                for (const side of order) {
                    const out = sides[side];
                    for (const { t } of byCloseness) {
                        const e = { x: t.x + DIRECTION_DELTA[out].x, y: t.y + DIRECTION_DELTA[out].y };
                        if (exclude && tileKey(e) === tileKey(exclude)) continue;
                        const rt = reg2.get(e.x, e.y);
                        if (!rt || rt.p?.length || rt.r?.length || rt.e?.length || rt.h > level) continue;
                        const r = await ctx.bridge.call("ride.place_entrance_exit", { ride: rideId, x: e.x, y: e.y, direction: reverseDirection(out), isExit });
                        if (r.ok) {
                            cost += r.cost ?? 0;
                            return { tile: e, outward: out };
                        }
                        if (warnings.length < 4) warnings.push(`${isExit ? "Sortie" : "Entrée"} refusée en (${e.x},${e.y}) : ${r.error?.message}`);
                    }
                }
                return null;
            };
            entrance = await tryPlace(false, null);
            if (entrance) exit = await tryPlace(true, entrance.tile);
            if (!entrance || !exit) warnings.push(`${!entrance ? "Entrée" : "Sortie"} non posée : libère un flanc de la station puis recrée-la (ou pose-la avec un autre outil).`);
            const inverse: InverseOp[] = [{ method: "ride.demolish", params: { ride: rideId } }];
            // Raccord au réseau
            let connections: Record<string, unknown> = {};
            if (args.connectToPath) {
                const avoid = new Set(tiles.map(tileKey));
                // Garde libres les tuiles devant et derrière la station (circuit).
                for (let k = 1; k <= 3; k++) {
                    avoid.add(tileKey({ x: tiles[0].x - DIRECTION_DELTA[dir].x * k, y: tiles[0].y - DIRECTION_DELTA[dir].y * k }));
                    avoid.add(tileKey({ x: pose.x + DIRECTION_DELTA[dir].x * (k - 1), y: pose.y + DIRECTION_DELTA[dir].y * (k - 1) }));
                }
                const c = await connectEntrances(ctx, { entrance, exit, avoid, level, sandbox });
                connections = c.connections;
                cost += c.cost;
                if (c.placedPaths.length) inverse.unshift({ method: "path.remove_tiles", params: { tiles: c.placedPaths.map((t) => ({ x: t.x, y: t.y, level: t.level })) } });
            } else if (entrance || exit) {
                pendingAccess.set(rideId, { entrance, exit, level });
                connections = { deferred: "raccord au chemin à la fermeture du circuit (coaster_build_plan / coaster_append)" };
            }
            if (args.name) {
                const r = await ctx.bridge.call("ride.set_name", { ride: rideId, name: args.name });
                if (!r.ok) warnings.push(`Nom refusé : ${r.error?.message}`);
            }
            ctx.state.validated = ctx.state.validated && !sandbox;
            ctx.journal.record({ tool: "coaster_create", summary: `${obj.name} #${rideId} (station en ${args.x},${args.y})`, params: args, inverse, cost });
            return result({
                budget: BUDGET.write * 2,
                response: {
                    summary: `${obj.name} créé(e) : rideId ${rideId}, station de ${args.stationLength} tuiles au niveau ${level}, coût ${cost}.`,
                    rideId,
                    station: { from: tiles[0], to: tiles[tiles.length - 1], level, direction: dir },
                    entrance: entrance?.tile ?? null,
                    exit: exit?.tile ?? null,
                    connections,
                    cursor: describePose(pose),
                    warnings,
                    next_hints: [
                        `coaster_build_plan { ride: ${rideId}, plan: [{op:'straight',length:2},{op:'lift',height:8},{op:'turn',dir:'left',banked:true},{op:'drop',height:7,steep:true}] } : la fermeture est calculée ensuite.`,
                        `Inversions possibles pour ce type : ${availableInversions(table, ride).join(", ") || "aucune"} (macro inversion).`,
                    ],
                },
            });
        },
    );

    defineTool(
        server,
        ctx,
        "coaster_find_site",
        {
            title: "Trouver un site pour une montagne russe",
            description:
                "À APPELER AVANT coaster_create. Cherche sur toute la carte des rectangles vides (ni chemin, ni attraction, ni entrée) de la taille voulue, " +
                "lac compris : la piste passe au-dessus de l'eau, qui est plate et donne un bonus de proximité aux notes. Renvoie pour chaque site bounds " +
                "(à passer à coaster_build_plan) et les arguments de coaster_create (station sur un grand bord, lift devant, arrivée derrière). " +
                "Taille : reference { ride | design, longer, taller, faster, trains } (emprise de la référence + 10 %, agrandie par les modifications " +
                "comme l'emprise permise de coaster_build_plan : lift et chute plus longs, virages plus larges à la vitesse visée) ou w et h. " +
                "Passe les mêmes modifications qu'à coaster_build_plan. Exemple : { reference: { ride: 4, longer: 25, taller: 3, faster: 8, trains: 3 } }.",
            input: {
                reference: z
                    .object({
                        ride: z.number().int().min(0).optional(),
                        design: z.string().min(1).max(256).optional(),
                        longer: z.number().min(0).max(200).optional().describe("% de piste en plus (comme reference.longer de coaster_build_plan)."),
                        taller: z.number().int().min(0).max(60).optional().describe("Niveaux de plus : le grand côté gagne 1,5 tuile par niveau (lift et chute plus longs)."),
                        faster: z.number().min(0).max(100).optional().describe("km/h de plus : chute plus haute (v² ∝ hauteur) et virages plus larges."),
                        trains: z.number().int().min(1).max(32).optional().describe("Trains au total : un frein de bloc de plus par train au-delà de la référence."),
                    })
                    .optional(),
                w: z.number().int().min(8).max(200).optional(),
                h: z.number().int().min(8).max(200).optional(),
                stationLength: z.number().int().min(2).max(16).default(6),
                area: z
                    .object({ x1: z.number().int().min(0), y1: z.number().int().min(0), x2: z.number().int().min(0), y2: z.number().int().min(0) })
                    .optional()
                    .describe("Zone de recherche (défaut : toute la carte)."),
                results: z.number().int().min(1).max(8).default(3),
            },
        },
        async (args) => {
            let w = args.w;
            let h = args.h;
            let refName: string | undefined;
            if (args.reference) {
                const table = await segmentTable(ctx);
                const { name, pieces } = await referencePieces(ctx, table, args.reference);
                const sb = suggestedBounds(spaceProfile(table, pieces, { closed: true }));
                const ref = referenceTarget(name, table, pieces);
                const { longer, taller, faster, trains } = args.reference;
                const g = grownFootprint([Math.max(sb.w, sb.h), Math.min(sb.w, sb.h)], ref.firstDrop?.height ?? ref.heightLevels, { longer, taller, faster, trains }, { refTrains: ref.maxTrains });
                w = g.long;
                h = g.short;
                refName = name;
            }
            if (w === undefined || h === undefined) toolError("INVALID_PARAMS", "Donne reference, ou w et h.");
            const mapSize = await ctx.cache.mapSize();
            const reg = await ctx.cache.region({ x1: 0, y1: 0, x2: mapSize.x - 1, y2: mapSize.y - 1 });
            const sandbox = ctx.state.mode === "sandbox";
            const area = args.area ? await ctx.cache.clamp(args.area) : undefined;
            // Si rien ne tient, on réduit par pas de 10 % (jusqu'à 70 %) et on le dit.
            let scale = 1;
            let sites: Site[] = [];
            for (; scale >= 0.7 && !sites.length; scale = Math.round((scale - 0.1) * 10) / 10) {
                sites = findSites(reg.get, { w: Math.ceil(w * scale), h: Math.ceil(h * scale), stationLength: args.stationLength, sandbox, mapSize, area, results: args.results });
                if (sites.length) break;
            }
            const r = args.reference;
            const modText = [r?.longer ? `+${r.longer} %` : "", r?.taller ? `+${r.taller} niveaux` : "", r?.faster ? `+${r.faster} km/h` : "", r?.trains ? `${r.trains} trains` : ""].filter(Boolean).join(" ");
            const wanted = `${w}×${h}${refName ? ` (${refName}${modText ? ` ${modText}` : ""})` : ""}`;
            if (!sites.length) {
                toolError("OBSTRUCTED", `Aucun rectangle libre de ${wanted}, même réduit à 70 %.`, {
                    hint: "Démolis une attraction inutilisée (ride_demolish), retire des chemins, ou creuse un lac (water_create_lake) sur une zone dégagée.",
                });
            }
            const views = sites.map((s) => ({
                bounds: s.bounds,
                size: `${s.w}×${s.h}`,
                water: `${Math.round(s.water * 100)} %`,
                relief: `niveaux ${s.groundMin}–${s.groundMax}`,
                obstacles: s.obstacles,
                access: s.access === null ? "aucun chemin" : `${s.access} tuile(s) du chemin`,
                coaster_create: { x: s.station.x, y: s.station.y, direction: s.station.direction, level: s.station.level, stationLength: args.stationLength, entranceSide: s.station.entranceSide },
                room: `${s.station.ahead} tuiles devant la station, ${s.station.behind} derrière`,
                score: s.score,
            }));
            const best = sites[0];
            return result({
                budget: BUDGET.read,
                response: {
                    summary:
                        `${sites.length} site(s) pour ${wanted}${scale < 1 ? ` — RÉDUIT à ${Math.round(scale * 100)} % : rien ne tient à la taille voulue` : ""}. ` +
                        `Meilleur : bounds (${best.bounds.x1},${best.bounds.y1})-(${best.bounds.x2},${best.bounds.y2}), ${Math.round(best.water * 100)} % d'eau, ` +
                        `station en (${best.station.x},${best.station.y}) direction ${best.station.direction} niveau ${best.station.level}. ` +
                        "Pose la station là (coaster_create), puis passe bounds et reference à chaque coaster_build_plan / coaster_search_section.",
                    sites: views,
                    next_hints: [
                        `coaster_create { object, ${Object.entries(views[0].coaster_create).map(([k, v]) => `${k}: ${typeof v === "string" ? `'${v}'` : v}`).join(", ")} }`,
                        `coaster_build_plan { bounds: { x1: ${best.bounds.x1}, y1: ${best.bounds.y1}, x2: ${best.bounds.x2}, y2: ${best.bounds.y2} }${refName ? ", reference: { … }" : ""}, plan: [...] }`,
                        "Eau : la piste se pose au-dessus de la surface (supports dans l'eau) ; garde la station et sa file sur la rive proposée.",
                    ],
                },
            });
        },
    );

    defineTool(
        server,
        ctx,
        "coaster_build_plan",
        {
            title: "Construire un circuit par macros",
            description:
                "Compile un plan de 1 à 60 macro-éléments en pièces depuis la fin du circuit, vérifie (continuité, collisions, terrain, puis le jeu par " +
                "simulation), construit, puis referme le circuit jusqu'à la station (close: true, recherche A* ; les montées de la fermeture sont à chaîne). " +
                `${MACRO_DOC} Hauteurs en niveaux (1 niveau = 16 unités). plan: [] avec close: true ne fait que refermer. dryRun: true montre le plan ` +
                "sans rien poser. Renvoie les pièces (résumé), l'état fermé ou non, la pose de fin, layout (pièces, longueur en tuiles, emprise, " +
                "densité, inversions : à comparer avec coaster_describe d'un circuit de référence), space (couverture, tuiles empilées, plus grand vide, éléments isolés) " +
                "et warnings (lift en courbe, virage serré à grande vitesse, ISOLÉ). bounds { x1, y1, x2, y2 } impose un rectangle au plan et à la fermeture " +
                "(gardé pour les appels suivants) : la compacité compte autant que les notes quand on imite une référence. " +
                "reference { ride | design } suit la longueur de piste, la densité, l'empilement et les trains de la référence (target, avec remainingTiles) ; " +
                "la fermeture est refusée sous 90 % de sa longueur ou avec moins de trains. " +
                "speeds donne, pour chaque macro, la vitesse estimée en entrée, en sortie et au plus bas (km/h) ; les warnings signalent un CALAGE probable " +
                "et tout élément abordé TROP RAPIDE ou TROP LENT par rapport aux designs RCT2 (ex. zero-g roll au pied d'une grande chute : mets une colline avant). " +
                "speeds.gForces donne les G prédits du circuit (maxLatG, maxPosG, maxNegG, comme coaster_test) et chaque macro son latG ; une pièce au-delà de 2,8 G latéraux " +
                "(G LATÉRAUX : intensité +3,75, au-delà de 3,1 G +12,25) est signalée, et la fermeture écarte d'elle-même les virages plats pris trop vite. " +
                "Un grand circuit se construit en plusieurs appels close: false (10 à 20 macros chacun), en vérifiant layout et speeds, puis plan: [] close: true. " +
                "Exemple : { ride: 3, plan: [{op:'straight',length:1},{op:'lift',height:18,steep:false},{op:'drop',height:16,steep:true}," +
                "{op:'inversion',kind:'loop',dir:'right'},{op:'inversion',kind:'immelmann',dir:'left'},{op:'turn',dir:'left',banked:true,size:'large',quarters:2}," +
                "{op:'inversion',kind:'corkscrew',dir:'right'},{op:'helix',dir:'left',quarters:4}] }.",
            input: {
                ride: z.number().int().min(0),
                plan: z.array(zMacro).max(60).default([]),
                close: z.boolean().default(true),
                allowInversions: z.boolean().default(false).describe("La fermeture peut utiliser des inversions."),
                allowDiagonals: z.boolean().default(false).describe("La fermeture peut utiliser des pièces diagonales (plus lent)."),
                maxClosurePieces: z.number().int().min(4).max(120).default(80),
                bounds: zBounds,
                reference: zReference,
                allowBelowReference: z.boolean().default(false).describe("Ferme même si le circuit est trop court, trop étalé (emprise, densité), trop peu empilé ou sans passage sous le lift par rapport à la référence, ou permet moins de trains."),
                dryRun: zDryRun,
            },
        },
        async (args) => {
            if (args.bounds && (args.bounds.x2 < args.bounds.x1 || args.bounds.y2 < args.bounds.y1)) toolError("INVALID_PARAMS", "bounds : x2 ≥ x1 et y2 ≥ y1.");
            if (args.bounds === null) rideBounds.delete(args.ride);
            else if (args.bounds && !args.dryRun) rideBounds.set(args.ride, args.bounds);
            const bounds = args.bounds ?? (args.bounds === null ? undefined : rideBounds.get(args.ride));
            guardReferenceDrop(args.ride, args.reference, args.allowBelowReference);
            if (args.reference === null) rideTargets.delete(args.ride);
            if (!args.dryRun) await clearTrains(ctx, args.ride);
            const st = await loadCoaster(ctx, args.ride);
            const topSpeed = await topSpeedOf(ctx, st);
            const target = args.reference ? await loadReference(ctx, st.table, args.reference, topSpeed) : args.reference === null ? undefined : rideTargets.get(args.ride);
            if (args.reference && target && !args.dryRun) rideTargets.set(args.ride, target);
            if (st.closed) toolError("INVALID_PARAMS", `Le circuit de ${st.name} est déjà fermé (${st.pieces.length} pièces).`, { hint: "coaster_undo pour retirer des pièces, ou coaster_test." });
            if (!st.cursor || !st.stationStart) toolError("NOT_FOUND", "Circuit vide : crée la station avec coaster_create.");
            const compiled = compileMacros(st.table, st.ride, st.cursor, args.plan as Macro[]);
            if (compiled.errors.length) {
                toolError("INVALID_PARAMS", `Plan invalide : ${compiled.errors.map((e) => `macro ${e.macro} : ${e.message}`).join(" ; ")}.`, {
                    details: { errors: compiled.errors },
                    hint: "Corrige la macro fautive (pièce indisponible pour ce type de montagne russe, hauteur impossible…).",
                });
            }
            await refuseBlockBrakesBeforeLift(ctx, st, compiled.pieces);
            const env = await trackEnv(ctx, st, compiled.pieces, 24);
            const occ = st.occupancy;
            const problems = checkPieces(st, env, st.cursor, compiled.pieces, occ, bounds);
            if (problems.length) {
                const outside = problems.some((p) => /bounds/.test(p.message));
                toolError("OBSTRUCTED", `Le plan ne passe pas : ${problems.slice(0, 3).map((p) => `pièce ${p.index} ${p.piece} en (${p.tile.x},${p.tile.y}) : ${p.message}`).join(" ; ")}.`, {
                    details: { problems: problems.slice(0, 6), pieces: compiled.pieces.length, bounds },
                    hint: outside
                        ? "Reste dans bounds : tourne vers l'intérieur de l'emprise, passe au-dessus ou au-dessous du circuit existant (écart de 2 à 3 niveaux suffit), ou raccourcis l'élément."
                        : "Change l'ordre ou le sens des virages, monte plus haut pour passer au-dessus, ou choisis une zone dégagée (get_region_map).",
                });
            }
            // Plan ouvert qui finit face à un obstacle : refusé tout de suite, la suite (recherche, fermeture) ne pourrait pas en partir.
            if (!args.close && compiled.pieces.length && !samePose(compiled.end, st.stationStart)) {
                const blocked = exitProblem(st.table, st.ride, compiled.end, occ.clone(), env, bounds);
                if (blocked)
                    toolError("OBSTRUCTED", `Le plan finit dans une impasse : aucun élément ne peut partir de ${JSON.stringify(describePose(compiled.end))} (${blocked}).`, {
                        details: { planEnd: describePose(compiled.end), exitBlocked: blocked },
                        hint:
                            "Change la fin du plan pour qu'elle débouche sur des tuiles libres : élément plus court ou plus long, virage avant la descente, autre direction ; " +
                            "ou libère la tuile (path_remove pour un chemin ou une file d'attente). Élargir bounds n'y change rien si l'obstacle est dedans.",
                    });
            }
            if (compiled.pieces.length) {
                const q = await runBatch(ctx, compiled.pieces.map((p) => placeOp(st.rideId, st.rideType, p)), true);
                if (q.firstFailureIndex !== null) {
                    const f = failureMessage(compiled.pieces, q);
                    toolError("GAME_ACTION_FAILED", `Le jeu refuse ${f.length} pièce(s) du plan : ${f.slice(0, 3).map((x) => `${x.index} ${x.piece} (${x.tile.x},${x.tile.y}) : ${x.message}`).join(" ; ")}.`, {
                        details: { failures: f },
                        hint: f[0]?.hint ?? "Trop haut pour les supports ? Réduis la hauteur ; obstacle ? Déplace le tracé.",
                    });
                }
            }
            const planEnd = compiled.end;
            const peakBefore = Math.max(st.cursor.z, ...st.pieces.map((p) => p.z + (st.table.get(p.type)?.endZ ?? 0)));
            let closure: ClosureOutcome | null = null;
            // Vitesse et G : modèle et train de l'attraction (la fermeture écarte les virages aux G latéraux pénalisés).
            const model = forRide(speedModels(ctx).get(st.rideType), st);
            const train = await rideTrain(ctx, st.rideId);
            if (args.close) {
                const gCheck: ClosureGCheck = (link) => {
                    const off = st.pieces.length + compiled.pieces.length;
                    const whole = simulate(model, st.table, [...st.pieces, ...compiled.pieces, ...link], model.stationSpeed, train);
                    return link.map((piece, i) => ({ piece, latG: whole[off + i]?.reached === false ? 0 : (whole[off + i]?.gLat ?? 0) })).filter((x) => x.latG > LATERAL_G_PENALTY);
                };
                closure = await closeCircuit(ctx, st, env, planEnd, occ, { inversions: args.allowInversions, diagonals: args.allowDiagonals, maxPieces: args.maxClosurePieces, bounds, gCheck });
                if (!closure.pieces && args.dryRun) {
                    // Rapport en simulation : le plan seul reste valide.
                } else if (!closure.pieces) {
                    toolError("NOT_FOUND", `Aucune fermeture trouvée depuis ${JSON.stringify(describePose(planEnd))} vers la station (${closure.expansions} états explorés).`, {
                        details: { rejected: closure.rejected, stationStart: describePose(st.stationStart) },
                        hint:
                            "Termine le plan plus près de la station, à une hauteur proche, orienté vers elle ; ou close: false puis coaster_next_pieces." +
                            (bounds ? " La fermeture reste dans bounds : vérifie qu'un passage existe (au-dessus ou au-dessous du circuit)." : ""),
                    });
                }
            }
            const all = [...compiled.pieces, ...(closure?.pieces ?? [])];
            const styleWarnings = planWarnings(st.table, all, peakBefore);
            // Compacité : mesures d'espace du circuit entier après le plan, et éléments du plan posés à l'écart.
            const space = spaceProfile(st.table, [...st.pieces, ...all]);
            styleWarnings.push(...isolationWarnings(space, st.pieces.length));
            const spaceOut = {
                ...spaceView(space, { elements: false }),
                bounds: bounds ? `(${bounds.x1},${bounds.y1})-(${bounds.x2},${bounds.y2}), ${bounds.x2 - bounds.x1 + 1}×${bounds.y2 - bounds.y1 + 1}` : "aucun (bounds conseillé pour imiter une référence)",
            };
            // Cibles de la référence (COASTER_SPACE 9) : longueur, densité, empilement, trains ; fermeture refusée en dessous.
            const closes = !!closure?.pieces || samePose(planEnd, st.stationStart);
            const whole0 = [...st.pieces, ...all];
            // Première chute : jugée par le plan qui la finit (une chute déjà posée ne bloque plus que la fermeture).
            const drop = firstDrop(st.table, whole0);
            const dropOfPlan = !!drop?.complete && (closes || drop.end >= st.pieces.length);
            const check = target
                ? checkTarget(target, layoutStats(st.table, whole0), space, closes, {
                      topSpeedKmh: target.topSpeedKmh !== undefined ? topSpeed(whole0) : undefined,
                      firstDrop: dropOfPlan ? drop : drop && { ...drop, complete: false },
                      steepPieces: steepCount(whole0),
                  })
                : null;
            if (check) styleWarnings.push(...check.warnings);
            if (check?.blocking.length && !args.allowBelowReference) {
                const shape = check.blocking.some((b) => /^(SOMMET|PREMIÈRE CHUTE)/.test(b));
                const msg = `${closes ? "Fermeture refusée" : "Plan refusé"} : ${check.blocking.join(" ; ")}.`;
                if (!args.dryRun) {
                    toolError("INVALID_PARAMS", msg, {
                        details: { target: check.view },
                        hint: shape
                            ? `La première chute ne ressemble pas à celle de ${target!.name} (target.firstDrop : la tienne / la sienne). Refais le plan à partir du lift` +
                              (drop && drop.end <= st.pieces.length ? " (coaster_undo jusqu'au sommet du lift)" : "") +
                              " : chute juste après le sommet, raide si la référence l'est, aussi haute. Lis coaster_describe { ride } de la référence (sequence)."
                            : "Ne ferme pas encore : close: false, ajoute des éléments qui s'enroulent dans l'emprise (hélices, virages en pente, passages sous le lift et à travers les inversions) " +
                              "et des block_brakes, puis referme. allowBelowReference: true pour passer outre.",
                    });
                }
                styleWarnings.unshift(`REFUSÉ À LA POSE : ${msg}`);
            }
            // Vitesse : depuis la station le long du circuit existant, puis le long du plan et de la fermeture.
            // Circuit existant et plan simulés d'un seul tenant : les voitures de queue sont encore sur les pièces d'avant.
            const whole = simulate(model, st.table, [...st.pieces, ...all], model.stationSpeed, train);
            const sim = whole.slice(st.pieces.length);
            const vCursor = st.pieces.length ? whole[st.pieces.length - 1].vOut : model.stationSpeed;
            styleWarnings.push(...speedWarnings(st.table, all, sim, elementWindows(ctx, st.table, model), args.plan as Macro[]));
            if (closure?.gRejected?.length) {
                const list = closure.gRejected.map((g) => `${g.piece} en (${g.tile.x},${g.tile.y}) ${g.latG.toFixed(2)} G`).join(", ");
                styleWarnings.push(
                    closure.pieces && !sim.slice(compiled.pieces.length).some((x) => (x.gLat ?? 0) > LATERAL_G_PENALTY)
                        ? `Fermeture : ${list} écartés (G latéraux > 2,8) ; une autre route a été retenue.`
                        : `Fermeture : aucune route sans virage à plus de 2,8 G latéraux (${list}). Termine le plan plus lentement (montée ou freins avant la fin) ou avec un virage incliné vers la station.`,
                );
            }
            if (closure?.pieces || samePose(planEnd, st.stationStart)) {
                styleWarnings.push(...brakeRunWarnings(st.table, [...st.pieces, ...all], train));
                styleWarnings.push(...blockWarnings(blockSections([...st.pieces, ...all]), st.mode));
            }
            // Repartie des freins de bloc, dès la pose (circuit ouvert compris) et en tête : un train qui recule s'écrase
            // sur le suivant, et les avertissements peuvent être tronqués.
            styleWarnings.unshift(...blockBrakeRestartWarnings([...st.pieces, ...all], (slice, v, startPiece) => simulate(model, st.table, slice, v, train, { startPiece })));
            // Placement des freins de bloc : trop proches dès la pose (longueur visée de la référence), arrivée en gare à la fermeture.
            {
                const trainTiles = train ? trainLength(train) : undefined;
                const sp = blockSpacing(st.table, [...st.pieces, ...all], { closed: closes, trainTiles, expectedTiles: target?.lengthTiles });
                if (!closes) sp.close = sp.close.filter((c) => c.second >= st.pieces.length);
                styleWarnings.unshift(...blockSpacingWarnings(sp, trainTiles));
            }
            const speeds = {
                cursorKmh: kmh(vCursor),
                macros: macroProfile(all, sim, args.plan as Macro[]),
                closure: closure?.pieces?.length ? { inKmh: kmh(sim[compiled.pieces.length]?.vIn ?? 0), outKmh: kmh(sim[sim.length - 1].vOut) } : undefined,
                // G prédits (GetGForces) : circuit entier une fois fermé, sinon circuit jusqu'au bout du plan. Les G
                // latéraux comptent tels quels dans l'intensité (2 G = +2) ; pénalité au-delà de 2,8.
                gForces: predictedG(whole) ?? undefined,
                model:
                    (sim[0]?.exact || whole[0]?.exact
                        ? "simulateur exact du jeu (Vehicle.TrackMotion.cpp), rien à caler"
                        : model.samples
                          ? `modèle d'énergie calé sur ${model.samples} mesures (pièces ou mode hors du simulateur exact)`
                          : "modèle d'énergie, valeurs par défaut (lance coaster_test sur un circuit de référence pour caler)") +
                    (train ? `, train de ${train.cars} voitures (${trainLength(train).toFixed(1)} tuiles)` : ", train ponctuel (longueur inconnue : lance coaster_test)"),
            };
            const stationZ = st.stationStart.z;
            if (args.dryRun) {
                return result({
                    budget: BUDGET.write * 3,
                    response: {
                        summary: `[simulation] ${compiled.pieces.length} pièce(s) de plan${closure ? (closure.pieces ? ` + ${closure.pieces.length} de fermeture` : ", fermeture introuvable") : ""}.`,
                        plan: compactPieces(compiled.pieces),
                        closure: closure?.pieces ? compactPieces(closure.pieces) : null,
                        planEnd: describePose(planEnd),
                        maxLevel: Math.max(...all.map((p) => p.z / 16), st.cursor.z / 16),
                        layout: layoutStats(st.table, [...st.pieces, ...all], false),
                        space: spaceOut,
                        target: check?.view,
                        stationLevel: stationZ / 16,
                        speeds,
                        warnings: styleWarnings,
                    },
                });
            }
            const placed = await runBatch(ctx, all.map((p) => placeOp(st.rideId, st.rideType, p)), false);
            const okCount = placed.firstFailureIndex ?? all.length;
            const done = all.slice(0, okCount);
            ctx.cache.invalidateTiles(done.flatMap((p) => pieceElements(p, st.table.require(p.type))), 1);
            if (done.length) {
                ctx.journal.record({
                    tool: "coaster_build_plan",
                    summary: `${done.length} pièce(s) sur ${st.name}`,
                    params: args,
                    inverse: [{ method: "batch.execute", params: { ops: done.slice().reverse().map((p) => removeOp(p, st.table.require(p.type))) } }],
                    cost: placed.totalCost,
                });
            }
            ctx.state.validated = ctx.state.validated && ctx.state.mode !== "sandbox";
            const after = await ctx.bridge.call("track.circuit", { ride: st.rideId });
            const warnings: string[] = [...styleWarnings];
            if (placed.firstFailureIndex !== null) {
                const f = failureMessage(all, placed)[0];
                warnings.push(`Arrêt à la pièce ${f.index} ${f.piece} (${f.tile.x},${f.tile.y}) : ${f.message}`);
            }
            const afterLayout = layoutStats(st.table, after.pieces, false);
            const connections = after.closed ? await connectPendingAccess(ctx, st.rideId, st.name, afterLayout.footprint) : undefined;
            if (connections && Object.values(connections).some((c) => !(c as { connected?: boolean }).connected))
                warnings.push("Entrée ou sortie non raccordée au chemin : path_build depuis connections.*.access jusqu'au réseau.");
            return result({
                budget: BUDGET.write * 3,
                response: {
                    summary: `${done.length}/${all.length} pièce(s) posée(s) sur ${st.name}, coût ${placed.totalCost} ; circuit ${after.closed ? "fermé" : "ouvert"} (${after.pieces.length} pièces).`,
                    plan: compactPieces(compiled.pieces),
                    closure: closure?.pieces ? compactPieces(closure.pieces) : null,
                    closed: after.closed,
                    maxLevel: Math.max(...done.map((p) => p.z / 16), 0),
                    layout: afterLayout,
                    ...(connections ? { connections } : {}),
                    space: spaceOut,
                    target: check?.view,
                    speeds,
                    warnings,
                    next_hints: after.closed
                        ? [`coaster_test { ride: ${st.rideId} } pour lancer les essais et obtenir les notes.`]
                        : ["coaster_next_pieces pour voir les pièces possibles, ou coaster_build_plan { plan: [], close: true }."],
                },
            });
        },
    );

    defineTool(
        server,
        ctx,
        "coaster_search_section",
        {
            title: "Chercher une fin de circuit compacte",
            description:
                "Recherche en faisceau (COASTER_REFERENCE P4) : essaie des milliers de suites de macros depuis le bout du circuit jusqu'à la station, " +
                "dans bounds, et renvoie les meilleures, notées sur l'empilement (piste au-dessus ou au-dessous d'elle-même, dessous du lift), la " +
                "couverture de l'emprise et le style (pénalités : S-bends, longues droites, éléments hors de leur fenêtre de vitesse ; refus : calage, " +
                "second lift, moins de trains ou circuit plus court que la référence). Quand les trains exigés manquent de sections, elle pose aussi " +
                "les freins de bloc de mi-parcours (midBlocks : plat ou freins, block_brakes, puis descente) ; sans variante, rejected donne les causes. Chaque variante donne un plan prêt pour coaster_build_plan " +
                "(macros puis pièces de fermeture), qui la valide auprès du jeu. bounds et reference : ceux de coaster_build_plan (gardés par circuit). " +
                "Rien n'est posé. Pour imiter une référence : bâtir le début (station, lift, première chute) avec coaster_build_plan close: false, " +
                "puis chercher la suite ici.",
            input: {
                ride: z.number().int().min(0),
                bounds: zBounds,
                reference: zReference,
                vocabulary: z.array(z.array(zMacro).min(1).max(4)).max(200).optional().describe("Éléments permis (suites de 1 à 4 macros) ; défaut : virages, hélices, collines, montées, descentes, plus les freins de bloc de mi-parcours qu'exigent les trains (midBlocks)."),
                inversions: z.boolean().default(false).describe("Ajoute au vocabulaire par défaut les inversions disponibles pour ce type, en toutes tailles."),
                minInversions: z
                    .number()
                    .int()
                    .min(0)
                    .max(6)
                    .optional()
                    .describe(
                        "Inversions exigées dans le circuit fermé, début compris (« avec une boucle verticale » : 1). Implique inversions: true ; récompensées dans le faisceau, " +
                            "variante refusée en dessous. Défaut : celles de la référence. Pour une boucle après un frein de bloc de mi-parcours, la recherche pose block_brakes, une descente, puis la boucle.",
                    ),
                beamWidth: z.number().int().min(4).max(200).default(40).describe("Largeur de la première passe ; tant qu'il manque des variantes et qu'il reste du temps (timeMs), la recherche repart avec un faisceau doublé (640 au plus)."),
                maxDepth: z.number().int().min(2).max(30).optional().describe("Macros au plus dans la section ; défaut : 16, ou une par 5 tuiles qui restent à poser (30 au plus)."),
                timeMs: z.number().int().min(2000).max(120_000).default(90_000),
                results: z.number().int().min(1).max(10).default(3),
                allowBelowReference: z.boolean().default(false).describe("Permet reference: null sur un circuit qui garde une référence (seulement si l'utilisateur a abandonné la ressemblance)."),
            },
            readOnly: true,
        },
        async (args) => {
            const st = await loadCoaster(ctx, args.ride);
            if (st.closed) toolError("INVALID_PARAMS", `Le circuit de ${st.name} est fermé : coaster_undo pour retirer la fin à remplacer.`);
            if (!st.cursor || !st.stationStart) toolError("NOT_FOUND", "Circuit vide : crée la station avec coaster_create.");
            guardReferenceDrop(args.ride, args.reference, args.allowBelowReference);
            const bounds = args.bounds ?? (args.bounds === null ? undefined : rideBounds.get(args.ride));
            const topSpeed = await topSpeedOf(ctx, st);
            const target = args.reference ? await loadReference(ctx, st.table, args.reference, topSpeed) : args.reference === null ? undefined : rideTargets.get(args.ride);
            const env = await trackEnv(ctx, st, bounds ? [{ x: bounds.x1, y: bounds.y1 }, { x: bounds.x2, y: bounds.y2 }] : [], 24);
            const model = forRide(speedModels(ctx).get(st.rideType), st);
            const train = await rideTrain(ctx, st.rideId);
            const windows = elementWindows(ctx, st.table, model);
            const prefixTiles = layoutStats(st.table, st.pieces).lengthTiles;
            const prefixSim = simulate(model, st.table, st.pieces, model.stationSpeed, train);
            const zMin = Math.max(16, Math.min(st.stationStart.z, st.cursor.z, ...st.pieces.map((p) => p.z)) - 16 * 4);
            const minTiles = target ? Math.ceil(target.lengthTiles * LENGTH_MIN) : prefixTiles + 10;
            // Un début qui ne ressemble pas à la référence (sommet à plat, chute à 25°) : la fin n'y changera rien.
            const dropProblems = target && !args.allowBelowReference ? firstDropProblems(target, firstDrop(st.table, st.pieces)) : [];
            if (dropProblems.length)
                toolError("INVALID_PARAMS", `Début de circuit refusé : ${dropProblems.join(" ; ")}.`, {
                    hint: `coaster_undo jusqu'au sommet du lift, puis refais la première chute comme ${target!.name} (coaster_describe { ride } de la référence, sequence) avant de chercher la fin.`,
                });
            // Profondeur par défaut : ~5 tuiles par macro, assez pour la longueur qui reste (lift long, Black Widow XL).
            const maxDepth = args.maxDepth ?? Math.min(30, Math.max(16, Math.ceil((minTiles - prefixTiles) / 5)));
            const minInversions = args.minInversions ?? (target?.inversions || undefined);
            if (minInversions && !availableInversions(st.table, st.ride).length) toolError("INVALID_PARAMS", `${st.ride.name} n'a aucune inversion : minInversions impossible.`);
            const res = searchSection({
                table: st.table,
                ride: st.ride,
                prefix: st.pieces,
                start: st.cursor,
                goal: st.stationStart,
                occupancy: st.occupancy,
                env,
                bounds,
                closureCatalog: searchCatalog(st.table, st.ride, { steep: true }),
                speedOf: (pieces, vStart) => simulate(model, st.table, pieces, vStart, train),
                simulateCircuit: (pieces) => simulate(model, st.table, pieces, model.stationSpeed, train),
                simulateFrom: (pieces, v, startPiece) => simulate(model, st.table, pieces, v, train, { startPiece }),
                judge: (pieces, sim, macros) => speedWarnings(st.table, pieces, sim, windows, macros),
                vStart: prefixSim.length ? prefixSim[prefixSim.length - 1].vOut : model.stationSpeed,
                minTiles,
                maxTiles: target ? Math.floor(target.lengthTiles * LENGTH_MAX) : prefixTiles + 400,
                minTrains: target?.maxTrains,
                minSteep: target?.steepPieces ? Math.ceil(target.steepPieces * STEEP_MIN) : undefined,
                minInversions,
                vocabulary: (args.vocabulary as Macro[][] | undefined) ?? defaultVocabulary({ inversions: args.inversions || minInversions ? availableInversions(st.table, st.ride).map((s) => s.split("(")[0]) : [] }),
                beamWidth: args.beamWidth,
                maxDepth,
                timeMs: args.timeMs,
                results: args.results,
                zMin,
                stationLaunch: STATION_LAUNCH_MODES.has(st.mode),
                trainTiles: train ? trainLength(train) : undefined,
            });
            const ref = target ? { lengthTiles: target.lengthTiles, stackedTiles: target.stackedTiles, liftShared: target.liftShared, density: target.density, coverage: Math.round(target.coverage * 100), maxTrains: target.maxTrains, heightLevels: target.heightLevels, ...(target.topSpeedKmh !== undefined ? { topSpeedKmh: target.topSpeedKmh } : {}), ...(target.mods ? { mods: target.mods } : {}) } : undefined;
            // Plus haut / plus rapide (reference.taller / faster) : variantes jugées sur le circuit entier, début compris.
            const judged = res.candidates.map((c) => {
                const whole = [...st.pieces, ...c.pieces, ...c.closure];
                const height = c.layout.maxLevel - c.layout.minLevel;
                const top = target?.topSpeedKmh !== undefined ? topSpeed(whole) : undefined;
                const misses = [
                    target?.mods?.taller && height < target.heightLevels ? `écart de hauteur ${height} niveaux contre ${target.heightLevels}` : "",
                    target?.mods?.faster && top !== undefined && top < target.topSpeedKmh! ? `vitesse de pointe ${Math.round(top)} km/h contre ${Math.round(target.topSpeedKmh!)}` : "",
                ].filter(Boolean);
                return { c, height, top, misses };
            });
            const kept = judged.filter((j) => !j.misses.length);
            const modsMiss = !kept.length && judged.length ? judged[0].misses.join(" ; ") : null;
            const variants = kept.map(({ c, height, top }, i) => ({
                rank: i + 1,
                score: Math.round(c.score),
                heightLevels: height,
                ...(top !== undefined ? { topSpeedKmh: Math.round(top) } : {}),
                lengthTiles: c.layout.lengthTiles,
                footprint: c.layout.footprint.size,
                density: c.layout.density,
                coveragePct: Math.round(c.space.coverage * 100),
                stackedTiles: c.space.stackedTiles,
                liftShared: c.liftShared,
                isolated: c.space.isolated.length,
                maxTrains: c.layout.blocks.maxTrains,
                minKmh: c.minKmh,
                sBends: c.sBends,
                warnings: c.warnings,
                sequence: compactPieces([...c.pieces, ...c.closure]),
                plan: [...c.macros, ...c.closure.map((p) => ({ op: "piece", name: p.name, ...(p.chain ? { chain: true } : {}) }))],
            }));
            return result({
                budget: BUDGET.write * 3,
                response: {
                    summary: variants.length
                        ? `${variants.length} variante(s) en ${Math.round(res.elapsedMs / 1000)} s (${res.expansions} éléments essayés, ${res.closures} fermetures) ; meilleure : ${variants[0].stackedTiles} tuiles empilées, ${variants[0].lengthTiles} tuiles de piste, ${variants[0].footprint}.`
                        : modsMiss
                          ? `${judged.length} fin(s) de circuit trouvée(s), toutes écartées : ${modsMiss} (${target!.name}). Le début du circuit (lift, première chute) fixe la hauteur et la vitesse : refais-le.`
                          : res.exitBlocked
                          ? `Recherche impossible : le bout du circuit est une impasse, aucun élément ne peut en partir (${res.exitBlocked}).`
                          : res.approachBlocked
                          ? `Recherche impossible : l'arrivée en gare (${res.approachBrakes ?? 0} brakes + block_brakes devant la station, imposée pour ${target?.maxTrains ?? 1} train(s)) est bloquée en ${res.approachBlocked}.`
                          : `Aucune fin de circuit trouvée en ${Math.round(res.elapsedMs / 1000)} s (${res.expansions} éléments essayés, ${res.closures} fermetures tentées${Object.keys(res.rejected).length ? `, écartées : ${Object.entries(res.rejected).map(([k, n]) => `${k} ${n}`).join(", ")}` : ""}).`,
                    ...(res.exitBlocked ? { exitBlocked: res.exitBlocked } : {}),
                    ...(res.approachBlocked ? { approachBlocked: res.approachBlocked } : {}),
                    ...(res.midBlocks ? { midBlocks: res.midBlocks } : {}),
                    ...(!variants.length && Object.keys(res.rejected).length ? { rejected: res.rejected } : {}),
                    timedOut: res.timedOut,
                    bounds: bounds ?? null,
                    reference: ref,
                    variants,
                    next_hints: variants.length
                        ? [`coaster_build_plan { ride: ${st.rideId}, plan: <variants[0].plan>, close: true, dryRun: true } puis sans dryRun ; ensuite coaster_test et coaster_compare.`]
                        : modsMiss
                          ? [
                                "coaster_undo jusqu'au lift, puis coaster_build_plan close: false avec un lift plus haut et une première chute jusqu'au sol (ou sous la station) ; suis les avertissements HAUTEUR et VITESSE avant de relancer la recherche.",
                            ]
                          : res.exitBlocked
                          ? [exitBlockedHint(st)]
                          : res.approachBlocked
                          ? [
                                "Ce n'est ni la référence ni le nombre de trains : la tuile nommée dans approachBlocked, derrière la station, est prise. " +
                                    "Recule bounds derrière la station (au moins train + 2 tuiles) ou libère la tuile (piste du début, chemin, file d'attente), puis relance avec la même référence.",
                            ]
                          : [
                                "Élargis bounds, augmente timeMs ou beamWidth, ou raccourcis le début (coaster_undo) pour laisser de la place. Garde la référence. Si bounds ne peut pas grandir (autres attractions, chemins), coaster_find_site trouve un site vide de la bonne taille, lac compris : ride_demolish puis coaster_create là-bas." +
                                    (res.midBlocks ? ` La recherche doit aussi poser ${res.midBlocks} frein(s) de bloc de mi-parcours (trains exigés) : laisse un plat en hauteur suivi d'une descente, ou pose-le toi-même dans le début (brakes puis block_brakes, puis drop).` : ""),
                            ],
                },
            });
        },
    );

    defineTool(
        server,
        ctx,
        "coaster_next_pieces",
        {
            title: "Pièces possibles en bout de circuit",
            description:
                "État d'un circuit (fermé ou non, nombre de pièces, pose de fin, distance à la station) et liste des pièces qui peuvent suivre, " +
                "chacune testée par le jeu (simulation) : nom, pose de fin, coût, ou cause de refus. Filtre optionnel turn (straight/left/right), " +
                "slope (flat/up/down). Utilise-le pour choisir pièce à pièce au lieu d'inventer, puis coaster_append.",
            input: {
                ride: z.number().int().min(0),
                turn: z.enum(["straight", "left", "right"]).optional(),
                slope: z.enum(["flat", "up", "down"]).optional(),
                includeRejected: z.boolean().default(false),
                limit: z.number().int().min(1).max(40).default(20),
            },
            readOnly: true,
        },
        async (args) => {
            const st = await loadCoaster(ctx, args.ride);
            const state = {
                pieces: st.pieces.length,
                closed: st.closed,
                status: st.status,
                entrance: st.hasEntrance,
                exit: st.hasExit,
                cursor: st.cursor ? describePose(st.cursor) : null,
                station: st.stationStart ? describePose(st.stationStart) : null,
                toStation: st.cursor && st.stationStart ? { dx: st.stationStart.x - st.cursor.x, dy: st.stationStart.y - st.cursor.y, dLevel: (st.stationStart.z - st.cursor.z) / 16 } : null,
                layout: st.pieces.length ? layoutStats(st.table, st.pieces, false) : undefined,
            };
            if (!st.cursor) {
                return result({ response: { summary: st.closed ? `Circuit fermé (${st.pieces.length} pièces) : coaster_test.` : "Circuit vide.", ...state } });
            }
            const cursor = st.cursor;
            const env = await trackEnv(ctx, st, [], 12);
            const cands = st.table
                .all()
                .filter((s) => pieceAllowed(st.ride, s) && fits(cursor, s) && !STATION_TYPES.has(s.type))
                .filter((s) => !args.turn || s.turnDirection === args.turn)
                .filter((s) => !args.slope || s.slopeDirection === args.slope);
            const rows = cands.map((seg) => {
                const piece: PlannedPiece = { ...originAt(cursor, seg), name: SegmentTable.nameOf(seg.type) };
                const el = pieceElements(piece, seg);
                const why = st.occupancy.conflict(el) ? "croise le circuit" : el.map((e) => blockProblem(env, e)).find((x) => x) ?? null;
                return { seg, piece, why };
            });
            const toQuery = rows.filter((r) => !r.why).slice(0, 60);
            const q = toQuery.length ? await runBatch(ctx, toQuery.map((r) => placeOp(st.rideId, st.rideType, r.piece)), true) : null;
            toQuery.forEach((r, i) => {
                const res = q?.results[i];
                if (res && !res.ok) r.why = res.error?.message ?? "refusé par le jeu";
                (r as { cost?: number }).cost = res?.cost;
            });
            const ok = rows.filter((r) => !r.why);
            const ko = rows.filter((r) => r.why);
            const fmt = (r: (typeof rows)[number]) => ({
                name: r.piece.name,
                end: describePose(endPose(r.piece, r.seg)),
                cost: (r as { cost?: number }).cost,
                chainable: r.seg.flags?.allowsChainLift && r.seg.endZ > r.seg.beginZ ? true : undefined,
                inversion: r.seg.flags?.isInversion || undefined,
                rejected: r.why ?? undefined,
            });
            const list = [...ok, ...(args.includeRejected ? ko : [])].slice(0, args.limit).map(fmt);
            return result({
                response: {
                    summary: `${ok.length} pièce(s) possible(s) en bout de circuit (${ko.length} refusée(s)).`,
                    ...state,
                    pieces_ok: list,
                    truncated: ok.length + (args.includeRejected ? ko.length : 0) > args.limit ? { shown: args.limit, total: ok.length + (args.includeRejected ? ko.length : 0) } : undefined,
                    next_hints: ["coaster_append { ride, pieces: [{ name }] } ; montée tractée : { name, chain: true }."],
                },
            });
        },
    );

    defineTool(
        server,
        ctx,
        "coaster_append",
        {
            title: "Ajouter des pièces",
            description:
                "Ajoute 1 à 50 pièces brutes en bout de circuit, dans l'ordre (noms donnés par coaster_next_pieces ; chain: true pour une chaîne de levage, " +
                "brakeSpeed pour des freins). Vérifie la continuité (pente, inclinaison) et les collisions avant de poser. dryRun supporté.",
            input: {
                ride: z.number().int().min(0),
                pieces: z.array(z.object({ name: z.string(), chain: z.boolean().optional(), brakeSpeed: z.number().int().min(1).max(30).optional() })).min(1).max(50),
                dryRun: zDryRun,
            },
        },
        async (args) => {
            if (!args.dryRun) await clearTrains(ctx, args.ride);
            const st = await loadCoaster(ctx, args.ride);
            if (!st.cursor) toolError("INVALID_PARAMS", st.closed ? "Circuit déjà fermé." : "Circuit vide : coaster_create.");
            const planned: PlannedPiece[] = [];
            let pose = st.cursor;
            for (const [i, req] of args.pieces.entries()) {
                const seg = st.table.byName(req.name);
                if (!seg) toolError("INVALID_PARAMS", `Pièce ${i} : nom inconnu « ${req.name} ».`, { hint: "coaster_next_pieces donne les noms valides." });
                if (!fits(pose, seg)) {
                    toolError("BAD_SLOPE", `Pièce ${i} ${req.name} incompatible avec l'état ${JSON.stringify(describePose(pose))}.`, { hint: "coaster_next_pieces depuis cet état, ou insère une transition (ex. flatToUp25)." });
                }
                const p = originAt(pose, seg);
                planned.push({ ...p, name: req.name, chain: req.chain, brakeSpeed: req.brakeSpeed });
                pose = endPose(p, seg);
            }
            await refuseBlockBrakesBeforeLift(ctx, st, planned);
            const env = await trackEnv(ctx, st, planned, 6);
            const problems = checkPieces(st, env, st.cursor, planned, st.occupancy);
            if (problems.length) {
                toolError("OBSTRUCTED", `${problems[0].piece} (pièce ${problems[0].index}) en (${problems[0].tile.x},${problems[0].tile.y}) : ${problems[0].message}.`, { details: { problems: problems.slice(0, 5) } });
            }
            const r = await runBatch(ctx, planned.map((p) => placeOp(st.rideId, st.rideType, p)), args.dryRun);
            const okCount = args.dryRun ? planned.length : r.firstFailureIndex ?? planned.length;
            const done = planned.slice(0, okCount);
            if (!args.dryRun && done.length) {
                ctx.cache.invalidateTiles(done.flatMap((p) => pieceElements(p, st.table.require(p.type))), 1);
                ctx.journal.record({
                    tool: "coaster_append",
                    summary: `${done.length} pièce(s) sur ${st.name}`,
                    params: args,
                    inverse: [{ method: "batch.execute", params: { ops: done.slice().reverse().map((p) => removeOp(p, st.table.require(p.type))) } }],
                    cost: r.totalCost,
                });
            }
            const failures = failureMessage(planned, r);
            const end = endPose(done[done.length - 1] ?? planned[0], st.table.require((done[done.length - 1] ?? planned[0]).type));
            const closed = st.stationStart ? samePose(end, st.stationStart) && done.length === planned.length : false;
            const connections = closed && !args.dryRun ? await connectPendingAccess(ctx, st.rideId, st.name, layoutStats(st.table, [...st.pieces, ...done], false).footprint) : undefined;
            return result({
                budget: BUDGET.write,
                response: {
                    summary: `${args.dryRun ? "[simulation] " : ""}${args.dryRun ? planned.length - failures.length : done.length}/${planned.length} pièce(s) ${args.dryRun ? "acceptée(s)" : "posée(s)"}, coût ${r.totalCost}${closed ? " ; circuit fermé" : ""}.`,
                    cursor: describePose(done.length ? end : st.cursor),
                    failures,
                    ...(connections ? { connections } : {}),
                    next_hints: closed ? [`coaster_test { ride: ${st.rideId} }`] : [],
                },
            });
        },
    );

    defineTool(
        server,
        ctx,
        "coaster_undo",
        {
            title: "Retirer les dernières pièces",
            description: "Retire les `count` dernières pièces du circuit (jamais la station). Sur un circuit fermé, retire les pièces qui précèdent la station.",
            input: { ride: z.number().int().min(0), count: z.number().int().min(1).max(100).default(1) },
            destructive: true,
        },
        async ({ ride, count }) => {
            await clearTrains(ctx, ride);
            const st = await loadCoaster(ctx, ride);
            const removable: TrackPieceInfo[] = [];
            for (let i = st.pieces.length - 1; i >= 0 && removable.length < count; i--) {
                if (STATION_TYPES.has(st.pieces[i].type)) break;
                removable.push(st.pieces[i]);
            }
            if (!removable.length) toolError("INVALID_PARAMS", "Aucune pièce retirable (seule la station reste).");
            const r = await runBatch(ctx, removable.map((p) => removeOp(p, st.table.require(p.type))), false);
            const removed = removable.slice(0, r.firstFailureIndex ?? removable.length);
            ctx.cache.invalidateTiles(removed.flatMap((p) => pieceElements(p, st.table.require(p.type))), 1);
            ctx.journal.record({
                tool: "coaster_undo",
                summary: `${removed.length} pièce(s) retirée(s) de ${st.name}`,
                params: { ride, count },
                inverse: [
                    {
                        method: "batch.execute",
                        params: { ops: removed.slice().reverse().map((p) => placeOp(st.rideId, st.rideType, { ...p, name: SegmentTable.nameOf(p.type) })) },
                    },
                ],
                cost: r.totalCost,
            });
            const last = st.pieces[st.pieces.length - 1 - removed.length];
            const cursor = last ? endPose(last, st.table.require(last.type)) : null;
            const warnings = r.firstFailureIndex !== null ? [`Retrait interrompu : ${r.results[r.firstFailureIndex]?.error?.message}`] : [];
            return result({
                budget: BUDGET.write,
                response: { summary: `${removed.length} pièce(s) retirée(s) (remboursement ${-r.totalCost}).`, cursor: cursor ? describePose(cursor) : null, warnings },
            });
        },
    );

    defineTool(
        server,
        ctx,
        "coaster_test",
        {
            title: "Tester une montagne russe",
            description:
                "Passe le circuit en test, fait tourner le jeu en accéléré jusqu'à la fin des essais (ou maxTicks), puis renvoie le rapport : " +
                "notes (excitation, intensité, nausée), vitesse max, G verticaux/latéraux, longueur, chutes, inversions, état (testé, accident, train calé). " +
                "Mesure aussi la vitesse et les G du train sur chaque pièce : profile (séquence avec vitesse d'entrée en km/h et G max par groupe) et " +
                "hotspots (pièces aux G les plus forts, pièce la plus lente), et l'écart du simulateur de vitesse de coaster_build_plan à ces mesures " +
                "(simulateur exact du jeu ; le modèle d'énergie de recours est recalé sur un essai complet). " +
                "Pour comparer à une référence, teste-la d'abord. Exige un circuit fermé avec entrée et sortie. open: true ouvre l'attraction si le test réussit.",
            input: {
                ride: z.number().int().min(0),
                maxTicks: z.number().int().min(400).max(24000).default(8000),
                open: z.boolean().default(false),
            },
        },
        async ({ ride, maxTicks, open }) => {
            const st = await loadCoaster(ctx, ride);
            if (!st.closed) toolError("INVALID_PARAMS", `Circuit ouvert (${st.pieces.length} pièces).`, { hint: "coaster_build_plan { plan: [], close: true } pour refermer." });
            const run = await runCoasterTest(ctx, st, maxTicks);
            // Le train est encore sur la piste (attraction en essai) : sa longueur et sa masse servent au calage.
            const train = await rideTrain(ctx, ride);
            const { ticks, samples, stall } = run;
            const detail = run.detail;
            const f = flagsOf(detail);
            const tested = !!(f & RIDE_FLAGS.tested);
            const problems: string[] = [];
            if (f & RIDE_FLAGS.crashed) {
                // Cause la plus fréquente avec plusieurs trains : un train relâché par un frein de bloc fermé qui recule.
                const model = forRide(speedModels(ctx).get(st.rideType), st);
                const restart = blockBrakeRestartWarnings(st.pieces, (slice, v, startPiece) => simulate(model, st.table, slice, v, train, { startPiece }));
                problems.push(
                    restart.length
                        ? `accident : un train s'est écrasé, probablement à la repartie d'un frein de bloc. ${restart.join(" ")}`
                        : "accident : un train s'est écrasé (collision ou sortie de piste) ; vérifie les freins de bloc et la fermeture.",
                );
            }
            if (stall) problems.push(stall.message);
            else if (f & RIDE_FLAGS.hasStalledVehicle) problems.push("train calé : élan insuffisant ; ajoute une chaîne (lift) avant la montée ou réduis-la.");
            if (!tested && !(f & RIDE_FLAGS.crashed) && !stall) problems.push(`essais non terminés après ${ticks} ticks (circuit long, ou train bloqué).`);
            const s = detail.stats;
            if (tested && s.maxLateralGs > 2.8) problems.push(`G latéraux élevés (${s.maxLateralGs.toFixed(2)}) : incline les virages (banked) ou élargis-les.`);
            if (tested && s.maxPositiveVerticalGs > 5) problems.push(`G verticaux élevés (${s.maxPositiveVerticalGs.toFixed(2)}) : adoucis le bas des chutes.`);
            if (tested && detail.intensity !== null && detail.intensity > 10) problems.push(`intensité ${detail.intensity} : beaucoup de visiteurs refuseront ; réduis hauteur/vitesse.`);
            let status = detail.status;
            if (open && tested && !(f & RIDE_FLAGS.crashed)) {
                const r = await ctx.bridge.call("ride.set_status", { ride, status: "open" });
                if (r.ok) status = "open";
                else problems.push(`ouverture refusée : ${r.error?.message}`);
            }
            ctx.cache.invalidateAll();
            // Profil mesuré par pièce, points chauds, et recalage du modèle de vitesse.
            const measured = matchSamples(st.pieces, [...samples.values()]);
            const first = st.pieces.find((p) => STATION_TYPES.has(p.type)) ?? st.pieces[0];
            const baseZ = first ? first.z + st.table.require(first.type).beginZ : 0;
            // -1 : pièce trop courte pour qu'une frame tombe dessus (vitesse 4) ; affichée « @? ».
            const speedsKmh = measured.map((m) => (m.sample && m.sample.n > 0 ? kmh(m.sample.vFirst) : -1));
            const hot = measured
                .map((m, i) => ({ i, m }))
                .filter((x) => x.m.sample)
                .map((x) => ({ index: x.i, piece: SegmentTable.nameOf(x.m.piece.type), tile: { x: x.m.piece.x, y: x.m.piece.y }, s: x.m.sample! }));
            const top = (key: (h: (typeof hot)[number]) => number) => hot.slice().sort((a, b) => key(b) - key(a))[0];
            const fmtHot = (h: (typeof hot)[number] | undefined, what: string, value: number) =>
                h ? { what, value, index: h.index, piece: h.piece, tile: h.tile, speedKmh: kmh(h.s.vFirst) } : undefined;
            const vMax = top((h) => h.s.gVertMax);
            const vLat = top((h) => h.s.gLatMax);
            const vNeg = top((h) => -h.s.gVertMin);
            const slow = hot.filter((h) => !STATION_TYPES.has(st.pieces[h.index].type) && !/[bB]rakes$/.test(h.piece) && !st.pieces[h.index].chain).sort((a, b) => a.s.vMin - b.s.vMin)[0];
            const hotspots = [
                fmtHot(vMax, "G verticaux max", vMax ? Math.round(vMax.s.gVertMax * 100) / 100 : 0),
                fmtHot(vNeg, "G verticaux min", vNeg ? Math.round(vNeg.s.gVertMin * 100) / 100 : 0),
                fmtHot(vLat, "G latéraux max", vLat ? Math.round(vLat.s.gLatMax * 100) / 100 : 0),
                fmtHot(slow, "vitesse min hors freins (km/h)", slow ? kmh(slow.s.vMin) : 0),
            ].filter(Boolean);
            const models = speedModels(ctx);
            const prior = forRide(models.get(st.rideType), st);
            // Le simulateur exact n'a rien à caler ; le modèle d'énergie (recours) est recalé sur un essai complet.
            const fitted = tested ? fitModel(st.table, measured, prior, train) : prior;
            const exactError = modelError(prior, st.table, measured, train);
            const energyError = modelError({ ...fitted, energyOnly: true }, st.table, measured, train);
            const priorSim = simulate(prior, st.table, st.pieces, prior.stationSpeed, train);
            const exactUsed = priorSim[0]?.exact === true;
            const gPredicted = predictedG(priorSim);
            if (fitted !== prior) models.set(st.rideType, fitted);
            let rating: RatingReport | { error: string } | undefined;
            if (tested && !(f & RIDE_FLAGS.crashed)) {
                try {
                    rating = await ratingBreakdown(ctx, st, detail);
                } catch (e) {
                    rating = { error: `Décomposition indisponible : ${e instanceof Error ? e.message : String(e)} (plugin à jour ? redémarre le jeu après install:plugin).` };
                }
                recordMeasure(ctx, st, detail, measured, rating && "computed" in rating ? rating : undefined, train);
            }
            return result({
                budget: BUDGET.readLarge,
                response: {
                    summary: `${st.name} : ${stall ? "TRAIN BLOQUÉ" : tested ? "essais terminés" : "essais incomplets"}${f & RIDE_FLAGS.crashed ? ", ACCIDENT" : ""} ; excitation ${detail.excitement ?? "?"}, intensité ${detail.intensity ?? "?"}, nausée ${detail.nausea ?? "?"}.`,
                    profile: describeSequence(st.table, st.pieces, baseZ, speedsKmh),
                    hotspots,
                    speedModel: {
                        simulator: exactUsed ? "exact (portage de Vehicle.TrackMotion.cpp)" : "modèle d'énergie (pièces sans sous-positions)",
                        meanErrorKmh: isFinite(exactUsed ? exactError : energyError) ? Math.round((exactUsed ? exactError : energyError) * 10) / 10 : null,
                        energyMeanErrorKmh: isFinite(energyError) ? Math.round(energyError * 10) / 10 : null,
                        samples: fitted.samples,
                        updated: fitted !== prior,
                        // G prédits avant l'essai (ceux de coaster_build_plan), à comparer à stats.
                        gPredicted: gPredicted ?? undefined,
                    },
                    status,
                    tested,
                    crashed: !!(f & RIDE_FLAGS.crashed),
                    stalled: !!stall || !!(f & RIDE_FLAGS.hasStalledVehicle),
                    stall,
                    ratings: { excitement: detail.excitement, intensity: detail.intensity, nausea: detail.nausea },
                    rating: rating && "computed" in rating ? reportView(rating) : rating,
                    stats: {
                        maxSpeedKmh: Math.round(s.maxSpeed * 1.609),
                        rideTimeS: s.rideTime,
                        lengthM: Math.round(s.rideLength),
                        maxPosG: s.maxPositiveVerticalGs,
                        maxNegG: s.maxNegativeVerticalGs,
                        maxLatG: s.maxLateralGs,
                        drops: s.numDrops,
                        highestDropUnits: s.highestDropHeight,
                        airTimeS: s.totalAirTime,
                    },
                    ticks,
                    problems,
                    next_hints: stall ? [`coaster_undo { ride: ${ride}, count: ${Math.max(1, st.pieces.length - stall.index + 2)} } retire la fin à partir de la pièce bloquée (ou un peu avant), puis reconstruis avec plus d'élan (collines plus basses, descente avant) ; vérifie minKmh > 20 aux dryRun.`] : tested && !problems.length ? (status === "open" ? [] : [`ride_set_status { ride: ${ride}, status: 'open' } puis ride_configure (prix).`]) : ["Corrige selon problems, puis relance coaster_test."],
                },
            });
        },
    );
    defineTool(
        server,
        ctx,
        "coaster_describe",
        {
            title: "Relire un circuit (référence de style)",
            description:
                "Décrit un circuit existant (ride) ou un design .td6 (design, nom comme dans coaster_list_designs) pour s'en inspirer : type, notes, " +
                "layout (pièces, longueur en tuiles, emprise, densité, niveaux, pièces de chaîne, inversions, blocks : sections de bloc et trains permis), " +
                "space (compacité : couverture, tuiles empilées, plus grand vide, éléments isolés, une ligne par élément avec ce qu'il croise), " +
                "suggestedBounds (rectangle à imposer à coaster_build_plan pour rester aussi compact), target (longueur de piste, densité, empilement, " +
                "dessous du lift, trains : ce que coaster_build_plan { reference } fait respecter) et la séquence complète des pièces groupées, " +
                "avec la hauteur (L, en niveaux au-dessus de la station) au début et à la fin de chaque groupe et la vitesse d'entrée estimée (@km/h). " +
                "Pour un circuit du parc, coaster_test { ride } donne en plus les vitesses et G mesurés. À lire AVANT de construire « dans le style de X » : " +
                "reprends le type d'attraction, la forme du lift, l'ordre et la taille des éléments, puis vise une longueur et une densité comparables.",
            input: {
                design: z.string().min(1).max(256).optional(),
                ride: z.number().int().min(0).optional(),
            },
            readOnly: true,
        },
        async (args) => {
            if ((args.design === undefined) === (args.ride === undefined)) toolError("INVALID_PARAMS", "Donne soit design, soit ride.");
            const table = await segmentTable(ctx);
            if (args.design !== undefined) {
                const entry = findDesign(ctx, args.design);
                if (!entry.design) toolError("NOT_SUPPORTED_IN_MODE", `Design ${entry.name} illisible : ${entry.error}.`);
                const td = entry.design;
                const layout = designLayout(td, table, { x: 0, y: 0, z: 0 }, 0);
                const first = layout.pieces.find((p) => STATION_TYPES.has(p.type)) ?? layout.pieces[0];
                const baseZ = first ? first.z + table.require(first.type).beginZ : 0;
                const stats = layoutStats(table, layout.pieces);
                // Le type RCT2 du fichier vaut le type OpenRCT2 pour la plupart des coasters (sinon, pas de liste).
                const ride = rideTrackInfo(td.rideType);
                return result({
                    budget: BUDGET.readLarge,
                    response: {
                        summary:
                            `${entry.name} (${rideTypeName(td.rideType)}, véhicule ${td.vehicleObject}) : ${stats.pieces} pièces, ${stats.lengthTiles} tuiles de piste sur ${stats.footprint.size}, ${stats.inversions} inversion(s), ` +
                            `${stats.blocks.sections} sections de bloc (${td.numberOfTrains} train(s) de ${td.carsPerTrain} voitures, ${stats.blocks.maxTrains} permis).` +
                            (ride ? inversionNote(table, ride) : ""),
                        rideType: rideTypeName(td.rideType),
                        vehicle: td.vehicleObject,
                        expected: td.stats,
                        trains: { design: td.numberOfTrains, carsPerTrain: td.carsPerTrain, mode: td.rideMode, maxTrains: stats.blocks.maxTrains },
                        layout: { ...stats, minLevel: stats.minLevel - baseZ / 16, maxLevel: stats.maxLevel - baseZ / 16 },
                        relief: reliefView(reliefProfile(table, layout.pieces)),
                        ...spaceSection(spaceProfile(table, layout.pieces, { closed: layout.closed })),
                        target: layout.closed ? referenceTarget(entry.name, table, layout.pieces) : undefined,
                        sequence: describeSequence(
                            table,
                            layout.pieces,
                            baseZ,
                            simulate(
                                forRide(speedModels(ctx).get(td.rideType), { liftHillSpeed: td.liftHillSpeed, mode: td.rideMode }),
                                table,
                                layout.pieces,
                                speedModels(ctx).get(td.rideType).stationSpeed,
                                designTrain(td),
                            ).map((x) => kmh(x.vIn)),
                        ),
                        inversionsAvailable: ride ? availableInversions(table, ride) : undefined,
                        next_hints: [
                            "Pour t'en inspirer : même objet de véhicule (list_objects type ride), lift droit de hauteur comparable, puis traduis la séquence en macros (inversion, turn steep_down, helix…) en plusieurs coaster_build_plan close: false ; compare layout à chaque étape.",
                            "Reprends aussi ses sections de bloc (layout.blocks.boundaries) avec la macro block_brakes, pour faire tourner autant de trains (ride_configure { trains }) : sections = trains + 1, le dernier frein de bloc au bout des freins d'arrivée en gare, les autres espacés le long du parcours.",
                        ],
                    },
                });
            }
            const st = await loadCoaster(ctx, args.ride!);
            const detail = await ctx.bridge.call("ride.get", { id: st.rideId });
            const first = st.pieces.find((p) => STATION_TYPES.has(p.type)) ?? st.pieces[0];
            const baseZ = first ? first.z + table.require(first.type).beginZ : 0;
            const stats = layoutStats(table, st.pieces, false);
            const describeTrain = await rideTrain(ctx, st.rideId);
            let rating: RatingReport | { error: string } | undefined;
            if (st.closed && detail.excitement !== null && ratingsDataFor(st.rideType)) {
                try {
                    rating = await ratingBreakdown(ctx, st, detail);
                } catch (e) {
                    rating = { error: e instanceof Error ? e.message : String(e) };
                }
            }
            return result({
                budget: BUDGET.readLarge,
                response: {
                    summary:
                        `${st.name} (${st.ride.name}) : ${stats.pieces} pièces, ${stats.lengthTiles} tuiles de piste sur ${stats.footprint.size}, ${stats.inversions} inversion(s)${st.closed ? "" : ", circuit ouvert"}, ` +
                        `${stats.blocks.sections} sections de bloc (${stats.blocks.maxTrains} train(s) permis).` +
                        inversionNote(table, st.ride),
                    rating: rating && "computed" in rating ? reportView(rating) : rating,
                    rideType: st.ride.name,
                    object: detail.object,
                    trains: {
                        running: detail.vehicles,
                        mode: detail.mode,
                        // Hors mode à sections, le jeu compte les trains par longueur de station : un seul en pratique.
                        maxTrains: BLOCK_SECTIONED_MODES.has(detail.mode) ? stats.blocks.maxTrains : 1,
                        maxTrainsBlockSectioned: stats.blocks.maxTrains,
                    },
                    ratings: { excitement: detail.excitement, intensity: detail.intensity, nausea: detail.nausea },
                    closed: st.closed,
                    layout: { ...stats, minLevel: stats.minLevel - baseZ / 16, maxLevel: stats.maxLevel - baseZ / 16 },
                    relief: reliefView(reliefProfile(table, st.pieces)),
                    ...spaceSection(spaceProfile(table, st.pieces, { closed: st.closed })),
                    target: st.closed ? referenceTarget(st.name, table, st.pieces) : undefined,
                    sequence: describeSequence(table, st.pieces, baseZ, simulate(forRide(speedModels(ctx).get(st.rideType), st), table, st.pieces, speedModels(ctx).get(st.rideType).stationSpeed, describeTrain).map((x) => kmh(x.vIn))),
                    inversionsAvailable: availableInversions(table, st.ride),
                    warnings: st.closed
                        ? [...blockWarnings(stats.blocks, detail.mode), ...blockSpacingWarnings(blockSpacing(table, st.pieces, { closed: true, trainTiles: describeTrain ? trainLength(describeTrain) : undefined }), describeTrain ? trainLength(describeTrain) : undefined)]
                        : [],
                },
            });
        },
    );

    defineTool(
        server,
        ctx,
        "coaster_rating_breakdown",
        {
            title: "Décomposer les notes d'une montagne russe",
            description:
                "Recalcule l'excitation, l'intensité et la nausée d'un circuit déjà testé, terme par terme comme le jeu (RideRatings.cpp) : " +
                "longueur, durée (plafond 150 s), vitesse max et moyenne, G, virages (plats, inclinés, en pente, par longueur), inversions (plafond 6), " +
                "hélices (9), chutes (9), abri, proximité (pièces au ras du sol jusqu'à 70, piste au-dessus d'elle-même, chemins, eau), scénerie, " +
                "exigences et pénalités. Chaque terme donne sa valeur d'entrée et son plafond ; levers chiffre l'effet d'une variation " +
                "(+1 inversion, +1 mph de moyenne, +10 pièces au sol…) pour savoir quoi changer. Sans nouvel essai : lance coaster_test avant si la piste a changé.",
            input: { ride: z.number().int().min(0) },
            readOnly: true,
        },
        async ({ ride }) => {
            const st = await loadCoaster(ctx, ride);
            if (!st.closed) toolError("INVALID_PARAMS", `Circuit ouvert (${st.pieces.length} pièces).`);
            const detail = await ctx.bridge.call("ride.get", { id: ride });
            const rep = await ratingBreakdown(ctx, st, detail);
            return result({
                budget: BUDGET.readLarge,
                response: {
                    summary: `${st.name} : excitation recalculée ${rep.computed.excitement} (jeu ${rep.game.excitement}), intensité ${rep.computed.intensity} (jeu ${rep.game.intensity}), nausée ${rep.computed.nausea} (jeu ${rep.game.nausea}).`,
                    ...reportView(rep),
                },
            });
        },
    );

    defineTool(
        server,
        ctx,
        "coaster_compare",
        {
            title: "Comparer un circuit à sa référence",
            description:
                "Met côte à côte un circuit (ride) et sa référence (reference), tous deux dans le parc : notes, écart d'excitation par composante " +
                "(vitesse moyenne, inversions, virages, chutes, proximité…, au grain le plus fin), emprise, densité, longueur, durée, vitesses, " +
                "profil de vitesse le long du parcours (km/h tous les 10 % de la longueur), G par cinquième du parcours, suite des éléments, " +
                "sections de bloc et trains permis (blockLevers si le circuit en permet moins que la référence), compacité (space : couverture, " +
                "tuiles empilées, plus grand vide, éléments isolés ; spaceLevers si le circuit est moins compact que la référence). " +
                "Conclut par les trois leviers qui rapportent le plus. Teste chaque circuit qui n'a pas de mesure pour sa forme actuelle " +
                "(mesures gardées entre les appels ; retest: true pour forcer).",
            input: {
                ride: z.number().int().min(0),
                reference: z.number().int().min(0),
                retest: z.boolean().default(false),
                maxTicks: z.number().int().min(400).max(24000).default(8000),
            },
        },
        async ({ ride, reference, retest, maxTicks }) => {
            // La référence d'abord : c'est elle qui fixe la cible.
            const ref = await measureFor(ctx, reference, maxTicks, retest);
            const cur = await measureFor(ctx, ride, maxTicks, retest);
            const table = await segmentTable(ctx);
            const a = cur.m;
            const b = ref.m;
            const gaps = ratingGaps(a.rating!.terms, b.rating!.terms);
            const levers = topLevers(gaps, 3);
            const side = (m: CoasterMeasure) => ({
                name: m.name,
                footprint: m.layout.footprint.size,
                footprintTiles: (m.layout.footprint.x2 - m.layout.footprint.x1 + 1) * (m.layout.footprint.y2 - m.layout.footprint.y1 + 1),
                density: m.layout.density,
                pieces: m.layout.pieces,
                lengthM: Math.round(m.stats.rideLength),
                rideTimeS: m.stats.rideTime,
                avgSpeedKmh: Math.round(m.stats.averageSpeed * 1.609),
                maxSpeedKmh: Math.round(m.stats.maxSpeed * 1.609),
                inversions: m.rating!.inputs.features.inversions,
                helixPieces: m.rating!.inputs.features.helices,
                drops: m.stats.numDrops,
                maxPosG: m.stats.maxPositiveVerticalGs,
                maxNegG: m.stats.maxNegativeVerticalGs,
                maxLatG: m.stats.maxLateralGs,
                levels: `${m.layout.minLevel}→${m.layout.maxLevel}`,
                // Recalculé : les mesures gardées avant l'ajout de blocks ne l'ont pas.
                blocks: blockSections(m.pieces),
                measuredAt: m.measuredAt,
            });
            const dE = Math.round((b.ratings.excitement - a.ratings.excitement) * 100) / 100;
            // Relief (COASTER_SPACE 8) : la note ne dit pas si le circuit est plus plat que la référence.
            const reliefA = reliefProfile(table, a.pieces);
            const reliefB = reliefProfile(table, b.pieces);
            // Compacité (COASTER_SPACE 4.1) : aussi importante que les notes pour imiter la référence.
            const spaceA = spaceProfile(table, a.pieces, { closed: true });
            const spaceB = spaceProfile(table, b.pieces, { closed: true });
            return result({
                budget: BUDGET.readLarge,
                response: {
                    summary:
                        `${a.name} : ${a.ratings.excitement} / ${a.ratings.intensity} / ${a.ratings.nausea} ; ${b.name} (référence) : ${b.ratings.excitement} / ${b.ratings.intensity} / ${b.ratings.nausea}` +
                        ` ; écart d'excitation ${dE >= 0 ? "−" : "+"}${Math.abs(dE).toFixed(2)}` +
                        ` ; emprise ${spaceA.footprint.w}×${spaceA.footprint.h} contre ${spaceB.footprint.w}×${spaceB.footprint.h}, couverture ${Math.round(spaceA.coverage * 100)} % contre ${Math.round(spaceB.coverage * 100)} %, empilées ${spaceA.stackedTiles} contre ${spaceB.stackedTiles}.`,
                    levers,
                    reliefLevers: reliefLevers(reliefA, reliefB),
                    blockLevers: blockLevers(blockSections(a.pieces), blockSections(b.pieces)),
                    spaceLevers: [
                        ...targetLevers(referenceTarget(a.name, table, a.pieces), referenceTarget(b.name, table, b.pieces)).filter((l) => /^(longueur|densité)/.test(l)),
                        ...spaceLevers(spaceA, spaceB),
                    ],
                    space: { ride: spaceView(spaceA, { elements: false }), reference: spaceView(spaceB, { elements: false }) },
                    relief: { ride: reliefView(reliefA), reference: reliefView(reliefB) },
                    ratings: {
                        ride: a.ratings,
                        reference: b.ratings,
                        gap: {
                            excitement: dE,
                            intensity: Math.round((b.ratings.intensity - a.ratings.intensity) * 100) / 100,
                            nausea: Math.round((b.ratings.nausea - a.ratings.nausea) * 100) / 100,
                        },
                    },
                    components: gaps.map((g) => ({
                        component: g.key,
                        gap: g.gap / 100,
                        ride: g.ride / 100,
                        reference: g.reference / 100,
                        rideInput: g.rideInput,
                        referenceInput: g.referenceInput,
                    })),
                    layout: { ride: side(a), reference: side(b) },
                    speedProfileKmh: { ride: speedProfile(table, a.pieces, a.speedsKmh), reference: speedProfile(table, b.pieces, b.speedsKmh) },
                    gBySection: { ride: gSections(table, a.pieces, a.g), reference: gSections(table, b.pieces, b.g) },
                    elements: { ride: elementSequence(a.pieces), reference: elementSequence(b.pieces) },
                    measured: { ride: cur.fresh ? "essai effectué" : `mesure gardée (${a.measuredAt})`, reference: ref.fresh ? "essai effectué" : `mesure gardée (${b.measuredAt})` },
                    next_hints: ["coaster_rating_breakdown { ride } donne aussi l'effet marginal de chaque levier (levers) sur ce circuit."],
                },
            });
        },
    );

    defineTool(
        server,
        ctx,
        "coaster_list_designs",
        {
            title: "Designs de montagnes russes (.td6)",
            description:
                "Liste les designs de circuits prêts à poser (.td6/.td7 du dossier Tracks de RCT2 et du dossier track/ d'OpenRCT2) : nom, type d'attraction, " +
                "objet de véhicule (installé ou non), notes attendues, taille de l'emprise en tuiles (direction 0), nombre de pièces. " +
                "Filtres : query (nom ou type, ex. 'looping', 'wooden'), maxWidth/maxLength (place disponible), installedOnly. Puis coaster_place_design.",
            input: {
                query: z.string().max(64).optional(),
                installedOnly: z.boolean().default(true).describe("Seulement les designs dont l'objet de véhicule est installé."),
                maxSize: z.number().int().min(3).max(100).optional().describe("Plus grand côté de l'emprise (tuiles), dans un sens ou l'autre."),
                sort: z.enum(["name", "excitement", "size"]).default("name"),
                refresh: z.boolean().default(false).describe("Relit les dossiers (nouveaux fichiers)."),
                cursor: z.number().int().min(0).default(0),
                limit: z.number().int().min(1).max(40).default(20),
            },
            readOnly: true,
        },
        async (args) => {
            const lib = designLibrary(ctx, args.refresh);
            const table = await segmentTable(ctx);
            const objects = await installedRideObjects(ctx, args.refresh);
            const q = args.query?.toLowerCase();
            const rows = lib
                .filter((e): e is DesignEntry & { design: TrackDesign } => !!e.design)
                .map((e) => {
                    const td = e.design;
                    const obj = objects.get(td.vehicleObject.toUpperCase()) ?? null;
                    const layout = designLayout(td, table, { x: 0, y: 0, z: 0 }, 0);
                    const size = layoutSize(layout);
                    return { e, td, obj, size, layout, type: rideTypeName(td.rideType) };
                })
                .filter((r) => !q || r.e.name.toLowerCase().includes(q) || r.type.includes(q) || (r.obj?.name.toLowerCase().includes(q) ?? false))
                .filter((r) => !args.installedOnly || r.obj)
                .filter((r) => !args.maxSize || Math.max(r.size.x, r.size.y) <= args.maxSize);
            if (args.sort === "excitement") rows.sort((a, b) => b.td.stats.excitement - a.td.stats.excitement);
            if (args.sort === "size") rows.sort((a, b) => a.size.x * a.size.y - b.size.x * b.size.y);
            const page = rows.slice(args.cursor, args.cursor + args.limit);
            const unreadable = lib.filter((e) => !e.design).length;
            return result({
                budget: BUDGET.readLarge,
                response: {
                    summary: `${rows.length} design(s)${q ? ` pour « ${args.query} »` : ""} sur ${lib.length} lus${unreadable ? ` (${unreadable} illisibles ou non pris en charge : labyrinthes, RCT1)` : ""}.`,
                    designs: page.map((r) => ({
                        name: r.e.name,
                        rideType: r.type,
                        vehicle: r.obj ? r.obj.identifier : `${r.td.vehicleObject} (non installé)`,
                        loaded: r.obj ? r.obj.loaded : undefined,
                        ratings: `${r.td.stats.excitement}/${r.td.stats.intensity}/${r.td.stats.nausea}`,
                        size: `${r.size.x}×${r.size.y}`,
                        pieces: r.layout.pieces.length,
                        circuit: r.layout.closed ? undefined : "navette (non bouclé)",
                        scenery: r.td.sceneryCount || undefined,
                    })),
                    nextCursor: args.cursor + page.length < rows.length ? args.cursor + page.length : null,
                    next_hints: ["coaster_place_design { design: '<nom>', x, y, direction, dryRun: true } : (x, y) = coin nord-ouest de l'emprise (x et y minimaux)."],
                },
            });
        },
    );

    defineTool(
        server,
        ctx,
        "coaster_place_design",
        {
            title: "Poser un design de montagne russe (.td6)",
            description:
                "Pose un circuit tout fait (coaster_list_designs) : crée l'attraction avec l'objet de véhicule du design (chargé au besoin), rejoue ses pièces, " +
                "place entrée et sortie, applique les réglages (mode, trains, couleurs, attentes), puis raccorde au chemin (passerelle sur supports " +
                "si l'entrée/la sortie se trouve au-dessus du terrain environnant, ce qui est fréquent avec les designs importés). " +
                "(x, y) = coin de l'emprise aux x et y minimaux (anchor 'corner'), ou origine du design (anchor 'origin', comme le curseur du jeu). " +
                "direction 0-3 fait tourner le design (la première pièce part dans cette direction : 0 = −x, 1 = +y, 2 = +x, 3 = −y). " +
                "level : hauteur imposée de l'origine ; par défaut, la plus basse qui garde toute la piste au-dessus du terrain et de l'eau. " +
                "La scénerie du design n'est pas posée. dryRun: true vérifie l'emprise (terrain possédé, obstacles) sans rien poser. " +
                "Ensuite : coaster_test. Exemple : { design: 'Vortex', x: 40, y: 30, direction: 2, dryRun: true }.",
            input: {
                design: z.string().min(1).max(256).describe("Nom du design (exact ou partiel non ambigu) ou chemin du fichier."),
                x: z.number().int().min(1),
                y: z.number().int().min(1),
                direction: zDirection.default(0),
                anchor: z.enum(["corner", "origin"]).default("corner"),
                level: z.number().int().min(MIN_LEVEL).max(MAX_LEVEL).optional(),
                object: z.string().optional().describe("Objet de véhicule à utiliser à la place de celui du design (même type de piste)."),
                name: z.string().min(1).max(64).optional().describe("Défaut : nom du design."),
                connectToPath: z.boolean().default(true),
                dryRun: zDryRun,
            },
        },
        async (args) => {
            const entry = findDesign(ctx, args.design);
            if (!entry.design) toolError("NOT_SUPPORTED_IN_MODE", `Design ${entry.name} illisible : ${entry.error}.`, { hint: "Labyrinthes et designs RCT1 (.td4) ne sont pas pris en charge." });
            const td = entry.design;
            const table = await segmentTable(ctx);
            const warnings: string[] = [];
            const sandbox = ctx.state.mode === "sandbox";
            const dir = args.direction as Direction;

            // Objet de véhicule : celui demandé, sinon celui du design (chargé si besoin).
            let obj: ObjectInfo | undefined;
            if (args.object) {
                const objs = await ctx.bridge.call("objects.list", { type: "ride", query: args.object, limit: 50 });
                obj = (objs.items as ObjectInfo[]).find((o) => o.identifier === args.object) ?? (objs.items.length === 1 ? objs.items[0] : undefined);
                if (!obj) toolError("OBJECT_NOT_LOADED", `Objet d'attraction ${args.object} introuvable.`, { hint: "list_objects { type: 'ride', query }." });
            } else {
                let objects = await installedRideObjects(ctx);
                if (!objects.has(td.vehicleObject.toUpperCase())) objects = await installedRideObjects(ctx, true);
                obj = objects.get(td.vehicleObject.toUpperCase());
                if (!obj) {
                    toolError("OBJECT_NOT_LOADED", `Objet de véhicule ${td.vehicleObject} du design ${entry.name} non installé.`, {
                        hint: `Passe object: un objet installé du même type (${rideTypeName(td.rideType)}) ; list_objects { type: 'ride', query }.`,
                    });
                }
            }
            if (!obj.loaded && !args.dryRun) {
                const r = await ctx.bridge.call("objects.load", { identifiers: [obj.identifier] });
                if (!r.results[0]?.ok) toolError("OBJECT_NOT_LOADED", `Chargement de ${obj.identifier} refusé : ${r.results[0]?.error ?? "?"}.`, { hint: "Emplacements d'objets pleins ? Décharge un objet inutilisé." });
                rideObjectsCache = null;
                warnings.push(`Objet ${obj.identifier} chargé.`);
            }
            if (!obj.extra?.rideType) {
                const objs = await ctx.bridge.call("objects.list", { type: "ride", query: obj.identifier, loadedOnly: true, limit: 50 });
                obj = (objs.items as ObjectInfo[]).find((o) => o.identifier === obj!.identifier) ?? obj;
            }
            const rideType = resolveRideType(td, obj) ?? td.rideType;
            if (rideType !== td.rideType) warnings.push(`Type converti : ${rideTypeName(td.rideType)} → ${rideTypeName(rideType)} (objet ${obj.identifier}).`);

            // Emprise relative, puis ancrage et hauteur.
            const rel = designLayout(td, table, { x: 0, y: 0, z: 0 }, dir);
            if (rel.unknownPieces.length) toolError("NOT_SUPPORTED_IN_MODE", `Pièces inconnues dans le design : ${[...new Set(rel.unknownPieces)].join(", ")}.`, { hint: "Réexporte data/track_segments.json (tools/export-segments.mjs)." });
            const ox = args.anchor === "corner" ? args.x - rel.bbox.x1 : args.x;
            const oy = args.anchor === "corner" ? args.y - rel.bbox.y1 : args.y;
            const rect = { x1: ox + rel.bbox.x1 - 2, y1: oy + rel.bbox.y1 - 2, x2: ox + rel.bbox.x2 + 2, y2: oy + rel.bbox.y2 + 2 };
            const mapSize = await ctx.cache.mapSize();
            if (rect.x1 + 2 < 1 || rect.y1 + 2 < 1 || rect.x2 - 2 >= mapSize.x - 1 || rect.y2 - 2 >= mapSize.y - 1) {
                toolError("INVALID_PARAMS", `Le design (${layoutSize(rel).x}×${layoutSize(rel).y}) sort de la carte depuis (${args.x},${args.y}).`, { hint: "Déplace (x, y) ou tourne le design (direction)." });
            }
            const reg = await ctx.cache.region(rect);
            let z0: number;
            if (args.level !== undefined) z0 = args.level * 16;
            else {
                // Plus basse origine qui garde chaque bloc au-dessus du sol et de l'eau (TrackDesignGetZPlacement).
                z0 = 16;
                for (const b of rel.blocks) {
                    const t = reg.get(ox + b.x, oy + b.y);
                    if (t) z0 = Math.max(z0, groundTopZ(t) - b.z);
                }
                z0 = Math.ceil(z0 / 16) * 16;
            }
            const layout = designLayout(td, table, { x: ox, y: oy, z: z0 }, dir);
            const env: TrackEnv = { get: reg.get, rideId: -1, sandbox, mapSize };
            const problems: string[] = [];
            for (const b of layout.blocks) {
                const why = blockProblem(env, b);
                if (why) problems.push(`(${b.x},${b.y}) niveau ${b.z / 16} : ${why}`);
            }
            for (const a of layout.accesses) {
                const t = reg.get(a.x, a.y);
                if (!t) continue;
                if (!(t.o & 1) && !sandbox) problems.push(`${a.isExit ? "sortie" : "entrée"} (${a.x},${a.y}) : terrain non possédé`);
                else if (t.p?.length || t.r?.length || t.lg) problems.push(`${a.isExit ? "sortie" : "entrée"} (${a.x},${a.y}) : occupé`);
            }
            const maxLevel = Math.max(...layout.blocks.map((b) => b.z)) / 16;
            const size = layoutSize(layout);
            const footprint = { from: { x: layout.bbox.x1, y: layout.bbox.y1 }, to: { x: layout.bbox.x2, y: layout.bbox.y2 }, size: `${size.x}×${size.y}` };
            if (problems.length) {
                toolError("OBSTRUCTED", `${entry.name} ne passe pas en (${args.x},${args.y}) : ${problems.slice(0, 4).join(" ; ")}${problems.length > 4 ? ` (+${problems.length - 4})` : ""}.`, {
                    details: { footprint, problems: problems.slice(0, 10) },
                    hint: "Choisis une zone libre et possédée de cette taille (get_region_map), tourne le design, ou nivelle (terrain_flatten).",
                });
            }
            const header = {
                design: entry.name,
                rideType: rideTypeName(rideType),
                vehicle: obj.identifier,
                footprint,
                origin: { x: ox, y: oy, level: z0 / 16, direction: dir },
                maxLevel,
                pieces: layout.pieces.length,
                circuit: layout.closed ? "fermé" : "navette (non bouclé, comme dans le design)",
                expected: { excitement: td.stats.excitement, intensity: td.stats.intensity, nausea: td.stats.nausea, maxSpeedKmh: td.stats.maxSpeedKmh, inversions: td.stats.inversions },
            };
            if (args.dryRun) {
                return result({
                    budget: BUDGET.write * 2,
                    response: { summary: `[simulation] ${entry.name} posable : emprise ${footprint.size} de (${layout.bbox.x1},${layout.bbox.y1}) à (${layout.bbox.x2},${layout.bbox.y2}), origine niveau ${z0 / 16}.`, ...header, warnings },
                });
            }

            const created = await ctx.bridge.call("ride.create", { object: obj.identifier, rideType });
            const rideId = created.rideId;
            if (rideId === null) toolError("INTERNAL", "ridecreate n'a pas renvoyé d'identifiant.");
            forgetRide(rideId);
            let cost = created.cost;
            const placed = await runBatch(ctx, layout.pieces.map((p) => placeOp(rideId, rideType, p)), false);
            if (placed.firstFailureIndex !== null) {
                await ctx.bridge.call("ride.demolish", { ride: rideId }).catch(() => undefined);
                ctx.cache.invalidateTiles(layout.blocks, 1);
                const f = failureMessage(layout.pieces, placed)[0];
                toolError("GAME_ACTION_FAILED", `Pièce ${f.index}/${layout.pieces.length} (${f.piece}) refusée en (${f.tile.x},${f.tile.y}) : ${f.message}. Rien n'a été gardé.`, {
                    details: { footprint, origin: header.origin },
                    hint: f.hint ?? "Obstacle invisible au serveur (scénerie, autre piste, hauteur max) ? Déplace le design ou relève-le (level).",
                });
            }
            cost += placed.totalCost;
            ctx.cache.invalidateTiles(layout.blocks, 2);

            // Entrées et sorties à leurs places dans le design.
            const placedAccess: { entrance: PlacedAccess | null; exit: PlacedAccess | null } = { entrance: null, exit: null };
            for (const a of layout.accesses) {
                const r = await ctx.bridge.call("ride.place_entrance_exit", { ride: rideId, station: a.station, x: a.x, y: a.y, direction: a.direction, isExit: a.isExit });
                if (r.ok) {
                    cost += r.cost ?? 0;
                    const key = a.isExit ? "exit" : "entrance";
                    if (!placedAccess[key]) placedAccess[key] = { tile: { x: a.x, y: a.y }, outward: reverseDirection(a.direction) };
                } else warnings.push(`${a.isExit ? "Sortie" : "Entrée"} refusée en (${a.x},${a.y}) : ${r.error?.message}`);
            }
            ctx.cache.invalidateTiles(layout.accesses, 1);

            // Réglages du design (les refus sont signalés, pas bloquants).
            const settingOps: [keyof typeof RIDE_SETTINGS, number][] = [
                ["mode", td.rideMode],
                ["departure", td.departFlags],
                ["minWaitingTime", td.minWaitingTime],
                ["maxWaitingTime", td.maxWaitingTime],
                ["operation", td.operationSetting],
                ["liftHillSpeed", td.liftHillSpeed],
                ["numCircuits", Math.max(1, td.numCircuits)],
            ];
            const refused: string[] = [];
            for (const [setting, value] of settingOps) {
                // 0 = valeur par défaut ou sans objet pour ce mode (ex. operation en circuit continu).
                if (!value && setting !== "mode" && setting !== "departure") continue;
                const r = await ctx.bridge.call("ride.set_setting", { ride: rideId, setting, value });
                if (!r.ok) refused.push(`${setting}=${value}`);
            }
            const appearance: BatchOp[] = [];
            // RideSetVehicleAction : numCarsPerTrain (1), numTrains (0) ; RideSetAppearanceAction : couleurs de piste (0-2), véhicules (3-6).
            if (td.carsPerTrain) appearance.push({ action: "ridesetvehicle", args: { ride: rideId, type: 1, value: td.carsPerTrain, colour: 0 } });
            if (td.numberOfTrains) appearance.push({ action: "ridesetvehicle", args: { ride: rideId, type: 0, value: td.numberOfTrains, colour: 0 } });
            td.trackColours.forEach((c, i) => {
                appearance.push({ action: "ridesetappearance", args: { ride: rideId, type: 0, value: c.main, index: i } });
                appearance.push({ action: "ridesetappearance", args: { ride: rideId, type: 1, value: c.additional, index: i } });
                appearance.push({ action: "ridesetappearance", args: { ride: rideId, type: 2, value: c.supports, index: i } });
            });
            appearance.push({ action: "ridesetappearance", args: { ride: rideId, type: 6, value: td.colourScheme, index: 0 } });
            const trains = td.colourScheme === 0 ? 1 : Math.max(1, td.numberOfTrains);
            for (let i = 0; i < trains; i++) {
                const c = td.vehicleColours[i];
                appearance.push({ action: "ridesetappearance", args: { ride: rideId, type: 3, value: c.body, index: i } });
                appearance.push({ action: "ridesetappearance", args: { ride: rideId, type: 4, value: c.trim, index: i } });
                appearance.push({ action: "ridesetappearance", args: { ride: rideId, type: 5, value: c.tertiary, index: i } });
            }
            const app = await ctx.bridge.call("batch.execute", { ops: appearance, dryRun: false, stopOnError: false });
            const appFailed = app.results.filter((r) => !r.ok).length;
            if (refused.length || appFailed) warnings.push(`Réglages refusés : ${[...refused, ...(appFailed ? [`${appFailed} couleur(s)/train(s)`] : [])].join(", ")} (valeurs du design hors limites pour ce véhicule).`);

            const rideName = args.name ?? entry.name;
            const nr = await ctx.bridge.call("ride.set_name", { ride: rideId, name: rideName });
            if (!nr.ok) warnings.push(`Nom « ${rideName} » refusé : ${nr.error?.message}`);
            if (!placedAccess.entrance || !placedAccess.exit) warnings.push(`${!placedAccess.entrance ? "Entrée" : "Sortie"} absente : pose-la le long de la station avant coaster_test.`);
            if (td.sceneryCount) warnings.push(`${td.sceneryCount} élément(s) de scénerie du design non posés.`);

            const inverse: InverseOp[] = [{ method: "ride.demolish", params: { ride: rideId } }];
            let connections: Record<string, unknown> = {};
            if (args.connectToPath && (placedAccess.entrance || placedAccess.exit)) {
                // Pas d'exclusion systématique de l'emprise du circuit : la hauteur de dégagement (rh) de chaque
                // tuile suffit à distinguer une piste qui passe à une autre hauteur (passerelle valide par-dessus
                // ou par-dessous) d'une vraie collision. connectEntrances évite déjà les tuiles d'entrée et de
                // sortie, et essaie d'abord de contourner l'emprise (footprint) avant d'accepter de la traverser.
                const avoid = new Set<string>();
                const stationLevel = Math.round(Math.min(...layout.accesses.map((a) => a.z)) / 16);
                const c = await connectEntrances(ctx, { entrance: placedAccess.entrance, exit: placedAccess.exit, avoid, level: stationLevel, sandbox, footprint: layout.bbox });
                connections = c.connections;
                cost += c.cost;
                if (c.placedPaths.length) inverse.unshift({ method: "path.remove_tiles", params: { tiles: c.placedPaths.map((t) => ({ x: t.x, y: t.y, level: t.level })) } });
            }
            ctx.state.validated = ctx.state.validated && !sandbox;
            ctx.journal.record({ tool: "coaster_place_design", summary: `${entry.name} #${rideId} en (${layout.bbox.x1},${layout.bbox.y1})`, params: args, inverse, cost });
            return result({
                budget: BUDGET.write * 3,
                response: {
                    summary: `${entry.name} posé : rideId ${rideId}, ${layout.pieces.length} pièces, emprise ${footprint.size} de (${layout.bbox.x1},${layout.bbox.y1}) à (${layout.bbox.x2},${layout.bbox.y2}), coût ${cost}.`,
                    rideId,
                    ...header,
                    entrance: placedAccess.entrance?.tile ?? null,
                    exit: placedAccess.exit?.tile ?? null,
                    connections,
                    warnings,
                    next_hints: [`coaster_test { ride: ${rideId}, open: true } pour les essais et les notes réelles.`],
                },
            });
        },
    );
}
