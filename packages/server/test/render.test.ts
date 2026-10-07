import { PNG } from "pngjs";
import { describe, expect, it } from "vitest";
import type { RegionTile } from "@openrct2-claude/protocol";
import { downscalePng, renderPngMap } from "../src/render/pngmap.js";
import { renderTextMap } from "../src/render/textmap.js";

const get = (x: number, y: number): RegionTile => ({
    h: 7 + (x > 3 ? 1 : 0),
    s: 0,
    w: y === 0 ? 9 : 0,
    t: 0,
    o: x === 0 ? 0 : 1,
    ...(x === 2 ? { p: [{ l: 7, q: 0, e: 0b1010, sd: -1, r: -1, a: -1 }] } : {}),
});

describe("carte texte", () => {
    it("une lettre par tuile, règle et légende", () => {
        const m = renderTextMap({ x1: 0, y1: 0, x2: 9, y2: 3 }, get, "overview", []);
        const lines = m.text.split("\n");
        expect(lines).toHaveLength(5);
        expect(lines[2]).toMatch(/^ {2}1 ,\.#\.{7}$/);
        expect(lines[1]).toContain("~");
        expect(m.legend.join(" ")).toContain("chemin");
    });
    it("couche hauteur relative au minimum", () => {
        const m = renderTextMap({ x1: 0, y1: 1, x2: 5, y2: 1 }, get, "height", []);
        expect(m.text.split("\n")[1].trim()).toBe("1 000011");
    });
});

describe("carte PNG", () => {
    it("produit un PNG aux bonnes dimensions", () => {
        const buf = renderPngMap({ x1: 0, y1: 0, x2: 15, y2: 7 }, get, [], { tilePx: 10 });
        const png = PNG.sync.read(buf);
        expect(png.width).toBe(16 + 16 * 10);
        expect(png.height).toBe(16 + 8 * 10);
    });
    it("réduit une image trop grande", () => {
        const big = new PNG({ width: 3200, height: 100 });
        const out = downscalePng(PNG.sync.write(big), 1568);
        expect(out.width).toBeLessThanOrEqual(1568);
    });
});
