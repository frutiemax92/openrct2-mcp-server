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

/** Fait avancer v (mph) sur une pièce ; brakeSpeed en mph pour les freins. */
export function stepPiece(model: SpeedModel, seg: TrackSegmentInfo, name: string, vIn: number, opts: { chain?: boolean; brakeMph?: number } = {}): PieceSpeed {
    if (STATION_TYPES.has(seg.type)) {
        const v = Math.max(model.stationSpeed, Math.min(vIn, model.stationSpeed));
        return { vIn, vOut: v, vMin: Math.min(vIn, v), stall: false };
    }
    const len = segLengthTiles(seg);
    const extra = model.invExtra ?? 0;
    const intoInversion = seg.endBank === 15 && seg.beginBank !== 15;
    const outOfInversion = seg.beginBank === 15 && seg.endBank !== 15;
    // Sommet d'inversion : on monte de `extra` de plus en y entrant, on le redescend en en sortant.
    const dLevels = (seg.beginZ - seg.endZ) / 16 + (outOfInversion ? extra : 0) - (intoInversion ? extra : 0); // positif = descente
    const climbToPeak = (segPeakZ(seg) - seg.beginZ) / 16 + (intoInversion ? extra : 0);
    const n = Math.max(2, Math.ceil(len * 2));
    let v2 = vIn * vIn;
    let vMin = vIn;
    let stall = false;
    // Montée vers le point haut puis descente vers la fin, répartie sur la longueur (inversions, collines).
    const peakFrac = climbToPeak > 0 && climbToPeak > -dLevels ? 0.5 : 0;
    for (let i = 0; i < n; i++) {
        const t0 = i / n;
        const t1 = (i + 1) / n;
        const h = (t: number) => (peakFrac ? (t <= peakFrac ? (climbToPeak * t) / peakFrac : climbToPeak + ((-dLevels - climbToPeak) * (t - peakFrac)) / (1 - peakFrac)) : -dLevels * t);
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

/** Vitesses le long d'une suite de pièces, à partir d'une vitesse d'entrée. */
export function simulate(
    model: SpeedModel,
    table: SegmentTable,
    pieces: (TrackPieceInfo & { chain?: boolean; brakeSpeed?: number })[],
    vStart: number,
): PieceSpeed[] {
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
export function modelError(model: SpeedModel, table: SegmentTable, measured: MeasuredPiece[]): number {
    const sim = simulate(model, table, measured.map((m) => m.piece), model.stationSpeed);
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
 * Le calage n'est gardé que s'il fait mieux que le modèle précédent sur ces mesures.
 */
export function fitModel(table: SegmentTable, measured: MeasuredPiece[], prior: SpeedModel): SpeedModel {
    const used = measured.filter((m) => m.sample && m.sample.n > 0).length;
    if (used < 12) return prior;
    const lift = measured.filter((m) => m.piece.chain && m.sample && m.sample.n > 0).map((m) => m.sample!.vFirst);
    const liftSpeed = lift.length ? median(lift) : prior.liftSpeed;
    let best = { ...prior, liftSpeed };
    let bestErr = modelError(best, table, measured);
    for (let K = 120; K <= 320; K += 10)
        for (const k1 of [0, 0.05, 0.1, 0.15, 0.2, 0.3, 0.5])
            for (const k2 of [0, 0.0005, 0.001, 0.0015, 0.002, 0.003, 0.005])
                for (const invExtra of [0, 1, 2, 3, 4]) {
                    const m = { ...best, K, k1, k2, invExtra };
                    const e = modelError(m, table, measured);
                    if (e < bestErr) {
                        best = m;
                        bestErr = e;
                    }
                }
    if (bestErr >= modelError(prior, table, measured)) return prior;
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
export function speedWindows(model: SpeedModel, table: SegmentTable, circuits: (TrackPieceInfo & { chain?: boolean; brakeSpeed?: number })[][]): Map<string, SpeedWindow> {
    const byKind = new Map<string, { vIn: number[]; vMin: number[] }>();
    for (const pieces of circuits) {
        const sim = simulate(model, table, pieces, model.stationSpeed);
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
