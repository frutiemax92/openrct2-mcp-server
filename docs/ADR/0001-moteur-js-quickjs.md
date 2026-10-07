# ADR 0001 : abandon de la cible ES5, le moteur de scripts est QuickJS-NG

- **Statut :** accepté
- **Date :** 7 octobre 2026
- **Remplace :** règle 0.1.6 de `SPEC.md` v1.0 (« plugin compilé vers ES5, moteur Duktape »)

## Contexte

La spec v1.0 supposait que les plugins s'exécutent sous Duktape, limité à ES5. Elle imposait donc une compilation vers ES5, l'interdiction de `let`/`const`, des fonctions fléchées, des classes et des `Promise`, ainsi que des polyfills maison.

La lecture du dépôt OpenRCT2 (`develop`, `v0.5.5-155-gc4aea2c72e`) montre que ce n'est plus vrai :

- `src/openrct2/CMakeLists.txt` compile `thirdparty/quickjs-ng/quickjs-amalgam.c`, et `ScriptEngine.cpp` utilise l'API QuickJS (`JSContext*`, `JSValue`) ;
- `distribution/scripting/scripting.md` : « OpenRCT2 uses QuickJS-NG […] which supports ES2023 ». Duktape ne concerne que les versions antérieures à v0.5.0 ;
- restent non supportés : les modules ES (`import`/`export`, les plugins sont évalués comme scripts globaux) et l'API `Intl`. Il n'y a pas de JIT.

`context.apiVersion` vaut 124 sur cette version.

## Décision

1. Le plugin est écrit en TypeScript avec `target: "ES2020"` et `lib: ["ES2020"]` (sans `DOM`). Les types viennent de `distribution/scripting/openrct2.d.ts`.
2. Le build produit **un seul fichier au format IIFE** (rollup ou esbuild), sans `import` ni `export`.
3. Un test de build échoue si le fichier émis contient `import`/`export` au niveau module ou une référence à `Intl`.
4. `registerPlugin` déclare `minApiVersion` et `targetApiVersion` égaux à la version du jeu utilisée pour le développement (124 au départ). La valeur relevée est consignée dans `docs/ENV.md`.
5. Le projet **ne supporte pas** les versions d'OpenRCT2 antérieures à v0.5.0.

ES2020 plutôt qu'ES2023 : la marge est sans coût (QuickJS-NG va au-delà) et cela évite de dépendre de fonctionnalités récentes du langage que TypeScript ou le bundler abaisseraient de façon inégale.

## Conséquences

- **Plus simple :** pas de polyfills ni de vérification « grep `=>` » du fichier émis. Le plugin et le serveur partagent le même style de code et les mêmes types (`packages/protocol`).
- **Inchangé :** le JS s'exécute toujours sur le thread du jeu, sans JIT. Le découpage par tick (spec 6.3) et le principe « plugin mince » restent nécessaires. Les API du jeu (`executeAction`, sockets, hooks) restent à base de callbacks. Les `Promise` sont disponibles pour la logique interne, mais l'ordonnancement des microtâches par rapport aux ticks n'est pas documenté : la file de commandes reste une machine à états pilotée par `interval.tick`.
- **Risque :** si un utilisateur lance une version < 0.5.0, le plugin ne se chargera pas. `minApiVersion` le signale proprement plutôt que de laisser une erreur de syntaxe.
- **Documents mis à jour :** `SPEC.md` (0.1.6, 2.1 F18/F19, 3.1, 5.1, 5.2, 6.1, 7.2, 19.1) et `CLAUDE.md`.
