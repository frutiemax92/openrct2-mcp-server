// Vitesse du train le long d'un circuit : modèle d'énergie calibré sur des mesures du jeu.
//
// Le jeu (Vehicle.TrackMotion.cpp) ajoute à chaque tick l'accélération due à la pente (kAccelerationFromPitch) et retire
// une traînée linéaire (v / 4096) et quadratique ((v >> 8)² / 16 / masse). Ramené à la distance parcourue, cela donne :
//   d(v²) = K · (dénivelé en niveaux) − (k1 · v + k2 · v²) · (longueur en tuiles de piste)
// avec v en mph. K, k1 et k2 sont ajustés par moindres carrés sur les relevés de coaster_test (time.run { sample }),
// par type d'attraction, et gardés dans <dossier utilisateur>/claude-speed-model.json.
//
// Pièces spéciales : la chaîne entraîne le train à la vitesse du lift (au moins), les freins plafonnent à leur vitesse,
// la station repart à la vitesse de départ.
//
// Longueur du train (simulateTrain). Le jeu calcule l'accélération de pente de chaque voiture sur sa propre pièce, puis
// en prend la moyenne sur le train (Vehicle::UpdateTrackMotion) : intégré sur la distance, c'est la variation de la
// hauteur moyenne des voitures, et non de la hauteur de la tête. Un train long « s'étale » sur une crête ou un sommet
// d'inversion ; un train court suit le profil de près. La traînée quadratique est divisée par la masse totale
// (GetAccelerationDecrease2) : à voitures égales, un train plus court (plus léger) perd sa vitesse plus vite. k2 est
// donc rapporté à la masse du train de calage (massRef) : k2 effectif = k2 · massRef / masse.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { PieceSample, TrackPieceInfo, TrackSegmentInfo } from "@openrct2-claude/protocol";
import { SegmentTable, STATION_TYPES } from "./track.js";

export interface SpeedModel {
    /** Gain de v² (mph²) par niveau de descente. */
    K: number;
    /** Pertes de v² par tuile de piste : k1 · v + k2 · v². */
    k1: number;
    k2: number;
    /** Vitesse de la chaîne (mph) et de sortie de station. */
    liftSpeed: number;
    stationSpeed: number;
    /**
     * Hauteur supplémentaire (niveaux) au sommet d'une inversion, au-delà de la géométrie de la piste : le train y
     * perd plus de vitesse que ne le dit le dénivelé (mesuré : 28 km/h au sommet d'un grand tire-bouchon pris à 63).
     */
    invExtra?: number;
    /** Nombre de transitions mesurées ayant servi au calage (0 = valeurs par défaut). */
    samples: number;
    /** Masse totale du train de calage (unités du jeu, Car.mass) ; absente = k2 non rapporté à une masse. */
    massRef?: number;
}

/** Forme d'un train : nombre de voitures, longueur d'une voiture (tuiles de piste) et masse totale (Car.mass). */
export interface TrainShape {
    cars: number;
    carLength: number;
    mass: number;
}

/** Espacement des voitures (RideObjectVehicle.spacing) par tuile de piste : longueur d'une tuile de station (Ride.cpp). */
export const SPACING_PER_TILE = 0x44180;

/** Forme du train à partir de ses voitures (masse et espacement de chacune). */
export function trainShape(cars: { mass: number; spacing: number }[]): TrainShape | undefined {
    if (!cars.length) return undefined;
    const length = cars.reduce((a, c) => a + c.spacing, 0) / SPACING_PER_TILE;
    return { cars: cars.length, carLength: length / cars.length, mass: cars.reduce((a, c) => a + c.mass, 0) };
}

/** Longueur du train en tuiles de piste. */
export const trainLength = (t: TrainShape): number => t.cars * t.carLength;

/** k2 effectif pour ce train : la traînée quadratique est divisée par la masse totale. */
export function dragK2(model: SpeedModel, train?: TrainShape): number {
    return model.massRef && train?.mass ? (model.k2 * model.massRef) / train.mass : model.k2;
}

/**
 * Valeurs par défaut, en attendant un calage : chute de 24 niveaux depuis le lift → ~63 mph (101 km/h, mesuré sur
 * Frightmare et Nightmare Frenzy), et une grande demi-boucle de 23 niveaux franchie juste après (pertes faibles).
 */
export const DEFAULT_MODEL: SpeedModel = { K: 172, k1: 0.15, k2: 0.0015, liftSpeed: 8, stationSpeed: 5, samples: 0, invExtra: 0 };

/** Pièces de freinage et leur effet. */
const BRAKE_NAMES = new Set(["brakes", "blockBrakes", "diagBrakes", "diagBlockBrakes", "down25Brakes"]);

export interface PieceSpeed {
    /** Vitesse à l'entrée et à la sortie (mph). */
    vIn: number;
    vOut: number;
    /** Vitesse minimale estimée sur la pièce (sommet d'une inversion, haut d'une montée). */
    vMin: number;
    /** La pièce ne peut pas être franchie (le train recule) : calage. */
    stall: boolean;
}

export const mphToKmh = (v: number): number => Math.round(v * 1.609);

function segLengthTiles(seg: TrackSegmentInfo): number {
    return Math.max(seg.length, 1) / 32;
}

/** Hauteur maximale atteinte sur la pièce (unités monde), relative à son origine. */
function segPeakZ(seg: TrackSegmentInfo): number {
    let z = Math.max(seg.beginZ, seg.endZ);
    for (const e of seg.elements) z = Math.max(z, e.z);
    return z;
}

/**
 * Profil de hauteur d'une pièce (niveaux au-dessus de son début) en fonction de la fraction parcourue t ∈ [0, 1] :
 * montée vers le point haut puis descente vers la fin (inversions, collines), sinon droite du début à la fin. Au sommet
 * d'une inversion, on monte de invExtra de plus en y entrant et on le redescend en en sortant.
 */
function heightShape(model: SpeedModel, seg: TrackSegmentInfo): (t: number) => number {
    const extra = model.invExtra ?? 0;
    const intoInversion = seg.endBank === 15 && seg.beginBank !== 15;
    const outOfInversion = seg.beginBank === 15 && seg.endBank !== 15;
    const dLevels = (seg.beginZ - seg.endZ) / 16 + (outOfInversion ? extra : 0) - (intoInversion ? extra : 0); // positif = descente
    const climbToPeak = (segPeakZ(seg) - seg.beginZ) / 16 + (intoInversion ? extra : 0);
    const peakFrac = climbToPeak > 0 && climbToPeak > -dLevels ? 0.5 : 0;
    return (t) => (peakFrac ? (t <= peakFrac ? (climbToPeak * t) / peakFrac : climbToPeak + ((-dLevels - climbToPeak) * (t - peakFrac)) / (1 - peakFrac)) : -dLevels * t);
}

/** Nombre de pas de simulation sur une pièce. */
const stepsFor = (len: number): number => Math.max(2, Math.ceil(len * 2));

/** Fait avancer v (mph) sur une pièce, train ponctuel ; brakeSpeed en mph pour les freins. */
export function stepPiece(model: SpeedModel, seg: TrackSegmentInfo, name: string, vIn: number, opts: { chain?: boolean; brakeMph?: number } = {}): PieceSpeed {
    if (STATION_TYPES.has(seg.type)) {
        const v = Math.max(model.stationSpeed, Math.min(vIn, model.stationSpeed));
        return { vIn, vOut: v, vMin: Math.min(vIn, v), stall: false };
    }
    const len = segLengthTiles(seg);
    const h = heightShape(model, seg);
    const n = stepsFor(len);
    let v2 = vIn * vIn;
    let vMin = vIn;
    let stall = false;
    for (let i = 0; i < n; i++) {
        const t0 = i / n;
        const t1 = (i + 1) / n;
        const rise = h(t1) - h(t0);
        const v = Math.sqrt(Math.max(v2, 0));
        v2 += -model.K * rise - (model.k1 * v + model.k2 * v * v) * (len / n);
        if (opts.chain && rise > 0) v2 = Math.max(v2, model.liftSpeed * model.liftSpeed);
        if (v2 <= 0.25) {
            stall = true;
            v2 = 0.25;
        }
        vMin = Math.min(vMin, Math.sqrt(v2));
    }
    let vOut = Math.sqrt(v2);
    if (BRAKE_NAMES.has(name) && opts.brakeMph !== undefined) vOut = Math.min(vOut, opts.brakeMph);
    return { vIn, vOut, vMin: Math.min(vMin, vOut), stall };
}

/**
 * Unités de vitesse du jeu : velocity interne ; mph affichés = velocity × 9 >> 18 = velocity / 29127
 * (UnitConversion.cpp). Les consignes de frein et les relevés du plugin sont en velocity >> 16 : 1 unité = 2,25 mph.
 */
export const TRACK_SPEED_TO_MPH = 65536 / 29127;

/**
 * brakeSpeed de trackplace en mph affichés : le jeu le range divisé par 2 et le relit multiplié par 2
 * (TrackElement.cpp), puis le compare à velocity >> 16 (Vehicle.TrackMotion.cpp, kTrackSpeedShiftAmount).
 */
export const brakeSpeedToMph = (brakeSpeed: number): number => (brakeSpeed & ~1) * TRACK_SPEED_TO_MPH;

type SimPiece = TrackPieceInfo & { chain?: boolean; brakeSpeed?: number };

/**
 * Vitesses le long d'une suite de pièces, à partir d'une vitesse d'entrée. Avec `train`, simule le train entier
 * (simulateTrain) ; sinon un train ponctuel de la masse de calage.
 */
export function simulate(model: SpeedModel, table: SegmentTable, pieces: SimPiece[], vStart: number, train?: TrainShape): PieceSpeed[] {
    if (train && train.cars > 0) return simulateTrain(model, table, pieces, vStart, train);
    const out: PieceSpeed[] = [];
    let v = vStart;
    for (const p of pieces) {
        const seg = table.get(p.type);
        if (!seg) {
            out.push({ vIn: v, vOut: v, vMin: v, stall: false });
            continue;
        }
        const r = stepPiece(model, seg, SegmentTable.nameOf(p.type), v, { chain: p.chain, brakeMph: p.brakeSpeed !== undefined ? brakeSpeedToMph(p.brakeSpeed) : undefined });
        out.push(r);
        v = r.vOut;
    }
    return out;
}

/**
 * Simulation du train entier, comme Vehicle::UpdateTrackMotion : la pente agit sur la hauteur moyenne des voitures
 * (voiture k à k · carLength derrière la tête ; avant la première pièce, la hauteur de son début), la traînée
 * quadratique est divisée par la masse (dragK2), la chaîne tire tant qu'une voiture est sur une pièce à chaîne.
 * Les vitesses rendues sont celles de la tête à l'entrée de chaque pièce, comme les relevés de coaster_test.
 * Un train d'une voiture de longueur nulle redonne exactement stepPiece.
 */
export function simulateTrain(model: SpeedModel, table: SegmentTable, pieces: SimPiece[], vStart: number, train: TrainShape): PieceSpeed[] {
    const segs = pieces.map((p) => table.get(p.type));
    const starts: number[] = [];
    const lens: number[] = [];
    let total = 0;
    for (const seg of segs) {
        starts.push(total);
        const len = seg ? segLengthTiles(seg) : 0;
        lens.push(len);
        total += len;
    }
    const shapes = segs.map((seg) => (seg ? heightShape(model, seg) : () => 0));
    // Hauteur du début de chaque pièce, enchaînée sur la fin du profil de la précédente (continue même avec invExtra,
    // qui monte en entrant dans l'inversion et redescend en en sortant).
    const base: number[] = [];
    pieces.forEach((p, i) => base.push(i === 0 ? (p.z + (segs[0]?.beginZ ?? 0)) / 16 : base[i - 1] + shapes[i - 1](1)));
    // Pièce sous l'abscisse s (recherche dichotomique).
    const pieceAt = (s: number): number => {
        let lo = 0;
        let hi = pieces.length - 1;
        while (lo < hi) {
            const mid = (lo + hi + 1) >> 1;
            if (starts[mid] <= s) lo = mid;
            else hi = mid - 1;
        }
        return lo;
    };
    const height = (s: number): number => {
        if (!pieces.length) return 0;
        if (s <= 0) return base[0];
        const i = pieceAt(Math.min(s, total));
        return base[i] + shapes[i](lens[i] ? Math.min(1, (Math.min(s, total) - starts[i]) / lens[i]) : 1);
    };
    const offsets = Array.from({ length: Math.max(1, train.cars) }, (_, k) => k * train.carLength);
    const meanHeight = (s: number): number => offsets.reduce((a, d) => a + height(s - d), 0) / offsets.length;
    const onChain = (s: number): boolean => offsets.some((d) => s - d >= 0 && !!pieces[pieceAt(s - d)]?.chain);
    const k2 = dragK2(model, train);
    const out: PieceSpeed[] = [];
    let v = vStart;
    pieces.forEach((p, i) => {
        const seg = segs[i];
        if (!seg) {
            out.push({ vIn: v, vOut: v, vMin: v, stall: false });
            return;
        }
        if (STATION_TYPES.has(seg.type)) {
            const r = stepPiece(model, seg, SegmentTable.nameOf(p.type), v);
            out.push(r);
            v = r.vOut;
            return;
        }
        const n = stepsFor(lens[i]);
        const ds = lens[i] / n;
        let v2 = v * v;
        let vMin = v;
        let stall = false;
        let s = starts[i];
        let hPrev = meanHeight(s);
        for (let j = 0; j < n; j++) {
            const hNext = meanHeight(s + ds);
            const rise = hNext - hPrev;
            const vv = Math.sqrt(Math.max(v2, 0));
            v2 += -model.K * rise - (model.k1 * vv + k2 * vv * vv) * ds;
            if (rise > 0 && onChain(s + ds / 2)) v2 = Math.max(v2, model.liftSpeed * model.liftSpeed);
            if (v2 <= 0.25) {
                stall = true;
                v2 = 0.25;
            }
            vMin = Math.min(vMin, Math.sqrt(v2));
            s += ds;
            hPrev = hNext;
        }
        let vOut = Math.sqrt(v2);
        const name = SegmentTable.nameOf(p.type);
        if (BRAKE_NAMES.has(name) && p.brakeSpeed !== undefined) vOut = Math.min(vOut, brakeSpeedToMph(p.brakeSpeed));
        out.push({ vIn: v, vOut, vMin: Math.min(vMin, vOut), stall });
        v = vOut;
    });
    return out;
}

/** Vitesse au bout d'une suite de pièces partant de la station (les pièces doivent porter chain et brakeSpeed). */
export function circuitEndSpeed(model: SpeedModel, table: SegmentTable, pieces: (TrackPieceInfo & { chain?: boolean; brakeSpeed?: number })[]): number {
    const sim = simulate(model, table, pieces, model.stationSpeed);
    return sim.length ? sim[sim.length - 1].vOut : model.stationSpeed;
}

// ---------------------------------------------------------------------------
// Calage sur des mesures
// ---------------------------------------------------------------------------

export interface MeasuredPiece {
    piece: TrackPieceInfo;
    sample: PieceSample | undefined;
}

/** Associe les relevés aux pièces du circuit (clé : origine monde, direction, type). */
export function matchSamples(pieces: TrackPieceInfo[], samples: PieceSample[]): MeasuredPiece[] {
    // La voiture situe la pièce par l'origine x, y, la direction et le type ; son z peut être la base du premier bloc
    // plutôt que l'origine de trackplace : on prend le relevé de z le plus proche (moins de 4 niveaux d'écart).
    const byKey = new Map<string, PieceSample[]>();
    for (const s of samples) {
        const k = `${s.trackType}@${Math.floor(s.x / 32)},${Math.floor(s.y / 32)},${s.direction & 3}`;
        const list = byKey.get(k) ?? [];
        list.push(s);
        byKey.set(k, list);
    }
    return pieces.map((piece) => {
        const list = byKey.get(`${piece.type}@${piece.x},${piece.y},${piece.direction}`) ?? [];
        let best: PieceSample | undefined;
        for (const s of list) if (Math.abs(s.z - piece.z) <= 64 && (!best || Math.abs(s.z - piece.z) < Math.abs(best.z - piece.z))) best = s;
        return { piece, sample: best };
    });
}

/** Écart moyen (km/h) entre vitesses d'entrée simulées et mesurées, hors stations et freins. */
export function modelError(model: SpeedModel, table: SegmentTable, measured: MeasuredPiece[], train?: TrainShape): number {
    const sim = simulate(model, table, measured.map((m) => m.piece), model.stationSpeed, train);
    let e = 0;
    let n = 0;
    measured.forEach((m, i) => {
        const name = SegmentTable.nameOf(m.piece.type);
        if (!m.sample || m.sample.n < 1 || STATION_TYPES.has(m.piece.type) || BRAKE_NAMES.has(name)) return;
        e += Math.abs(mphToKmh(sim[i].vIn) - mphToKmh(m.sample.vFirst));
        n++;
    });
    return n ? e / n : Infinity;
}

/**
 * Cale K, k1, k2 et la vitesse du lift en simulant tout le circuit depuis la station et en minimisant l'écart moyen
 * aux vitesses mesurées (recherche sur grille). Un ajustement pièce à pièce est trop bruité : à vitesse 4, une frame
 * couvre 4 ticks et la « vitesse d'entrée » relevée tombe n'importe où dans la pièce.
 * Le calage n'est gardé que s'il fait mieux que le modèle précédent sur ces mesures. Avec le train de l'essai, la
 * simulation suit le train entier et le k2 calé est rapporté à sa masse (massRef).
 */
export function fitModel(table: SegmentTable, measured: MeasuredPiece[], prior: SpeedModel, train?: TrainShape): SpeedModel {
    const used = measured.filter((m) => m.sample && m.sample.n > 0).length;
    if (used < 12) return prior;
    const lift = measured.filter((m) => m.piece.chain && m.sample && m.sample.n > 0).map((m) => m.sample!.vFirst);
    const liftSpeed = lift.length ? median(lift) : prior.liftSpeed;
    // Le k2 du modèle précédent, ramené au train de l'essai : le calage repart de là et se rapporte à sa masse.
    const k2Here = dragK2(prior, train);
    const massRef = train?.mass ?? prior.massRef;
    let best: SpeedModel = { ...prior, liftSpeed, k2: k2Here, massRef };
    let bestErr = modelError(best, table, measured, train);
    for (let K = 120; K <= 320; K += 10)
        for (const k1 of [0, 0.05, 0.1, 0.15, 0.2, 0.3, 0.5])
            for (const k2 of [0, 0.0005, 0.001, 0.0015, 0.002, 0.003, 0.005])
                for (const invExtra of [0, 1, 2, 3, 4]) {
                    const m = { ...best, K, k1, k2, invExtra };
                    const e = modelError(m, table, measured, train);
                    if (e < bestErr) {
                        best = m;
                        bestErr = e;
                    }
                }
    if (bestErr >= modelError(prior, table, measured, train)) return prior;
    return { ...best, samples: prior.samples + used };
}

function median(xs: number[]): number {
    const s = [...xs].sort((a, b) => a - b);
    return s[Math.floor(s.length / 2)] ?? 0;
}

// ---------------------------------------------------------------------------
// Stockage du calage, par type d'attraction
// ---------------------------------------------------------------------------

export class SpeedModels {
    private readonly models = new Map<number, SpeedModel>();

    constructor(private readonly file: string | null) {
        if (file && existsSync(file)) {
            try {
                const data = JSON.parse(readFileSync(file, "utf8")) as Record<string, SpeedModel>;
                for (const [k, m] of Object.entries(data)) this.models.set(Number(k), m);
            } catch {
                // Fichier illisible : on repart des valeurs par défaut.
            }
        }
    }

    static inUserDir(userDir: string): SpeedModels {
        return new SpeedModels(join(userDir, "claude-speed-model.json"));
    }

    get(rideType: number): SpeedModel {
        return this.models.get(rideType) ?? this.models.get(-1) ?? DEFAULT_MODEL;
    }

    set(rideType: number, m: SpeedModel): void {
        this.models.set(rideType, m);
        // -1 : modèle générique (dernier calage), pour les types encore jamais mesurés.
        this.models.set(-1, m);
        if (this.file) writeFileSync(this.file, JSON.stringify(Object.fromEntries(this.models), null, 2));
    }
}

// ---------------------------------------------------------------------------
// Fenêtres de vitesse par genre d'élément, relevées sur des designs de référence
// ---------------------------------------------------------------------------

/** Genre d'élément d'une pièce : nom sans le côté (left/right), ou null pour les pièces banales (droites, transitions). */
export function elementKind(name: string): string | null {
    const k = name.replace(/^(left|right)/, "").replace(/(Left|Right)(?=[A-Z]|$)/g, "");
    if (/VerticalLoop|HalfLoopUp|CorkscrewUp|ZeroGRollUp|BarrelRollUpToDown|TwistDownToUp|DiveLoopUp|QuarterLoop|Helix|QuarterTurn|EighthBank|EighthTo|sBend/i.test(name)) return k.charAt(0).toLowerCase() + k.slice(1);
    return null;
}

/**
 * Éléments d'OpenRCT2 absents des designs RCT2 : fenêtre empruntée à l'élément classique le plus proche
 * (même hauteur gagnée et même genre de rotation).
 */
const WINDOW_ALIASES: Record<string, string> = {
    zeroGRollUp: "barrelRollUpToDown",
    largeZeroGRollUp: "verticalLoop",
    largeCorkscrewUp: "corkscrewUp",
    mediumHalfLoopUp: "halfLoopUp",
    eighthDiveLoopUpToOrthogonal: "verticalLoop",
};

export function windowFor(windows: Map<string, SpeedWindow>, kind: string): SpeedWindow | undefined {
    return windows.get(kind) ?? (WINDOW_ALIASES[kind] ? windows.get(WINDOW_ALIASES[kind]) : undefined);
}

export interface SpeedWindow {
    kind: string;
    /** Vitesses d'entrée (mph) relevées : 10e, 50e et 90e centiles, et nombre d'occurrences. */
    p10: number;
    p50: number;
    p90: number;
    n: number;
    /**
     * Vitesse la plus basse atteinte DANS l'élément (sommet d'une inversion : la pièce et celle qui la suit tant que
     * le train est à l'envers), 10e centile et médiane. Sous ce seuil, le train se traîne au sommet ou cale.
     */
    min10: number;
    min50: number;
}

/** Vitesse minimale d'un élément qui commence à la pièce i : la pièce, puis les suivantes tant qu'on est à l'envers. */
export function elementMinSpeed(table: SegmentTable, pieces: TrackPieceInfo[], sim: PieceSpeed[], i: number): number {
    let v = sim[i].vMin;
    for (let j = i; j < pieces.length && j < i + 4; j++) {
        const seg = table.get(pieces[j].type);
        v = Math.min(v, sim[j].vMin, sim[j].vOut);
        if (!seg || seg.endBank !== 15) break;
        if (j + 1 < pieces.length) v = Math.min(v, sim[j + 1].vIn, sim[j + 1].vMin);
    }
    return v;
}

/** Fenêtres d'entrée par genre d'élément, calculées avec le modèle sur des circuits de référence (designs RCT2). */
export function speedWindows(
    model: SpeedModel,
    table: SegmentTable,
    circuits: (TrackPieceInfo & { chain?: boolean; brakeSpeed?: number })[][],
    trains?: (TrainShape | undefined)[],
): Map<string, SpeedWindow> {
    const byKind = new Map<string, { vIn: number[]; vMin: number[] }>();
    for (const [c, pieces] of circuits.entries()) {
        const sim = simulate(model, table, pieces, model.stationSpeed, trains?.[c]);
        pieces.forEach((p, i) => {
            const kind = elementKind(SegmentTable.nameOf(p.type));
            if (!kind || p.chain || sim[i].stall) return;
            const list = byKind.get(kind) ?? { vIn: [], vMin: [] };
            list.vIn.push(sim[i].vIn);
            list.vMin.push(elementMinSpeed(table, pieces, sim, i));
            byKind.set(kind, list);
        });
    }
    const out = new Map<string, SpeedWindow>();
    for (const [kind, xs] of byKind) {
        if (xs.vIn.length < 3) continue;
        const pct = (arr: number[], q: number) => {
            const s = [...arr].sort((a, b) => a - b);
            return s[Math.min(s.length - 1, Math.floor(q * s.length))];
        };
        out.set(kind, { kind, p10: pct(xs.vIn, 0.1), p50: pct(xs.vIn, 0.5), p90: pct(xs.vIn, 0.9), n: xs.vIn.length, min10: pct(xs.vMin, 0.1), min50: pct(xs.vMin, 0.5) });
    }
    return out;
}

// ---------------------------------------------------------------------------
// Sections de freinage et longueur du train
// ---------------------------------------------------------------------------

export interface BrakeRun {
    /** Indice du frein de bloc (ou de la dernière pièce de frein avant la station). */
    index: number;
    /** Longueur droite de freins qui y mène, frein de bloc compris (tuiles). */
    tiles: number;
    beforeStation: boolean;
}

/**
 * Sections de freins d'un circuit fermé (pièces dans l'ordre de marche, station en tête ou n'importe où) : la suite de
 * freins qui précède chaque frein de bloc et celle qui précède la station. Le train doit y tenir en entier pour s'y
 * arrêter sans que sa queue reste dans la section d'avant (préférence : « frein de bloc assez long pour le train »).
 */
export function brakeRuns(table: SegmentTable, pieces: TrackPieceInfo[]): BrakeRun[] {
    const n = pieces.length;
    const isBrake = (i: number) => BRAKE_NAMES.has(SegmentTable.nameOf(pieces[((i % n) + n) % n].type));
    const runEndingAt = (i: number): number => {
        let tiles = 0;
        for (let k = 0; k < n && isBrake(i - k); k++) tiles += segLengthTiles(table.require(pieces[(((i - k) % n) + n) % n].type));
        return tiles;
    };
    const out: BrakeRun[] = [];
    pieces.forEach((p, i) => {
        const name = SegmentTable.nameOf(p.type);
        const next = pieces[(i + 1) % n];
        const beforeStation = !!next && STATION_TYPES.has(next.type) && isBrake(i);
        if (name === "blockBrakes" || name === "diagBlockBrakes" || beforeStation) out.push({ index: i, tiles: runEndingAt(i), beforeStation });
    });
    return out;
}
