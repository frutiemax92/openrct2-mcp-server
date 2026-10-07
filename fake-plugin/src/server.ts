// Faux plugin : même protocole NDJSON que claude-bridge, sur un monde simulé.

import { createServer, type Server, type Socket } from "node:net";
import { PROTOCOL_VERSION, type BridgeError, type MapChangedEvent } from "@openrct2-claude/protocol";
import { FakeError, FakeGame } from "./handlers.js";
import type { World } from "./world.js";

export interface FakePluginOptions {
    port?: number;
    token?: string;
    userDir?: string;
    world?: World;
}

export class FakePlugin {
    readonly game: FakeGame;
    private server: Server | null = null;
    private client: Socket | null = null;
    readonly token: string;
    port = 0;

    constructor(private readonly opts: FakePluginOptions = {}) {
        this.token = opts.token ?? "fake-token-0123456789abcdef";
        this.game = new FakeGame(opts.world, { userDir: opts.userDir, onMapChanged: () => this.emitMapChanged() });
    }

    get world(): World {
        return this.game.world;
    }

    start(): Promise<number> {
        return new Promise((resolve) => {
            this.server = createServer((socket) => this.onConnection(socket));
            this.server.listen(this.opts.port ?? 0, "127.0.0.1", () => {
                const addr = this.server!.address();
                this.port = typeof addr === "object" && addr ? addr.port : 0;
                resolve(this.port);
            });
        });
    }

    stop(): Promise<void> {
        this.client?.destroy();
        return new Promise((resolve) => (this.server ? this.server.close(() => resolve()) : resolve()));
    }

    /** Coupe la connexion (test de reconnexion). */
    dropClient(): void {
        this.client?.destroy();
        this.client = null;
    }

    emitMapChanged(): void {
        const data: MapChangedEvent = { mapSize: { x: this.world.sizeX, y: this.world.sizeY }, parkName: this.world.parkName, gameMode: "normal" };
        this.send(this.client, { v: PROTOCOL_VERSION, event: "map_changed", data });
    }

    private send(socket: Socket | null, msg: object): void {
        if (socket && !socket.destroyed) socket.write(JSON.stringify(msg) + "\n");
    }

    private onConnection(socket: Socket): void {
        socket.setEncoding("utf8");
        let buffer = "";
        let authed = false;
        socket.on("data", (chunk: string) => {
            buffer += chunk;
            let idx: number;
            while ((idx = buffer.indexOf("\n")) >= 0) {
                const line = buffer.slice(0, idx).trim();
                buffer = buffer.slice(idx + 1);
                if (!line) continue;
                let msg: { id: string; method: string; params: unknown };
                try {
                    msg = JSON.parse(line);
                } catch {
                    this.send(socket, { v: PROTOCOL_VERSION, id: null, ok: false, error: { code: "INVALID_PARAMS", message: "JSON invalide." } });
                    continue;
                }
                if (!authed) {
                    if (msg.method === "session.hello" && (msg.params as { token?: string })?.token === this.token) {
                        authed = true;
                        if (this.client && this.client !== socket) this.client.destroy();
                        this.client = socket;
                    } else {
                        this.send(socket, { v: PROTOCOL_VERSION, id: msg.id, ok: false, error: { code: "INVALID_PARAMS", message: "Jeton invalide." } });
                        socket.end();
                        return;
                    }
                }
                setImmediate(() => {
                    try {
                        const result = this.game.handle(msg.method, msg.params ?? {});
                        this.send(socket, { v: PROTOCOL_VERSION, id: msg.id, ok: true, result, tick: this.world.ticks });
                    } catch (e) {
                        const error: BridgeError = e instanceof FakeError ? e.error : { code: "INTERNAL", message: String(e) };
                        this.send(socket, { v: PROTOCOL_VERSION, id: msg.id, ok: false, error });
                    }
                });
            }
        });
        socket.on("error", () => undefined);
    }
}
