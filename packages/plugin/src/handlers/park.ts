import {
    levelToZ,
    RIDE_FLAGS,
    tileToWorld,
    type ActionOutcome,
    type OwnershipParams,
    type ParkEntranceParams,
    type ParkOverview,
    type ParkSetParams,
    type PeepSpawnParams,
} from "@openrct2-claude/protocol";
import { act, outcome } from "../actions";
import { firstLoaded, resolveLoaded, resolvePath } from "../objects";
import type { Job } from "../queue";
import { fail, requireInt, requireParkLoaded, requireTileInMap } from "../util";
import { dateInfo } from "./session";

const MAX_GUESTS_SCANNED = 4000;

export function* overview(): Job {
    requireParkLoaded();
    const rides = map.rides;
    let open = 0;
    const brokenIds: number[] = [];
    for (const r of rides) {
        if (r.status === "open") open++;
        if ((r.flags & RIDE_FLAGS.brokenDown) !== 0) brokenIds.push(r.id);
    }
    yield;
    const counts: Record<string, number> = {};
    let happinessSum = 0;
    let n = 0;
    const guests = map.getAllEntities("guest");
    for (let i = 0; i < guests.length && i < MAX_GUESTS_SCANNED; i++) {
        const g = guests[i];
        happinessSum += g.happiness;
        n++;
        const thoughts = g.thoughts;
        if (thoughts.length > 0) {
            const t = thoughts[0].type;
            counts[t] = (counts[t] ?? 0) + 1;
        }
        if (i % 500 === 499) yield;
    }
    const topThoughts = Object.keys(counts)
        .map((type) => ({ type, count: counts[type] }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 8);
    const result: ParkOverview = {
        name: park.name,
        cash: park.cash,
        bankLoan: park.bankLoan,
        maxBankLoan: park.maxBankLoan,
        rating: park.rating,
        guests: park.guests,
        suggestedGuestMaximum: park.suggestedGuestMaximum,
        entranceFee: park.entranceFee,
        value: park.value,
        companyValue: park.companyValue,
        parkSize: park.parkSize,
        date: dateInfo(),
        isOpen: park.getFlag("open"),
        rides: { total: rides.length, open, broken: brokenIds.length, brokenIds },
        topThoughts,
        happiness: n > 0 ? Math.round(happinessSum / n) : null,
    };
    return result;
}

export function* set(params: ParkSetParams): Job {
    requireParkLoaded();
    const dryRun = !!params.dryRun;
    const results: Record<string, ActionOutcome> = {};
    if (params.name !== undefined) {
        if (typeof params.name !== "string" || params.name.length === 0 || params.name.length > 64) {
            fail("INVALID_PARAMS", "Paramètre 'name' : chaîne de 1 à 64 caractères.");
        }
        results.name = outcome(yield* act("parksetname", { name: params.name }, dryRun));
    }
    if (params.entranceFee !== undefined) {
        results.entranceFee = outcome(yield* act("parksetentrancefee", { value: requireInt(params as never, "entranceFee", 0) }, dryRun));
    }
    if (params.loan !== undefined) {
        results.loan = outcome(yield* act("parksetloan", { value: requireInt(params as never, "loan", 0) }, dryRun));
    }
    if (params.open !== undefined) {
        // ParkParameter : 0 close, 1 open
        results.open = outcome(yield* act("parksetparameter", { parameter: params.open ? 1 : 0, value: 0 }, dryRun));
    }
    return { results };
}

export function* entrancePlace(params: ParkEntranceParams): Job {
    requireParkLoaded();
    const x = requireInt(params as never, "x");
    const y = requireInt(params as never, "y");
    requireTileInMap(x, y);
    const level = requireInt(params as never, "level", 1, 127);
    const direction = requireInt(params as never, "direction", 0, 3);
    const entrance =
        params.entranceObject !== undefined ? resolveLoaded(["park_entrance"], params.entranceObject).index : firstLoaded("park_entrance")?.index;
    if (entrance === undefined) fail("OBJECT_NOT_LOADED", "Aucun objet park_entrance chargé.", { hint: "load_objects avec un objet de type park_entrance." });
    const path = resolvePath(params.pathObject, undefined, false);
    const r = yield* act(
        "parkentranceplace",
        {
            x: tileToWorld(x),
            y: tileToWorld(y),
            z: levelToZ(level),
            direction,
            footpathSurfaceObject: path.object,
            entranceObject: entrance,
            footpathTypeIsLegacy: path.legacy,
        },
        !!params.dryRun,
        { tile: { x, y } },
    );
    return outcome(r);
}

export function* spawnPlace(params: PeepSpawnParams): Job {
    requireParkLoaded();
    const x = requireInt(params as never, "x");
    const y = requireInt(params as never, "y");
    requireTileInMap(x, y);
    const level = requireInt(params as never, "level", 1, 127);
    const direction = requireInt(params as never, "direction", 0, 3);
    const r = yield* act(
        "peepspawnplace",
        { x: tileToWorld(x) + 16, y: tileToWorld(y) + 16, z: levelToZ(level), direction },
        !!params.dryRun,
        { tile: { x, y } },
    );
    return outcome(r);
}

// LandBuyRightSetting : 0 terrain, 1 droits de construction. LandSetRightSetting : 4 = propriété fixée.
// OwnershipFlag (FlagHolder) : bit 0 droits de construction, bit 1 terrain possédé.
export function* ownershipSet(params: OwnershipParams): Job {
    requireParkLoaded();
    const dryRun = !!params.dryRun;
    if (params.mode === "own_all") {
        if (dryRun) return { ok: true, cost: 0 };
        return outcome(yield* act("cheatset", { type: 42, param1: 0, param2: 0 }, false));
    }
    const x1 = requireInt(params as never, "x1");
    const y1 = requireInt(params as never, "y1");
    const x2 = requireInt(params as never, "x2");
    const y2 = requireInt(params as never, "y2");
    const range = {
        x1: tileToWorld(Math.min(x1, x2)),
        y1: tileToWorld(Math.min(y1, y2)),
        x2: tileToWorld(Math.max(x1, x2)),
        y2: tileToWorld(Math.max(y1, y2)),
    };
    switch (params.mode) {
        case "buy_land":
            return outcome(yield* act("landbuyrights", { ...range, setting: 0 }, dryRun));
        case "buy_rights":
            return outcome(yield* act("landbuyrights", { ...range, setting: 1 }, dryRun));
        case "set_owned":
            return outcome(yield* act("landsetrights", { ...range, setting: 4, ownership: 2 }, dryRun));
        case "set_rights":
            return outcome(yield* act("landsetrights", { ...range, setting: 4, ownership: 1 }, dryRun));
        case "set_unowned":
            return outcome(yield* act("landsetrights", { ...range, setting: 4, ownership: 0 }, dryRun));
    }
    fail("INVALID_PARAMS", `Mode inconnu : ${params.mode}.`);
}
