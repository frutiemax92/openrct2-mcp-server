// Client TCP du plugin : NDJSON, corrélation id → promesse, reconnexion automatique (SPEC 6.8, 8.1).

import { EventEmitter } from "node:events";
import { Socket } from "node:net";
import {
    BridgeException,
    LIMITS,
    PROTOCOL_VERSION,
    type BridgeError,
    type HelloResult,
    type MethodName,
    type MethodParams,
    type MethodResult,
} from "@openrct2-claude/protocol";
import { incomingMessageSchema } from "@openrct2-claude/protocol/schemas";
import { log } from "./log.js";

export interface BridgeOptions {
    host: string;
    port: number;
    /** Relu à chaque connexion (le plugin peut générer son jeton après le démarrage du serveur). */
    token: () => string | null;
    clientVersion: string;
    reconnectDelayMs?: number;
}

interface PendingCall {
    method: string;
    resolve: (v: unknown) => void;
    reject: (e: BridgeException) => void;
    timer: NodeJS.Timeout;
    onProgress?: (p: number) => void;
}

export interface CallOptions {
    timeoutMs?: number;
    onProgress?: (p: number) => void;
}

/** Interface minimale utilisée par les outils (permet un double de test). */
export interface BridgeLike extends EventEmitter {
    readonly connected: boolean;
    readonly hello: HelloResult | null;
    call<M extends MethodName>(method: M, params: MethodParams<M>, opts?: CallOptions): Promise<MethodResult<M>>;
    ensureConnected(): Promise<void>;
    waitForEvent<T = unknown>(event: string, timeoutMs: number): Promise<T>;
}

export class Bridge extends EventEmitter implements BridgeLike {
    private socket: Socket | null = null;
    private buffer = "";
    private nextId = 1;
    private pending = new Map<string, PendingCall>();
    private connecting: Promise<void> | null = null;
    private reconnectTimer: NodeJS.Timeout | null = null;
    private stopped = false;
    hello: HelloResult | null = null;
    lastError: string | null = null;

    constructor(private readonly opts: BridgeOptions) {
        super();
    }

    get connected(): boolean {
        return this.hello !== null && this.socket !== null && !this.socket.destroyed;
    }

    /** Démarre les tentatives de connexion en arrière-plan. */
    start(): void {
        this.stopped = false;
        this.ensureConnected().catch(() => this.scheduleReconnect());
    }

    stop(): void {
        this.stopped = true;
        if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
        this.socket?.destroy();
        this.socket = null;
        this.hello = null;
    }

    private scheduleReconnect(): void {
        if (this.stopped || this.reconnectTimer) return;
        // Un autre serveur MCP tient la connexion : on attend longtemps plutôt que de harceler le plugin.
        const delay = this.otherClientActive ? 15_000 : (this.opts.reconnectDelayMs ?? 2000);
        this.reconnectTimer = setTimeout(() => {
            this.reconnectTimer = null;
            this.ensureConnected().catch(() => this.scheduleReconnect());
        }, delay);
    }

    private otherClientActive = false;

    ensureConnected(): Promise<void> {
        if (this.connected) return Promise.resolve();
        if (!this.connecting) {
            this.connecting = this.connect().finally(() => {
                this.connecting = null;
            });
        }
        return this.connecting;
    }

    private connect(): Promise<void> {
        const token = this.opts.token();
        if (!token) {
            this.lastError = "jeton introuvable (OPENRCT2_TOKEN ou plugin.store.json)";
            return Promise.reject(new BridgeException({ code: "NOT_CONNECTED", message: `Jeu non connecté : ${this.lastError}.` }));
        }
        return new Promise<void>((resolve, reject) => {
            const socket = new Socket();
            socket.setNoDelay(true);
            socket.setEncoding("utf8");
            let settled = false;
            const fail = (msg: string) => {
                this.lastError = msg;
                if (!settled) {
                    settled = true;
                    reject(new BridgeException({ code: "NOT_CONNECTED", message: `Jeu non connecté : ${msg}.`, hint: "Lance OpenRCT2 avec le plugin claude-bridge installé, puis réessaie." }));
                }
            };
            socket.once("error", (e) => fail(e.message));
            socket.on("close", () => this.onClose(socket));
            socket.on("data", (chunk: string) => this.onData(chunk));
            socket.connect(this.opts.port, this.opts.host, () => {
                this.socket = socket;
                this.buffer = "";
                this.rawCall<HelloResult>("session.hello", { token, clientVersion: this.opts.clientVersion }, { timeoutMs: 5000 })
                    .then((hello) => {
                        this.hello = hello;
                        this.otherClientActive = false;
                        this.lastError = null;
                        settled = true;
                        log.info("connecté au plugin", { pluginVersion: hello.pluginVersion, apiVersion: hello.apiVersion, mode: hello.gameMode });
                        this.emit("connected", hello);
                        resolve();
                    })
                    .catch((e: BridgeException) => {
                        this.otherClientActive = JSON.stringify(e.error?.details ?? {}).includes("client_active");
                        fail(e.message);
                        socket.destroy();
                    });
            });
        });
    }

    private onClose(socket: Socket): void {
        if (this.socket !== socket) return;
        this.socket = null;
        const wasConnected = this.hello !== null;
        this.hello = null;
        for (const [id, p] of this.pending) {
            clearTimeout(p.timer);
            p.reject(new BridgeException({ code: "NOT_CONNECTED", message: `Connexion perdue pendant ${p.method}.` }));
            this.pending.delete(id);
        }
        if (wasConnected) {
            log.warn("connexion au plugin perdue");
            this.emit("disconnected");
        }
        this.scheduleReconnect();
    }

    private onData(chunk: string): void {
        this.buffer += chunk;
        if (this.buffer.length > LIMITS.maxLineBytes * 8 && this.buffer.indexOf("\n") < 0) {
            log.error("message du plugin trop long, coupure");
            this.socket?.destroy();
            return;
        }
        let idx: number;
        while ((idx = this.buffer.indexOf("\n")) >= 0) {
            const line = this.buffer.slice(0, idx);
            this.buffer = this.buffer.slice(idx + 1);
            if (!line.trim()) continue;
            let raw: unknown;
            try {
                raw = JSON.parse(line);
            } catch {
                log.warn("ligne JSON invalide reçue du plugin", { line: line.slice(0, 200) });
                continue;
            }
            const parsed = incomingMessageSchema.safeParse(raw);
            if (!parsed.success) {
                log.warn("message du plugin non conforme", { issues: parsed.error.issues.slice(0, 3) });
                continue;
            }
            const msg = parsed.data as Record<string, unknown>;
            if (typeof msg.event === "string") {
                this.emit("event", msg.event, msg.data);
                this.emit(`event:${msg.event}`, msg.data);
                continue;
            }
            const id = msg.id as string | null;
            if (id === null) {
                log.warn("erreur du plugin sans id", { error: msg.error });
                continue;
            }
            const p = this.pending.get(id);
            if (!p) continue;
            if (typeof msg.progress === "number" && msg.ok === undefined) {
                p.onProgress?.(msg.progress);
                continue;
            }
            clearTimeout(p.timer);
            this.pending.delete(id);
            if (msg.ok === true) p.resolve(msg.result);
            else p.reject(new BridgeException(msg.error as BridgeError));
        }
    }

    private rawCall<T>(method: string, params: unknown, opts: CallOptions = {}): Promise<T> {
        const socket = this.socket;
        if (!socket || socket.destroyed) {
            return Promise.reject(new BridgeException({ code: "NOT_CONNECTED", message: "Jeu non connecté." }));
        }
        const id = `r-${(this.nextId++).toString().padStart(6, "0")}`;
        const timeoutMs = opts.timeoutMs ?? LIMITS.requestTimeoutMs + 5000;
        return new Promise<T>((resolve, reject) => {
            const timer = setTimeout(() => {
                this.pending.delete(id);
                reject(new BridgeException({ code: "TIMEOUT", message: `Pas de réponse du plugin pour ${method} après ${timeoutMs} ms.` }));
            }, timeoutMs);
            this.pending.set(id, { method, resolve: resolve as (v: unknown) => void, reject, timer, onProgress: opts.onProgress });
            socket.write(JSON.stringify({ v: PROTOCOL_VERSION, id, method, params }) + "\n");
        });
    }

    async call<M extends MethodName>(method: M, params: MethodParams<M>, opts?: CallOptions): Promise<MethodResult<M>> {
        await this.ensureConnected();
        const started = Date.now();
        try {
            return await this.rawCall<MethodResult<M>>(method, params, opts);
        } finally {
            log.debug("appel plugin", { method, ms: Date.now() - started });
        }
    }

    /** Attend un événement (ex. map_changed après checkpoint.restore). */
    waitForEvent<T = unknown>(event: string, timeoutMs: number): Promise<T> {
        return new Promise<T>((resolve, reject) => {
            const timer = setTimeout(() => {
                this.off(`event:${event}`, handler);
                reject(new BridgeException({ code: "TIMEOUT", message: `Événement ${event} non reçu après ${timeoutMs} ms.` }));
            }, timeoutMs);
            const handler = (data: T) => {
                clearTimeout(timer);
                resolve(data);
            };
            this.once(`event:${event}`, handler);
        });
    }
}
