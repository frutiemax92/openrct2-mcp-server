# OpenRCT2 MCP Server

An [MCP](https://modelcontextprotocol.io) server that lets an AI assistant (Claude Code, GitHub Copilot, …) build
parks in a running OpenRCT2 game: terrain, paths, rides, roller coasters, scenery, plus the in-game **Style Picker**
and **Magic Fill Tool**.

It works without forking OpenRCT2. A plugin (`claude-bridge.js`) runs inside the game and listens on
`127.0.0.1`. The MCP server talks to the assistant over stdio and to the plugin over TCP.

```
AI assistant ──stdio──▶ MCP server (Node) ──TCP 127.0.0.1:38491──▶ claude-bridge.js (OpenRCT2 plugin)
```

## Requirements

- **OpenRCT2** with plugin API version **124** or newer (current `develop` build, v0.5.5+).
- **Node.js 20+**.
- **pnpm 10** (bundled with Node via `corepack`: run `corepack enable`, or prefix commands with `corepack`).

## Repository layout

| Path | Contents |
|---|---|
| `packages/plugin` | The OpenRCT2 plugin (TypeScript, bundled to a single ES2020 script) |
| `packages/server` | The MCP server (stdio) |
| `packages/protocol` | Messages and tables shared by the plugin and server |
| `fake-plugin` | A simulated game used by the tests |
| `docs/` | Specification (`SPEC.md`), environment notes (`ENV.md`), design docs |

## 1. Build

```sh
git clone https://github.com/frutiemax92/openrct2-mcp-server.git
cd openrct2-mcp-server
corepack pnpm install
corepack pnpm build
```

This produces:

- `packages/plugin/dist/claude-bridge.js`: the game plugin
- `packages/server/dist/index.js`: the MCP server

Run the tests with `corepack pnpm test`. They use the fake plugin and don't need the game.

## 2. Install the plugin

Copy `claude-bridge.js` into the `plugin` folder of your OpenRCT2 user directory:

| OS | Plugin folder |
|---|---|
| Linux | `~/.config/OpenRCT2/plugin/` (or `$XDG_CONFIG_HOME/OpenRCT2/plugin/`) |
| macOS | `~/Library/Application Support/OpenRCT2/plugin/` |
| Windows | `Documents\OpenRCT2\plugin\` |

The script below builds the plugin and copies it there for you:

```sh
corepack pnpm install:plugin
```

If you use a different user directory (for example, if you start the game with `--user-data-path`), set
`OPENRCT2_USER_DIR` first:

```sh
OPENRCT2_USER_DIR=/path/to/OpenRCT2 corepack pnpm install:plugin
```

Then start OpenRCT2 and open a park or scenario. On first load, the plugin:

1. generates a random access token and saves it in `<user dir>/plugin.store.json`;
2. starts listening on `127.0.0.1:38491`.

The MCP server reads the token from that file automatically, so you have nothing to copy by hand. With hot reloading
enabled in the game (`enable_hot_reloading = true` in `config.ini`), rerunning `install:plugin` reloads the plugin
in the running game.

The plugin also adds two entries to the game's plugin menu:

- **Style Picker**: paint a region, give it a caption, and save it as a style for the assistant to reuse.
- **Magic Fill Tool**: paint a region and write a prompt ("a river zigzagging through hills"). The assistant fills
  the region from your saved styles.

## 3. Connect the MCP server

The server is a stdio program: `node <repo>/packages/server/dist/index.js`. Use the **absolute path** in the
configurations below. The game must be running with a park loaded when the assistant calls the tools.

### Environment variables (all optional)

| Variable | Default | Purpose |
|---|---|---|
| `OPENRCT2_USER_DIR` | OS default (see above) | OpenRCT2 user directory: token, screenshots, saves, styles |
| `OPENRCT2_HOST` / `OPENRCT2_PORT` | `127.0.0.1` / `38491` | Where the plugin listens |
| `OPENRCT2_TOKEN` | read from `plugin.store.json` | Override the access token |
| `OPENRCT2_STYLES_DIR` | `<user dir>/claude-styles` | Style Picker library and Magic Fill requests |
| `OPENRCT2_RCT2_PATH` | `game_path` from `config.ini` | RCT2 files (for track designs) |
| `OPENRCT2_TRACKS_DIR` | none | Extra `.td6`/`.td7` folders, separated by `:` |
| `LOG_LEVEL` | `info` | `debug`, `info`, `warn` or `error` |
| `OPENRCT2_LOG_FILE` | none | Write logs to a file (stdout is reserved for MCP) |

If you change the port, rebuild the plugin with the same `OPENRCT2_PORT` so both sides agree.

### Claude Code

```sh
claude mcp add openrct2 -- node /absolute/path/to/openrct2-mcp-server/packages/server/dist/index.js
```

To use a non-default user directory:

```sh
claude mcp add openrct2 -e OPENRCT2_USER_DIR=/path/to/OpenRCT2 -- node /absolute/path/to/openrct2-mcp-server/packages/server/dist/index.js
```

Add `--scope user` to make it available in every project. Alternatively, put a `.mcp.json` file at the root of your
project:

```json
{
  "mcpServers": {
    "openrct2": {
      "command": "node",
      "args": ["/absolute/path/to/openrct2-mcp-server/packages/server/dist/index.js"],
      "env": { "OPENRCT2_USER_DIR": "/path/to/OpenRCT2" }
    }
  }
}
```

Check the connection with `claude mcp list`, or with `/mcp` inside a session. Then try asking: *"Call session_info and
describe my park."*

### GitHub Copilot (VS Code)

Copilot uses MCP servers in **Agent** mode. Create `.vscode/mcp.json` in your workspace (or run **MCP: Add Server**
from the Command Palette):

```json
{
  "servers": {
    "openrct2": {
      "type": "stdio",
      "command": "node",
      "args": ["/absolute/path/to/openrct2-mcp-server/packages/server/dist/index.js"],
      "env": { "OPENRCT2_USER_DIR": "/path/to/OpenRCT2" }
    }
  }
}
```

Click **Start** above the server entry (or run **MCP: List Servers**), open Copilot Chat, switch to **Agent** mode,
and enable the `openrct2` tools in the tools picker. You can leave out `env` if the game uses the default user
directory.

### GitHub Copilot CLI

Add the server to `~/.copilot/mcp-config.json` (or use `/mcp add` inside the CLI):

```json
{
  "mcpServers": {
    "openrct2": {
      "type": "local",
      "command": "node",
      "args": ["/absolute/path/to/openrct2-mcp-server/packages/server/dist/index.js"],
      "env": {},
      "tools": ["*"]
    }
  }
}
```

## Troubleshooting

- **Connection refused**: the game isn't running, the plugin isn't installed in the right folder, or no park is
  loaded. The game's console (stdout) prints `[claude-bridge] v… prêt` when the plugin is ready, or a line
  explaining why it couldn't listen on the port.
- **Second client refused**: the plugin accepts one MCP server at a time. Close the other assistant session (or its
  server) before connecting a new one.
- **Invalid token**: the server is reading a different user directory than the game. Set `OPENRCT2_USER_DIR` to the
  folder that contains the `plugin.store.json` the game wrote.
- **Every call takes about a second**: with `use_vsync = true` and the game window hidden or on another desktop,
  OpenRCT2 drops to around 1 frame per second. Set `use_vsync = false` or keep the window visible.
- **Screenshots fail**: screenshots need a windowed game. They don't work with `host --headless`.

More details are in [`docs/ENV.md`](docs/ENV.md) and the full tool specification in [`docs/SPEC.md`](docs/SPEC.md)
(both in French).
