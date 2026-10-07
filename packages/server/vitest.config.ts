import { defineConfig } from "vitest/config";
export default defineConfig({
    test: {
        include: ["test/**/*.test.ts"],
        exclude: process.env.OPENRCT2_INTEGRATION ? [] : ["test/integration/**"],
        testTimeout: 20_000,
    },
});
