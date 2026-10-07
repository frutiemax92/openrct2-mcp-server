// Enveloppes du protocole plugin ⇄ serveur (SPEC 7.1). Un message JSON par ligne (NDJSON).

import type { BridgeError } from "./errors.js";

export const PROTOCOL_VERSION = 1;
export const DEFAULT_PORT = 38491;
export const DEFAULT_HOST = "127.0.0.1";
export const PLUGIN_NAME = "claude-bridge";
export const PLUGIN_VERSION = "0.1.0";
/** Clé du jeton dans `context.sharedStorage` (fichier plugin.store.json du dossier utilisateur). */
export const TOKEN_STORAGE_KEY = "claude-bridge.token";
export const PORT_STORAGE_KEY = "claude-bridge.port";

/** Plafonds (SPEC 6.11). */
export const LIMITS = {
    maxLineBytes: 1_000_000,
    maxOpsPerRequest: 500,
    maxQueuedRequests: 64,
    maxRegionTiles: 128 * 128,
    requestTimeoutMs: 30_000,
} as const;

export interface RequestMessage<P = unknown> {
    v: number;
    id: string;
    method: string;
    params: P;
}

export interface SuccessResponse<R = unknown> {
    v: number;
    id: string;
    ok: true;
    result: R;
    tick?: number;
}

export interface ErrorResponse {
    v: number;
    id: string | null;
    ok: false;
    error: BridgeError;
}

export interface ProgressMessage {
    v: number;
    id: string;
    progress: number;
}

export interface EventMessage<D = unknown> {
    v: number;
    event: string;
    data: D;
}

export type ResponseMessage = SuccessResponse | ErrorResponse;
export type IncomingMessage = ResponseMessage | ProgressMessage | EventMessage;

export function isEvent(m: IncomingMessage): m is EventMessage {
    return (m as EventMessage).event !== undefined;
}

export function isProgress(m: IncomingMessage): m is ProgressMessage {
    return (m as ProgressMessage).progress !== undefined && (m as SuccessResponse).ok === undefined;
}

export interface MapChangedEvent {
    mapSize: { x: number; y: number };
    parkName: string | null;
    gameMode: string;
}
