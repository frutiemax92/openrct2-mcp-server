// Plugin « claude-bridge » : pont TCP local entre OpenRCT2 et le serveur MCP (SPEC 6).

import {
    DEFAULT_PORT,
    PLUGIN_NAME,
    PLUGIN_VERSION,
    PORT_STORAGE_KEY,
    PROTOCOL_VERSION,
    TOKEN_STORAGE_KEY,
    type HelloParams,
    type MapChangedEvent,
    type RequestMessage,
} from "@openrct2-claude/protocol";
import { handlers, timeoutFor } from "./handlers/index";
import { hasPark, helloResult } from "./handlers/session";
import { Connection, Server } from "./net";
import { invalidateObjects } from "./objects";
import { enqueue, flush, pump, type Responder } from "./queue";
import { log, toBridgeError } from "./util";

declare const __BRIDGE_DEFAULT_TOKEN__: string;
declare const __BRIDGE_DEFAULT_PORT__: number;

let server: Server | null = null;
let token = "";
let mapChanging = false;
const deferredTasks: { fn: () => void; changesMap: boolean }[] = [];
/** Incrémenté par onMapChanged : permet de savoir si le hook a été appelé pendant une tâche. */
let mapGeneration = 0;

function randomToken(): string {
    let s = "";
    for (let i = 0; i < 32; i++) s += Math.floor(Math.random() * 16).toString(16);
    return s;
}

/** Jeton : sharedStorage (plugin.store.json), sinon constante de build, sinon généré et mémorisé. */
function resolveToken(): string {
    const stored = context.sharedStorage.get<string>(TOKEN_STORAGE_KEY);
    if (typeof stored === "string" && stored.length >= 16) return stored;
    const t = __BRIDGE_DEFAULT_TOKEN__ || randomToken();
    context.sharedStorage.set(TOKEN_STORAGE_KEY, t);
    return t;
}

function resolvePort(): number {
    const p = context.sharedStorage.get<number>(PORT_STORAGE_KEY);
    if (typeof p === "number" && p > 1024 && p < 65536) return p;
    return __BRIDGE_DEFAULT_PORT__ || DEFAULT_PORT;
}

function responderFor(conn: Connection): Responder {
    return {
        ok: (id, result) => conn.sendOk(id, result),
        error: (id, error) => conn.sendError(id, error),
    };
}

function onHello(conn: Connection, msg: RequestMessage): void {
    const params = (msg.params ?? {}) as HelloParams;
    if (params.token !== token) {
        log("jeton invalide : connexion refusée");
        conn.sendError(msg.id, { code: "INVALID_PARAMS", message: "Jeton invalide." });
        conn.flushOutbox();
        conn.close();
        return;
    }
    // Un seul client à la fois (SPEC 6.2). Remplacer l'ancien provoquait un ping-pong : deux serveurs MCP
    // (deux conversations Claude) s'éjectaient l'un l'autre en boucle. Le nouveau est refusé.
    if (server?.active && !server.active.closed && server.active !== conn) {
        log("deuxième client refusé : un autre serveur MCP est déjà connecté");
        conn.sendError(msg.id, { code: "BUSY", message: "Un autre serveur MCP est déjà connecté à ce jeu (autre conversation Claude ouverte ?).", details: { reason: "client_active" } });
        conn.flushOutbox();
        conn.close();
        return;
    }
    conn.authed = true;
    server?.promote(conn);
    conn.sendOk(msg.id, helloResult());
    log(`client authentifié (${params.clientVersion ?? "?"})`);
}

function onRequest(conn: Connection, msg: RequestMessage): void {
    if (msg.v !== undefined && msg.v !== PROTOCOL_VERSION) {
        conn.sendError(msg.id, { code: "INVALID_PARAMS", message: `Version de protocole ${msg.v} non prise en charge (${PROTOCOL_VERSION}).` });
        return;
    }
    if (msg.method === "session.hello") {
        conn.sendOk(msg.id, helloResult());
        return;
    }
    if (mapChanging) {
        conn.sendError(msg.id, { code: "BUSY", message: "Changement de carte en cours." });
        return;
    }
    const handler = handlers[msg.method];
    if (!handler) {
        conn.sendError(msg.id, { code: "INVALID_PARAMS", message: `Méthode inconnue : ${msg.method}.`, details: { known: Object.keys(handlers) } });
        return;
    }
    const params = (msg.params ?? {}) as Record<string, unknown>;
    try {
        const job = handler(params, (fn, options) => deferredTasks.push({ fn, changesMap: !!options?.changesMap }));
        enqueue(msg.id, msg.method, job, responderFor(conn), timeoutFor(msg.method, params));
    } catch (e) {
        conn.sendError(msg.id, toBridgeError(e));
    }
}

function onClose(conn: Connection): void {
    flush("INTERNAL", "Connexion fermée.", responderFor(conn));
    log("client déconnecté");
}

/** Appelé à chaque frame (40 Hz), y compris en pause : `interval.tick` ne tourne pas en pause (ADR 0002). */
function frame(): void {
    while (deferredTasks.length > 0) {
        const task = deferredTasks.shift() as { fn: () => void; changesMap: boolean };
        const generation = mapGeneration;
        try {
            task.fn();
        } catch (e) {
            log(`tâche différée : ${e}`);
        }
        // `load_park` (console) passe par Context::LoadParkFromStream, qui n'appelle ni map.change ni
        // map.changed (contrairement au chargement par l'interface, Game.cpp) : on émet l'événement nous-mêmes.
        if (task.changesMap && generation === mapGeneration) onMapChanged();
    }
    if (!mapChanging) pump();
    server?.flush();
}

function onMapChange(): void {
    mapChanging = true;
    flush("BUSY", "Changement de carte : requête annulée.");
}

function onMapChanged(): void {
    mapGeneration++;
    mapChanging = false;
    invalidateObjects();
    const data: MapChangedEvent = {
        mapSize: hasPark() ? { x: map.size.x, y: map.size.y } : { x: 0, y: 0 },
        parkName: hasPark() ? park.name : null,
        gameMode: context.mode,
    };
    server?.active?.sendEvent("map_changed", data);
    log(`carte changée (${context.mode})`);
}

function main(): void {
    token = resolveToken();
    const port = resolvePort();
    server = new Server(port, { onHello, onRequest, onClose });
    try {
        server.start();
    } catch (e) {
        log(`impossible d'écouter sur le port ${port} : ${e}`);
        return;
    }
    context.setInterval(frame, 0);
    context.subscribe("map.change", onMapChange);
    context.subscribe("map.changed", onMapChanged);
    log(`v${PLUGIN_VERSION} prêt (API ${context.apiVersion}, mode réseau ${network.mode})`);
}

registerPlugin({
    name: PLUGIN_NAME,
    version: PLUGIN_VERSION,
    authors: ["Lucas Malo Belanger"],
    type: "intransient",
    licence: "MIT",
    minApiVersion: 124,
    targetApiVersion: 124,
    main,
});
