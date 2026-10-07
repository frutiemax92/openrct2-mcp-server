import {
    CHEAT_TYPES,
    PLUGIN_VERSION,
    PROTOCOL_VERSION,
    type Capabilities,
    type CheatSetParams,
    type GameDateInfo,
    type HelloResult,
    type SessionInfo,
} from "@openrct2-claude/protocol";
import { act, outcome } from "../actions";
import { pendingCount, type Job } from "../queue";
import { fail } from "../util";

/** Propriétés lisibles de l'objet global `cheats` (F20). */
const CHEAT_PROPS = [
    "allowArbitraryRideTypeChanges",
    "allowSpecialColourSchemes",
    "allowTrackPlaceInvalidHeights",
    "buildInPauseMode",
    "disableAllBreakdowns",
    "disableBrakesFailure",
    "disableClearanceChecks",
    "disableLittering",
    "disablePlantAging",
    "disableGrassGrowing",
    "disableRideValueAging",
    "disableSupportLimits",
    "disableTrainLengthLimit",
    "disableVandalism",
    "enableAllDrawableTrackPieces",
    "enableChainLiftOnAllTrack",
    "fastLiftHill",
    "forcedParkRating",
    "freezeWeather",
    "ignoreResearchStatus",
    "ignoreRideIntensity",
    "ignoreRidePrice",
    "neverendingMarketing",
    "makeAllDestructible",
    "sandboxMode",
    "showAllOperatingModes",
    "showVehiclesFromOtherTrackTypes",
    "allowRegularPathAsQueue",
];

export function isHeadless(): boolean {
    return typeof ui === "undefined";
}

export function capabilities(): Capabilities {
    const consoleLegacy = typeof console.executeLegacy === "function";
    return {
        captureImage: typeof context.captureImage === "function" && !isHeadless(),
        directEdit: network.mode === "none",
        consoleLegacy,
        saveLoad: typeof context.saveGame === "function" && consoleLegacy,
        trackSegments: typeof context.getTrackSegment === "function",
        pathNavigator: typeof map.getPathNavigator === "function",
    };
}

export function hasPark(): boolean {
    return context.mode === "normal" || context.mode === "scenario_editor";
}

export function mapSize(): { x: number; y: number } {
    return hasPark() ? { x: map.size.x, y: map.size.y } : { x: 0, y: 0 };
}

export function helloResult(): HelloResult {
    return {
        pluginVersion: PLUGIN_VERSION,
        protocolVersion: PROTOCOL_VERSION,
        apiVersion: context.apiVersion,
        networkMode: network.mode,
        gameMode: context.mode,
        headless: isHeadless(),
        mapSize: mapSize(),
        capabilities: capabilities(),
    };
}

export function dateInfo(): GameDateInfo {
    return {
        day: date.day,
        month: date.month,
        year: date.year,
        ticksElapsed: date.ticksElapsed,
        monthsElapsed: date.monthsElapsed,
    };
}

export function readCheats(): Record<string, boolean | number> {
    const out: Record<string, boolean | number> = {};
    const c = cheats as unknown as Record<string, boolean | number>;
    for (const k of CHEAT_PROPS) {
        const v = c[k];
        if (v !== undefined) out[k] = v;
    }
    return out;
}

export function* info(): Job {
    const park_ = hasPark()
        ? { name: park.name, cash: park.cash, rating: park.rating, guests: park.guests, date: dateInfo() }
        : null;
    const result: SessionInfo = {
        pluginVersion: PLUGIN_VERSION,
        apiVersion: context.apiVersion,
        networkMode: network.mode,
        gameMode: context.mode,
        paused: context.paused,
        gameSpeed: context.gameSpeed,
        mapSize: mapSize(),
        park: park_,
        cheats: hasPark() ? readCheats() : {},
        queue: { pending: pendingCount() },
    };
    return result;
}

export function* setPaused(params: { paused: boolean }): Job {
    if (typeof params.paused !== "boolean") fail("INVALID_PARAMS", "Paramètre 'paused' : booléen attendu.");
    if (context.paused !== params.paused) {
        if (network.mode === "none") {
            context.paused = params.paused;
        } else {
            const r = yield* act("pausetoggle", {}, false);
            if (!r.ok) throw r;
        }
    }
    return { paused: context.paused };
}

export function* cheatsGet(): Job {
    return readCheats();
}

export function* cheatsSet(params: CheatSetParams): Job {
    if (!Array.isArray(params.items)) fail("INVALID_PARAMS", "Paramètre 'items' : tableau attendu.");
    const results = [];
    for (const item of params.items) {
        const type = typeof item.cheat === "number" ? item.cheat : (CHEAT_TYPES as Record<string, number>)[item.cheat];
        if (type === undefined) fail("INVALID_PARAMS", `Cheat inconnu : ${item.cheat}.`, { details: { known: Object.keys(CHEAT_TYPES) } });
        const r = yield* act("cheatset", { type, param1: item.param1 ?? 0, param2: item.param2 ?? 0 }, false);
        results.push(outcome(r));
    }
    return { results };
}

export function* ping(): Job {
    return { pong: true, tick: date.ticksElapsed };
}
