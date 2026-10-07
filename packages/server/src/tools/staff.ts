// Personnel (SPEC 9.4 staff_hire) : embauche avec ordres et zone de patrouille, liste.

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { STAFF_ORDERS, normalizeRect, type StaffHireResult, type StaffTypeName } from "@openrct2-claude/protocol";
import { z } from "zod";
import type { InverseOp } from "../state/journal.js";
import { BUDGET, defineTool, result, toolError, zDryRun, type ToolContext } from "./context.js";

const zCoord = z.number().int().min(0).max(1023);
const ORDER_NAMES = ["sweeping", "water_flowers", "empty_bins", "mowing", "inspect_rides", "fix_rides"] as const;

function ordersMask(type: StaffTypeName, names: readonly string[] | undefined): number | undefined {
    if (!names) return undefined;
    const table: Record<string, number> = type === "handyman" ? STAFF_ORDERS.handyman : type === "mechanic" ? STAFF_ORDERS.mechanic : {};
    let mask = 0;
    for (const n of names) {
        if (!(n in table)) toolError("INVALID_PARAMS", `Ordre « ${n} » impossible pour ${type}.`, { hint: "handyman : sweeping, water_flowers, empty_bins, mowing ; mechanic : inspect_rides, fix_rides." });
        mask |= table[n];
    }
    return mask;
}

function orderNames(type: StaffTypeName, mask: number): string[] {
    const table: Record<string, number> = type === "handyman" ? STAFF_ORDERS.handyman : type === "mechanic" ? STAFF_ORDERS.mechanic : {};
    return Object.entries(table)
        .filter(([, bit]) => mask & bit)
        .map(([n]) => n);
}

export function registerStaffTools(server: McpServer, ctx: ToolContext): void {
    defineTool(
        server,
        ctx,
        "staff_hire",
        {
            title: "Embaucher du personnel",
            description:
                "Embauche count employés d'un type : handyman (entretien : balayer, arroser, vider les poubelles, tondre), mechanic (inspecter " +
                "et réparer les attractions), security (anti-vandalisme), entertainer (artiste, remonte le moral). Placement automatique sur " +
                "un chemin. orders restreint les tâches (défaut : toutes). patrol limite la zone de travail à un rectangle : un agent " +
                "d'entretien par 15×15 tuiles de chemins environ, un mécanicien par 3-4 attractions. " +
                "Exemple : { type: 'handyman', count: 2, patrol: { x1: 100, y1: 60, x2: 130, y2: 80 } }.",
            input: {
                type: z.enum(["handyman", "mechanic", "security", "entertainer"]),
                count: z.number().int().min(1).max(20).default(1),
                orders: z.array(z.enum(ORDER_NAMES)).optional(),
                patrol: z.object({ x1: zCoord, y1: zCoord, x2: zCoord, y2: zCoord }).optional(),
                dryRun: zDryRun,
            },
        },
        async ({ type, count, orders, patrol, dryRun }) => {
            const mask = ordersMask(type, orders);
            const hired: StaffHireResult[] = [];
            const errors: string[] = [];
            for (let i = 0; i < count; i++) {
                const r = await ctx.bridge.call("staff.hire", { type, orders: mask, patrol: patrol ? normalizeRect(patrol) : undefined, dryRun });
                if (r.ok) hired.push(r);
                else {
                    errors.push(r.error?.message ?? "échec");
                    break;
                }
                if (r.error) errors.push(`patrouille : ${r.error.message}`);
            }
            const ids = hired.map((h) => h.id).filter((id): id is number => id !== null);
            const cost = hired.reduce((n, h) => n + (h.cost ?? 0), 0);
            if (!dryRun && ids.length) {
                ctx.journal.record({
                    tool: "staff_hire",
                    summary: `embauche de ${ids.length} ${type}`,
                    params: { type, count, patrol },
                    inverse: ids.map((id) => ({ method: "staff.fire", params: { id } }) as InverseOp),
                    cost,
                });
            }
            if (hired.length === 0) toolError("GAME_ACTION_FAILED", `Embauche impossible : ${errors[0] ?? "raison inconnue"}.`, { hint: "Vérifie l'argent disponible (get_park_overview) et qu'un chemin existe." });
            return result({
                budget: BUDGET.write,
                response: {
                    summary: `${dryRun ? "[simulation] " : ""}${hired.length} ${type} embauché(s)${patrol ? " avec zone de patrouille" : ""}, coût ${cost}.`,
                    ids,
                    changed: { staff: dryRun ? 0 : hired.length, cost },
                    warnings: errors,
                },
            });
        },
    );

    defineTool(
        server,
        ctx,
        "staff_list",
        {
            title: "Lister le personnel",
            description: "Employés du parc : id, type, ordres, position (tuile), taille de la zone de patrouille (0 = tout le parc), et effectif par type.",
            input: { cursor: z.number().int().min(0).default(0) },
            readOnly: true,
        },
        async ({ cursor }) => {
            const { staff } = await ctx.bridge.call("staff.list", {});
            const byType: Record<string, number> = {};
            for (const s of staff) byType[s.type] = (byType[s.type] ?? 0) + 1;
            const page = staff.slice(cursor, cursor + 25);
            return result({
                response: {
                    summary: `${staff.length} employé(s) : ${Object.entries(byType).map(([t, n]) => `${n} ${t}`).join(", ") || "aucun"}.`,
                    byType,
                    staff: page.map((s) => ({ id: s.id, type: s.type, orders: orderNames(s.type, s.orders), tile: s.tile, patrolTiles: s.patrolTiles })),
                    nextCursor: cursor + page.length < staff.length ? cursor + page.length : null,
                },
            });
        },
    );
}
