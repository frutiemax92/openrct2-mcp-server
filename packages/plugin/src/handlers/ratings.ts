// Données de note que l'API Ride n'expose pas (COASTER_REFERENCE P1) : proximité, abri, scénerie autour de la station.
// Reproduit RideRatings.cpp (ride_ratings_score_close_proximity*, ride_ratings_get_scenery_score) et
// Track.cpp (TrackGetIsSheltered) sur les éléments réels de la carte.

import {
    PROXIMITY_KEYS,
    SMALL_SCENERY_FLAGS,
    TRACK_ELEM_TYPES,
    type ProximityKey,
    type RatingScanParams,
    type RatingScanResult,
} from "@openrct2-claude/protocol";
import type { Job } from "../queue";
import { fail, isInt, requireParkLoaded } from "../util";

const VERTICAL_LOOPS = [TRACK_ELEM_TYPES.leftVerticalLoop, TRACK_ELEM_TYPES.rightVerticalLoop];
const STATION_TYPES = [TRACK_ELEM_TYPES.endStation, TRACK_ELEM_TYPES.beginStation, TRACK_ELEM_TYPES.middleStation];
/** CoordsDirectionDelta (tuiles). */
const DELTA = [
    { x: -1, y: 0 },
    { x: 0, y: 1 },
    { x: 1, y: 0 },
    { x: 0, y: -1 },
];

function inMap(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < map.size.x && y < map.size.y;
}

function fullTileScenery(el: SmallSceneryElement): boolean {
    const o = objectManager.getObject("small_scenery", el.object) as SmallSceneryObject | null;
    return !!o && (o.flags & SMALL_SCENERY_FLAGS.occupiesFullTile) !== 0;
}

interface ScanState {
    scores: Record<ProximityKey, number>;
    /** Hauteur (unités de 8) de la surface de la tuile courante. */
    baseHeight: number;
}

/** ride_ratings_score_close_proximity_in_direction : tuile voisine à gauche ou à droite de la piste. */
function scoreInDirection(st: ScanState, x: number, y: number, input: TrackElement, direction: number): void {
    const sx = x + DELTA[direction].x;
    const sy = y + DELTA[direction].y;
    if (!inMap(sx, sy)) return;
    for (const el of map.getTile(sx, sy).elements) {
        if (el.isGhost) continue;
        switch (el.type) {
            case "surface":
                if (st.baseHeight <= input.baseHeight && input.clearanceHeight <= el.baseHeight) st.scores.surfaceSideClose++;
                break;
            case "footpath":
                if (Math.abs(input.baseZ - el.baseZ) <= 16) st.scores.pathSideClose++;
                break;
            case "track":
                if ((el as TrackElement).ride !== input.ride && Math.abs(input.baseZ - el.baseZ) <= 16) st.scores.foreignTrackSideClose++;
                break;
            case "small_scenery":
            case "large_scenery":
                if (el.baseZ < input.clearanceZ) {
                    if (input.baseZ > el.clearanceZ) st.scores.scenerySideAbove++;
                    else st.scores.scenerySideBelow++;
                }
                break;
        }
    }
}

/** ride_ratings_score_close_proximity_loops_helper. */
function scoreLoopsHelper(st: ScanState, x: number, y: number, input: TrackElement): void {
    if (!inMap(x, y)) return;
    for (const el of map.getTile(x, y).elements) {
        if (el.isGhost) continue;
        const zDiff = el.baseHeight - input.baseHeight;
        if (el.type === "footpath") {
            if (zDiff >= 0 && zDiff <= 16) st.scores.pathThroughVerticalLoop++;
        } else if (el.type === "track") {
            const t = el as TrackElement;
            if (((t.direction ^ input.direction) & 1) !== 0 && zDiff >= 0 && zDiff <= 16) {
                st.scores.trackThroughVerticalLoop++;
                if (VERTICAL_LOOPS.indexOf(t.trackType as never) >= 0) st.scores.intersectingVerticalLoop++;
            }
        }
    }
}

/** ride_ratings_score_close_proximity, pour l'élément de séquence 0 d'une pièce. */
function scorePiece(st: ScanState, x: number, y: number, input: TrackElement): void {
    const z = input.baseZ;
    for (const el of map.getTile(x, y).elements) {
        if (el.isGhost) continue;
        switch (el.type) {
            case "surface": {
                const s = el as SurfaceElement;
                st.baseHeight = s.baseHeight;
                if (s.baseZ === z) st.scores.surfaceTouch++;
                const w = s.waterHeight;
                if (w !== 0 && w <= z) {
                    st.scores.waterOver++;
                    if (w === z) st.scores.waterTouch++;
                    if (w + 16 === z) st.scores.waterLow++;
                    if (w + 16 + 112 <= z) st.scores.waterHigh++;
                }
                break;
            }
            case "footpath": {
                const p = el as FootpathElement;
                if (!p.isQueue) {
                    if (p.clearanceZ === input.baseZ) st.scores.pathTouchAbove++;
                    if (p.baseZ === input.clearanceZ) st.scores.pathTouchUnder++;
                } else {
                    if (p.clearanceZ <= input.baseZ) st.scores.queuePathOver++;
                    if (p.clearanceZ === input.baseZ) st.scores.queuePathTouchAbove++;
                    if (p.baseZ === input.clearanceZ) st.scores.queuePathTouchUnder++;
                }
                break;
            }
            case "track": {
                const t = el as TrackElement;
                if (VERTICAL_LOOPS.indexOf(t.trackType as never) >= 0) {
                    const seq = t.sequence ?? -1;
                    if ((seq === 3 || seq === 6) && t.baseHeight - input.clearanceHeight <= 10) st.scores.throughVerticalLoop++;
                }
                if (t.ride !== input.ride) {
                    st.scores.foreignTrackAboveOrBelow++;
                    if (t.clearanceZ === input.baseZ) st.scores.foreignTrackTouchAbove++;
                    if (t.clearanceHeight + 2 <= input.baseHeight && t.clearanceHeight + 10 >= input.baseHeight) st.scores.foreignTrackCloseAbove++;
                    if (input.clearanceHeight === t.baseHeight) st.scores.foreignTrackTouchAbove++;
                    // static_cast<uint8_t>(clearanceHeight + 10) dans le jeu.
                    if (input.clearanceHeight + 2 === t.baseHeight && ((input.clearanceHeight + 10) & 0xff) >= t.baseHeight) st.scores.foreignTrackCloseAbove++;
                } else {
                    const isStation = STATION_TYPES.indexOf(t.trackType as never) >= 0;
                    if (t.clearanceHeight === input.baseHeight) {
                        st.scores.ownTrackTouchAbove++;
                        if (isStation) st.scores.ownStationTouchAbove++;
                    }
                    if (t.clearanceHeight + 2 <= input.baseHeight && t.clearanceHeight + 10 >= input.baseHeight) {
                        st.scores.ownTrackCloseAbove++;
                        if (isStation) st.scores.ownStationCloseAbove++;
                    }
                    if (input.clearanceZ === t.baseZ) {
                        st.scores.ownTrackTouchAbove++;
                        if (isStation) st.scores.ownStationTouchAbove++;
                    }
                    if (input.clearanceHeight + 2 <= t.baseHeight && input.clearanceHeight + 10 >= t.baseHeight) {
                        st.scores.ownTrackCloseAbove++;
                        if (isStation) st.scores.ownStationCloseAbove++;
                    }
                }
                break;
            }
        }
    }
    scoreInDirection(st, x, y, input, (input.direction + 1) & 3);
    scoreInDirection(st, x, y, input, (input.direction - 1) & 3);
    if (VERTICAL_LOOPS.indexOf(input.trackType as never) >= 0) {
        scoreLoopsHelper(st, x, y, input);
        scoreLoopsHelper(st, x + DELTA[input.direction].x, y + DELTA[input.direction].y, input);
    }
}

/** Vehicle::UpdateMeasurements : sous terre, ou TrackGetIsSheltered (chemin, grande scénerie, petite scénerie pleine au-dessus). */
function isSheltered(x: number, y: number, z: number): boolean {
    if (!inMap(x, y)) return false;
    const els = map.getTile(x, y).elements;
    for (const el of els) if (el.type === "surface" && !el.isGhost && el.baseZ > z) return true;
    for (const el of els) {
        if (el.isGhost || el.baseZ <= z) continue;
        if (el.type === "large_scenery" || el.type === "footpath") return true;
        if (el.type === "small_scenery" && fullTileScenery(el as SmallSceneryElement)) return true;
    }
    return false;
}

export function* scan(params: RatingScanParams): Job {
    requireParkLoaded();
    if (!isInt(params.ride)) fail("INVALID_PARAMS", "Identifiant d'attraction entier attendu.");
    const ride = map.getRide(params.ride);
    if (!ride) fail("NOT_FOUND", `Attraction ${params.ride} introuvable.`);
    const scores = {} as Record<ProximityKey, number>;
    for (const k of PROXIMITY_KEYS) scores[k] = 0;
    const st: ScanState = { scores, baseHeight: 0 };
    const missing: number[] = [];
    const station = ride.stations.find((s) => !!s.start);
    const noEntrance = !station || !station.entrance;
    const pieces = params.pieces ?? [];
    for (let i = 0; i < pieces.length; i++) {
        const p = pieces[i];
        if (!inMap(p.x, p.y)) {
            missing.push(i);
            continue;
        }
        let input: TrackElement | null = null;
        for (const el of map.getTile(p.x, p.y).elements) {
            if (el.type !== "track" || el.isGhost || el.baseZ !== p.z) continue;
            const t = el as TrackElement;
            if (t.ride === ride.id && t.trackType === p.type && (t.sequence ?? 0) === 0) {
                input = t;
                break;
            }
        }
        if (!input) {
            missing.push(i);
            continue;
        }
        if (!noEntrance) scorePiece(st, p.x, p.y, input);
        if (i % 20 === 19) yield;
    }
    const shelterPts = params.shelter ?? [];
    const sheltered: boolean[] = [];
    for (let i = 0; i < shelterPts.length; i++) {
        sheltered.push(isSheltered(shelterPts[i].x, shelterPts[i].y, shelterPts[i].z));
        if (i % 100 === 99) yield;
    }
    // ride_ratings_get_scenery_score.
    let items = 0;
    let underground = false;
    if (station) {
        const sx = Math.floor(station.start.x / 32);
        const sy = Math.floor(station.start.y / 32);
        const surface = map.getTile(sx, sy).elements.find((e) => e.type === "surface") as SurfaceElement | undefined;
        underground = !!surface && surface.baseZ > station.start.z;
        for (let yy = Math.max(sy - 5, 0); yy <= Math.min(sy + 5, map.size.y - 1); yy++)
            for (let xx = Math.max(sx - 5, 0); xx <= Math.min(sx + 5, map.size.x - 1); xx++)
                for (const el of map.getTile(xx, yy).elements) if (!el.isGhost && (el.type === "small_scenery" || el.type === "large_scenery")) items++;
    }
    let carsPerTrain = 0;
    if (ride.vehicles.length) {
        let id: number | null = ride.vehicles[0];
        while (id !== null && carsPerTrain < 64) {
            const car = map.getEntity(id) as Car | null;
            if (!car) break;
            carsPerTrain++;
            id = car.nextCarOnTrain;
        }
    }
    const o = ride.object;
    const result: RatingScanResult = {
        proximity: scores,
        missing,
        sheltered,
        scenery: { items, underground },
        carsPerTrain,
        trains: ride.vehicles.length,
        rideFlags: ride.flags,
        departFlags: ride.departFlags,
        entry: { excitement: o.excitementMultiplier, intensity: o.intensityMultiplier, nausea: o.nauseaMultiplier, flags: o.flags },
        noEntrance,
    };
    return result;
}
