// Simulateur exact du mouvement d'un train, portage de Vehicle.TrackMotion.cpp et Vehicle.Station.cpp (OpenRCT2).
//
// Le jeu avance chaque voiture sous-position par sous-position (VehicleSubpositionData.cpp) : à chaque tick,
//   1. vitesse += accélération ; distance = (vitesse >> 10) × 42 (updateVelocity) ;
//   2. chaque voiture ajoute cette distance à son reste et franchit des sous-positions tant que le reste dépasse
//      0x368A ; chaque pas coûte 8716 (x ou y), 6554 (z), 12327 (xy), 10905 (xz, yz) ou 13961 (xyz)
//      (kSubpositionTranslationDistances) ; l'accélération de la voiture est la somme des accélérations de tangage
//      (kAccelerationFromPitch) des sous-positions franchies, divisée par leur nombre (findStationStopPoint) ; freins,
//      boosters et poweredLift la remplacent (trackMotionForwards) ;
//   3. accélération du train = moyenne des voitures × 21 >> 9, moins v / 4096 et ((v >> 8)² >> 4) / masse
//      (updateTrackMotionTrain, GetAccelerationDecrease2) ;
//   4. chaîne : si une voiture est sur une pièce à chaîne et v ≤ liftHillSpeed × 31079, accélération = 15539 ;
//      départ (circuit continu) : accélération = 3298 tant que v ≤ 131940 et qu'une voiture est en station
//      (UpdateDeparting, UpdateTravelling) ; frein de bloc ouvert : v relevée à 0x20364 ou réduite de v >> 4
//      au-dessus de sa consigne (applyNonstopBlockBrake).
//
// Tout est en entiers comme dans le jeu (vitesse en 1/65536 d'unité de piste ; mph affichés = v × 9 >> 18).
// Hypothèses : un seul train (freins de bloc ouverts), montagnes russes seulement (catégorie rollerCoaster : pas de
// voiture motorisée, sous-positions standard), modes de circuit continu (1 et 34 : pas de lancement depuis la station
// ni de navette), pas de câble de levage, de reverser ni de transfert heartline : simulateExact rend alors null et le
// serveur revient au modèle d'énergie.

import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { RIDE_TYPES, type TrackPieceInfo } from "@openrct2-claude/protocol";
import { SegmentTable, STATION_TYPES } from "./track.js";

/** Tables extraites par tools/gen-tables.mjs (data/vehicle_subpositions.json). */
interface SubpositionFile {
    accelerationFromPitch: number[];
    translationDistances: number[];
    /** Par TrackElemType : par direction, pas = tangage × 8 + axes changés (bits x, y, z) ; première et dernière position. */
    tracks: Record<string, { steps: number[][]; first: number[][]; last: number[][] }>;
}

export function vehicleTableFile(): string {
    const here = dirname(fileURLToPath(import.meta.url));
    return resolve(join(here, "..", "..", "..", "..", "data", "vehicle_subpositions.json"));
}

export class VehicleTable {
    private constructor(private readonly data: SubpositionFile) {}

    static fromFile(file = vehicleTableFile()): VehicleTable | null {
        if (!existsSync(file)) return null;
        return new VehicleTable(JSON.parse(readFileSync(file, "utf8")) as SubpositionFile);
    }

    has(type: number): boolean {
        return !!this.data.tracks[type]?.steps[0]?.length;
    }

    track(type: number) {
        return this.data.tracks[type];
    }

    accel(pitch: number): number {
        return this.data.accelerationFromPitch[pitch] ?? 0;
    }

    distance(mask: number): number {
        return this.data.translationDistances[mask & 7];
    }
}

let shared: VehicleTable | null | undefined;
/** Tables chargées une fois (null si le fichier généré manque : le serveur revient au modèle d'énergie). */
export function vehicleTable(): VehicleTable | null {
    if (shared === undefined) shared = VehicleTable.fromFile();
    return shared;
}

// Constantes du jeu.
const SUBPOSITION_STOP = 0x368a; // updateTrackMotionCar : reste en dessous duquel la voiture ne bouge plus
const BLOCK_BRAKE_BASE_SPEED = 0x20364; // Track.h kBlockBrakeBaseSpeed
const BLOCK_BRAKE_SPEED_OFFSET = BLOCK_BRAKE_BASE_SPEED - (2 << 16); // kBlockBrakeSpeedOffset
const LIFT_SPEED_UNIT = 31079; // liftHillSpeed × 31079 (UpdateTravelling)
const LIFT_ACCELERATION = 15539;
const DEPART_SPEED = 131940; // UpdateDeparting, circuit continu
const DEPART_ACCELERATION = 3298;
const CREEP_SPEED = 32768; // 0.5_mph (Speed.hpp : mph << 16)
/** Une tuile de station = 32 pas de 8716 (Ride.cpp, espacement des voitures). */
export const DISTANCE_PER_TILE = 0x44180;

/** v interne → mph affichés (ToHumanReadableSpeed : v × 9 >> 18). */
export const velocityToMph = (v: number): number => (v * 9) / 262144;
/** mph affichés → v interne. */
export const mphToVelocity = (mph: number): number => Math.round((mph * 262144) / 9);

const BRAKES = new Set(["brakes", "diagBrakes", "down25Brakes", "diagDown25Brakes"]);
const BLOCK_BRAKES = new Set(["blockBrakes", "diagBlockBrakes"]);
const BOOSTERS = new Set(["booster", "diagBooster"]);

export interface ExactTrain {
    cars: number;
    /** Espacement d'une voiture en unités de distance du jeu (RideObjectVehicle.spacing). */
    spacing: number;
    /** Masse totale (Car.mass). */
    mass: number;
}

export interface ExactOptions {
    rideType: number;
    train: ExactTrain;
    /** Vitesse de chaîne (Ride.liftHillSpeed) ; défaut : LiftData.minimum_speed du type. */
    liftHillSpeed?: number;
    /** Vitesse de départ (mph) si la première pièce n'est pas une station. */
    vStartMph?: number;
    /** Circuit fermé : le train revient au début ; sinon il s'arrête au bout de la dernière pièce. */
    closed?: boolean;
    maxTicks?: number;
    /** Hauteur du premier bloc au-dessus de l'origine, par type (SegmentTable : elements[0].z). */
    blockZ?: (type: number) => number;
    /** RideMode de l'attraction ; seuls les circuits continus (1, 34) sont simulés. */
    rideMode?: number;
}

/** RideMode simulés : continuousCircuit, continuousCircuitBlockSectioned. */
const CONTINUOUS_MODES = new Set([1, 34]);
/** Pièces dont le jeu traite le mouvement à part (câble, reverser, heartline, chute libre inversée). */
const UNSUPPORTED_PIECE = /^(cableLiftHill|leftReverser|rightReverser|heartLineTransfer|reverseFreefall|airThrustTopCap|airThrustVerticalDown)/;

export interface ExactPieceSpeed {
    /** mph affichés : tête du train à l'entrée de la pièce, au plus bas et à la sortie. */
    vIn: number;
    vOut: number;
    vMin: number;
    vMax: number;
    /** Le train recule sur cette pièce (vitesse négative) : calage. */
    stall: boolean;
    /** La tête du train n'a pas atteint la pièce (calage avant). */
    reached: boolean;
}

export interface ExactResult {
    pieces: ExactPieceSpeed[];
    /** Indice de la pièce où le train cale, s'il cale. */
    stalledAt: number | null;
    ticks: number;
    /** Durée du tour (s, 40 ticks par seconde) jusqu'au retour en station ou au bout de la piste. */
    seconds: number;
    completed: boolean;
}

interface Sub {
    piece: number;
    pitch: number;
    /** Distance pour entrer dans cette sous-position depuis la précédente. */
    dist: number;
}

/** Sous-positions du circuit à plat, dans l'ordre de marche ; null si une pièce n'a pas de table. */
/**
 * Les sous-positions sont relatives au premier bloc de la pièce (TrackLocation du véhicule), à blockZ(type) au-dessus
 * de l'origine de trackplace que portent les pièces (demi-boucle descendante : −32, flatToDown60LongBase : +80).
 */
export function flattenCircuit(
    vt: VehicleTable,
    pieces: TrackPieceInfo[],
    closed: boolean,
    blockZ: (type: number) => number = () => 0,
): { subs: Sub[]; pieceStart: number[] } | null {
    const subs: Sub[] = [];
    const pieceStart: number[] = [];
    let prevEnd: number[] | null = null;
    for (let i = 0; i < pieces.length; i++) {
        const p = pieces[i];
        const t = vt.track(p.type);
        const dir = p.direction & 3;
        if (!t?.steps[dir]?.length) return null;
        const loc = [p.x * 32, p.y * 32, p.z + blockZ(p.type)];
        const first = t.first[dir];
        pieceStart.push(subs.length);
        t.steps[dir].forEach((code, k) => {
            const pitch = code >> 3;
            let mask = code & 7;
            if (k === 0) {
                // Passage d'une pièce à la suivante : axes qui changent entre la dernière position de l'une et la première de l'autre.
                const start = [loc[0] + first[0], loc[1] + first[1], loc[2] + first[2]];
                mask = prevEnd ? (start[0] !== prevEnd[0] ? 1 : 0) | (start[1] !== prevEnd[1] ? 2 : 0) | (start[2] !== prevEnd[2] ? 4 : 0) : 1;
            }
            subs.push({ piece: i, pitch, dist: vt.distance(mask) });
        });
        const last = t.last[dir];
        prevEnd = [loc[0] + last[0], loc[1] + last[1], loc[2] + last[2]];
    }
    if (closed && subs.length && prevEnd) {
        const p = pieces[0];
        const t = vt.track(p.type)!;
        const first = t.first[p.direction & 3];
        const start = [p.x * 32 + first[0], p.y * 32 + first[1], p.z + blockZ(p.type) + first[2]];
        subs[0].dist = vt.distance((start[0] !== prevEnd[0] ? 1 : 0) | (start[1] !== prevEnd[1] ? 2 : 0) | (start[2] !== prevEnd[2] ? 4 : 0));
    }
    return { subs, pieceStart };
}

/** Le simulateur exact couvre-t-il ce circuit (tables présentes, type sans voitures motorisées connues) ? */
export function exactSupported(vt: VehicleTable | null, pieces: TrackPieceInfo[]): vt is VehicleTable {
    return !!vt && pieces.length > 0 && pieces.every((p) => vt.has(p.type));
}

/**
 * Simule un tour : depuis l'arrêt en station si la première pièce est une station (départ, puis marche libre), sinon
 * depuis le début de la première pièce à vStartMph, les voitures de queue sur du plat fictif. Renvoie, pour chaque
 * pièce, les vitesses de la tête (comme les relevés de coaster_test) ; null si une pièce n'a pas de sous-positions.
 */
export function simulateExact(pieces: (TrackPieceInfo & { chain?: boolean; brakeSpeed?: number })[], opts: ExactOptions, vt = vehicleTable()): ExactResult | null {
    if (!exactSupported(vt, pieces)) return null;
    if (opts.rideMode !== undefined && !CONTINUOUS_MODES.has(opts.rideMode)) return null;
    if (RIDE_TYPES.find((r) => r.rideType === opts.rideType)?.category !== "rollerCoaster") return null;
    if (pieces.some((p) => UNSUPPORTED_PIECE.test(SegmentTable.nameOf(p.type)))) return null;
    const closed = !!opts.closed;
    const flat = flattenCircuit(vt, pieces, closed, opts.blockZ);
    if (!flat) return null;
    const { subs, pieceStart } = flat;
    const n = subs.length;
    const rt = RIDE_TYPES.find((r) => r.rideType === opts.rideType);
    const poweredLiftAccel = (rt?.poweredLiftAcceleration ?? 0) << 16;
    const boosterAccel = (rt?.boosterAcceleration ?? 0) << 16;
    const boosterFactor = rt?.boosterSpeedFactor ?? 2;
    const lsmOnFlat = !!rt?.lsmOnFlat;
    const liftSpeed = (opts.liftHillSpeed ?? rt?.liftMinSpeed ?? 5) * LIFT_SPEED_UNIT;
    const names = pieces.map((p) => SegmentTable.nameOf(p.type));
    const isStation = pieces.map((p) => STATION_TYPES.has(p.type));
    // Consigne des freins : (brakeSpeed & ~1) << 16 (TrackElement : rangée ÷ 2, relue × 2). Un frein suivi d'un frein
    // de bloc ouvert prend la plus grande des deux (chooseBrakeSpeed, populateBrakeSpeed).
    const brakeSpeed = pieces.map((p) => (p.brakeSpeed ?? 0) & ~1);
    const effectiveBrake = pieces.map((p, i) => {
        if (!BRAKES.has(names[i])) return brakeSpeed[i];
        for (let k = i; k < pieces.length; k++) {
            if (BLOCK_BRAKES.has(names[k])) return Math.max(brakeSpeed[i], brakeSpeed[k]);
            if (!BRAKES.has(names[k])) break;
        }
        return brakeSpeed[i];
    });

    // Indice de sous-position : au-delà du circuit ouvert ou avant son début, plat fictif.
    const subAt = (j: number): Sub | null => (closed ? subs[((j % n) + n) % n] : j >= 0 && j < n ? subs[j] : null);
    const pieceOf = (j: number): number => subAt(j)?.piece ?? -1;
    const pitchOf = (j: number): number => subAt(j)?.pitch ?? 0;
    const distOf = (j: number): number => subAt(j)?.dist ?? vt.distance(1);

    // Position de départ de la tête : arrêt en station (progression 17 de la dernière pièce de station, comme
    // findStationStopPoint), sinon début de la première pièce.
    let headStart = 0;
    let departing = false;
    let v = 0;
    if (isStation[0]) {
        let last = 0;
        while (last + 1 < pieces.length && isStation[last + 1]) last++;
        headStart = pieceStart[last] + Math.min(17, (pieceStart[last + 1] ?? n) - pieceStart[last] - 1);
        departing = true;
    } else {
        v = mphToVelocity(opts.vStartMph ?? 0);
    }
    const cars: { j: number; rem: number; acc: number }[] = [];
    {
        let j = headStart;
        let rem = 0;
        for (let k = 0; k < Math.max(1, opts.train.cars); k++) {
            if (k > 0) {
                // Voiture suivante : spacing plus loin en arrière.
                let back = opts.train.spacing - rem;
                rem = 0;
                while (back > 0) {
                    back -= distOf(j);
                    j--;
                }
                rem = -back;
            }
            cars.push({ j, rem, acc: 0 });
        }
    }

    const out: ExactPieceSpeed[] = pieces.map(() => ({ vIn: 0, vOut: 0, vMin: Infinity, vMax: 0, stall: false, reached: false }));
    let headPiece = pieceOf(cars[0].j);
    const enter = (piece: number) => {
        const r = out[piece];
        if (!r || r.reached) return;
        r.reached = true;
        r.vIn = velocityToMph(v);
        r.vMin = Math.min(r.vMin, r.vIn);
        r.vMax = Math.max(r.vMax, r.vIn);
    };
    enter(headPiece);
    let acc = 0;
    // Frein de chute (brakeForDrop, montagnes russes à chute verticale) : la tête freine dès la sous-position 8, puis
    // le train est tenu à l'arrêt 90 ticks à partir de la 24e (stoppedOnHoldingBrake, vertical_drop_countdown).
    let held = false;
    let holdTicks = 0;
    const progressOf = (j: number): number => {
        const s = subAt(j);
        if (!s) return 0;
        const k = closed ? ((j % n) + n) % n : j;
        return k - pieceStart[s.piece];
    };
    const lapEnd = headStart + n; // retour au même point du circuit fermé
    const maxTicks = opts.maxTicks ?? 24000;
    let stalledAt: number | null = null;
    let completed = false;
    let ticks = 0;
    let travelled = 0; // sous-positions franchies par la tête depuis le départ

    for (; ticks < maxTicks; ticks++) {
        if (departing && v <= DEPART_SPEED) acc = DEPART_ACCELERATION;
        // handleBlockBrake : pièce sous la tête, frein de bloc ouvert (un seul train).
        if (headPiece >= 0 && BLOCK_BRAKES.has(names[headPiece]) && v >= 0) {
            if (v <= BLOCK_BRAKE_BASE_SPEED) {
                v = BLOCK_BRAKE_BASE_SPEED;
                acc = 0;
            } else if (v > (brakeSpeed[headPiece] << 16) + BLOCK_BRAKE_SPEED_OFFSET) {
                v -= v >> 4;
                acc = 0;
            }
        }
        // updateVelocity
        if (held && holdTicks > 0) {
            v = 0;
            acc = 0;
            holdTicks--;
        }
        v += acc;
        if (v < 0) {
            stalledAt = headPiece;
            break;
        }
        const dist = Math.floor(v / 1024) * 42;
        let onLift = false;
        let inStation = false;
        let ended = false;
        for (const car of cars) {
            car.acc = vt.accel(pitchOf(car.j));
            let moved = 1;
            car.rem += dist;
            while (car.rem >= SUBPOSITION_STOP) {
                // trackMotionForwards : la pièce où se trouve la voiture agit avant le pas.
                const pi = pieceOf(car.j);
                const name = pi >= 0 ? names[pi] : "flat";
                if (BRAKES.has(name)) {
                    if (effectiveBrake[pi] << 16 < v) car.acc = -v * 16;
                } else if (BOOSTERS.has(name)) {
                    if ((Math.trunc((brakeSpeed[pi] * boosterFactor) / 2) << 16) > v) car.acc = boosterAccel;
                }
                if ((name === "poweredLift" || (name === "flat" && lsmOnFlat && pi >= 0)) && poweredLiftAccel) car.acc = poweredLiftAccel;
                if (name === "brakeForDrop" && car === cars[0] && !held && progressOf(car.j) >= 8) {
                    car.acc = -v * 16;
                    if (progressOf(car.j) >= 24) {
                        held = true;
                        holdTicks = 90;
                    }
                }
                if (!closed && car === cars[0] && car.j + 1 >= n) {
                    ended = true;
                    break;
                }
                car.j++;
                car.rem -= distOf(car.j);
                if (car === cars[0]) {
                    travelled++;
                    const p = pieceOf(car.j);
                    if (p !== headPiece) {
                        if (headPiece >= 0 && out[headPiece]) out[headPiece].vOut = velocityToMph(v);
                        headPiece = p;
                        if (held && holdTicks <= 0) held = false;
                        if (closed && car.j >= lapEnd) {
                            completed = true;
                            break;
                        }
                        enter(headPiece);
                    }
                }
                if (car.rem < SUBPOSITION_STOP) break;
                car.acc += vt.accel(pitchOf(car.j));
                moved++;
            }
            car.acc = Math.trunc(car.acc / moved);
            const pi = pieceOf(car.j);
            if (pi >= 0 && pieces[pi].chain) onLift = true;
            if (pi >= 0 && isStation[pi]) inStation = true;
            if (completed || ended) break;
        }
        if (headPiece >= 0 && out[headPiece]) {
            const mph = velocityToMph(v);
            out[headPiece].vMin = Math.min(out[headPiece].vMin, mph);
            out[headPiece].vMax = Math.max(out[headPiece].vMax, mph);
        }
        if (completed || ended) {
            completed = true;
            break;
        }
        // updateTrackMotionTrain : accélération du train.
        let total = 0;
        for (const car of cars) total += car.acc;
        let a = Math.trunc(total / cars.length) * 21;
        if (a < 0) a += 511;
        a = a >> 9;
        let d2 = v >> 8;
        d2 *= d2;
        d2 = Math.floor(d2 / 16);
        a -= Math.trunc(v / 4096);
        a -= opts.train.mass ? Math.trunc(d2 / opts.train.mass) : d2;
        if (a <= 0 && a >= -500 && v <= CREEP_SPEED && v >= 0) a += 400;
        acc = a;
        if (onLift && v <= liftSpeed) acc = LIFT_ACCELERATION;
        if (departing && !inStation && travelled > 0) departing = false;
    }
    // Train arrêté sans reculer jusqu'à la limite de ticks : bloqué là aussi.
    if (stalledAt === null && !completed && ticks >= maxTicks) stalledAt = headPiece;
    if (stalledAt !== null && out[stalledAt]) out[stalledAt].stall = true;
    for (const r of out) {
        if (!r.reached) {
            r.vMin = 0;
            continue;
        }
        if (!r.vOut) r.vOut = velocityToMph(Math.max(v, 0));
        if (!Number.isFinite(r.vMin)) r.vMin = r.vIn;
    }
    return { pieces: out, stalledAt, ticks, seconds: ticks / 40, completed };
}
