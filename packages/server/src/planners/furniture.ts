// Mobilier de chemin (SPEC 9.3, path_add_furniture) : bancs, poubelles et lampadaires à intervalles réguliers.
//
// Règles du jeu (actions/footpath/FootpathAdditionPlaceAction.cpp) : une seule addition par tuile de chemin ;
// interdite sur une tuile raccordée des quatre côtés (sauf fontaines) ; bancs et poubelles refusés sur les rampes
// (drapeau dontAllowOnSlope des objets courants) ; files d'attente réservées aux écrans de file.

import { DIRECTION_DELTA, type RegionTile, type TileRect } from "@openrct2-claude/protocol";

export type FurnitureKind = "bench" | "bin" | "lamp";

export interface FurnitureSlot {
    x: number;
    y: number;
    level: number;
    kind: FurnitureKind;
}

export interface FurniturePlanInput {
    rect: TileRect;
    get: (x: number, y: number) => RegionTile | undefined;
    kinds: FurnitureKind[];
    spacing: Record<FurnitureKind, number>;
    /** Rôle des additions déjà posées, par index d'objet chargé. */
    existingRole: (index: number) => string | null;
    /** Tuiles d'accès aux boutiques et sorties d'attractions (bancs et poubelles à proximité). */
    hotspots: { x: number; y: number }[];
    includeQueues?: boolean;
}

export interface FurniturePlan {
    slots: FurnitureSlot[];
    candidates: number;
    existing: Record<FurnitureKind, number>;
}

const ROLE_KIND: Record<string, FurnitureKind> = { bench: "bench", bin: "bin", lamp_post: "lamp" };
const popcount = (n: number) => (n & 1) + ((n >> 1) & 1) + ((n >> 2) & 1) + ((n >> 3) & 1);

export function planFurniture(input: FurniturePlanInput): FurniturePlan {
    const { rect, get } = input;
    interface Tile {
        x: number;
        y: number;
        level: number;
        edges: number;
        sloped: boolean;
    }
    const free: Tile[] = [];
    const taken: { x: number; y: number; kind: FurnitureKind }[] = [];
    const existing: Record<FurnitureKind, number> = { bench: 0, bin: 0, lamp: 0 };
    for (let y = rect.y1; y <= rect.y2; y++)
        for (let x = rect.x1; x <= rect.x2; x++) {
            const p = get(x, y)?.p?.[0];
            if (!p) continue;
            if (p.a >= 0) {
                const kind = ROLE_KIND[input.existingRole(p.a) ?? ""];
                if (kind) {
                    taken.push({ x, y, kind });
                    existing[kind]++;
                }
                continue;
            }
            if (p.q && !input.includeQueues) continue;
            if (p.e === 0xf || p.e === 0) continue;
            free.push({ x, y, level: p.l, edges: p.e, sloped: p.sd >= 0 });
        }
    const candidates = free.length;
    const near = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
    const hot = (t: Tile, d: number) => input.hotspots.some((h) => near(h, t) <= d);
    const straight = (t: Tile) => popcount(t.edges) === 2 && (t.edges === 0b0101 || t.edges === 0b1010);
    // Un banc regarde de préférence vers un espace non construit (vue sur la scénerie).
    const openSide = (t: Tile) =>
        DIRECTION_DELTA.some((d, k) => !(t.edges & (1 << k)) && !get(t.x + d.x, t.y + d.y)?.p?.length && !get(t.x + d.x, t.y + d.y)?.r?.length);

    const slots: FurnitureSlot[] = [];
    const used = new Set<string>();
    const order: FurnitureKind[] = ["bench", "bin", "lamp"];
    for (const kind of order) {
        if (!input.kinds.includes(kind)) continue;
        const spacing = input.spacing[kind];
        const score = (t: Tile): number => {
            if (kind === "bench") return (hot(t, 3) ? 2 : 0) + (straight(t) ? 1 : 0) + (openSide(t) ? 1 : 0);
            if (kind === "bin") return (slots.some((s) => s.kind === "bench" && near(s, t) === 1) ? 3 : 0) + (hot(t, 2) ? 2 : 0);
            return straight(t) ? 1 : 0;
        };
        const list = free
            .filter((t) => !used.has(`${t.x},${t.y}`) && !(t.sloped && kind !== "lamp"))
            .map((t) => ({ t, s: score(t) }))
            .sort((a, b) => b.s - a.s || a.t.y - b.t.y || a.t.x - b.t.x);
        const same = taken.filter((e) => e.kind === kind).map((e) => ({ x: e.x, y: e.y }));
        for (const { t } of list) {
            if (same.some((s) => near(s, t) < spacing)) continue;
            same.push(t);
            used.add(`${t.x},${t.y}`);
            slots.push({ x: t.x, y: t.y, level: t.level, kind });
        }
    }
    return { slots, candidates, existing };
}
