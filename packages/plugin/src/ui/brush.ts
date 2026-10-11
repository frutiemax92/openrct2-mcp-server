// Pinceau de tuiles partagé par le Style Picker et le Magic Fill Tool (SPEC 13.7) : un carré de N×N tuiles qui
// peint (ou gomme) une sélection quand on fait glisser la souris sur la carte. La sélection est montrée avec
// `ui.tileSelection` (surbrillance du jeu), aperçu du pinceau compris.

import { STYLE_MAX_TILES, type TileXY } from "@openrct2-claude/protocol";

export const BRUSH_MIN = 1;
export const BRUSH_MAX = 15;

export interface BrushOptions {
    toolId: string;
    /** Appelé après chaque modification de la sélection (compteurs de la fenêtre). */
    onChange: () => void;
    /** Appelé au relâchement de la souris, avec les tuiles peintes pendant ce trait. */
    onStroke?: (stroke: TileXY[]) => void;
    /** L'outil a été désactivé (Échap, autre outil, fermeture). */
    onFinish?: () => void;
}

export class Brush {
    size = 3;
    erase = false;
    active = false;
    private tiles: { [k: string]: TileXY } = {};
    private count = 0;
    private preview: TileXY[] = [];
    private stroke: { [k: string]: TileXY } = {};
    private painting = false;

    constructor(private readonly opts: BrushOptions) {}

    get selectedCount(): number {
        return this.count;
    }

    selected(): TileXY[] {
        const out: TileXY[] = [];
        for (const k in this.tiles) out.push(this.tiles[k]);
        return out;
    }

    grow(delta: number): void {
        this.size = Math.max(BRUSH_MIN, Math.min(BRUSH_MAX, this.size + delta));
        this.opts.onChange();
    }

    clear(): void {
        this.tiles = {};
        this.count = 0;
        this.show();
        this.opts.onChange();
    }

    /** Tuiles du pinceau centré sur une tuile (taille paire : le centre est la tuile en haut à gauche du milieu). */
    private footprint(center: TileXY): TileXY[] {
        const lo = Math.floor((this.size - 1) / 2);
        const out: TileXY[] = [];
        for (let dy = -lo; dy < this.size - lo; dy++) {
            for (let dx = -lo; dx < this.size - lo; dx++) {
                const x = center.x + dx;
                const y = center.y + dy;
                if (x >= 1 && y >= 1 && x < map.size.x - 1 && y < map.size.y - 1) out.push({ x, y });
            }
        }
        return out;
    }

    private apply(center: TileXY): void {
        let touched = false;
        for (const t of this.footprint(center)) {
            const k = `${t.x},${t.y}`;
            if (this.erase) {
                if (this.tiles[k]) {
                    delete this.tiles[k];
                    this.count--;
                    touched = true;
                }
            } else if (!this.tiles[k] && this.count < STYLE_MAX_TILES) {
                this.tiles[k] = t;
                this.stroke[k] = t;
                this.count++;
                touched = true;
            }
        }
        if (touched) this.opts.onChange();
    }

    private show(): void {
        const world: CoordsXY[] = [];
        for (const k in this.tiles) world.push({ x: this.tiles[k].x * 32, y: this.tiles[k].y * 32 });
        for (const t of this.preview) world.push({ x: t.x * 32, y: t.y * 32 });
        ui.tileSelection.tiles = world;
    }

    private tileOf(e: ToolEventArgs): TileXY | null {
        if (!e.mapCoords) return null;
        return { x: Math.floor(e.mapCoords.x / 32), y: Math.floor(e.mapCoords.y / 32) };
    }

    activate(): void {
        this.active = true;
        ui.activateTool({
            id: this.opts.toolId,
            cursor: "cross_hair",
            filter: ["terrain", "water"],
            onDown: (e) => {
                const t = this.tileOf(e);
                this.painting = true;
                this.stroke = {};
                if (t) this.apply(t);
                this.show();
            },
            onMove: (e) => {
                const t = this.tileOf(e);
                this.preview = t ? this.footprint(t) : [];
                if (t && this.painting) this.apply(t);
                this.show();
            },
            onUp: () => {
                if (!this.painting) return;
                this.painting = false;
                const stroke: TileXY[] = [];
                for (const k in this.stroke) stroke.push(this.stroke[k]);
                this.stroke = {};
                this.opts.onStroke?.(stroke);
            },
            onFinish: () => {
                this.active = false;
                this.painting = false;
                this.preview = [];
                this.show();
                this.opts.onFinish?.();
            },
        });
    }

    deactivate(): void {
        if (ui.tool && ui.tool.id === this.opts.toolId) ui.tool.cancel();
        this.active = false;
    }

    /** Fermeture de la fenêtre : outil coupé, surbrillance effacée. */
    dispose(): void {
        this.deactivate();
        this.preview = [];
        ui.tileSelection.tiles = [];
    }
}
