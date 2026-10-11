// Méthodes du Style Picker et du Magic Fill Tool (SPEC 13.7) : relevé d'une région, capture masquée, boîte d'envoi.

import {
    type InboxAckParams,
    type MagicFillStatusParams,
    type MaskedCaptureParams,
    type MaskedCaptureResult,
    type StyleRecord,
    type StylesCaptureParams,
    type StylesExtractParams,
    type TileXY,
    type UiAlertParams,
} from "@openrct2-claude/protocol";
import type { Job } from "../queue";
import { maskedCapture } from "../styles/capture";
import { extractStyle, newId, normalizeTiles } from "../styles/extract";
import * as inbox from "../styles/inbox";
import { fail, isInt, requireParkLoaded, requireSafeName } from "../util";

function rotationsOf(v: unknown): number[] {
    if (v === undefined) return [0, 1, 2, 3];
    if (!Array.isArray(v) || v.length === 0 || v.length > 4 || v.some((r) => !isInt(r) || r < 0 || r > 3)) {
        fail("INVALID_PARAMS", "'rotations' : 1 à 4 rotations entre 0 et 3.");
    }
    return v as number[];
}

/** Relevé + captures masquées : partagé par le bouton « Save Style » et la méthode styles.capture. */
export function* captureStyle(tiles: TileXY[], caption: string, source: "user" | "claude", screenshot: boolean, rotations: number[]): Job {
    const id = newId("style");
    const record = (yield* extractStyle(tiles, { caption, source, id })) as StyleRecord;
    if (screenshot) {
        const shot = maskedCapture(tiles, id, rotations);
        record.screenshots = shot.screenshots;
        if (shot.error) record.screenshotError = shot.error;
    }
    return record;
}

export function* capture(params: StylesCaptureParams): Job {
    requireParkLoaded();
    const tiles = normalizeTiles(params.tiles);
    const caption = typeof params.caption === "string" ? params.caption.slice(0, 500) : "";
    return yield* captureStyle(tiles, caption, params.source ?? "claude", params.screenshot !== false, rotationsOf(params.rotations));
}

export function* extract(params: StylesExtractParams): Job {
    requireParkLoaded();
    return yield* extractStyle(normalizeTiles(params.tiles), { caption: "", source: "claude", id: "extract" });
}

export function* maskedCaptureJob(params: MaskedCaptureParams): Job {
    requireParkLoaded();
    const name = requireSafeName(params as never, "name");
    const tiles = normalizeTiles(params.tiles);
    const r = maskedCapture(tiles, name, rotationsOf(params.rotations));
    if (r.error && r.screenshots.length === 0) fail("NOT_SUPPORTED_IN_MODE", r.error);
    const result: MaskedCaptureResult = { screenshots: r.screenshots, hidden: r.hidden };
    return result;
}

export function* take(): Job {
    return inbox.take();
}

export function* ack(params: InboxAckParams): Job {
    const styles = Array.isArray(params.styles) ? params.styles.filter((s) => typeof s === "string") : [];
    const fills = Array.isArray(params.fills) ? params.fills.filter((s) => typeof s === "string") : [];
    const cleared = typeof params.clearedStyles === "number" ? params.clearedStyles : undefined;
    return { removed: inbox.ack(styles, fills, cleared) };
}

const STATUSES = ["pending", "received", "working", "done", "failed", "dismissed"];

export function* fillStatus(params: MagicFillStatusParams): Job {
    if (typeof params.id !== "string") fail("INVALID_PARAMS", "'id' : chaîne attendue.");
    if (STATUSES.indexOf(params.status) < 0) fail("INVALID_PARAMS", `'status' : ${STATUSES.join(", ")}.`);
    const message = typeof params.message === "string" ? params.message.slice(0, 200) : "";
    return { known: inbox.setFillStatus(params.id, params.status, message) };
}

/** Boîte d'avertissement en jeu. Sans interface (`host --headless`) : rien d'affiché, `shown: false`. */
export function* alert(params: UiAlertParams): Job {
    if (typeof params.title !== "string" || typeof params.message !== "string") fail("INVALID_PARAMS", "'title' et 'message' : chaînes attendues.");
    if (typeof ui === "undefined") return { shown: false };
    ui.showError(params.title.slice(0, 60), params.message.slice(0, 400));
    return { shown: true };
}
