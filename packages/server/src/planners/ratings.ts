// Décomposition des notes d'une montagne russe (COASTER_REFERENCE P1).
//
// Reproduit RideRatings.cpp à l'entier près : RatingsData du type (généré dans protocol/generated/rideRatings.ts),
// puis chaque modificateur dans l'ordre, avec la saturation de RideRatingsAdd, les exigences (÷ 2), la pénalité
// d'intensité et les ajustements de l'objet de véhicule (multiplicateurs, temps en l'air).
//
// L'API Ride ne donne ni les virages, ni les inversions, ni les hélices, ni l'abri, ni la proximité : les trois premiers
// se recomptent sur les pièces comme Vehicle::UpdateMeasurements, l'abri et la proximité viennent de track.rating_scan
// (plugin, éléments réels de la carte). Les vitesses de l'API sont des mph entiers : la valeur brute (velocity >> 16)
// est ambiguë d'une unité, levée en retenant la combinaison qui retombe sur les trois notes du jeu.

import { PROXIMITY_KEYS, RATING_FLAGS, RIDE_RATINGS, type ProximityKey, type RatingsModifierData, type RideRatingsData, type TrackPieceInfo, type TrackSegmentInfo } from "@openrct2-claude/protocol";
import { SegmentTable } from "./track.js";

export interface Tuple {
    excitement: number;
    intensity: number;
    nausea: number;
}

/** Virages comptés par longueur (1, 2, 3, 4+ pièces consécutives du même côté), comme Ride::turnCount*. */
export interface TurnCounts {
    flat: [number, number, number];
    banked: [number, number, number];
    sloped: [number, number, number, number];
}

export interface TrackFeatures {
    turns: TurnCounts;
    inversions: number;
    helices: number;
    /** Chutes et plus haute chute (unités de 8, comme Ride::highestDropHeight), en supposant le train toujours en avant. */
    drops: number;
    highestDrop: number;
}

/** Entrées du calcul, dans les unités du jeu. */
export interface RatingInputs {
    /** ToHumanReadableRideLength(longueur totale), m. */
    lengthM: number;
    /** Ride::getTotalTime. */
    totalTime: number;
    /** Ride::maxSpeed >> 16 et Ride::averageSpeed >> 16. */
    maxSpeed16: number;
    avgSpeed16: number;
    carsPerTrain: number;
    /** G en centièmes. */
    maxPosG: number;
    maxNegG: number;
    maxLatG: number;
    features: TrackFeatures;
    /** Chutes mesurées (prioritaires sur features.drops). */
    drops: number;
    highestDrop: number;
    shelter: { lengthM: number; sections: number; banking: boolean; rotating: boolean; trackEighths: number };
    proximity: Record<ProximityKey, number>;
    scenery: { items: number; underground: boolean };
    reversedTrains: boolean;
    /** Départ synchronisé avec une station adjacente (RideHasAdjacentStation non vérifié). */
    synchronised: boolean;
    /** Ride::totalAirTime brut (API : × 3 / 100 s). */
    airTime: number;
    entry: { excitement: number; intensity: number; nausea: number; limitAirTimeBonus: boolean; coveredRide: boolean };
    numStations: number;
}

export interface RatingTerm {
    key: string;
    /** Apport aux notes, en centièmes, après saturation. */
    excitement: number;
    intensity: number;
    nausea: number;
    /** Valeur d'entrée lisible, plafond éventuel. */
    input?: string;
    cap?: string;
    /** Part de chaque sous-entrée dans l'excitation du terme (centièmes, arrondis à part : la somme peut différer d'1 ou 2). */
    parts?: TermPart[];
}

export interface TermPart {
    key: string;
    excitement: number;
    input: string;
}

export interface RatingBreakdown extends Tuple {
    terms: RatingTerm[];
}

// ---------------------------------------------------------------------------
// Comptages sur les pièces (Vehicle::UpdateMeasurements)
// ---------------------------------------------------------------------------

const MASK1 = 0x001f;
const MASK2 = 0x00e0;
const MASK3 = 0x0700;
const MASK4 = 0xf800;
const CURRENT = 0xf800;

/** Virages, inversions, hélices et chutes d'une suite de pièces parcourue une fois, depuis la station. */
export function countTrackFeatures(table: SegmentTable, pieces: TrackPieceInfo[]): TrackFeatures {
    // Champs de bits de Ride::turnCountDefault/Banked/Sloped (Ride.cpp, IncrementTurnCount*).
    const tc = [0, 0, 0];
    const fl = { left: false, right: false, banked: false, sloped: false };
    const bump = (type: number, mask: number, step: number) => {
        let v = (tc[type] & mask) + step;
        if (v > mask) v = mask;
        tc[type] = (tc[type] & ~mask) | v;
    };
    const inc = (len: number, type: number) => {
        if (len === 0) bump(type, MASK1, 1);
        else if (len === 1) bump(type, MASK2, 0x20);
        else if (len === 2 || type !== 2) bump(type, MASK3, 0x100);
        else bump(type, MASK4, 0x800);
    };
    let inversions = 0;
    let helices = 0;
    let drops = 0;
    let highestDrop = 0;
    let dropping = false;
    let dropStart = 0;
    for (const p of pieces) {
        const seg = table.get(p.type);
        if (!seg) continue;
        const left = seg.turnDirection === "left";
        const right = seg.turnDirection === "right";
        if (fl.left && left) tc[0] = (tc[0] + 0x800) & 0xffff;
        else if (fl.right && right) tc[0] = (tc[0] + 0x800) & 0xffff;
        else if (fl.left || fl.right) {
            // La pièce qui termine un virage n'en commence pas un autre (comme dans le jeu).
            const type = fl.banked ? 1 : fl.sloped ? 2 : 0;
            fl.left = fl.right = fl.banked = fl.sloped = false;
            inc(tc[0] >> 11, type);
        } else if (left || right) {
            fl.left = left;
            fl.right = right;
            tc[0] &= ~CURRENT & 0xffff;
            if (seg.flags?.isBankedTurn) fl.banked = true;
            if (seg.flags?.isSlopedTurn) fl.sloped = true;
        }
        const z8 = (p.z + seg.beginZ) / 8;
        const down = seg.slopeDirection === "down";
        if (dropping && !down) {
            dropping = false;
            if (dropStart - z8 > highestDrop) highestDrop = dropStart - z8;
        } else if (!dropping && down) {
            dropping = true;
            drops++;
            dropStart = z8;
        }
        if (seg.flags?.countsAsInversion) inversions++;
        if (seg.flags?.isHelix) helices++;
    }
    const get = (type: number) => [tc[type] & MASK1, (tc[type] & MASK2) >> 5, (tc[type] & MASK3) >> 8, (tc[type] & MASK4) >> 11];
    const [f, b, s] = [get(0), get(1), get(2)];
    return {
        turns: { flat: [f[0], f[1], f[2]], banked: [b[0], b[1], b[2]], sloped: [s[0], s[1], s[2], s[3]] },
        inversions: Math.min(inversions, 255),
        helices: Math.min(helices, 255),
        drops,
        highestDrop,
    };
}

/**
 * Abri le long du parcours, à partir de l'état abrité de chaque bloc (track.rating_scan) : sections (passages à
 * l'abri), longueur abritée et inclinaison ou pente au moment d'entrer à l'abri (bits de numShelteredSections).
 */
export function shelterFromBlocks(
    table: SegmentTable,
    pieces: TrackPieceInfo[],
    sheltered: boolean[],
    metresPerUnit: number,
    totalLengthM: number,
): RatingInputs["shelter"] {
    let k = 0;
    let inside = false;
    let sections = 0;
    let length = 0;
    let banking = false;
    let rotating = false;
    for (const p of pieces) {
        const seg = table.get(p.type);
        if (!seg) continue;
        const n = seg.elements.length;
        for (let b = 0; b < n; b++) {
            const s = !!sheltered[k++];
            if (s && !inside) {
                sections++;
                const second = b >= n / 2;
                if ((second ? seg.endSlope : seg.beginSlope) !== 0) rotating = true;
                if ((second ? seg.endBank : seg.beginBank) !== 0) banking = true;
            }
            inside = s;
            if (s) length += (Math.max(seg.length, 1) * metresPerUnit) / n;
        }
    }
    return { lengthM: Math.floor(length), sections: Math.min(sections, 31), banking, rotating, trackEighths: shelteredEighths(totalLengthM, length) };
}

/** GetNumOfShelteredEighths (partie piste). */
export function shelteredEighths(totalLengthM: number, shelteredM: number): number {
    const eighth = totalLengthM / 8;
    let counter = eighth;
    let n = 0;
    for (let i = 0; i < 7; i++) {
        if (shelteredM >= counter) {
            counter += eighth;
            n++;
        }
    }
    return n;
}

/** Points où tester l'abri : chaque bloc de chaque pièce, à la hauteur du train (bloc + décalage du véhicule). */
export function shelterPoints(table: SegmentTable, pieces: TrackPieceInfo[], vehicleZOffset: number): { x: number; y: number; z: number }[] {
    const out: { x: number; y: number; z: number }[] = [];
    for (const p of pieces) {
        const seg = table.get(p.type);
        if (!seg) continue;
        for (const e of seg.elements) {
            const o = rot(e.x, e.y, p.direction);
            out.push({ x: p.x + Math.round(o.x / 32), y: p.y + Math.round(o.y / 32), z: p.z + e.z + vehicleZOffset });
        }
    }
    return out;
}

function rot(x: number, y: number, d: number): { x: number; y: number } {
    switch (d & 3) {
        case 0:
            return { x, y };
        case 1:
            return { x: y, y: -x };
        case 2:
            return { x: -x, y: -y };
        default:
            return { x: -y, y: x };
    }
}

// ---------------------------------------------------------------------------
// Formule (RideRatings.cpp)
// ---------------------------------------------------------------------------

const shr16 = (a: number, b: number): number => Math.floor((a * b) / 65536);
const clampR = (v: number): number => Math.min(32767, Math.max(0, v));

/** ride_ratings_get_proximity_score, et l'apport de chaque compteur. */
export function proximityScore(s: Record<ProximityKey, number>): { total: number; parts: Partial<Record<ProximityKey, number>> } {
    const h1 = (x: number, max: number, mult: number) => shr16(Math.min(x, max), mult);
    const h2 = (x: number, add: number, max: number, mult: number) => shr16(Math.min(x !== 0 ? x + add : 0, max), mult);
    const h3 = (x: number, res: number) => (x === 0 ? 0 : res);
    const parts: Partial<Record<ProximityKey, number>> = {
        waterOver: h1(s.waterOver, 60, 0x00aaaa),
        waterTouch: h1(s.waterTouch, 22, 0x0245d1),
        waterLow: h1(s.waterLow, 10, 0x020000),
        waterHigh: h1(s.waterHigh, 40, 0x00a000),
        surfaceTouch: h1(s.surfaceTouch, 70, 0x01b6db),
        queuePathOver: h1(s.queuePathOver + 8, 12, 0x064000),
        queuePathTouchAbove: h3(s.queuePathTouchAbove, 40),
        queuePathTouchUnder: h3(s.queuePathTouchUnder, 45),
        pathTouchAbove: h2(s.pathTouchAbove, 10, 20, 0x03c000),
        pathTouchUnder: h2(s.pathTouchUnder, 10, 20, 0x044000),
        ownTrackTouchAbove: h2(s.ownTrackTouchAbove, 10, 15, 0x035555),
        ownTrackCloseAbove: h1(s.ownTrackCloseAbove, 5, 0x060000),
        foreignTrackAboveOrBelow: h2(s.foreignTrackAboveOrBelow, 10, 15, 0x02aaaa),
        foreignTrackTouchAbove: h2(s.foreignTrackTouchAbove, 10, 15, 0x04aaaa),
        foreignTrackCloseAbove: h1(s.foreignTrackCloseAbove, 5, 0x090000),
        scenerySideBelow: h1(s.scenerySideBelow, 35, 0x016db6),
        scenerySideAbove: h1(s.scenerySideAbove, 35, 0x00db6d),
        ownStationTouchAbove: h3(s.ownStationTouchAbove, 55),
        ownStationCloseAbove: h3(s.ownStationCloseAbove, 25),
        trackThroughVerticalLoop: h2(s.trackThroughVerticalLoop, 4, 6, 0x140000),
        pathThroughVerticalLoop: h2(s.pathThroughVerticalLoop, 4, 6, 0x0f0000),
        intersectingVerticalLoop: h3(s.intersectingVerticalLoop, 100),
        throughVerticalLoop: h2(s.throughVerticalLoop, 4, 6, 0x0a0000),
        pathSideClose: h2(s.pathSideClose, 10, 20, 0x01c000),
        foreignTrackSideClose: h2(s.foreignTrackSideClose, 10, 20, 0x024000),
        surfaceSideClose: h2(s.surfaceSideClose, 10, 20, 0x028000),
    };
    let total = 0;
    for (const k of PROXIMITY_KEYS) total += parts[k] ?? 0;
    return { total, parts };
}

export const emptyProximity = (): Record<ProximityKey, number> => Object.fromEntries(PROXIMITY_KEYS.map((k) => [k, 0])) as Record<ProximityKey, number>;

function turnsRating(t: TurnCounts, inversions: number, helices: number): Tuple {
    const [f1, f2, f3] = t.flat;
    const [b1, b2, b3] = t.banked;
    const [s1, s2, s3, s4] = t.sloped;
    const e =
        shr16(Math.min(helices, 9), 254862) +
        shr16(f3, 0x28000) + shr16(f2, 0x30000) + shr16(f1, 63421) +
        shr16(b3, 0x3c000) + shr16(b2, 0x3c000) + shr16(b1, 73992) +
        shr16(Math.min(s4, 4), 0x78000) + shr16(Math.min(s3, 6), 273066) + shr16(Math.min(s2, 6), 0x3aaaa) + shr16(Math.min(s1, 7), 187245) +
        shr16(Math.min(inversions, 6), 0x1aaaaa);
    const i =
        shr16(Math.min(helices, 11), 148945) +
        shr16(f3, 81920) + shr16(f2, 49152) + shr16(f1, 21140) +
        shr16(b3, 0x14000) + shr16(b2, 49152) + shr16(b1, 21140) +
        shr16(inversions, 0x320000);
    const n =
        shr16(Math.min(Math.max(helices - 5, 0), 10), 0x140000) +
        shr16(f3, 0x50000) + shr16(f2, 0x32000) + shr16(f1, 42281) +
        shr16(b3, 0x50000) + shr16(b2, 0x32000) + shr16(b1, 48623) +
        shr16(Math.min(s4, 8), 0x78000) +
        shr16(inversions, 0x15aaaa);
    return { excitement: e, intensity: i, nausea: n };
}

function gforceRating(r: RatingInputs): Tuple {
    const neg = r.maxNegG;
    return {
        excitement: shr16(r.maxPosG, 5242) + shr16(Math.min(Math.max(neg, -250), 0), -15728) + shr16(Math.min(150, r.maxLatG), 26214),
        intensity: shr16(r.maxPosG, 52428) + shr16(neg - 100, -52428) + r.maxLatG,
        nausea: shr16(r.maxPosG, 17039) + shr16(neg - 100, -14563) + shr16(r.maxLatG, 21845),
    };
}

function dropsRating(drops: number, highest: number): Tuple {
    return {
        excitement: clampR(shr16(Math.min(9, drops), 728177) + shr16(highest * 2, 16000)),
        intensity: clampR(shr16(drops, 928426) + shr16(highest * 2, 32000)),
        nausea: clampR(shr16(drops, 655360) + shr16(highest * 2, 10240)),
    };
}

function shelteredRating(r: RatingInputs): Tuple {
    const len = r.shelter.lengthM;
    let e = shr16(Math.min(len, 1000), 9175);
    const i = shr16(Math.min(len, 2000), 0x2666);
    let n = shr16(Math.min(len, 1000), 0x4000);
    if (r.shelter.banking) {
        e += 20;
        n += 15;
    }
    if (r.shelter.rotating) {
        e += 20;
        n += 15;
    }
    e += shr16(Math.min(r.shelter.sections, 11), 774516);
    return { excitement: e, intensity: i, nausea: n };
}

function lateralPenalty(r: RatingInputs): Tuple {
    const out = { excitement: 0, intensity: 0, nausea: 0 };
    if (r.maxLatG > 280) {
        out.intensity = 375;
        out.nausea = 200;
    }
    if (r.maxLatG > 310) {
        let e = shr16(r.maxPosG, 5242) + shr16(Math.min(Math.max(r.maxNegG, -250), 0), -15728) + shr16(Math.min(150, r.maxLatG), 26214);
        e = Math.trunc(e / 2);
        out.excitement = -e;
        out.intensity = 1225;
        out.nausea = 600;
    }
    return out;
}

const MPH_PER_16 = 65536 / 29127;

/** Calcule les notes et la contribution de chaque terme. */
export function computeRatings(data: RideRatingsData, r: RatingInputs): RatingBreakdown {
    const t: Tuple = { ...data.base };
    const terms: RatingTerm[] = [{ key: "base", ...data.base }];
    const add = (key: string, e: number, i: number, n: number, input?: string, cap?: string, parts?: TermPart[]) => {
        const before = { ...t };
        t.excitement = clampR(t.excitement + e);
        t.intensity = clampR(t.intensity + i);
        t.nausea = clampR(t.nausea + n);
        terms.push({ key, excitement: t.excitement - before.excitement, intensity: t.intensity - before.intensity, nausea: t.nausea - before.nausea, input, cap, parts });
    };
    /** Sous-parts d'excitation (avant modificateur) ramenées à l'échelle du modificateur. */
    const partsOf = (m: RatingsModifierData, raw: [string, number, string][]): TermPart[] =>
        raw.filter(([, e]) => e !== 0).map(([key, e, input]) => ({ key, excitement: shr16(e, m.excitement), input }));
    const scale = (sub: Tuple, m: RatingsModifierData): [number, number, number] => [shr16(sub.excitement, m.excitement), shr16(sub.intensity, m.intensity), shr16(sub.nausea, m.nausea)];
    const require = (key: string, failed: boolean, m: RatingsModifierData, input: string) => {
        if (!failed) return;
        const before = { ...t };
        t.excitement = Math.trunc(t.excitement / m.excitement);
        t.intensity = Math.trunc(t.intensity / m.intensity);
        t.nausea = Math.trunc(t.nausea / m.nausea);
        terms.push({ key, excitement: t.excitement - before.excitement, intensity: t.intensity - before.intensity, nausea: t.nausea - before.nausea, input });
    };
    const f = r.features;
    const eighths = r.entry.coveredRide ? 7 : r.shelter.trackEighths;
    for (const m of data.modifiers) {
        switch (m.type) {
            case "bonusLength":
                add("length", shr16(Math.min(r.lengthM, m.threshold), m.excitement), 0, 0, `${r.lengthM} m`, `${m.threshold} m`);
                break;
            case "bonusSynchronisation":
                if (r.synchronised) add("synchronisation", m.excitement, m.intensity, m.nausea);
                break;
            case "bonusTrainLength":
                add("trainLength", shr16(r.carsPerTrain - 1, m.excitement), 0, 0, `${r.carsPerTrain} voitures`);
                break;
            case "bonusMaxSpeed":
                add("maxSpeed", shr16(r.maxSpeed16, m.excitement), shr16(r.maxSpeed16, m.intensity), shr16(r.maxSpeed16, m.nausea), `${Math.round(r.maxSpeed16 * MPH_PER_16)} mph`);
                break;
            case "bonusAverageSpeed":
                add("averageSpeed", shr16(r.avgSpeed16, m.excitement), shr16(r.avgSpeed16, m.intensity), 0, `${Math.round(r.avgSpeed16 * MPH_PER_16)} mph`);
                break;
            case "bonusDuration":
                add("duration", shr16(Math.min(r.totalTime, m.threshold), m.excitement), 0, 0, `${r.totalTime} s`, `${m.threshold} s`);
                break;
            case "bonusGForces":
                add("gForces", ...scale(gforceRating(r), m), `+${r.maxPosG / 100} / ${r.maxNegG / 100} / lat ${r.maxLatG / 100} G`, undefined, partsOf(m, [
                    ["gPositive", shr16(r.maxPosG, 5242), `${r.maxPosG / 100} G`],
                    ["gNegative", shr16(Math.min(Math.max(r.maxNegG, -250), 0), -15728), `${r.maxNegG / 100} G`],
                    ["gLateral", shr16(Math.min(150, r.maxLatG), 26214), `${r.maxLatG / 100} G (plafond 1,5)`],
                ]));
                break;
            case "bonusTurns": {
                const tr = turnsRating(f.turns, f.inversions, f.helices);
                const all = [...f.turns.flat, ...f.turns.banked, ...f.turns.sloped].reduce((a, b) => a + b, 0);
                const T = f.turns;
                add("turns", ...scale(tr, m), `${all} virages (plats ${T.flat.join("/")}, inclinés ${T.banked.join("/")}, en pente ${T.sloped.join("/")}), ${f.inversions} inversions, ${f.helices} pièces d'hélice`, "inversions 6, hélices 9", partsOf(m, [
                    ["inversions", shr16(Math.min(f.inversions, 6), 0x1aaaaa), `${f.inversions} (plafond 6)`],
                    ["helices", shr16(Math.min(f.helices, 9), 254862), `${f.helices} pièces (plafond 9)`],
                    ["flatTurns", shr16(T.flat[2], 0x28000) + shr16(T.flat[1], 0x30000) + shr16(T.flat[0], 63421), `1/2/3+ pièces : ${T.flat.join("/")}`],
                    ["bankedTurns", shr16(T.banked[2], 0x3c000) + shr16(T.banked[1], 0x3c000) + shr16(T.banked[0], 73992), `1/2/3+ pièces : ${T.banked.join("/")}`],
                    ["slopedTurns", shr16(Math.min(T.sloped[3], 4), 0x78000) + shr16(Math.min(T.sloped[2], 6), 273066) + shr16(Math.min(T.sloped[1], 6), 0x3aaaa) + shr16(Math.min(T.sloped[0], 7), 187245), `1/2/3/4+ pièces : ${T.sloped.join("/")} (plafonds 7/6/6/4)`],
                ]));
                break;
            }
            case "bonusDrops":
                add("drops", ...scale(dropsRating(r.drops, r.highestDrop), m), `${r.drops} chutes, plus haute ${r.highestDrop / 2} niveaux`, "9 chutes", partsOf(m, [
                    ["numDrops", shr16(Math.min(9, r.drops), 728177), `${r.drops} (plafond 9)`],
                    ["highestDrop", shr16(r.highestDrop * 2, 16000), `${r.highestDrop / 2} niveaux`],
                ]));
                break;
            case "bonusSheltered":
                add("sheltered", ...scale(shelteredRating(r), m), `${r.shelter.sections} sections, ${r.shelter.lengthM} m`, "11 sections", partsOf(m, [
                    ["shelteredSections", shr16(Math.min(r.shelter.sections, 11), 774516), `${r.shelter.sections} (plafond 11)`],
                    ["shelteredLength", shr16(Math.min(r.shelter.lengthM, 1000), 9175), `${r.shelter.lengthM} m`],
                    ["shelteredBankingOrPitch", (r.shelter.banking ? 20 : 0) + (r.shelter.rotating ? 20 : 0), `${r.shelter.banking ? "incliné" : ""}${r.shelter.rotating ? " en pente" : ""} à l'entrée`],
                ]));
                break;
            case "bonusReversedTrains":
                if (r.reversedTrains) {
                    const b = { ...t };
                    add("reversedTrains", (b.excitement * m.excitement) >> 7, (b.intensity * m.intensity) >> 7, (b.nausea * m.nausea) >> 7);
                }
                break;
            case "bonusProximity": {
                const p = proximityScore(r.proximity);
                add("proximity", shr16(p.total, m.excitement), 0, 0, `score ${p.total} (sol touché ${r.proximity.surfaceTouch})`, "sol touché 70 pièces", partsOf(m,
                    PROXIMITY_KEYS.map((k) => [`proximity.${k}`, p.parts[k] ?? 0, String(r.proximity[k])] as [string, number, string]),
                ));
                break;
            }
            case "bonusScenery": {
                const score = r.scenery.underground ? 40 : Math.min(r.scenery.items, 47) * 5;
                add("scenery", shr16(score, m.excitement), 0, 0, `${r.scenery.items} éléments autour de la station`, "47 éléments");
                break;
            }
            case "requirementLength":
                require("requirementLength", r.lengthM < m.threshold / 65536, m, `longueur < ${m.threshold >> 16} m`);
                break;
            case "requirementMaxSpeed":
                require("requirementMaxSpeed", r.maxSpeed16 < m.threshold >> 16, m, `vitesse max < ${Math.round((m.threshold >> 16) * MPH_PER_16)} mph`);
                break;
            case "requirementLateralGs":
                require("requirementLateralGs", r.maxLatG < m.threshold, m, `G latéraux < ${m.threshold / 100}`);
                break;
            case "requirementInversions":
                require("requirementInversions", f.inversions < m.threshold, m, `inversions < ${m.threshold}`);
                break;
            case "requirementUnsheltered":
                require("requirementUnsheltered", eighths >= m.threshold, m, `abri ≥ ${m.threshold}/8`);
                break;
            case "requirementStations":
                if (r.numStations <= m.threshold) {
                    const b = { ...t };
                    t.excitement = 0;
                    t.intensity = Math.trunc(t.intensity / m.intensity);
                    t.nausea = Math.trunc(t.nausea / m.nausea);
                    terms.push({ key: "requirementStations", excitement: -b.excitement, intensity: t.intensity - b.intensity, nausea: t.nausea - b.nausea });
                }
                break;
            case "penaltyLateralGs":
                add("lateralPenalty", ...scale(lateralPenalty(r), m), `G latéraux ${r.maxLatG / 100}`, "2,8 / 3,1 G");
                break;
        }
        // Exigences levées par les inversions (RelaxRequirementsIfInversions).
        if (f.inversions === 0 || !data.relaxRequirementsIfInversions) {
            if (m.type === "requirementDropHeight") require("requirementDropHeight", r.highestDrop < m.threshold, m, `plus haute chute < ${m.threshold / 2} niveaux`);
            if (m.type === "requirementNumDrops") require("requirementNumDrops", r.drops < m.threshold, m, `chutes < ${m.threshold}`);
            if (m.type === "requirementNegativeGs") require("requirementNegativeGs", r.maxNegG >= m.threshold, m, `G négatifs > ${m.threshold / 100}`);
        }
    }
    // RideRatingsApplyIntensityPenalty.
    {
        const before = t.excitement;
        for (const bound of [1000, 1100, 1200, 1320, 1450]) if (t.intensity >= bound) t.excitement -= Math.trunc(t.excitement / 4);
        if (t.excitement !== before) terms.push({ key: "intensityPenalty", excitement: t.excitement - before, intensity: 0, nausea: 0, input: `intensité ${t.intensity / 100}`, cap: "10,00" });
    }
    // RideRatingsApplyAdjustments : multiplicateurs de l'objet, puis temps en l'air.
    add("vehicle", (t.excitement * r.entry.excitement) >> 7, (t.intensity * r.entry.intensity) >> 7, (t.nausea * r.entry.nausea) >> 7, `multiplicateurs ${r.entry.excitement}/${r.entry.intensity}/${r.entry.nausea}`);
    if (data.hasAirTime) {
        let air = r.airTime;
        let e: number;
        if (r.entry.limitAirTimeBonus) {
            air = Math.max(0, air - 96);
            e = -Math.trunc(Math.min(air, 200) / 8);
        } else e = Math.trunc(Math.min(air, 200) / 8);
        add("airTime", e, 0, Math.trunc(air / 16), `${Math.round((r.airTime * 3) / 10) / 10} s`, "200 (≈ 6 s)");
    }
    return { ...t, terms: terms.filter((x) => x.excitement || x.intensity || x.nausea || x.key === "base") };
}

// ---------------------------------------------------------------------------
// Vitesses de l'API (mph entiers) → valeurs brutes possibles
// ---------------------------------------------------------------------------

/** velocity >> 16 compatibles avec un affichage de `mph` (ToHumanReadableSpeed = velocity × 9 >> 18). */
export function speedCandidates(mph: number): number[] {
    const lo = Math.ceil((mph * 262144) / 9);
    const hi = Math.ceil(((mph + 1) * 262144) / 9) - 1;
    const out: number[] = [];
    for (let v = lo >> 16; v <= hi >> 16; v++) out.push(v);
    return out;
}

/**
 * Lève l'ambiguïté des vitesses brutes : essaie chaque combinaison et garde celle qui retombe le mieux sur les notes
 * du jeu (somme des écarts sur excitation, intensité, nausée).
 */
export function resolveSpeeds(data: RideRatingsData, r: RatingInputs, maxMph: number, avgMph: number, game: Tuple | null): { inputs: RatingInputs; result: RatingBreakdown; error: number | null } {
    let best: { inputs: RatingInputs; result: RatingBreakdown; error: number | null } | null = null;
    for (const m of speedCandidates(maxMph))
        for (const a of speedCandidates(avgMph)) {
            const inputs = { ...r, maxSpeed16: m, avgSpeed16: a };
            const result = computeRatings(data, inputs);
            const error = game ? Math.abs(result.excitement - game.excitement) + Math.abs(result.intensity - game.intensity) + Math.abs(result.nausea - game.nausea) : null;
            if (!best || (error !== null && best.error !== null && error < best.error)) best = { inputs, result, error };
        }
    return best!;
}

// ---------------------------------------------------------------------------
// Leviers : effet sur les notes d'une variation de chaque entrée
// ---------------------------------------------------------------------------

export interface Lever {
    lever: string;
    /** Variation des notes finales, en centièmes. */
    excitement: number;
    intensity: number;
    nausea: number;
}

/** Effet marginal de variations type (une inversion, 1 mph de moyenne, 10 pièces au sol…), classé par excitation. */
export function ratingLevers(data: RideRatingsData, r: RatingInputs): Lever[] {
    const base = computeRatings(data, r);
    const f = r.features;
    const variants: [string, RatingInputs][] = [
        // Le jeu compte les vitesses en crans entiers de velocity >> 16 (2,25 mph, 3,6 km/h).
        ["+1 cran de vitesse moyenne (+2,25 mph)", { ...r, avgSpeed16: r.avgSpeed16 + 1 }],
        ["+2 crans de vitesse max (+4,5 mph)", { ...r, maxSpeed16: r.maxSpeed16 + 2 }],
        ["+1 inversion", { ...r, features: { ...f, inversions: f.inversions + 1 } }],
        ["+2 pièces d'hélice", { ...r, features: { ...f, helices: f.helices + 2 } }],
        ["+1 chute", { ...r, drops: r.drops + 1 }],
        ["+4 niveaux à la plus haute chute", { ...r, highestDrop: r.highestDrop + 8 }],
        ["+1 virage en pente de 3 pièces", { ...r, features: { ...f, turns: { ...f.turns, sloped: [f.turns.sloped[0], f.turns.sloped[1], f.turns.sloped[2] + 1, f.turns.sloped[3]] } } }],
        ["+1 virage incliné de 3 pièces ou plus", { ...r, features: { ...f, turns: { ...f.turns, banked: [f.turns.banked[0], f.turns.banked[1], f.turns.banked[2] + 1] } } }],
        ["+10 pièces au ras du sol", { ...r, proximity: { ...r.proximity, surfaceTouch: r.proximity.surfaceTouch + 10 } }],
        ["+3 passages de la piste sur elle-même", { ...r, proximity: { ...r.proximity, ownTrackTouchAbove: r.proximity.ownTrackTouchAbove + 3, ownTrackCloseAbove: r.proximity.ownTrackCloseAbove + 3 } }],
        ["+1 section abritée (tunnel)", { ...r, shelter: { ...r.shelter, sections: r.shelter.sections + 1 } }],
        ["+100 m de piste", { ...r, lengthM: r.lengthM + 100 }],
        ["+10 s de durée", { ...r, totalTime: r.totalTime + 10 }],
        ["+10 éléments de scénerie près de la station", { ...r, scenery: { ...r.scenery, items: r.scenery.items + 10 } }],
        ["+0,5 G verticaux max", { ...r, maxPosG: r.maxPosG + 50 }],
        ["+0,3 G latéraux max", { ...r, maxLatG: r.maxLatG + 30 }],
    ];
    return variants
        .map(([lever, v]) => {
            const x = computeRatings(data, v);
            return { lever, excitement: x.excitement - base.excitement, intensity: x.intensity - base.intensity, nausea: x.nausea - base.nausea };
        })
        .sort((a, b) => b.excitement - a.excitement);
}

/** Données de note d'un type d'attraction (null si inconnues ou attraction non « normale »). */
export function ratingsDataFor(rideType: number): RideRatingsData | null {
    const d = RIDE_RATINGS[rideType];
    return d && d.calculation === "normal" ? d : null;
}

export const ENTRY_FLAG = {
    limitAirTimeBonus: 1 << RATING_FLAGS.rideEntryFlag.limitAirTimeBonus,
    isACoveredRide: 1 << RATING_FLAGS.rideEntryFlag.isACoveredRide,
};
export const RIDE_FLAG_REVERSED = 1 << RATING_FLAGS.rideFlag.reversedTrains;

/** Unités de longueur des segments (TrackSegmentInfo.length) cumulées sur une suite de pièces. */
export function segmentUnits(table: SegmentTable, pieces: TrackPieceInfo[]): number {
    let u = 0;
    for (const p of pieces) {
        const seg: TrackSegmentInfo | undefined = table.get(p.type);
        if (seg) u += Math.max(seg.length, 1);
    }
    return u;
}
