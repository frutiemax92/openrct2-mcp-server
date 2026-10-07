// Terraformage de haut niveau et eau (SPEC 9.2, 11.5) : terrain_shape, water_create_lake.

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { MAX_LEVEL, MIN_LEVEL, normalizeRect, rectArea, type BulkResult, type TerrainHeightItem, type TileRect, type TileXY } from "@openrct2-claude/protocol";
import { z } from "zod";
import {
    diffTiles,
    enforceSlopeLimit,
    fractalNoise,
    profileAt,
    smoothGrid,
    vertexGridFromTerrain,
    type Profile,
    type VertexGrid,
} from "../planners/heightmap.js";
import type { InverseOp } from "../state/journal.js";
import { BUDGET, defineTool, result, toolError, zDryRun, type ToolContext } from "./context.js";
import { chunks, groupFailures, mergeBulk } from "./helpers.js";

const MAX_SHAPE_TILES = 64 * 64;
const zLevel = z.number().int().min(MIN_LEVEL).max(MAX_LEVEL);
const zCoord = z.number().int().min(0).max(1023);

interface ApplyOutcome {
    res: BulkResult;
    before: TerrainHeightItem[];
}

/** Applique des hauteurs de tuiles par lots et journalise l'inverse (hors dryRun). */
async function applyHeights(ctx: ToolContext, tool: string, summary: string, after: TerrainHeightItem[], before: TerrainHeightItem[], dryRun: boolean, extraInverse: InverseOp[] = []): Promise<ApplyOutcome> {
    const parts: BulkResult[] = [];
    for (const c of chunks(after)) parts.push(await ctx.bridge.call("terrain.set_heights", { tiles: c, dryRun }));
    const res = parts.length ? mergeBulk(parts) : { dryRun, results: [], placed: 0, failed: 0, totalCost: 0 };
    if (!dryRun && after.length) {
        ctx.cache.invalidateTiles(after, 1);
        const ok = new Set(res.results.filter((r) => r.ok).map((r) => `${r.x},${r.y}`));
        const inverse = before.filter((b) => ok.has(`${b.x},${b.y}`));
        ctx.journal.record({
            tool,
            summary,
            params: { tiles: after.length },
            inverse: [...extraInverse, ...chunks(inverse).map((c) => ({ method: "terrain.set_heights", params: { tiles: c } }) as InverseOp)],
            cost: res.totalCost,
        });
    }
    return { res, before };
}

function levelRange(g: VertexGrid): { min: number; max: number } {
    let min = Infinity;
    let max = -Infinity;
    for (const v of g.v) {
        min = Math.min(min, v);
        max = Math.max(max, v);
    }
    return { min, max };
}

/** Rectangle de travail autour d'un centre et d'un rayon (bord fixé à rayon + 1). */
function circleRect(c: TileXY, radius: number): TileRect {
    const r = Math.ceil(radius) + 1;
    return { x1: c.x - r, y1: c.y - r, x2: c.x + r, y2: c.y + r };
}

export function registerLandscapeTools(server: McpServer, ctx: ToolContext): void {
    defineTool(
        server,
        ctx,
        "terrain_shape",
        {
            title: "Modeler le terrain",
            description:
                "Terraformage de haut niveau, calculé sur les coins des tuiles : les pentes produites sont toujours valides (au plus une marche " +
                "par bord de tuile) et le bord de la zone n'est jamais modifié (raccord propre avec l'extérieur). Les tuiles portant un chemin, " +
                "une attraction ou une entrée ne bougent pas. Opérations :\n" +
                "- hill / valley : { op, center: {x,y}, radius, height } ; height en niveaux (relatif au terrain), profile cone|dome|gaussian.\n" +
                "- plateau : { op, x1,y1,x2,y2, level } ; le rectangle devient plat au niveau absolu `level`, les talus sont créés autour.\n" +
                "- smooth : { op, x1,y1,x2,y2, iterations } ; adoucit le relief.\n" +
                "- noise : { op, x1,y1,x2,y2, amplitude, scale, seed } ; relief naturel aléatoire mais reproductible.\n" +
                "Zone ≤ 64×64. Fais-le AVANT de poser chemins et scénerie. Exemple : { op: 'hill', center: {x: 40, y: 30}, radius: 6, height: 4 }.",
            input: {
                op: z.enum(["hill", "valley", "plateau", "smooth", "noise"]),
                center: z.object({ x: zCoord, y: zCoord }).optional(),
                radius: z.number().min(1).max(30).optional(),
                height: z.number().int().min(1).max(30).optional().describe("hill/valley : hauteur ou profondeur en niveaux."),
                profile: z.enum(["cone", "dome", "gaussian"]).default("dome"),
                x1: zCoord.optional(),
                y1: zCoord.optional(),
                x2: zCoord.optional(),
                y2: zCoord.optional(),
                level: zLevel.optional().describe("plateau : niveau absolu."),
                iterations: z.number().int().min(1).max(10).default(2),
                amplitude: z.number().min(1).max(12).default(2),
                scale: z.number().min(2).max(64).default(8),
                seed: z.number().int().default(1),
                dryRun: zDryRun,
            },
        },
        async (a) => {
            let area: TileRect;
            let core: TileRect | null = null;
            if (a.op === "hill" || a.op === "valley") {
                if (!a.center || a.radius === undefined || a.height === undefined) toolError("INVALID_PARAMS", `${a.op} : center, radius et height sont obligatoires.`);
                area = circleRect(a.center, a.radius);
            } else {
                if ([a.x1, a.y1, a.x2, a.y2].some((v) => v === undefined)) toolError("INVALID_PARAMS", `${a.op} : x1, y1, x2, y2 obligatoires.`);
                core = normalizeRect({ x1: a.x1!, y1: a.y1!, x2: a.x2!, y2: a.y2! });
                area = core;
                if (a.op === "plateau") {
                    if (a.level === undefined) toolError("INVALID_PARAMS", "plateau : level obligatoire.");
                    const cur = await ctx.cache.region(core);
                    let maxDelta = 0;
                    for (let y = core.y1; y <= core.y2; y++) for (let x = core.x1; x <= core.x2; x++) maxDelta = Math.max(maxDelta, Math.abs((cur.get(x, y)?.h ?? a.level) - a.level));
                    const m = Math.min(16, maxDelta + 1);
                    area = { x1: core.x1 - m, y1: core.y1 - m, x2: core.x2 + m, y2: core.y2 + m };
                }
            }
            area = await ctx.cache.clamp(area);
            if (rectArea(area) > MAX_SHAPE_TILES) toolError("INVALID_PARAMS", `Zone de travail trop grande (${rectArea(area)} tuiles, max ${MAX_SHAPE_TILES}).`, { hint: "Découpe en plusieurs appels ou réduis le rayon." });
            const reg = await ctx.cache.region({ x1: area.x1 - 1, y1: area.y1 - 1, x2: area.x2 + 1, y2: area.y2 + 1 });
            const g = vertexGridFromTerrain(area, reg.get);
            const before = levelRange(g);
            let prefer: "up" | "down" = "up";
            switch (a.op) {
                case "hill":
                case "valley": {
                    const sign = a.op === "hill" ? 1 : -1;
                    const cx = a.center!.x + 0.5;
                    const cy = a.center!.y + 0.5;
                    g.forEach((vx, vy, i) => {
                        const d = Math.hypot(vx - cx, vy - cy) / a.radius!;
                        g.set(vx, vy, g.v[i] + sign * a.height! * profileAt(a.profile as Profile, d));
                    });
                    prefer = a.op === "hill" ? "up" : "down";
                    break;
                }
                case "plateau": {
                    const c = core!;
                    let up = 0;
                    for (let vy = c.y1; vy <= c.y2 + 1; vy++)
                        for (let vx = c.x1; vx <= c.x2 + 1; vx++) {
                            if (vx < area.x1 || vy < area.y1 || vx > area.x2 + 1 || vy > area.y2 + 1) continue;
                            const i = g.idx(vx, vy);
                            up += Math.sign(a.level! - g.v[i]);
                            g.set(vx, vy, a.level!);
                            g.fixed[i] = 1;
                        }
                    prefer = up >= 0 ? "up" : "down";
                    break;
                }
                case "smooth":
                    smoothGrid(g, a.iterations);
                    break;
                case "noise": {
                    const n = fractalNoise(a.seed);
                    const r = area;
                    g.forEach((vx, vy, i) => {
                        const edge = Math.min(vx - r.x1, vy - r.y1, r.x2 + 1 - vx, r.y2 + 1 - vy);
                        const falloff = Math.min(1, edge / Math.max(2, a.scale / 2));
                        g.set(vx, vy, g.v[i] + a.amplitude * falloff * n(vx / a.scale, vy / a.scale));
                    });
                    break;
                }
            }
            const cliffs = enforceSlopeLimit(g, prefer);
            const { after, before: prev, invalid } = diffTiles(g, reg.get);
            if (after.length === 0) {
                return result({ budget: BUDGET.write, response: { summary: "Aucune tuile à modifier (terrain déjà conforme ou zone occupée).", area } });
            }
            const label = a.op === "hill" || a.op === "valley" ? `${a.op} (${a.center!.x},${a.center!.y}) r${a.radius}` : `${a.op} (${area.x1},${area.y1})–(${area.x2},${area.y2})`;
            const { res } = await applyHeights(ctx, "terrain_shape", label, after, prev, a.dryRun);
            const range = levelRange(g);
            const failures = groupFailures(res.results);
            const warnings: string[] = [];
            if (cliffs) warnings.push(`${cliffs} bord(s) de tuile restent en falaise contre une tuile fixe (chemin, attraction ou bord de zone).`);
            if (invalid.length) warnings.push(`${invalid.length} tuile(s) ignorée(s) : pente impossible.`);
            return result({
                budget: BUDGET.write * 2,
                response: {
                    summary: `${a.dryRun ? "[simulation] " : ""}${label} : ${res.placed} tuile(s) modifiée(s), ${res.failed} échec(s), coût ${res.totalCost}.`,
                    area,
                    levels: { before, after: range },
                    changed: { tiles: res.placed, cost: res.totalCost },
                    failures,
                    warnings,
                    next_hints: [...(failures.map((f) => f.hint).filter(Boolean) as string[]), "Vérifie avec get_region_map layer 'height'."],
                },
            });
        },
    );

    defineTool(
        server,
        ctx,
        "water_create_lake",
        {
            title: "Créer un lac",
            description:
                "Creuse un bassin dans un rectangle (forme ellipse par défaut, ou rect), avec des berges en pente douce vers l'intérieur, puis le " +
                "remplit d'eau. level = niveau de la surface de l'eau (défaut : le plus bas du pourtour, pour que l'eau ne déborde pas). depth = " +
                "profondeur au centre en niveaux. Les tuiles occupées (chemins, attractions) ne sont pas creusées. Le bord du rectangle sert de " +
                "rive : laisse 1 tuile de marge avec les chemins. Exemple : { x1: 20, y1: 40, x2: 32, y2: 48, depth: 2 }.",
            input: {
                x1: zCoord,
                y1: zCoord,
                x2: zCoord,
                y2: zCoord,
                shape: z.enum(["ellipse", "rect"]).default("ellipse"),
                depth: z.number().int().min(1).max(8).default(2),
                level: zLevel.optional(),
                dryRun: zDryRun,
            },
        },
        async ({ x1, y1, x2, y2, shape, depth, level, dryRun }) => {
            const rect = await ctx.cache.clamp({ x1, y1, x2, y2 });
            if (rect.x2 - rect.x1 < 2 || rect.y2 - rect.y1 < 2) toolError("INVALID_PARAMS", "Lac trop petit (3×3 tuiles au minimum).");
            if (rectArea(rect) > MAX_SHAPE_TILES) toolError("INVALID_PARAMS", `Zone trop grande (max ${MAX_SHAPE_TILES} tuiles).`);
            const reg = await ctx.cache.region({ x1: rect.x1 - 1, y1: rect.y1 - 1, x2: rect.x2 + 1, y2: rect.y2 + 1 });
            const g = vertexGridFromTerrain(rect, reg.get);
            const cx = (rect.x1 + rect.x2 + 1) / 2;
            const cy = (rect.y1 + rect.y2 + 1) / 2;
            const rx = (rect.x2 - rect.x1 + 1) / 2;
            const ry = (rect.y2 - rect.y1 + 1) / 2;
            const inside = (px: number, py: number) => shape === "rect" || ((px - cx) / rx) ** 2 + ((py - cy) / ry) ** 2 <= 1;
            // Surface de l'eau : par défaut, le sommet le plus bas du pourtour fixé (l'eau ne déborde pas).
            let rim = Infinity;
            g.forEach((_vx, _vy, i) => {
                if (g.fixed[i]) rim = Math.min(rim, g.v[i]);
            });
            const water = level ?? rim;
            const warnings: string[] = [];
            if (water > rim) warnings.push(`Le pourtour descend au niveau ${rim}, sous l'eau (${water}) : l'eau paraîtra « suspendue » au bord.`);
            const bottom = Math.max(MIN_LEVEL, water - depth);
            g.forEach((vx, vy, i) => {
                if (inside(vx, vy) && g.v[i] > bottom) g.set(vx, vy, bottom);
            });
            enforceSlopeLimit(g, "up");
            const { after, before } = diffTiles(g, reg.get);
            // Tuiles à remplir : au moins un coin sous la surface. Pas de test de forme sur le centre : le creusage
            // teste les sommets, donc une tuile de bord (centre hors ellipse) peut avoir un coin creusé, et la
            // laisser sèche y ferait un trou.
            const waterTiles: TileXY[] = [];
            for (let y = rect.y1; y <= rect.y2; y++)
                for (let x = rect.x1; x <= rect.x2; x++) {
                    const t = reg.get(x, y);
                    if (!t || t.p?.length || t.r?.length || t.e?.length) continue;
                    if (Math.min(...g.corners(x, y)) < water) waterTiles.push({ x, y });
                }
            if (waterTiles.length === 0) toolError("BAD_SLOPE", "Aucune tuile ne serait sous l'eau.", { hint: "Augmente depth ou level, ou libère la zone (chemins, attractions)." });
            // Eau par segments de ligne (terrain.set_water prend un rectangle).
            const runs: TileRect[] = [];
            for (const t of waterTiles) {
                const last = runs[runs.length - 1];
                if (last && last.y1 === t.y && last.x2 === t.x - 1) last.x2 = t.x;
                else runs.push({ x1: t.x, y1: t.y, x2: t.x, y2: t.y });
            }
            // Ordre : creuser d'abord, puis remplir. L'inverse retire l'eau avant de remonter le terrain.
            const removeWater: InverseOp[] = runs.map((r) => ({ method: "terrain.set_water", params: { ...r, level: 0 } }));
            const label = `lac (${rect.x1},${rect.y1})–(${rect.x2},${rect.y2}) niveau ${water}`;
            const { res } = await applyHeights(ctx, "water_create_lake", label, after, before, dryRun, removeWater);
            let filled = 0;
            let waterCost = 0;
            const waterFailures: BulkResult["results"] = [];
            if (!dryRun) {
                for (const r of runs) {
                    const w = await ctx.bridge.call("terrain.set_water", { ...r, level: water });
                    filled += w.placed;
                    waterCost += w.totalCost;
                    waterFailures.push(...w.results.filter((x) => !x.ok));
                }
                ctx.cache.invalidate(rect, 1);
                if (after.length === 0) {
                    ctx.journal.record({ tool: "water_create_lake", summary: label, params: { rect }, inverse: removeWater, cost: waterCost });
                }
            }
            const failures = groupFailures([...res.results, ...waterFailures]);
            return result({
                budget: BUDGET.write * 2,
                response: {
                    summary: `${dryRun ? "[simulation] " : ""}Lac : ${res.placed} tuile(s) creusée(s), ${dryRun ? waterTiles.length + " à remplir" : filled + " remplie(s)"} au niveau ${water}, coût ${res.totalCost + waterCost}.`,
                    waterLevel: water,
                    bottomLevel: bottom,
                    changed: { dug: res.placed, water: dryRun ? 0 : filled, cost: res.totalCost + waterCost },
                    failures,
                    warnings,
                    next_hints: ["Ajoute de la scénerie de berge (rochers, roseaux) avec scenery_scatter_zone zoneType 'lakeshore'."],
                },
            });
        },
    );
}

