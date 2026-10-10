import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
    CLEAR_ITEMS,
    MAX_LEVEL,
    MIN_LEVEL,
    normalizeRect,
    rectArea,
    type BulkResult,
    type ObjectInfo,
    type SmallSceneryItem,
    type TerrainHeightItem,
} from "@openrct2-claude/protocol";
import { z } from "zod";
import { analyzeConnectivity } from "../planners/connectivity.js";
import { expandPolyline, planPath } from "../planners/path.js";
import { roleOf } from "../roles.js";
import type { InverseOp } from "../state/journal.js";
import { BUDGET, cap, defineTool, landscapeHint, requireLandscape, result, toolError, zDryRun, zRectShape, zTile, type ToolContext } from "./context.js";
import { chunks, groupFailures, mergeBulk, placePathTiles } from "./helpers.js";

const MAX_FLATTEN_TILES = 64 * 64;

function median(values: number[]): number {
    const s = [...values].sort((a, b) => a - b);
    return s[Math.floor(s.length / 2)] ?? 0;
}

export function registerBuildTools(server: McpServer, ctx: ToolContext): void {
    // -----------------------------------------------------------------------
    // Terrain
    // -----------------------------------------------------------------------
    defineTool(
        server,
        ctx,
        "terrain_flatten",
        {
            title: "Aplanir un rectangle",
            description:
                "Relief verrouillé par défaut : sans session_set_landscape (accord de l'utilisateur), seul dryRun est permis. " +
                "Aplanit un rectangle de tuiles à un niveau donné (level) ou 'auto' (médiane des niveaux actuels). À faire AVANT de poser chemins " +
                "et attractions. Renvoie les tuiles en échec (terrain non possédé, objets gênants) et le nombre de bords en falaise créés. " +
                "Exemple : { x1: 60, y1: 60, x2: 70, y2: 66, level: 'auto' }.",
            input: { ...zRectShape, level: z.union([z.number().int().min(MIN_LEVEL).max(MAX_LEVEL), z.literal("auto")]).default("auto"), dryRun: zDryRun },
        },
        async ({ x1, y1, x2, y2, level, dryRun }) => {
            requireLandscape(ctx, "terrain_flatten", dryRun);
            const rect = await ctx.cache.clamp({ x1, y1, x2, y2 });
            if (rectArea(rect) > MAX_FLATTEN_TILES) toolError("INVALID_PARAMS", `Zone trop grande (${rectArea(rect)} tuiles, max ${MAX_FLATTEN_TILES}).`);
            const reg = await ctx.cache.region(rect);
            const before: TerrainHeightItem[] = [];
            const levels: number[] = [];
            for (let y = rect.y1; y <= rect.y2; y++)
                for (let x = rect.x1; x <= rect.x2; x++) {
                    const t = reg.get(x, y);
                    if (!t) continue;
                    levels.push(t.h);
                    before.push({ x, y, level: t.h, slope: t.s });
                }
            const target = level === "auto" ? median(levels) : level;
            const todo = before.filter((b) => b.level !== target || b.slope !== 0);
            if (todo.length === 0) {
                return result({ budget: BUDGET.write, response: { summary: `Déjà plat au niveau ${target}.`, level: target, changed: { tiles: 0 } } });
            }
            const parts: BulkResult[] = [];
            for (const c of chunks(todo)) {
                parts.push(await ctx.bridge.call("terrain.set_heights", { tiles: c.map((t) => ({ x: t.x, y: t.y, level: target, slope: 0 })), dryRun }));
            }
            const res = mergeBulk(parts);
            const okSet = new Set(res.results.filter((r) => r.ok).map((r) => `${r.x},${r.y}`));
            let cliffs = 0;
            if (!dryRun) {
                ctx.cache.invalidate(rect, 1);
                const around = await ctx.cache.region({ x1: rect.x1 - 1, y1: rect.y1 - 1, x2: rect.x2 + 1, y2: rect.y2 + 1 });
                for (let x = rect.x1; x <= rect.x2; x++)
                    for (const y of [rect.y1 - 1, rect.y2 + 1]) {
                        const t = around.get(x, y);
                        if (t && Math.abs(t.h - target) > 1) cliffs++;
                    }
                for (let y = rect.y1; y <= rect.y2; y++)
                    for (const x of [rect.x1 - 1, rect.x2 + 1]) {
                        const t = around.get(x, y);
                        if (t && Math.abs(t.h - target) > 1) cliffs++;
                    }
                const inverse = before.filter((b) => okSet.has(`${b.x},${b.y}`));
                ctx.journal.record({
                    tool: "terrain_flatten",
                    summary: `aplanissement (${rect.x1},${rect.y1})–(${rect.x2},${rect.y2}) au niveau ${target}`,
                    params: { rect, target },
                    inverse: chunks(inverse).map((c) => ({ method: "terrain.set_heights", params: { tiles: c } }) as InverseOp),
                    cost: res.totalCost,
                });
            }
            const failures = groupFailures(res.results);
            return result({
                budget: BUDGET.write * 2,
                response: {
                    summary: `${dryRun ? "[simulation] " : ""}${res.placed} tuile(s) mises au niveau ${target}, ${res.failed} échec(s), coût ${res.totalCost}.`,
                    level: target,
                    changed: { tiles: res.placed, cost: res.totalCost },
                    failures,
                    warnings: cliffs > 0 ? [`${cliffs} bord(s) de la zone forment une falaise (écart > 1 niveau avec le voisin).`] : [],
                    next_hints: failures.map((f) => f.hint).filter(Boolean) as string[],
                },
            });
        },
    );

    defineTool(
        server,
        ctx,
        "terrain_set_surface",
        {
            title: "Style de surface",
            description:
                "Relief verrouillé par défaut : sans session_set_landscape (accord de l'utilisateur), seul dryRun est permis. " +
                "Change le style de surface (herbe, sable, terre…) et/ou de bordure sur un rectangle. surface/edge : identifiants d'objets " +
                "terrain_surface / terrain_edge chargés (list_objects type terrain_surface loadedOnly).",
            input: { ...zRectShape, surface: z.string().optional(), edge: z.string().optional(), dryRun: zDryRun },
        },
        async ({ x1, y1, x2, y2, surface, edge, dryRun }) => {
            if (!surface && !edge) toolError("INVALID_PARAMS", "Indique surface et/ou edge.");
            requireLandscape(ctx, "terrain_set_surface", dryRun);
            const rect = await ctx.cache.clamp({ x1, y1, x2, y2 });
            const reg = await ctx.cache.region(rect);
            const r = await ctx.bridge.call("terrain.set_surface", { ...rect, surfaceObject: surface ?? null, edgeObject: edge ?? null, dryRun });
            if (!r.ok) throw { error: r.error };
            if (!dryRun) {
                const inverse: InverseOp[] = [];
                if (surface && rectArea(rect) <= 400) {
                    for (let y = rect.y1; y <= rect.y2; y++)
                        for (let x = rect.x1; x <= rect.x2; x++) {
                            const t = reg.get(x, y);
                            if (t) inverse.push({ method: "terrain.set_surface", params: { x1: x, y1: y, x2: x, y2: y, surfaceObject: t.t } });
                        }
                }
                ctx.journal.record({
                    tool: "terrain_set_surface",
                    summary: `surface ${surface ?? ""} ${edge ?? ""} sur (${rect.x1},${rect.y1})–(${rect.x2},${rect.y2})`,
                    params: { rect, surface, edge },
                    inverse,
                    irreversible: inverse.length === 0 ? "zone trop grande ou bordure seule : utilise un checkpoint" : undefined,
                    cost: r.cost ?? 0,
                });
                ctx.cache.invalidate(rect, 0);
            }
            return result({ budget: BUDGET.write, response: { summary: `${dryRun ? "[simulation] " : ""}Surface modifiée, coût ${r.cost ?? 0}.`, changed: { tiles: rectArea(rect), cost: r.cost ?? 0 } } });
        },
    );

    defineTool(
        server,
        ctx,
        "land_set_ownership",
        {
            title: "Propriété du terrain",
            description:
                "Rend une zone constructible. buy_land / buy_rights : achat normal (coûte de l'argent, terrain à vendre seulement). " +
                "set_owned / set_rights / set_unowned : fixe la propriété (mode sandbox ou éditeur). own_all : tout le terrain (cheat). " +
                "Exemple : { mode: 'set_owned', x1: 40, y1: 40, x2: 90, y2: 90 }.",
            input: {
                mode: z.enum(["buy_land", "buy_rights", "set_owned", "set_rights", "set_unowned", "own_all"]),
                x1: z.number().int().min(0).optional(),
                y1: z.number().int().min(0).optional(),
                x2: z.number().int().min(0).optional(),
                y2: z.number().int().min(0).optional(),
                dryRun: zDryRun,
            },
        },
        async ({ mode, x1, y1, x2, y2, dryRun }) => {
            if (mode !== "own_all" && [x1, y1, x2, y2].some((v) => v === undefined)) toolError("INVALID_PARAMS", "x1, y1, x2, y2 obligatoires sauf pour own_all.");
            const r = await ctx.bridge.call("map.ownership.set", { mode, x1, y1, x2, y2, dryRun });
            if (!r.ok) throw { error: r.error };
            if (!dryRun) {
                if (mode === "own_all") ctx.cache.invalidateAll();
                else ctx.cache.invalidate({ x1: x1!, y1: y1!, x2: x2!, y2: y2! }, 0);
                ctx.journal.record({ tool: "land_set_ownership", summary: `propriété ${mode}`, params: { mode, x1, y1, x2, y2 }, inverse: [], irreversible: "propriété : utilise un checkpoint", cost: r.cost ?? 0 });
            }
            return result({ budget: BUDGET.write, response: { summary: `${dryRun ? "[simulation] " : ""}Propriété « ${mode} » appliquée, coût ${r.cost ?? 0}.` } });
        },
    );

    // -----------------------------------------------------------------------
    // Chemins
    // -----------------------------------------------------------------------
    defineTool(
        server,
        ctx,
        "path_build",
        {
            title: "Tracer un chemin",
            description:
                "Pose un chemin le long d'une polyligne de tuiles (sommets ; le serveur remplit les tuiles intermédiaires, d'abord en x puis en y). " +
                "Hauteur et rampes choisies automatiquement selon le terrain (une marche de dénivelé par tuile au plus). queue: true pour une file " +
                "d'attente. Si une tuile pose problème (pente irrégulière, eau, rupture de niveau), RIEN n'est posé et l'outil renvoie les tuiles " +
                "fautives (sauf allowPartial). level impose une hauteur fixe (passerelle). " +
                "Exemple : { points: [{x:60,y:64},{x:70,y:64},{x:70,y:72}] }.",
            input: {
                points: z.array(zTile).min(1).max(64),
                pathObject: z.string().optional().describe("Identifiant d'un footpath_surface chargé ; défaut : premier chemin chargé."),
                railings: z.string().optional(),
                queue: z.boolean().default(false),
                level: z.number().int().min(MIN_LEVEL).max(MAX_LEVEL).optional(),
                allowSlopes: z.boolean().default(true),
                allowPartial: z.boolean().default(false),
                dryRun: zDryRun,
            },
        },
        async ({ points, pathObject, railings, queue, level, allowSlopes, allowPartial, dryRun }) => {
            const route = expandPolyline(points);
            if (route.length > 500) toolError("INVALID_PARAMS", `Chemin trop long (${route.length} tuiles, max 500).`);
            const xs = route.map((t) => t.x);
            const ys = route.map((t) => t.y);
            const reg = await ctx.cache.region({ x1: Math.min(...xs) - 1, y1: Math.min(...ys) - 1, x2: Math.max(...xs) + 1, y2: Math.max(...ys) + 1 });
            const plan = planPath(route, reg.get, { fixedLevel: level, allowSlopes });
            const blocking = plan.problems.filter((p) => p.code !== "LEVEL_BREAK");
            if (blocking.length && !allowPartial) {
                const first = blocking[0];
                const xsBad = blocking.map((p) => p.x);
                const ysBad = blocking.map((p) => p.y);
                toolError(first.code === "WATER" ? "OBSTRUCTED" : "BAD_SLOPE", `${blocking.length} tuile(s) impossibles : ${first.message}`, {
                    details: { problems: blocking.slice(0, 10) },
                    hint: `Passe level pour une passerelle, ou change de tracé.${landscapeHint(ctx, `terrain_flatten sur (x ${Math.min(...xsBad)}–${Math.max(...xsBad)}, y ${Math.min(...ysBad)}–${Math.max(...ysBad)})`)}`,
                });
            }
            // Simulation d'abord : on ne pose rien si un placement échoue (sauf allowPartial).
            const sim = await placePathTiles(ctx, plan.tiles, { object: pathObject, railings, queue, dryRun: true });
            if (dryRun || (sim.failed > 0 && !allowPartial)) {
                const failures = groupFailures(sim.results);
                return result({
                    budget: BUDGET.write * 2,
                    response: {
                        summary: `${dryRun ? "[simulation] " : "Rien posé : "}${sim.placed} tuile(s) posables, ${sim.failed} en échec, coût estimé ${sim.totalCost}.`,
                        failures,
                        problems: plan.problems.slice(0, 10),
                        slopes: plan.slopes.slice(0, 10),
                        next_hints: failures.map((f) => f.hint).filter(Boolean) as string[],
                    },
                });
            }
            const res = await placePathTiles(ctx, plan.tiles, { object: pathObject, railings, queue, dryRun: false });
            const placed = res.results.filter((r) => r.ok);
            ctx.journal.record({
                tool: "path_build",
                summary: `chemin de ${placed.length} tuile(s)`,
                params: { points, queue },
                inverse: chunks(placed.map((r) => ({ x: r.x, y: r.y, level: plan.tiles.find((t) => t.x === r.x && t.y === r.y)?.level }))).map(
                    (c) => ({ method: "path.remove_tiles", params: { tiles: c } }) as InverseOp,
                ),
                cost: res.totalCost,
            });
            // Vérification intégrée : connectivité locale.
            const bbox = { x1: Math.min(...xs) - 2, y1: Math.min(...ys) - 2, x2: Math.max(...xs) + 2, y2: Math.max(...ys) + 2 };
            const after = await ctx.cache.region(bbox);
            const conn = analyzeConnectivity(after.rect, after.get, []);
            const warnings = plan.problems.filter((p) => p.code === "LEVEL_BREAK").map((p) => p.message);
            return result({
                budget: BUDGET.write * 2,
                response: {
                    summary: `${res.placed} tuile(s) posée(s), ${res.failed} échec(s), coût ${res.totalCost}.`,
                    changed: { tiles: res.placed, cost: res.totalCost },
                    failures: groupFailures(res.results),
                    slopes: cap(plan.slopes, 10).items,
                    localNetwork: { components: conn.components.length, touchesParkEntrance: conn.components.some((c) => c.touchesParkEntrance) },
                    warnings,
                    next_hints: ["Vérifie avec path_check_connectivity ou get_region_map diff: true."],
                },
            });
        },
    );

    defineTool(
        server,
        ctx,
        "path_remove",
        {
            title: "Retirer des chemins",
            description: "Retire les chemins (et files d'attente) d'une liste de tuiles ou d'un rectangle. Tous les niveaux de la tuile si level est omis.",
            input: {
                tiles: z.array(zTile.extend({ level: z.number().int().optional() })).max(500).optional(),
                x1: z.number().int().min(0).optional(),
                y1: z.number().int().min(0).optional(),
                x2: z.number().int().min(0).optional(),
                y2: z.number().int().min(0).optional(),
                dryRun: zDryRun,
            },
        },
        async ({ tiles, x1, y1, x2, y2, dryRun }) => {
            let list = tiles ?? [];
            const removedInfo: { x: number; y: number; level: number; slopeDirection: number | null; queue: boolean }[] = [];
            if (!tiles) {
                if ([x1, y1, x2, y2].some((v) => v === undefined)) toolError("INVALID_PARAMS", "Indique tiles ou x1, y1, x2, y2.");
                const rect = normalizeRect({ x1: x1!, y1: y1!, x2: x2!, y2: y2! });
                if (rectArea(rect) > 64 * 64) toolError("INVALID_PARAMS", "Zone trop grande (max 64×64).");
                const reg = await ctx.cache.region(rect);
                list = [];
                for (let y = rect.y1; y <= rect.y2; y++)
                    for (let x = rect.x1; x <= rect.x2; x++) {
                        const t = reg.get(x, y);
                        for (const p of t?.p ?? []) {
                            list.push({ x, y, level: p.l });
                            removedInfo.push({ x, y, level: p.l, slopeDirection: p.sd >= 0 ? p.sd : null, queue: !!p.q });
                        }
                    }
            }
            if (list.length === 0) return result({ budget: BUDGET.write, response: { summary: "Aucun chemin à retirer." } });
            const parts: BulkResult[] = [];
            for (const c of chunks(list)) parts.push(await ctx.bridge.call("path.remove_tiles", { tiles: c, dryRun }));
            const res = mergeBulk(parts);
            if (!dryRun) {
                ctx.cache.invalidateTiles(list);
                const ok = new Set(res.results.filter((r) => r.ok).map((r) => `${r.x},${r.y}`));
                const restorable = removedInfo.filter((r) => ok.has(`${r.x},${r.y}`));
                ctx.journal.record({
                    tool: "path_remove",
                    summary: `retrait de ${res.placed} tuile(s) de chemin`,
                    params: { count: list.length },
                    inverse: [
                        ...chunks(restorable.filter((r) => !r.queue)).map((c) => ({ method: "path.place_tiles", params: { tiles: c.map(({ x, y, level, slopeDirection }) => ({ x, y, level, slopeDirection })) } }) as InverseOp),
                        ...chunks(restorable.filter((r) => r.queue)).map((c) => ({ method: "path.place_tiles", params: { queue: true, tiles: c.map(({ x, y, level, slopeDirection }) => ({ x, y, level, slopeDirection })) } }) as InverseOp),
                    ],
                    irreversible: restorable.length === 0 ? "liste de tuiles sans état antérieur connu : utilise un checkpoint" : undefined,
                    cost: res.totalCost,
                });
            }
            return result({
                budget: BUDGET.write,
                response: { summary: `${dryRun ? "[simulation] " : ""}${res.placed} retrait(s), ${res.failed} échec(s).`, failures: groupFailures(res.results) },
            });
        },
    );

    // -----------------------------------------------------------------------
    // Scénerie
    // -----------------------------------------------------------------------
    async function objectsByRole(type: string): Promise<Map<string, string>> {
        const r = await ctx.bridge.call("objects.list", { type, loadedOnly: true, limit: 200 });
        const m = new Map<string, string>();
        for (const o of r.items as ObjectInfo[]) {
            const role = roleOf(o);
            if (role && !m.has(role)) m.set(role, o.identifier);
        }
        return m;
    }

    defineTool(
        server,
        ctx,
        "scenery_place",
        {
            title: "Placer de la petite scénerie",
            description:
                "Place jusqu'à 200 éléments de petite scénerie (arbres, buissons, fleurs…). Chaque élément : object (identifiant chargé) OU role " +
                "(tree_conifer, tree_deciduous, shrub, flower…), tuile x/y, quadrant 0-3 (quart de tuile pour les petits objets), direction 0-3, " +
                "level (absent = posé sur le sol), colours. Échecs groupés par cause. Pour remplir une zone, préfère des lots réguliers et variés. " +
                "Exemple : { items: [{ role: 'tree_conifer', x: 61, y: 70 }, { object: 'rct2.scenery_small.tcf', x: 62, y: 70, quadrant: 2 }] }.",
            input: {
                items: z
                    .array(
                        z.object({
                            object: z.string().optional(),
                            role: z.string().optional(),
                            x: z.number().int().min(0),
                            y: z.number().int().min(0),
                            quadrant: z.number().int().min(0).max(3).optional(),
                            direction: z.number().int().min(0).max(3).optional(),
                            level: z.number().int().min(MIN_LEVEL).max(MAX_LEVEL).optional(),
                            colours: z.array(z.number().int().min(0).max(31)).max(3).optional(),
                        }),
                    )
                    .min(1)
                    .max(200),
                dryRun: zDryRun,
            },
        },
        async ({ items, dryRun }) => {
            const needRoles = items.some((i) => !i.object);
            const roles = needRoles ? await objectsByRole("small_scenery") : new Map<string, string>();
            const resolved: SmallSceneryItem[] = [];
            const unresolved: string[] = [];
            for (const it of items) {
                const object = it.object ?? (it.role ? roles.get(it.role) : undefined);
                if (!object) {
                    unresolved.push(it.role ?? "?");
                    continue;
                }
                resolved.push({ object, x: it.x, y: it.y, quadrant: it.quadrant, direction: it.direction as never, level: it.level, colours: it.colours as never });
            }
            if (resolved.length === 0) {
                toolError("OBJECT_NOT_LOADED", `Aucun objet chargé pour les rôles : ${[...new Set(unresolved)].join(", ")}.`, {
                    hint: "list_objects { type: 'small_scenery', role: '…' } puis load_objects.",
                });
            }
            const res = await ctx.bridge.call("scenery.place_small", { items: resolved, dryRun });
            if (!dryRun) {
                ctx.cache.invalidateTiles(resolved, 0);
                const removable = res.results
                    .map((r, i) => ({ r, it: resolved[i] }))
                    .filter(({ r }) => r.ok && r.level !== undefined)
                    .map(({ r, it }) => ({ x: it.x, y: it.y, level: r.level!, object: it.object, quadrant: it.quadrant ?? 0 }));
                ctx.journal.record({
                    tool: "scenery_place",
                    summary: `${res.placed} élément(s) de scénerie`,
                    params: { count: items.length },
                    inverse: chunks(removable).map((c) => ({ method: "scenery.remove_small", params: { items: c } }) as InverseOp),
                    cost: res.totalCost,
                });
            }
            const failures = groupFailures(res.results);
            return result({
                budget: BUDGET.write * 2,
                response: {
                    summary: `${dryRun ? "[simulation] " : ""}${res.placed} placé(s), ${res.failed} échec(s), coût ${res.totalCost}.`,
                    changed: { elements: res.placed, cost: res.totalCost },
                    failures,
                    warnings: unresolved.length ? [`${unresolved.length} élément(s) sans objet pour leur rôle (${[...new Set(unresolved)].join(", ")}).`] : [],
                    next_hints: failures.map((f) => f.hint).filter(Boolean) as string[],
                },
            });
        },
    );

    defineTool(
        server,
        ctx,
        "scenery_remove",
        {
            title: "Retirer de la scénerie",
            description:
                "Retire la scénerie d'un rectangle. kinds : small, large, walls, paths, additions (défaut : small, large, walls). Irréversible par undo_last : " +
                "fais un checkpoint_save avant une grosse suppression.",
            input: {
                ...zRectShape,
                kinds: z.array(z.enum(["small", "large", "walls", "paths", "additions"])).default(["small", "large", "walls"]),
                dryRun: zDryRun,
            },
            destructive: true,
        },
        async ({ x1, y1, x2, y2, kinds, dryRun }) => {
            const mask =
                (kinds.includes("small") ? CLEAR_ITEMS.smallScenery : 0) |
                (kinds.includes("large") ? CLEAR_ITEMS.largeScenery : 0) |
                (kinds.includes("walls") ? CLEAR_ITEMS.walls : 0) |
                (kinds.includes("paths") ? CLEAR_ITEMS.footpath : 0) |
                (kinds.includes("additions") ? CLEAR_ITEMS.footpathAdditions : 0);
            const rect = normalizeRect({ x1, y1, x2, y2 });
            const r = await ctx.bridge.call("scenery.clear_region", { ...rect, items: mask, dryRun });
            if (!r.ok) throw { error: r.error };
            if (!dryRun) {
                ctx.cache.invalidate(rect, 0);
                ctx.journal.record({ tool: "scenery_remove", summary: `nettoyage (${rect.x1},${rect.y1})–(${rect.x2},${rect.y2})`, params: { rect, kinds }, inverse: [], irreversible: "suppression : utilise un checkpoint", cost: r.cost ?? 0 });
            }
            return result({ budget: BUDGET.write, response: { summary: `${dryRun ? "[simulation] " : ""}Zone nettoyée, coût ${r.cost ?? 0}.` } });
        },
    );
}
