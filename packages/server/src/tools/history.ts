import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ActionOutcome, BulkResult } from "@openrct2-claude/protocol";
import { z } from "zod";
import { paths } from "../config.js";
import type { JournalEntry } from "../state/journal.js";
import type { ZoneType } from "../state/zones.js";
import { BUDGET, asBridgeError, defineTool, result, toolError, type ToolContext } from "./context.js";

const NAME = z.string().regex(/^[a-zA-Z0-9_-]{1,48}$/, "lettres, chiffres, _ et - seulement");
const PREFIX = "claude-";

function metaDir(ctx: ToolContext): string {
    return join(paths.saves(ctx.config), "claude-meta");
}

function failedCount(r: unknown): number {
    if (r && typeof r === "object") {
        if ("failed" in r) return (r as BulkResult).failed;
        if ("ok" in r && (r as ActionOutcome).ok === false) return 1;
    }
    return 0;
}

export function registerHistoryTools(server: McpServer, ctx: ToolContext): void {
    defineTool(
        server,
        ctx,
        "undo_last",
        {
            title: "Annuler les dernières opérations",
            description:
                "Annule les n dernières opérations d'écriture du journal (inverse enregistré par chaque outil). Certaines opérations " +
                "(démolition, suppression de scénerie, propriété) ne sont pas réversibles : l'outil le signale ; utilise alors checkpoint_restore.",
            input: { count: z.number().int().min(1).max(20).default(1) },
            destructive: true,
        },
        async ({ count }) => {
            const entries = ctx.journal.pop(count);
            if (entries.length === 0) return result({ budget: BUDGET.write, response: { summary: "Journal vide : rien à annuler." } });
            const undone: string[] = [];
            const skipped: string[] = [];
            const errors: string[] = [];
            for (const e of entries) {
                if (e.irreversible || e.inverse.length === 0) {
                    skipped.push(`${e.summary} (${e.irreversible ?? "pas d'inverse"})`);
                    continue;
                }
                let failures = 0;
                for (const op of e.inverse) {
                    try {
                        const r = await ctx.bridge.call(op.method, op.params as never);
                        failures += failedCount(r);
                    } catch (err) {
                        failures++;
                        errors.push(`${e.summary} : ${asBridgeError(err).message}`);
                    }
                }
                (failures ? errors : undone).push(failures ? `${e.summary} : ${failures} étape(s) en échec` : e.summary);
            }
            ctx.cache.invalidateAll();
            return result({
                budget: BUDGET.write * 2,
                response: {
                    summary: `${undone.length} opération(s) annulée(s), ${skipped.length} non réversible(s), ${errors.length} en erreur.`,
                    undone,
                    skipped,
                    warnings: errors,
                    next_hints: skipped.length ? ["Pour revenir plus loin : checkpoint_restore."] : [],
                },
            });
        },
    );

    defineTool(
        server,
        ctx,
        "checkpoint_save",
        {
            title: "Créer un checkpoint",
            description:
                "Sauvegarde le parc (save/claude-<name>.park) et l'état du serveur (journal, zones paysagères). À faire avant toute étape risquée. Exemple : { name: 'avant-coaster' }.",
            input: { name: NAME },
        },
        async ({ name }) => {
            const file = `${PREFIX}${name}`;
            const r = await ctx.bridge.call("checkpoint.save", { name: file });
            const full = join(paths.saves(ctx.config), r.filename);
            const start = Date.now();
            while (!existsSync(full) && Date.now() - start < 5000) await new Promise((res) => setTimeout(res, 100));
            if (!existsSync(full)) toolError("INTERNAL", `Sauvegarde introuvable : ${full}.`, { hint: "Vérifie OPENRCT2_USER_DIR." });
            const overview = await ctx.bridge.call("park.overview", {}).catch(() => null);
            const summary = overview ? { cash: overview.cash, rating: overview.rating, guests: overview.guests, rides: overview.rides.total } : {};
            mkdirSync(metaDir(ctx), { recursive: true });
            writeFileSync(join(metaDir(ctx), `${file}.json`), JSON.stringify({ createdAt: new Date().toISOString(), summary, journal: ctx.journal.toJSON(), zones: ctx.state.zones.toJSON() }));
            ctx.state.checkpoints.set(name, { file: full, createdAt: new Date().toISOString(), summary });
            return result({ budget: BUDGET.write, response: { summary: `Checkpoint « ${name} » enregistré.`, file: full, park: summary } });
        },
    );

    defineTool(
        server,
        ctx,
        "checkpoint_list",
        {
            title: "Lister les checkpoints",
            description: "Checkpoints disponibles (sauvegardes claude-*.park) avec date et résumé.",
            input: {},
            readOnly: true,
        },
        async () => {
            const dir = paths.saves(ctx.config);
            const items = existsSync(dir)
                ? readdirSync(dir)
                      .filter((f) => f.startsWith(PREFIX) && f.endsWith(".park"))
                      .map((f) => {
                          const name = f.slice(PREFIX.length, -".park".length);
                          const metaFile = join(metaDir(ctx), `${PREFIX}${name}.json`);
                          let meta: { summary?: unknown } = {};
                          if (existsSync(metaFile)) {
                              try {
                                  meta = JSON.parse(readFileSync(metaFile, "utf8"));
                              } catch {
                                  meta = {};
                              }
                          }
                          return { name, modified: statSync(join(dir, f)).mtime.toISOString(), park: meta.summary };
                      })
                      .sort((a, b) => b.modified.localeCompare(a.modified))
                : [];
            return result({ response: { summary: `${items.length} checkpoint(s).`, checkpoints: items.slice(0, 25) } });
        },
    );

    defineTool(
        server,
        ctx,
        "checkpoint_restore",
        {
            title: "Restaurer un checkpoint",
            description:
                "Recharge un checkpoint (load_park) et restaure le journal du serveur. Tout ce qui n'a pas été sauvegardé est perdu. " +
                "La connexion au plugin est conservée (plugin intransient) ; sinon le serveur se reconnecte.",
            input: { name: NAME },
            destructive: true,
        },
        async ({ name }) => {
            const file = `${PREFIX}${name}`;
            const full = join(paths.saves(ctx.config), `${file}.park`);
            if (!existsSync(full)) toolError("NOT_FOUND", `Checkpoint « ${name} » introuvable.`, { hint: "checkpoint_list pour voir les noms." });
            const changed = ctx.bridge.waitForEvent("map_changed", 30_000);
            await ctx.bridge.call("checkpoint.restore", { name: file });
            try {
                await changed;
            } catch {
                // Le plugin a peut-être été rechargé : on attend la reconnexion.
                await ctx.bridge.ensureConnected();
            }
            ctx.cache.invalidateAll();
            const metaFile = join(metaDir(ctx), `${file}.json`);
            if (existsSync(metaFile)) {
                try {
                    const meta = JSON.parse(readFileSync(metaFile, "utf8")) as { journal: JournalEntry[]; zones?: [string, ZoneType][] };
                    ctx.journal.load(meta.journal ?? []);
                    ctx.state.zones.load(meta.zones);
                } catch {
                    ctx.journal.clear();
                }
            } else ctx.journal.clear();
            const info = await ctx.bridge.call("session.info", {});
            return result({ budget: BUDGET.write, response: { summary: `Checkpoint « ${name} » restauré : ${info.park?.name ?? "?"}.`, journalEntries: ctx.journal.length } });
        },
    );
}
