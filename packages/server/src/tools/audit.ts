// landscape_audit (SPEC 9.5, 10.5) : défauts fonctionnels et paysagers, avec corrections suggérées et carte annotée.

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { rectArea, type TileRect } from "@openrct2-claude/protocol";
import { z } from "zod";
import { AUDIT_CHECKS, auditLandscape, type AuditIssue } from "../planners/audit.js";
import { renderPngMap, type MarkColor } from "../render/pngmap.js";
import { roleOf } from "../roles.js";
import { BUDGET, defineTool, result, toolError, type ToolContext } from "./context.js";
import { loadedObjects } from "./helpers.js";
import { listRides } from "./observe.js";

const zCoord = z.number().int().min(0).max(1023);
const MAX_AUDIT_TILES = 256 * 256;
const SEVERITY_COLOR: Record<AuditIssue["severity"], MarkColor> = { high: "red", medium: "orange", low: "cyan" };

/** Rectangle englobant du terrain possédé (ou toute la carte s'il n'y en a pas). */
async function ownedBounds(ctx: ToolContext): Promise<TileRect> {
    const size = await ctx.cache.mapSize();
    const all = await ctx.cache.region({ x1: 0, y1: 0, x2: size.x - 1, y2: size.y - 1 });
    let r: TileRect | null = null;
    for (let y = 0; y < size.y; y++)
        for (let x = 0; x < size.x; x++) {
            const t = all.get(x, y);
            if (!t || !(t.o & 3)) continue;
            r = r ? { x1: Math.min(r.x1, x), y1: Math.min(r.y1, y), x2: Math.max(r.x2, x), y2: Math.max(r.y2, y) } : { x1: x, y1: y, x2: x, y2: y };
        }
    return r ?? { x1: 0, y1: 0, x2: size.x - 1, y2: size.y - 1 };
}

export function registerAuditTools(server: McpServer, ctx: ToolContext): void {
    defineTool(
        server,
        ctx,
        "landscape_audit",
        {
            title: "Audit du parc",
            description:
                "Contrôle automatique d'une zone (défaut : tout le terrain possédé) et liste des défauts, du plus grave au moins grave, chacun " +
                "avec des tuiles d'exemple et la correction à appliquer : attractions non raccordées, chemins coupés de l'entrée, impasses, " +
                "attractions fermées, grandes zones vides, chemins sans poubelles/bancs/lampadaires, allées sans végétation, scénerie en grille " +
                "trop régulière. image: true ajoute une carte annotée (rouge = grave, orange = moyen, cyan = mineur, pointillés bleus = zones " +
                "vides). À lancer après chaque grande étape, puis corriger jusqu'à ne plus avoir de défaut grave. " +
                "Exemple : { image: true } ou { x1: 30, y1: 30, x2: 90, y2: 80, checks: ['connectivity', 'empty'] }.",
            input: {
                x1: zCoord.optional(),
                y1: zCoord.optional(),
                x2: zCoord.optional(),
                y2: zCoord.optional(),
                checks: z.array(z.enum(AUDIT_CHECKS)).min(1).optional().describe("Défaut : tous."),
                image: z.boolean().default(false),
            },
            readOnly: true,
        },
        async (a) => {
            const given = [a.x1, a.y1, a.x2, a.y2];
            if (given.some((v) => v !== undefined) && given.some((v) => v === undefined)) toolError("INVALID_PARAMS", "Rectangle incomplet.");
            const rect = await ctx.cache.clamp(a.x1 !== undefined ? { x1: a.x1, y1: a.y1!, x2: a.x2!, y2: a.y2! } : await ownedBounds(ctx));
            if (rectArea(rect) > MAX_AUDIT_TILES) toolError("INVALID_PARAMS", "Zone trop grande.");
            const reg = await ctx.cache.region(rect);
            const inRect = (p: { x: number; y: number } | null | undefined) => !!p && p.x >= rect.x1 && p.x <= rect.x2 && p.y >= rect.y1 && p.y <= rect.y2;
            const rides = (await listRides(ctx)).filter((r) => r.stations.some((s) => inRect(s.start) || inRect(s.entrance) || inRect(s.exit)));
            const additions = await loadedObjects(ctx, "footpath_addition");
            const byIndex = new Map(additions.filter((o) => o.index !== null).map((o) => [o.index!, roleOf(o)]));
            const report = auditLandscape({ rect, get: reg.get, rides, additionRole: (i) => byIndex.get(i) ?? null, checks: a.checks });
            const counts = { high: 0, medium: 0, low: 0 };
            for (const i of report.issues) counts[i.severity]++;
            const images = a.image
                ? [
                      {
                          data: renderPngMap(rect, reg.get, rides, {
                              marks: report.issues.flatMap((i) => (i.tiles ?? []).map((t) => ({ ...t, color: SEVERITY_COLOR[i.severity] }))),
                              rects: report.issues.flatMap((i) => (i.rects ?? []).map((r) => ({ rect: r, color: "blue" as MarkColor }))),
                          }),
                          mimeType: "image/png",
                      },
                  ]
                : [];
            return result({
                response: {
                    summary:
                        report.issues.length === 0
                            ? `Aucun défaut détecté sur (${rect.x1},${rect.y1})–(${rect.x2},${rect.y2}).`
                            : `${report.issues.length} type(s) de défaut : ${counts.high} grave(s), ${counts.medium} moyen(s), ${counts.low} mineur(s).`,
                    rect,
                    stats: report.stats,
                    issues: report.issues.map((i) => ({ ...i, rects: i.rects?.slice(0, 4) })),
                    next_hints: report.issues.slice(0, 3).map((i) => i.hint),
                },
                images,
            });
        },
    );
}
