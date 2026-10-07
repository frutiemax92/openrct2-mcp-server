// Scénerie générative et mobilier (SPEC 9.3, 9.5, 11) : zones_paint, zones_get, scenery_scatter_zone, path_add_furniture.

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { normalizeRect, rectArea, type BulkResult, type TileRect } from "@openrct2-claude/protocol";
import { z } from "zod";
import { planFurniture, type FurnitureKind } from "../planners/furniture.js";
import { loadRecipes } from "../planners/recipes.js";
import { scatter, type ZoneTile } from "../planners/scatter.js";
import { groupByRole, roleOf } from "../roles.js";
import type { InverseOp } from "../state/journal.js";
import { ZONE_LETTERS, ZONE_TYPES, type ZoneType } from "../state/zones.js";
import { BUDGET, defineTool, result, toolError, zDryRun, type ToolContext } from "./context.js";
import { chunks, groupFailures, loadedObjects, mergeBulk } from "./helpers.js";
import { listRides } from "./observe.js";

const zCoord = z.number().int().min(0).max(1023);
const MAX_SCATTER_TILES = 128 * 128;
const MAX_ZONE_TEXT_SIDE = 64;

const ROLE_SEARCH: Record<string, string> = {
    tree_conifer: "pine",
    tree_deciduous: "tree",
    tree_palm: "palm",
    cactus: "cactus",
    shrub: "bush",
    flower: "flower",
    rock: "rock",
    statue: "statue",
    fountain: "fountain",
};

function optionalRect(a: { x1?: number; y1?: number; x2?: number; y2?: number }): TileRect | null {
    const vals = [a.x1, a.y1, a.x2, a.y2];
    if (vals.every((v) => v === undefined)) return null;
    if (vals.some((v) => v === undefined)) toolError("INVALID_PARAMS", "Rectangle incomplet : donne x1, y1, x2 et y2 (ou aucun).");
    return normalizeRect({ x1: a.x1!, y1: a.y1!, x2: a.x2!, y2: a.y2! });
}

export function registerSceneryTools(server: McpServer, ctx: ToolContext): void {
    const zones = ctx.state.zones;
    const zoneDoc =
        "Types : forest_dense (forêt fermée, masque les bords), forest_edge (lisière clairsemée), meadow (prairie, fleurs et arbres isolés), " +
        "flower_bed (massif dense), lakeshore (berge : rochers et buissons à ≤ 2 tuiles de l'eau), plaza (place : quelques arbres et statues), " +
        "queue_screening (haie le long des files), path_border (bordure de chemin), under_coaster (sous une attraction).";

    defineTool(
        server,
        ctx,
        "zones_paint",
        {
            title: "Peindre des zones",
            description:
                "Attribue un type de zone (intention paysagère) à un rectangle ou un polygone de tuiles, sans rien construire. scenery_scatter_zone " +
                "remplit ensuite les zones selon une recette. type 'none' efface. " +
                zoneDoc +
                " Polygone : sommets en tuiles, une tuile est incluse si son centre est dedans. " +
                "Exemple : { type: 'forest_dense', x1: 2, y1: 2, x2: 20, y2: 10 }.",
            input: {
                type: z.enum([...ZONE_TYPES, "none"]),
                x1: zCoord.optional(),
                y1: zCoord.optional(),
                x2: zCoord.optional(),
                y2: zCoord.optional(),
                polygon: z.array(z.object({ x: zCoord, y: zCoord })).min(3).max(64).optional(),
            },
        },
        async (a) => {
            const rect = optionalRect(a);
            if (!rect && !a.polygon) toolError("INVALID_PARAMS", "Donne un rectangle (x1..y2) ou un polygone.");
            const clamped = rect ? await ctx.cache.clamp(rect) : undefined;
            const n = zones.paint({ rect: clamped, polygon: a.polygon }, a.type === "none" ? null : a.type);
            return result({
                budget: BUDGET.write,
                response: {
                    summary: `${n} tuile(s) ${a.type === "none" ? "effacée(s)" : `marquée(s) « ${a.type} »`}.`,
                    zones: zones.summary().slice(0, 12),
                    next_hints: a.type === "none" ? [] : ["scenery_scatter_zone { zoneType: '" + a.type + "' } pour remplir (dryRun d'abord)."],
                },
            });
        },
    );

    defineTool(
        server,
        ctx,
        "zones_get",
        {
            title: "Lire les zones",
            description:
                "Résumé des zones peintes (type, nombre de tuiles, rectangle englobant). Avec un rectangle (≤ 64×64) : carte texte, une lettre par " +
                "tuile (F forest_dense, f forest_edge, m meadow, * flower_bed, l lakeshore, p plaza, q queue_screening, b path_border, " +
                "u under_coaster ; # chemin, R attraction, ~ eau, . rien).",
            input: { x1: zCoord.optional(), y1: zCoord.optional(), x2: zCoord.optional(), y2: zCoord.optional() },
            readOnly: true,
        },
        async (a) => {
            const rect = optionalRect(a);
            const response = { summary: `${zones.size} tuile(s) en zones.`, zones: zones.summary().slice(0, 20) };
            if (!rect) return result({ response });
            const r = await ctx.cache.clamp(rect);
            if (r.x2 - r.x1 + 1 > MAX_ZONE_TEXT_SIDE || r.y2 - r.y1 + 1 > MAX_ZONE_TEXT_SIDE) toolError("INVALID_PARAMS", `Carte limitée à ${MAX_ZONE_TEXT_SIDE}×${MAX_ZONE_TEXT_SIDE}.`);
            const reg = await ctx.cache.region(r);
            const lines: string[] = [];
            for (let y = r.y1; y <= r.y2; y++) {
                let row = "";
                for (let x = r.x1; x <= r.x2; x++) {
                    const zt = zones.get(x, y);
                    const t = reg.get(x, y);
                    row += zt ? ZONE_LETTERS[zt] : t?.p?.length ? "#" : t?.r?.length || t?.e?.length ? "R" : t && t.w > t.h ? "~" : ".";
                }
                lines.push(`${String(y).padStart(4)} ${row}`);
            }
            return result({ response: { ...response, rect: r, xStart: r.x1 }, extraText: lines.join("\n") });
        },
    );

    defineTool(
        server,
        ctx,
        "scenery_scatter_zone",
        {
            title: "Remplir une zone de scénerie",
            description:
                "Génère et place la scénerie d'une zone selon une recette thématique (Poisson-disc à rayon variable, bruit de densité, couches " +
                "arbres/buissons/fleurs/rochers, dégagements automatiques autour des chemins, entrées, carrefours et files). Déterministe pour un " +
                "seed donné. Trois façons de choisir les tuiles : (1) zoneType + rectangle : remplit le rectangle avec ce type, sans peinture " +
                "préalable ; (2) rectangle seul : zones peintes dans le rectangle ; (3) zoneType seul ou rien : toutes les zones peintes (de ce type). " +
                "theme : temperate (défaut), tropical, desert, western, formal. densityScale module la densité (0.25 à 3). Les rôles sans objet " +
                "chargé sont remplacés par un rôle voisin ou signalés. dryRun conseillé d'abord. " +
                "Exemple : { zoneType: 'forest_dense', x1: 2, y1: 2, x2: 20, y2: 10, seed: 3 }.",
            input: {
                zoneType: z.enum(ZONE_TYPES).optional(),
                x1: zCoord.optional(),
                y1: zCoord.optional(),
                x2: zCoord.optional(),
                y2: zCoord.optional(),
                theme: z.string().max(32).default("temperate"),
                seed: z.number().int().default(1),
                densityScale: z.number().min(0.25).max(3).default(1),
                maxItems: z.number().int().min(1).max(1500).default(800),
                dryRun: zDryRun,
            },
        },
        async (a) => {
            const { recipes, errors } = loadRecipes();
            const recipe = recipes.get(a.theme);
            if (!recipe) toolError("NOT_FOUND", `Thème « ${a.theme} » inconnu.`, { hint: `Thèmes : ${[...recipes.keys()].join(", ")}.`, details: errors.length ? { errors } : undefined });
            const rect = optionalRect(a);
            let tiles: ZoneTile[];
            if (rect && a.zoneType) {
                const r = await ctx.cache.clamp(rect);
                tiles = [];
                for (let y = r.y1; y <= r.y2; y++) for (let x = r.x1; x <= r.x2; x++) tiles.push({ x, y, zone: a.zoneType });
            } else tiles = zones.list(rect ?? undefined, a.zoneType as ZoneType | undefined);
            if (tiles.length === 0) {
                toolError("NOT_FOUND", "Aucune tuile à remplir.", { hint: "Peins d'abord avec zones_paint, ou donne zoneType ET un rectangle." });
            }
            if (tiles.length > MAX_SCATTER_TILES) toolError("INVALID_PARAMS", `Trop de tuiles (${tiles.length}, max ${MAX_SCATTER_TILES}).`, { hint: "Découpe par rectangle." });
            const bbox = {
                x1: Math.min(...tiles.map((t) => t.x)) - 6,
                y1: Math.min(...tiles.map((t) => t.y)) - 6,
                x2: Math.max(...tiles.map((t) => t.x)) + 6,
                y2: Math.max(...tiles.map((t) => t.y)) + 6,
            };
            const reg = await ctx.cache.region(bbox);
            const objects = groupByRole(await loadedObjects(ctx, "small_scenery"));
            const plan = scatter({
                tiles,
                get: reg.get,
                recipe: recipe!,
                objects,
                seed: a.seed,
                densityScale: a.densityScale,
                maxItems: a.maxItems,
                sandbox: ctx.state.mode === "sandbox",
            });
            const missing = Object.entries(plan.substitutions).filter(([, v]) => v === null).map(([k]) => k);
            const replaced = Object.entries(plan.substitutions).filter(([, v]) => v !== null).map(([k, v]) => `${k}→${v}`);
            const warnings: string[] = [];
            if (missing.length) warnings.push(`Aucun objet chargé pour : ${missing.join(", ")} (couche ignorée).`);
            if (replaced.length) warnings.push(`Rôles remplacés : ${replaced.join(", ")}.`);
            if (plan.truncated) warnings.push(`Plafond de ${a.maxItems} éléments atteint : relance sur le reste ou augmente maxItems.`);
            const hints: string[] = missing.map((m) => `list_objects { type: 'small_scenery', query: '${ROLE_SEARCH[m] ?? m}' } puis load_objects pour ajouter « ${m} ».`);
            if (plan.items.length === 0) {
                return result({
                    budget: BUDGET.write * 2,
                    response: {
                        summary: `Rien à placer : ${plan.eligibleTiles} tuile(s) éligible(s) sur ${tiles.length}.`,
                        skipped: plan.skipped,
                        warnings,
                        next_hints: hints.length ? hints : ["Augmente densityScale, ou vérifie la zone (chemins, eau, terrain non possédé)."],
                    },
                });
            }
            const parts: BulkResult[] = [];
            for (const c of chunks(plan.items)) parts.push(await ctx.bridge.call("scenery.place_small", { items: c, dryRun: a.dryRun }));
            const res = mergeBulk(parts);
            if (!a.dryRun) {
                ctx.cache.invalidateTiles(plan.items, 0);
                const removable = res.results
                    .map((r, i) => ({ r, it: plan.items[i] }))
                    .filter(({ r }) => r.ok && r.level !== undefined)
                    .map(({ r, it }) => ({ x: it.x, y: it.y, level: r.level!, object: it.object, quadrant: it.quadrant ?? 0 }));
                ctx.journal.record({
                    tool: "scenery_scatter_zone",
                    summary: `${res.placed} élément(s) générés (${a.zoneType ?? "zones"}, ${a.theme}, seed ${a.seed})`,
                    params: { zoneType: a.zoneType, rect, theme: a.theme, seed: a.seed },
                    inverse: chunks(removable).map((c) => ({ method: "scenery.remove_small", params: { items: c } }) as InverseOp),
                    cost: res.totalCost,
                });
            }
            const failures = groupFailures(res.results);
            return result({
                budget: BUDGET.write * 2,
                response: {
                    summary: `${a.dryRun ? "[simulation] " : ""}${res.placed} élément(s) ${a.dryRun ? "posables" : "placé(s)"} sur ${plan.eligibleTiles} tuile(s) éligible(s), ${res.failed} échec(s), coût ${res.totalCost}.`,
                    byRole: plan.byRole,
                    density: Math.round((res.placed / Math.max(1, plan.eligibleTiles)) * 100) / 100,
                    changed: { elements: a.dryRun ? 0 : res.placed, cost: res.totalCost },
                    skipped: plan.skipped,
                    failures,
                    warnings,
                    next_hints: [...hints, a.dryRun ? "Relance sans dryRun pour placer." : "Juge l'ambiance avec capture_view ; undo_last pour annuler, autre seed pour varier."],
                },
            });
        },
    );

    defineTool(
        server,
        ctx,
        "path_add_furniture",
        {
            title: "Mobilier de chemin",
            description:
                "Pose bancs, poubelles et lampadaires le long des chemins d'une zone, à intervalles réguliers (spacing en tuiles, distance de " +
                "Manhattan). Bancs de préférence près des sorties d'attractions et face à un espace libre ; poubelles à côté des bancs et des " +
                "boutiques ; lampadaires partout. Respecte les règles du jeu : une addition par tuile, pas sur un carrefour à 4 branches, pas de " +
                "banc/poubelle sur une rampe, pas sur les files (sauf includeQueues). Tient compte du mobilier existant. " +
                "Exemple : { x1: 30, y1: 30, x2: 70, y2: 60 }.",
            input: {
                x1: zCoord,
                y1: zCoord,
                x2: zCoord,
                y2: zCoord,
                kinds: z.array(z.enum(["bench", "bin", "lamp"])).min(1).default(["bench", "bin", "lamp"]),
                spacing: z
                    .object({ bench: z.number().int().min(2).max(20), bin: z.number().int().min(2).max(20), lamp: z.number().int().min(2).max(20) })
                    .partial()
                    .default({}),
                objects: z.object({ bench: z.string(), bin: z.string(), lamp: z.string() }).partial().default({}),
                includeQueues: z.boolean().default(false),
                dryRun: zDryRun,
            },
        },
        async (a) => {
            const rect = await ctx.cache.clamp({ x1: a.x1, y1: a.y1, x2: a.x2, y2: a.y2 });
            if (rectArea(rect) > MAX_SCATTER_TILES) toolError("INVALID_PARAMS", "Zone trop grande (max 128×128).");
            const reg = await ctx.cache.region(rect);
            const additions = await loadedObjects(ctx, "footpath_addition");
            const byIndex = new Map(additions.filter((o) => o.index !== null).map((o) => [o.index!, roleOf(o)]));
            const roleFor: Record<FurnitureKind, string> = { bench: "bench", bin: "bin", lamp: "lamp_post" };
            const objectFor = {} as Record<FurnitureKind, string | undefined>;
            for (const k of ["bench", "bin", "lamp"] as FurnitureKind[]) {
                objectFor[k] = a.objects[k] ?? additions.find((o) => roleOf(o) === roleFor[k])?.identifier;
            }
            const kinds = a.kinds.filter((k) => objectFor[k]);
            const missing = a.kinds.filter((k) => !objectFor[k]);
            if (kinds.length === 0) {
                toolError("OBJECT_NOT_LOADED", `Aucun objet chargé pour : ${missing.join(", ")}.`, { hint: "list_objects { type: 'footpath_addition' } puis load_objects." });
            }
            const rides = await listRides(ctx);
            const hotspots = rides.flatMap((r) =>
                r.classification === "ride" ? r.stations.flatMap((s) => (s.exit ? [s.exit] : [])) : r.stations.flatMap((s) => (s.start ? [s.start] : [])),
            );
            const plan = planFurniture({
                rect,
                get: reg.get,
                kinds,
                spacing: { bench: a.spacing.bench ?? 6, bin: a.spacing.bin ?? 6, lamp: a.spacing.lamp ?? 4 },
                existingRole: (i) => byIndex.get(i) ?? null,
                hotspots,
                includeQueues: a.includeQueues,
            });
            const parts: BulkResult[] = [];
            const placedByKind: Record<string, number> = {};
            const inverseTiles: { x: number; y: number; level: number }[] = [];
            for (const k of kinds) {
                const slots = plan.slots.filter((s) => s.kind === k);
                for (const c of chunks(slots)) {
                    const r = await ctx.bridge.call("path.place_addition", { tiles: c.map(({ x, y, level }) => ({ x, y, level })), object: objectFor[k]!, dryRun: a.dryRun });
                    parts.push(r);
                    placedByKind[k] = (placedByKind[k] ?? 0) + r.placed;
                    r.results.forEach((o, i) => o.ok && inverseTiles.push({ x: c[i].x, y: c[i].y, level: c[i].level }));
                }
            }
            const res = parts.length ? mergeBulk(parts) : { dryRun: a.dryRun, results: [], placed: 0, failed: 0, totalCost: 0 };
            if (!a.dryRun && res.placed) {
                ctx.cache.invalidateTiles(inverseTiles, 0);
                ctx.journal.record({
                    tool: "path_add_furniture",
                    summary: `${res.placed} élément(s) de mobilier`,
                    params: { rect, kinds },
                    inverse: chunks(inverseTiles).map((c) => ({ method: "path.remove_addition", params: { tiles: c } }) as InverseOp),
                    cost: res.totalCost,
                });
            }
            return result({
                budget: BUDGET.write * 2,
                response: {
                    summary: `${a.dryRun ? "[simulation] " : ""}${res.placed} élément(s) de mobilier (${Object.entries(placedByKind).map(([k, n]) => `${n} ${k}`).join(", ") || "aucun"}), ${res.failed} échec(s), coût ${res.totalCost}.`,
                    placed: placedByKind,
                    existing: plan.existing,
                    pathTilesConsidered: plan.candidates,
                    changed: { elements: a.dryRun ? 0 : res.placed, cost: res.totalCost },
                    failures: groupFailures(res.results),
                    warnings: missing.length ? [`Pas d'objet chargé pour : ${missing.join(", ")}.`] : [],
                },
            });
        },
    );
}
