import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { RIDE_TYPES } from "@openrct2-claude/protocol";
import { z } from "zod";
import { SegmentTable, availableInversions, rideTrackInfo } from "../planners/track.js";
import { roleOf } from "../roles.js";
import { BUDGET, defineTool, result, type ToolContext } from "./context.js";

const OBJECT_TYPES = [
    "ride",
    "small_scenery",
    "large_scenery",
    "wall",
    "banner",
    "footpath",
    "footpath_addition",
    "scenery_group",
    "park_entrance",
    "water",
    "terrain_surface",
    "terrain_edge",
    "station",
    "music",
    "footpath_surface",
    "footpath_railings",
] as const;

export function registerObjectTools(server: McpServer, ctx: ToolContext): void {
    defineTool(
        server,
        ctx,
        "list_objects",
        {
            title: "Lister les objets",
            description:
                "Objets installés ou chargés dans le parc, filtrés par type, texte et rôle. N'INVENTE JAMAIS d'identifiant : utilise ceux renvoyés ici. " +
                "Seuls les objets chargés (loaded: true) sont utilisables ; sinon load_objects. Pagination : 25 par page, passe cursor pour la suite. " +
                "Pour les attractions, 'category' indique shop/gentle/thrill… et 'placeable' si ride_place sait la poser (attractions plates et boutiques), 'tool' l'outil de pose (ride_place ou coaster_create pour les circuits), 'inversions' celles du type de piste (le bois a la boucle verticale). " +
                "Exemple : { type: 'small_scenery', role: 'tree_conifer', loadedOnly: true }.",
            input: {
                type: z.enum(OBJECT_TYPES).optional(),
                query: z.string().max(64).optional().describe("Sous-chaîne de l'identifiant ou du nom."),
                role: z.string().max(32).optional().describe("bench, bin, lamp_post, tree_conifer, tree_deciduous, tree_palm, shrub, flower, rock, fence, path, queue_path, shop_food, shop_drink…"),
                loadedOnly: z.boolean().default(false),
                cursor: z.number().int().min(0).default(0),
                limit: z.number().int().min(1).max(50).default(25),
            },
            readOnly: true,
        },
        async ({ type, query, role, loadedOnly, cursor, limit }) => {
            if (loadedOnly && !type) {
                // Sans type, on parcourt les types utiles un par un.
                const types = ["ride", "small_scenery", "large_scenery", "wall", "footpath_surface", "footpath_addition", "park_entrance"] as const;
                const all = [];
                for (const t of types) {
                    const r = await ctx.bridge.call("objects.list", { type: t, query, loadedOnly: true, limit: 200 });
                    all.push(...r.items);
                }
                return respond(all, cursor, limit, role);
            }
            // Le filtre de rôle est appliqué côté serveur : on lit plus large puis on pagine nous-mêmes.
            if (role) {
                const r = await ctx.bridge.call("objects.list", { type, query, loadedOnly, limit: 200, cursor: 0 });
                let items = r.items;
                let next = r.nextCursor;
                while (next !== null && items.length < 2000) {
                    const more = await ctx.bridge.call("objects.list", { type, query, loadedOnly, limit: 200, cursor: next });
                    items = items.concat(more.items);
                    next = more.nextCursor;
                }
                return respond(items, cursor, limit, role);
            }
            const r = await ctx.bridge.call("objects.list", { type, query, loadedOnly, limit, cursor });
            return result({
                response: {
                    summary: `${r.total} objet(s) correspondant(s) ; ${r.items.length} affiché(s).`,
                    items: r.items.map(compact),
                    nextCursor: r.nextCursor,
                },
            });
        },
    );

    function respond(all: Parameters<typeof compact>[0][], cursor: number, limit: number, role?: string) {
        const filtered = role ? all.filter((o) => roleOf(o) === role) : all;
        const page = filtered.slice(cursor, cursor + limit);
        const next = cursor + page.length < filtered.length ? cursor + page.length : null;
        return result({
            response: {
                summary: `${filtered.length} objet(s) correspondant(s) ; ${page.length} affiché(s).`,
                items: page.map(compact),
                nextCursor: next,
            },
        });
    }

    defineTool(
        server,
        ctx,
        "load_objects",
        {
            title: "Charger des objets",
            description:
                "Charge des objets installés dans le parc (objectManager.load) pour pouvoir les placer. Signale les échecs (objet inconnu, " +
                "emplacements pleins). Exemple : { identifiers: ['rct2.scenery_small.tcf', 'rct2.ride.burgb'] }.",
            input: { identifiers: z.array(z.string().min(1).max(128)).min(1).max(50) },
        },
        async ({ identifiers }) => {
            const r = await ctx.bridge.call("objects.load", { identifiers });
            const ok = r.results.filter((x) => x.ok);
            const ko = r.results.filter((x) => !x.ok);
            return result({
                budget: BUDGET.write * 2,
                response: {
                    summary: `${ok.length} objet(s) chargé(s), ${ko.length} échec(s).`,
                    loaded: ok.map((x) => ({ id: x.identifier, type: x.type, index: x.index })),
                    failed: ko.map((x) => ({ id: x.identifier, error: x.error })),
                    next_hints: ko.length ? ["Vérifie les identifiants avec list_objects (sans loadedOnly)."] : [],
                },
            });
        },
    );
}

// Table des pièces (fichier généré) pour les inversions par type de piste ; null si absente : champ omis.
let tableCache: SegmentTable | null | undefined;
const segmentTable = () => (tableCache === undefined ? (tableCache = SegmentTable.fromFile()) : tableCache);

function compact(o: { identifier: string; name: string; type: string; loaded: boolean; index: number | null; extra?: Record<string, unknown> }) {
    const out: Record<string, unknown> = { id: o.identifier, name: o.name, type: o.type, loaded: o.loaded };
    const role = roleOf(o);
    if (role) out.role = role;
    if (o.type === "ride" && Array.isArray(o.extra?.rideType)) {
        const rt = RIDE_TYPES.find((r) => r.rideType === (o.extra!.rideType as number[])[0]);
        if (rt) {
            out.rideType = rt.name;
            out.category = rt.category;
            out.placeable = !!rt.startTrackPieceName?.startsWith("flatTrack");
            // Outil de pose : ride_place (plates, boutiques) ou coaster_create (circuits).
            if (out.placeable) out.tool = "ride_place";
            else if (rt.startTrackPieceName === "endStation" && rt.trackGroups.length) {
                out.tool = "coaster_create";
                // Inversions du type de piste : à lire avant de changer de type pour une boucle (le bois en a une).
                const ride = rideTrackInfo(rt.rideType);
                const table = segmentTable();
                if (ride && table) out.inversions = availableInversions(table, ride);
            }
        }
    }
    if (o.type === "small_scenery" && o.extra) {
        out.height = o.extra.height;
        out.price = o.extra.price;
    }
    return out;
}
