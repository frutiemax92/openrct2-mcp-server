// Construction : terrain, chemins, scénerie. Une game action par tuile, un `yield` par action.

import {
    CLEAR_ITEMS,
    LIMITS,
    MAX_LEVEL,
    MIN_LAND_BASE_HEIGHT,
    MIN_LEVEL,
    PATH_CONSTRUCT_FLAGS,
    levelToBaseHeight,
    levelToZ,
    normalizeRect,
    rectToWorldRange,
    tileToWorld,
    type BulkResult,
    type LargeSceneryPlaceParams,
    type PathAdditionParams,
    type PathPlaceParams,
    type PathRemoveParams,
    type SceneryClearParams,
    type SceneryPlaceParams,
    type SceneryRemoveSmallParams,
    type TerrainSetHeightsParams,
    type TerrainSetSurfaceParams,
    type TerrainSetWaterParams,
    type TileOutcome,
    type WallPlaceParams,
} from "@openrct2-claude/protocol";
import { act, outcome, type ActResult } from "../actions";
import { resolveLoaded, resolvePath } from "../objects";
import type { Job, Wait } from "../queue";
import { fail, inMap, isInt, requireArray, requireInt, requireParkLoaded, toBridgeError } from "../util";

type TileStep = Generator<Wait, ActResult, unknown>;

function tileOutcome(x: number, y: number, r: ActResult): TileOutcome {
    const o: TileOutcome = { x, y, ...outcome(r) };
    const z = r.raw?.position?.z;
    if (r.ok && typeof z === "number" && z >= 0) o.level = z / 16;
    return o;
}

function offMap(x: number, y: number): TileOutcome {
    return { x, y, ok: false, cost: 0, error: { code: "INVALID_PARAMS", message: `Tuile (${x},${y}) hors de la carte.` } };
}

function* runBulk<T extends { x: number; y: number }>(items: T[], dryRun: boolean, step: (item: T) => TileStep): Job {
    const results: TileOutcome[] = [];
    let placed = 0;
    let failed = 0;
    let totalCost = 0;
    for (const item of items) {
        if (!isInt(item.x) || !isInt(item.y) || !inMap(item.x, item.y)) {
            results.push(offMap(item.x, item.y));
            failed++;
            continue;
        }
        let r: ActResult;
        try {
            r = yield* step(item);
        } catch (e) {
            r = { ok: false, cost: 0, raw: null, error: toBridgeError(e) };
        }
        const o = tileOutcome(item.x, item.y, r);
        results.push(o);
        if (o.ok) {
            placed++;
            totalCost += o.cost ?? 0;
        } else failed++;
        yield;
    }
    const result: BulkResult = { dryRun, results, placed, failed, totalCost };
    return result;
}

function levelOrFail(v: unknown, key = "level"): number {
    if (!isInt(v) || v < MIN_LEVEL || v > MAX_LEVEL) fail("INVALID_PARAMS", `'${key}' : niveau entier attendu entre ${MIN_LEVEL} et ${MAX_LEVEL}.`);
    return v;
}

// ---------------------------------------------------------------------------
// Terrain
// ---------------------------------------------------------------------------

export function* setHeights(params: TerrainSetHeightsParams): Job {
    requireParkLoaded();
    const tiles = requireArray<TerrainSetHeightsParams["tiles"][number]>(params as never, "tiles", LIMITS.maxOpsPerRequest);
    for (const t of tiles) levelOrFail(t.level);
    const dryRun = !!params.dryRun;
    return yield* runBulk(tiles, dryRun, (t) =>
        act(
            "landsetheight",
            { x: tileToWorld(t.x), y: tileToWorld(t.y), height: levelToBaseHeight(t.level), style: t.slope ?? 0 },
            dryRun,
            { tile: { x: t.x, y: t.y } },
        ),
    );
}

export function* setSurface(params: TerrainSetSurfaceParams): Job {
    requireParkLoaded();
    const rect = normalizeRect({
        x1: requireInt(params as never, "x1"),
        y1: requireInt(params as never, "y1"),
        x2: requireInt(params as never, "x2"),
        y2: requireInt(params as never, "y2"),
    });
    const NONE = 0xffff;
    const surface = params.surfaceObject != null ? resolveLoaded(["terrain_surface"], params.surfaceObject).index : NONE;
    const edge = params.edgeObject != null ? resolveLoaded(["terrain_edge"], params.edgeObject).index : NONE;
    if (surface === NONE && edge === NONE) fail("INVALID_PARAMS", "Indique surfaceObject et/ou edgeObject.");
    const r = yield* act(
        "surfacesetstyle",
        { ...rectToWorldRange(rect), surfaceStyle: surface, edgeStyle: edge, surfaceColour1: 0, edgeColour1: 0 },
        !!params.dryRun,
    );
    return outcome(r);
}

export function* setWater(params: TerrainSetWaterParams): Job {
    requireParkLoaded();
    const rect = normalizeRect({
        x1: requireInt(params as never, "x1"),
        y1: requireInt(params as never, "y1"),
        x2: requireInt(params as never, "x2"),
        y2: requireInt(params as never, "y2"),
    });
    const level = requireInt(params as never, "level", 0, MAX_LEVEL);
    const tiles: { x: number; y: number }[] = [];
    for (let y = rect.y1; y <= rect.y2; y++) for (let x = rect.x1; x <= rect.x2; x++) tiles.push({ x, y });
    if (tiles.length > LIMITS.maxOpsPerRequest) fail("INVALID_PARAMS", `Trop de tuiles (${tiles.length}, maximum ${LIMITS.maxOpsPerRequest}).`);
    const dryRun = !!params.dryRun;
    // Hauteur d'eau en unités baseHeight (WaterSetHeightAction.cpp). L'action refuse une hauteur < kMinimumWaterHeight (2,
    // « Too low ») et retire l'eau si la hauteur ne dépasse pas le sol : level 0 (pas d'eau) envoie donc le minimum.
    const height = level === 0 ? MIN_LAND_BASE_HEIGHT : levelToBaseHeight(level);
    return yield* runBulk(tiles, dryRun, (t) => act("watersetheight", { x: tileToWorld(t.x), y: tileToWorld(t.y), height }, dryRun, { tile: t }));
}

// ---------------------------------------------------------------------------
// Chemins
// ---------------------------------------------------------------------------

export function* pathPlace(params: PathPlaceParams): Job {
    requireParkLoaded();
    const tiles = requireArray<PathPlaceParams["tiles"][number]>(params as never, "tiles", LIMITS.maxOpsPerRequest);
    for (const t of tiles) {
        levelOrFail(t.level);
        if (t.slopeDirection != null && (!isInt(t.slopeDirection) || t.slopeDirection < 0 || t.slopeDirection > 3)) {
            fail("INVALID_PARAMS", "'slopeDirection' : 0 à 3 ou null.");
        }
    }
    const queue = !!params.queue;
    const path = resolvePath(params.object, params.railings, queue);
    const flags = (queue ? PATH_CONSTRUCT_FLAGS.isQueue : 0) | (path.legacy ? PATH_CONSTRUCT_FLAGS.isLegacyPathObject : 0);
    const dryRun = !!params.dryRun;
    return yield* runBulk(tiles, dryRun, (t) =>
        act(
            "footpathplace",
            {
                x: tileToWorld(t.x),
                y: tileToWorld(t.y),
                z: levelToZ(t.level),
                direction: 0xff,
                object: path.object,
                railingsObject: path.railings,
                slopeType: t.slopeDirection != null ? 1 : 0,
                slopeDirection: t.slopeDirection ?? 0,
                constructFlags: flags,
            },
            dryRun,
            { tile: { x: t.x, y: t.y } },
        ),
    );
}

function pathLevelsAt(x: number, y: number): number[] {
    const out: number[] = [];
    const els = map.getTile(x, y).elements;
    for (let i = 0; i < els.length; i++) {
        if (els[i].type === "footpath" && !els[i].isGhost) out.push(els[i].baseHeight / 2);
    }
    return out;
}

export function* pathRemove(params: PathRemoveParams): Job {
    requireParkLoaded();
    const tiles = requireArray<PathRemoveParams["tiles"][number]>(params as never, "tiles", LIMITS.maxOpsPerRequest);
    const dryRun = !!params.dryRun;
    return yield* runBulk(tiles, dryRun, function* (t): TileStep {
        const levels = t.level != null ? [t.level] : pathLevelsAt(t.x, t.y);
        if (levels.length === 0) {
            return { ok: false, cost: 0, raw: null, error: { code: "NOT_FOUND", message: `Aucun chemin en (${t.x},${t.y}).` } };
        }
        let last: ActResult = { ok: true, cost: 0, raw: null };
        let cost = 0;
        for (const level of levels) {
            last = yield* act("footpathremove", { x: tileToWorld(t.x), y: tileToWorld(t.y), z: levelToZ(level) }, dryRun, { tile: t });
            if (!last.ok) return last;
            cost += last.cost;
        }
        return { ...last, cost };
    });
}

export function* pathAddition(params: PathAdditionParams): Job {
    requireParkLoaded();
    const tiles = requireArray<PathAdditionParams["tiles"][number]>(params as never, "tiles", LIMITS.maxOpsPerRequest);
    const object = resolveLoaded(["footpath_addition"], params.object).index;
    const dryRun = !!params.dryRun;
    return yield* runBulk(tiles, dryRun, function* (t): TileStep {
        const level = t.level ?? pathLevelsAt(t.x, t.y)[0];
        if (level === undefined) {
            return { ok: false, cost: 0, raw: null, error: { code: "NOT_FOUND", message: `Aucun chemin en (${t.x},${t.y}).` } };
        }
        return yield* act("footpathadditionplace", { x: tileToWorld(t.x), y: tileToWorld(t.y), z: levelToZ(level), object }, dryRun, { tile: t });
    });
}

export function* pathAdditionRemove(params: PathRemoveParams): Job {
    requireParkLoaded();
    const tiles = requireArray<PathRemoveParams["tiles"][number]>(params as never, "tiles", LIMITS.maxOpsPerRequest);
    const dryRun = !!params.dryRun;
    return yield* runBulk(tiles, dryRun, function* (t): TileStep {
        const level = t.level ?? pathLevelsAt(t.x, t.y)[0];
        if (level === undefined) {
            return { ok: false, cost: 0, raw: null, error: { code: "NOT_FOUND", message: `Aucun chemin en (${t.x},${t.y}).` } };
        }
        return yield* act("footpathadditionremove", { x: tileToWorld(t.x), y: tileToWorld(t.y), z: levelToZ(level) }, dryRun, { tile: t });
    });
}

// ---------------------------------------------------------------------------
// Scénerie
// ---------------------------------------------------------------------------

function colours(c: [number?, number?, number?] | undefined): { primaryColour: number; secondaryColour: number; tertiaryColour: number } {
    return { primaryColour: c?.[0] ?? 0, secondaryColour: c?.[1] ?? 0, tertiaryColour: c?.[2] ?? 0 };
}

export function* placeSmall(params: SceneryPlaceParams): Job {
    requireParkLoaded();
    const items = requireArray<SceneryPlaceParams["items"][number]>(params as never, "items", LIMITS.maxOpsPerRequest);
    const dryRun = !!params.dryRun;
    return yield* runBulk(items, dryRun, function* (it): TileStep {
        const obj = resolveLoaded(["small_scenery"], it.object).index;
        const quadrant = it.quadrant ?? 0;
        const direction = it.direction ?? 0;
        if (!isInt(quadrant) || quadrant < 0 || quadrant > 3) fail("INVALID_PARAMS", "'quadrant' : 0 à 3.");
        if (!isInt(direction) || direction < 0 || direction > 3) fail("INVALID_PARAMS", "'direction' : 0 à 3.");
        // z = 0 : hauteur automatique (surface ou eau), SmallSceneryPlaceAction.cpp
        const z = it.level != null ? levelToZ(levelOrFail(it.level)) : 0;
        return yield* act(
            "smallsceneryplace",
            { x: tileToWorld(it.x), y: tileToWorld(it.y), z, direction, quadrant, object: obj, ...colours(it.colours) },
            dryRun,
            { tile: { x: it.x, y: it.y } },
        );
    });
}

export function* placeLarge(params: LargeSceneryPlaceParams): Job {
    requireParkLoaded();
    const items = requireArray<LargeSceneryPlaceParams["items"][number]>(params as never, "items", LIMITS.maxOpsPerRequest);
    const dryRun = !!params.dryRun;
    return yield* runBulk(items, dryRun, function* (it): TileStep {
        const obj = resolveLoaded(["large_scenery"], it.object).index;
        const direction = it.direction ?? 0;
        const z = it.level != null ? levelToZ(levelOrFail(it.level)) : surfaceZ(it.x, it.y);
        return yield* act(
            "largesceneryplace",
            { x: tileToWorld(it.x), y: tileToWorld(it.y), z, direction, object: obj, ...colours(it.colours) },
            dryRun,
            { tile: { x: it.x, y: it.y } },
        );
    });
}

function surfaceZ(x: number, y: number): number {
    const els = map.getTile(x, y).elements;
    for (let i = 0; i < els.length; i++) if (els[i].type === "surface") return els[i].baseZ;
    return 0;
}

export function* placeWall(params: WallPlaceParams): Job {
    requireParkLoaded();
    const items = requireArray<WallPlaceParams["items"][number]>(params as never, "items", LIMITS.maxOpsPerRequest);
    const dryRun = !!params.dryRun;
    return yield* runBulk(items, dryRun, function* (it): TileStep {
        const obj = resolveLoaded(["wall"], it.object).index;
        if (!isInt(it.edge) || it.edge < 0 || it.edge > 3) fail("INVALID_PARAMS", "'edge' : 0 à 3.");
        const z = it.level != null ? levelToZ(levelOrFail(it.level)) : surfaceZ(it.x, it.y);
        return yield* act(
            "wallplace",
            { x: tileToWorld(it.x), y: tileToWorld(it.y), z, object: obj, edge: it.edge, ...colours(it.colours) },
            dryRun,
            { tile: { x: it.x, y: it.y } },
        );
    });
}

export function* removeSmall(params: SceneryRemoveSmallParams): Job {
    requireParkLoaded();
    const items = requireArray<SceneryRemoveSmallParams["items"][number]>(params as never, "items", LIMITS.maxOpsPerRequest);
    const dryRun = !!params.dryRun;
    return yield* runBulk(items, dryRun, function* (it): TileStep {
        const obj = resolveLoaded(["small_scenery"], it.object).index;
        return yield* act(
            "smallsceneryremove",
            { x: tileToWorld(it.x), y: tileToWorld(it.y), z: levelToZ(it.level), object: obj, quadrant: it.quadrant ?? 0 },
            dryRun,
            { tile: { x: it.x, y: it.y } },
        );
    });
}

export function* clearRegion(params: SceneryClearParams): Job {
    requireParkLoaded();
    const rect = normalizeRect({
        x1: requireInt(params as never, "x1"),
        y1: requireInt(params as never, "y1"),
        x2: requireInt(params as never, "x2"),
        y2: requireInt(params as never, "y2"),
    });
    const items = params.items ?? CLEAR_ITEMS.smallScenery | CLEAR_ITEMS.largeScenery | CLEAR_ITEMS.walls;
    const r = yield* act("clearscenery", { ...rectToWorldRange(rect), itemsToClear: items }, !!params.dryRun);
    return outcome(r);
}
