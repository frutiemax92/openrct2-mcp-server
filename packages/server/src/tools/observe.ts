import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { RIDE_TYPES, rectArea, tileCenterToWorld, type RideSummary, type TileRect } from "@openrct2-claude/protocol";
import { z } from "zod";
import { paths } from "../config.js";
import { log } from "../log.js";
import { analyzeConnectivity } from "../planners/connectivity.js";
import { cornerLevels } from "../planners/heightmap.js";
import { annotateCapture, contactSheet, defaultLabelStep } from "../render/annotate.js";
import { tileCenterZ, visibleRadius, type CaptureView } from "../render/projection.js";
import { downscalePng, renderPngMap, type PngMapOptions } from "../render/pngmap.js";
import { renderTextMap } from "../render/textmap.js";
import { BUDGET, cap, defineTool, result, tileSig, toolError, zRectShape, type ToolContext } from "./context.js";

const MAX_TEXT_SIDE = 64;
const MAX_PNG_TILES = 256 * 256;

export async function listRides(ctx: ToolContext): Promise<RideSummary[]> {
    return (await ctx.bridge.call("ride.list", {})).rides;
}

export function rideCategory(type: number): string | null {
    return RIDE_TYPES.find((r) => r.rideType === type)?.category ?? null;
}

async function waitForFile(file: string, timeoutMs: number): Promise<boolean> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
        if (existsSync(file)) {
            // Attendre que l'écriture soit finie : taille stable.
            await new Promise((r) => setTimeout(r, 150));
            return true;
        }
        await new Promise((r) => setTimeout(r, 100));
    }
    return false;
}

interface CaptureRequest {
    x: number;
    y: number;
    zoom: number;
    rotation: number;
    width: number;
    height: number;
    annotate?: boolean;
    highlight?: { x: number; y: number }[];
}

/** Une capture du jeu (fichier lu sur disque), annotée au besoin avec la grille des tuiles. */
async function captureOnce(ctx: ToolContext, req: CaptureRequest): Promise<{ png: Buffer; file: string; annotated: boolean }> {
    if (ctx.bridge.hello && !ctx.bridge.hello.capabilities.captureImage) {
        toolError("NOT_SUPPORTED_IN_MODE", "Captures indisponibles dans ce mode (jeu sans fenêtre).", { hint: "Utilise get_region_map format 'png'." });
    }
    // captureImage ne crée un sous-dossier que si screenshot/ existe déjà (fs::create_directory(dir, existing),
    // Screenshot.cpp) et le plugin ne peut pas créer de dossier : le serveur le fait (SPIKES S1).
    mkdirSync(paths.screenshots(ctx.config), { recursive: true });
    const name = `claude-${ctx.config.sessionId}-${String(++ctx.state.captureCounter).padStart(4, "0")}`;
    const r = await ctx.bridge.call("capture.view", { name, center: { x: req.x, y: req.y }, zoom: req.zoom, rotation: req.rotation, width: req.width, height: req.height });
    const file = join(paths.screenshots(ctx.config), r.filename);
    if (!(await waitForFile(file, 5000))) {
        toolError("INTERNAL", `Capture introuvable : ${file}.`, { hint: "Vérifie OPENRCT2_USER_DIR (dossier screenshot)." });
    }
    let png: Buffer = readFileSync(file);
    if (!req.annotate) return { png, file, annotated: false };
    const view: CaptureView = { centerX: tileCenterToWorld(req.x), centerY: tileCenterToWorld(req.y), centerZ: 0, zoom: req.zoom, rotation: req.rotation, width: req.width, height: req.height };
    const radius = Math.min(96, visibleRadius(view));
    const reg = await ctx.cache.region({ x1: req.x - radius, y1: req.y - radius, x2: req.x + radius, y2: req.y + radius });
    const c = reg.get(req.x, req.y);
    if (c) view.centerZ = tileCenterZ(cornerLevels(c));
    try {
        png = annotateCapture(png, view, { x: req.x, y: req.y }, reg.get, { highlight: req.highlight });
    } catch (e) {
        // Une image illisible par pngjs (format inattendu) reste renvoyée brute.
        log.warn("annotation impossible", { message: e instanceof Error ? e.message : String(e) });
        return { png, file, annotated: false };
    }
    return { png, file, annotated: true };
}

export function registerObserveTools(server: McpServer, ctx: ToolContext): void {
    defineTool(
        server,
        ctx,
        "get_park_overview",
        {
            title: "Vue d'ensemble du parc",
            description: "Finances (argent, prêt), note du parc, visiteurs, bonheur moyen, pensées dominantes des visiteurs, attractions ouvertes et en panne, date.",
            input: {},
            readOnly: true,
        },
        async () => {
            const o = await ctx.bridge.call("park.overview", {});
            return result({
                response: {
                    summary: `${o.name} : note ${o.rating}, ${o.guests} visiteurs, argent ${o.cash}, ${o.rides.total} attraction(s) dont ${o.rides.open} ouverte(s).`,
                    ...o,
                    date: `${o.date.day}/${o.date.month + 3}/an ${o.date.year}`,
                },
            });
        },
    );

    defineTool(
        server,
        ctx,
        "get_region_map",
        {
            title: "Carte d'une région",
            description:
                "OUTIL PRINCIPAL DE RAISONNEMENT SPATIAL. Carte exacte vue de dessus d'un rectangle de tuiles (bornes incluses). " +
                "format 'text' : une lettre par tuile (≤ 64×64), légende incluse ; couches overview (défaut), height, owner. " +
                "format 'png' : image schématique (grille étiquetée tous les 8, chemins, attractions colorées, entrées, scénerie, hachures = non possédé). " +
                "diff: true surligne en rouge les tuiles modifiées depuis le dernier appel (vérification après écriture). " +
                "analysis: true analyse le réseau de chemins de la zone et l'annote sur l'image : magenta = chemin coupé de l'entrée du parc, " +
                "orange = impasse, rouge = chemin isolé ou entrée/sortie d'attraction non raccordée. " +
                "Exemple : { x1: 50, y1: 50, x2: 90, y2: 80, format: 'text' }.",
            input: {
                ...zRectShape,
                format: z.enum(["text", "png", "both"]).default("text"),
                layer: z.enum(["overview", "height", "owner"]).default("overview"),
                diff: z.boolean().default(false),
                analysis: z.boolean().default(false),
            },
            readOnly: true,
        },
        async ({ x1, y1, x2, y2, format, layer, diff, analysis }) => {
            const rect = await ctx.cache.clamp({ x1, y1, x2, y2 });
            if (rect.x1 > rect.x2 || rect.y1 > rect.y2) toolError("INVALID_PARAMS", "Rectangle hors de la carte.");
            const w = rect.x2 - rect.x1 + 1;
            const h = rect.y2 - rect.y1 + 1;
            if (format !== "png" && (w > MAX_TEXT_SIDE || h > MAX_TEXT_SIDE)) {
                toolError("INVALID_PARAMS", `Carte texte limitée à ${MAX_TEXT_SIDE}×${MAX_TEXT_SIDE} (demandé ${w}×${h}).`, { hint: "Réduis la zone ou utilise format 'png'." });
            }
            if (rectArea(rect) > MAX_PNG_TILES) toolError("INVALID_PARAMS", "Zone trop grande.");
            const reg = await ctx.cache.region(rect);
            const rides = await listRides(ctx);
            let changed: Set<string> | undefined;
            const snapshot = new Map<string, string>();
            for (let y = rect.y1; y <= rect.y2; y++) for (let x = rect.x1; x <= rect.x2; x++) snapshot.set(`${x},${y}`, tileSig(reg.get(x, y)));
            if (diff && ctx.state.lastSnapshot) {
                changed = new Set();
                for (const [k, sig] of snapshot) {
                    const before = ctx.state.lastSnapshot.get(k);
                    if (before !== undefined && before !== sig) changed.add(k);
                }
            }
            ctx.state.lastSnapshot = snapshot;
            const response: Record<string, unknown> = {
                summary: `Région (${rect.x1},${rect.y1})–(${rect.x2},${rect.y2}), ${w}×${h} tuiles.`,
                rect,
            };
            if (changed) response.changedTiles = cap([...changed].map((k) => k.split(",").map(Number)), 40);
            let extraText: string | undefined;
            if (format !== "png") {
                const tm = renderTextMap(rect, reg.get, layer, rides);
                response.legend = tm.legend;
                extraText = tm.text;
            }
            const marks: NonNullable<PngMapOptions["marks"]> = [];
            if (analysis) {
                const inRect = (p: { x: number; y: number } | null | undefined) => !!p && p.x >= rect.x1 && p.x <= rect.x2 && p.y >= rect.y1 && p.y <= rect.y2;
                const local = rides.filter((r) => r.stations.some((s) => inRect(s.start) || inRect(s.entrance) || inRect(s.exit)));
                const rep = analyzeConnectivity(rect, reg.get, local);
                for (const t of rep.disconnected) marks.push({ ...t, color: "magenta" });
                for (const t of rep.deadEnds) marks.push({ ...t, color: "orange" });
                for (const t of rep.isolated) marks.push({ ...t, color: "red" });
                const unlinked: { x: number; y: number }[] = [];
                for (const r of rep.rides) {
                    const st = local.find((x) => x.id === r.id)?.stations[0];
                    if (r.entranceConnected === false && st) unlinked.push(st.entrance ?? st.start!);
                    if (r.exitConnected === false && st?.exit) unlinked.push(st.exit);
                }
                for (const t of unlinked) if (t) marks.push({ x: t.x, y: t.y, color: "red" });
                response.analysis = {
                    networks: rep.components.length,
                    parkEntranceInZone: rep.parkEntrances.length > 0,
                    disconnectedTiles: rep.disconnected.length,
                    deadEnds: cap(rep.deadEnds, 10),
                    isolated: rep.isolated.length,
                    unconnectedRides: rep.rides.filter((r) => r.problems.length).map((r) => `${r.name} (#${r.id}) : ${r.problems.join(", ")}`).slice(0, 8),
                };
            }
            const images = format !== "text" ? [{ data: renderPngMap(rect, reg.get, rides, { changed, marks }), mimeType: "image/png" }] : [];
            return result({ response: response as never, extraText, images, budget: BUDGET.read });
        },
    );

    defineTool(
        server,
        ctx,
        "inspect_tile",
        {
            title: "Inspecter une tuile",
            description:
                "Tous les éléments d'une tuile : surface (niveau, pente, eau, propriété), chemins, pièces d'attraction, entrées, scénerie, murs, " +
                "avec niveau, objet et direction. Utile pour comprendre un échec OBSTRUCTED.",
            input: { x: z.number().int().min(0), y: z.number().int().min(0) },
            readOnly: true,
        },
        async ({ x, y }) => {
            const t = await ctx.bridge.call("map.tile", { x, y });
            return result({ response: { summary: `Tuile (${x},${y}) : ${t.elements.length} élément(s).`, elements: t.elements } });
        },
    );

    const zCapture = {
        x: z.number().int().min(0),
        y: z.number().int().min(0),
        zoom: z.number().int().min(0).max(5).default(1),
    };

    defineTool(
        server,
        ctx,
        "capture_view",
        {
            title: "Capture du jeu",
            description:
                "Capture isométrique réelle du jeu centrée sur une tuile (ambiance, rendu). NE PAS s'en servir pour mesurer des positions : " +
                "utilise get_region_map. zoom 0 (proche) à 3 (loin), rotation 0-3. annotate: true superpose la grille des tuiles (suivant le " +
                "relief) et des étiquettes « x,y » pour relier l'image à la carte ; highlight entoure des tuiles en jaune. Les objets hauts " +
                "masquent les tuiles derrière eux. Image réduite à 1568 px de côté au plus. Exemple : { x: 40, y: 30, annotate: true }.",
            input: {
                ...zCapture,
                rotation: z.number().int().min(0).max(3).default(0),
                width: z.number().int().min(64).max(3840).default(1280),
                height: z.number().int().min(64).max(2160).default(720),
                annotate: z.boolean().default(false),
                highlight: z.array(z.object({ x: z.number().int().min(0), y: z.number().int().min(0) })).max(32).optional(),
            },
            readOnly: true,
        },
        async ({ x, y, zoom, rotation, width, height, annotate, highlight }) => {
            const shot = await captureOnce(ctx, { x, y, zoom, rotation, width, height, annotate: annotate || !!highlight?.length, highlight });
            const img = downscalePng(shot.png, 1568);
            return result({
                response: {
                    summary: `Capture ${img.width}×${img.height} centrée sur (${x},${y}), zoom ${zoom}, rotation ${rotation}${shot.annotated ? ", grille annotée" : ""}.`,
                    file: shot.file,
                    ...(shot.annotated ? { labelEvery: defaultLabelStep(zoom) } : {}),
                },
                images: [{ data: img.data, mimeType: "image/png" }],
            });
        },
    );

    defineTool(
        server,
        ctx,
        "capture_contact_sheet",
        {
            title: "Planche-contact multi-angles",
            description:
                "Capture la même tuile sous plusieurs rotations de caméra (défaut 0 à 3) et les assemble en UNE image (2×2), chaque vue " +
                "numérotée R0…R3. Coûte moins de tokens que quatre captures ; utile pour juger l'intégration d'une attraction ou d'une zone " +
                "sous tous les angles (faces cachées, arbres qui masquent une entrée). annotate: true ajoute la grille. " +
                "Exemple : { x: 40, y: 30, zoom: 1 }.",
            input: {
                ...zCapture,
                rotations: z.array(z.number().int().min(0).max(3)).min(2).max(4).default([0, 1, 2, 3]),
                width: z.number().int().min(160).max(1920).default(768),
                height: z.number().int().min(120).max(1080).default(432),
                annotate: z.boolean().default(false),
            },
            readOnly: true,
        },
        async ({ x, y, zoom, rotations, width, height, annotate }) => {
            const shots = [];
            for (const rotation of [...new Set(rotations)]) {
                const shot = await captureOnce(ctx, { x, y, zoom, rotation, width, height, annotate });
                shots.push({ png: shot.png, label: `R${rotation}` });
            }
            const sheet = contactSheet(shots, 1568);
            return result({
                response: { summary: `Planche-contact de ${shots.length} vue(s) centrée(s) sur (${x},${y}), zoom ${zoom}.`, views: shots.map((s) => s.label) },
                images: [{ data: sheet, mimeType: "image/png" }],
            });
        },
    );

    defineTool(
        server,
        ctx,
        "list_rides",
        {
            title: "Lister les attractions",
            description: "Attractions, boutiques et équipements : id, nom, type, état, notes, prix, entrée/sortie de la station 0.",
            input: { cursor: z.number().int().min(0).default(0) },
            readOnly: true,
        },
        async ({ cursor }) => {
            const rides = await listRides(ctx);
            const page = rides.slice(cursor, cursor + 25);
            return result({
                response: {
                    summary: `${rides.length} attraction(s).`,
                    rides: page.map((r) => ({
                        id: r.id,
                        name: r.name,
                        type: RIDE_TYPES.find((t) => t.rideType === r.type)?.name ?? r.type,
                        classification: r.classification,
                        status: r.status,
                        ratings: r.excitement !== null ? { E: r.excitement, I: r.intensity, N: r.nausea } : null,
                        price: r.price[0],
                        entrance: r.stations[0]?.entrance ?? null,
                        exit: r.stations[0]?.exit ?? null,
                    })),
                    nextCursor: cursor + page.length < rides.length ? cursor + page.length : null,
                },
            });
        },
    );

    const rideReport = async ({ id }: { id: number }) => {
        const r = await ctx.bridge.call("ride.get", { id });
        const problems: string[] = [];
        if (r.classification === "ride") {
            if (!r.stations[0]?.entrance) problems.push("pas d'entrée");
            if (!r.stations[0]?.exit) problems.push("pas de sortie");
        }
        if (r.breakdown) problems.push(`en panne : ${r.breakdown}`);
        if (r.status === "closed") problems.push("fermée");
        return result({
            response: {
                summary: `${r.name} (#${r.id}) : ${r.status}${r.excitement !== null ? `, E ${r.excitement} / I ${r.intensity} / N ${r.nausea}` : ", pas encore évaluée"}.`,
                ...r,
                type: RIDE_TYPES.find((t) => t.rideType === r.type)?.name ?? r.type,
                problems,
            },
        });
    };

    defineTool(
        server,
        ctx,
        "get_ride",
        {
            title: "Détail d'une attraction",
            description:
                "Détail et rapport : état, notes excitation/intensité/nausée (déjà divisées par 100), statistiques (vitesse, G, chutes), " +
                "prix, file d'attente, fiabilité, panne, problèmes détectés.",
            input: { id: z.number().int().min(0) },
            readOnly: true,
        },
        rideReport,
    );

    defineTool(
        server,
        ctx,
        "ride_get_report",
        {
            title: "Rapport d'attraction",
            description: "Alias de get_ride orienté test : notes, statistiques, statut du test et problèmes.",
            input: { id: z.number().int().min(0) },
            readOnly: true,
        },
        rideReport,
    );

    defineTool(
        server,
        ctx,
        "path_check_connectivity",
        {
            title: "Vérifier le réseau de chemins",
            description:
                "Analyse le graphe des chemins (sur toute la carte, ou un rectangle) : composantes connexes, entrée du parc reliée ?, impasses, " +
                "chemins isolés, attractions et boutiques non raccordées ou non atteignables depuis l'entrée. À appeler après chaque étape de construction.",
            input: {
                x1: z.number().int().min(0).optional(),
                y1: z.number().int().min(0).optional(),
                x2: z.number().int().min(0).optional(),
                y2: z.number().int().min(0).optional(),
            },
            readOnly: true,
        },
        async ({ x1, y1, x2, y2 }) => {
            const size = await ctx.cache.mapSize();
            const rect: TileRect = await ctx.cache.clamp({ x1: x1 ?? 0, y1: y1 ?? 0, x2: x2 ?? size.x - 1, y2: y2 ?? size.y - 1 });
            const reg = await ctx.cache.region(rect);
            // Seules les attractions dont la station, l'entrée ou la sortie est dans la zone : les chemins des autres
            // ne sont pas lus, elles paraîtraient à tort non raccordées.
            const inRect = (p: { x: number; y: number } | null | undefined) => !!p && p.x >= rect.x1 && p.x <= rect.x2 && p.y >= rect.y1 && p.y <= rect.y2;
            const rides = (await listRides(ctx)).filter((r) => r.stations.some((s) => inRect(s.start) || inRect(s.entrance) || inRect(s.exit)));
            const rep = analyzeConnectivity(rect, reg.get, rides);
            const badRides = rep.rides.filter((r) => r.problems.length > 0);
            const hints: string[] = [];
            if (rep.parkEntrances.length === 0) hints.push("Aucune entrée de parc dans la zone : park_set_entrance.");
            if (rep.components.length > 1) hints.push("Plusieurs réseaux séparés : relie-les avec path_build.");
            for (const r of badRides.slice(0, 3)) hints.push(`Attraction ${r.name} (#${r.id}) : ${r.problems.join(", ")}.`);
            return result({
                response: {
                    summary: `${rep.pathTiles} tuiles de chemin, ${rep.components.length} réseau(x), ${badRides.length} attraction(s) à problème, ${rep.deadEnds.length} impasse(s).`,
                    parkEntrances: rep.parkEntrances,
                    components: rep.components.slice(0, 10).map((c) => ({ size: c.size, touchesParkEntrance: c.touchesParkEntrance, sample: c.sample })),
                    ridesWithProblems: badRides.slice(0, 20),
                    deadEnds: rep.deadEnds.slice(0, 20),
                    isolated: rep.isolated.slice(0, 20),
                    next_hints: hints,
                },
            });
        },
    );
}
