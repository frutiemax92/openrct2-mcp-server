// Générateur de scénerie déterministe (SPEC 11.3) : Claude compose (zones, recettes), le générateur place.
//
// Échantillonnage « dart throwing » (Poisson-disc à rayon variable) sur les quadrants des tuiles, densité modulée
// par un bruit cohérent et par la distance aux bords de zone et aux chemins, couches d'objets par rôle, et
// dégagements fonctionnels (entrées, intersections, files, prolongements d'impasses).

import { DIRECTION_DELTA, type RegionTile, type SmallSceneryItem, type TileRect } from "@openrct2-claude/protocol";
import type { RoleObject } from "../roles.js";
import { fractalNoise } from "./heightmap.js";

export interface RecipeLayer {
    role: string;
    /** Part relative de la couche (normalisée sur les couches disponibles). */
    share: number;
    /** Espacement minimal en tuiles entre deux éléments de cette couche (ou d'une couche plus grande). */
    minSpacing: number;
    /** Rôles de repli si aucun objet chargé n'a ce rôle. */
    fallback?: string[];
}

export interface ZoneRecipe {
    /** Éléments attendus par tuile (0 à ~2) avant modulation. */
    density: number;
    layers: RecipeLayer[];
    /** Bruit de densité : échelle en tuiles, force 0-1. */
    noise?: { scale: number; strength: number };
    /** Atténuation près du bord de la zone : distance en tuiles et densité minimale au bord (0-1). */
    edge?: { falloff: number; min: number };
    /** > 0 : plus dense près des chemins ; < 0 : plus clairsemé. */
    pathAffinity?: number;
    /** Dégagements en tuiles (distance de Manhattan) : rien à moins de cette distance. */
    clearances?: Partial<Clearances>;
    /** Contraintes d'emplacement : distance maximale à un chemin, à une file, à l'eau, à une attraction. */
    require?: { pathMax?: number; queueMax?: number; waterMax?: number; rideMax?: number };
    /** Nombre d'objets différents par rôle (cohérence visuelle). */
    variety?: number;
}

export interface Recipe {
    theme: string;
    description: string;
    zones: Record<string, ZoneRecipe>;
}

export interface Clearances {
    /** Chemins ordinaires (1 = pas sur le chemin ; 2 = une tuile libre le long du chemin). */
    path: number;
    queue: number;
    /** Entrées et sorties d'attractions, entrée du parc. */
    entrance: number;
    /** Carrefours (chemin à 3 ou 4 bords). */
    intersection: number;
    /** Pièces d'attraction. */
    ride: number;
}

export const MAX_SPACING = 4;

export const DEFAULT_CLEARANCES: Clearances = { path: 1, queue: 1, entrance: 2, intersection: 2, ride: 1 };

/** Une tuile candidate et son type de zone. */
export interface ZoneTile {
    x: number;
    y: number;
    zone: string;
}

export interface ScatterInput {
    tiles: ZoneTile[];
    get: (x: number, y: number) => RegionTile | undefined;
    recipe: Recipe;
    objects: Map<string, RoleObject[]>;
    seed: number;
    densityScale?: number;
    maxItems?: number;
    sandbox?: boolean;
}

export interface ScatterOutput {
    items: SmallSceneryItem[];
    byRole: Record<string, number>;
    eligibleTiles: number;
    skipped: Record<string, number>;
    /** Rôle demandé → rôle utilisé (repli) ou null (aucun objet). */
    substitutions: Record<string, string | null>;
    truncated: boolean;
}

/** Générateur pseudo-aléatoire déterministe (mulberry32). */
export function rng(seed: number): () => number {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/** Champ de distance de Manhattan (BFS 4-connexe) depuis des tuiles sources, dans un rectangle. */
export function distanceField(rect: TileRect, isSource: (x: number, y: number) => boolean, cap = 16): (x: number, y: number) => number {
    const w = rect.x2 - rect.x1 + 1;
    const h = rect.y2 - rect.y1 + 1;
    const dist = new Uint8Array(w * h).fill(255);
    const queue: number[] = [];
    for (let y = rect.y1; y <= rect.y2; y++)
        for (let x = rect.x1; x <= rect.x2; x++)
            if (isSource(x, y)) {
                const i = (y - rect.y1) * w + (x - rect.x1);
                dist[i] = 0;
                queue.push(i);
            }
    for (let qi = 0; qi < queue.length; qi++) {
        const i = queue[qi];
        const d = dist[i];
        if (d >= cap) continue;
        const x = i % w;
        const y = (i / w) | 0;
        for (const dd of DIRECTION_DELTA) {
            const nx = x + dd.x;
            const ny = y + dd.y;
            if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
            const j = ny * w + nx;
            if (dist[j] > d + 1) {
                dist[j] = d + 1;
                queue.push(j);
            }
        }
    }
    return (x, y) => {
        if (x < rect.x1 || y < rect.y1 || x > rect.x2 || y > rect.y2) return 255;
        return dist[(y - rect.y1) * w + (x - rect.x1)];
    };
}

const popcount = (n: number) => (n & 1) + ((n >> 1) & 1) + ((n >> 2) & 1) + ((n >> 3) & 1);

/** Centre d'un quadrant en fraction de tuile (Scenery.cpp, SceneryQuadrantOffsets : {8,8},{8,24},{24,24},{24,8}). */
const QUADRANT_CENTER: readonly [number, number][] = [
    [0.25, 0.25],
    [0.25, 0.75],
    [0.75, 0.75],
    [0.75, 0.25],
];

interface Placed {
    px: number;
    py: number;
    spacing: number;
    fullTile: boolean;
}

/** Choix des couches disponibles d'une zone, avec replis. */
function resolveLayers(
    zone: ZoneRecipe,
    objects: Map<string, RoleObject[]>,
    substitutions: Record<string, string | null>,
    pick: (list: RoleObject[], n: number) => RoleObject[],
): { layer: RecipeLayer; objects: RoleObject[]; weight: number }[] {
    const out: { layer: RecipeLayer; objects: RoleObject[]; weight: number }[] = [];
    for (const layer of zone.layers) {
        let role: string | null = null;
        for (const r of [layer.role, ...(layer.fallback ?? [])]) {
            if (objects.get(r)?.length) {
                role = r;
                break;
            }
        }
        if (role !== layer.role) substitutions[layer.role] = role;
        if (!role) continue;
        out.push({ layer, objects: pick(objects.get(role)!, zone.variety ?? 3), weight: layer.share });
    }
    const total = out.reduce((s, l) => s + l.weight, 0);
    for (const l of out) l.weight /= total || 1;
    return out;
}

export function scatter(input: ScatterInput): ScatterOutput {
    const { tiles, get, recipe } = input;
    const out: ScatterOutput = { items: [], byRole: {}, eligibleTiles: 0, skipped: {}, substitutions: {}, truncated: false };
    if (tiles.length === 0) return out;
    const skip = (why: string) => (out.skipped[why] = (out.skipped[why] ?? 0) + 1);
    const maxItems = input.maxItems ?? 1000;
    const densityScale = input.densityScale ?? 1;

    // Rectangle englobant + marge pour les champs de distance.
    const margin = 6;
    const bbox: TileRect = {
        x1: Math.min(...tiles.map((t) => t.x)) - margin,
        y1: Math.min(...tiles.map((t) => t.y)) - margin,
        x2: Math.max(...tiles.map((t) => t.x)) + margin,
        y2: Math.max(...tiles.map((t) => t.y)) + margin,
    };
    const dPath = distanceField(bbox, (x, y) => !!get(x, y)?.p?.some((p) => !p.q));
    const dQueue = distanceField(bbox, (x, y) => !!get(x, y)?.p?.some((p) => p.q));
    const dEntrance = distanceField(bbox, (x, y) => !!get(x, y)?.e?.length);
    const dRide = distanceField(bbox, (x, y) => !!get(x, y)?.r?.length);
    const dWater = distanceField(bbox, (x, y) => {
        const t = get(x, y);
        return !!t && t.w > t.h;
    });
    const dInter = distanceField(bbox, (x, y) => !!get(x, y)?.p?.some((p) => !p.q && popcount(p.e) >= 3));
    // Prolongement des impasses : la tuile au-delà du dernier bord reste libre pour un futur raccord.
    const reserved = new Set<string>();
    for (let y = bbox.y1; y <= bbox.y2; y++)
        for (let x = bbox.x1; x <= bbox.x2; x++)
            for (const p of get(x, y)?.p ?? []) {
                if (p.q || popcount(p.e) !== 1) continue;
                const d = [0, 1, 2, 3].find((k) => p.e & (1 << k))!;
                const opp = DIRECTION_DELTA[(d + 2) & 3];
                reserved.add(`${x + opp.x},${y + opp.y}`);
            }
    // Distance au bord de la zone (tuiles hors de la même zone).
    const zoneOf = new Map(tiles.map((t) => [`${t.x},${t.y}`, t.zone]));
    const zoneEdgeDist = new Map<string, number>();
    for (const zone of new Set(tiles.map((t) => t.zone))) {
        const d = distanceField(bbox, (x, y) => zoneOf.get(`${x},${y}`) !== zone);
        for (const t of tiles) if (t.zone === zone) zoneEdgeDist.set(`${t.x},${t.y}`, d(t.x, t.y));
    }

    const rand = rng(input.seed);
    const noise = fractalNoise(input.seed + 7);
    const spacingNoise = fractalNoise(input.seed + 101);
    const pick = (list: RoleObject[], n: number) => {
        const r = rng(input.seed + list.length * 31);
        const copy = [...list];
        for (let i = copy.length - 1; i > 0; i--) {
            const j = Math.floor(r() * (i + 1));
            [copy[i], copy[j]] = [copy[j], copy[i]];
        }
        return copy.slice(0, Math.max(1, n));
    };
    const layersByZone = new Map<string, ReturnType<typeof resolveLayers>>();
    for (const z of new Set(tiles.map((t) => t.zone))) {
        const zr = recipe.zones[z];
        layersByZone.set(z, zr ? resolveLayers(zr, input.objects, out.substitutions, pick) : []);
    }

    // Candidats : quadrants des tuiles éligibles, en ordre pseudo-aléatoire.
    type Slot = { x: number; y: number; q: number; zone: string; local: number };
    const slots: Slot[] = [];
    for (const t of tiles) {
        const zr = recipe.zones[t.zone];
        if (!zr) {
            skip("zone sans recette");
            continue;
        }
        const tile = get(t.x, t.y);
        if (!tile) continue;
        const why = blocked(t.x, t.y, tile, zr, input.sandbox ?? false);
        if (why) {
            skip(why);
            continue;
        }
        if (reserved.has(`${t.x},${t.y}`)) {
            skip("prolongement d'impasse");
            continue;
        }
        const c = { ...DEFAULT_CLEARANCES, ...zr.clearances };
        if (dPath(t.x, t.y) < c.path || dQueue(t.x, t.y) < c.queue || dEntrance(t.x, t.y) < c.entrance || dInter(t.x, t.y) < c.intersection || dRide(t.x, t.y) < c.ride) {
            skip("dégagement");
            continue;
        }
        const req = zr.require ?? {};
        if ((req.pathMax !== undefined && dPath(t.x, t.y) > req.pathMax) || (req.queueMax !== undefined && dQueue(t.x, t.y) > req.queueMax) || (req.waterMax !== undefined && dWater(t.x, t.y) > req.waterMax) || (req.rideMax !== undefined && dRide(t.x, t.y) > req.rideMax)) {
            skip("hors de la bande demandée");
            continue;
        }
        // Densité locale (éléments par tuile).
        let local = zr.density * densityScale;
        if (zr.noise) local *= Math.max(0, 1 + zr.noise.strength * noise(t.x / zr.noise.scale, t.y / zr.noise.scale));
        if (zr.edge && zr.edge.falloff > 0) {
            const e = zoneEdgeDist.get(`${t.x},${t.y}`) ?? 99;
            local *= zr.edge.min + (1 - zr.edge.min) * Math.min(1, (e - 1) / zr.edge.falloff);
        }
        if (zr.pathAffinity) {
            const near = 1 - Math.min(dPath(t.x, t.y), 4) / 4;
            local *= Math.max(0.1, 1 + zr.pathAffinity * near);
        }
        out.eligibleTiles++;
        for (let q = 0; q < 4; q++) slots.push({ x: t.x, y: t.y, q, zone: t.zone, local });
    }
    for (let i = slots.length - 1; i > 0; i--) {
        const j = Math.floor(rand() * (i + 1));
        [slots[i], slots[j]] = [slots[j], slots[i]];
    }

    // Grille d'accélération pour les tests d'espacement.
    const cell = new Map<string, Placed[]>();
    const cellKey = (px: number, py: number) => `${Math.floor(px / 2)},${Math.floor(py / 2)}`;
    const tileState = new Map<string, { full: boolean; quadrants: number }>();
    // Même classe (arbre/arbre, plante/plante) : le plus grand des deux espacements ; classes différentes : le plus
    // petit (sous-bois au pied des arbres). Espacements plafonnés à MAX_SPACING : 2 cellules de 2 tuiles suffisent.
    const tooClose = (px: number, py: number, spacing: number, fullTile: boolean): boolean => {
        const cx = Math.floor(px / 2);
        const cy = Math.floor(py / 2);
        for (let dy = -2; dy <= 2; dy++)
            for (let dx = -2; dx <= 2; dx++)
                for (const p of cell.get(`${cx + dx},${cy + dy}`) ?? []) {
                    const need = p.fullTile === fullTile ? Math.max(spacing, p.spacing) : Math.min(spacing, p.spacing);
                    if (Math.hypot(px - p.px, py - p.py) < need - 1e-6) return true;
                }
        return false;
    };

    for (const s of slots) {
        if (out.items.length >= maxItems) {
            out.truncated = true;
            break;
        }
        if (rand() >= s.local / 4) continue;
        const layers = layersByZone.get(s.zone)!;
        if (!layers.length) continue;
        let roll = rand();
        let chosen = layers[layers.length - 1];
        for (const l of layers) {
            roll -= l.weight;
            if (roll <= 0) {
                chosen = l;
                break;
            }
        }
        const obj = chosen.objects[Math.floor(rand() * chosen.objects.length)];
        const tile = get(s.x, s.y)!;
        if (obj.flatOnly && tile.s) continue;
        const key = `${s.x},${s.y}`;
        const st = tileState.get(key) ?? { full: false, quadrants: 0 };
        if (st.full || (obj.fullTile && st.quadrants) || st.quadrants & (1 << s.q)) continue;
        const [fx, fy] = obj.fullTile ? [0.5, 0.5] : QUADRANT_CENTER[s.q];
        const px = s.x + fx;
        const py = s.y + fy;
        // Rayon variable : le bruit élargit ou resserre l'espacement (bosquets et clairières).
        const spacing = Math.min(MAX_SPACING, chosen.layer.minSpacing * (1 + 0.35 * spacingNoise(s.x / 5, s.y / 5)));
        if (tooClose(px, py, spacing, obj.fullTile)) continue;
        if (obj.fullTile) st.full = true;
        else st.quadrants |= 1 << s.q;
        tileState.set(key, st);
        const placed: Placed = { px, py, spacing, fullTile: obj.fullTile };
        const ck = cellKey(px, py);
        (cell.get(ck) ?? cell.set(ck, []).get(ck)!).push(placed);
        const item: SmallSceneryItem = { object: obj.identifier, x: s.x, y: s.y, quadrant: obj.fullTile ? 0 : s.q };
        if (obj.rotatable || obj.fullTile) item.direction = Math.floor(rand() * 4) as SmallSceneryItem["direction"];
        out.items.push(item);
        out.byRole[chosen.layer.role] = (out.byRole[chosen.layer.role] ?? 0) + 1;
    }
    return out;
}

/** Raison d'exclure une tuile, ou null. */
function blocked(_x: number, _y: number, t: RegionTile, _zr: ZoneRecipe, sandbox: boolean): string | null {
    if (!(t.o & 1) && !sandbox) return "terrain non possédé";
    if (t.w > t.h) return "eau";
    if (t.p?.length) return "chemin";
    if (t.r?.length || t.e?.length) return "attraction";
    if (t.lg || t.sc || t.wl) return "scénerie existante";
    return null;
}
