// Contexte partagé des outils et format de réponse (SPEC 8.2, 8.3, 8.5).

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { BridgeException, type BridgeError, type RegionTile } from "@openrct2-claude/protocol";
import type { ZodRawShape } from "zod";
import { z } from "zod";
import type { BridgeLike } from "../bridge.js";
import type { Config } from "../config.js";
import { log, metrics } from "../log.js";
import type { Journal } from "../state/journal.js";
import type { MapCache } from "../state/mapCache.js";
import type { SessionRecorder } from "../state/recorder.js";
import type { ZoneMap } from "../state/zones.js";

export interface ServerState {
    mode: "strict" | "sandbox" | "unknown";
    /** Faux dès qu'on a construit en sandbox : à re-tester en strict (SPEC 6.4). */
    validated: boolean;
    captureCounter: number;
    /** Dernier instantané pour le différentiel de get_region_map. */
    lastSnapshot: Map<string, string> | null;
    checkpoints: Map<string, { file: string; createdAt: string; summary: Record<string, unknown> }>;
    /** Couche de zones paysagères (SPEC 11.2). */
    zones: ZoneMap;
}

export interface ToolContext {
    bridge: BridgeLike;
    cache: MapCache;
    journal: Journal;
    config: Config;
    state: ServerState;
    recorder: SessionRecorder | null;
}

export interface ToolResponse {
    summary: string;
    changed?: Record<string, number>;
    warnings?: string[];
    next_hints?: string[];
    [key: string]: unknown;
}

/** Budgets en caractères (≈ 4 caractères par token). */
export const BUDGET = {
    write: 400 * 4,
    read: 1500 * 4,
    readLarge: 4000 * 4,
};

export class ToolError extends Error {
    constructor(public readonly error: BridgeError) {
        super(error.message);
    }
}

export function toolError(code: BridgeError["code"], message: string, extra?: { details?: Record<string, unknown>; hint?: string }): never {
    throw new ToolError({ code, message, ...extra });
}

/** Plafonne une liste et signale la troncature (jamais silencieuse). */
export function cap<T>(items: T[], max: number): { items: T[]; truncated?: { shown: number; total: number } } {
    if (items.length <= max) return { items };
    return { items: items.slice(0, max), truncated: { shown: max, total: items.length } };
}

function compactJson(v: unknown): string {
    return JSON.stringify(v, (_k, val) => (val === undefined ? undefined : val));
}

function enforceBudget(resp: ToolResponse, maxChars: number): string {
    let text = compactJson(resp);
    if (text.length <= maxChars) return text;
    // Réduit les plus grands tableaux jusqu'à tenir dans le budget.
    const clone: Record<string, unknown> = JSON.parse(text);
    for (let guard = 0; guard < 20 && text.length > maxChars; guard++) {
        let biggestKey: string | null = null;
        let biggestLen = 0;
        for (const [k, v] of Object.entries(clone)) {
            if (Array.isArray(v) && v.length > 1) {
                const len = JSON.stringify(v).length;
                if (len > biggestLen) {
                    biggestLen = len;
                    biggestKey = k;
                }
            }
        }
        if (!biggestKey) break;
        const arr = clone[biggestKey] as unknown[];
        const keep = Math.max(1, Math.floor(arr.length / 2));
        clone[biggestKey] = arr.slice(0, keep);
        const tr = (clone.truncated as Record<string, unknown>) ?? {};
        tr[biggestKey] = { shown: keep, total: (tr[biggestKey] as { total?: number })?.total ?? arr.length };
        clone.truncated = tr;
        text = compactJson(clone);
    }
    return text;
}

export interface ToolResultParts {
    response: ToolResponse;
    images?: { data: Buffer; mimeType: string }[];
    extraText?: string;
    budget?: number;
}

export function result(parts: ToolResultParts): CallToolResult {
    const content: CallToolResult["content"] = [{ type: "text", text: enforceBudget(parts.response, parts.budget ?? BUDGET.read) }];
    if (parts.extraText) content.push({ type: "text", text: parts.extraText });
    for (const img of parts.images ?? []) content.push({ type: "image", data: img.data.toString("base64"), mimeType: img.mimeType });
    return { content };
}

function errorResult(err: BridgeError): CallToolResult {
    return {
        isError: true,
        content: [{ type: "text", text: compactJson({ error: { code: err.code, message: err.message, hint: err.hint, details: err.details } }) }],
    };
}

export function asBridgeError(e: unknown): BridgeError {
    if (e instanceof ToolError) return e.error;
    if (e instanceof BridgeException) return e.error;
    if (e && typeof e === "object" && "error" in e) {
        const inner = (e as { error: unknown }).error;
        if (inner && typeof inner === "object" && "code" in inner) return inner as BridgeError;
    }
    return { code: "INTERNAL", message: e instanceof Error ? e.message : String(e) };
}

export interface ToolSpec<S extends ZodRawShape> {
    title: string;
    description: string;
    input: S;
    readOnly?: boolean;
    destructive?: boolean;
}

/** Enregistre un outil avec mesure, journal d'observabilité et gestion d'erreurs uniforme. */
export function defineTool<S extends ZodRawShape>(
    server: McpServer,
    ctx: ToolContext,
    name: string,
    spec: ToolSpec<S>,
    handler: (args: z.objectOutputType<S, z.ZodTypeAny>) => Promise<CallToolResult>,
): void {
    server.registerTool(
        name,
        {
            title: spec.title,
            description: spec.description,
            inputSchema: spec.input,
            annotations: { readOnlyHint: !!spec.readOnly, destructiveHint: !!spec.destructive, openWorldHint: false },
        },
        (async (args: z.objectOutputType<S, z.ZodTypeAny>) => {
            const started = Date.now();
            let res: CallToolResult;
            let code: string | undefined;
            try {
                res = await handler(args);
            } catch (e) {
                const err = asBridgeError(e);
                code = err.code;
                if (err.code === "INTERNAL") log.error("erreur interne d'outil", { tool: name, message: err.message, stack: e instanceof Error ? e.stack : undefined });
                res = errorResult(err);
            }
            const chars = res.content.reduce((n, c) => n + (c.type === "text" ? c.text.length : 0), 0);
            const ms = Date.now() - started;
            metrics.record(name, ms, chars, code);
            log.info("outil", { tool: name, ms, chars, error: code });
            ctx.recorder?.record(name, args, res);
            return res;
        }) as never,
    );
}

// ---------------------------------------------------------------------------
// Schémas réutilisables
// ---------------------------------------------------------------------------

export const zTile = z.object({ x: z.number().int().min(0).max(1023), y: z.number().int().min(0).max(1023) });
export const zRectShape = {
    x1: z.number().int().min(0).max(1023),
    y1: z.number().int().min(0).max(1023),
    x2: z.number().int().min(0).max(1023),
    y2: z.number().int().min(0).max(1023),
};
export const zDirection = z.number().int().min(0).max(3);
export const zDryRun = z.boolean().default(false).describe("Simule sans rien modifier (coût et problèmes).");

export function tileSig(t: RegionTile | undefined): string {
    return t ? JSON.stringify(t) : "";
}
