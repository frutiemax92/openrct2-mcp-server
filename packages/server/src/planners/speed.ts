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
// Pièces motorisées (Vehicle::trackMotionForwards). Sur un poweredLift (et sur le plat des types hasLsmBehaviourOnFlat),
// le jeu REMPLACE l'accélération de pente de la voiture par PoweredLiftAcceleration << 16 à chaque sous-position, puis la
// divise par le nombre de sous-positions franchies dans le tick, qui croît avec la vitesse : c'est une puissance
// constante. Ramené à la distance : d(v²) = launchK · accélération / v par tuile, sans terme de pente, traînée comprise.
// Un booster fait de même avec BoosterAcceleration tant que le train est sous sa vitesse cible
// (consigne × BoosterSpeedFactor / 2). Le jeu moyenne sur le train : seules les voitures posées sur la pièce poussent.
// Les constantes viennent du type d'attraction (RIDE_TYPES, LegacyBoosterSettings) ; launchK est calé sur les mesures.
//
// Simulateur exact (vehicle.ts). Quand les sous-positions de toutes les pièces sont connues et que le modèle porte un
// type d'attraction (SpeedModels.get), simulate() rejoue le mouvement du jeu tick par tick au lieu de ce modèle
// d'énergie : rien à caler. Le modèle d'énergie reste le recours (pièces sans table, energyOnly) et sert au calage.
//
// Longueur du train (simulateTrain). Le jeu calcule l'accélération de pente de chaque voiture sur sa propre pièce, puis
// en prend la moyenne sur le train (Vehicle::UpdateTrackMotion) : intégré sur la distance, c'est la variation de la
// hauteur moyenne des voitures, et non de la hauteur de la tête. Un train long « s'étale » sur une crête ou un sommet
// d'inversion ; un train court suit le profil de près. La traînée quadratique est divisée par la masse totale
// (GetAccelerationDecrease2) : à voitures égales, un train plus court (plus léger) perd sa vitesse plus vite. k2 est
// donc rapporté à la masse du train de calage (massRef) : k2 effectif = k2 · massRef / masse.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { PieceSample, TrackPieceInfo, TrackSegmentInfo } from "@openrct2-claude/protocol";
import { RIDE_TYPES } from "@openrct2-claude/protocol";
import { SegmentTable, STATION_TYPES, beginPose, blockBoundaries, endPose, samePose, type BlockBoundary } from "./track.js";
import { DISTANCE_PER_TILE, simulateExact, vehicleTableFile, type ExactPieceSpeed, type ExactTrain } from "./vehicle.js";

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
    /** Gain de v² (mph³) par tuile et par unité d'accélération d'une pièce motorisée, divisé par v (DEFAULT_LAUNCH_K). */
    launchK?: number;
    /** Poussée des pièces motorisées du type d'attraction (SpeedModels.get l'attache ; jamais enregistrée). */
    power?: RidePower;
    /** Type d'attraction : active le simulateur exact (SpeedModels.get l'attache ; jamais enregistré). */
    rideType?: number;
    /** Vitesse de chaîne de l'attraction (Ride.liftHillSpeed) ; défaut : celle du type à la création. */
    liftHillSpeed?: number;
    /** RideMode de l'attraction : hors circuit continu (lancement, navette), retour au modèle d'énergie. */
    rideMode?: number;
    /** Force le modèle d'énergie (calage, comparaison). */
    energyOnly?: boolean;
}

/** Train par défaut du simulateur exact quand le train de l'attraction est inconnu (twister, 7 voitures). */
export const DEFAULT_TRAIN: TrainShape = { cars: 7, carLength: 0.45, mass: 4425 };

export function exactTrain(train?: TrainShape): ExactTrain {
    const t = train && train.cars > 0 ? train : DEFAULT_TRAIN;
    return { cars: t.cars, spacing: Math.round(t.carLength * DISTANCE_PER_TILE), mass: t.mass };
}

/** Le modèle avec la vitesse de chaîne et le mode d'une attraction donnée (ou d'un design). */
export function forRide(model: SpeedModel, ride: { liftHillSpeed?: number; mode?: number }): SpeedModel {
    return { ...model, liftHillSpeed: ride.liftHillSpeed || model.liftHillSpeed, rideMode: ride.mode ?? model.rideMode };
}

/** Poussée des pièces motorisées d'un type d'attraction (RideTypeDescriptor.LegacyBoosterSettings). */
export interface RidePower {
    poweredLift: number;
    booster: number;
    boosterSpeedFactor: number;
    lsmOnFlat: boolean;
}

/**
 * launchK par défaut : Lunar Launcher (twister, poweredLift 17) entre à 13 mph sur 7 poweredLift 25° et en sort à
 * 39 mph. Sans pente ni traînée, ⅔ (39³ − 13³) / 7 ≈ 5400 = launchK × 17 (320) ; avec la traînée et le train entier
 * (voitures hors de la montée), le calage sur la propulsion seule donne 450 (écart < 2 km/h sur les 7 pièces).
 */
export const DEFAULT_LAUNCH_K = 450;

/** Sous cette vitesse (mph), le jeu franchit au moins une sous-position par tick : la poussée ne croît plus. */
const POWER_MIN_MPH = 2;

const BOOSTER_NAMES = new Set(["booster", "diagBooster"]);

export function ridePower(rideType: number): RidePower | undefined {
    const r = RIDE_TYPES.find((t) => t.rideType === rideType);
    if (!r) return undefined;
    return { poweredLift: r.poweredLiftAcceleration, booster: r.boosterAcceleration, boosterSpeedFactor: r.boosterSpeedFactor, lsmOnFlat: r.lsmOnFlat };
}

/**
 * Gain de v² par tuile d'une pièce motorisée à la vitesse v (mph), ou 0 si la pièce ne pousse pas à cette vitesse
 * (pièce ordinaire, type sans poussée, booster déjà à sa vitesse cible). Une pièce qui pousse annule la pente.
 */
export function powerGain(model: SpeedModel, name: string, v: number, brakeSpeed?: number): number {
    const pw = model.power;
    if (!pw) return 0;
    let accel = 0;
    if (name === "poweredLift" || (name === "flat" && pw.lsmOnFlat)) accel = pw.poweredLift;
    else if (BOOSTER_NAMES.has(name) && v < boosterTargetMph(pw, brakeSpeed)) accel = pw.booster;
    return accel ? ((model.launchK ?? DEFAULT_LAUNCH_K) * accel) / Math.max(v, POWER_MIN_MPH) : 0;
}

/** v² après une poussée : un booster ne pousse pas au-delà de sa vitesse cible (ni ne freine un train plus rapide). */
function capBoost(model: SpeedModel, name: string, v2: number, vBefore: number, brakeSpeed?: number): number {
    if (!model.power || !BOOSTER_NAMES.has(name)) return v2;
    const t = boosterTargetMph(model.power, brakeSpeed);
    return Math.min(v2, Math.max(t * t, vBefore * vBefore));
}

/** Vitesse cible d'un booster (mph) : consigne × BoosterSpeedFactor / 2 (GetUnifiedBoosterSpeed). */
export function boosterTargetMph(pw: RidePower, brakeSpeed?: number): number {
    return (brakeSpeedToMph(brakeSpeed ?? 0) * pw.boosterSpeedFactor) / 2;
}

/** Pièce qui peut pousser le train pour ce type (poweredLift, booster, plat LSM). */
export function isPowered(model: SpeedModel, name: string): boolean {
    const pw = model.power;
    if (!pw) return false;
    return (name === "poweredLift" && pw.poweredLift > 0) || (name === "flat" && pw.lsmOnFlat && pw.poweredLift > 0) || (BOOSTER_NAMES.has(name) && pw.booster > 0);
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

/** Voitures d'un objet d'attraction et règle de composition (RideObject ; 255 = pas de voiture dédiée). */
export interface TrainObject {
    vehicles: { spacing: number; carMass: number }[];
    minCars: number;
    maxCars: number;
    front: number;
    second: number;
    third: number;
    rear: number;
    defaultCar: number;
}

/** RideEntryGetVehicleAtPosition (Ride.cpp). */
function carAt(o: TrainObject, numCars: number, position: number): { spacing: number; carMass: number } | undefined {
    let i = o.defaultCar;
    if (position === 0 && o.front !== 255) i = o.front;
    else if (position === 1 && o.second !== 255) i = o.second;
    else if (position === 2 && o.third !== 255) i = o.third;
    else if (position === numCars - 1 && o.rear !== 255) i = o.rear;
    return o.vehicles[i];
}

/** Modes à sections de bloc (Ride::isBlockSectioned) : marge de sécurité sur la longueur de station. */
const BLOCK_SECTIONED_MODES = new Set([34, 36]);

/**
 * Train que le jeu créera pour cet objet (Ride::UpdateMaxVehicles) : le nombre de voitures voulu (proposedNumCarsPerTrain,
 * maxCarsInTrain à la création ou ride_configure carsPerTrain), borné par la longueur de la plus courte station et la
 * masse maximale du type (MaxMass << 8), voitures à vide. undefined si l'objet n'a pas de voiture utilisable.
 */
export function composeTrain(o: TrainObject, opts: { stationTiles: number; rideType?: number; mode?: number; wantedCars?: number }): TrainShape | undefined {
    if (!o.vehicles.length || !opts.stationTiles) return undefined;
    const rt = RIDE_TYPES.find((r) => r.rideType === opts.rideType);
    const maxMass = (rt?.maxMass ?? 255) << 8;
    const stationLength = opts.stationTiles * SPACING_PER_TILE - (opts.mode !== undefined && BLOCK_SECTIONED_MODES.has(opts.mode) ? 0x16b2a : 0);
    const carsOf = (n: number) => Array.from({ length: n }, (_, i) => carAt(o, n, i));
    let maxFit = 1;
    for (let n = o.maxCars; n > 0; n--) {
        const cars = carsOf(n);
        if (cars.some((c) => !c)) continue;
        const length = cars.reduce((a, c) => a + c!.spacing, 0);
        const mass = cars.reduce((a, c) => a + c!.carMass, 0);
        if (length <= stationLength && mass <= maxMass) {
            maxFit = n;
            break;
        }
    }
    const minCars = Math.max(1, o.minCars);
    const n = Math.min(Math.max(opts.wantedCars ?? o.maxCars, minCars), Math.max(maxFit, minCars));
    const cars = carsOf(n);
    if (cars.some((c) => !c)) return undefined;
    return trainShape(cars.map((c) => ({ mass: c!.carMass, spacing: c!.spacing })));
}

let vehicleObjects: Record<string, TrainObject> | null | undefined;
/** Voitures d'un objet d'attraction par identifiant ou nom DAT (data/ride_vehicles.json, tools/gen-tables.mjs). */
export function rideVehicleObject(key: string): TrainObject | undefined {
    if (vehicleObjects === undefined) {
        const file = join(dirname(vehicleTableFile()), "ride_vehicles.json");
        vehicleObjects = existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as Record<string, TrainObject>) : null;
    }
    return vehicleObjects?.[key.trim()] ?? vehicleObjects?.[key.trim().toUpperCase()];
}

/**
 * Train d'un design (.td6) : son objet de véhicule et son nombre de voitures, à vide. Objet inconnu : le train par
 * défaut ramené à ce nombre de voitures.
 */
export function designTrain(td: { vehicleObject: string; carsPerTrain?: number; rideType: number }): TrainShape | undefined {
    const o = rideVehicleObject(td.vehicleObject);
    const composed = o && composeTrain(o, { stationTiles: Infinity, rideType: td.rideType, wantedCars: td.carsPerTrain || undefined });
    if (composed) return composed;
    return td.carsPerTrain ? { cars: td.carsPerTrain, carLength: DEFAULT_TRAIN.carLength, mass: (DEFAULT_TRAIN.mass / DEFAULT_TRAIN.cars) * td.carsPerTrain } : undefined;
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
    /** false : la tête du train n'atteint pas la pièce (calage avant ; simulateur exact). */
    reached?: boolean;
    /** Vitesses issues du simulateur exact. */
    exact?: boolean;
    /**
     * G prédits de la tête du train sur la pièce (simulateur exact seulement, lissés comme les statistiques du jeu) :
     * latéraux en valeur absolue, verticaux max et min, en G.
     */
    gLat?: number;
    gVertMax?: number;
    gVertMin?: number;
}

/** PieceSpeed d'une pièce du simulateur exact. */
function fromExact(r: ExactPieceSpeed): PieceSpeed {
    const out: PieceSpeed = { vIn: r.vIn, vOut: r.vOut, vMin: r.vMin, stall: r.stall, reached: r.reached, exact: true };
    if (r.gLat !== undefined) Object.assign(out, { gLat: r.gLat, gVertMax: r.gVertMax, gVertMin: r.gVertMin });
    return out;
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
export function stepPiece(model: SpeedModel, seg: TrackSegmentInfo, name: string, vIn: number, opts: { chain?: boolean; brakeMph?: number; brakeSpeed?: number } = {}): PieceSpeed {
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
        const push = powerGain(model, name, v, opts.brakeSpeed);
        v2 += (push ? push * (len / n) : -model.K * rise) - (model.k1 * v + model.k2 * v * v) * (len / n);
        if (push) v2 = capBoost(model, name, v2, v, opts.brakeSpeed);
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
export function simulate(model: SpeedModel, table: SegmentTable, pieces: SimPiece[], vStart: number, train?: TrainShape, opts: { startPiece?: number } = {}): PieceSpeed[] {
    const startPiece = opts.startPiece ?? 0;
    if (startPiece > 0) {
        // Tête du train sur startPiece, queue sur les pièces d'avant : seul le simulateur exact pose les voitures ainsi ;
        // le modèle d'énergie repart du début de startPiece (pièces d'avant non atteintes).
        const ex =
            !model.energyOnly && model.rideType !== undefined
                ? simulateExact(pieces, { rideType: model.rideType, train: exactTrain(train), liftHillSpeed: model.liftHillSpeed, rideMode: model.rideMode, vStartMph: vStart, startPiece, blockZ: (t) => table.get(t)?.elements[0]?.z ?? 0 })
                : null;
        if (ex) return ex.pieces.map(fromExact);
        const before: PieceSpeed[] = pieces.slice(0, startPiece).map(() => ({ vIn: 0, vOut: 0, vMin: 0, stall: false, reached: false }));
        return [...before, ...simulate(model, table, pieces.slice(startPiece), vStart, train)];
    }
    if (!model.energyOnly && model.rideType !== undefined && pieces.length) {
        const first = table.get(pieces[0].type);
        const last = table.get(pieces[pieces.length - 1].type);
        const closed = !!first && !!last && samePose(endPose(pieces[pieces.length - 1], last), beginPose(pieces[0], first));
        // Circuit fermé qui ne commence pas en station : on le fait tourner pour partir de la station (départ du jeu).
        const n = pieces.length;
        const isStation = (i: number) => STATION_TYPES.has(pieces[((i % n) + n) % n].type);
        const shift = closed && !isStation(0) ? pieces.findIndex((_, i) => isStation(i) && !isStation(i - 1)) : 0;
        const run = shift > 0 ? [...pieces.slice(shift), ...pieces.slice(0, shift)] : pieces;
        const ex = simulateExact(run, { rideType: model.rideType, train: exactTrain(train), liftHillSpeed: model.liftHillSpeed, rideMode: model.rideMode, vStartMph: vStart, closed, blockZ: (t) => table.get(t)?.elements[0]?.z ?? 0 });
        if (ex) {
            const out = ex.pieces.map(fromExact);
            return shift > 0 ? pieces.map((_, j) => out[(j - shift + n) % n]) : out;
        }
    }
    if (train && train.cars > 0) return simulateTrain(model, table, pieces, vStart, train);
    const out: PieceSpeed[] = [];
    let v = vStart;
    for (const p of pieces) {
        const seg = table.get(p.type);
        if (!seg) {
            out.push({ vIn: v, vOut: v, vMin: v, stall: false });
            continue;
        }
        const r = stepPiece(model, seg, SegmentTable.nameOf(p.type), v, { chain: p.chain, brakeMph: p.brakeSpeed !== undefined ? brakeSpeedToMph(p.brakeSpeed) : undefined, brakeSpeed: p.brakeSpeed });
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
    const names = pieces.map((p) => SegmentTable.nameOf(p.type));
    const anyPower = names.some((n) => isPowered(model, n));
    // Pente moyenne et poussée moyenne du train sur [s, s + ds] : une voiture posée sur une pièce qui pousse ne
    // compte que pour sa poussée (le jeu remplace son accélération de pente).
    const forces = (s: number, ds: number, v: number): { rise: number; push: number } => {
        let rise = 0;
        let push = 0;
        for (const d of offsets) {
            const a = s - d;
            const k = a >= 0 ? pieceAt(Math.min(a, total)) : -1;
            const g = k >= 0 ? powerGain(model, names[k], v, pieces[k].brakeSpeed) : 0;
            if (g) push += g * ds;
            else rise += height(a + ds) - height(a);
        }
        return { rise: rise / offsets.length, push: push / offsets.length };
    };
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
            const vv = Math.sqrt(Math.max(v2, 0));
            const f = anyPower ? forces(s, ds, vv) : { rise: hNext - hPrev, push: 0 };
            const rise = f.rise;
            v2 += f.push - model.K * rise - (model.k1 * vv + k2 * vv * vv) * ds;
            if (f.push) v2 = capBoost(model, names[i], v2, vv, p.brakeSpeed);
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
        const name = names[i];
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

/** Écart moyen (km/h) entre vitesses d'entrée simulées et mesurées, hors stations et freins (only : ces pièces seules). */
export function modelError(model: SpeedModel, table: SegmentTable, measured: MeasuredPiece[], train?: TrainShape, only?: Set<number>): number {
    const sim = simulate(model, table, measured.map((m) => m.piece), model.stationSpeed, train);
    let e = 0;
    let n = 0;
    measured.forEach((m, i) => {
        if (only && !only.has(i)) return;
        const name = SegmentTable.nameOf(m.piece.type);
        if (!m.sample || m.sample.n < 1 || STATION_TYPES.has(m.piece.type) || BRAKE_NAMES.has(name) || sim[i].reached === false) return;
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
export function fitModel(table: SegmentTable, measured: MeasuredPiece[], priorIn: SpeedModel, train?: TrainShape): SpeedModel {
    // Le calage porte sur le modèle d'énergie (recours du simulateur exact).
    const prior: SpeedModel = { ...priorIn, energyOnly: true };
    const used = measured.filter((m) => m.sample && m.sample.n > 0).length;
    if (used < 12) return prior;
    const lift = measured.filter((m) => m.piece.chain && m.sample && m.sample.n > 0).map((m) => m.sample!.vFirst);
    const liftSpeed = lift.length ? median(lift) : prior.liftSpeed;
    // Le k2 du modèle précédent, ramené au train de l'essai : le calage repart de là et se rapporte à sa masse.
    const k2Here = dragK2(prior, train);
    const massRef = train?.mass ?? prior.massRef;
    let best: SpeedModel = { ...prior, liftSpeed, k2: k2Here, massRef };
    let bestErr = modelError(best, table, measured, train);
    // Pièces motorisées mesurées : launchK d'abord (sinon tout l'aval de la propulsion fausse le calage), puis à nouveau
    // après K, k1, k2. Il est calé sur la propulsion seule (pièces motorisées et les deux suivantes) : sur tout le
    // circuit, un lancement trop faible compenserait des pertes mal estimées ailleurs (Lunar Launcher : 190 au lieu de 450).
    const launchSpan = new Set<number>();
    measured.forEach((m, i) => {
        if (isPowered(prior, SegmentTable.nameOf(m.piece.type))) for (let k = i; k <= i + 2 && k < measured.length; k++) launchSpan.add(k);
    });
    const powered = [...launchSpan].some((i) => measured[i].sample && measured[i].sample!.n > 0);
    const fitLaunch = () => {
        if (!powered) return;
        let bestK = best.launchK ?? DEFAULT_LAUNCH_K;
        let bestSpan = modelError(best, table, measured, train, launchSpan);
        for (let launchK = 100; launchK <= 800; launchK += 10) {
            const e = modelError({ ...best, launchK }, table, measured, train, launchSpan);
            if (e < bestSpan) {
                bestK = launchK;
                bestSpan = e;
            }
        }
        best = { ...best, launchK: bestK };
        bestErr = modelError(best, table, measured, train);
    };
    fitLaunch();
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
    fitLaunch();
    if (bestErr >= modelError(prior, table, measured, train)) return priorIn;
    return { ...best, energyOnly: priorIn.energyOnly, samples: prior.samples + used };
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

    /** Modèle calé pour ce type (ou le générique), avec la poussée des pièces motorisées du type. */
    get(rideType: number): SpeedModel {
        const m = this.models.get(rideType) ?? this.models.get(-1) ?? DEFAULT_MODEL;
        return { ...m, power: ridePower(rideType), rideType };
    }

    set(rideType: number, model: SpeedModel): void {
        const { power: _power, rideType: _rideType, liftHillSpeed: _lift, rideMode: _mode, energyOnly: _energy, ...m } = model;
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
    models?: (SpeedModel | undefined)[],
): Map<string, SpeedWindow> {
    const byKind = new Map<string, { vIn: number[]; vMin: number[] }>();
    for (const [c, pieces] of circuits.entries()) {
        const m = models?.[c] ?? model;
        const sim = simulate(m, table, pieces, m.stationSpeed, trains?.[c]);
        pieces.forEach((p, i) => {
            const kind = elementKind(SegmentTable.nameOf(p.type));
            if (!kind || p.chain || sim[i].stall || sim[i].reached === false) return;
            const list = byKind.get(kind) ?? { vIn: [], vMin: [] };
            list.vIn.push(sim[i].vIn);
            list.vMin.push(elementMinSpeed(table, pieces, sim, i));
            byKind.set(kind, list);
        });
    }
    const out = new Map<string, SpeedWindow>();
    for (const [kind, xs] of byKind) {
        // Moins de 5 occurrences dans les designs : fenêtre non significative (quart de boucle : « 1-1 km/h » avec 3).
        if (xs.vIn.length < 5) continue;
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

export interface BlockSpacing {
    /** Longueur de piste prise en compte (tuiles) et section moyenne (longueur / sections). */
    totalTiles: number;
    meanSectionTiles: number;
    /** Freins de bloc consécutifs (sans autre limite entre eux) plus proches que `minTiles`. */
    close: { first: number; second: number; tiles: number; minTiles: number }[];
    /**
     * Circuit fermé avec freins de bloc dont le plat d'arrivée en gare (pièces de niveau qui précèdent la station) n'a
     * pas de frein de bloc : freins droits de ce plat, dernière limite avant la station et piste qui l'en sépare.
     */
    noStationBlock?: { brakes: number[]; lastBoundary?: BlockBoundary; tilesToStation: number };
}

/** Pièce de niveau : ni montée, ni descente, ni bosse (les virages à plat ou inclinés en font partie). */
function isLevel(seg: TrackSegmentInfo): boolean {
    return seg.beginZ === seg.endZ && segPeakZ(seg) === seg.beginZ;
}

/**
 * Placement des freins de bloc (COASTER_REFERENCE P9) : deux freins de bloc qui se suivent de près n'ajoutent presque
 * rien au débit (le train suivant attend quand même la plus longue section), alors que le frein de bloc d'arrivée en
 * gare, à la fin de la ligne de freins, sépare la station du reste. Seuil « trop proches » : max(2 × longueur du
 * train, moitié de la section moyenne). Circuit ouvert : `expectedTiles` (longueur visée, référence) sert de longueur
 * totale, sinon seule la longueur du train compte.
 */
export function blockSpacing(
    table: SegmentTable,
    pieces: (TrackPieceInfo & { chain?: boolean })[],
    opts: { closed: boolean; trainTiles?: number; expectedTiles?: number },
): BlockSpacing {
    const n = pieces.length;
    const len = (i: number) => segLengthTiles(table.require(pieces[((i % n) + n) % n].type));
    const bounds = blockBoundaries(pieces);
    const built = pieces.reduce((t, _, i) => t + len(i), 0);
    const totalTiles = opts.closed ? built : Math.max(built, opts.expectedTiles ?? 0);
    const sections = Math.max(bounds.length, 1);
    const meanSectionTiles = totalTiles / sections;
    const relative = opts.closed || opts.expectedTiles !== undefined ? meanSectionTiles / 2 : 0;
    const minTiles = Math.max(2 * (opts.trainTiles ?? 0), relative);
    // Arrivée de chaque station : plat (pièces de niveau) qui la précède, à rebours, et dernière limite avant elle.
    const tilesBetween = (from: number, to: number) => {
        let t = 0;
        for (let i = from + 1; ((i % n) + n) % n !== to; i++) t += len(i);
        return t;
    };
    const near = 2 * (opts.trainTiles ?? 4);
    const approachBlocks = new Set<number>();
    const approaches = !opts.closed
        ? []
        : bounds
              .filter((b) => b.kind === "station")
              .map((station) => {
                  const brakes: number[] = [];
                  let block: number | undefined;
                  for (let k = 1; k < n; k++) {
                      const i = (((station.index - k) % n) + n) % n;
                      const name = SegmentTable.nameOf(pieces[i].type);
                      if (STATION_TYPES.has(pieces[i].type) || !isLevel(table.require(pieces[i].type))) break;
                      if (name === "blockBrakes" || name === "diagBlockBrakes") {
                          block = i;
                          break;
                      }
                      if (BRAKE_NAMES.has(name)) brakes.unshift(i);
                  }
                  const at = bounds.indexOf(station);
                  const prev = bounds[(at - 1 + bounds.length) % bounds.length];
                  const tilesToStation = prev === station ? 0 : tilesBetween(prev.index, station.index);
                  // Frein de bloc collé à la station (moins de 2 trains de piste, pente comprise) : arrivée couverte aussi.
                  if (block === undefined && prev.kind === "block" && tilesToStation <= near) block = prev.index;
                  if (block !== undefined) approachBlocks.add(block);
                  // Deux stations à la suite : la seconde est déjà séparée par la première.
                  const covered = block !== undefined || prev.kind === "station";
                  return { covered, brakes, lastBoundary: prev === station ? undefined : prev, tilesToStation };
              });
    const close: BlockSpacing["close"] = [];
    for (let k = 1; k < bounds.length; k++) {
        const a = bounds[k - 1];
        const b = bounds[k];
        // Deux freins de bloc sur l'arrivée en gare (file d'attente au déchargement, Atomizer, Medusa…) : voulu.
        if (a.kind !== "block" || b.kind !== "block" || approachBlocks.has(b.index)) continue;
        const tiles = tilesBetween(a.index, b.index) + len(b.index);
        if (tiles < minTiles) close.push({ first: a.index, second: b.index, tiles, minTiles });
    }
    let noStationBlock: BlockSpacing["noStationBlock"];
    if (bounds.some((b) => b.kind === "block") && approaches.length && !approaches.some((a) => a.covered)) {
        const { brakes, lastBoundary, tilesToStation } = approaches[0];
        noStationBlock = { brakes, lastBoundary, tilesToStation };
    }
    return { totalTiles, meanSectionTiles, close, noStationBlock };
}
