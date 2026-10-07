import {
    LIMITS,
    RIDE_TYPES,
    baseHeightToLevel,
    normalizeRect,
    rectArea,
    type RegionEntrance,
    type RegionParams,
    type RegionPath,
    type RegionResult,
    type RegionTile,
    type TileElementInfo,
    type TileInfo,
    type TileXY,
} from "@openrct2-claude/protocol";
import type { Job } from "../queue";
import { fail, requireInt, requireParkLoaded, requireTileInMap } from "../util";

/** Lignes de tuiles lues par opération (SPEC 6.3, règle 4). */
const ROWS_PER_SLICE = 4;

export function* size(): Job {
    requireParkLoaded();
    return { x: map.size.x, y: map.size.y };
}

export function scanTile(x: number, y: number): RegionTile {
    const tile = map.getTile(x, y);
    const els = tile.elements;
    const out: RegionTile = { h: 0, s: 0, w: 0, t: 0, o: 0 };
    let paths: RegionPath[] | undefined;
    let rides: number[] | undefined;
    let entrances: RegionEntrance[] | undefined;
    let sc = 0;
    let lg = 0;
    let wl = 0;
    let sh = 0;
    let rh = 0;
    for (let i = 0; i < els.length; i++) {
        const el = els[i];
        if (el.isGhost) continue;
        switch (el.type) {
            case "surface": {
                const s = el as SurfaceElement;
                out.h = baseHeightToLevel(s.baseHeight);
                out.s = s.slope;
                out.w = s.waterHeight > 0 ? s.waterHeight / 16 : 0;
                out.t = s.surfaceStyle;
                out.o = (s.hasOwnership ? 1 : 0) | (s.hasConstructionRights ? 2 : 0);
                break;
            }
            case "footpath": {
                const p = el as FootpathElement;
                (paths ??= []).push({
                    l: baseHeightToLevel(p.baseHeight),
                    q: p.isQueue ? 1 : 0,
                    e: p.edges & 0xf,
                    sd: p.slopeDirection ?? -1,
                    // Lire `ride` sur un chemin qui n'est pas une file journalise un avertissement côté jeu.
                    r: p.isQueue ? p.ride ?? -1 : -1,
                    a: p.addition ?? -1,
                });
                break;
            }
            case "track": {
                const t = el as TrackElement;
                rides ??= [];
                if (rides.indexOf(t.ride) < 0) rides.push(t.ride);
                rh = Math.max(rh, baseHeightToLevel(t.clearanceHeight));
                break;
            }
            case "entrance": {
                const e = el as EntranceElement;
                (entrances ??= []).push({
                    k: e.object as 0 | 1 | 2,
                    d: e.direction,
                    r: e.ride,
                    st: e.station,
                    l: baseHeightToLevel(e.baseHeight),
                    seq: e.sequence,
                });
                break;
            }
            case "small_scenery":
                sc++;
                sh = Math.max(sh, baseHeightToLevel(el.clearanceHeight));
                break;
            case "large_scenery":
                lg++;
                sh = Math.max(sh, baseHeightToLevel(el.clearanceHeight));
                break;
            case "wall":
                wl++;
                break;
        }
    }
    if (paths) out.p = paths;
    if (rides) {
        out.r = rides;
        out.rh = rh;
    }
    if (entrances) out.e = entrances;
    if (sc) out.sc = sc;
    if (lg) out.lg = lg;
    if (wl) out.wl = wl;
    if (sh) out.sh = sh;
    return out;
}

export function* region(params: RegionParams): Job {
    requireParkLoaded();
    const r = normalizeRect({
        x1: requireInt(params as never, "x1"),
        y1: requireInt(params as never, "y1"),
        x2: requireInt(params as never, "x2"),
        y2: requireInt(params as never, "y2"),
    });
    r.x1 = Math.max(0, r.x1);
    r.y1 = Math.max(0, r.y1);
    r.x2 = Math.min(map.size.x - 1, r.x2);
    r.y2 = Math.min(map.size.y - 1, r.y2);
    if (r.x1 > r.x2 || r.y1 > r.y2) fail("INVALID_PARAMS", "Rectangle hors de la carte.");
    if (rectArea(r) > LIMITS.maxRegionTiles) {
        fail("INVALID_PARAMS", `Région trop grande (${rectArea(r)} tuiles, maximum ${LIMITS.maxRegionTiles}).`, { hint: "Découpe en plusieurs appels." });
    }
    const tiles: RegionTile[] = [];
    for (let y = r.y1; y <= r.y2; y++) {
        for (let x = r.x1; x <= r.x2; x++) tiles.push(scanTile(x, y));
        if ((y - r.y1) % ROWS_PER_SLICE === ROWS_PER_SLICE - 1) yield;
    }
    const result: RegionResult = { rect: r, tiles };
    return result;
}

const TYPE_KEYS: Record<string, string[]> = {
    surface: ["slope", "surfaceStyle", "edgeStyle", "waterHeight", "grassLength", "ownership", "parkFences", "hasOwnership", "hasConstructionRights"],
    footpath: ["object", "surfaceObject", "railingsObject", "edges", "corners", "slopeDirection", "isQueue", "queueBannerDirection", "ride", "station", "addition", "isAdditionBroken", "isWide"],
    track: ["direction", "trackType", "rideType", "sequence", "ride", "station", "hasChainLift", "isInverted", "colourScheme", "brakeBoosterSpeed"],
    small_scenery: ["direction", "object", "quadrant", "primaryColour", "secondaryColour", "tertiaryColour", "age"],
    wall: ["direction", "object", "slope", "primaryColour", "secondaryColour", "tertiaryColour", "bannerText"],
    entrance: ["direction", "object", "ride", "station", "sequence", "footpathObject", "footpathSurfaceObject"],
    large_scenery: ["direction", "object", "sequence", "primaryColour", "secondaryColour", "tertiaryColour", "bannerText"],
    banner: ["direction", "object", "bannerText", "isNoEntry"],
};

const OBJECT_TYPE_OF: Record<string, ObjectType> = {
    small_scenery: "small_scenery",
    large_scenery: "large_scenery",
    wall: "wall",
    banner: "banner",
};

function objectIdentifier(type: ObjectType, index: number | null | undefined): string | null {
    if (index === null || index === undefined) return null;
    const o = objectManager.getObject(type, index);
    return o ? o.identifier : null;
}

const STATION_TRACK_TYPES = [1, 2, 3]; // endStation, beginStation, middleStation (TrackElemType.cpp, trackTypeIsStation)
const MAZE_RIDE_TYPE = RIDE_TYPES.find((t) => t.name === "maze")?.rideType ?? -1;

/**
 * Propriétés dont le getter journalise « Cannot read … » quand l'élément ne s'y prête pas (ScTileElement.cpp) :
 * on ne les lit pas dans ces cas-là, pour ne pas inonder la console du jeu.
 */
function invalidKeys(el: TileElement): string[] {
    if (el.type === "footpath") {
        const p = el as FootpathElement;
        if (!p.isQueue) return ["ride", "station"];
        return p.ride === null ? ["station"] : [];
    }
    if (el.type === "track") {
        const t = el as TrackElement;
        const skip = STATION_TRACK_TYPES.indexOf(t.trackType) < 0 ? ["station"] : [];
        if (t.rideType === MAZE_RIDE_TYPE) skip.push("sequence", "colourScheme");
        return skip;
    }
    return [];
}

export function describeElement(el: TileElement, index: number): TileElementInfo {
    const raw = el as unknown as Record<string, unknown>;
    const skip = invalidKeys(el);
    const info: TileElementInfo = {
        index,
        type: el.type,
        level: baseHeightToLevel(el.baseHeight),
        clearanceLevel: baseHeightToLevel(el.clearanceHeight),
        baseHeight: el.baseHeight,
        isGhost: el.isGhost,
    };
    for (const k of TYPE_KEYS[el.type] ?? []) {
        if (skip.indexOf(k) >= 0) continue;
        const v = raw[k];
        if (v !== undefined && v !== null) info[k] = v;
    }
    const objType = OBJECT_TYPE_OF[el.type];
    if (objType) info.objectIdentifier = objectIdentifier(objType, raw.object as number);
    if (el.type === "footpath") {
        const p = el as FootpathElement;
        info.objectIdentifier =
            p.surfaceObject !== null ? objectIdentifier("footpath_surface", p.surfaceObject) : objectIdentifier("footpath", p.object);
        if (p.addition !== null) info.additionIdentifier = objectIdentifier("footpath_addition", p.addition);
    }
    if (el.type === "surface") {
        const s = el as SurfaceElement;
        info.surfaceIdentifier = objectIdentifier("terrain_surface", s.surfaceStyle);
        info.waterLevel = s.waterHeight > 0 ? s.waterHeight / 16 : 0;
    }
    if (el.type === "entrance") {
        info.kind = ["ride_entrance", "ride_exit", "park_entrance"][(raw.object as number) ?? 0] ?? "unknown";
    }
    return info;
}

export function* tile(params: TileXY): Job {
    requireParkLoaded();
    const x = requireInt(params as never, "x");
    const y = requireInt(params as never, "y");
    requireTileInMap(x, y);
    const t = map.getTile(x, y);
    const els = t.elements;
    const elements: TileElementInfo[] = [];
    for (let i = 0; i < els.length; i++) elements.push(describeElement(els[i], i));
    const result: TileInfo = { x, y, elements };
    return result;
}
