# ADR 0002 : la file de commandes est pompée par `context.setInterval`, pas par `interval.tick`

- **Statut :** accepté
- **Date :** 7 octobre 2026
- **Modifie :** SPEC 6.3 (« interval.tick → tant que budget… ») et 6.8 (« se baser sur interval.tick plutôt que sur setInterval »)

## Contexte

La spec 6.3 fait avancer la file de commandes du plugin dans le hook `interval.tick`, et la spec 6.4 recommande de construire **en pause**. Les deux sont incompatibles. Lecture du code (`develop`, `v0.5.5-155`) :

- `interval.tick` est appelé depuis la mise à jour de l'état du jeu (`GameState.cpp`, après `gameState.currentTicks++`). Cette mise à jour ne tourne pas quand le jeu est en pause. **En pause, `interval.tick` ne se déclenche pas.**
- `ScriptEngine::Tick()` est appelé à chaque `Context::Tick()` (boucle à 40 Hz, `Context.cpp`), **en pause comme hors pause** (hors écran de préchargement). Il exécute `UpdateIntervals()` (les minuteries `setInterval`/`setTimeout`) puis `UpdateSockets()` (lecture des sockets, nouvelles connexions).
- Les minuteries d'un plugin ne sont retirées que par `StopPlugin`, que `UnloadTransientPlugins` n'appelle pas pour un plugin `intransient` (F15). Elles survivent donc a priori à un changement de carte.

## Décision

1. La pompe du plugin (`frame()` dans `main.ts`) est enregistrée avec `context.setInterval(frame, 0)` : elle tourne à chaque frame de 25 ms, en pause comme hors pause.
2. À chaque frame : exécution des tâches différées (ex. `load_park`), avancement de la file (budget *K* opérations ou *T* ms), puis écriture d'une partie de la file de sortie des sockets.
3. `map.change` vide la file (réponses `BUSY`) et bloque les nouvelles requêtes ; `map.changed` réinitialise les tables d'objets et émet `map_changed`.
4. Les méthodes qui doivent attendre du temps de jeu (`time.run`) rendent la main à chaque frame (`yield NEXT_FRAME`) et lisent `date.ticksElapsed`.

## Conséquences

- La construction en pause fonctionne si `buildInPauseMode` est actif (vérifié dans `GameActionRunner.cpp`, `CheckActionInPausedMode` : sinon `Status::gamePaused`).
- La pompe dépend de la survie des minuteries d'un plugin `intransient` à `load_park`. C'est ce que vérifie le spike S3 ; en cas d'échec, le serveur se reconnecte et le plugin peut réarmer sa minuterie dans `map.changed`.
- Le débit est borné par la cadence des frames (40 Hz) et non par la vitesse du jeu : à vitesse ×4, une requête n'avance pas plus vite.
