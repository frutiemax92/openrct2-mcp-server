// Outils du Style Picker et du Magic Fill Tool (SPEC 13.7).
//
// Dans le jeu, l'utilisateur annote des régions (Style Picker → base de styles sur disque) et peint des régions à
// remplir avec une consigne (Magic Fill Tool → demandes). Ici, Claude lit les styles (style_list, style_get), prend
// les demandes (magic_fill_requests), choisit les styles qui conviennent à la consigne et au voisinage, et remplit
// (magic_fill_apply : planificateur déterministe, pose sans contrôle de dégagement, capture de comparaison).

import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { CLEAR_ITEMS, STYLE_MAX_TILES, type BulkResult, type StyleRecord, type TileRect, type TileXY } from "@openrct2-claude/protocol";
import { z } from "zod";
import { paths } from "../config.js";
import { log } from "../log.js";
import { planMagicFill, type FillPlan, type FillTargetTile, type FillType } from "../planners/magicFill.js";
import { contactSheet } from "../render/annotate.js";
import { maskCapture } from "../render/mask.js";
import type { InverseOp } from "../state/journal.js";
import { FillQueue, InboxSync, type FillEntry } from "../styles/inbox.js";
import { columnsOf, StyleStore, summarize, type StyleSummary } from "../styles/store.js";
import { chunks } from "./helpers.js";
import { BUDGET, defineTool, requireLandscape, result, toolError, zRectShape, zTile, type ToolContext } from "./context.js";
import { checkpointExists, restoreCheckpoint, saveCheckpoint } from "./history.js";
import { waitForFile } from "./observe.js";

const zTiles = z.array(zTile).max(STYLE_MAX_TILES);

/** Consigne qui demande un cours d'eau (rivière tracée par défaut), ou de l'eau en général (contrôle du résultat). */
const RIVER_WORDS = /\b(rivers?|streams?|creeks?|brooks?|canals?|rivi[eè]res?|ruisseaux?|fleuves?|torrents?|cours d'eau)\b/i;
const BUILDING_WORDS = /\b(city|town|village|buildings?|skyscrapers?|towers?|houses?|ville|villages?|b[aâ]timents?|immeubles?|gratte-ciels?|tours?|maisons?)\b/i;
const WATER_WORDS =/\b(water|lakes?|ponds?|pools?|eau|lacs?|[ée]tangs?|mares?|bassins?)\b/i;

/** Le style contient des bâtiments : en terrain (structure) ou en objets (petite/grande scénerie, murs). */
function hasBuildings(r: StyleRecord): boolean {
    if (summarize(r).structure?.kind === "building") return true;
    return r.elements.some((e) => e.object && e.t !== "footpath" && BUILDING_WORDS.test(r.objects[e.object]?.name ?? ""));
}

function compact(s: StyleSummary) {
    return {
        id: s.id,
        caption: s.caption,
        tiles: s.tiles,
        size: s.size,
        density: s.density,
        objects: s.topObjects.slice(0, 4).map((o) => `${o.name} ×${o.n}`),
        maxDz: s.maxDz,
        stacked: s.stacked,
        terrain: s.terrain,
        structure: s.structure
            ? `${s.structure.kind === "building" ? "bâtiment en terrain" : "falaise"} : ${s.structure.tiles} tuile(s) surélevée(s) de ${s.structure.height} niveaux à pic (bordure ${s.structure.edges.join(", ")})`
            : undefined,
        rides: s.rides.length ? s.rides : undefined,
        createdAt: s.createdAt,
    };
}

function tilesFrom(args: { tiles?: TileXY[]; rect?: { x1: number; y1: number; x2: number; y2: number } }): TileXY[] {
    if (args.tiles?.length) return args.tiles;
    if (args.rect) {
        const r = args.rect;
        const out: TileXY[] = [];
        for (let y = Math.min(r.y1, r.y2); y <= Math.max(r.y1, r.y2); y++) for (let x = Math.min(r.x1, r.x2); x <= Math.max(r.x1, r.x2); x++) out.push({ x, y });
        if (out.length > STYLE_MAX_TILES) toolError("INVALID_PARAMS", `Rectangle trop grand (${out.length} tuiles, maximum ${STYLE_MAX_TILES}).`);
        return out;
    }
    return toolError("INVALID_PARAMS", "Donne 'tiles' ou 'rect' (ou 'request' pour magic_fill_apply).");
}

/** Tuiles cibles avec leur terrain et ce qui les occupe déjà (relevé du plugin). */
function targetOf(rec: StyleRecord): FillTargetTile[] {
    const out = new Map<string, FillTargetTile>();
    for (const [dx, dy] of rec.tiles) out.set(`${dx},${dy}`, { x: rec.origin.x + dx, y: rec.origin.y + dy, baseHeight: 2, slope: 0, water: 0, blocked: false, occupied: false });
    for (const s of rec.surfaces) {
        const t = out.get(`${s.dx},${s.dy}`);
        if (t) Object.assign(t, { baseHeight: s.baseHeight, slope: s.slope, water: s.water, surface: s.surface, edge: s.edge });
    }
    for (const e of rec.elements) {
        const t = out.get(`${e.dx},${e.dy}`);
        if (!t) continue;
        if (e.t === "footpath" || e.t === "track" || e.t === "entrance") t.blocked = true;
        else t.occupied = true;
    }
    return [...out.values()];
}

/** Tuiles autour d'une région (anneau de `radius`), dans la carte. */
function ringOf(tiles: TileXY[], radius: number, mapSize: TileXY | null): TileXY[] {
    const inside = new Set(tiles.map((t) => `${t.x},${t.y}`));
    const ring = new Map<string, TileXY>();
    for (const t of tiles)
        for (let dy = -radius; dy <= radius; dy++)
            for (let dx = -radius; dx <= radius; dx++) {
                const x = t.x + dx;
                const y = t.y + dy;
                const k = `${x},${y}`;
                if (inside.has(k) || ring.has(k) || x < 1 || y < 1) continue;
                if (mapSize && (x >= mapSize.x - 1 || y >= mapSize.y - 1)) continue;
                ring.set(k, { x, y });
            }
    return [...ring.values()].slice(0, STYLE_MAX_TILES);
}

function neighbourhood(rec: StyleRecord) {
    const s = summarize(rec);
    const paths = rec.elements.filter((e) => e.t === "footpath").length;
    return {
        tiles: s.tiles,
        sceneryDensity: s.density,
        objects: s.topObjects.map((o) => `${o.name} (${o.id}) ×${o.n}`),
        paths,
        rides: s.rides,
        terrain: s.terrain,
    };
}

function errorGroups(results: BulkResult[]): { message: string; n: number }[] {
    const g = new Map<string, number>();
    for (const r of results) for (const o of r.results) if (!o.ok) g.set(o.error?.message ?? "?", (g.get(o.error?.message ?? "?") ?? 0) + 1);
    return [...g.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([message, n]) => ({ message, n }));
}

export function registerStyleTools(server: McpServer, ctx: ToolContext): { store: StyleStore; fills: FillQueue; sync: InboxSync } {
    const store = new StyleStore(ctx.config.stylesDir);
    const fills = new FillQueue(join(ctx.config.stylesDir, "magic-fill"));
    const sync = new InboxSync(ctx.bridge, ctx.config, store, fills);
    sync.start();
    ctx.state.magicFillAreas = () =>
        fills.open().map(({ request: { tiles } }) => ({
            x1: Math.min(...tiles.map((t) => t[0])),
            y1: Math.min(...tiles.map((t) => t[1])),
            x2: Math.max(...tiles.map((t) => t[0])),
            y2: Math.max(...tiles.map((t) => t[1])),
        }));

    const requireStyle = (id: string): StyleRecord => {
        const r = store.get(id);
        if (!r) toolError("NOT_FOUND", `Style introuvable : ${id}.`, { hint: "style_list donne les identifiants." });
        return r;
    };

    /** Écritures journalisées depuis le checkpoint d'une demande, hors remplissages de cette demande : perdues en y revenant. */
    const laterWork = (e: FillEntry) =>
        ctx.journal.toJSON().filter((j) => j.id > (e.checkpointJournalId ?? 0) && !(j.tool === "magic_fill_apply" && (j.params as { request?: string })?.request === e.request.id));

    /**
     * Ramène le parc à l'état d'avant le premier remplissage de la demande (son checkpoint) : la région retrouve son
     * terrain, ses textures et sa scénerie d'origine d'un coup. Refuse si d'autres écritures ont suivi, sauf accord.
     */
    const revertFill = async (e: FillEntry, discardLaterWork: boolean): Promise<string[]> => {
        if (!e.checkpoint || !checkpointExists(ctx, e.checkpoint))
            toolError("NOT_FOUND", `Pas de checkpoint d'avant remplissage pour ${e.request.id}.`, {
                hint: "Demande remplie avant l'ajout des checkpoints automatiques : undo_last si le remplissage est la dernière opération du journal, sinon checkpoint_list.",
            });
        const later = laterWork(e).map((j) => j.summary);
        if (later.length && !discardLaterWork)
            toolError("NOT_SUPPORTED_IN_MODE", `Revenir avant le remplissage de ${e.request.id} effacerait aussi ${later.length} opération(s) faite(s) depuis.`, {
                details: { later: later.slice(-10) },
                hint: "Demande à l'utilisateur s'il accepte de les perdre (puis discardLaterWork: true), ou refais ces opérations ensuite.",
            });
        await restoreCheckpoint(ctx, e.checkpoint as string);
        fills.clearResult(e.request.id);
        return later;
    };

    const extract = async (tiles: TileXY[]): Promise<StyleRecord> => ctx.bridge.call("styles.extract", { tiles }, { timeoutMs: 60_000 });

    const setStatus = async (id: string, status: "working" | "done" | "failed" | "dismissed", message: string, res?: Record<string, unknown>) => {
        fills.update(id, status, message, res);
        try {
            await ctx.bridge.call("magic_fill.status", { id, status, message: message.slice(0, 120) });
        } catch {
            // fenêtre fermée ou jeu déconnecté : le statut reste sur disque
        }
    };

    /** Capture masquée de tuiles, lue sur disque et masquée à leur emprise (même rendu que les styles). */
    const maskedShot = async (tiles: TileXY[], rotation: number, rec: StyleRecord): Promise<Buffer | null> => {
        const name = `claude-fill-${ctx.config.sessionId}-${String(++ctx.state.captureCounter).padStart(4, "0")}`;
        const r = await ctx.bridge.call("capture.masked", { name, tiles, rotations: [rotation] });
        const s = r.screenshots[0];
        if (!s) return null;
        const file = join(paths.screenshots(ctx.config), s.file);
        if (!(await waitForFile(file, 5000))) return null;
        try {
            const view = { centerX: s.centerX, centerY: s.centerY, centerZ: s.centerZ, zoom: s.zoom, rotation: s.rotation, width: s.width, height: s.height };
            return maskCapture(readFileSync(file), view, columnsOf(rec)).png;
        } catch {
            return readFileSync(file);
        }
    };

    defineTool(
        server,
        ctx,
        "style_list",
        {
            title: "Styles annotés (Style Picker)",
            description:
                "Liste les styles que l'utilisateur a annotés dans le jeu avec le Style Picker (menu des plugins) : région, légende, " +
                "objets dominants, densité de scénerie par tuile, empilements (Zero Clearances : maxDz en baseHeight, stacked), terrain. " +
                "query classe par pertinence (légende, noms d'objets) : passe la consigne d'une demande Magic Fill. Lecture seule. " +
                "Exemple : { query: 'pine forest', limit: 5 }.",
            input: {
                query: z.string().max(200).optional(),
                limit: z.number().int().min(1).max(25).default(10),
                cursor: z.number().int().min(0).default(0),
            },
            readOnly: true,
        },
        async (args) => {
            await sync.drain();
            const ranked = store.search(args.query);
            const page = ranked.slice(args.cursor, args.cursor + args.limit);
            const next = args.cursor + page.length < ranked.length ? args.cursor + page.length : null;
            return result({
                response: {
                    summary: ranked.length
                        ? `${ranked.length} style(s) dans ${store.stylesDir}.`
                        : "Aucun style : l'utilisateur doit en annoter avec le Style Picker (menu des plugins du jeu), ou style_save.",
                    styles: page.map((p) => ({ ...compact(summarize(p.record)), score: args.query ? Math.round(p.score * 100) / 100 : undefined })),
                    nextCursor: next,
                },
            });
        },
    );

    defineTool(
        server,
        ctx,
        "style_get",
        {
            title: "Détail d'un style",
            description:
                "Un style annoté : légende, composition (objets, nombre, variantes de couleurs, orientations), hauteurs relatives au sol " +
                "(baseHeight, 1 niveau = 2), terrain, attractions de la région, et sa capture masquée (région seule, fond transparent). " +
                "rotation 0-3 : une seule vue ; sans rotation : planche des 4 vues. Sert à juger si un style convient avant magic_fill_apply.",
            input: {
                id: z.string(),
                image: z.boolean().default(true),
                rotation: z.number().int().min(0).max(3).optional(),
            },
            readOnly: true,
        },
        async (args) => {
            const r = requireStyle(args.id);
            const s = summarize(r);
            const objects = new Map<string, { n: number; colours: Map<string, number>; dz: Map<number, number> }>();
            for (const e of r.elements) {
                if (!e.object || !(e.t === "small_scenery" || e.t === "wall" || (e.t === "large_scenery" && (e.sequence ?? 0) === 0))) continue;
                const o = objects.get(e.object) ?? { n: 0, colours: new Map(), dz: new Map() };
                o.n++;
                const c = (e.colours ?? []).join("/");
                o.colours.set(c, (o.colours.get(c) ?? 0) + 1);
                o.dz.set(e.dz, (o.dz.get(e.dz) ?? 0) + 1);
                objects.set(e.object, o);
            }
            const composition = [...objects.entries()]
                .sort((a, b) => b[1].n - a[1].n)
                .slice(0, 20)
                .map(([id, o]) => ({
                    id,
                    name: r.objects[id]?.name ?? id,
                    type: r.objects[id]?.type,
                    n: o.n,
                    colours: [...o.colours.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([c, n]) => `${c} ×${n}`),
                    dz: [...o.dz.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([d, n]) => `${d} ×${n}`),
                }));
            const images: { data: Buffer; mimeType: string }[] = [];
            if (args.image && r.screenshots.length) {
                if (args.rotation !== undefined) {
                    const png = store.screenshot(r.id, args.rotation);
                    if (png) images.push({ data: png, mimeType: "image/png" });
                } else {
                    const shots = r.screenshots
                        .map((sh) => ({ png: store.screenshot(r.id, sh.rotation), label: `R${sh.rotation}` }))
                        .filter((x): x is { png: Buffer; label: string } => x.png !== null);
                    if (shots.length) images.push({ data: contactSheet(shots), mimeType: "image/png" });
                }
            }
            return result({
                response: {
                    summary: `${r.id} « ${r.caption} » : ${s.tiles} tuiles, ${s.density} élément(s) de scénerie par tuile, ${composition.length} objet(s) différent(s).`,
                    ...compact(s),
                    counts: s.counts,
                    composition,
                    origin: r.origin,
                    park: s.park,
                    rides: r.rides.map((x) => ({ name: x.name, object: x.object, classification: x.classification, colourSchemes: x.colourSchemes.slice(0, 1), vehicleColours: x.vehicleColours.slice(0, 1) })),
                    screenshotError: r.screenshotError,
                    dir: store.dirOf(r.id),
                },
                images,
                budget: BUDGET.readLarge,
            });
        },
    );

    defineTool(
        server,
        ctx,
        "style_save",
        {
            title: "Annoter un style (comme le Style Picker)",
            description:
                "Relève une région du parc comme style (tous les éléments, couleurs, rotations, hauteurs exactes, terrain) avec sa capture " +
                "masquée, et la range dans la base de styles, comme le bouton « Save Style » du Style Picker en jeu. À utiliser quand " +
                "l'utilisateur désigne une zone réussie par ses coordonnées. Exemple : { rect: { x1: 40, y1: 40, x2: 52, y2: 50 }, caption: 'pinède dense en bord de lac' }.",
            input: {
                tiles: zTiles.optional(),
                rect: z.object(zRectShape).optional(),
                caption: z.string().min(1).max(500),
            },
        },
        async (args) => {
            const tiles = tilesFrom(args);
            const rec = await ctx.bridge.call("styles.capture", { tiles, caption: args.caption, source: "claude" }, { timeoutMs: 60_000 });
            const record = { ...rec, id: StyleStore.idFor(rec.caption, rec.id) };
            const saved = store.save(record, paths.screenshots(ctx.config));
            const s = summarize(record);
            return result({
                response: {
                    summary: `Style ${record.id} enregistré : ${record.elements.length} élément(s), ${saved.screenshots} capture(s).`,
                    ...compact(s),
                    warnings: record.screenshotError ? [`Captures : ${record.screenshotError}`] : undefined,
                },
                budget: BUDGET.write,
            });
        },
    );

    defineTool(
        server,
        ctx,
        "style_delete",
        {
            title: "Supprimer un style",
            description:
                "Supprime un style de la base (dossier entier), ou toute la base avec all: true (comme le bouton « Clear all stored styles » " +
                "du Style Picker). Seulement à la demande de l'utilisateur.",
            input: {
                id: z.string().optional(),
                all: z.boolean().default(false).describe("Vide toute la base de styles."),
            },
            destructive: true,
        },
        async (args) => {
            if (args.all) {
                const n = store.clearAll();
                return result({ response: { summary: `Base de styles vidée : ${n} style(s) supprimé(s).` }, budget: BUDGET.write });
            }
            if (!args.id) toolError("INVALID_PARAMS", "id ou all: true requis.", { hint: "style_list donne les identifiants." });
            const id = args.id as string;
            requireStyle(id);
            store.delete(id);
            return result({ response: { summary: `Style ${id} supprimé.` }, budget: BUDGET.write });
        },
    );

    defineTool(
        server,
        ctx,
        "magic_fill_requests",
        {
            title: "Demandes du Magic Fill Tool",
            description:
                "Demandes faites dans le jeu avec le Magic Fill Tool (menu des plugins) : région peinte au pinceau + consigne (« forêt de pins »). " +
                "Pour chacune : terrain de la région (eau, pentes, déjà occupé, chemins), voisinage (objets autour, densité : pour rester " +
                "cohérent avec l'existant) et styles candidats classés selon la consigne. wait (secondes) attend une nouvelle demande si " +
                "aucune n'est ouverte : boucle de service « traite les Magic Fill au fil de l'eau ». Ensuite : style_get des candidats " +
                "utiles, puis magic_fill_apply { request, styles: [{ id, weight }] }, ou magic_fill_dismiss si rien ne convient.",
            input: {
                wait: z.number().int().min(0).max(600).default(0),
                recent: z.boolean().default(false).describe("Montre aussi les dernières demandes traitées."),
            },
            readOnly: true,
        },
        async (args) => {
            await sync.drain();
            if (fills.open().length === 0 && args.wait > 0) await fills.waitForNew(args.wait * 1000);
            const open = fills.open();
            const details = [];
            for (const e of open.slice(0, 3)) {
                const tiles = e.request.tiles.map(([x, y]) => ({ x, y }));
                const why = (err: unknown) => (err instanceof Error ? err.message : String(err));
                let target: Record<string, unknown> | string;
                let around: Record<string, unknown> | string;
                try {
                    const rec = await extract(tiles);
                    const t = targetOf(rec);
                    const s = summarize(rec);
                    target = {
                        tiles: t.length,
                        bbox: { x1: rec.origin.x, y1: rec.origin.y, x2: rec.origin.x + rec.size.x - 1, y2: rec.origin.y + rec.size.y - 1 },
                        blockedByPaths: t.filter((x) => x.blocked).length,
                        alreadyScenery: t.filter((x) => x.occupied).length,
                        existing: s.topObjects.map((o) => `${o.name} ×${o.n}`),
                        terrain: s.terrain,
                    };
                } catch (err) {
                    target = `relevé impossible : ${why(err)}`;
                    log.warn("relevé Magic Fill impossible (région)", { request: e.request.id, message: why(err) });
                }
                try {
                    around = neighbourhood(await extract(ringOf(tiles, 4, ctx.bridge.hello?.mapSize ?? null)));
                } catch (err) {
                    around = `relevé impossible : ${why(err)}`;
                    log.warn("relevé Magic Fill impossible (voisinage)", { request: e.request.id, message: why(err) });
                }
                const candidates = store
                    .search(e.request.prompt)
                    .slice(0, 6)
                    .map((c) => ({ ...compact(summarize(c.record)), score: Math.round(c.score * 100) / 100 }));
                // Même région déjà remplie par une demande précédente : refaire = revenir à son checkpoint.
                const own = new Set(e.request.tiles.map(([x, y]) => `${x},${y}`));
                const previousFills = fills
                    .recent(50)
                    .filter((p) => p !== e && p.result && p.checkpoint)
                    .map((p) => ({ id: p.request.id, prompt: p.request.prompt, overlap: p.request.tiles.filter(([x, y]) => own.has(`${x},${y}`)).length }))
                    .filter((p) => p.overlap >= Math.min(own.size, 4))
                    .slice(0, 3);
                details.push({ id: e.request.id, prompt: e.request.prompt, status: e.status, createdAt: e.request.createdAt, target, around, candidates, previousFills: previousFills.length ? previousFills : undefined });
                if (e.status === "received") await setStatus(e.request.id, "working", "Claude choisit les styles…");
            }
            const recent = args.recent ? fills.recent(5).filter((e) => !open.includes(e)).map((e) => ({ id: e.request.id, prompt: e.request.prompt, status: e.status, message: e.message })) : undefined;
            return result({
                response: {
                    summary: open.length
                        ? `${open.length} demande(s) Magic Fill ouverte(s).`
                        : args.wait > 0
                          ? `Aucune demande pendant ${args.wait} s.`
                          : "Aucune demande Magic Fill ouverte.",
                    requests: details,
                    // Les plus récentes d'abord ; les plus anciennes, souvent périmées, restent nommées.
                    more: open.length > 3 ? open.slice(3).map((e) => ({ id: e.request.id, prompt: e.request.prompt, createdAt: e.request.createdAt })) : undefined,
                    recent,
                    next_hints: open.length
                        ? [
                              "Choisis 1 à 3 styles qui correspondent à la consigne ET au voisinage (around.objects), regarde-les (style_get), puis magic_fill_apply { request, styles: [{ id, weight }] }.",
                              "previousFills : la région a déjà été remplie. Pour la refaire, magic_fill_revert { request: <ancienne> } (retour au checkpoint d'avant) puis magic_fill_apply sur la nouvelle ; ne vide pas la scénerie et n'aplanis pas à la main.",
                              "Un style sans objets n'est pas forcément vide : structure 'bâtiment en terrain' = colonnes de terrain à bords à pic avec une bordure de façade (gratte-ciel RCT1, terrain.edges). C'est un vrai bâtiment, recopié par relief + texture 'copy' : prends-le pour une ville, des immeubles, des tours. Regarde la capture (style_get) avant d'écarter un style.",
                              "Le relief des styles (collines, creux : terrain.heightRange ; bâtiments : structure) est recopié par magic_fill_apply (relief: 'copy', défaut) ; relief permis dans target.bbox tant que la demande est ouverte (terrain_flatten, terrain_shape… sans session_set_landscape).",
                              "Eau : l'eau des styles (terrain.waterShare) est recopiée en mares ; pour une rivière continue, magic_fill_apply la trace (river, automatique si la consigne dit rivière/river/stream). Vérifie water.tiles dans le résultat avant de parler d'eau.",
                          ]
                        : ["L'utilisateur peint une région avec le Magic Fill Tool (menu des plugins) ; magic_fill_requests { wait: 120 } attend la suivante."],
                },
                budget: BUDGET.readLarge,
            });
        },
    );

    defineTool(
        server,
        ctx,
        "magic_fill_dismiss",
        {
            title: "Refuser une demande Magic Fill",
            description: "Ferme une demande sans la remplir (aucun style ne convient, consigne impossible) ; la raison s'affiche dans la fenêtre du jeu.",
            input: { request: z.string(), reason: z.string().min(1).max(200) },
        },
        async (args) => {
            if (!fills.get(args.request)) toolError("NOT_FOUND", `Demande introuvable : ${args.request}.`);
            await setStatus(args.request, "dismissed", args.reason);
            return result({ response: { summary: `Demande ${args.request} fermée : ${args.reason}` }, budget: BUDGET.write });
        },
    );

    defineTool(
        server,
        ctx,
        "magic_fill_revert",
        {
            title: "Défaire un remplissage Magic Fill (checkpoint)",
            description:
                "Ramène le parc à l'état d'avant le premier remplissage d'une demande : magic_fill_apply prend un checkpoint automatique " +
                "juste avant (relief, textures et scénerie d'origine). Beaucoup plus rapide et exact que vider la scénerie et aplanir à la main. " +
                "Refuse si d'autres opérations journalisées ont suivi (elles seraient perdues), sauf discardLaterWork: true avec l'accord " +
                "de l'utilisateur ; les modifications faites à la main en jeu depuis sont perdues aussi. reopen (défaut) rouvre la demande " +
                "(relief permis dans son emprise) pour un nouveau magic_fill_apply ; pour refaire en une fois : magic_fill_apply { redo: true }.",
            input: {
                request: z.string(),
                reopen: z.boolean().default(true),
                discardLaterWork: z.boolean().default(false),
            },
            destructive: true,
        },
        async (args) => {
            const e = fills.get(args.request);
            if (!e) toolError("NOT_FOUND", `Demande introuvable : ${args.request}.`, { hint: "magic_fill_requests { recent: true } liste les demandes." });
            const entry = e as FillEntry;
            const lost = await revertFill(entry, args.discardLaterWork);
            if (args.reopen) await setStatus(entry.request.id, "working", "Reverted; refilling…");
            else await setStatus(entry.request.id, "dismissed", "Reverted");
            return result({
                response: {
                    summary: `Région de ${entry.request.id} revenue à son état d'avant remplissage (checkpoint ${entry.checkpoint}).${lost.length ? ` ${lost.length} opération(s) postérieure(s) perdue(s).` : ""}`,
                    lost: lost.length ? lost.slice(-10) : undefined,
                    next_hints: args.reopen ? [`magic_fill_apply { request: '${entry.request.id}', … } avec les nouveaux réglages (reliefScale pour des collines plus hautes).`] : [],
                },
                budget: BUDGET.write,
            });
        },
    );

    defineTool(
        server,
        ctx,
        "magic_fill_apply",
        {
            title: "Remplir une région à partir de styles",
            description:
                "Remplit une région (demande du Magic Fill Tool, ou tiles/rect) en recopiant des patchs des styles choisis : bosquets, " +
                "espacements, empilements Zero Clearances, couleurs et orientations sont gardés ; chaque patch peut tourner (rotate). " +
                "relief: 'copy' (défaut) recopie aussi le relief du style (collines, creux) par-dessus le terrain existant, adouci vers le " +
                "bord de la région, avant de poser la scénerie ; permis dans l'emprise d'une demande ouverte (sinon session_set_landscape). " +
                "reliefScale multiplie la hauteur de ce relief (2 : collines deux fois plus hautes). " +
                "relief: 'keep' laisse le terrain tel quel. texture: 'copy' (défaut, même permission que le relief) recopie la " +
                "surface (herbe, roche…) et la bordure (falaises) de chaque tuile du style ; 'keep' les laisse. " +
                "Bâtiments en terrain (style_list : structure, ex. gratte-ciel RCT1 à bordure Skyscraper) : relief + texture 'copy' les " +
                "construisent ; chaque bâtiment est posé entier ou pas du tout (jamais coupé), à sa hauteur d'origine (reliefScale ne " +
                "s'y applique pas). Pour une ville en forêt : le style bâtiment avec un poids assez fort (ex. 3) + les styles de forêt. " +
                "Pose SANS contrôle de dégagement (cheat Zero Clearances activé le temps de la pose, puis rétabli). " +
                "styles : 1 à 8 { id, weight } (poids relatifs : 3 forêt + 1 clairière). density < 1 éclaircit. occupied : skip (défaut, " +
                "ne touche pas les tuiles déjà décorées), add (ajoute par-dessus), replace (vide la scénerie de ces tuiles d'abord, " +
                "non annulable). Les tuiles à chemin, piste ou entrée sont évitées (avoidPaths). Seules petite scénerie, grande scénerie " +
                "et murs sont posés ; les objets manquants sont chargés. Renvoie les compteurs et, sauf dryRun, une planche « résultat | " +
                "style » (même rotation) pour vérifier que ça ressemble ; si non, undo_last puis autre choix (styles, poids, density, seed). " +
                "water: 'copy' (défaut, même permission) remet en eau les tuiles d'eau du style (mares, ruisseaux), si l'eau reste " +
                "contenue par ses berges. Les tampons étant tirés au hasard, ils ne font pas de cours d'eau continu : river trace d'abord " +
                "une rivière d'un bord à l'autre (path : ligne brisée en tuiles, sinon zigzag automatique ; width, depth, bends), puis les " +
                "styles sont tamponnés autour (leur eau sur la rivière). river: 'auto' (défaut) la trace si la consigne de la demande dit " +
                "rivière/river/stream ; 'none' jamais. Le résultat compte l'eau posée (water) : ne décris jamais à l'utilisateur de l'eau " +
                "que ce compte ne montre pas. " +
                "Avec request, un checkpoint est pris juste avant le premier remplissage. REFAIRE une demande déjà remplie (« même chose " +
                "avec des collines plus hautes ») : redo: true revient à ce checkpoint puis remplit avec les nouveaux réglages ; ne vide " +
                "jamais la scénerie et n'aplanis jamais le terrain à la main pour refaire. " +
                "Exemple : { request: 'fill-…', styles: [{ id: 'style-…-pine-forest', weight: 3 }, { id: 'style-…-meadow', weight: 1 }] }.",
            input: {
                request: z.string().optional(),
                tiles: zTiles.optional(),
                rect: z.object(zRectShape).optional(),
                styles: z.array(z.object({ id: z.string(), weight: z.number().min(0).max(100).default(1) })).min(1).max(8),
                seed: z.number().int().optional(),
                density: z.number().min(0.05).max(1).default(1),
                rotate: z.boolean().default(true),
                occupied: z.enum(["skip", "add", "replace"]).default("skip"),
                avoidPaths: z.boolean().default(true),
                include: z.array(z.enum(["small_scenery", "large_scenery", "wall"])).min(1).default(["small_scenery", "large_scenery", "wall"]),
                matchWater: z.boolean().default(true),
                relief: z.enum(["copy", "keep"]).default("copy").describe("copy : recopie collines, creux et falaises du style ; keep : terrain inchangé."),
                reliefScale: z.number().min(0.25).max(4).default(1).describe("Multiplie la hauteur du relief recopié (2 : collines deux fois plus hautes)."),
                redo: z.boolean().default(false).describe("Demande déjà remplie : revient d'abord à son checkpoint d'avant remplissage (magic_fill_revert), puis remplit."),
                discardLaterWork: z.boolean().default(false).describe("Avec redo : accepte de perdre les opérations faites après ce remplissage (accord de l'utilisateur)."),
                texture: z.enum(["copy", "keep"]).default("copy").describe("copy : recopie surface et bordure du style ; keep : textures inchangées."),
                water: z.enum(["copy", "keep"]).default("copy").describe("copy : remet en eau les tuiles d'eau du style ; keep : eau inchangée."),
                river: z
                    .union([
                        z.enum(["auto", "none"]),
                        z.object({
                            path: z.array(zTile).min(2).max(64).optional().describe("Ligne brisée en tuiles ; absente : zigzag le long du grand axe de la région."),
                            width: z.number().int().min(1).max(8).default(2),
                            depth: z.number().int().min(1).max(6).default(2).describe("Lit sous l'eau, en niveaux."),
                            bends: z.number().int().min(0).max(12).default(4).describe("Zigzag automatique : nombre de virages."),
                        }),
                    ])
                    .default("auto")
                    .describe("Cours d'eau continu tracé avant les styles. auto : si la consigne de la demande parle de rivière."),
                compare: z.boolean().default(true),
                rotation: z.number().int().min(0).max(3).default(0),
                dryRun: z.boolean().default(false),
            },
        },
        async (args) => {
            await sync.drain();
            const req = args.request ? fills.get(args.request) : undefined;
            if (args.request && !req) toolError("NOT_FOUND", `Demande introuvable : ${args.request}.`, { hint: "magic_fill_requests liste les demandes ouvertes." });
            if (args.redo && !req) toolError("INVALID_PARAMS", "redo demande 'request'.");
            let lost: string[] = [];
            if (req && args.redo && req.result && !args.dryRun) {
                lost = await revertFill(req, args.discardLaterWork);
                await setStatus(req.request.id, "working", "Reverted; refilling…");
            } else if (req?.result && !args.redo && !args.dryRun)
                toolError("INVALID_PARAMS", `La demande ${req.request.id} est déjà remplie.`, {
                    hint: "Pour la refaire autrement : redo: true (retour au checkpoint d'avant remplissage, puis nouveau remplissage). Pour ajouter par-dessus : tiles ou rect, occupied: 'add'.",
                });
            const tiles = req ? req.request.tiles.map(([x, y]) => ({ x, y })) : tilesFrom(args);
            const sources = args.styles.map((s) => ({ record: requireStyle(s.id), weight: s.weight }));
            const seed = args.seed ?? Math.floor(Math.random() * 1e9);
            const before = await extract(tiles);
            // Relief : permis dans l'emprise d'une demande ouverte ou si l'utilisateur l'a accordé (SPEC 9.2).
            const warnings: string[] = [];
            let relief = args.relief;
            let texture = args.texture;
            let water = args.water;
            const prompt = req?.request.prompt ?? "";
            let river =
                args.river === "none" ? undefined : args.river === "auto" ? (RIVER_WORDS.test(prompt) ? { width: 2, depth: 2, bends: 4 } : undefined) : args.river;
            if (relief === "copy" || texture === "copy" || water === "copy" || river) {
                const bbox = { x1: before.origin.x, y1: before.origin.y, x2: before.origin.x + before.size.x - 1, y2: before.origin.y + before.size.y - 1 };
                try {
                    requireLandscape(ctx, "magic_fill_apply", false, bbox);
                } catch {
                    if (relief === "copy" && sources.some((s) => summarize(s.record).terrain.heightRange > 0))
                        warnings.push("Relief du style NON recopié : relief verrouillé hors d'une demande Magic Fill ouverte (session_set_landscape si l'utilisateur l'accepte).");
                    if (texture === "copy") warnings.push("Textures du style (surface, bordure) NON recopiées : relief verrouillé, même règle.");
                    if (sources.some((s) => summarize(s.record).structure?.kind === "building"))
                        warnings.push("Bâtiments en terrain NON construits : ils sont faits de relief et de bordures, verrouillés ici.");
                    if (water === "copy" && sources.some((s) => summarize(s.record).terrain.waterShare > 0))
                        warnings.push("Eau du style NON recopiée : relief verrouillé, même règle.");
                    if (river) warnings.push("Rivière NON tracée : relief verrouillé, même règle.");
                    relief = "keep";
                    texture = "keep";
                    water = "keep";
                    river = undefined;
                }
            }
            const plan: FillPlan = planMagicFill(targetOf(before), sources, {
                seed,
                density: args.density,
                rotate: args.rotate,
                occupied: args.occupied,
                avoidPaths: args.avoidPaths,
                include: args.include as FillType[],
                matchWater: args.matchWater,
                relief,
                reliefScale: args.reliefScale,
                texture,
                water,
                river,
            });
            const planned = plan.small.length + plan.large.length + plan.walls.length;
            const reshaped = plan.terrain.length;
            const retextured = plan.textures.length;
            const base = {
                seed,
                tiles: plan.tiles,
                stamps: plan.stamps,
                planned: { small: plan.small.length, large: plan.large.length, walls: plan.walls.length },
                relief: reshaped
                    ? { tiles: reshaped, maxRiseLevels: plan.relief.maxRise, cliffEdges: plan.relief.cliffs || undefined, leftUnchanged: plan.relief.invalid || undefined }
                    : relief === "keep"
                      ? "keep"
                      : "plat (rien à recopier)",
                textures: retextured || (texture === "keep" ? "keep" : 0),
                buildings: plan.buildings.stamps || plan.buildings.misses ? plan.buildings : undefined,
                water: {
                    tiles: plan.water.length,
                    fromStyles: plan.waterInfo.fromStyles,
                    river: plan.waterInfo.river
                        ? { tiles: plan.waterInfo.river.tiles, level: plan.waterInfo.river.level, bedLevel: plan.waterInfo.river.bed, path: plan.waterInfo.river.path.map((p) => [p.x, p.y]) }
                        : undefined,
                    leaked: plan.waterInfo.leaked || undefined,
                },
                notPlaced: Object.keys(plan.notPlaced).length ? plan.notPlaced : undefined,
            };
            if (plan.waterInfo.leaked)
                warnings.push(`${plan.waterInfo.leaked} tuile(s) d'eau laissée(s) sèche(s) : l'eau aurait débordé sur un sol plus bas (berge, chemin, bord de la région).`);
            if (river && plan.water.length === 0)
                warnings.push("Rivière demandée mais aucune tuile d'eau posée (tracé hors des tuiles libres, ou eau non contenue) : donne river.path dans la région.");
            else if (!river && RIVER_WORDS.test(prompt))
                warnings.push("La consigne parle d'un cours d'eau, mais aucune rivière n'est tracée (river: 'none') : l'eau des styles ne fait que des mares.");
            if (WATER_WORDS.test(prompt) || RIVER_WORDS.test(prompt)) {
                if (plan.water.length === 0)
                    warnings.push(
                        "AUCUNE EAU POSÉE alors que la consigne en demande : ne dis pas à l'utilisateur qu'il y a de l'eau. Relance avec redo: true et river (ou un style qui contient de l'eau).",
                    );
            }
            if (relief === "copy" && plan.buildings.misses && !plan.buildings.stamps)
                warnings.push("Aucun bâtiment posé : aucun emplacement libre assez grand pour un tampon entier (rivière, chemins, tuiles déjà décorées). Augmente son poids, ou occupied: 'replace'.");
            if (BUILDING_WORDS.test(prompt) && !sources.some((s) => hasBuildings(s.record)))
                warnings.push("La consigne demande des bâtiments, mais aucun style choisi n'en contient (style_list : structure 'bâtiment en terrain', ou objets de bâtiment) : ne dis pas à l'utilisateur qu'il y a une ville.");
            const nothing = planned === 0 && reshaped === 0 && retextured === 0 && plan.water.length === 0;
            if (args.dryRun || nothing) {
                return result({
                    response: {
                        summary: nothing
                            ? "Rien à poser (tuiles évitées, styles vides ou eau incompatible)."
                            : `Simulation : ${planned} élément(s) à poser, ${reshaped} tuile(s) de relief, ${retextured} tuile(s) de texture, ${plan.water.length} tuile(s) d'eau (graine ${seed}).`,
                        ...base,
                        warnings: warnings.length ? warnings : undefined,
                        next_hints: planned === 0 ? ["occupied: 'add' ou 'replace' si la région est déjà décorée ; matchWater: false pour l'eau."] : ["Rejoue sans dryRun avec la même seed pour obtenir ce plan."],
                    },
                    budget: BUDGET.write * 2,
                });
            }
            if (req && !req.result && !(req.checkpoint && checkpointExists(ctx, req.checkpoint))) {
                // Checkpoint d'avant remplissage : refaire la demande y revient (redo, magic_fill_revert).
                const name = `mf-${req.request.id.replace(/[^a-zA-Z0-9_-]/g, "").slice(-44)}`;
                try {
                    await saveCheckpoint(ctx, name);
                    fills.setCheckpoint(req.request.id, name, ctx.journal.peek(1)[0]?.id ?? 0);
                } catch (e) {
                    warnings.push(`Checkpoint d'avant remplissage non pris (${e instanceof Error ? e.message : String(e)}) : redo impossible, undo_last reste possible.`);
                }
            }
            if (req) await setStatus(req.request.id, "working", `Pose de ${planned} élément(s)…`);

            // Objets : chargés si besoin ; les éléments d'objets introuvables ou sans place dans le parc sont écartés.
            const missing = new Set<string>();
            const overLimit = new Set<string>();
            const loadedIds = new Set<string>();
            for (const type of ["small_scenery", "large_scenery", "wall", "terrain_surface", "terrain_edge"]) {
                for (let cursor: number | null = 0, guard = 0; cursor !== null && guard < 20; guard++) {
                    const page: { items: { identifier: string }[]; nextCursor: number | null } = await ctx.bridge.call("objects.list", { type, loadedOnly: true, limit: 200, cursor });
                    for (const o of page.items) loadedIds.add(o.identifier);
                    cursor = page.nextCursor;
                }
            }
            const toLoad = plan.objects.filter((o) => !loadedIds.has(o));
            const loadedNow: string[] = [];
            for (const c of chunks(toLoad, 100)) {
                const r = await ctx.bridge.call("objects.load", { identifiers: c });
                for (const x of r.results) {
                    if (x.ok) loadedNow.push(x.identifier);
                    else {
                        missing.add(x.identifier);
                        if (x.reason === "limit") overLimit.add(x.identifier);
                    }
                }
            }
            const keep = <T extends { object: string }>(items: T[]) => items.filter((i) => !missing.has(i.object));
            // Textures : un objet manquant laisse ce champ inchangé.
            const ok = (o: string | null) => (o && !missing.has(o) ? o : null);
            const textures = plan.textures.map((t, n) => ({ t: { ...t, surface: ok(t.surface), edge: ok(t.edge) }, b: plan.texturesBefore[n] })).filter(({ t }) => t.surface || t.edge);
            const all = [...plan.small, ...plan.large, ...plan.walls];
            const discarded = all.filter((i) => overLimit.has(i.object)).length;
            if (overLimit.size) {
                // Instructions : prévenir l'utilisateur par une boîte d'avertissement, puis poser le reste.
                const names = [...overLimit].slice(0, 4).join(", ") + (overLimit.size > 4 ? ", …" : "");
                try {
                    await ctx.bridge.call("ui.alert", {
                        title: "Magic Fill Tool",
                        message: `Object limit reached: ${overLimit.size} object(s) could not be loaded into this park (${names}). ${discarded} element(s) using them are skipped; the rest is placed.`,
                    });
                } catch (e) {
                    log.warn("avertissement de limite d'objets non affiché", { message: e instanceof Error ? e.message : String(e) });
                }
            }

            const cheats = await ctx.bridge.call("session.cheats.get", {});
            const hadZeroClearance = cheats.disableClearanceChecks === true;
            const results: BulkResult[] = [];
            const inverse: InverseOp[] = [];
            let cleared = 0;
            let terrainOk = 0;
            let terrainFailed = 0;
            let textureOk = 0;
            let textureFailed = 0;
            let waterOk = 0;
            let waterFailed = 0;
            try {
                if (!hadZeroClearance) await ctx.bridge.call("session.cheats.set", { items: [{ cheat: "disableClearanceChecks", param1: 1 }] });
                if (plan.clear.length) {
                    for (const c of chunks(plan.clear, 400)) {
                        const ops = c.map((t) => ({
                            action: "clearscenery",
                            args: { x1: t.x * 32, y1: t.y * 32, x2: t.x * 32, y2: t.y * 32, itemsToClear: CLEAR_ITEMS.smallScenery | CLEAR_ITEMS.largeScenery | CLEAR_ITEMS.walls },
                        }));
                        const r = await ctx.bridge.call("batch.execute", { ops, dryRun: false, stopOnError: false });
                        cleared += r.results.filter((x) => x.ok).length;
                    }
                }
                // Relief avant la scénerie (landsetheight retire la petite scénerie de la tuile).
                if (reshaped) {
                    const done = new Set<string>();
                    for (const c of chunks(plan.terrain)) {
                        const r = await ctx.bridge.call("terrain.set_heights", { tiles: c, dryRun: false });
                        r.results.forEach((o) => (o.ok ? done.add(`${o.x},${o.y}`) : terrainFailed++));
                    }
                    terrainOk = done.size;
                    const back = plan.terrainBefore.filter((b) => done.has(`${b.x},${b.y}`));
                    for (const c of chunks(back)) inverse.push({ method: "terrain.set_heights", params: { tiles: c } } as InverseOp);
                }
                for (const c of chunks(textures)) {
                    const r = await ctx.bridge.call("terrain.set_surface_tiles", { tiles: c.map(({ t }) => ({ x: t.x, y: t.y, surfaceObject: t.surface, edgeObject: t.edge })), dryRun: false });
                    const back = c
                        .filter((_, n) => r.results[n]?.ok)
                        .map(({ t, b }) => ({ x: b.x, y: b.y, surfaceObject: t.surface ? b.surface : null, edgeObject: t.edge ? b.edge : null }))
                        .filter((b) => b.surfaceObject || b.edgeObject);
                    textureOk += r.placed;
                    textureFailed += r.failed;
                    if (back.length) inverse.push({ method: "terrain.set_surface_tiles", params: { tiles: back } } as InverseOp);
                }
                // Eau après le relief (terrain.set_water prend un rectangle : segments de ligne au même niveau).
                const runs: (TileRect & { level: number })[] = [];
                for (const w of [...plan.water].sort((a, b) => a.y - b.y || a.x - b.x)) {
                    const last = runs[runs.length - 1];
                    if (last && last.y1 === w.y && last.x2 === w.x - 1 && last.level === w.level) last.x2 = w.x;
                    else runs.push({ x1: w.x, y1: w.y, x2: w.x, y2: w.y, level: w.level });
                }
                for (const r of runs) {
                    const res = await ctx.bridge.call("terrain.set_water", { ...r, dryRun: false });
                    waterOk += res.placed;
                    waterFailed += res.failed;
                    if (res.placed) inverse.push({ method: "terrain.set_water", params: { x1: r.x1, y1: r.y1, x2: r.x2, y2: r.y2, level: 0 } } as InverseOp);
                }
                const large = keep(plan.large);
                for (const c of chunks(large, 400)) {
                    const r = await ctx.bridge.call("scenery.place_large", { items: c.map((i) => ({ object: i.object, x: i.x, y: i.y, baseHeight: i.baseHeight, direction: i.direction as 0 | 1 | 2 | 3, colours: i.colours })) });
                    results.push(r);
                    r.results.forEach((o, n) => {
                        if (!o.ok) return;
                        const z = o.level !== undefined ? o.level * 16 : c[n].baseHeight * 8;
                        inverse.push({ method: "batch.execute", params: { ops: [{ action: "largesceneryremove", args: { x: c[n].x * 32, y: c[n].y * 32, z, direction: c[n].direction, tileIndex: 0 } }] } } as InverseOp);
                    });
                }
                const walls = keep(plan.walls);
                for (const c of chunks(walls, 400)) {
                    const r = await ctx.bridge.call("scenery.place_wall", { items: c.map((i) => ({ object: i.object, x: i.x, y: i.y, baseHeight: i.baseHeight, edge: i.edge as 0 | 1 | 2 | 3, colours: i.colours })) });
                    results.push(r);
                    const ops = r.results
                        .map((o, n) => (o.ok ? { action: "wallremove", args: { x: c[n].x * 32, y: c[n].y * 32, z: o.level !== undefined ? o.level * 16 : (c[n].baseHeight ?? 0) * 8, direction: c[n].edge } } : null))
                        .filter((x): x is NonNullable<typeof x> => x !== null);
                    if (ops.length) inverse.push({ method: "batch.execute", params: { ops } } as InverseOp);
                }
                const small = keep(plan.small);
                for (const c of chunks(small, 400)) {
                    const r = await ctx.bridge.call("scenery.place_small", {
                        items: c.map((i) => ({ object: i.object, x: i.x, y: i.y, baseHeight: i.baseHeight, quadrant: i.quadrant, direction: i.direction as 0 | 1 | 2 | 3, colours: i.colours })),
                    });
                    results.push(r);
                    const removable = r.results
                        .map((o, n) => (o.ok ? { x: c[n].x, y: c[n].y, level: o.level ?? 0, baseHeight: o.level !== undefined ? Math.round(o.level * 2) : (c[n].baseHeight ?? undefined), object: c[n].object, quadrant: c[n].quadrant } : null))
                        .filter((x): x is NonNullable<typeof x> => x !== null);
                    for (const rc of chunks(removable)) inverse.push({ method: "scenery.remove_small", params: { items: rc } } as InverseOp);
                }
            } finally {
                if (!hadZeroClearance) {
                    try {
                        await ctx.bridge.call("session.cheats.set", { items: [{ cheat: "disableClearanceChecks", param1: 0 }] });
                    } catch (e) {
                        log.error("cheat Zero Clearances non rétabli", { message: e instanceof Error ? e.message : String(e) });
                    }
                }
            }
            const placed = results.reduce((n, r) => n + r.placed, 0);
            const failed = results.reduce((n, r) => n + r.failed, 0);
            const cost = results.reduce((n, r) => n + r.totalCost, 0);
            ctx.cache.invalidateTiles(tiles, 1);
            ctx.journal.record({
                tool: "magic_fill_apply",
                summary: `Magic Fill : ${placed} élément(s) sur ${tiles.length} tuiles${terrainOk ? `, relief sur ${terrainOk}` : ""}${textureOk ? `, texture sur ${textureOk}` : ""}${waterOk ? `, eau sur ${waterOk}` : ""}`,
                params: { request: args.request, styles: args.styles, seed },
                // Ordre inverse de la pose : petite scénerie, murs, grandes.
                inverse: inverse.reverse(),
                irreversible: inverse.length === 0 ? "rien de posé" : undefined,
                cost,
            });

            const images: { data: Buffer; mimeType: string }[] = [];
            if (textureFailed) warnings.push(`${textureFailed} tuile(s) de texture refusée(s) par le jeu.`);
            if (waterFailed) warnings.push(`${waterFailed} tuile(s) d'eau refusée(s) par le jeu.`);
            if (terrainFailed) warnings.push(`${terrainFailed} tuile(s) de relief refusée(s) par le jeu (propriété, objet sur la tuile).`);
            const notFound = [...missing].filter((o) => !overLimit.has(o));
            if (overLimit.size)
                warnings.push(
                    `LIMITE D'OBJETS du parc atteinte : ${overLimit.size} objet(s) non chargé(s) (${[...overLimit].slice(0, 5).join(", ")}), ${discarded} élément(s) écarté(s), le reste est posé. L'utilisateur a été prévenu en jeu. Préfère les objets déjà chargés (style_get) pour la suite.`,
                );
            const notFoundSet = new Set(notFound);
            const notFoundDiscarded = all.filter((i) => notFoundSet.has(i.object)).length;
            if (notFound.length)
                warnings.push(`${notFound.length} objet(s) non chargé(s), ${notFoundDiscarded} élément(s) écarté(s) : ${notFound.slice(0, 5).join(", ")}${notFound.length > 5 ? ", …" : ""}.`);
            if (cleared) warnings.push(`${cleared} tuile(s) vidée(s) avant la pose (occupied: replace) : undo_last ne les restaure pas.`);
            if (args.compare) {
                try {
                    const after = await extract(tiles);
                    const shot = await maskedShot(tiles, args.rotation, after);
                    if (shot) {
                        const panels = [{ png: shot, label: "RESULT" }];
                        const used = Object.entries(plan.stamps).sort((a, b) => b[1] - a[1]).slice(0, 2);
                        used.forEach(([id], n) => {
                            const png = store.screenshot(id, args.rotation);
                            if (png) panels.push({ png, label: `STYLE ${n + 1}` });
                        });
                        images.push({ data: contactSheet(panels), mimeType: "image/png" });
                    }
                } catch (e) {
                    warnings.push(`Capture de comparaison impossible : ${e instanceof Error ? e.message : String(e)}`);
                }
            }
            const limitNote = overLimit.size ? ` LIMITE D'OBJETS : ${discarded} élément(s) écarté(s) (${overLimit.size} objet(s)), utilisateur prévenu.` : "";
            const reliefNote =
                (terrainOk ? ` Relief recopié sur ${terrainOk} tuile(s).` : "") +
                (textureOk ? ` Texture recopiée sur ${textureOk} tuile(s).` : "") +
                (waterOk ? ` Eau posée sur ${waterOk} tuile(s)${plan.waterInfo.river ? ` dont une rivière de ${plan.waterInfo.river.tiles}` : ""}.` : " Aucune eau posée.");
            const redoNote = args.redo && req ? ` Refait depuis le checkpoint ${req.checkpoint}${lost.length ? ` (${lost.length} opération(s) postérieure(s) perdue(s))` : ""}.` : "";
            const summary = `Magic Fill : ${placed} élément(s) posé(s), ${failed} refus, coût ${cost} (graine ${seed}).${reliefNote}${limitNote}${redoNote}`;
            const statusText = `${placed} placed${failed ? `, ${failed} refused` : ""}${discarded ? `, ${discarded} skipped (object limit)` : ""}${notFoundDiscarded ? `, ${notFoundDiscarded} skipped (object not installed)` : ""}`;
            if (req) await setStatus(req.request.id, failed && !placed ? "failed" : "done", statusText, { placed, failed, discarded, seed, styles: args.styles });
            return result({
                response: {
                    summary,
                    changed: { placed, failed, cost, water: waterOk },
                    ...base,
                    loadedObjects: loadedNow.length ? loadedNow : undefined,
                    objectLimit: overLimit.size ? { objects: [...overLimit], discarded } : undefined,
                    errors: failed ? errorGroups(results) : undefined,
                    warnings: warnings.length ? warnings : undefined,
                    next_hints: [
                        images.length
                            ? `Compare RESULT aux STYLES : s'il manque de densité, de variété ou d'accord avec le voisinage, ${req ? "magic_fill_apply { redo: true, … }" : "undo_last puis magic_fill_apply"} avec autres styles, poids, density, seed ou reliefScale.`
                            : "Vérifie avec capture_view sur la région.",
                    ],
                },
                images,
                budget: BUDGET.read,
            });
        },
    );

    return { store, fills, sync };
}
