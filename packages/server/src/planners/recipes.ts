// Recettes thématiques (SPEC 11.4) : data/recipes/<thème>.json, paramétrées par des rôles d'objets.

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import type { Recipe } from "./scatter.js";

const layerSchema = z.object({
    role: z.string(),
    share: z.number().positive(),
    minSpacing: z.number().min(0.25).max(4),
    fallback: z.array(z.string()).optional(),
});

const zoneSchema = z.object({
    density: z.number().min(0).max(4),
    layers: z.array(layerSchema).min(1),
    noise: z.object({ scale: z.number().positive(), strength: z.number().min(0).max(1) }).optional(),
    edge: z.object({ falloff: z.number().min(0), min: z.number().min(0).max(1) }).optional(),
    pathAffinity: z.number().min(-1).max(2).optional(),
    clearances: z
        .object({ path: z.number().int().min(0), queue: z.number().int().min(0), entrance: z.number().int().min(0), intersection: z.number().int().min(0), ride: z.number().int().min(0) })
        .partial()
        .optional(),
    require: z.object({ pathMax: z.number(), queueMax: z.number(), waterMax: z.number(), rideMax: z.number() }).partial().optional(),
    variety: z.number().int().min(1).max(8).optional(),
});

const recipeSchema = z.object({ theme: z.string(), description: z.string(), zones: z.record(zoneSchema) });

let cache: Map<string, Recipe> | null = null;

export function recipesDir(): string {
    const here = dirname(fileURLToPath(import.meta.url));
    return resolve(join(here, "..", "..", "..", "..", "data", "recipes"));
}

/** Charge et valide les recettes (une fois). Une recette invalide est ignorée et signalée. */
export function loadRecipes(dir = recipesDir()): { recipes: Map<string, Recipe>; errors: string[] } {
    const errors: string[] = [];
    if (cache && dir === recipesDir()) return { recipes: cache, errors };
    const recipes = new Map<string, Recipe>();
    if (existsSync(dir)) {
        for (const f of readdirSync(dir).filter((f) => f.endsWith(".json")).sort()) {
            try {
                const r = recipeSchema.parse(JSON.parse(readFileSync(join(dir, f), "utf8")));
                recipes.set(r.theme, r);
            } catch (e) {
                errors.push(`${f} : ${e instanceof Error ? e.message.slice(0, 200) : String(e)}`);
            }
        }
    }
    if (dir === recipesDir()) cache = recipes;
    return { recipes, errors };
}
