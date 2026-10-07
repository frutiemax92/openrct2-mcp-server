// Rôles sémantiques des objets (SPEC 6.6). Heuristiques sur l'identifiant et le nom (anglais/français),
// surchargées par data/object-tags.json s'il existe.

import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { SMALL_SCENERY_FLAGS, type ObjectInfo } from "@openrct2-claude/protocol";

const RULES: { role: string; types: string[]; re: RegExp }[] = [
    { role: "bench", types: ["footpath_addition"], re: /bench|banc/i },
    { role: "bin", types: ["footpath_addition"], re: /litter|bin|poubelle/i },
    { role: "lamp_post", types: ["footpath_addition"], re: /lamp|light|lampe|lampadaire|réverbère/i },
    { role: "fountain", types: ["footpath_addition", "small_scenery", "large_scenery"], re: /fountain|fontaine|jet d/i },
    { role: "queue_tv", types: ["footpath_addition"], re: /qtv|queue.*tv|télé/i },
    { role: "cactus", types: ["small_scenery", "large_scenery"], re: /cactus|cacti/i },
    { role: "tree_palm", types: ["small_scenery", "large_scenery"], re: /palm|palmier/i },
    { role: "tree_conifer", types: ["small_scenery", "large_scenery"], re: /pine|fir|spruce|conifer|cedar|pin|sapin|épicéa|cèdre|conifère/i },
    { role: "tree_deciduous", types: ["small_scenery", "large_scenery"], re: /tree|oak|beech|birch|willow|maple|elm|arbre|chêne|hêtre|bouleau|saule|érable|orme/i },
    { role: "shrub", types: ["small_scenery"], re: /bush|shrub|hedge|buisson|arbuste|haie/i },
    { role: "flower", types: ["small_scenery"], re: /flower|rose|tulip|fleur|tulipe|parterre/i },
    { role: "rock", types: ["small_scenery", "large_scenery"], re: /rock|stone|boulder|rocher|pierre/i },
    { role: "statue", types: ["small_scenery", "large_scenery"], re: /statue|sculpt/i },
    { role: "fence", types: ["wall"], re: /fence|railing|clôture|barrière|grille/i },
    { role: "wall", types: ["wall"], re: /wall|mur/i },
    { role: "queue_path", types: ["footpath_surface", "footpath"], re: /queue|file/i },
    { role: "path_tarmac", types: ["footpath_surface", "footpath"], re: /tarmac|asphalt|goudron/i },
    { role: "path_dirt", types: ["footpath_surface", "footpath"], re: /dirt|terre/i },
    { role: "path_crazy", types: ["footpath_surface", "footpath"], re: /crazy|pavé|paving|dallage/i },
    { role: "path", types: ["footpath_surface", "footpath"], re: /./ },
    { role: "shop_food", types: ["ride"], re: /burger|pizza|chips|fries|hot ?dog|popcorn|candy|food|cookie|ice cream|glace|frites|beignet/i },
    { role: "shop_drink", types: ["ride"], re: /drink|soda|lemonade|coffee|tea|boisson|café|thé|limonade/i },
    { role: "toilets", types: ["ride"], re: /toilet/i },
    { role: "info_kiosk", types: ["ride"], re: /info/i },
];

let overrides: Record<string, string> | null = null;

function loadOverrides(): Record<string, string> {
    if (overrides) return overrides;
    overrides = {};
    const here = dirname(fileURLToPath(import.meta.url));
    const file = resolve(join(here, "..", "..", "..", "data", "object-tags.json"));
    if (existsSync(file)) {
        try {
            overrides = JSON.parse(readFileSync(file, "utf8")) as Record<string, string>;
        } catch {
            overrides = {};
        }
    }
    return overrides;
}

export function roleOf(o: Pick<ObjectInfo, "identifier" | "name" | "type" | "extra">): string | null {
    const o2 = loadOverrides()[o.identifier];
    if (o2) return o2;
    const text = `${o.identifier} ${o.name}`;
    for (const r of RULES) if (r.types.includes(o.type) && r.re.test(text)) return r.role;
    // Arbre sans nom reconnaissable : drapeau isTree de l'objet (ajouté par OpenRCT2).
    if (o.type === "small_scenery" && typeof o.extra?.flags === "number" && o.extra.flags & SMALL_SCENERY_FLAGS.isTree) return "tree_deciduous";
    return null;
}

/** Objets de petite scénerie chargés, groupés par rôle, avec leur empreinte (tuile entière ou quart). */
export interface RoleObject {
    identifier: string;
    fullTile: boolean;
    flatOnly: boolean;
    rotatable: boolean;
    height: number;
}

export function groupByRole(objects: ObjectInfo[]): Map<string, RoleObject[]> {
    const out = new Map<string, RoleObject[]>();
    for (const o of objects) {
        const role = roleOf(o);
        if (!role) continue;
        const flags = typeof o.extra?.flags === "number" ? o.extra.flags : 0;
        // Sans drapeaux connus, un arbre occupe la tuile entière (constaté en jeu, SPIKES S2).
        const fullTile = flags ? !!(flags & (SMALL_SCENERY_FLAGS.occupiesFullTile | SMALL_SCENERY_FLAGS.occupiesThreeQuarters)) : role.startsWith("tree");
        const list = out.get(role) ?? [];
        list.push({
            identifier: o.identifier,
            fullTile,
            flatOnly: !!(flags & SMALL_SCENERY_FLAGS.requiresFlatSurface),
            rotatable: !!(flags & SMALL_SCENERY_FLAGS.isRotatable),
            height: typeof o.extra?.height === "number" ? o.extra.height : 0,
        });
        out.set(role, list);
    }
    for (const list of out.values()) list.sort((a, b) => a.identifier.localeCompare(b.identifier));
    return out;
}
