// Réseau : listener TCP local, framing NDJSON, authentification par jeton (SPEC 6.2).
//
// Constat du code C++ (ScSocket.hpp) : `write` envoie de façon non bloquante et renvoie `true` si l'envoi
// a été PARTIEL (données perdues). On écrit donc par morceaux de 16 Ko, avec un plafond par frame, et on
// coupe la connexion si un envoi partiel survient (flux corrompu).

import { LIMITS, PROTOCOL_VERSION, type BridgeError, type RequestMessage } from "@openrct2-claude/protocol";
import { log } from "./util";

const CHUNK = 16 * 1024;
const MAX_BYTES_PER_FRAME = 256 * 1024;

export interface ConnectionHandlers {
    onRequest(conn: Connection, msg: RequestMessage): void;
    onHello(conn: Connection, msg: RequestMessage): void;
    onClose(conn: Connection): void;
}

export class Connection {
    authed = false;
    closed = false;
    private buffer = "";
    private outbox: string[] = [];

    constructor(
        private readonly socket: Socket,
        private readonly handlers: ConnectionHandlers,
    ) {
        socket.on("data", (chunk: string) => this.onData(chunk));
        socket.on("close", () => this.onClosed());
        socket.on("error", (err: string) => {
            log(`erreur socket : ${err}`);
            this.onClosed();
        });
    }

    private onData(chunk: string): void {
        if (this.closed) return;
        this.buffer += chunk;
        if (this.buffer.length > LIMITS.maxLineBytes && this.buffer.indexOf("\n") < 0) {
            this.sendError(null, { code: "INVALID_PARAMS", message: "Message trop long." });
            this.close();
            return;
        }
        let idx: number;
        while ((idx = this.buffer.indexOf("\n")) >= 0) {
            const line = this.buffer.substring(0, idx).trim();
            this.buffer = this.buffer.substring(idx + 1);
            if (line.length === 0) continue;
            let msg: RequestMessage;
            try {
                msg = JSON.parse(line);
            } catch {
                this.sendError(null, { code: "INVALID_PARAMS", message: "JSON invalide." });
                continue;
            }
            if (!msg || typeof msg.id !== "string" || typeof msg.method !== "string") {
                this.sendError(typeof msg?.id === "string" ? msg.id : null, { code: "INVALID_PARAMS", message: "Requête invalide : { v, id, method, params } attendu." });
                continue;
            }
            if (!this.authed) {
                if (msg.method === "session.hello") this.handlers.onHello(this, msg);
                else {
                    this.sendError(msg.id, { code: "INVALID_PARAMS", message: "session.hello attendu en premier." });
                    this.close();
                    return;
                }
                continue;
            }
            this.handlers.onRequest(this, msg);
        }
    }

    send(msg: object): void {
        if (this.closed) return;
        const line = JSON.stringify(msg) + "\n";
        for (let i = 0; i < line.length; i += CHUNK) this.outbox.push(line.substring(i, i + CHUNK));
    }

    sendOk(id: string, result: unknown): void {
        this.send({ v: PROTOCOL_VERSION, id, ok: true, result, tick: typeof date !== "undefined" ? date.ticksElapsed : 0 });
    }

    sendError(id: string | null, error: BridgeError): void {
        this.send({ v: PROTOCOL_VERSION, id, ok: false, error });
    }

    sendEvent(event: string, data: unknown): void {
        this.send({ v: PROTOCOL_VERSION, event, data });
    }

    /** Écrit une partie de la file de sortie ; appelé à chaque frame. */
    flushOutbox(): void {
        let written = 0;
        while (!this.closed && this.outbox.length > 0 && written < MAX_BYTES_PER_FRAME) {
            const chunk = this.outbox.shift() as string;
            let partial: boolean;
            try {
                partial = this.socket.write(chunk);
            } catch (e) {
                log(`write a échoué : ${e}`);
                this.close();
                return;
            }
            if (partial) {
                log("envoi partiel détecté : flux corrompu, fermeture de la connexion");
                this.close();
                return;
            }
            written += chunk.length;
        }
    }

    close(): void {
        if (this.closed) return;
        this.closed = true;
        this.outbox = [];
        try {
            this.socket.end();
        } catch {
            // ignoré
        }
        this.handlers.onClose(this);
    }

    private onClosed(): void {
        if (this.closed) return;
        this.closed = true;
        this.outbox = [];
        this.handlers.onClose(this);
    }
}

export class Server {
    private listener: Listener | null = null;
    active: Connection | null = null;

    constructor(
        private readonly port: number,
        private readonly handlers: ConnectionHandlers,
    ) {}

    start(): void {
        const listener = network.createListener();
        listener.on("connection", (socket: Socket) => this.onConnection(socket));
        listener.listen(this.port, "127.0.0.1");
        this.listener = listener;
        log(`écoute sur 127.0.0.1:${this.port}`);
    }

    private onConnection(socket: Socket): void {
        const conn = new Connection(socket, {
            onHello: (c, m) => this.handlers.onHello(c, m),
            onRequest: (c, m) => this.handlers.onRequest(c, m),
            onClose: (c) => {
                if (this.active === c) this.active = null;
                this.handlers.onClose(c);
            },
        });
        if (this.active && !this.active.closed) {
            // Une seule connexion active (SPEC 6.2) : la nouvelle doit s'authentifier, puis remplace l'ancienne.
            log("nouvelle connexion : elle remplacera l'actuelle après authentification");
        }
        socket.setNoDelay(true);
        this.pendingConnections.push(conn);
    }

    pendingConnections: Connection[] = [];

    /** Une connexion vient de s'authentifier : elle devient la connexion active. */
    promote(conn: Connection): void {
        this.pendingConnections = this.pendingConnections.filter((c) => c !== conn && !c.closed);
        if (this.active && this.active !== conn) {
            log("remplacement de la connexion active");
            this.active.close();
        }
        this.active = conn;
    }

    flush(): void {
        if (this.active) this.active.flushOutbox();
        for (const c of this.pendingConnections) c.flushOutbox();
        this.pendingConnections = this.pendingConnections.filter((c) => !c.closed);
    }

    get listening(): boolean {
        return !!this.listener && this.listener.listening;
    }
}
