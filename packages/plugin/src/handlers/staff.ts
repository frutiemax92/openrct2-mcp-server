// Personnel (SPEC 9.4 staff_hire, 7.3 staff.*) : embauche, ordres, zones de patrouille, liste, renvoi.
// Tout passe par des game actions (valides aussi en mode B).

import {
    STAFF_TYPE_VALUE,
    rectToWorldRange,
    normalizeRect,
    worldToTile,
    type StaffHireParams,
    type StaffHireResult,
    type StaffInfo,
    type StaffTypeName,
    type TileRect,
} from "@openrct2-claude/protocol";
import { act, outcome, type ActResult } from "../actions";
import type { Job } from "../queue";
import { fail, isInt, requireInt, requireParkLoaded } from "../util";

const PATROL_MODE = { set: 0, unset: 1, clear: 2 } as const;
/** Index d'objets d'animation essayés pour un costume d'artiste (StaffHireNewAction refuse un costume indisponible). */
const MAX_COSTUME_INDEX = 64;

function requireRect(v: unknown): TileRect {
    const r = v as Partial<TileRect> | undefined;
    if (!r || ![r.x1, r.y1, r.x2, r.y2].every(isInt)) fail("INVALID_PARAMS", "'rect' : { x1, y1, x2, y2 } entiers attendus.");
    return normalizeRect(r as TileRect);
}

function hireArgs(type: number, costumeIndex: number, orders: number): Record<string, unknown> {
    return { autoPosition: true, staffType: type, costumeIndex, staffOrders: orders };
}

/** Ordres par défaut du jeu à l'embauche (fenêtre du personnel) : tout pour l'entretien et les mécaniciens. */
function defaultOrders(type: StaffTypeName): number {
    if (type === "handyman") return 1 | 2 | 4 | 8;
    if (type === "mechanic") return 1 | 2;
    return 0;
}

export function* hire(params: StaffHireParams): Job {
    requireParkLoaded();
    const type = params.type;
    if (!(type in STAFF_TYPE_VALUE)) fail("INVALID_PARAMS", "'type' : handyman, mechanic, security ou entertainer.");
    const orders = params.orders ?? defaultOrders(type);
    if (!isInt(orders) || orders < 0 || orders > 15) fail("INVALID_PARAMS", "'orders' : masque 0 à 15.");
    const patrol = params.patrol ? requireRect(params.patrol) : null;
    const dryRun = !!params.dryRun;
    // Costume : ignoré sauf pour les artistes, qui exigent un objet d'animation d'artiste chargé.
    let costume = 0;
    if (type === "entertainer") {
        let found = -1;
        for (let i = 0; i < MAX_COSTUME_INDEX && found < 0; i++) {
            const q: ActResult = yield* act("staffhire", hireArgs(STAFF_TYPE_VALUE[type], i, orders), true);
            if (q.ok) found = i;
        }
        if (found < 0) fail("OBJECT_NOT_LOADED", "Aucun costume d'artiste disponible.", { hint: "Charge un objet peep_animations d'artiste." });
        costume = found;
    }
    const r = yield* act("staffhire", hireArgs(STAFF_TYPE_VALUE[type], costume, orders), dryRun);
    const out: StaffHireResult = { ...outcome(r), id: null };
    if (!r.ok || dryRun) return out;
    out.id = typeof r.raw?.peep === "number" ? r.raw.peep : null;
    if (patrol && out.id !== null) {
        const p = yield* act("staffsetpatrolarea", { id: out.id, ...rectToWorldRange(patrol), mode: PATROL_MODE.set }, false);
        out.patrolSet = p.ok;
        if (!p.ok) out.error = p.error;
    }
    return out;
}

export function* fire(params: { id: number }): Job {
    requireParkLoaded();
    const r = yield* act("stafffire", { id: requireInt(params as never, "id", 0) }, false);
    return outcome(r);
}

export function* setOrders(params: { id: number; orders: number }): Job {
    requireParkLoaded();
    const r = yield* act("staffsetorders", { id: requireInt(params as never, "id", 0), staffOrders: requireInt(params as never, "orders", 0, 15) }, false);
    return outcome(r);
}

export function* setPatrol(params: { id: number; rect: TileRect; mode: "set" | "unset" | "clear" }): Job {
    requireParkLoaded();
    const mode = PATROL_MODE[params.mode];
    if (mode === undefined) fail("INVALID_PARAMS", "'mode' : set, unset ou clear.");
    const rect = requireRect(params.rect);
    const r = yield* act("staffsetpatrolarea", { id: requireInt(params as never, "id", 0), ...rectToWorldRange(rect), mode }, false);
    return outcome(r);
}

export function* list(): Job {
    requireParkLoaded();
    const staff: StaffInfo[] = [];
    for (const s of map.getAllEntities("staff")) {
        const onMap = s.x >= 0 && s.y >= 0 && s.x < 0x8000;
        staff.push({
            id: s.id ?? -1,
            type: s.staffType,
            name: s.name,
            orders: s.orders,
            tile: onMap ? { x: worldToTile(s.x), y: worldToTile(s.y) } : null,
            patrolTiles: s.patrolArea.tiles.length,
        });
    }
    yield;
    return { staff };
}
