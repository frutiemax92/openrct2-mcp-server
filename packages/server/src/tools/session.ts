import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { BUDGET, defineTool, result, toolError, type ToolContext } from "./context.js";

const SANDBOX_MONEY = 5_000_000;

export function registerSessionTools(server: McpServer, ctx: ToolContext): void {
    defineTool(
        server,
        ctx,
        "session_info",
        {
            title: "État de la session",
            description:
                "PREMIER APPEL CONSEILLÉ. Renvoie l'état du lien avec le jeu, les capacités (captures, sauvegardes), le mode " +
                "(strict/sandbox), la pause, un résumé du parc (nom, argent, note, visiteurs, date), la taille de la carte et les checkpoints. " +
                "Toutes les coordonnées des outils sont en tuiles ; les hauteurs en niveaux (1 niveau = 1 marche de terrain).",
            input: {},
            readOnly: true,
        },
        async () => {
            if (!ctx.bridge.connected) {
                try {
                    await ctx.bridge.ensureConnected();
                } catch (e) {
                    return result({
                        response: {
                            summary: "Jeu non connecté.",
                            connected: false,
                            reason: e instanceof Error ? e.message : String(e),
                            next_hints: ["Lance OpenRCT2 (pnpm game) avec le plugin claude-bridge installé (pnpm install:plugin), puis rappelle session_info."],
                        },
                    });
                }
            }
            const info = await ctx.bridge.call("session.info", {});
            const sandbox = info.cheats.sandboxMode === true;
            if (ctx.state.mode === "unknown" && info.park) ctx.state.mode = sandbox ? "sandbox" : "strict";
            const hello = ctx.bridge.hello;
            const hints: string[] = [];
            if (!info.park) hints.push("Aucun parc chargé : ouvre un parc dans le jeu ou utilise checkpoint_restore.");
            else {
                hints.push("Ensuite : get_park_overview, puis get_region_map sur la zone de travail.");
                if (info.paused && info.cheats.buildInPauseMode !== true) hints.push("Le jeu est en pause sans buildInPauseMode : la construction échouera (session_set_mode sandbox ou session_set_paused false).");
            }
            return result({
                response: {
                    summary: info.park
                        ? `Connecté. Parc « ${info.park.name} », ${info.mapSize.x}×${info.mapSize.y} tuiles, mode ${ctx.state.mode}${info.paused ? ", en pause" : ""}.`
                        : `Connecté, mais aucun parc chargé (écran « ${info.gameMode} »).`,
                    connected: true,
                    plugin: { version: info.pluginVersion, apiVersion: info.apiVersion, networkMode: info.networkMode, headless: hello?.headless ?? null },
                    capabilities: hello?.capabilities,
                    gameMode: info.gameMode,
                    mode: ctx.state.mode,
                    validated: ctx.state.validated,
                    paused: info.paused,
                    gameSpeed: info.gameSpeed,
                    mapSize: info.mapSize,
                    park: info.park
                        ? { ...info.park, date: `${info.park.date.day}/${info.park.date.month + 3}/an ${info.park.date.year}` }
                        : null,
                    cheats: Object.fromEntries(Object.entries(info.cheats).filter(([, v]) => v === true || (typeof v === "number" && v !== 0))),
                    checkpoints: [...ctx.state.checkpoints.keys()],
                    journalEntries: ctx.journal.length,
                    next_hints: hints,
                },
            });
        },
    );

    defineTool(
        server,
        ctx,
        "session_set_mode",
        {
            title: "Mode strict ou sandbox",
            description:
                "strict : aucun cheat (parc jouable « pour de vrai »). sandbox : active sandboxMode, buildInPauseMode, ignoreResearchStatus, " +
                "achète tout le terrain et fixe l'argent (money, défaut 5 000 000 en unités internes). Un parc construit en sandbox est marqué " +
                "non validé jusqu'à un re-test en strict. Exemple : { mode: 'sandbox' }.",
            input: {
                mode: z.enum(["strict", "sandbox"]),
                money: z.number().int().min(0).max(2_000_000_000).optional().describe("Sandbox : argent en unités internes du jeu."),
                ownAllLand: z.boolean().default(true).describe("Sandbox : rendre tout le terrain constructible."),
            },
        },
        async ({ mode, money, ownAllLand }) => {
            const items =
                mode === "sandbox"
                    ? [
                          { cheat: "sandboxMode", param1: 1 },
                          { cheat: "buildInPauseMode", param1: 1 },
                          { cheat: "ignoreResearchStatus", param1: 1 },
                          ...(ownAllLand ? [{ cheat: "ownAllLand" }] : []),
                          { cheat: "setMoney", param1: money ?? SANDBOX_MONEY },
                      ]
                    : [
                          { cheat: "sandboxMode", param1: 0 },
                          { cheat: "buildInPauseMode", param1: 0 },
                          { cheat: "ignoreResearchStatus", param1: 0 },
                          { cheat: "disableClearanceChecks", param1: 0 },
                          { cheat: "disableSupportLimits", param1: 0 },
                      ];
            const res = await ctx.bridge.call("session.cheats.set", { items });
            const failed = res.results.map((r, i) => ({ r, item: items[i] })).filter((x) => !x.r.ok);
            if (failed.length === items.length) toolError("GAME_ACTION_FAILED", "Aucun cheat n'a pu être appliqué.", { details: { errors: failed.map((f) => f.r.error) } });
            ctx.state.mode = mode;
            if (mode === "sandbox") ctx.state.validated = false;
            if (ownAllLand && mode === "sandbox") ctx.cache.invalidateAll();
            return result({
                budget: BUDGET.write,
                response: {
                    summary: `Mode ${mode} actif.`,
                    applied: items.length - failed.length,
                    warnings: failed.map((f) => `${f.item.cheat} : ${f.r.error?.message}`),
                    next_hints: mode === "sandbox" ? ["Pense à re-tester en strict avant de déclarer le parc validé."] : [],
                },
            });
        },
    );

    defineTool(
        server,
        ctx,
        "session_set_paused",
        {
            title: "Pause / reprise",
            description:
                "Met le jeu en pause (paused: true) ou relance le temps. Construire en pause exige buildInPauseMode (mode sandbox). " +
                "Conseil : pause pendant les constructions, reprise pour tester.",
            input: { paused: z.boolean() },
        },
        async ({ paused }) => {
            const r = await ctx.bridge.call("session.set_paused", { paused });
            return result({ budget: BUDGET.write, response: { summary: r.paused ? "Jeu en pause." : "Temps relancé.", paused: r.paused } });
        },
    );

    defineTool(
        server,
        ctx,
        "run_time",
        {
            title: "Laisser passer le temps",
            description:
                "Laisse tourner le jeu N jours (1 jour ≈ 528 ticks ≈ 13 s à vitesse 1) ou N ticks (24 000 max), puis renvoie un résumé " +
                "(argent, note, visiteurs, attractions en panne). speed 1 à 4 accélère. Remet ensuite la vitesse et la pause d'avant.",
            input: {
                days: z.number().int().min(1).max(45).optional(),
                ticks: z.number().int().min(1).max(24000).optional(),
                speed: z.number().int().min(1).max(4).default(4),
            },
        },
        async ({ days, ticks, speed }) => {
            // monthProgress +4 par tick, 65 536 par mois (≈ 31 jours) → ≈ 528 ticks par jour.
            const n = ticks ?? Math.round((days ?? 1) * 528);
            const before = await ctx.bridge.call("park.overview", {});
            const r = await ctx.bridge.call("time.run", { ticks: Math.min(n, 24000), speed }, { timeoutMs: (n / 40 / speed) * 2000 + 30_000 });
            const after = await ctx.bridge.call("park.overview", {});
            ctx.cache.invalidateAll();
            return result({
                response: {
                    summary: `${r.ticksRun} ticks écoulés.`,
                    date: `${after.date.day}/${after.date.month + 3}/an ${after.date.year}`,
                    cash: { before: before.cash, after: after.cash },
                    rating: { before: before.rating, after: after.rating },
                    guests: { before: before.guests, after: after.guests },
                    ridesBroken: after.rides.brokenIds,
                    topThoughts: after.topThoughts.slice(0, 5),
                    paused: r.paused,
                },
            });
        },
    );
}
