#!/usr/bin/env node
// Lance le faux plugin sur un port (défaut 38491) pour tester le serveur MCP sans le jeu :
//   OPENRCT2_TOKEN=xyz node fake-plugin/dist/cli.js [--port 38491] [--user-dir /tmp/fake-openrct2]
import { FakePlugin } from "./server.js";

const arg = (name: string) => {
    const i = process.argv.indexOf(name);
    return i >= 0 ? process.argv[i + 1] : undefined;
};

const plugin = new FakePlugin({
    port: Number(arg("--port") ?? process.env.OPENRCT2_PORT ?? 38491),
    token: process.env.OPENRCT2_TOKEN ?? "fake-token-0123456789abcdef",
    userDir: arg("--user-dir") ?? process.env.OPENRCT2_USER_DIR,
});
plugin.start().then((port) => console.error(`[fake-plugin] écoute sur 127.0.0.1:${port}, jeton ${plugin.token}`));
