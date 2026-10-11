// Fenêtres en jeu du Style Picker et du Magic Fill Tool (SPEC 13.7), ouvertes depuis le menu des plugins
// (icône carte de la barre d'outils). Les libellés sont en anglais, comme le reste de l'interface du jeu.

import { STYLE_MAX_TILES, type MagicFillRequest, type StyleRecord, type TileXY } from "@openrct2-claude/protocol";
import { captureStyle } from "../handlers/styles";
import { enqueue } from "../queue";
import { newId } from "../styles/extract";
import * as inbox from "../styles/inbox";
import { log, toBridgeError } from "../util";
import { Brush } from "./brush";
import { editText, redrawTextArea, textAreaHeight, textAreaWidget } from "./textArea";

const W = 260;
/** Longueur maximale d'une légende ou d'une consigne (un paragraphe). */
const TEXT_MAX = 500;
/** Décalage vertical des widgets sous la zone de texte (4 lignes au lieu d'un textbox de 14 px). */
const DY = textAreaHeight() - 14;

function setText(win: Window, name: string, text: string): void {
    try {
        win.findWidget<LabelWidget>(name).text = text;
    } catch {
        // fenêtre en cours de fermeture
    }
}

function setPressed(win: Window, name: string, pressed: boolean): void {
    try {
        win.findWidget<ButtonWidget>(name).isPressed = pressed;
    } catch {
        // idem
    }
}

function existing(classification: string): Window | null {
    try {
        const w = ui.getWindow(classification);
        return w ?? null;
    } catch {
        return null;
    }
}

function serverLine(): string {
    const c = inbox.counts();
    const link = inbox.serverConnected() ? "{GREEN}Claude MCP server connected" : "{RED}Claude MCP server not connected";
    const clear = c.clearStyles ? ", clear pending" : "";
    const queued = c.styles || c.fills || c.clearStyles ? `  ({WHITE}${c.styles} style(s), ${c.fills} fill(s) waiting${clear}{RED})` : "";
    return link + queued;
}

// ---------------------------------------------------------------------------
// Style Picker
// ---------------------------------------------------------------------------

export function openStylePicker(): void {
    const open = existing("claude-style-picker");
    if (open) {
        open.bringToFront();
        return;
    }
    let caption = "";
    let saving = false;
    let status = "Paint a region, describe it, then Save Style.";
    let win: Window | null = null;
    let confirmClear = false;
    let seenNotice = inbox.lastClearNotice();
    const update = () => {
        if (!win) return;
        // Le serveur a vidé la base (inbox.ack) : on l'affiche une fois.
        const notice = inbox.lastClearNotice();
        if (notice && notice !== seenNotice) status = notice;
        seenNotice = notice;
        setText(win, "size", String(brush.size));
        setText(win, "count", `${brush.selectedCount} tile(s) selected (max ${STYLE_MAX_TILES})`);
        setText(win, "clearAll", confirmClear ? "{RED}Click again to delete ALL stored styles" : "Clear all stored styles");
        setText(win, "status", status);
        setText(win, "server", serverLine());
        setPressed(win, "paint", brush.active);
    };
    const brush = new Brush({ toolId: "claude-style-picker", onChange: update, onFinish: update });
    const unsubscribe = inbox.onInboxChange(update);

    const save = () => {
        confirmClear = false;
        if (saving) return;
        const tiles = brush.selected();
        if (tiles.length === 0) {
            status = "{RED}Paint a region first.";
            return update();
        }
        if (!caption.trim()) {
            status = "{RED}Write a caption first.";
            return update();
        }
        if (!inbox.canQueueStyle()) {
            status = "{RED}Too many styles waiting: start Claude (MCP server) first.";
            return update();
        }
        saving = true;
        status = "Saving…";
        update();
        const text = caption.trim();
        try {
            enqueue(newId("ui"), "styles.capture", captureStyle(tiles, text, "user", true, [0, 1, 2, 3]), {
                ok: (_id, result) => {
                    saving = false;
                    const rec = result as StyleRecord;
                    inbox.addStyle(rec);
                    const n = rec.elements.length;
                    const shots = rec.screenshots.length ? `${rec.screenshots.length} screenshot(s)` : `no screenshot (${rec.screenshotError ?? "?"})`;
                    status = `{GREEN}Saved "${text.slice(0, 24)}": ${n} element(s), ${shots}.`;
                    brush.clear();
                    update();
                },
                error: (_id, error) => {
                    saving = false;
                    status = `{RED}${error.message}`;
                    update();
                },
            });
        } catch (e) {
            saving = false;
            status = `{RED}${toBridgeError(e).message}`;
            update();
        }
    };

    // Deux clics : le premier arme le bouton, le second vide la base (styles du serveur et styles en attente).
    const clearAll = () => {
        if (!confirmClear) {
            confirmClear = true;
            status = "{RED}This deletes every saved style. Click again to confirm.";
            return update();
        }
        confirmClear = false;
        const dropped = inbox.requestClearAll();
        const local = dropped ? ` (${dropped} waiting style(s) dropped)` : "";
        status = inbox.serverConnected() ? `Clearing stored styles…${local}` : `{RED}Styles will be cleared when Claude connects${local}.`;
        update();
    };

    const editCaption = () =>
        editText({
            title: "Style caption",
            description: "Describe this region (one paragraph):",
            initial: caption,
            maxLength: TEXT_MAX,
            onDone: (t) => {
                caption = t;
                if (win) redrawTextArea(win, "caption");
            },
        });

    win = ui.openWindow({
        classification: "claude-style-picker",
        title: "Style Picker",
        width: W,
        height: 192 + DY,
        widgets: [
            { type: "label", x: 10, y: 22, width: 80, height: 12, text: "Brush size:" },
            { type: "button", name: "minus", x: 90, y: 20, width: 20, height: 14, text: "-", onClick: () => brush.grow(-1) },
            { type: "label", name: "size", x: 112, y: 22, width: 30, height: 12, text: String(brush.size), textAlign: "centred" },
            { type: "button", name: "plus", x: 144, y: 20, width: 20, height: 14, text: "+", onClick: () => brush.grow(1) },
            {
                type: "button",
                name: "paint",
                x: 10,
                y: 40,
                width: 80,
                height: 14,
                text: "Paint",
                onClick: () => {
                    if (brush.active) brush.deactivate();
                    else brush.activate();
                    update();
                },
            },
            { type: "checkbox", name: "erase", x: 100, y: 41, width: 60, height: 12, text: "Erase", onChange: (v: boolean) => (brush.erase = v) },
            { type: "button", name: "clear", x: 170, y: 40, width: 80, height: 14, text: "Clear", onClick: () => brush.clear() },
            { type: "label", x: 10, y: 62, width: 170, height: 12, text: "Caption (what this region is):" },
            { type: "button", name: "editCaption", x: 190, y: 60, width: 60, height: 14, text: "Edit...", onClick: editCaption },
            textAreaWidget({ name: "caption", x: 10, y: 76, width: 240, get: () => caption, colour: () => win?.colours[1] ?? 1 }),
            { type: "label", name: "count", x: 10, y: 96 + DY, width: 240, height: 12, text: "" },
            { type: "button", name: "save", x: 10, y: 112 + DY, width: 240, height: 18, text: "Save Style", onClick: save },
            { type: "button", name: "clearAll", x: 10, y: 134 + DY, width: 240, height: 14, text: "Clear all stored styles", onClick: clearAll },
            { type: "label", name: "status", x: 10, y: 156 + DY, width: 240, height: 12, text: status },
            { type: "label", name: "server", x: 10, y: 172 + DY, width: 240, height: 12, text: serverLine() },
        ],
        onClose: () => {
            unsubscribe();
            brush.dispose();
            win = null;
        },
    });
    brush.activate();
    update();
}

// ---------------------------------------------------------------------------
// Magic Fill Tool
// ---------------------------------------------------------------------------

export function openMagicFill(): void {
    const open = existing("claude-magic-fill");
    if (open) {
        open.bringToFront();
        return;
    }
    let prompt = "";
    let autoSend = true;
    let status = "Describe what to grow, then drag on the map.";
    const sent: MagicFillRequest[] = [];
    let win: Window | null = null;
    const update = () => {
        if (!win) return;
        setText(win, "size", String(brush.size));
        setText(win, "count", `${brush.selectedCount} tile(s) painted`);
        setText(win, "status", status);
        setText(win, "server", serverLine());
        setPressed(win, "paint", brush.active);
        for (let i = 0; i < 3; i++) {
            const req = sent[sent.length - 1 - i];
            const st = req ? inbox.fillStatusOf(req.id) : null;
            const colour = st?.status === "done" ? "{GREEN}" : st?.status === "failed" ? "{RED}" : "{WHITE}";
            setText(win, `req${i}`, req ? `${colour}${req.prompt.slice(0, 18)} (${req.tiles.length}): ${st?.status ?? "?"} ${st?.message ?? ""}`.slice(0, 80) : "");
        }
    };

    const submit = (tiles: TileXY[]) => {
        if (tiles.length === 0) {
            status = "{RED}Paint the region to fill first.";
            return update();
        }
        if (!prompt.trim()) {
            status = "{RED}Write what to fill first.";
            return update();
        }
        const req: MagicFillRequest = {
            id: newId("fill"),
            prompt: prompt.trim(),
            tiles: tiles.map((t) => [t.x, t.y] as [number, number]),
            brushSize: brush.size,
            createdAt: new Date().toISOString(),
            park: { name: park.name, mapSize: { x: map.size.x, y: map.size.y } },
        };
        sent.push(req);
        inbox.addFill(req);
        log(`Magic Fill : demande ${req.id} (${tiles.length} tuiles) « ${req.prompt} »`);
        status = inbox.serverConnected() ? "{GREEN}Sent to Claude." : "{RED}Queued: Claude MCP server not connected.";
        brush.clear();
    };

    const brush = new Brush({
        toolId: "claude-magic-fill",
        onChange: update,
        onFinish: update,
        // Au relâchement de la souris : la région peinte part chez Claude (option « Send on release »).
        onStroke: () => {
            if (autoSend && !brush.erase) submit(brush.selected());
        },
    });
    const unsubscribe = inbox.onInboxChange(update);

    const editPrompt = () =>
        editText({
            title: "Magic Fill",
            description: "What should fill the painted region (one paragraph)?",
            initial: prompt,
            maxLength: TEXT_MAX,
            onDone: (t) => {
                prompt = t;
                if (win) redrawTextArea(win, "prompt");
            },
        });

    win = ui.openWindow({
        classification: "claude-magic-fill",
        title: "Magic Fill Tool",
        width: W,
        height: 208 + DY,
        widgets: [
            { type: "label", x: 10, y: 22, width: 80, height: 12, text: "Brush size:" },
            { type: "button", name: "minus", x: 90, y: 20, width: 20, height: 14, text: "-", onClick: () => brush.grow(-1) },
            { type: "label", name: "size", x: 112, y: 22, width: 30, height: 12, text: String(brush.size), textAlign: "centred" },
            { type: "button", name: "plus", x: 144, y: 20, width: 20, height: 14, text: "+", onClick: () => brush.grow(1) },
            {
                type: "button",
                name: "paint",
                x: 10,
                y: 40,
                width: 80,
                height: 14,
                text: "Paint",
                onClick: () => {
                    if (brush.active) brush.deactivate();
                    else brush.activate();
                    update();
                },
            },
            { type: "checkbox", name: "erase", x: 100, y: 41, width: 60, height: 12, text: "Erase", onChange: (v: boolean) => (brush.erase = v) },
            { type: "button", name: "clear", x: 170, y: 40, width: 80, height: 14, text: "Clear", onClick: () => brush.clear() },
            { type: "label", x: 10, y: 62, width: 170, height: 12, text: "Fill with (e.g. 'dense pine forest'):" },
            { type: "button", name: "editPrompt", x: 190, y: 60, width: 60, height: 14, text: "Edit...", onClick: editPrompt },
            textAreaWidget({ name: "prompt", x: 10, y: 76, width: 240, get: () => prompt, colour: () => win?.colours[1] ?? 1 }),
            { type: "checkbox", name: "auto", x: 10, y: 96 + DY, width: 240, height: 12, text: "Send when I release the mouse", isChecked: true, onChange: (v: boolean) => (autoSend = v) },
            { type: "label", name: "count", x: 10, y: 112 + DY, width: 150, height: 12, text: "" },
            { type: "button", name: "fill", x: 170, y: 110 + DY, width: 80, height: 16, text: "Fill", onClick: () => submit(brush.selected()) },
            { type: "label", name: "status", x: 10, y: 132 + DY, width: 240, height: 12, text: status },
            { type: "label", name: "req0", x: 10, y: 148 + DY, width: 240, height: 12, text: "" },
            { type: "label", name: "req1", x: 10, y: 160 + DY, width: 240, height: 12, text: "" },
            { type: "label", name: "req2", x: 10, y: 172 + DY, width: 240, height: 12, text: "" },
            { type: "label", name: "server", x: 10, y: 190 + DY, width: 240, height: 12, text: serverLine() },
        ],
        onClose: () => {
            unsubscribe();
            brush.dispose();
            win = null;
        },
    });
    brush.activate();
    update();
}

/** Entrées du menu des plugins (seulement avec une interface : pas en `host --headless`). */
export function registerStyleTools(): void {
    if (typeof ui === "undefined") return;
    ui.registerMenuItem("Style Picker", openStylePicker);
    ui.registerMenuItem("Magic Fill Tool", openMagicFill);
}
