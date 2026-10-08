import {
    RIDE_SETTINGS,
    RIDE_STATUS_VALUE,
    levelToZ,
    rotateOffset,
    tileToWorld,
    worldToTile,
    type EntranceExitParams,
    type FootprintTile,
    type RideCreateParams,
    type RideCreateResult,
    type RideDemolishParams,
    type RideDetail,
    type RideSetNameParams,
    type RideSetPriceParams,
    type RideSetSettingParams,
    type RideSetStatusParams,
    type RideStationInfo,
    type RideSummary,
    type TrackFootprintParams,
    type TrackPlaceParams,
    type TrackCircuitParams,
    type TrackCircuitResult,
    type TrackPieceInfo,
    type TrackSegmentInfo,
    type TrackSegmentsParams,
    type TrackSegmentsResult,
} from "@openrct2-claude/protocol";
import { act, outcome } from "../actions";
import { firstLoaded, resolveLoaded } from "../objects";
import type { Job } from "../queue";
import { fail, isInt, requireInt, requireParkLoaded, requireTileInMap } from "../util";

/** Limite de pièces parcourues par track.circuit. */
const MAX_CIRCUIT_PIECES = 2000;

function getRide(id: unknown): Ride {
    if (!isInt(id)) fail("INVALID_PARAMS", "Identifiant d'attraction entier attendu.");
    const ride = map.getRide(id);
    if (!ride) fail("NOT_FOUND", `Attraction ${id} introuvable.`, { hint: "list_rides pour voir les identifiants." });
    return ride;
}

function xyzLevel(c: CoordsXYZ | null | undefined): { x: number; y: number; level: number } | null {
    if (!c || c.x < 0 || c.x === 0x8000 || c.x === -32768) return null;
    return { x: worldToTile(c.x), y: worldToTile(c.y), level: c.z / 16 };
}

function stations(ride: Ride): RideStationInfo[] {
    const out: RideStationInfo[] = [];
    const st = ride.stations;
    for (let i = 0; i < st.length; i++) {
        const s = st[i];
        const start = xyzLevel(s.start);
        if (!start) continue;
        const ent = xyzLevel(s.entrance);
        const ex = xyzLevel(s.exit);
        out.push({
            index: i,
            start,
            length: s.length,
            entrance: ent ? { ...ent, direction: s.entrance.direction } : null,
            exit: ex ? { ...ex, direction: s.exit.direction } : null,
        });
    }
    return out;
}

function rating(v: number): number | null {
    // -1 (0xFFFF) = pas encore évalué
    return v < 0 || v >= 0xffff ? null : v / 100;
}

function summary(ride: Ride): RideSummary {
    let identifier: string | null = null;
    try {
        identifier = ride.object ? ride.object.identifier : null;
    } catch {
        identifier = null;
    }
    return {
        id: ride.id,
        name: ride.name,
        type: ride.type,
        classification: ride.classification,
        status: ride.status,
        object: identifier,
        excitement: rating(ride.excitement),
        intensity: rating(ride.intensity),
        nausea: rating(ride.nausea),
        price: ride.price,
        stations: stations(ride),
    };
}

export function* list(): Job {
    requireParkLoaded();
    const rides: RideSummary[] = [];
    const all = map.rides;
    for (let i = 0; i < all.length; i++) {
        rides.push(summary(all[i]));
        if (i % 20 === 19) yield;
    }
    return { rides };
}

export function* get(params: { id: number }): Job {
    requireParkLoaded();
    const ride = getRide(params.id);
    const detail: RideDetail = {
        ...summary(ride),
        mode: ride.mode,
        liftHillSpeed: ride.liftHillSpeed,
        totalCustomers: ride.totalCustomers,
        age: ride.age,
        runningCost: ride.runningCost,
        totalProfit: ride.totalProfit,
        value: ride.value,
        downtime: ride.downtime,
        reliability: ride.reliability,
        breakdown: ride.breakdown ?? null,
        satisfaction: ride.satisfaction,
        queueTime: ride.stations.map((s) => s.queueTime),
        stats: {
            maxSpeed: ride.maxSpeed,
            averageSpeed: ride.averageSpeed,
            rideTime: ride.rideTime,
            rideLength: ride.rideLength,
            maxPositiveVerticalGs: ride.maxPositiveVerticalGs,
            maxNegativeVerticalGs: ride.maxNegativeVerticalGs,
            maxLateralGs: ride.maxLateralGs,
            totalAirTime: ride.totalAirTime,
            numDrops: ride.numDrops,
            numLiftHills: ride.numLiftHills,
            highestDropHeight: ride.highestDropHeight,
        },
        inspectionInterval: ride.inspectionInterval,
        minimumWaitingTime: ride.minimumWaitingTime,
        maximumWaitingTime: ride.maximumWaitingTime,
        vehicles: ride.vehicles.length,
    };
    (detail as unknown as Record<string, unknown>).flags = ride.flags;
    return detail;
}

export function* create(params: RideCreateParams): Job {
    requireParkLoaded();
    const obj = resolveLoaded(["ride"], params.object);
    const rideObject = objectManager.getObject("ride", obj.index);
    let rideType = params.rideType;
    if (rideType === undefined) {
        rideType = rideObject.rideType.filter((t) => t !== 255 && t !== 0xff)[0];
        if (rideType === undefined) fail("INVALID_PARAMS", `L'objet ${params.object} ne déclare aucun type d'attraction.`);
    }
    let station: number;
    if (params.stationObject !== undefined) station = resolveLoaded(["station"], params.stationObject).index;
    else station = firstLoaded("station")?.index ?? 0;
    const dryRun = !!params.dryRun;
    const r = yield* act(
        "ridecreate",
        {
            rideType,
            rideObject: obj.index,
            entranceObject: station,
            colour1: params.colour1 ?? 0,
            colour2: params.colour2 ?? 0,
            inspectionInterval: params.inspectionInterval ?? 2,
        },
        dryRun,
    );
    if (!r.ok) throw { error: r.error };
    const result: RideCreateResult = {
        rideId: typeof r.raw?.ride === "number" ? r.raw.ride : null,
        rideType,
        cost: r.cost,
        dryRun,
    };
    return result;
}

/** Empreinte d'une pièce : blocs du TrackSegment tournés selon la direction (Location.hpp rotate). */
export function footprintOf(trackType: number, x: number, y: number, direction: number): FootprintTile[] {
    const seg = context.getTrackSegment(trackType);
    if (!seg) fail("INVALID_PARAMS", `Type de pièce inconnu : ${trackType}.`);
    const tiles: FootprintTile[] = [];
    const seen: Record<string, boolean> = {};
    for (const e of seg.elements) {
        const o = rotateOffset(e, direction);
        const t = { x: x + worldToTile(o.x), y: y + worldToTile(o.y) };
        const key = `${t.x},${t.y}`;
        if (seen[key]) continue;
        seen[key] = true;
        tiles.push(t);
    }
    return tiles;
}

export function* footprint(params: TrackFootprintParams): Job {
    const trackType = requireInt(params as never, "trackType", 0);
    const x = requireInt(params as never, "x");
    const y = requireInt(params as never, "y");
    const direction = requireInt(params as never, "direction", 0, 3);
    return { tiles: footprintOf(trackType, x, y, direction) };
}

export function* segment(params: { type: number }): Job {
    const s = context.getTrackSegment(requireInt(params as never, "type", 0));
    if (!s) return null;
    const info: TrackSegmentInfo = {
        type: s.type,
        description: s.description,
        elements: s.elements.map((e) => ({ x: e.x, y: e.y, z: e.z })),
        beginZ: s.beginZ,
        endZ: s.endZ,
        endX: s.endX,
        endY: s.endY,
        beginDirection: s.beginDirection,
        endDirection: s.endDirection,
        beginSlope: s.beginSlope,
        endSlope: s.endSlope,
        beginBank: s.beginBank,
        endBank: s.endBank,
        length: s.length,
        trackGroup: s.trackGroup,
    };
    return info;
}

function fullSegment(s: TrackSegment): TrackSegmentInfo {
    return {
        type: s.type,
        description: s.description,
        elements: s.elements.map((e) => ({ x: e.x, y: e.y, z: e.z })),
        beginZ: s.beginZ,
        endZ: s.endZ,
        endX: s.endX,
        endY: s.endY,
        beginDirection: s.beginDirection,
        endDirection: s.endDirection,
        beginSlope: s.beginSlope,
        endSlope: s.endSlope,
        beginBank: s.beginBank,
        endBank: s.endBank,
        length: s.length,
        trackGroup: s.trackGroup,
        turnDirection: s.turnDirection,
        slopeDirection: s.slopeDirection,
        mirrorSegment: s.mirrorSegment,
        alternateTypeSegment: s.alternateTypeSegment,
        priceModifier: s.priceModifier,
        flags: {
            onlyAllowedUnderwater: s.onlyAllowedUnderwater,
            onlyAllowedAboveGround: s.onlyAllowedAboveGround,
            allowsChainLift: s.allowsChainLift,
            isBanked: s.isBanked,
            isInversion: s.isInversion,
            isSteepUp: s.isSteepUp,
            startsHalfHeightUp: s.startsHalfHeightUp,
            isBankedTurn: s.isBankedTurn,
            isSlopedTurn: s.isSlopedTurn,
            isHelix: s.isHelix,
            countsAsInversion: s.countsAsInversion,
        },
    };
}

/** Table complète des segments (SPEC 12.2, spike S5), paginée. */
export function* segments(params: TrackSegmentsParams): Job {
    const all = context.getAllTrackSegments();
    const cursor = params.cursor ?? 0;
    const limit = Math.min(params.limit ?? 50, 100);
    const items: TrackSegmentInfo[] = [];
    for (let i = cursor; i < all.length && items.length < limit; i++) {
        items.push(fullSegment(all[i]));
        if (items.length % 10 === 0) yield;
    }
    const next = cursor + items.length;
    const result: TrackSegmentsResult = { items, total: all.length, nextCursor: next < all.length ? next : null };
    return result;
}

function pieceOf(it: TrackIterator): TrackPieceInfo | null {
    const p = it.position;
    const seg = it.segment;
    if (!seg) return null;
    const piece: TrackPieceInfo = { type: seg.type, x: worldToTile(p.x), y: worldToTile(p.y), z: p.z, direction: (p.direction & 3) as TrackPieceInfo["direction"] };
    // Chaîne et vitesse de frein : portées par l'élément de tuile de l'origine (séquence 0) ; la vitesse du train en dépend.
    const el = originElement(p.x, p.y, p.z, seg.type);
    if (el) {
        if (el.hasChainLift) piece.chain = true;
        if (el.brakeBoosterSpeed !== null && el.brakeBoosterSpeed > 0) piece.brakeSpeed = el.brakeBoosterSpeed;
    }
    return piece;
}

function originElement(x: number, y: number, z: number, type: number): TrackElement | null {
    const els = map.getTile(worldToTile(x), worldToTile(y)).elements;
    let best: TrackElement | null = null;
    for (let i = 0; i < els.length; i++) {
        const e = els[i];
        if (e.type !== "track") continue;
        const t = e as TrackElement;
        if (t.trackType !== type || t.sequence !== 0) continue;
        if (!best || Math.abs(t.baseZ - z) < Math.abs(best.baseZ - z)) best = t;
    }
    return best;
}

const pieceKey = (p: TrackPieceInfo | null): string => (p ? `${p.x},${p.y},${p.z},${p.direction},${p.type}` : "");

/** Pièces d'un circuit dans l'ordre de marche, lues avec TrackIterator (SPEC 12.3). */
export function* circuit(params: TrackCircuitParams): Job {
    requireParkLoaded();
    const ride = getRide(params.ride);
    let start: { x: number; y: number } | null = params.at ?? null;
    if (!start) {
        for (const st of ride.stations) {
            const s = xyzLevel(st.start);
            if (s) {
                start = s;
                break;
            }
        }
    }
    if (!start) fail("NOT_FOUND", `L'attraction ${ride.id} n'a pas de station.`, { hint: "Indique 'at' : une tuile portant une pièce du circuit." });
    requireTileInMap(start.x, start.y);
    const els = map.getTile(start.x, start.y).elements;
    let index = -1;
    for (let i = 0; i < els.length; i++) {
        if (els[i].type === "track" && (els[i] as TrackElement).ride === ride.id) {
            index = i;
            break;
        }
    }
    if (index < 0) fail("NOT_FOUND", `Aucune pièce de l'attraction ${ride.id} en (${start.x},${start.y}).`);
    const it = map.getTrackIterator({ x: tileToWorld(start.x), y: tileToWorld(start.y) }, index);
    if (!it) fail("NOT_FOUND", `Itérateur de piste indisponible en (${start.x},${start.y}).`);
    // Recul jusqu'au début de la chaîne, ou jusqu'au point de départ si le circuit est fermé.
    const firstKey = pieceKey(pieceOf(it));
    let closed = false;
    for (let n = 0; n < MAX_CIRCUIT_PIECES; n++) {
        if (!it.previous()) break;
        if (pieceKey(pieceOf(it)) === firstKey) {
            closed = true;
            break;
        }
        if (n % 50 === 49) yield;
    }
    const pieces: TrackPieceInfo[] = [];
    const head = pieceOf(it);
    if (head) pieces.push(head);
    const headKey = pieceKey(head);
    let truncated = true;
    for (let n = 0; n < MAX_CIRCUIT_PIECES; n++) {
        if (!it.next()) {
            truncated = false;
            break;
        }
        const p = pieceOf(it);
        if (pieceKey(p) === headKey) {
            truncated = false;
            break;
        }
        if (p) pieces.push(p);
        if (n % 50 === 49) yield;
    }
    if (closed) {
        // Le circuit commence à la première pièce de station précédée d'une pièce hors station.
        const isStation = (t: number) => t === 1 || t === 2 || t === 3;
        const k = pieces.findIndex((p, i) => isStation(p.type) && !isStation(pieces[(i + pieces.length - 1) % pieces.length].type));
        if (k > 0) pieces.push(...pieces.splice(0, k));
    }
    const result: TrackCircuitResult = { pieces, closed, truncated };
    return result;
}

export function* placeTrack(params: TrackPlaceParams): Job {
    requireParkLoaded();
    const ride = getRide(params.ride);
    const x = requireInt(params as never, "x");
    const y = requireInt(params as never, "y");
    requireTileInMap(x, y);
    const level = requireInt(params as never, "level", 1, 127);
    const direction = requireInt(params as never, "direction", 0, 3);
    const trackType = requireInt(params as never, "trackType", 0);
    const r = yield* act(
        "trackplace",
        {
            x: tileToWorld(x),
            y: tileToWorld(y),
            z: levelToZ(level),
            direction,
            ride: ride.id,
            trackType,
            rideType: params.rideType ?? ride.type,
            brakeSpeed: params.brakeSpeed ?? 0,
            colour: params.colour ?? 0,
            seatRotation: params.seatRotation ?? 4,
            trackPlaceFlags: params.flags ?? 0,
            isFromTrackDesign: false,
        },
        !!params.dryRun,
        { tile: { x, y } },
    );
    return { ...outcome(r), footprint: footprintOf(trackType, x, y, direction) };
}

export function* placeEntranceExit(params: EntranceExitParams): Job {
    requireParkLoaded();
    const ride = getRide(params.ride);
    const x = requireInt(params as never, "x");
    const y = requireInt(params as never, "y");
    requireTileInMap(x, y);
    const direction = requireInt(params as never, "direction", 0, 3);
    const r = yield* act(
        "rideentranceexitplace",
        { x: tileToWorld(x), y: tileToWorld(y), direction, ride: ride.id, station: params.station ?? 0, isExit: !!params.isExit },
        !!params.dryRun,
        { tile: { x, y } },
    );
    return outcome(r);
}

export function* setStatus(params: RideSetStatusParams): Job {
    requireParkLoaded();
    const ride = getRide(params.ride);
    const status = RIDE_STATUS_VALUE[params.status];
    if (status === undefined) fail("INVALID_PARAMS", "'status' : closed, open, testing ou simulating.");
    return outcome(yield* act("ridesetstatus", { ride: ride.id, status }, false));
}

export function* setPrice(params: RideSetPriceParams): Job {
    requireParkLoaded();
    const ride = getRide(params.ride);
    const price = requireInt(params as never, "price", 0, 2000);
    return outcome(yield* act("ridesetprice", { ride: ride.id, price, isPrimaryPrice: params.primary !== false }, false));
}

export function* setSetting(params: RideSetSettingParams): Job {
    requireParkLoaded();
    const ride = getRide(params.ride);
    const setting = typeof params.setting === "string" ? (RIDE_SETTINGS as Record<string, number>)[params.setting] : params.setting;
    if (!isInt(setting)) fail("INVALID_PARAMS", `Réglage inconnu : ${params.setting}.`, { details: { known: Object.keys(RIDE_SETTINGS) } });
    const value = requireInt(params as never, "value", 0, 255);
    return outcome(yield* act("ridesetsetting", { ride: ride.id, setting, value }, false));
}

export function* setName(params: RideSetNameParams): Job {
    requireParkLoaded();
    const ride = getRide(params.ride);
    if (typeof params.name !== "string" || params.name.length === 0 || params.name.length > 64) fail("INVALID_PARAMS", "'name' : 1 à 64 caractères.");
    return outcome(yield* act("ridesetname", { ride: ride.id, name: params.name }, false));
}

export function* demolish(params: RideDemolishParams): Job {
    requireParkLoaded();
    const ride = getRide(params.ride);
    return outcome(yield* act("ridedemolish", { ride: ride.id, modifyType: 0 }, !!params.dryRun));
}
