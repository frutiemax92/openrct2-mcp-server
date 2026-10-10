import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
    DIRECTION_DELTA,
    MAX_LEVEL,
    MIN_LEVEL,
    RIDE_SETTINGS,
    RIDE_TYPES,
    reverseDirection,
    tileKey,
    type Direction,
    type FootprintTile,
    type ObjectInfo,
    type RegionTile,
    type TileXY,
} from "@openrct2-claude/protocol";
import { z } from "zod";
import { analyzeConnectivity } from "../planners/connectivity.js";
import type { PlannedPathTile } from "../planners/path.js";
import type { InverseOp } from "../state/journal.js";
import { rememberCarsPerTrain } from "./coasters.js";
import { BUDGET, defineTool, landscapeHint, result, toolError, zDirection, zDryRun, type ToolContext } from "./context.js";
import { placePathTiles, routeToNetwork } from "./helpers.js";

interface EntranceCandidate {
    tile: TileXY;
    /** Direction de la tuile d'entrée vers la station (argument de l'action). */
    actionDirection: Direction;
    /** Côté extérieur : la tuile de raccord est tile + delta[outward]. */
    outward: Direction;
    access: TileXY;
}

function bbox(tiles: TileXY[]) {
    return {
        x1: Math.min(...tiles.map((t) => t.x)),
        y1: Math.min(...tiles.map((t) => t.y)),
        x2: Math.max(...tiles.map((t) => t.x)),
        y2: Math.max(...tiles.map((t) => t.y)),
    };
}

function step(t: TileXY, d: Direction): TileXY {
    return { x: t.x + DIRECTION_DELTA[d].x, y: t.y + DIRECTION_DELTA[d].y };
}

/** Candidats d'entrée/sortie : tuiles hors empreinte adjacentes à un bord de l'empreinte. */
function entranceCandidates(footprint: FootprintTile[], get: (x: number, y: number) => RegionTile | undefined, level: number, sandbox: boolean): EntranceCandidate[] {
    const inside = new Set(footprint.map(tileKey));
    const out: EntranceCandidate[] = [];
    const seen = new Set<string>();
    for (const f of footprint) {
        for (let d = 0 as Direction; d < 4; d = (d + 1) as Direction) {
            const e = step(f, d);
            const k = tileKey(e);
            if (inside.has(k) || seen.has(k)) continue;
            const t = get(e.x, e.y);
            if (!t || t.r?.length || t.e?.length || t.p?.length || t.lg) continue;
            if (!(t.o & 1) && !sandbox) continue;
            if (t.h > level || t.w > level) continue;
            seen.add(k);
            out.push({ tile: e, actionDirection: reverseDirection(d), outward: d, access: step(e, d) });
        }
    }
    return out;
}

function nearestPathDistance(from: TileXY, paths: TileXY[]): number {
    let best = Infinity;
    for (const p of paths) best = Math.min(best, Math.abs(p.x - from.x) + Math.abs(p.y - from.y));
    return best;
}

export function registerRideTools(server: McpServer, ctx: ToolContext): void {
    defineTool(
        server,
        ctx,
        "ride_place",
        {
            title: "Placer une attraction plate ou une boutique",
            description:
                "Création complète d'une attraction plate (manège, tasses…) ou d'une boutique/équipement (nourriture, boissons, toilettes) : " +
                "crée l'attraction, pose sa pièce, place entrée et sortie (attractions), raccorde au chemin le plus proche (connectToPath) avec " +
                "une file d'attente côté entrée, puis ouvre (open). Si level surélève l'attraction, le raccord pose une passerelle sur supports " +
                "jusqu'au réseau existant. x/y = tuile d'origine (centre pour une 3×3, coin pour 2×2/4×4), direction 0-3 " +
                "(pour une boutique : côté du comptoir, 0 = −x, 1 = +y, 2 = +x, 3 = −y). L'empreinte doit être plate, possédée et libre " +
                "(sinon choisis un autre emplacement, ou level pour la surélever ; terrain_flatten seulement si l'utilisateur a permis de modifier le relief). object = identifiant d'un objet 'ride' chargé (list_objects type ride loadedOnly ; placeable: true). " +
                "Renvoie rideId, empreinte, entrée/sortie, tuiles de raccord et l'état de connexion. " +
                "Exemple : { object: 'rct2.ride.mgr1', x: 66, y: 70, direction: 0, connectToPath: true }.",
            input: {
                object: z.string(),
                x: z.number().int().min(0),
                y: z.number().int().min(0),
                direction: zDirection.default(0),
                level: z.number().int().min(MIN_LEVEL).max(MAX_LEVEL).optional().describe("Défaut : niveau du terrain à l'origine."),
                entrance: z.object({ x: z.number().int(), y: z.number().int() }).optional().describe("Tuile d'entrée imposée (adjacente à l'empreinte)."),
                exit: z.object({ x: z.number().int(), y: z.number().int() }).optional(),
                connectToPath: z.boolean().default(true),
                queue: z.boolean().default(true).describe("Raccord de l'entrée en file d'attente."),
                name: z.string().min(1).max(64).optional(),
                price: z.number().int().min(0).max(2000).optional().describe("Prix en unités internes (10 = 1,00)."),
                open: z.boolean().default(true),
                dryRun: zDryRun,
            },
        },
        async (args) => {
            const warnings: string[] = [];
            const sandbox = ctx.state.mode === "sandbox";
            // 1. Objet et type
            const objs = await ctx.bridge.call("objects.list", { type: "ride", query: args.object, loadedOnly: true, limit: 50 });
            const obj = (objs.items as ObjectInfo[]).find((o) => o.identifier === args.object) ?? (objs.items.length === 1 ? objs.items[0] : undefined);
            if (!obj) toolError("OBJECT_NOT_LOADED", `Objet d'attraction ${args.object} non chargé.`, { hint: "list_objects { type: 'ride', query } puis load_objects." });
            const rideType = (obj.extra?.rideType as number[] | undefined)?.[0];
            const info = RIDE_TYPES.find((r) => r.rideType === rideType);
            if (!info || info.startTrackPiece === null || !info.startTrackPieceName?.startsWith("flatTrack")) {
                toolError("NOT_SUPPORTED_IN_MODE", `${obj.name} (${info?.name ?? rideType}) n'est pas une attraction plate ni une boutique.`, {
                    hint: "Les attractions à circuit (coasters, trains) relèvent des outils coaster_* (phase 3).",
                });
            }
            const isShop = info.category === "shop";
            const trackType = info.startTrackPiece;
            // 2. Empreinte et terrain
            const fp = await ctx.bridge.call("track.footprint", { trackType, x: args.x, y: args.y, direction: args.direction as Direction });
            const footprint = fp.tiles;
            const box = bbox(footprint);
            const reg = await ctx.cache.region({ x1: box.x1 - 12, y1: box.y1 - 12, x2: box.x2 + 12, y2: box.y2 + 12 });
            const origin = reg.get(args.x, args.y);
            if (!origin) toolError("INVALID_PARAMS", `Tuile (${args.x},${args.y}) hors carte.`);
            const level = args.level ?? origin.h;
            const bad: string[] = [];
            for (const t of footprint) {
                const rt = reg.get(t.x, t.y);
                if (!rt) bad.push(`(${t.x},${t.y}) hors carte`);
                else if (rt.h !== level || rt.s !== 0) bad.push(`(${t.x},${t.y}) niveau ${rt.h}${rt.s ? " en pente" : ""}`);
                else if (rt.p?.length || rt.r?.length || rt.e?.length) bad.push(`(${t.x},${t.y}) occupée`);
                else if (!(rt.o & 1) && !sandbox) bad.push(`(${t.x},${t.y}) non possédée`);
            }
            if (bad.length && args.level === undefined) {
                toolError("BAD_SLOPE", `Empreinte non constructible : ${bad.slice(0, 4).join(", ")}${bad.length > 4 ? "…" : ""}.`, {
                    details: { footprint: box, level },
                    hint: `Déplace l'attraction ou passe level pour la surélever.${landscapeHint(ctx, `terrain_flatten { x1: ${box.x1}, y1: ${box.y1}, x2: ${box.x2}, y2: ${box.y2}, level: ${level} }`)}`,
                });
            }
            if (args.dryRun) {
                const q = await ctx.bridge.call("ride.create", { object: obj.identifier, dryRun: true });
                return result({
                    budget: BUDGET.write * 2,
                    response: {
                        summary: `[simulation] ${obj.name} posable en (${args.x},${args.y}) niveau ${level} ; coût de création ${q.cost}.`,
                        footprint: box,
                        warnings: bad.length ? [`Tuiles douteuses : ${bad.slice(0, 4).join(", ")}`] : [],
                    },
                });
            }
            // 3. Création + pose de la pièce (rollback en cas d'échec)
            const created = await ctx.bridge.call("ride.create", { object: obj.identifier });
            const rideId = created.rideId;
            if (rideId === null) toolError("INTERNAL", "ridecreate n'a pas renvoyé d'identifiant.");
            const inverse: InverseOp[] = [{ method: "ride.demolish", params: { ride: rideId } }];
            let cost = created.cost;
            const rollback = async () => {
                await ctx.bridge.call("ride.demolish", { ride: rideId }).catch(() => undefined);
            };
            const track = await ctx.bridge.call("ride.place_track", { ride: rideId, trackType, x: args.x, y: args.y, level, direction: args.direction as Direction });
            if (!track.ok) {
                await rollback();
                throw { error: { ...track.error!, hint: track.error?.hint ?? "Vérifie l'empreinte avec get_region_map / inspect_tile." } };
            }
            cost += track.cost ?? 0;
            ctx.cache.invalidate(box, 1);
            // 4. Entrée et sortie (attractions)
            let entrance: EntranceCandidate | null = null;
            let exit: EntranceCandidate | null = null;
            const reg2 = await ctx.cache.region({ x1: box.x1 - 12, y1: box.y1 - 12, x2: box.x2 + 12, y2: box.y2 + 12 });
            const pathTiles: TileXY[] = [];
            for (let y = reg2.rect.y1; y <= reg2.rect.y2; y++) for (let x = reg2.rect.x1; x <= reg2.rect.x2; x++) if (reg2.get(x, y)?.p?.length) pathTiles.push({ x, y });
            if (!isShop) {
                const cands = entranceCandidates(footprint, reg2.get, level, sandbox);
                const pick = (want: TileXY | undefined, exclude: TileXY | null): EntranceCandidate[] => {
                    if (want) {
                        const c = cands.find((c) => c.tile.x === want.x && c.tile.y === want.y);
                        if (!c) toolError("INVALID_PARAMS", `(${want.x},${want.y}) n'est pas adjacent à l'empreinte ou pas libre.`, { details: { candidates: cands.slice(0, 12).map((c) => c.tile) } });
                        return [c];
                    }
                    const pool = cands.filter((c) => !exclude || tileKey(c.tile) !== tileKey(exclude));
                    if (exclude) {
                        // Sortie : près de l'entrée, même côté de préférence.
                        return pool.sort((a, b) => Math.abs(a.tile.x - exclude.x) + Math.abs(a.tile.y - exclude.y) - (Math.abs(b.tile.x - exclude.x) + Math.abs(b.tile.y - exclude.y)));
                    }
                    const target = pathTiles.length ? null : { x: (box.x1 + box.x2) / 2, y: box.y2 + 10 };
                    return pool.sort((a, b) =>
                        target
                            ? Math.abs(a.access.x - target.x) + Math.abs(a.access.y - target.y) - (Math.abs(b.access.x - target.x) + Math.abs(b.access.y - target.y))
                            : nearestPathDistance(a.access, pathTiles) - nearestPathDistance(b.access, pathTiles),
                    );
                };
                const placeOne = async (list: EntranceCandidate[], isExit: boolean): Promise<EntranceCandidate | null> => {
                    for (const c of list.slice(0, 8)) {
                        const r = await ctx.bridge.call("ride.place_entrance_exit", { ride: rideId, x: c.tile.x, y: c.tile.y, direction: c.actionDirection, isExit });
                        if (r.ok) {
                            cost += r.cost ?? 0;
                            return c;
                        }
                        warnings.push(`${isExit ? "Sortie" : "Entrée"} refusée en (${c.tile.x},${c.tile.y}) : ${r.error?.message}`);
                    }
                    return null;
                };
                entrance = await placeOne(pick(args.entrance, null), false);
                if (entrance) exit = await placeOne(pick(args.exit, entrance.tile), true);
                if (!entrance || !exit) {
                    await rollback();
                    toolError("OBSTRUCTED", `Impossible de placer ${!entrance ? "l'entrée" : "la sortie"} autour de l'attraction.`, {
                        details: { warnings: warnings.slice(0, 5) },
                        hint: "Libère les tuiles autour de l'empreinte (inspect_tile / scenery_remove) ou indique entrance/exit.",
                    });
                }
                ctx.cache.invalidateTiles([entrance.tile, exit.tile]);
            }
            // 5. Raccord au réseau
            const placedPaths: PlannedPathTile[] = [];
            const connections: Record<string, unknown> = {};
            const shopAccess = isShop ? step({ x: args.x, y: args.y }, args.direction as Direction) : null;
            if (args.connectToPath) {
                const avoid = new Set(footprint.map(tileKey));
                if (entrance) avoid.add(tileKey(entrance.tile));
                if (exit) avoid.add(tileKey(exit.tile));
                const connect = async (label: string, start: TileXY, asQueue: boolean) => {
                    const g = await ctx.cache.region({ x1: start.x - 42, y1: start.y - 42, x2: start.x + 42, y2: start.y + 42 });
                    const route = routeToNetwork(start, g.get, { sandbox, avoid, startLevel: level });
                    if (route === null) {
                        connections[label] = { connected: false, access: start };
                        warnings.push(`${label} : aucun chemin atteignable depuis (${start.x},${start.y}) avec un niveau compatible (${level}).`);
                        return;
                    }
                    if (route.length === 0) {
                        connections[label] = { connected: true, access: start, tiles: 0 };
                        return;
                    }
                    // File d'attente : uniquement la tuile de raccord collée à l'entrée et les suivantes jusqu'au réseau.
                    const res = await placePathTiles(ctx, route, { queue: asQueue, dryRun: false });
                    const okTiles = route.filter((t) => res.results.find((r) => r.x === t.x && r.y === t.y && r.ok));
                    placedPaths.push(...okTiles);
                    cost += res.totalCost;
                    connections[label] = { connected: res.failed === 0, access: start, tiles: okTiles.length };
                    if (res.failed) warnings.push(`${label} : ${res.failed} tuile(s) de raccord refusée(s).`);
                    for (const t of okTiles) avoid.add(tileKey(t));
                };
                if (isShop && shopAccess) await connect("shop", shopAccess, false);
                if (entrance) await connect("entrance", entrance.access, args.queue);
                if (exit) await connect("exit", exit.access, false);
            }
            if (placedPaths.length) inverse.unshift({ method: "path.remove_tiles", params: { tiles: placedPaths.map((t) => ({ x: t.x, y: t.y, level: t.level })) } });
            // 6. Nom, prix, ouverture
            if (args.name) {
                const r = await ctx.bridge.call("ride.set_name", { ride: rideId, name: args.name });
                if (!r.ok) warnings.push(`Nom refusé : ${r.error?.message}`);
            }
            if (args.price !== undefined) {
                const r = await ctx.bridge.call("ride.set_price", { ride: rideId, price: args.price, primary: true });
                if (!r.ok) warnings.push(`Prix refusé : ${r.error?.message}`);
            }
            let status = "closed";
            if (args.open) {
                const r = await ctx.bridge.call("ride.set_status", { ride: rideId, status: "open" });
                if (r.ok) status = "open";
                else warnings.push(`Ouverture refusée : ${r.error?.message}`);
            }
            ctx.state.validated = ctx.state.validated && !sandbox;
            ctx.journal.record({ tool: "ride_place", summary: `${obj.name} #${rideId} en (${args.x},${args.y})`, params: args, inverse, cost });
            // 7. Vérification intégrée
            const vbox = { x1: box.x1 - 3, y1: box.y1 - 3, x2: box.x2 + 3, y2: box.y2 + 3 };
            ctx.cache.invalidate(vbox, 0);
            const after = await ctx.cache.region(vbox);
            const ride = (await ctx.bridge.call("ride.list", {})).rides.find((r) => r.id === rideId);
            const check = ride ? analyzeConnectivity(after.rect, after.get, [ride]).rides[0] : null;
            return result({
                budget: BUDGET.write * 2,
                response: {
                    summary: `${obj.name} créé(e) : rideId ${rideId}, ${status}, coût ${cost}.`,
                    rideId,
                    kind: isShop ? "shop" : "ride",
                    footprint: box,
                    level,
                    entrance: entrance?.tile ?? null,
                    exit: exit?.tile ?? null,
                    shopAccess,
                    connections,
                    connected: check ? check.problems.length === 0 : null,
                    problems: check?.problems ?? [],
                    changed: { pathTiles: placedPaths.length, cost },
                    warnings,
                    next_hints: check?.problems.length ? ["Raccorde avec path_build depuis la tuile d'accès indiquée."] : [],
                },
            });
        },
    );

    defineTool(
        server,
        ctx,
        "ride_set_status",
        {
            title: "Ouvrir / fermer / tester",
            description: "Change l'état d'une attraction : closed, open, testing (lance les tests et le calcul des notes).",
            input: { ride: z.number().int().min(0), status: z.enum(["closed", "open", "testing"]) },
        },
        async ({ ride, status }) => {
            const r = await ctx.bridge.call("ride.set_status", { ride, status });
            if (!r.ok) throw { error: r.error };
            ctx.journal.record({ tool: "ride_set_status", summary: `attraction ${ride} → ${status}`, params: { ride, status }, inverse: [], irreversible: "changement d'état : rappelle ride_set_status", cost: 0 });
            return result({ budget: BUDGET.write, response: { summary: `Attraction ${ride} : ${status}.` } });
        },
    );

    defineTool(
        server,
        ctx,
        "ride_configure",
        {
            title: "Configurer une attraction",
            description:
                "Prix (unités internes, 10 = 1,00), nom, et réglages : mode, departure (drapeaux de départ), minWaitingTime, maxWaitingTime, " +
                "operation (durée/nombre de tours), inspectionInterval (0 = 10 min … 6 = jamais), numCircuits, liftHillSpeed, music. " +
                "trains et carsPerTrain : nombre de trains et de voitures par train (attraction fermée d'abord ; le jeu ramène au maximum permis, " +
                "pour une montagne russe sections de bloc − 1 : voir layout.blocks de coaster_describe). " +
                "Exemple : { ride: 3, price: 15, settings: { inspectionInterval: 2 } }.",
            input: {
                ride: z.number().int().min(0),
                price: z.number().int().min(0).max(2000).optional(),
                secondaryPrice: z.number().int().min(0).max(2000).optional(),
                name: z.string().min(1).max(64).optional(),
                settings: z.record(z.enum(Object.keys(RIDE_SETTINGS) as [string, ...string[]]), z.number().int().min(0).max(255)).optional(),
                trains: z.number().int().min(1).max(255).optional(),
                carsPerTrain: z.number().int().min(1).max(255).optional(),
            },
        },
        async ({ ride, price, secondaryPrice, name, settings, trains, carsPerTrain }) => {
            const done: string[] = [];
            const warnings: string[] = [];
            if (price !== undefined) {
                const r = await ctx.bridge.call("ride.set_price", { ride, price, primary: true });
                (r.ok ? done : warnings).push(r.ok ? `prix ${price}` : `prix : ${r.error?.message}`);
            }
            if (secondaryPrice !== undefined) {
                const r = await ctx.bridge.call("ride.set_price", { ride, price: secondaryPrice, primary: false });
                (r.ok ? done : warnings).push(r.ok ? `prix secondaire ${secondaryPrice}` : `prix secondaire : ${r.error?.message}`);
            }
            if (name) {
                const r = await ctx.bridge.call("ride.set_name", { ride, name });
                (r.ok ? done : warnings).push(r.ok ? `nom « ${name} »` : `nom : ${r.error?.message}`);
            }
            for (const [setting, value] of Object.entries(settings ?? {})) {
                const r = await ctx.bridge.call("ride.set_setting", { ride, setting, value });
                (r.ok ? done : warnings).push(r.ok ? `${setting}=${value}` : `${setting} : ${r.error?.message}`);
            }
            // RideSetVehicleAction : type 0 = trains, 1 = voitures par train ; refusé si l'attraction n'est pas fermée.
            const vehicle: [string, number, number | undefined][] = [
                ["carsPerTrain", 1, carsPerTrain],
                ["trains", 0, trains],
            ];
            for (const [label, type, value] of vehicle) {
                if (value === undefined) continue;
                const r = await ctx.bridge.call("batch.execute", { ops: [{ action: "ridesetvehicle", args: { ride, type, value, colour: 0 } }], dryRun: false, stopOnError: true });
                const res = r.results[0];
                if (res?.ok) {
                    done.push(`${label}=${value}`);
                    if (type === 1) rememberCarsPerTrain(ride, value);
                } else warnings.push(`${label} : ${res?.error?.message ?? "refusé"}${/clos|closed/i.test(res?.error?.message ?? "") ? " (ride_set_status closed d'abord)" : ""}`);
            }
            if (trains !== undefined) warnings.push("Le jeu ramène trains au maximum permis sans erreur : vérifie avec get_ride une fois l'attraction rouverte (vehicles).");
            return result({ budget: BUDGET.write, response: { summary: `Attraction ${ride} : ${done.length} réglage(s) appliqué(s).`, applied: done, warnings } });
        },
    );

    defineTool(
        server,
        ctx,
        "ride_demolish",
        {
            title: "Démolir une attraction",
            description: "Démolit une attraction ou une boutique (rembourse une partie). Irréversible par undo_last.",
            input: { ride: z.number().int().min(0), dryRun: zDryRun },
            destructive: true,
        },
        async ({ ride, dryRun }) => {
            const r = await ctx.bridge.call("ride.demolish", { ride, dryRun });
            if (!r.ok) throw { error: r.error };
            if (!dryRun) {
                ctx.cache.invalidateAll();
                ctx.journal.record({ tool: "ride_demolish", summary: `démolition ${ride}`, params: { ride }, inverse: [], irreversible: "démolition : utilise un checkpoint", cost: r.cost ?? 0 });
            }
            return result({ budget: BUDGET.write, response: { summary: `${dryRun ? "[simulation] " : ""}Attraction ${ride} démolie (coût ${r.cost ?? 0}).` } });
        },
    );

    // -----------------------------------------------------------------------
    // Parc
    // -----------------------------------------------------------------------
    defineTool(
        server,
        ctx,
        "park_set_entrance",
        {
            title: "Poser l'entrée du parc",
            description:
                "Pose une entrée de parc (3 tuiles de large, perpendiculaire à direction) et, optionnellement, un point d'apparition des visiteurs " +
                "à `spawnDistance` tuiles à l'extérieur, relié à l'entrée par une allée. direction : sens d'entrée des visiteurs (0 = −x, 1 = +y, 2 = +x, 3 = −y). Exige l'éditeur ou le " +
                "mode sandbox. Les chemins se raccordent devant et derrière l'entrée. Exemple : { x: 64, y: 100, direction: 3 }.",
            input: {
                x: z.number().int().min(0),
                y: z.number().int().min(0),
                direction: zDirection,
                level: z.number().int().min(MIN_LEVEL).max(MAX_LEVEL).optional(),
                entranceObject: z.string().optional(),
                pathObject: z.string().optional(),
                spawnDistance: z.number().int().min(0).max(30).default(0).describe("0 = pas de point d'apparition."),
                dryRun: zDryRun,
            },
        },
        async ({ x, y, direction, level, entranceObject, pathObject, spawnDistance, dryRun }) => {
            const reg = await ctx.cache.region({ x1: x - 2, y1: y - 2, x2: x + 2, y2: y + 2 });
            const t = reg.get(x, y);
            if (!t) toolError("INVALID_PARAMS", "Tuile hors carte.");
            const lvl = level ?? t.h;
            const r = await ctx.bridge.call("park.entrance_place", { x, y, level: lvl, direction: direction as Direction, entranceObject, pathObject, dryRun });
            if (!r.ok) throw { error: r.error };
            const warnings: string[] = [];
            if (!dryRun && spawnDistance > 0) {
                // Les visiteurs arrivent de l'extérieur : à l'opposé du sens d'entrée.
                // peepspawnplace exige un chemin sous le point (SPIKES S2) : on trace l'allée extérieure jusqu'au point.
                const back = reverseDirection(direction as Direction);
                const outside = Array.from({ length: spawnDistance }, (_, i) => ({
                    x: x + DIRECTION_DELTA[back].x * (i + 1),
                    y: y + DIRECTION_DELTA[back].y * (i + 1),
                    level: lvl,
                }));
                const s = outside[outside.length - 1];
                const pr = await ctx.bridge.call("path.place_tiles", { tiles: outside, object: pathObject });
                if (pr.failed > 0) warnings.push(`Allée extérieure : ${pr.failed} tuile(s) refusée(s) sur ${outside.length}.`);
                ctx.cache.invalidate({ x1: Math.min(x, s.x), y1: Math.min(y, s.y), x2: Math.max(x, s.x), y2: Math.max(y, s.y) }, 0);
                const sr = await ctx.bridge.call("park.spawn_place", { x: s.x, y: s.y, level: lvl, direction: direction as Direction });
                if (!sr.ok) {
                    warnings.push(
                        `Point d'apparition refusé en (${s.x},${s.y}) : ${sr.error?.message} Il doit être sur une allée, hors du terrain du parc : ` +
                            "pose l'entrée en bordure du parc ou augmente spawnDistance.",
                    );
                }
            }
            if (!dryRun) {
                ctx.cache.invalidate({ x1: x - 2, y1: y - 2, x2: x + 2, y2: y + 2 }, 0);
                ctx.journal.record({ tool: "park_set_entrance", summary: `entrée du parc en (${x},${y})`, params: { x, y, direction }, inverse: [], irreversible: "entrée du parc : utilise un checkpoint", cost: r.cost ?? 0 });
            }
            const inside = { x: x + DIRECTION_DELTA[direction].x, y: y + DIRECTION_DELTA[direction].y };
            return result({
                budget: BUDGET.write,
                response: {
                    summary: `${dryRun ? "[simulation] " : ""}Entrée du parc en (${x},${y}), niveau ${lvl}.`,
                    insideAccess: inside,
                    warnings,
                    next_hints: [`Trace l'allée principale depuis (${inside.x},${inside.y}) avec path_build.`],
                },
            });
        },
    );

    defineTool(
        server,
        ctx,
        "park_configure",
        {
            title: "Configurer le parc",
            description: "Nom du parc, prix d'entrée (unités internes, 10 = 1,00), montant du prêt, ouverture du parc (open: true pour accueillir des visiteurs).",
            input: {
                name: z.string().min(1).max(64).optional(),
                entranceFee: z.number().int().min(0).max(2000).optional(),
                loan: z.number().int().min(0).optional(),
                open: z.boolean().optional(),
                dryRun: zDryRun,
            },
        },
        async (args) => {
            const r = await ctx.bridge.call("park.set", args);
            const ok = Object.entries(r.results).filter(([, v]) => v.ok).map(([k]) => k);
            const ko = Object.entries(r.results).filter(([, v]) => !v.ok).map(([k, v]) => `${k} : ${v.error?.message}`);
            return result({ budget: BUDGET.write, response: { summary: `${args.dryRun ? "[simulation] " : ""}${ok.length} réglage(s) du parc appliqué(s).`, applied: ok, warnings: ko } });
        },
    );
}
