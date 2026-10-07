# Projet : MCP Server pour OpenRCT2 (sans fork)

La spécification complète est dans docs/SPEC.md. Lis-la au début de chaque session.

Règles
- Le dépôt ../OpenRCT2 est une référence en LECTURE SEULE. N'y écris jamais.
- Source de vérité de l'API : ../OpenRCT2/distribution/scripting/openrct2.d.ts. En cas de conflit avec SPEC.md, le .d.ts gagne, et tu corriges SPEC.md.
- Exception : pour les noms d'arguments des game actions, le C++ gagne sur le .d.ts (AcceptParameters dans ../OpenRCT2/src/openrct2/actions/**). Le .d.ts se trompe pour 4 actions (SPEC.md F6).
- Phase 0 d'abord (spikes). Consigne les résultats dans docs/SPIKES.md.
- Plugin en TypeScript, bundlé en un seul script IIFE ciblant ES2020 (moteur QuickJS-NG, ES2023). Pas de modules ES ni d'Intl dans le fichier émis (ADR 0001). Pas de fork, pas de patch C++.
- Pas d'outil eval générique. Écoute TCP sur 127.0.0.1 uniquement.
