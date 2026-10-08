// Objets, captures, checkpoints, temps, lots.

import {
    LIMITS,
    checkActionArgs,
    tileCenterToWorld,
    type BatchOpResult,
    type BatchParams,
    type BatchResult,
    type CaptureParams,
    type CaptureResult,
    type ObjectInfo,
    type ObjectsListParams,
    type ObjectsListResult,
    type ObjectsLoadParams,
    type ObjectsLoadResult,
    type PieceSample,
    type TimeRunParams,
    type TimeStatus,
} from "@openrct2-claude/protocol";
import { act } from "../actions";
import { invalidateObjects } from "../objects";
import { NEXT_FRAME, type Job } from "../queue";
import { fail, isInt, log, requireArray, requireInt, requireParkLoaded, requireSafeName } from "../util";
import { capabilities, dateInfo } from "./session";
import type { Defer } from "./index";

// ---------------------------------------------------------------------------
// Objets
// ---------------------------------------------------------------------------

function extraOf(o: LoadedObject): Record<string, unknown> | undefined {
    switch (o.type) {
        case "ride": {
            const r = o as RideObject;
            return { rideType: r.rideType.filter((t) => t !== 255), carsPerFlatRide: r.carsPerFlatRide, shopItem: r.shopItem };
        }
        case "small_scenery": {
            const s = o as SmallSceneryObject;
            return { height: s.height, price: s.price, flags: s.flags };
        }
        case "large_scenery": {
            const l = o as LargeSceneryObject;
            return { tiles: l.tiles.length };
        }
        case "footpath_surface":
            return { flags: (o as FootpathSurfaceObject).flags };
    }
    return undefined;
}

/** Nom DAT (« ARRT1   ») sans espaces finaux, ou null. */
function legacyOf(id: string | null | undefined): string | null {
    if (!id) return null;
    const t = id.replace(/\s+$/, "");
    return t.length ? t : null;
}

export function* list(params: ObjectsListParams): Job {
    requireParkLoaded();
    const limit = Math.min(Math.max(params.limit ?? 25, 1), 200);
    const cursor = Math.max(params.cursor ?? 0, 0);
    const query = (params.query ?? "").toLowerCase();
    const loadedIndex: Record<string, { [identifier: string]: LoadedObject }> = {};
    const loadedOf = (type: ObjectType) => {
        if (!loadedIndex[type]) {
            const t: { [identifier: string]: LoadedObject } = {};
            for (const o of objectManager.getAllObjects(type)) if (o) t[o.identifier] = o;
            loadedIndex[type] = t;
        }
        return loadedIndex[type];
    };
    const matches: ObjectInfo[] = [];
    let total = 0;
    const accept = (identifier: string, name: string, legacy?: string | null) =>
        !query ||
        identifier.toLowerCase().indexOf(query) >= 0 ||
        name.toLowerCase().indexOf(query) >= 0 ||
        (!!legacy && legacy.toLowerCase().indexOf(query) >= 0);

    if (params.loadedOnly) {
        if (!params.type) fail("INVALID_PARAMS", "'type' est obligatoire avec loadedOnly.");
        const all = objectManager.getAllObjects(params.type as ObjectType);
        for (const o of all) {
            if (!o || !accept(o.identifier, o.name, o.legacyIdentifier)) continue;
            if (total >= cursor && matches.length < limit) {
                matches.push({ identifier: o.identifier, name: o.name, type: o.type, loaded: true, index: o.index, legacyIdentifier: legacyOf(o.legacyIdentifier), extra: extraOf(o) });
            }
            total++;
        }
    } else {
        const installed = objectManager.installedObjects;
        yield;
        for (let i = 0; i < installed.length; i++) {
            const o = installed[i];
            if (params.type && o.type !== params.type) continue;
            if (!accept(o.identifier, o.name, o.legacyIdentifier)) continue;
            if (total >= cursor && matches.length < limit) {
                const loaded = loadedOf(o.type)[o.identifier];
                matches.push({
                    identifier: o.identifier,
                    name: o.name,
                    type: o.type,
                    loaded: !!loaded,
                    index: loaded ? loaded.index : null,
                    legacyIdentifier: legacyOf(o.legacyIdentifier),
                    sourceGames: o.sourceGames,
                    extra: loaded ? extraOf(loaded) : undefined,
                });
            }
            total++;
            if (i % 2000 === 1999) yield;
        }
    }
    const next = cursor + matches.length;
    const result: ObjectsListResult = { items: matches, total, nextCursor: next < total ? next : null };
    return result;
}

export function* load(params: ObjectsLoadParams): Job {
    requireParkLoaded();
    const ids = requireArray<string>(params as never, "identifiers", 100);
    const results: ObjectsLoadResult["results"] = [];
    for (const id of ids) {
        if (typeof id !== "string") {
            results.push({ identifier: String(id), ok: false, index: null, type: null, error: "identifiant invalide" });
            continue;
        }
        const installed = objectManager.getInstalledObject(id);
        if (!installed) {
            results.push({ identifier: id, ok: false, index: null, type: null, error: "objet non installé" });
            continue;
        }
        let loaded: LoadedObject | null = null;
        try {
            loaded = objectManager.load(id);
        } catch (e) {
            results.push({ identifier: id, ok: false, index: null, type: installed.type, error: String(e) });
            continue;
        }
        results.push(
            loaded
                ? { identifier: id, ok: true, index: loaded.index, type: loaded.type }
                : { identifier: id, ok: false, index: null, type: installed.type, error: "chargement refusé (emplacements pleins ?)" },
        );
        yield;
    }
    invalidateObjects();
    return { results };
}

export function* unload(params: { identifiers: string[] }): Job {
    requireParkLoaded();
    const ids = requireArray<string>(params as never, "identifiers", 100);
    objectManager.unload(ids);
    invalidateObjects();
    return { ok: true };
}

// ---------------------------------------------------------------------------
// Captures (SPEC 6.7)
// ---------------------------------------------------------------------------

export function* capture(params: CaptureParams): Job {
    requireParkLoaded();
    if (!capabilities().captureImage) {
        fail("NOT_SUPPORTED_IN_MODE", "captureImage indisponible (jeu sans fenêtre ?).", { details: { fallback: "cli_screenshot" } });
    }
    const name = requireSafeName(params as never, "name");
    const zoom = params.zoom ?? 0;
    const rotation = params.rotation ?? 0;
    if (!isInt(zoom) || zoom < 0 || zoom > 5) fail("INVALID_PARAMS", "'zoom' : 0 à 5.");
    if (!isInt(rotation) || rotation < 0 || rotation > 3) fail("INVALID_PARAMS", "'rotation' : 0 à 3.");
    const filename = `${name}.png`;
    const options: CaptureOptions = { filename, zoom, rotation, transparent: !!params.transparent };
    if (params.center) {
        const width = params.width ?? 1280;
        const height = params.height ?? 720;
        if (!isInt(width) || !isInt(height) || width < 64 || height < 64 || width > 4096 || height > 4096) {
            fail("INVALID_PARAMS", "'width'/'height' : 64 à 4096.");
        }
        options.width = width;
        options.height = height;
        options.position = { x: tileCenterToWorld(params.center.x), y: tileCenterToWorld(params.center.y) };
    }
    try {
        context.captureImage(options);
    } catch (e) {
        fail("NOT_SUPPORTED_IN_MODE", `captureImage a échoué : ${e}`, { details: { fallback: "cli_screenshot" } });
    }
    const result: CaptureResult = { filename, width: options.width ?? null, height: options.height ?? null };
    return result;
}

// ---------------------------------------------------------------------------
// Checkpoints (SPEC 6.8)
// ---------------------------------------------------------------------------

export function* checkpointSave(params: { name: string }): Job {
    requireParkLoaded();
    const name = requireSafeName(params as never, "name");
    try {
        context.saveGame({ filename: name });
    } catch (e) {
        // En mode serveur (host --headless), saveGame lève « Game state is not mutable in this context » (SPIKES S1) :
        // repli sur la commande de console legacy (SPEC 6.8).
        if (typeof console.executeLegacy !== "function") fail("NOT_SUPPORTED_IN_MODE", `saveGame a échoué : ${e}`);
        log(`saveGame a échoué (${e}) : repli sur save_park`);
        console.executeLegacy(`save_park ${name}`);
    }
    return { filename: `${name}.park` };
}

/** Le chargement est différé à la frame suivante pour répondre avant le changement de carte. */
export function* checkpointRestore(params: { name: string }, deferred: Defer): Job {
    const name = params.name;
    const safe = typeof name === "string" && (/^[a-zA-Z0-9_-]{1,64}$/.test(name) || /^\/[^\s"'`;|&$<>]+\.park$/.test(name));
    if (!safe) fail("INVALID_PARAMS", "'name' : nom de sauvegarde ou chemin absolu .park sans espaces.");
    if (typeof console.executeLegacy !== "function") fail("NOT_SUPPORTED_IN_MODE", "console.executeLegacy indisponible.");
    deferred(
        () => {
            log(`load_park ${name}`);
            console.executeLegacy(`load_park ${name}`);
        },
        { changesMap: true },
    );
    return { requested: name };
}

// ---------------------------------------------------------------------------
// Temps
// ---------------------------------------------------------------------------

function timeStatus(): TimeStatus {
    return { paused: context.paused, gameSpeed: context.gameSpeed, date: dateInfo() };
}

export function* status(): Job {
    requireParkLoaded();
    return timeStatus();
}

export function* run(params: TimeRunParams): Job {
    requireParkLoaded();
    const ticks = requireInt(params as never, "ticks", 1, 40 * 60 * 10);
    const wasPaused = context.paused;
    const previousSpeed = context.gameSpeed;
    if (params.speed !== undefined) {
        const speed = requireInt(params as never, "speed", 1, 4);
        yield* act("gamesetspeed", { speed }, false);
    }
    if (context.paused) context.paused = false;
    const sampleRide = params.sample && isInt(params.sample.ride) ? params.sample.ride : null;
    const samples = new Map<string, PieceSample>();
    const start = date.ticksElapsed;
    while (date.ticksElapsed - start < ticks) {
        if (context.mode !== "normal") fail("BUSY", "Carte changée pendant time.run.");
        if (context.paused) context.paused = false;
        if (sampleRide !== null) sampleTrain(sampleRide, samples);
        yield NEXT_FRAME;
    }
    const ticksRun = date.ticksElapsed - start;
    if (context.gameSpeed !== previousSpeed) yield* act("gamesetspeed", { speed: previousSpeed }, false);
    const pauseAfter = params.pauseAfter ?? wasPaused;
    if (pauseAfter) context.paused = true;
    if (sampleRide === null) return { ...timeStatus(), ticksRun };
    // Pièces vues seulement par les voitures suivantes : pas de vitesse de tête (JSON n'a pas d'Infinity).
    const out = Array.from(samples.values()).map((s) => ({
        ...s,
        vFirst: Math.max(s.vFirst, 0),
        vMin: isFinite(s.vMin) ? s.vMin : 0,
        gVertMax: isFinite(s.gVertMax) ? s.gVertMax : 0,
        gVertMin: isFinite(s.gVertMin) ? s.gVertMin : 0,
    }));
    return { ...timeStatus(), ticksRun, samples: out };
}

/** Vitesse interne (mph × 65536) en mph. */
const MPH = 65536;

function pieceSample(map: Map<string, PieceSample>, loc: CarTrackLocation): PieceSample {
    const key = `${loc.x},${loc.y},${loc.z},${loc.direction},${loc.trackType}`;
    let s = map.get(key);
    if (!s) {
        s = { x: loc.x, y: loc.y, z: loc.z, direction: loc.direction, trackType: loc.trackType, n: 0, vFirst: -1, vMin: Infinity, vMax: 0, gVertMax: -Infinity, gVertMin: Infinity, gLatMax: 0 };
        map.set(key, s);
    }
    return s;
}

/** Relevé d'une frame : vitesse de la tête du premier train sur sa pièce, G de chaque voiture sur la sienne. */
function sampleTrain(rideId: number, map: Map<string, PieceSample>): void {
    const ride = map_getRide(rideId);
    if (!ride || !ride.vehicles.length) return;
    let car = map_getCar(ride.vehicles[0]);
    if (!car) return;
    const v = Math.abs(car.velocity) / MPH;
    const head = pieceSample(map, car.trackLocation);
    head.n++;
    if (head.vFirst < 0) head.vFirst = v;
    head.vMin = Math.min(head.vMin, v);
    head.vMax = Math.max(head.vMax, v);
    for (let i = 0; car && i < 16; i++) {
        const s = pieceSample(map, car.trackLocation);
        const g = car.gForces;
        s.gVertMax = Math.max(s.gVertMax, g.verticalG / 100);
        s.gVertMin = Math.min(s.gVertMin, g.verticalG / 100);
        s.gLatMax = Math.max(s.gLatMax, Math.abs(g.lateralG) / 100);
        car = car.nextCarOnTrain === null ? null : map_getCar(car.nextCarOnTrain);
    }
}

function map_getRide(id: number): Ride | null {
    return map.getRide(id);
}

function map_getCar(id: number): Car | null {
    const e = map.getEntity(id);
    return e && e.type === "car" ? (e as Car) : null;
}

// ---------------------------------------------------------------------------
// Lots (SPEC 7.4)
// ---------------------------------------------------------------------------

export function* batch(params: BatchParams): Job {
    requireParkLoaded();
    const ops = requireArray<BatchParams["ops"][number]>(params as never, "ops", LIMITS.maxOpsPerRequest);
    const dryRun = !!params.dryRun;
    const results: BatchOpResult[] = [];
    let totalCost = 0;
    let firstFailureIndex: number | null = null;
    for (let i = 0; i < ops.length; i++) {
        const op = ops[i];
        if (!op || typeof op.action !== "string" || typeof op.args !== "object" || op.args === null) {
            results.push({ index: i, ok: false, error: { code: "INVALID_PARAMS", message: "Opération invalide : { action, args } attendu." } });
        } else {
            const check = checkActionArgs(op.action, op.args);
            if (check.known && (check.missing.length || check.wrongType.length)) {
                results.push({
                    index: i,
                    ok: false,
                    error: { code: "INVALID_PARAMS", message: `${op.action} : arguments invalides.`, details: { missing: check.missing, wrongType: check.wrongType, expected: check.expected } },
                });
            } else {
                const r = yield* act(op.action, op.args, dryRun);
                const res: BatchOpResult = r.ok ? { index: i, ok: true, cost: r.cost } : { index: i, ok: false, error: r.error };
                if (r.ok && r.raw) {
                    const data: Record<string, unknown> = {};
                    for (const k of ["ride", "peep", "bannerIndex", "position"]) if (r.raw[k] !== undefined) data[k] = r.raw[k];
                    if (Object.keys(data).length) res.data = data;
                }
                if (r.ok) totalCost += r.cost;
                results.push(res);
            }
        }
        const last = results[results.length - 1];
        if (!last.ok && firstFailureIndex === null) {
            firstFailureIndex = i;
            if (params.stopOnError) break;
        }
        yield;
    }
    const result: BatchResult = { dryRun, results, totalCost, firstFailureIndex };
    return result;
}
