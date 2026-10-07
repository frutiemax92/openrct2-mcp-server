// Implémentation des méthodes du protocole sur le monde simulé.

import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import {
    CHEAT_TYPES,
    GAME_STATUS,
    PLUGIN_VERSION,
    PROTOCOL_VERSION,
    RIDE_SETTINGS,
    RIDE_TYPES,
    checkActionArgs,
    gameErrorToBridgeError,
    normalizeRect,
    type ActionOutcome,
    type BridgeError,
    type BulkResult,
    type Direction,
    type MethodName,
    type ObjectInfo,
    type RideSummary,
    type TileOutcome,
} from "@openrct2-claude/protocol";
import { World, type FakeRide, type FakeTile } from "./world.js";

export class FakeError extends Error {
    constructor(public readonly error: BridgeError) {
        super(error.message);
    }
}

const fail = (code: BridgeError["code"], message: string, hint?: string): never => {
    throw new FakeError({ code, message, hint });
};

const gameFail = (action: string, status: number, title: string, message: string): ActionOutcome => ({
    ok: false,
    cost: 0,
    error: gameErrorToBridgeError(action, { error: status, errorTitle: title, errorMessage: message }),
});

const OK = (cost = 0): ActionOutcome => ({ ok: true, cost });

export interface FakeOptions {
    userDir?: string;
    onMapChanged?: () => void;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Params = any;

export class FakeGame {
    world: World;
    /** Journal des appels reçus (pour les tests). */
    calls: { method: string; params: unknown }[] = [];

    constructor(
        world = new World(),
        private readonly opts: FakeOptions = {},
    ) {
        this.world = world;
    }

    get sandbox(): boolean {
        return this.world.cheats.sandboxMode === true;
    }

    private buildCheck(action: string, x: number, y: number, needOwned = true): ActionOutcome | null {
        const w = this.world;
        if (!w.inMap(x, y)) return gameFail(action, GAME_STATUS.invalidParameters, "Can't build this here...", "Off edge of map!");
        if (w.paused && !w.cheats.buildInPauseMode) return gameFail(action, GAME_STATUS.gamePaused, "Can't build this here...", "Construction not possible while game is paused!");
        if (needOwned && !this.sandbox && !(w.tile(x, y).o & 1)) return gameFail(action, GAME_STATUS.notOwned, "Can't build this here...", "Land not owned by park!");
        return null;
    }

    private spend(cost: number, dryRun: boolean): ActionOutcome | null {
        if (!this.sandbox && this.world.cash < cost) return gameFail("", GAME_STATUS.insufficientFunds, "Can't do this...", `Not enough cash - requires ${cost}`);
        if (!dryRun && !this.sandbox) this.world.cash -= cost;
        return null;
    }

    private bulk<T extends { x: number; y: number }>(items: T[], dryRun: boolean, fn: (it: T) => ActionOutcome & { level?: number }): BulkResult {
        const results: TileOutcome[] = [];
        let placed = 0;
        let failed = 0;
        let totalCost = 0;
        for (const it of items) {
            let r: ActionOutcome & { level?: number };
            try {
                r = fn(it);
            } catch (e) {
                r = { ok: false, error: e instanceof FakeError ? e.error : { code: "INTERNAL", message: String(e) } };
            }
            results.push({ x: it.x, y: it.y, ...r });
            if (r.ok) {
                placed++;
                totalCost += r.cost ?? 0;
            } else failed++;
        }
        return { dryRun, results, placed, failed, totalCost };
    }

    private ride(id: number): FakeRide {
        const r = this.world.rides.find((r) => r.id === id);
        if (!r) fail("NOT_FOUND", `Attraction ${id} introuvable.`);
        return r!;
    }

    private rideSummary(r: FakeRide): RideSummary {
        return {
            id: r.id,
            name: r.name,
            type: r.type,
            classification: r.classification,
            status: r.status,
            object: r.object,
            excitement: r.excitement >= 0 ? r.excitement / 100 : null,
            intensity: r.intensity >= 0 ? r.intensity / 100 : null,
            nausea: r.nausea >= 0 ? r.nausea / 100 : null,
            price: r.price,
            stations: r.origin
                ? [
                      {
                          index: 0,
                          start: { x: r.origin.x, y: r.origin.y, level: r.origin.l },
                          length: 1,
                          entrance: r.entrance ? { x: r.entrance.x, y: r.entrance.y, level: r.entrance.l, direction: r.entrance.direction } : null,
                          exit: r.exit ? { x: r.exit.x, y: r.exit.y, level: r.exit.l, direction: r.exit.direction } : null,
                      },
                  ]
                : [],
        };
    }

    private objInfo(o: { identifier: string; name: string; type: string; extra?: Record<string, unknown> }): ObjectInfo {
        const idx = this.world.loadedIndex(o.type, o.identifier);
        return { identifier: o.identifier, name: o.name, type: o.type, loaded: idx !== null, index: idx, extra: o.extra };
    }

    private removeRide(r: FakeRide): void {
        const w = this.world;
        for (const t of w.tiles) {
            t.tracks = t.tracks.filter((k) => k.ride !== r.id);
            t.entrances = t.entrances.filter((e) => e.k === 2 || e.r !== r.id);
            for (const p of t.paths) if (p.r === r.id) p.r = -1;
        }
        w.rides = w.rides.filter((x) => x.id !== r.id);
        for (let y = 0; y < w.sizeY; y++) for (let x = 0; x < w.sizeX; x++) if (w.tile(x, y).paths.length) w.recomputeEdges(x, y);
    }

    private snapshot(): string {
        const w = this.world;
        return JSON.stringify({ tiles: w.tiles, rides: w.rides, cheats: w.cheats, cash: w.cash, parkName: w.parkName, loaded: [...w.loaded.entries()], nextRideId: w.nextRideId });
    }

    private restore(json: string): void {
        const d = JSON.parse(json);
        const w = this.world;
        w.tiles = d.tiles;
        w.rides = d.rides;
        w.cheats = d.cheats;
        w.cash = d.cash;
        w.parkName = d.parkName;
        w.loaded = new Map(d.loaded);
        w.nextRideId = d.nextRideId;
    }

    handle(method: MethodName | string, p: Params): unknown {
        this.calls.push({ method, params: p });
        const w = this.world;
        switch (method) {
            case "session.hello":
                return {
                    pluginVersion: PLUGIN_VERSION,
                    protocolVersion: PROTOCOL_VERSION,
                    apiVersion: 124,
                    networkMode: "none",
                    gameMode: "normal",
                    headless: false,
                    mapSize: { x: w.sizeX, y: w.sizeY },
                    capabilities: { captureImage: !!this.opts.userDir, directEdit: true, consoleLegacy: true, saveLoad: true, trackSegments: true, pathNavigator: true },
                };
            case "session.info":
                return {
                    pluginVersion: PLUGIN_VERSION,
                    apiVersion: 124,
                    networkMode: "none",
                    gameMode: "normal",
                    paused: w.paused,
                    gameSpeed: w.gameSpeed,
                    mapSize: { x: w.sizeX, y: w.sizeY },
                    park: { name: w.parkName, cash: w.cash, rating: 500, guests: 0, date: { day: 1, month: 0, year: 1, ticksElapsed: w.ticks, monthsElapsed: 0 } },
                    cheats: { ...w.cheats },
                    queue: { pending: 0 },
                };
            case "session.ping":
                return { pong: true, tick: w.ticks };
            case "session.set_paused":
                w.paused = !!p.paused;
                return { paused: w.paused };
            case "session.cheats.get":
                return { ...w.cheats };
            case "session.cheats.set": {
                const results: ActionOutcome[] = [];
                for (const it of p.items) {
                    const name = typeof it.cheat === "string" ? it.cheat : Object.entries(CHEAT_TYPES).find(([, v]) => v === it.cheat)?.[0];
                    if (!name || !(name in CHEAT_TYPES)) fail("INVALID_PARAMS", `Cheat inconnu : ${it.cheat}.`);
                    if (name === "ownAllLand") for (const t of w.tiles) t.o = 1;
                    else if (name === "setMoney") w.cash = it.param1 ?? 0;
                    else w.cheats[name!] = (it.param1 ?? 0) !== 0;
                    results.push(OK());
                }
                return { results };
            }
            case "park.overview":
                return {
                    name: w.parkName,
                    cash: w.cash,
                    bankLoan: w.loan,
                    maxBankLoan: 200_000,
                    rating: 500,
                    guests: 0,
                    suggestedGuestMaximum: 0,
                    entranceFee: w.entranceFee,
                    value: 0,
                    companyValue: 0,
                    parkSize: w.tiles.filter((t) => t.o & 1).length,
                    date: { day: 1, month: 0, year: 1, ticksElapsed: w.ticks, monthsElapsed: 0 },
                    isOpen: w.parkOpen,
                    rides: { total: w.rides.length, open: w.rides.filter((r) => r.status === "open").length, broken: 0, brokenIds: [] },
                    topThoughts: [],
                    happiness: null,
                };
            case "park.set": {
                const results: Record<string, ActionOutcome> = {};
                if (p.name !== undefined) {
                    if (!p.dryRun) w.parkName = p.name;
                    results.name = OK();
                }
                if (p.entranceFee !== undefined) {
                    if (!p.dryRun) w.entranceFee = p.entranceFee;
                    results.entranceFee = OK();
                }
                if (p.loan !== undefined) {
                    if (!p.dryRun) {
                        w.cash += p.loan - w.loan;
                        w.loan = p.loan;
                    }
                    results.loan = OK();
                }
                if (p.open !== undefined) {
                    if (!p.dryRun) w.parkOpen = p.open;
                    results.open = OK();
                }
                return { results };
            }
            case "park.entrance_place": {
                if (!this.sandbox) return gameFail("parkentranceplace", GAME_STATUS.notInEditorMode, "Can't build this here...", "");
                const d = p.direction as Direction;
                const side = ((d + 1) & 3) as Direction;
                const tiles = [
                    { x: p.x, y: p.y, seq: 0 },
                    { x: p.x + DIR(side).x, y: p.y + DIR(side).y, seq: 1 },
                    { x: p.x - DIR(side).x, y: p.y - DIR(side).y, seq: 2 },
                ];
                for (const t of tiles) {
                    if (!w.inMap(t.x, t.y)) return gameFail("parkentranceplace", GAME_STATUS.invalidParameters, "Can't build this here...", "Off edge of map!");
                    const ft = w.tile(t.x, t.y);
                    if (ft.paths.length || ft.tracks.length || ft.entrances.length) return gameFail("parkentranceplace", GAME_STATUS.noClearance, "Can't build this here...", "Footpath in the way");
                }
                if (!p.dryRun) {
                    for (const t of tiles) w.tile(t.x, t.y).entrances.push({ k: 2, d, r: 0, st: 0, l: p.level, seq: t.seq });
                    for (const t of tiles) w.recomputeEdges(t.x, t.y);
                }
                return OK(0);
            }
            case "park.spawn_place":
                if (!this.sandbox) return gameFail("peepspawnplace", GAME_STATUS.notInEditorMode, "", "");
                if (!p.dryRun) w.spawns.push({ x: p.x, y: p.y, l: p.level, d: p.direction });
                return OK();
            case "map.size":
                return { x: w.sizeX, y: w.sizeY };
            case "map.region": {
                const r = normalizeRect(p);
                r.x1 = Math.max(0, r.x1);
                r.y1 = Math.max(0, r.y1);
                r.x2 = Math.min(w.sizeX - 1, r.x2);
                r.y2 = Math.min(w.sizeY - 1, r.y2);
                const tiles = [];
                for (let y = r.y1; y <= r.y2; y++) for (let x = r.x1; x <= r.x2; x++) tiles.push(w.regionTile(x, y));
                return { rect: r, tiles };
            }
            case "map.tile": {
                if (!w.inMap(p.x, p.y)) fail("INVALID_PARAMS", "Tuile hors de la carte.");
                const t = w.tile(p.x, p.y);
                const elements: Record<string, unknown>[] = [{ type: "surface", level: t.h, slope: t.s, waterLevel: t.w, ownership: t.o }];
                for (const q of t.paths) elements.push({ type: "footpath", level: q.l, isQueue: q.q, edges: q.e, slopeDirection: q.sd, objectIdentifier: q.object });
                for (const k of t.tracks) elements.push({ type: "track", level: k.l, ride: k.ride, trackType: k.trackType, direction: k.direction, sequence: k.seq });
                for (const e of t.entrances) elements.push({ type: "entrance", level: e.l, kind: ["ride_entrance", "ride_exit", "park_entrance"][e.k], ride: e.r, direction: e.d });
                for (const s of t.small) elements.push({ type: "small_scenery", level: s.l, objectIdentifier: s.object, quadrant: s.quadrant, direction: s.direction });
                return { x: p.x, y: p.y, elements: elements.map((e, i) => ({ index: i, clearanceLevel: (e.level as number) + 1, baseHeight: (e.level as number) * 2, isGhost: false, ...e })) };
            }
            case "map.ownership.set": {
                if (p.mode === "own_all") {
                    if (!p.dryRun) for (const t of w.tiles) t.o = 1;
                    return OK();
                }
                if ((p.mode === "set_owned" || p.mode === "set_rights" || p.mode === "set_unowned") && !this.sandbox) {
                    return gameFail("landsetrights", GAME_STATUS.notInEditorMode, "", "Land not for sale!");
                }
                const r = normalizeRect(p);
                let cost = 0;
                for (let y = r.y1; y <= r.y2; y++)
                    for (let x = r.x1; x <= r.x2; x++) {
                        if (!w.inMap(x, y)) continue;
                        const t = w.tile(x, y);
                        if (!p.dryRun) t.o = p.mode === "set_unowned" ? 0 : p.mode === "set_rights" || p.mode === "buy_rights" ? 2 : 1;
                        cost += p.mode.startsWith("buy") ? 20 : 0;
                    }
                return OK(cost);
            }
            case "terrain.set_heights":
                return this.bulk(p.tiles, !!p.dryRun, (t: Params) => {
                    const f = this.buildCheck("landsetheight", t.x, t.y);
                    if (f) return f;
                    const ft = w.tile(t.x, t.y);
                    if (ft.tracks.length || ft.entrances.length) return gameFail("landsetheight", GAME_STATUS.noClearance, "Can't change land height here...", "Ride in the way");
                    if (ft.paths.length) return gameFail("landsetheight", GAME_STATUS.noClearance, "Can't change land height here...", "Footpath in the way");
                    const cost = Math.abs(ft.h - t.level) * 10 + 5;
                    const s = this.spend(cost, !!p.dryRun);
                    if (s) return s;
                    if (!p.dryRun) {
                        ft.h = t.level;
                        ft.s = t.slope ?? 0;
                        ft.small = [];
                    }
                    return { ...OK(cost), level: t.level };
                });
            case "terrain.set_surface": {
                const r = normalizeRect(p);
                const idx = p.surfaceObject != null ? w.loadedIndex("terrain_surface", p.surfaceObject) : null;
                if (p.surfaceObject != null && idx === null) fail("OBJECT_NOT_LOADED", `Objet ${p.surfaceObject} non chargé.`);
                if (!p.dryRun && idx !== null) for (let y = r.y1; y <= r.y2; y++) for (let x = r.x1; x <= r.x2; x++) if (w.inMap(x, y)) w.tile(x, y).t = idx;
                return OK(0);
            }
            case "terrain.set_water": {
                const r = normalizeRect(p);
                const tiles = [];
                for (let y = r.y1; y <= r.y2; y++) for (let x = r.x1; x <= r.x2; x++) tiles.push({ x, y });
                return this.bulk(tiles, !!p.dryRun, (t) => {
                    if (!p.dryRun) w.tile(t.x, t.y).w = p.level;
                    return OK(5);
                });
            }
            case "path.place_tiles": {
                const queue = !!p.queue;
                const surfaces = w.loaded.get("footpath_surface") ?? [];
                const object = p.object ?? surfaces.find((o) => ((o.extra?.flags as number) & 8) === (queue ? 8 : 0))?.identifier;
                if (!object || w.loadedIndex("footpath_surface", object) === null) fail("OBJECT_NOT_LOADED", `Objet de chemin ${p.object} non chargé.`);
                return this.bulk(p.tiles, !!p.dryRun, (t: Params) => {
                    const f = this.buildCheck("footpathplace", t.x, t.y);
                    if (f) return f;
                    const ft = w.tile(t.x, t.y);
                    if (t.level < ft.h) return gameFail("footpathplace", GAME_STATUS.tooLow, "Can't build footpath here...", "Too low!");
                    if (ft.tracks.some((k) => Math.abs(k.l - t.level) < 2) || ft.entrances.some((e) => Math.abs(e.l - t.level) < 2)) {
                        return gameFail("footpathplace", GAME_STATUS.noClearance, "Can't build footpath here...", "Ride in the way");
                    }
                    if (ft.small.some((s) => Math.abs(s.l - t.level) < 2) || ft.large.length) {
                        return gameFail("footpathplace", GAME_STATUS.noClearance, "Can't build footpath here...", "Tree in the way");
                    }
                    const sd = t.slopeDirection ?? null;
                    if (t.level === ft.h && ft.s !== 0 && sd === null) return gameFail("footpathplace", GAME_STATUS.disallowed, "Can't build footpath here...", "Land slope unsuitable");
                    const existing = ft.paths.find((q) => q.l === t.level);
                    const s = this.spend(12, !!p.dryRun);
                    if (s) return s;
                    if (!p.dryRun) {
                        if (existing) {
                            existing.q = queue;
                            existing.sd = sd;
                            existing.object = object!;
                        } else ft.paths.push({ l: t.level, q: queue, sd, e: 0, object: object!, r: -1, a: null });
                        w.recomputeEdges(t.x, t.y);
                    }
                    return { ...OK(12), level: t.level };
                });
            }
            case "path.remove_tiles":
                return this.bulk(p.tiles, !!p.dryRun, (t: Params) => {
                    const ft = w.tile(t.x, t.y);
                    const match = ft.paths.filter((q) => t.level == null || q.l === t.level);
                    if (!match.length) return { ok: false, error: { code: "NOT_FOUND", message: `Aucun chemin en (${t.x},${t.y}).` } };
                    if (!p.dryRun) {
                        ft.paths = ft.paths.filter((q) => !match.includes(q));
                        w.recomputeEdges(t.x, t.y);
                    }
                    return OK(-5);
                });
            case "path.place_addition": {
                if (w.loadedIndex("footpath_addition", p.object) === null) fail("OBJECT_NOT_LOADED", `Objet ${p.object} non chargé.`);
                return this.bulk(p.tiles, !!p.dryRun, (t: Params) => {
                    const q = w.tile(t.x, t.y).paths[0];
                    if (!q) return { ok: false, error: { code: "NOT_FOUND", message: "Aucun chemin." } };
                    if (q.e === 15) return gameFail("footpathadditionplace", GAME_STATUS.invalidParameters, "Can't position this here...", "Can only be placed on path edges!");
                    if (!p.dryRun) q.a = String(p.object);
                    return OK(10);
                });
            }
            case "path.remove_addition":
                return this.bulk(p.tiles, !!p.dryRun, (t: Params) => {
                    const q = w.tile(t.x, t.y).paths[0];
                    if (!q?.a) return { ok: false, error: { code: "NOT_FOUND", message: "Aucune addition." } };
                    if (!p.dryRun) q.a = null;
                    return OK(-5);
                });
            case "ride.list":
                return { rides: w.rides.map((r) => this.rideSummary(r)) };
            case "ride.get": {
                const r = this.ride(p.id);
                return {
                    ...this.rideSummary(r),
                    mode: 0,
                    totalCustomers: 0,
                    age: 0,
                    runningCost: 0,
                    totalProfit: 0,
                    value: 0,
                    downtime: 0,
                    reliability: 100,
                    breakdown: null,
                    satisfaction: 0,
                    queueTime: [0],
                    stats: { maxSpeed: 0, averageSpeed: 0, rideTime: 0, rideLength: 0, maxPositiveVerticalGs: 0, maxNegativeVerticalGs: 0, maxLateralGs: 0, totalAirTime: 0, numDrops: 0, numLiftHills: 0, highestDropHeight: 0 },
                    inspectionInterval: r.settings[RIDE_SETTINGS.inspectionInterval] ?? 2,
                    minimumWaitingTime: 0,
                    maximumWaitingTime: 0,
                    vehicles: 1,
                };
            }
            case "ride.create": {
                const obj = w.loadedObject("ride", p.object);
                if (!obj) fail("OBJECT_NOT_LOADED", `Objet ${p.object} non chargé.`);
                const rideType = p.rideType ?? (obj!.extra?.rideType as number[])[0];
                if (p.dryRun) return { rideId: null, rideType, cost: 0, dryRun: true };
                const id = w.nextRideId++;
                const info = RIDE_TYPES.find((r) => r.rideType === rideType);
                w.rides.push({
                    id,
                    name: `${obj!.name} ${id + 1}`,
                    type: rideType,
                    object: obj!.identifier,
                    classification: w.rideClassification(rideType),
                    status: "closed",
                    price: [info?.category === "shop" ? 15 : 10],
                    origin: null,
                    trackType: null,
                    entrance: null,
                    exit: null,
                    excitement: -1,
                    intensity: -1,
                    nausea: -1,
                    settings: {},
                });
                return { rideId: id, rideType, cost: 0, dryRun: false };
            }
            case "track.footprint":
                return { tiles: w.footprint(p.trackType, p.x, p.y, p.direction) };
            case "track.segment":
                return null;
            case "ride.place_track": {
                const r = this.ride(p.ride);
                const fp = w.footprint(p.trackType, p.x, p.y, p.direction);
                for (const t of fp) {
                    const f = this.buildCheck("trackplace", t.x, t.y);
                    if (f) return { ...f, footprint: fp };
                    const ft = w.tile(t.x, t.y);
                    if (ft.h > p.level || (ft.h === p.level && ft.s)) return { ...gameFail("trackplace", GAME_STATUS.disallowed, "Can't build this here...", "Raise or lower land first"), footprint: fp };
                    if (ft.paths.length || ft.tracks.length || ft.entrances.length) return { ...gameFail("trackplace", GAME_STATUS.noClearance, "Can't build this here...", "Footpath in the way"), footprint: fp };
                }
                const cost = 100 * fp.length;
                const s = this.spend(cost, !!p.dryRun);
                if (s) return { ...s, footprint: fp };
                if (!p.dryRun) {
                    fp.forEach((t, i) => {
                        const ft = w.tile(t.x, t.y);
                        ft.small = [];
                        ft.tracks.push({ ride: r.id, trackType: p.trackType, direction: p.direction, seq: i, l: p.level, origin: { x: p.x, y: p.y } });
                    });
                    r.origin = { x: p.x, y: p.y, l: p.level, direction: p.direction };
                    r.trackType = p.trackType;
                    for (const t of fp) w.recomputeEdges(t.x, t.y);
                }
                return { ...OK(cost), footprint: fp };
            }
            case "ride.place_entrance_exit": {
                const r = this.ride(p.ride);
                if (!r.origin) return gameFail("rideentranceexitplace", GAME_STATUS.invalidParameters, "", "No station");
                if (r.status !== "closed") return gameFail("rideentranceexitplace", GAME_STATUS.notClosed, "", "Ride must be closed first");
                const f = this.buildCheck("rideentranceexitplace", p.x, p.y);
                if (f) return f;
                const ft = w.tile(p.x, p.y);
                if (ft.h > r.origin.l) return gameFail("rideentranceexitplace", GAME_STATUS.disallowed, "", "Raise or lower land first");
                if (ft.paths.length || ft.tracks.length || ft.entrances.length) return gameFail("rideentranceexitplace", GAME_STATUS.noClearance, "", "Footpath in the way");
                if (!p.dryRun) {
                    const kind = p.isExit ? 1 : 0;
                    const prev = p.isExit ? r.exit : r.entrance;
                    if (prev) {
                        const pt = w.tile(prev.x, prev.y);
                        pt.entrances = pt.entrances.filter((e) => !(e.r === r.id && e.k === kind));
                        w.recomputeEdges(prev.x, prev.y);
                    }
                    ft.small = [];
                    ft.entrances.push({ k: kind as 0 | 1, d: p.direction, r: r.id, st: 0, l: r.origin.l, seq: 0 });
                    const loc = { x: p.x, y: p.y, l: r.origin.l, direction: p.direction as Direction };
                    if (p.isExit) r.exit = loc;
                    else r.entrance = loc;
                    w.recomputeEdges(p.x, p.y);
                }
                return OK(50);
            }
            case "ride.set_status": {
                const r = this.ride(p.ride);
                if (p.status !== "closed" && r.classification === "ride" && (!r.entrance || !r.exit)) {
                    return gameFail("ridesetstatus", GAME_STATUS.disallowed, "Can't open ride...", r.entrance ? "Exit not yet built" : "Entrance not yet built");
                }
                r.status = p.status;
                if (p.status !== "closed" && r.excitement < 0) {
                    r.excitement = 180;
                    r.intensity = 120;
                    r.nausea = 90;
                }
                return OK();
            }
            case "ride.set_price":
                this.ride(p.ride).price[p.primary === false ? 1 : 0] = p.price;
                return OK();
            case "ride.set_setting": {
                const r = this.ride(p.ride);
                const setting = typeof p.setting === "string" ? (RIDE_SETTINGS as Record<string, number>)[p.setting] : p.setting;
                if (setting === undefined) fail("INVALID_PARAMS", `Réglage inconnu : ${p.setting}.`);
                r.settings[setting] = p.value;
                return OK();
            }
            case "ride.set_name":
                this.ride(p.ride).name = p.name;
                return OK();
            case "ride.demolish": {
                const r = this.ride(p.ride);
                if (!p.dryRun) this.removeRide(r);
                return OK(-50);
            }
            case "scenery.place_small":
                return this.bulk(p.items, !!p.dryRun, (it: Params) => {
                    if (w.loadedIndex("small_scenery", it.object) === null) fail("OBJECT_NOT_LOADED", `Objet ${it.object} non chargé.`, "load_objects");
                    const f = this.buildCheck("smallsceneryplace", it.x, it.y);
                    if (f) return f;
                    const ft = w.tile(it.x, it.y);
                    const l = it.level ?? ft.h;
                    const q = it.quadrant ?? 0;
                    if (ft.paths.some((x) => Math.abs(x.l - l) < 2) || ft.tracks.length || ft.entrances.length) {
                        return gameFail("smallsceneryplace", GAME_STATUS.noClearance, "Can't position this here...", "Footpath in the way");
                    }
                    // Un objet « tuile entière » (arbre) exclut tout autre objet au même niveau, quel que soit le quadrant.
                    const fullTile = !!(((w.loadedObject("small_scenery", it.object)?.extra?.flags as number) ?? 0) & 1);
                    const clash = ft.small.some((s) => Math.abs(s.l - l) < 2 && (s.fullTile || fullTile || s.quadrant === q));
                    if (clash) return gameFail("smallsceneryplace", GAME_STATUS.noClearance, "Can't position this here...", "Tree in the way");
                    const s = this.spend(10, !!p.dryRun);
                    if (s) return s;
                    if (!p.dryRun) ft.small.push({ object: String(it.object), fullTile, quadrant: q, direction: it.direction ?? 0, l });
                    return { ...OK(10), level: l };
                });
            case "scenery.remove_small":
                return this.bulk(p.items, !!p.dryRun, (it: Params) => {
                    const ft = w.tile(it.x, it.y);
                    const i = ft.small.findIndex((s) => s.l === it.level && s.quadrant === (it.quadrant ?? 0) && s.object === String(it.object));
                    if (i < 0) return { ok: false, error: { code: "NOT_FOUND", message: "Scénerie introuvable." } };
                    if (!p.dryRun) ft.small.splice(i, 1);
                    return OK(-2);
                });
            case "scenery.place_large":
            case "scenery.place_wall":
                return this.bulk(p.items, !!p.dryRun, () => OK(20));
            case "scenery.clear_region": {
                const r = normalizeRect(p);
                const items = p.items ?? 11;
                if (!p.dryRun)
                    for (let y = r.y1; y <= r.y2; y++)
                        for (let x = r.x1; x <= r.x2; x++) {
                            if (!w.inMap(x, y)) continue;
                            const t: FakeTile = w.tile(x, y);
                            if (items & 1) t.small = [];
                            if (items & 2) t.large = [];
                            if (items & 4) t.paths = [];
                            if (items & 8) t.walls = [];
                        }
                return OK(0);
            }
            case "objects.list": {
                const q = (p.query ?? "").toLowerCase();
                const src = p.loadedOnly ? (w.loaded.get(p.type) ?? []) : w.installed.filter((o) => !p.type || o.type === p.type);
                const all = src.filter((o) => !q || o.identifier.toLowerCase().includes(q) || o.name.toLowerCase().includes(q));
                const cursor = p.cursor ?? 0;
                const limit = p.limit ?? 25;
                const items = all.slice(cursor, cursor + limit).map((o) => this.objInfo(o));
                return { items, total: all.length, nextCursor: cursor + items.length < all.length ? cursor + items.length : null };
            }
            case "objects.load":
                return { results: p.identifiers.map((id: string) => ({ identifier: id, ...w.load(id) })) };
            case "objects.unload":
                return { ok: true };
            case "capture.view": {
                if (!this.opts.userDir) fail("NOT_SUPPORTED_IN_MODE", "captureImage indisponible.");
                const dir = join(this.opts.userDir!, "screenshot");
                mkdirSync(dir, { recursive: true });
                writeFileSync(join(dir, `${p.name}.png`), TINY_PNG);
                return { filename: `${p.name}.png`, width: p.width ?? null, height: p.height ?? null };
            }
            case "checkpoint.save": {
                if (!this.opts.userDir) fail("NOT_SUPPORTED_IN_MODE", "Pas de dossier utilisateur.");
                const dir = join(this.opts.userDir!, "save");
                mkdirSync(dir, { recursive: true });
                writeFileSync(join(dir, `${p.name}.park`), this.snapshot());
                return { filename: `${p.name}.park` };
            }
            case "checkpoint.restore": {
                const file = join(this.opts.userDir ?? "", "save", `${p.name}.park`);
                if (!existsSync(file)) fail("NOT_FOUND", "Sauvegarde introuvable.");
                setTimeout(() => {
                    this.restore(readFileSync(file, "utf8"));
                    this.opts.onMapChanged?.();
                }, 10);
                return { requested: p.name };
            }
            case "time.status":
                return { paused: w.paused, gameSpeed: w.gameSpeed, date: { day: 1, month: 0, year: 1, ticksElapsed: w.ticks, monthsElapsed: 0 } };
            case "time.run":
                w.ticks += p.ticks;
                return { paused: w.paused, gameSpeed: w.gameSpeed, date: { day: 1, month: 0, year: 1, ticksElapsed: w.ticks, monthsElapsed: 0 }, ticksRun: p.ticks };
            case "staff.hire": {
                if (!["handyman", "mechanic", "security", "entertainer"].includes(p.type)) fail("INVALID_PARAMS", "'type' invalide.");
                const s = this.spend(500, !!p.dryRun);
                if (s) return { ...s, id: null };
                if (p.dryRun) return { ...OK(500), id: null };
                const id = 1000 + w.staff.length;
                const tiles = p.patrol ? (p.patrol.x2 - p.patrol.x1 + 1) * (p.patrol.y2 - p.patrol.y1 + 1) : 0;
                w.staff.push({ id, type: p.type, orders: p.orders ?? (p.type === "handyman" ? 15 : p.type === "mechanic" ? 3 : 0), patrolTiles: tiles });
                return { ...OK(500), id, patrolSet: p.patrol ? true : undefined };
            }
            case "staff.fire": {
                const i = w.staff.findIndex((x) => x.id === p.id);
                if (i < 0) return { ok: false, error: { code: "NOT_FOUND", message: "Employé introuvable." } };
                w.staff.splice(i, 1);
                return OK(0);
            }
            case "staff.set_orders":
            case "staff.set_patrol": {
                const st = w.staff.find((x) => x.id === p.id);
                if (!st) return { ok: false, error: { code: "NOT_FOUND", message: "Employé introuvable." } };
                if (method === "staff.set_orders") st.orders = p.orders;
                else st.patrolTiles = p.mode === "clear" ? 0 : (p.rect.x2 - p.rect.x1 + 1) * (p.rect.y2 - p.rect.y1 + 1);
                return OK(0);
            }
            case "staff.list":
                return { staff: w.staff.map((x) => ({ id: x.id, type: x.type, name: `${x.type} ${x.id}`, orders: x.orders, tile: { x: 32, y: 40 }, patrolTiles: x.patrolTiles })) };
            case "batch.execute": {
                const results = p.ops.map((op: { action: string; args: Record<string, unknown> }, index: number) => {
                    const check = checkActionArgs(op.action, op.args);
                    if (!check.known) return { index, ok: false, error: { code: "INVALID_PARAMS", message: `Action inconnue : ${op.action}.` } };
                    if (check.missing.length || check.wrongType.length) return { index, ok: false, error: { code: "INVALID_PARAMS", message: "arguments invalides", details: check } };
                    return { index, ok: true, cost: 0 };
                });
                const firstFailureIndex = results.findIndex((r: { ok: boolean }) => !r.ok);
                return { dryRun: !!p.dryRun, results, totalCost: 0, firstFailureIndex: firstFailureIndex < 0 ? null : firstFailureIndex };
            }
        }
        fail("INVALID_PARAMS", `Méthode inconnue : ${method}.`);
    }
}

function DIR(d: Direction) {
    return [
        { x: -1, y: 0 },
        { x: 0, y: 1 },
        { x: 1, y: 0 },
        { x: 0, y: -1 },
    ][d];
}

// PNG 1×1 transparent.
const TINY_PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");
