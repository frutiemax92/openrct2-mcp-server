# Environnement

> Relevé le 7 octobre 2026. Voir `docs/SPIKES.md` pour les mesures.

## Versions

| Élément | Valeur |
|---|---|
| OpenRCT2 | `v0.5.5-155-gc4aea2c72e` (`develop`), compilé dans `../build/` (`openrct2`, `openrct2-cli`) |
| Version réseau | `0.5.5-2` |
| `context.apiVersion` | **124** (= `minApiVersion` et `targetApiVersion` du plugin) |
| Moteur JS | QuickJS-NG (ADR 0001) |
| Node.js | 22.23 (≥ 20 exigé) |
| pnpm | 10.18.0, via `corepack pnpm` si `pnpm` n'est pas dans le `PATH` |
| OS de test | Linux x86-64, X11 |

## Chemins (Linux)

| Quoi | Chemin |
|---|---|
| Dossier utilisateur du jeu (par défaut) | `$XDG_CONFIG_HOME/OpenRCT2` ou `~/.config/OpenRCT2` |
| Dossier utilisateur de développement | `.userdata/` à la racine du dépôt (ignoré par git), créé par `pnpm game` |
| Plugins | `<dossier utilisateur>/plugin/` (vérifié) |
| Captures | `<dossier utilisateur>/screenshot/` (vérifié ; **doit exister**, le serveur le crée) |
| Sauvegardes et checkpoints | `<dossier utilisateur>/save/` ; checkpoints `claude-<nom>.park`, métadonnées (journal, zones) dans `save/claude-meta/` |
| Designs de montagnes russes (`.td6`/`.td7`) | `<game_path>/Tracks`, `<dossier utilisateur>/track/`, plus `OPENRCT2_TRACKS_DIR` (dossiers séparés par `:`) |
| Recettes de scénerie | `data/recipes/<thème>.json` (lues au démarrage du serveur) |
| Jeton du pont | `<dossier utilisateur>/plugin.store.json` → `{"claude-bridge":{"token":"…"}}` |
| Données OpenRCT2 d'un build CMake non installé | `../build/usr/local/share/openrct2` (passées par `--openrct2-data-path`) |
| Fichiers RCT2 | `game_path` du `config.ini` (ou `OPENRCT2_RCT2_PATH`) |

## Lancer le jeu pour le développement

```sh
corepack pnpm install
corepack pnpm build
node tools/game.mjs "<chemin>/Scenarios/Build your own Six Flags Park.SC6"
```

`tools/game.mjs` :
- crée `.userdata/` avec un `config.ini` minimal (`game_path` repris du `config.ini` personnel) ;
- impose `enable_hot_reloading = true` et **`use_vsync = false`** ;
- copie `packages/plugin/dist/claude-bridge.js` dans `.userdata/plugin/` ;
- lance `../build/openrct2 <parc> --user-data-path=.userdata --openrct2-data-path=…`.

Variables : `OPENRCT2_BIN`, `OPENRCT2_USER_DIR`, `OPENRCT2_RCT2_PATH`, `OPENRCT2_DATA_PATH`. Le serveur lit aussi `OPENRCT2_RCT2_PATH` (sinon `game_path` du `config.ini`) et `OPENRCT2_TRACKS_DIR` pour trouver les designs.

Pour le serveur MCP, pointer sur le même dossier : `OPENRCT2_USER_DIR=$PWD/.userdata`.

## Particularités à connaître

- **vsync** : avec `use_vsync = true` et une fenêtre de jeu masquée ou sur un autre bureau, toute la boucle du jeu tombe à ~1 image/s et chaque requête prend 1 s. Garder `use_vsync = false` (ou la fenêtre visible) si l'on utilise son propre `config.ini`.
- **Hot reload** : actif en mode fenêtre (le plugin se recharge et réécoute sur le même port) ; inactif en `host --headless`.
- **`openrct2-cli screenshot`** n'accepte pas les options globales (`--user-data-path`…) : il lit toujours le dossier utilisateur par défaut.
- **`load_park`** (checkpoints) ne déclenche pas les hooks `map.change`/`map.changed` ; le plugin émet `map_changed` lui-même.
- **Mode headless** (`host --headless`) : pas de captures ni de modification directe ; `saveGame` échoue, le plugin se replie sur `save_park`.

## Commandes utiles

| Commande | Rôle |
|---|---|
| `corepack pnpm test` | Tests unitaires et de bout en bout contre le faux plugin |
| `OPENRCT2_USER_DIR=$PWD/.userdata OPENRCT2_INTEGRATION=1 npx vitest run test/integration` (dans `packages/server`) | Tests contre le vrai jeu (jeu ouvert requis), Phases 1 et 2 ; le parc est restauré à la fin |
| `OPENRCT2_USER_DIR=$PWD/.userdata pnpm install:plugin` | Recompile le plugin et le copie dans `.userdata/plugin/` (rechargé à chaud par le jeu ouvert) |
| `OPENRCT2_USER_DIR=$PWD/.userdata OPENRCT2_INTEGRATION=1 npx vitest run test/integration/coaster.test.ts` (dans `packages/server`) | Critère « Montagnes russes » : 10 circuits construits, testés et démolis (~90 s ; zone plate de 30×30 autour de `OPENRCT2_IT_COASTER_AREA`, défaut 50,40) |
| `node tools/export-segments.mjs` | Réexporte `data/track_segments.json` depuis le jeu ouvert (après une mise à jour d'OpenRCT2) |
| `node tools/gen-tables.mjs` | Régénère les tables tirées du C++ (arguments d'actions, types d'attractions et groupes de pièces, `TrackElemType`, cheats) |
| `node tools/spike.mjs .userdata hello` | Handshake brut avec le plugin |
| `node tools/spike.mjs .userdata s9` | Mesures de performance |
| `node packages/server/scripts/mcp-run.mjs '[["session_info",{}]]' [dossier-images]` | Appels d'outils MCP comme le ferait Claude |
