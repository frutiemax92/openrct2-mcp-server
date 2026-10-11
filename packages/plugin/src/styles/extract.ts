// Extraction d'une région annotée (Style Picker, SPEC 13.7) : tous les éléments de chaque tuile, avec objets,
// couleurs, rotations et hauteurs exactes, plus le terrain. Les dégagements ne sont jamais interprétés : deux objets
// qui se chevauchent (cheat Zero Clearances) sont relevés tels quels, l'un et l'autre.

import {
    RIDE_TYPES,
    STYLE_FORMAT_VERSION,
    STYLE_MAX_TILES,
    rotateOffset,
    type StyleElement,
    type StyleObjectInfo,
    type StyleRecord,
    type StyleRide,
    type StyleSurface,
    type TileXY,
} from "@openrct2-claude/protocol";
import type { Job } from "../queue";
import { fail, inMap, isInt } from "../util";

const TILES_PER_SLICE = 48;
const STATION_TRACK_TYPES = [1, 2, 3];
/** Pièces qui portent une vitesse (trackTypeHasSpeedSetting) : lire brakeBoosterSpeed ailleurs journalise un avertissement (F29). */
const SPEED_TRACK_TYPES = [99, 100, 216, 337, 338, 339, 340, 349];
const MAZE_RIDE_TYPE = RIDE_TYPES.find((t) => t.name === "maze")?.rideType ?? -1;

/** Valide une liste de tuiles (dédoublonnée, dans la carte, plafonnée). */
export function normalizeTiles(tiles: unknown): TileXY[] {
    if (!Array.isArray(tiles) || tiles.length === 0) fail("INVALID_PARAMS", "'tiles' : liste de tuiles { x, y } non vide attendue.");
    const seen: { [k: string]: true } = {};
    const out: TileXY[] = [];
    for (const t of tiles as TileXY[]) {
        if (!t || !isInt(t.x) || !isInt(t.y) || !inMap(t.x, t.y)) continue;
        const k = `${t.x},${t.y}`;
        if (seen[k]) continue;
        seen[k] = true;
        out.push({ x: t.x, y: t.y });
    }
    if (out.length === 0) fail("INVALID_PARAMS", "Aucune tuile de la liste n'est dans la carte.");
    if (out.length > STYLE_MAX_TILES) fail("INVALID_PARAMS", `Région trop grande (${out.length} tuiles, maximum ${STYLE_MAX_TILES}).`);
    return out;
}

export function bboxOf(tiles: TileXY[]): { x1: number; y1: number; x2: number; y2: number } {
    let x1 = Infinity;
    let y1 = Infinity;
    let x2 = -Infinity;
    let y2 = -Infinity;
    for (const t of tiles) {
        x1 = Math.min(x1, t.x);
        y1 = Math.min(y1, t.y);
        x2 = Math.max(x2, t.x);
        y2 = Math.max(y2, t.y);
    }
    return { x1, y1, x2, y2 };
}

function identifier(type: ObjectType, index: number | null | undefined): string | null {
    if (index === null || index === undefined) return null;
    const o = objectManager.getObject(type, index);
    return o ? o.identifier : null;
}

function colours(el: { primaryColour: number; secondaryColour: number; tertiaryColour?: number }): [number, number, number] {
    return [el.primaryColour, el.secondaryColour, el.tertiaryColour ?? 0];
}

/** Clé d'une grande scénerie posée (objet, origine, hauteur, direction) : la même pour toutes ses tuiles. */
export function largeKey(el: LargeSceneryElement, x: number, y: number): string | null {
    const origin = largeOrigin(el, x, y);
    return origin ? `${el.object}:${origin.x}:${origin.y}:${origin.baseHeight}:${el.direction}` : null;
}

/** Origine (tuile 0) d'une grande scénerie à partir d'une de ses tuiles : décalage de l'objet tourné (CoordsXY::Rotate). */
export function largeOrigin(el: LargeSceneryElement, x: number, y: number): { x: number; y: number; baseHeight: number } | null {
    const obj = objectManager.getObject("large_scenery", el.object) as LargeSceneryObject | null;
    const tile = obj?.tiles?.[el.sequence];
    if (!tile) return null;
    const off = rotateOffset({ x: tile.offset.x, y: tile.offset.y }, el.direction);
    return { x: x - off.x / 32, y: y - off.y / 32, baseHeight: el.baseHeight - Math.round(tile.offset.z / 8) };
}

function objectInfo(type: ObjectType, index: number): StyleObjectInfo | null {
    const o = objectManager.getObject(type, index);
    if (!o) return null;
    const info: StyleObjectInfo = { type, name: o.name };
    if (type === "small_scenery") {
        const s = o as SmallSceneryObject;
        info.flags = s.flags;
        info.height = s.height;
    } else if (type === "large_scenery") {
        info.tiles = (o as LargeSceneryObject).tiles.map((t) => ({ x: t.offset.x, y: t.offset.y, z: t.offset.z }));
    }
    return info;
}

function rideInfo(id: number): StyleRide | null {
    const r = map.getRide(id);
    if (!r) return null;
    let schemes: StyleRide["colourSchemes"] = [];
    let vehicles: StyleRide["vehicleColours"] = [];
    try {
        schemes = r.colourSchemes.map((c) => ({ main: c.main, additional: c.additional, supports: c.supports }));
        vehicles = r.vehicleColours.map((c) => ({ body: c.body, trim: c.trim, tertiary: c.tertiary }));
    } catch {
        // Boutiques et attractions sans véhicules : couleurs partielles.
    }
    return {
        id,
        name: r.name,
        type: r.type,
        classification: r.classification,
        object: r.object ? r.object.identifier : null,
        colourSchemes: schemes,
        vehicleColours: vehicles,
        stationStyle: typeof r.stationStyle === "number" ? r.stationStyle : null,
    };
}

export interface ExtractOptions {
    caption: string;
    source: "user" | "claude";
    id: string;
}

/** Relève une région (job : un `yield` toutes les TILES_PER_SLICE tuiles). */
export function* extractStyle(tiles: TileXY[], opts: ExtractOptions): Job {
    const box = bboxOf(tiles);
    const surfaces: StyleSurface[] = [];
    const elements: StyleElement[] = [];
    const objects: Record<string, StyleObjectInfo> = {};
    const rideIds: number[] = [];
    let ghosts = 0;
    const note = (type: ObjectType, index: number | null | undefined): string | null => {
        const id = identifier(type, index);
        if (id && !objects[id] && index !== null && index !== undefined) {
            const info = objectInfo(type, index);
            if (info) objects[id] = info;
        }
        return id;
    };
    for (let n = 0; n < tiles.length; n++) {
        const { x, y } = tiles[n];
        const dx = x - box.x1;
        const dy = y - box.y1;
        const els = map.getTile(x, y).elements;
        let ground = 0;
        for (let i = 0; i < els.length; i++) {
            if (els[i].type === "surface") {
                ground = els[i].baseHeight;
                break;
            }
        }
        for (let i = 0; i < els.length; i++) {
            const el = els[i];
            if (el.isGhost) {
                ghosts++;
                continue;
            }
            if (el.type === "surface") {
                const s = el as SurfaceElement;
                surfaces.push({
                    dx,
                    dy,
                    baseHeight: s.baseHeight,
                    slope: s.slope,
                    surface: note("terrain_surface", s.surfaceStyle),
                    edge: note("terrain_edge", s.edgeStyle),
                    water: s.waterHeight > 0 ? s.waterHeight / 8 : 0,
                    grassLength: s.grassLength,
                    ownership: s.ownership,
                    parkFences: s.parkFences,
                });
                continue;
            }
            const base: StyleElement = {
                t: el.type as StyleElement["t"],
                dx,
                dy,
                baseHeight: el.baseHeight,
                clearanceHeight: el.clearanceHeight,
                dz: el.baseHeight - ground,
                occupiedQuadrants: el.occupiedQuadrants,
            };
            switch (el.type) {
                case "small_scenery": {
                    const s = el as SmallSceneryElement;
                    elements.push({ ...base, object: note("small_scenery", s.object), direction: s.direction, quadrant: s.quadrant, colours: colours(s), age: s.age });
                    break;
                }
                case "large_scenery": {
                    const l = el as LargeSceneryElement;
                    const o = largeOrigin(l, x, y);
                    elements.push({
                        ...base,
                        object: note("large_scenery", l.object),
                        direction: l.direction,
                        sequence: l.sequence,
                        colours: colours(l),
                        origin: o ? { dx: o.x - box.x1, dy: o.y - box.y1, baseHeight: o.baseHeight } : undefined,
                        bannerText: l.bannerIndex !== null ? l.bannerText : undefined,
                    });
                    break;
                }
                case "wall": {
                    const w = el as WallElement;
                    elements.push({ ...base, object: note("wall", w.object), direction: w.direction, slope: w.slope, colours: colours(w), bannerText: w.bannerIndex !== null ? w.bannerText : undefined });
                    break;
                }
                case "banner": {
                    const b = el as BannerElement;
                    elements.push({ ...base, object: note("banner", b.object), direction: b.direction, colours: [b.primaryColour, b.secondaryColour, 0], bannerText: b.bannerText, isNoEntry: b.isNoEntry });
                    break;
                }
                case "footpath": {
                    const p = el as FootpathElement;
                    const legacy = p.surfaceObject === null;
                    elements.push({
                        ...base,
                        object: legacy ? note("footpath", p.object) : note("footpath_surface", p.surfaceObject),
                        railings: p.railingsObject !== null ? note("footpath_railings", p.railingsObject) : null,
                        legacyPath: legacy,
                        isQueue: p.isQueue,
                        edges: p.edges,
                        corners: p.corners,
                        slopeDirection: p.slopeDirection,
                        addition: p.addition !== null ? note("footpath_addition", p.addition) : null,
                        isWide: p.isWide,
                        // `ride` d'un chemin qui n'est pas une file journalise un avertissement (F29).
                        ride: p.isQueue && p.ride !== null ? p.ride : undefined,
                    });
                    break;
                }
                case "track": {
                    const t = el as TrackElement;
                    if (rideIds.indexOf(t.ride) < 0) rideIds.push(t.ride);
                    const maze = t.rideType === MAZE_RIDE_TYPE;
                    elements.push({
                        ...base,
                        ride: t.ride,
                        rideType: t.rideType,
                        trackType: t.trackType,
                        direction: t.direction,
                        sequence: maze ? undefined : (t.sequence ?? undefined),
                        colourScheme: maze ? null : t.colourScheme,
                        hasChainLift: t.hasChainLift,
                        isInverted: t.isInverted,
                        brakeBoosterSpeed: SPEED_TRACK_TYPES.indexOf(t.trackType) >= 0 ? t.brakeBoosterSpeed : null,
                        seatRotation: maze ? null : t.seatRotation,
                        station: STATION_TRACK_TYPES.indexOf(t.trackType) >= 0 ? t.station : null,
                    });
                    break;
                }
                case "entrance": {
                    const e = el as EntranceElement;
                    const kind = ["ride_entrance", "ride_exit", "park_entrance"][e.object] ?? "unknown";
                    if (kind !== "park_entrance" && rideIds.indexOf(e.ride) < 0) rideIds.push(e.ride);
                    elements.push({ ...base, kind, direction: e.direction, ride: kind !== "park_entrance" ? e.ride : undefined, station: kind !== "park_entrance" ? e.station : null, sequence: e.sequence });
                    break;
                }
            }
        }
        if (n % TILES_PER_SLICE === TILES_PER_SLICE - 1) yield;
    }
    const rides: StyleRide[] = [];
    for (const id of rideIds) {
        const r = rideInfo(id);
        if (r) {
            rides.push(r);
            if (r.object && !objects[r.object]) objects[r.object] = { type: "ride", name: map.getRide(id)?.object?.name ?? r.object };
        }
    }
    const record: StyleRecord = {
        format: STYLE_FORMAT_VERSION,
        id: opts.id,
        caption: opts.caption,
        createdAt: new Date().toISOString(),
        source: opts.source,
        park: typeof park !== "undefined" ? { name: park.name, mapSize: { x: map.size.x, y: map.size.y } } : null,
        origin: { x: box.x1, y: box.y1 },
        size: { x: box.x2 - box.x1 + 1, y: box.y2 - box.y1 + 1 },
        tiles: tiles.map((t) => [t.x - box.x1, t.y - box.y1] as [number, number]),
        surfaces,
        elements,
        objects,
        rides,
        screenshots: [],
    };
    if (ghosts) record.ghostsSkipped = ghosts;
    return record;
}

/** Identifiant de style ou de demande : sûr pour un nom de fichier ([a-z0-9-]). */
export function newId(prefix: string): string {
    let r = "";
    for (let i = 0; i < 4; i++) r += Math.floor(Math.random() * 36).toString(36);
    return `${prefix}-${Date.now().toString(36)}${r}`;
}
