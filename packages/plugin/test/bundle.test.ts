// Test de build (ADR 0001) : un seul script IIFE, sans import/export ni Intl.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const pkg = join(dirname(fileURLToPath(import.meta.url)), "..");

describe("bundle du plugin", () => {
    it("est un script global ES2020 conforme", async () => {
        execFileSync(process.execPath, [join(pkg, "scripts", "build.mjs")], { stdio: "pipe" });
        const code = readFileSync(join(pkg, "dist", "claude-bridge.js"), "utf8");
        const { checkBundle } = await import("../scripts/build.mjs" as string);
        expect(() => checkBundle(code)).not.toThrow();
        expect(code.trimStart().startsWith('"use strict";\n(() => {')).toBe(true);
        expect(code).toContain('type: "intransient"');
        expect(code).toContain("targetApiVersion: 124");
    });

    it("checkBundle rejette import/export et Intl", async () => {
        const { checkBundle } = await import("../scripts/build.mjs" as string);
        expect(() => checkBundle('import x from "y";\nregisterPlugin({})')).toThrow(/import/);
        expect(() => checkBundle("registerPlugin({}); new Intl.NumberFormat()")).toThrow(/Intl/);
    });
});
