// Notes estimées avant essai (COASTER_SPACE 7 novodecies) : un circuit planifié (fermé, station comprise) est simulé
// par le simulateur exact (vitesses, durée, longueur, G, temps en l'air comme Vehicle::UpdateMeasurements), ses
// virages, inversions et chutes sont comptés comme le jeu (countTrackFeatures), et la proximité
// (ride_ratings_score_close_proximity) est reprise du cache de carte : sol, eau, chemins, autres attractions et le
// circuit lui-même. Puis la formule du jeu (computeRatings). Ce qui manque au cache (scénerie au bord de la piste,
// abri) est compté à 0 : l'estimation est un peu prudente. Sert à refuser ou classer un tracé sur une excitation
// minimale (coaster_build_plan, coaster_search_section) sans le poser ni l'essayer.

import type { TrackPieceInfo } from "@openrct2-claude/protocol";
import { computeRatings, countTrackFeatures, emptyProximity, ratingLevers, ratingsDataFor, type RatingInputs, type RatingTerm } from "./ratings.js";
import { exactTrain, mphToKmh, rideVehicleObject, type TrainShape } from "./speed.js";
import { firstDrop } from "./target.js";
import { STATION_TYPES, SegmentTable, blockSpan, compileMacros, endPose, pieceElements, rideClearance, type Macro, type RideTrackInfo, type TrackEnv } from "./track.js";
import { simulateExact } from "./vehicle.js";

type Piece = TrackPieceInfo & { chain?: boolean; brakeSpeed?: number };

export interface RatingEstimate {
    excitement: number;
    intensity: number;
    nausea: number;
    lengthM: number;
    maxKmh: number;
    avgKmh: number;
    seconds: number;
    /** Termes de la formule (sur 10), les plus forts en premier. */
    terms: { term: string; E: number; I: number; input?: string }[];
    /** Leviers d'excitation (gain estimé sur 10) : ce qui rapporterait le plus. */
    levers: { lever: string; E: number; I: number }[];
}

export interface EstimateOptions {
    table: SegmentTable;
    rideType: number;
    /** Circuit fermé, en commençant par la station. */
    pieces: Piece[];
    train?: TrainShape;
    /** Nom de l'objet de véhicule (multiplicateurs de note, ride_vehicles.json). */
    vehicleObject?: string;
    liftHillSpeed?: number;
    env?: TrackEnv;
    /** Voitures par train (défaut : train.cars). */
    carsPerTrain?: number;
}

/** mph affichés d'une vitesse brute >> 16 (ToHumanReadableSpeed : v × 9 >> 18). */
const kmhOf16 = (v16: number): number => Math.round(((v16 * 65536 * 9) / 262144) * 1.609);
const r2 = (v: number) => Math.round(v) / 100;

const SIDE = [
    { x: -1, y: 0 },
    { x: 0, y: 1 },
    { x: 1, y: 0 },
    { x: 0, y: -1 },
];

/**
 * Proximité depuis le cache de carte et le circuit lui-même (pour l'élément de séquence 0 de chaque pièce, comme
 * le jeu). Hauteurs en unités de 8 (baseHeight), comme RideRatings.cpp.
 */
export function proximityFromPlan(table: SegmentTable, pieces: Piece[], env: TrackEnv | undefined, clearance: number): RatingInputs["proximity"] {
    const s = emptyProximity();
    // Blocs du circuit par tuile : [base, dégagement] en unités de 8, station ou non.
    const own = new Map<string, { b: number; c: number; station: boolean; i: number }[]>();
    const firstBlock: ({ x: number; y: number; b: number; c: number; dir: number } | null)[] = [];
    pieces.forEach((p, i) => {
        const seg = table.get(p.type);
        if (!seg) return firstBlock.push(null);
        const els = pieceElements(p, seg);
        els.forEach((e, k) => {
            const [b, c] = blockSpan(e, clearance);
            const key = `${e.x},${e.y}`;
            const list = own.get(key) ?? [];
            list.push({ b: b / 8, c: c / 8, station: STATION_TYPES.has(p.type), i });
            own.set(key, list);
            if (k === 0) firstBlock.push({ x: e.x, y: e.y, b: b / 8, c: c / 8, dir: p.direction & 3 });
        });
    });
    pieces.forEach((_, i) => {
        const fb = firstBlock[i];
        if (!fb) return;
        const t = env?.get(fb.x, fb.y);
        let surfaceH = 0;
        if (t) {
            surfaceH = t.h * 2;
            if (surfaceH === fb.b) s.surfaceTouch++;
            const w = (t.w ?? 0) * 2;
            if (w !== 0 && w <= fb.b) {
                s.waterOver++;
                if (w === fb.b) s.waterTouch++;
                if (w + 2 === fb.b) s.waterLow++;
                if (w + 16 <= fb.b) s.waterHigh++;
            }
            for (const p of t.p ?? []) {
                const pb = p.l * 2;
                const pc = pb + 4;
                if (!p.q) {
                    if (pc === fb.b) s.pathTouchAbove++;
                    if (pb === fb.c) s.pathTouchUnder++;
                } else {
                    if (pc <= fb.b) s.queuePathOver++;
                    if (pc === fb.b) s.queuePathTouchAbove++;
                    if (pb === fb.c) s.queuePathTouchUnder++;
                }
            }
            for (const [b0, b1, r] of t.ri ?? []) {
                if (r === undefined || r === env!.rideId) continue;
                const tb = b0 * 2;
                const tc = b1 * 2;
                s.foreignTrackAboveOrBelow++;
                if (tc === fb.b) s.foreignTrackTouchAbove++;
                if (tc + 2 <= fb.b && tc + 10 >= fb.b) s.foreignTrackCloseAbove++;
                if (fb.c === tb) s.foreignTrackTouchAbove++;
                if (fb.c + 2 === tb) s.foreignTrackCloseAbove++;
            }
        }
        for (const o of own.get(`${fb.x},${fb.y}`) ?? []) {
            if (o.i === i) continue;
            if (o.c === fb.b) {
                s.ownTrackTouchAbove++;
                if (o.station) s.ownStationTouchAbove++;
            }
            if (o.c + 2 <= fb.b && o.c + 10 >= fb.b) {
                s.ownTrackCloseAbove++;
                if (o.station) s.ownStationCloseAbove++;
            }
            if (fb.c === o.b) {
                s.ownTrackTouchAbove++;
                if (o.station) s.ownStationTouchAbove++;
            }
            if (fb.c + 2 <= o.b && fb.c + 10 >= o.b) {
                s.ownTrackCloseAbove++;
                if (o.station) s.ownStationCloseAbove++;
            }
        }
        // Tuiles voisines à gauche et à droite.
        for (const d of [(fb.dir + 1) & 3, (fb.dir + 3) & 3]) {
            const nx = fb.x + SIDE[d].x;
            const ny = fb.y + SIDE[d].y;
            const n = env?.get(nx, ny);
            if (!n) continue;
            if (surfaceH <= fb.b && fb.c <= n.h * 2) s.surfaceSideClose++;
            for (const p of n.p ?? []) if (Math.abs(fb.b - p.l * 2) <= 2) s.pathSideClose++;
            for (const [b0, , r] of n.ri ?? []) if (r !== undefined && r !== env!.rideId && Math.abs(fb.b - b0 * 2) <= 2) s.foreignTrackSideClose++;
        }
    });
    return s;
}

/** Éléments de scénerie dans un carré de 11 tuiles autour du début de la station (ride_ratings_get_scenery_score). */
function sceneryAround(env: TrackEnv | undefined, x: number, y: number): number {
    if (!env) return 0;
    let n = 0;
    for (let yy = y - 5; yy <= y + 5; yy++) for (let xx = x - 5; xx <= x + 5; xx++) n += env.get(xx, yy)?.sc ?? 0;
    return n;
}

/** Notes estimées d'un circuit fermé planifié ; null si le type n'a pas de formule ou si le train ne finit pas le tour. */
export function estimateRatings(o: EstimateOptions): RatingEstimate | null {
    const data = ratingsDataFor(o.rideType);
    if (!data) return null;
    const { table, pieces } = o;
    const ex = simulateExact(pieces, {
        rideType: o.rideType,
        train: exactTrain(o.train),
        liftHillSpeed: o.liftHillSpeed,
        closed: true,
        blockZ: (t) => table.get(t)?.elements[0]?.z ?? 0,
    });
    if (!ex || !ex.completed || ex.stalledAt !== null) return null;
    const features = countTrackFeatures(table, pieces);
    const veh = o.vehicleObject ? rideVehicleObject(o.vehicleObject) : undefined;
    const g = ex.gForces ?? { maxLat: 0, maxPosVert: 100, maxNegVert: 100 };
    const station = pieces.find((p) => STATION_TYPES.has(p.type)) ?? pieces[0];
    const inputs: RatingInputs = {
        lengthM: ex.stats.lengthM,
        totalTime: ex.stats.segmentTime,
        maxSpeed16: ex.stats.maxVelocity >> 16,
        avgSpeed16: ex.stats.avgVelocity >> 16,
        carsPerTrain: o.carsPerTrain ?? o.train?.cars ?? 1,
        maxPosG: g.maxPosVert,
        maxNegG: g.maxNegVert,
        maxLatG: g.maxLat,
        features,
        drops: features.drops,
        highestDrop: features.highestDrop,
        shelter: { lengthM: 0, sections: 0, banking: false, rotating: false, trackEighths: 0 },
        proximity: proximityFromPlan(table, pieces, o.env, rideClearance(o.rideType)),
        scenery: { items: sceneryAround(o.env, station.x, station.y), underground: false },
        reversedTrains: false,
        synchronised: false,
        airTime: ex.stats.airTicks,
        entry: {
            excitement: veh?.ratings?.excitement ?? 0,
            intensity: veh?.ratings?.intensity ?? 0,
            nausea: veh?.ratings?.nausea ?? 0,
            limitAirTimeBonus: !!veh?.limitAirTimeBonus,
            coveredRide: !!veh?.covered,
        },
        numStations: 1,
    };
    const res = computeRatings(data, inputs);
    const terms = res.terms
        .filter((t: RatingTerm) => t.key !== "base")
        .sort((a, b) => Math.abs(b.excitement) - Math.abs(a.excitement))
        .map((t) => ({ term: t.key, E: r2(t.excitement), I: r2(t.intensity), input: t.input }));
    const levers = ratingLevers(data, inputs)
        .filter((l) => l.excitement > 0)
        .slice(0, 6)
        .map((l) => ({ lever: l.lever, E: r2(l.excitement), I: r2(l.intensity) }));
    return {
        excitement: r2(res.excitement),
        intensity: r2(res.intensity),
        nausea: r2(res.nausea),
        lengthM: inputs.lengthM,
        maxKmh: kmhOf16(inputs.maxSpeed16),
        avgKmh: kmhOf16(inputs.avgSpeed16),
        seconds: Math.round(ex.seconds),
        terms,
        levers,
    };
}

/** Une ligne pour un summary : « E 7,12 / I 8,40 / N 4,90 estimées (1 020 m, 98 km/h) ». */
export function estimateLine(e: RatingEstimate): string {
    return `notes estimées E ${e.excitement.toFixed(2)} / I ${e.intensity.toFixed(2)} / N ${e.nausea.toFixed(2)} (${e.lengthM} m, ${e.maxKmh} km/h max, ${e.avgKmh} km/h moy.)`;
}

/** Ce qui manque pour une excitation minimale : écart et leviers principaux, pour le summary. */
export function excitementShortfall(e: RatingEstimate, min: number): string | null {
    if (e.excitement >= min) return null;
    const weak = e.terms.filter((t) => t.E < 0).map((t) => `${t.term} ${t.E.toFixed(2)}${t.input ? ` (${t.input})` : ""}`);
    const lev = e.levers.slice(0, 4).map((l) => `${l.lever} +${l.E.toFixed(2)}`);
    return (
        `EXCITATION ESTIMÉE ${e.excitement.toFixed(2)} < ${min} demandé (manque ${(min - e.excitement).toFixed(2)}).` +
        (weak.length ? ` Pénalités : ${weak.join(", ")}.` : "") +
        (lev.length ? ` Leviers : ${lev.join(", ")}.` : "")
    );
}


// ---------------------------------------------------------------------------
// Vitesse qu'exige une excitation (début du circuit)
// ---------------------------------------------------------------------------

/**
 * Vitesse de pointe sous laquelle aucun design RCT2 n'atteint une excitation (montagnes russes, scénerie comprise) :
 * E ≥ 7,5 jamais sous 72 km/h ; de 6,5 à 7, jusqu'à 51 (Evil Vultures). Seuil : min(70, 20 × E − 80) km/h (7,5 : 70 ;
 * 7 : 60 ; 6,5 : 50) ; seule exception, Calamity Mine (mine train, 7,4 à 62 km/h, décor et tunnels).
 * Black Widow Trinity Wood (Haiku, 9 octobre 2026) : lift de 13 niveaux, chute de 10, ~55 km/h ; trois recherches pour
 * 7,5, meilleure fin estimée 6,12. Rien ne le disait avant la fin de la première recherche.
 */
export function speedForExcitement(e: number): number {
    return Math.max(0, Math.round(Math.min(70, 20 * e - 80)));
}

type SpeedSample = { vIn: number; vOut: number; reached?: boolean };
type Simulator = (pieces: Piece[]) => SpeedSample[];

const peakKmh = (sim: SpeedSample[]): number => Math.max(0, ...sim.filter((x) => x.reached !== false).map((x) => mphToKmh(Math.max(x.vIn, x.vOut))));

/**
 * Vitesse de pointe au bas de la première chute, train entier sorti (3 tuiles de plat simulées après la dernière pièce
 * qui descend), et hauteur de la chute ; null tant que la chute n'est pas finie. Une chute qui finit à plat au bout d'un
 * circuit ouvert (plan qui s'arrête au bas de la chute) compte comme finie.
 */
export function firstDropSpeed(table: SegmentTable, ride: RideTrackInfo, pieces: Piece[], simulate: Simulator): { kmh: number; height: number } | null {
    const drop = firstDrop(table, pieces);
    if (!drop || drop.end <= drop.liftEnd + 1) return null;
    const head = pieces.slice(0, drop.end);
    const last = head[head.length - 1];
    const seg = table.require(last.type);
    if (!drop.complete && seg.endSlope !== 0) return null;
    const tail = compileMacros(table, ride, endPose(last, seg), [{ op: "straight", length: 3 }]);
    return { kmh: peakKmh(simulate([...head, ...(tail.errors.length ? [] : tail.pieces)])), height: drop.height };
}

/**
 * Circuit ouvert qui finit au sommet du lift : chaîne posée, aucune pièce qui descend après elle. Rien ne jugeait ce
 * début (« Custom Wooden Loop », Haiku, 9 octobre 2026 : lift seul de 11,5 niveaux pour 7,5, chute jamais posée, trois
 * recherches de 48 s sans fin et sans LIFT TROP BAS).
 */
export function endsAtLiftTop(table: SegmentTable, pieces: Piece[]): boolean {
    if (!pieces.some((p) => p.chain && !STATION_TYPES.has(p.type))) return false;
    const drop = firstDrop(table, pieces);
    return !drop || (!drop.complete && drop.height === 0);
}

/**
 * Vitesse au bas de la meilleure première chute possible depuis le sommet du lift : chute raide en ligne droite dès le
 * bout du circuit jusqu'à `floorZ` (unités monde ; terrain, bounds et obstacles ignorés). null si le circuit ne finit
 * pas au sommet du lift (`endsAtLiftTop`), ou si le bout n'est ni à plat ni droit (on ne sait pas juger).
 */
export function liftTopSpeed(table: SegmentTable, ride: RideTrackInfo, pieces: Piece[], simulate: Simulator, floorZ: number): { kmh: number; height: number } | null {
    if (!endsAtLiftTop(table, pieces)) return null;
    const last = pieces[pieces.length - 1];
    const from = endPose(last, table.require(last.type));
    if (from.slope !== 0 || from.bank !== 0) return null;
    for (let h = Math.floor((from.z - floorZ) / 16); h >= 1; h--) {
        for (const steep of [true, false]) {
            const c = compileMacros(table, ride, from, [{ op: "drop", height: h, steep }] as Macro[]);
            if (c.errors.length) continue;
            const fd = firstDropSpeed(table, ride, [...pieces, ...c.pieces], simulate);
            if (fd) return fd;
        }
    }
    return { kmh: 0, height: 0 };
}

/**
 * Plus petite hauteur H (niveaux) telle que station + 2 droites + lift H + chute raide de H donne `kmhNeeded`
 * (`firstDropSpeed` ; `simulate` : modèle et train du circuit, depuis la station ; terrain ignoré) ; null au-delà de 60.
 */
export function liftForSpeed(table: SegmentTable, ride: RideTrackInfo, stations: Piece[], simulate: Simulator, kmhNeeded: number): number | null {
    const last = stations[stations.length - 1];
    if (!last) return null;
    const from = endPose(last, table.require(last.type));
    for (let h = 4; h <= 60; h++) {
        const c = compileMacros(table, ride, from, [{ op: "straight", length: 2 }, { op: "lift", height: h }, { op: "drop", height: h, steep: true }] as Macro[]);
        if (c.errors.length) continue;
        if ((firstDropSpeed(table, ride, [...stations, ...c.pieces], simulate)?.kmh ?? 0) >= kmhNeeded) return h;
    }
    return null;
}

/** Vitesse d'entrée minimale d'un frein de bloc de mi-parcours : en dessous, le train ouvert peine à repartir (designs RCT2 : 7 km/h au plus bas). */
export const BLOCK_MIN_KMH = 10;

export interface BlockBrakeWindow {
    /** Vitesse au bout du circuit (km/h). */
    fromKmh: number;
    /** Niveau absolu du bout du circuit. */
    level: number;
    /** Plus petite montée (niveaux, climb) qui fait aborder le frein de bloc à `maxKmh` au plus ; null si aucune. */
    minClimb: number | null;
    /** Plus grande montée où le train l'aborde encore à `BLOCK_MIN_KMH` au moins ; null si aucune. */
    maxClimb: number | null;
    /** Vitesse d'entrée du frein de bloc posé après minClimb et maxClimb. */
    minClimbKmh?: number;
    maxClimbKmh?: number;
}

/**
 * Hauteur où poser un frein de bloc de mi-parcours depuis le bout d'un circuit ouvert : le train monte sur son élan
 * (climb { height }) puis aborde block_brakes entre `BLOCK_MIN_KMH` et `maxKmh`. Terrain et obstacles ignorés ; le
 * simulateur est celui du circuit (train réel). « Custom Wooden » (Haiku, 9 octobre 2026) : à 92 km/h au ras du sol, 3
 * freins (92 → 52) puis le frein de bloc au niveau de la station — rien ne lui disait qu'une montée de ~15 niveaux faisait
 * le même travail sans vider le circuit, avec la chute du frein de bloc en prime.
 */
export function blockBrakeWindow(table: SegmentTable, ride: RideTrackInfo, pieces: Piece[], simulate: Simulator, maxKmh: number, maxHeight = 48): BlockBrakeWindow | null {
    const last = pieces[pieces.length - 1];
    if (!last) return null;
    const from = endPose(last, table.require(last.type));
    const base = simulate(pieces);
    const fromKmh = mphToKmh(base[base.length - 1]?.vOut ?? 0);
    const out: BlockBrakeWindow = { fromKmh, level: from.z / 16, minClimb: null, maxClimb: null };
    for (let h = 0; h <= maxHeight; h++) {
        const c = compileMacros(table, ride, from, [h ? { op: "climb", height: h } : { op: "level" }, { op: "block_brakes" }] as Macro[]);
        if (c.errors.length) continue;
        const sim = simulate([...pieces, ...c.pieces]);
        const at = sim[sim.length - 1];
        if (!at || at.reached === false) break;
        const v = mphToKmh(at.vIn);
        if (v < BLOCK_MIN_KMH) break;
        if (v <= maxKmh && out.minClimb === null) {
            out.minClimb = h;
            out.minClimbKmh = v;
        }
        out.maxClimb = h;
        out.maxClimbKmh = v;
    }
    if (out.minClimb === null) out.maxClimb = null;
    return out;
}

/** Une ligne pour summary / avertissements. */
export function blockBrakeWindowLine(w: BlockBrakeWindow, maxKmh: number): string {
    if (w.minClimb === null)
        return w.fromKmh <= maxKmh
            ? `FREIN DE BLOC : à ${w.fromKmh} km/h, le train est déjà assez lent ici (niveau ${w.level}) : brakes { length ≥ longueur du train } puis block_brakes, puis une descente.`
            : `FREIN DE BLOC : à ${w.fromKmh} km/h au niveau ${w.level}, aucune montée droite ne l'amène entre ${BLOCK_MIN_KMH} et ${maxKmh} km/h ; pose d'abord un autre élément (colline, virage en montée) puis redemande.`;
    if (w.minClimb === 0)
        return `FREIN DE BLOC : à ${w.fromKmh} km/h, il peut se poser dès ici (niveau ${w.level}) et jusqu'à ${w.maxClimb} niveaux plus haut (climb { height: ${w.maxClimb} }, abordé à ${w.maxClimbKmh} km/h).`;
    return (
        `FREIN DE BLOC : à ${w.fromKmh} km/h au niveau ${w.level}, monte sur l'élan de ${w.minClimb} à ${w.maxClimb} niveaux (climb { height }, sommet au niveau ${w.level + w.minClimb} à ${w.level + (w.maxClimb ?? w.minClimb)}) ` +
        `avant le frein de bloc : abordé à ${w.minClimbKmh} puis ${w.maxClimbKmh} km/h (entre ${BLOCK_MIN_KMH} et ${maxKmh}). Élément : climb { height }, brakes { length } (le train entier attend à plat), block_brakes, puis drop qui rend la vitesse. ` +
        `Ne le freine pas au sol avec des brakes : ils jettent l'énergie que la montée garde en hauteur.`
    );
}
