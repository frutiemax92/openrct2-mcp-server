// Schémas zod des enveloppes (côté serveur uniquement : le plugin n'embarque pas zod).

import { z } from "zod";
import { ERROR_CODES } from "./errors.js";

export const bridgeErrorSchema = z.object({
    code: z.enum(ERROR_CODES),
    message: z.string(),
    details: z.record(z.unknown()).optional(),
    hint: z.string().optional(),
});

export const successResponseSchema = z.object({
    v: z.number(),
    id: z.string(),
    ok: z.literal(true),
    result: z.unknown(),
    tick: z.number().optional(),
});

export const errorResponseSchema = z.object({
    v: z.number(),
    id: z.string().nullable(),
    ok: z.literal(false),
    error: bridgeErrorSchema,
});

export const progressSchema = z.object({ v: z.number(), id: z.string(), progress: z.number() });

export const eventSchema = z.object({ v: z.number(), event: z.string(), data: z.unknown() });

export const incomingMessageSchema = z.union([successResponseSchema, errorResponseSchema, eventSchema, progressSchema]);

export const requestSchema = z.object({
    v: z.number(),
    id: z.string(),
    method: z.string(),
    params: z.unknown(),
});
