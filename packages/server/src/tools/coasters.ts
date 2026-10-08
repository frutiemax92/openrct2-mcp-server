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
    availableInversions,
    compileMacros,
    describePose,
    describeSequence,
    endPose,
    fits,
    groundTopZ,
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
    type Macro,
    type PlannedPiece,
    type RideTrackInfo,
    type TrackBlock,
    type TrackEnv,
    type TrackPose,
    rideClearance,
} from "../planners/track.js";
import { designDirs, designLayout, loadLibrary, type DesignEntry, type DesignLayout, type DesignPiece, type TrackDesign } from "../planners/td6.js";
import {
    SpeedModels,
    TRACK_SPEED_TO_MPH,
    elementKind,
    elementMinSpeed,
    fitModel,
    matchSamples,
    modelError,
    mphToKmh,
    simulate,
    speedWindows,
    windowFor,
    type MeasuredPiece,
    type PieceSpeed,
    type SpeedModel,
    type SpeedWindow,
} from "../planners/speed.js";
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
// Vitesse : modèle calé sur les mesures (planners/speed.ts) et fenêtres d'entrée relevées sur les designs RCT2
// ---------------------------------------------------------------------------

let modelsCache: SpeedModels | null = null;
const speedModels = (ctx: ToolContext): SpeedModels => (modelsCache ??= SpeedModels.inUserDir(ctx.config.userDir));

let windowsCache: { model: SpeedModel; windows: Map<string, SpeedWindow> } | null = null;

/** Fenêtres de vitesse d'entrée par genre d'élément, sur les circuits fermés de la bibliothèque de designs. */
function elementWindows(ctx: ToolContext, table: SegmentTable, model: SpeedModel): Map<string, SpeedWindow> {
    if (windowsCache && windowsCache.model === model) return windowsCache.windows;
    const circuits = designLibrary(ctx)
        .filter((e): e is DesignEntry & { design: TrackDesign } => !!e.design && !!rideTrackInfo(e.design.rideType))
        .map((e) => designLayout(e.design, table, { x: 0, y: 0, z: 0 }, 0))
        .filter((l) => l.closed && !l.unknownPieces.length)
        .map((l) => l.pieces);
    const windows = speedWindows(model, table, circuits);
    windowsCache = { model, windows };
    return windows;
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

/** Contrôle de vitesse d'un plan : calage, ou élément abordé hors de la plage des designs RCT2. */
function speedWarnings(table: SegmentTable, pieces: PlannedPiece[], sim: PieceSpeed[], windows: Map<string, SpeedWindow>, macros: Macro[]): string[] {
    const out: string[] = [];
    const seen = new Set<string>();
    pieces.forEach((p, i) => {
        const where = p.macro !== undefined ? `macro ${p.macro} (${macros[p.macro]?.op ?? "?"}${(macros[p.macro] as { kind?: string })?.kind ? ` ${(macros[p.macro] as { kind?: string }).kind}` : ""})` : "fermeture";
        if (sim[i].stall && !seen.has(`stall${p.macro}`)) {
            seen.add(`stall${p.macro}`);
            out.push(`CALAGE probable sur ${where}, pièce ${p.name} en (${p.x},${p.y}) : entrée à ${kmh(sim[i].vIn)} km/h, pas assez d'élan. Descends avant, réduis la hauteur de l'élément, ou avance-le dans le parcours.`);
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
    return out;
}

/** Profil de vitesse par macro : entrée, sortie, minimum (km/h), niveau de sortie. */
function macroProfile(pieces: PlannedPiece[], sim: PieceSpeed[], macros: Macro[]): { macro: number; op: string; inKmh: number; outKmh: number; minKmh: number; endLevel: number; stall?: true }[] {
    const out: { macro: number; op: string; inKmh: number; outKmh: number; minKmh: number; endLevel: number; stall?: true }[] = [];
    pieces.forEach((p, i) => {
        if (p.macro === undefined) return;
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
    return { get: reg.get, rideId: st.rideId, sandbox: ctx.state.mode === "sandbox", mapSize: await ctx.cache.mapSize() };
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
 */
async function runCoasterTest(ctx: ToolContext, st: CoasterState, maxTicks: number): Promise<{ detail: RideDetail; ticks: number; samples: Map<string, PieceSample> }> {
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
    while (ticks < maxTicks) {
        const run = await ctx.bridge.call("time.run", { ticks: step, speed: 4, sample: { ride } }, { timeoutMs: (step / 40 / 4) * 2000 + 30_000 });
        for (const sm of run.samples ?? []) mergeSample(samples, sm);
        ticks += step;
        detail = await ctx.bridge.call("ride.get", { id: ride });
        const f = flagsOf(detail);
        if (f & RIDE_FLAGS.crashed) break;
        // « tested » peut rester d'un essai précédent : on attend aussi que le premier train ait parcouru le
        // circuit (au moins 90 % des pièces relevées), pour avoir un profil de vitesse complet.
        const covered = matchSamples(st.pieces, [...samples.values()]).filter((m) => m.sample && m.sample.n > 0).length;
        if (f & RIDE_FLAGS.tested && covered >= st.pieces.length * 0.9) break;
    }
    return { detail, ticks, samples };
}

let measuresCache: MeasureStore | null = null;
const measures = (ctx: ToolContext): MeasureStore => (measuresCache ??= MeasureStore.inUserDir(ctx.config.userDir));

/** Garde les mesures d'un essai réussi (coaster_compare les réutilise tant que le circuit ne change pas). */
function recordMeasure(ctx: ToolContext, st: CoasterState, detail: RideDetail, measured: MeasuredPiece[], rating: RatingReport | undefined): CoasterMeasure {
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
    if (!(flagsOf(run.detail) & RIDE_FLAGS.tested) || flagsOf(run.detail) & RIDE_FLAGS.crashed) {
        toolError("GAME_ACTION_FAILED", `${st.name} : essai non concluant (accident ou essais incomplets).`, { hint: `coaster_test { ride: ${rideId} } pour le détail.` });
    }
    const rating = await ratingBreakdown(ctx, st, run.detail);
    return { m: recordMeasure(ctx, st, run.detail, matchSamples(st.pieces, [...run.samples.values()]), rating), fresh: true };
}

/** Version compacte pour les réponses d'outils (sans les entrées brutes). */
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
function checkPieces(st: CoasterState, env: TrackEnv, start: TrackPose, pieces: PlannedPiece[], occ: Occupancy): { index: number; piece: string; tile: TileXY; message: string }[] {
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
            const why = blockProblem(env, e);
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
}

async function closeCircuit(
    ctx: ToolContext,
    st: CoasterState,
    env: TrackEnv,
    from: TrackPose,
    occ: Occupancy,
    opts: { inversions: boolean; diagonals: boolean; maxPieces: number },
): Promise<ClosureOutcome> {
    if (!st.stationStart) return { pieces: null, expansions: 0, attempts: 0, rejected: [] };
    // Le plan aboutit déjà à l'entrée de la station : rien à ajouter, le circuit est fermé.
    if (samePose(from, st.stationStart)) return { pieces: [], expansions: 0, attempts: 0, rejected: [] };
    const catalog = searchCatalog(st.table, st.ride, { inversions: opts.inversions, diagonals: opts.diagonals, steep: true, chainedClimbsOnly: true });
    const forbidden = new Set<string>();
    const rejected: ClosureOutcome["rejected"] = [];
    let expansions = 0;
    const zMin = Math.min(st.stationStart.z, from.z, ...st.pieces.map((p) => p.z)) - 16 * 4;
    for (let attempt = 1; attempt <= 5; attempt++) {
        const res = planClosure(catalog, from, st.stationStart, occ, env, { forbidden, maxPieces: opts.maxPieces, zMin: Math.max(16, zMin) });
        expansions += res?.expansions ?? 0;
        if (!res) return { pieces: null, expansions, attempts: attempt, rejected };
        const q = await runBatch(ctx, res.pieces.map((p) => placeOp(st.rideId, st.rideType, p)), true);
        if (q.firstFailureIndex === null) return { pieces: res.pieces, expansions, attempts: attempt, rejected };
        for (const f of q.results.filter((x) => !x.ok)) {
            const p = res.pieces[f.index];
            forbidden.add(pieceKey(p));
            if (rejected.length < 5) rejected.push({ piece: p.name, tile: { x: p.x, y: p.y }, message: f.error?.message ?? "refusé" });
            if (/paus/i.test(f.error?.message ?? "")) toolError("GAME_ACTION_FAILED", f.error?.message ?? "Construction en pause refusée.", { hint: PAUSE_HINT });
        }
    }
    return { pieces: null, expansions, attempts: 5, rejected };
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
    z.object({ op: z.literal("brakes"), length: z.number().int().min(1).max(10), speed: z.number().int().min(1).max(30).optional() }),
    z.object({ op: z.literal("block_brakes") }),
    z.object({ op: z.literal("photo") }),
    z.object({ op: z.literal("level") }),
    z.object({ op: z.literal("piece"), name: z.string(), chain: z.boolean().optional() }),
]);

const MACRO_DOC =
    "Macros : straight{length} ; lift{height,steep?} (montée à chaîne droite, en niveaux) ; climb{height,steep?} (montée sans chaîne, sur l'élan) ; " +
    "drop{height,steep?} ; hill{height,steep?} (colline : monte puis redescend, freine le train et donne de l'airtime) ; turn{dir:left|right,size:small|medium|large,banked?,quarters?,slope:flat|up|down|steep_up|steep_down} ; " +
    "helix{dir,quarters,down?,size:small|large} ; inversion{kind:loop|immelmann|dive_loop|corkscrew|zero_g_roll|barrel_roll,dir,size?:small|medium|large} " +
    "(inversion complète, entrée et sortie à l'endroit ; sans size, la plus grande disponible) ; loop{dir} (petite boucle verticale) ; s_bend{dir} ; " +
    "brakes{length,speed?} ; block_brakes ; photo ; level (revient à plat) ; piece{name,chain?} (pièce brute, nom TrackElemType). " +
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
                "de marche `direction` (0 = −x, 1 = +y, 2 = +x, 3 = −y), puis place entrée et sortie le long de la station et les raccorde au chemin " +
                "(passerelle sur supports si level surélève la station au-dessus du terrain). " +
                "Ensuite : coaster_build_plan (macros, puis fermeture automatique), coaster_test. Laisse au moins 15 tuiles libres devant et autour. " +
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
                connectToPath: z.boolean().default(true),
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
        "coaster_build_plan",
        {
            title: "Construire un circuit par macros",
            description:
                "Compile un plan de 1 à 60 macro-éléments en pièces depuis la fin du circuit, vérifie (continuité, collisions, terrain, puis le jeu par " +
                "simulation), construit, puis referme le circuit jusqu'à la station (close: true, recherche A* ; les montées de la fermeture sont à chaîne). " +
                `${MACRO_DOC} Hauteurs en niveaux (1 niveau = 16 unités). plan: [] avec close: true ne fait que refermer. dryRun: true montre le plan ` +
                "sans rien poser. Renvoie les pièces (résumé), l'état fermé ou non, la pose de fin, layout (pièces, longueur en tuiles, emprise, " +
                "densité, inversions : à comparer avec coaster_describe d'un circuit de référence) et warnings (lift en courbe, virage serré à grande vitesse). " +
                "speeds donne, pour chaque macro, la vitesse estimée en entrée, en sortie et au plus bas (km/h) ; les warnings signalent un CALAGE probable " +
                "et tout élément abordé TROP RAPIDE ou TROP LENT par rapport aux designs RCT2 (ex. zero-g roll au pied d'une grande chute : mets une colline avant). " +
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
                dryRun: zDryRun,
            },
        },
        async (args) => {
            if (!args.dryRun) await clearTrains(ctx, args.ride);
            const st = await loadCoaster(ctx, args.ride);
            if (st.closed) toolError("INVALID_PARAMS", `Le circuit de ${st.name} est déjà fermé (${st.pieces.length} pièces).`, { hint: "coaster_undo pour retirer des pièces, ou coaster_test." });
            if (!st.cursor || !st.stationStart) toolError("NOT_FOUND", "Circuit vide : crée la station avec coaster_create.");
            const compiled = compileMacros(st.table, st.ride, st.cursor, args.plan as Macro[]);
            if (compiled.errors.length) {
                toolError("INVALID_PARAMS", `Plan invalide : ${compiled.errors.map((e) => `macro ${e.macro} : ${e.message}`).join(" ; ")}.`, {
                    details: { errors: compiled.errors },
                    hint: "Corrige la macro fautive (pièce indisponible pour ce type de montagne russe, hauteur impossible…).",
                });
            }
            const env = await trackEnv(ctx, st, compiled.pieces, 24);
            const occ = st.occupancy;
            const problems = checkPieces(st, env, st.cursor, compiled.pieces, occ);
            if (problems.length) {
                toolError("OBSTRUCTED", `Le plan ne passe pas : ${problems.slice(0, 3).map((p) => `pièce ${p.index} ${p.piece} en (${p.tile.x},${p.tile.y}) : ${p.message}`).join(" ; ")}.`, {
                    details: { problems: problems.slice(0, 6), pieces: compiled.pieces.length },
                    hint: "Change l'ordre ou le sens des virages, monte plus haut pour passer au-dessus, ou choisis une zone dégagée (get_region_map).",
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
            if (args.close) {
                closure = await closeCircuit(ctx, st, env, planEnd, occ, { inversions: args.allowInversions, diagonals: args.allowDiagonals, maxPieces: args.maxClosurePieces });
                if (!closure.pieces && args.dryRun) {
                    // Rapport en simulation : le plan seul reste valide.
                } else if (!closure.pieces) {
                    toolError("NOT_FOUND", `Aucune fermeture trouvée depuis ${JSON.stringify(describePose(planEnd))} vers la station (${closure.expansions} états explorés).`, {
                        details: { rejected: closure.rejected, stationStart: describePose(st.stationStart) },
                        hint: "Termine le plan plus près de la station, à une hauteur proche, orienté vers elle ; ou close: false puis coaster_next_pieces.",
                    });
                }
            }
            const all = [...compiled.pieces, ...(closure?.pieces ?? [])];
            const styleWarnings = planWarnings(st.table, all, peakBefore);
            // Vitesse : depuis la station le long du circuit existant, puis le long du plan et de la fermeture.
            const model = speedModels(ctx).get(st.rideType);
            const before = simulate(model, st.table, st.pieces, model.stationSpeed);
            const vCursor = before.length ? before[before.length - 1].vOut : model.stationSpeed;
            const sim = simulate(model, st.table, all, vCursor);
            styleWarnings.push(...speedWarnings(st.table, all, sim, elementWindows(ctx, st.table, model), args.plan as Macro[]));
            const speeds = {
                cursorKmh: kmh(vCursor),
                macros: macroProfile(all, sim, args.plan as Macro[]),
                closure: closure?.pieces?.length ? { inKmh: kmh(sim[compiled.pieces.length]?.vIn ?? 0), outKmh: kmh(sim[sim.length - 1].vOut) } : undefined,
                model: model.samples ? `calé sur ${model.samples} mesures` : "valeurs par défaut (lance coaster_test sur un circuit de référence pour caler)",
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
            return result({
                budget: BUDGET.write * 3,
                response: {
                    summary: `${done.length}/${all.length} pièce(s) posée(s) sur ${st.name}, coût ${placed.totalCost} ; circuit ${after.closed ? "fermé" : "ouvert"} (${after.pieces.length} pièces).`,
                    plan: compactPieces(compiled.pieces),
                    closure: closure?.pieces ? compactPieces(closure.pieces) : null,
                    closed: after.closed,
                    maxLevel: Math.max(...done.map((p) => p.z / 16), 0),
                    layout: layoutStats(st.table, after.pieces, false),
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
            return result({
                budget: BUDGET.write,
                response: {
                    summary: `${args.dryRun ? "[simulation] " : ""}${args.dryRun ? planned.length - failures.length : done.length}/${planned.length} pièce(s) ${args.dryRun ? "acceptée(s)" : "posée(s)"}, coût ${r.totalCost}${closed ? " ; circuit fermé" : ""}.`,
                    cursor: describePose(done.length ? end : st.cursor),
                    failures,
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
                "hotspots (pièces aux G les plus forts, pièce la plus lente), puis recale le modèle de vitesse utilisé par coaster_build_plan. " +
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
            const { ticks, samples } = run;
            const detail = run.detail;
            const f = flagsOf(detail);
            const tested = !!(f & RIDE_FLAGS.tested);
            const problems: string[] = [];
            if (f & RIDE_FLAGS.crashed) problems.push("accident : un train s'est écrasé (collision ou sortie de piste) ; vérifie les freins de bloc et la fermeture.");
            if (f & RIDE_FLAGS.hasStalledVehicle) problems.push("train calé : élan insuffisant ; ajoute une chaîne (lift) avant la montée ou réduis-la.");
            if (!tested && !(f & RIDE_FLAGS.crashed)) problems.push(`essais non terminés après ${ticks} ticks (circuit long, ou train bloqué).`);
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
            const prior = models.get(st.rideType);
            const fitted = tested ? fitModel(st.table, measured, prior) : prior;
            const meanError = modelError(fitted, st.table, measured);
            if (fitted !== prior) models.set(st.rideType, fitted);
            let rating: RatingReport | { error: string } | undefined;
            if (tested && !(f & RIDE_FLAGS.crashed)) {
                try {
                    rating = await ratingBreakdown(ctx, st, detail);
                } catch (e) {
                    rating = { error: `Décomposition indisponible : ${e instanceof Error ? e.message : String(e)} (plugin à jour ? redémarre le jeu après install:plugin).` };
                }
                recordMeasure(ctx, st, detail, measured, rating && "computed" in rating ? rating : undefined);
            }
            return result({
                budget: BUDGET.readLarge,
                response: {
                    summary: `${st.name} : ${tested ? "essais terminés" : "essais incomplets"}${f & RIDE_FLAGS.crashed ? ", ACCIDENT" : ""} ; excitation ${detail.excitement ?? "?"}, intensité ${detail.intensity ?? "?"}, nausée ${detail.nausea ?? "?"}.`,
                    profile: describeSequence(st.table, st.pieces, baseZ, speedsKmh),
                    hotspots,
                    speedModel: {
                        samples: fitted.samples,
                        meanErrorKmh: isFinite(meanError) ? Math.round(meanError * 10) / 10 : null,
                        updated: fitted !== prior,
                    },
                    status,
                    tested,
                    crashed: !!(f & RIDE_FLAGS.crashed),
                    stalled: !!(f & RIDE_FLAGS.hasStalledVehicle),
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
                    next_hints: tested && !problems.length ? (status === "open" ? [] : [`ride_set_status { ride: ${ride}, status: 'open' } puis ride_configure (prix).`]) : ["Corrige selon problems, puis relance coaster_test."],
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
                "layout (pièces, longueur en tuiles, emprise, densité, niveaux, pièces de chaîne, inversions) et la séquence complète des pièces groupées, " +
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
                        summary: `${entry.name} (${rideTypeName(td.rideType)}, véhicule ${td.vehicleObject}) : ${stats.pieces} pièces, ${stats.lengthTiles} tuiles de piste sur ${stats.footprint.size}, ${stats.inversions} inversion(s).`,
                        rideType: rideTypeName(td.rideType),
                        vehicle: td.vehicleObject,
                        expected: td.stats,
                        layout: { ...stats, minLevel: stats.minLevel - baseZ / 16, maxLevel: stats.maxLevel - baseZ / 16 },
                        sequence: describeSequence(table, layout.pieces, baseZ, simulate(speedModels(ctx).get(td.rideType), table, layout.pieces, speedModels(ctx).get(td.rideType).stationSpeed).map((x) => kmh(x.vIn))),
                        inversionsAvailable: ride ? availableInversions(table, ride) : undefined,
                        next_hints: [
                            "Pour t'en inspirer : même objet de véhicule (list_objects type ride), lift droit de hauteur comparable, puis traduis la séquence en macros (inversion, turn steep_down, helix…) en plusieurs coaster_build_plan close: false ; compare layout à chaque étape.",
                        ],
                    },
                });
            }
            const st = await loadCoaster(ctx, args.ride!);
            const detail = await ctx.bridge.call("ride.get", { id: st.rideId });
            const first = st.pieces.find((p) => STATION_TYPES.has(p.type)) ?? st.pieces[0];
            const baseZ = first ? first.z + table.require(first.type).beginZ : 0;
            const stats = layoutStats(table, st.pieces, false);
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
                    rating: rating && "computed" in rating ? reportView(rating) : rating,
                    summary: `${st.name} (${st.ride.name}) : ${stats.pieces} pièces, ${stats.lengthTiles} tuiles de piste sur ${stats.footprint.size}, ${stats.inversions} inversion(s)${st.closed ? "" : ", circuit ouvert"}.`,
                    rideType: st.ride.name,
                    object: detail.object,
                    ratings: { excitement: detail.excitement, intensity: detail.intensity, nausea: detail.nausea },
                    closed: st.closed,
                    layout: { ...stats, minLevel: stats.minLevel - baseZ / 16, maxLevel: stats.maxLevel - baseZ / 16 },
                    sequence: describeSequence(table, st.pieces, baseZ, simulate(speedModels(ctx).get(st.rideType), table, st.pieces, speedModels(ctx).get(st.rideType).stationSpeed).map((x) => kmh(x.vIn))),
                    inversionsAvailable: availableInversions(table, st.ride),
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
                "profil de vitesse le long du parcours (km/h tous les 10 % de la longueur), G par cinquième du parcours, suite des éléments. " +
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
                measuredAt: m.measuredAt,
            });
            const dE = Math.round((b.ratings.excitement - a.ratings.excitement) * 100) / 100;
            return result({
                budget: BUDGET.readLarge,
                response: {
                    summary:
                        `${a.name} : ${a.ratings.excitement} / ${a.ratings.intensity} / ${a.ratings.nausea} ; ${b.name} (référence) : ${b.ratings.excitement} / ${b.ratings.intensity} / ${b.ratings.nausea}` +
                        ` ; écart d'excitation ${dE >= 0 ? "−" : "+"}${Math.abs(dE).toFixed(2)}.`,
                    levers,
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
