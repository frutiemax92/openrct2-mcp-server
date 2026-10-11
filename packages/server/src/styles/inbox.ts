// Réception des styles et des demandes Magic Fill envoyés depuis le jeu (SPEC 13.7).
//
// Le plugin garde ce que l'utilisateur crée (bouton « Save Style », trait du Magic Fill Tool) et prévient le serveur
// par un événement `inbox`. Le serveur prend les éléments (`inbox.take`, un style à la fois), les range sur disque,
// puis les acquitte (`inbox.ack`) : le plugin ne les efface qu'à ce moment. À la connexion, le plugin renvoie
// l'événement s'il reste des éléments (styles enregistrés jeu fermé ou serveur absent).

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { MagicFillRequest, MagicFillStatus } from "@openrct2-claude/protocol";
import type { BridgeLike } from "../bridge.js";
import { paths, type Config } from "../config.js";
import { log } from "../log.js";
import { StyleStore } from "./store.js";

export interface FillEntry {
    request: MagicFillRequest;
    status: MagicFillStatus;
    message: string;
    receivedAt: string;
    /** Résultat de magic_fill_apply (compteurs, styles utilisés) ; absent tant que la région n'est pas remplie. */
    result?: Record<string, unknown>;
    /** Checkpoint pris juste avant le premier remplissage : refaire = y revenir, pas vider ni aplanir à la main. */
    checkpoint?: string;
    /** Dernière entrée du journal au moment du checkpoint : ce qui suit serait perdu en y revenant. */
    checkpointJournalId?: number;
}

const OPEN: MagicFillStatus[] = ["pending", "received", "working"];

export class FillQueue {
    private entries = new Map<string, FillEntry>();
    private waiters: (() => void)[] = [];

    constructor(private readonly dir: string) {
        if (existsSync(dir)) {
            for (const f of readdirSync(dir).filter((x) => x.endsWith(".json"))) {
                try {
                    const e = JSON.parse(readFileSync(join(dir, f), "utf8")) as FillEntry;
                    if (e?.request?.id) this.entries.set(e.request.id, e);
                } catch {
                    // fichier abîmé : ignoré
                }
            }
        }
    }

    private persist(e: FillEntry): void {
        mkdirSync(this.dir, { recursive: true });
        writeFileSync(join(this.dir, `${e.request.id}.json`), JSON.stringify(e));
    }

    add(req: MagicFillRequest): boolean {
        if (this.entries.has(req.id)) return false;
        const e: FillEntry = { request: req, status: "received", message: "Reçue par le serveur MCP.", receivedAt: new Date().toISOString() };
        this.entries.set(req.id, e);
        this.persist(e);
        const w = this.waiters;
        this.waiters = [];
        for (const fn of w) fn();
        return true;
    }

    get(id: string): FillEntry | undefined {
        return this.entries.get(id);
    }

    open(): FillEntry[] {
        return [...this.entries.values()].filter((e) => OPEN.includes(e.status)).sort((a, b) => b.request.createdAt.localeCompare(a.request.createdAt));
    }

    recent(n: number): FillEntry[] {
        return [...this.entries.values()].sort((a, b) => b.request.createdAt.localeCompare(a.request.createdAt)).slice(0, n);
    }

    update(id: string, status: MagicFillStatus, message: string, result?: Record<string, unknown>): FillEntry | undefined {
        const e = this.entries.get(id);
        if (!e) return undefined;
        e.status = status;
        e.message = message;
        if (result) e.result = result;
        this.persist(e);
        return e;
    }

    setCheckpoint(id: string, checkpoint: string, journalId: number): void {
        const e = this.entries.get(id);
        if (!e) return;
        e.checkpoint = checkpoint;
        e.checkpointJournalId = journalId;
        this.persist(e);
    }

    /** Région revenue à son état d'avant remplissage (checkpoint restauré). */
    clearResult(id: string): void {
        const e = this.entries.get(id);
        if (!e) return;
        delete e.result;
        this.persist(e);
    }

    /** Attend une nouvelle demande (ou l'expiration). */
    waitForNew(timeoutMs: number): Promise<boolean> {
        return new Promise((resolve) => {
            const timer = setTimeout(() => {
                this.waiters = this.waiters.filter((w) => w !== done);
                resolve(false);
            }, timeoutMs);
            const done = () => {
                clearTimeout(timer);
                resolve(true);
            };
            this.waiters.push(done);
        });
    }
}

export class InboxSync {
    private running: Promise<void> | null = null;
    private again = false;
    /** Derniers styles rangés (pour le summary des outils). */
    received: string[] = [];

    constructor(
        private readonly bridge: BridgeLike,
        private readonly config: Config,
        readonly store: StyleStore,
        readonly fills: FillQueue,
    ) {}

    start(): void {
        // Le plugin écrit les captures dans screenshot/ : le dossier doit exister avant (F24).
        try {
            mkdirSync(paths.screenshots(this.config), { recursive: true });
        } catch {
            // dossier utilisateur absent (tests) : la capture le signalera
        }
        this.bridge.on("connected", () => void this.drain());
        this.bridge.on("event:inbox", () => void this.drain());
    }

    /** Vide la boîte d'envoi du plugin. Les appels concurrents se fondent en une passe de plus. */
    drain(): Promise<void> {
        if (this.running) {
            this.again = true;
            return this.running;
        }
        this.running = (async () => {
            try {
                do {
                    this.again = false;
                    await this.pass();
                } while (this.again);
            } catch (e) {
                log.warn("réception des styles interrompue", { message: e instanceof Error ? e.message : String(e) });
            } finally {
                this.running = null;
            }
        })();
        return this.running;
    }

    private async pass(): Promise<void> {
        for (let guard = 0; guard < 50; guard++) {
            if (!this.bridge.connected) return;
            const r = await this.bridge.call("inbox.take", {}, { timeoutMs: 60_000 });
            if (r.styles.length === 0 && r.fills.length === 0 && !r.clearStyles) return;
            // « Clear all stored styles » : avant de ranger les styles de cette prise, sauvés après le clic.
            let clearedStyles: number | undefined;
            if (r.clearStyles) {
                clearedStyles = this.store.clearAll();
                this.received = [];
                log.info("base de styles vidée depuis le jeu", { deleted: clearedStyles });
            }
            const styleIds: string[] = [];
            for (const s of r.styles) {
                const originalId = s.id;
                const record = { ...s, id: StyleStore.idFor(s.caption, s.id) };
                try {
                    const saved = this.store.save(record, paths.screenshots(this.config));
                    this.received.push(record.id);
                    log.info("style reçu", { id: record.id, elements: record.elements.length, screenshots: saved.screenshots });
                } catch (e) {
                    log.error("style non enregistré", { id: originalId, message: e instanceof Error ? e.message : String(e) });
                    continue;
                }
                styleIds.push(originalId);
            }
            for (const f of r.fills) {
                this.fills.add(f);
                log.info("demande Magic Fill reçue", { id: f.id, tiles: f.tiles.length, prompt: f.prompt });
            }
            await this.bridge.call("inbox.ack", { styles: styleIds, fills: r.fills.map((f) => f.id), clearedStyles });
            // Un style qui ne s'enregistre pas reviendrait à chaque passe : on s'arrête là (journal du serveur).
            if (styleIds.length === 0 && r.fills.length === 0) return;
            if (r.remaining.styles === 0 && r.remaining.fills === 0) return;
        }
    }
}
