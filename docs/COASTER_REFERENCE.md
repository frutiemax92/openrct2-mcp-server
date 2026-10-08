# Imiter un circuit de référence : ce qui manque au serveur

> Rédigé le 7 octobre 2026, après plusieurs essais pour construire un circuit « dans le style de Frightmare » (ride 5 du parc « Six Flags »). Complète SPEC 12.6 à 12.9.

## 1. Constat

Résultat du meilleur essai, comparé à la référence mesurée avec `coaster_test` :

| | Frightmare (référence) | Nightmare Frenzy (meilleur essai) |
|---|---|---|
| Excitation / intensité / nausée | **7,40** / 7,82 / 4,63 | **6,83** / 7,34 / 3,75 |
| Longueur / durée | 1140 m / 79 s | 749 m / 70 s |
| Vitesse moyenne | ≈ 14,4 m/s | ≈ 10,7 m/s |
| Inversions / chutes | 5 / 6 | 4 / 6 |
| Emprise / densité | 24×17 / 0,50 | 28×19 / 0,24 |
| Pièces / tuiles de piste | 112 / 205 | 89 / 128 |

Les essais successifs ont échoué pour des raisons différentes :

1. Lift replié en virage, petite boucle, hélice serrée : aucune lecture de la référence, aucune grande inversion dans les macros.
2. Zero-g roll au ras du sol (intensité 14,6, 5,5 G) : aucune notion de vitesse.
3. Sommet du tire-bouchon à 28 km/h : seule la vitesse d'entrée était contrôlée.
4. Circuit propre mais trop court, et intérieur de l'emprise vide : rien ne dit *quoi* changer pour gagner de l'excitation.

Les trois premiers défauts sont corrigés (`coaster_describe`, macro `inversion`, modèle de vitesse, fenêtres d'entrée et de sommet). Le quatrième reste ouvert. Le serveur donne à Claude des notes finales, mais pas les leviers qui les produisent. Pour approcher la référence, Claude a dû écrire hors du serveur un simulateur et un chercheur de variantes, et lire `RideRatings.cpp` à la main.

### Suite : Nightmare Frenzy retouché avec P1 et P2 (7 octobre 2026)

Guidé par `coaster_compare`, sans toucher au lift ni à la première moitié du circuit :

| Étape | Changement | Excitation / intensité / nausée | Écart à Frightmare |
|---|---|---|---|
| départ | | 6,83 / 7,34 / 3,75 | −0,57 |
| 1 | Descente après le frein de bloc : spirale de 4 virages en pente de 3 tuiles → 2 tours d'hélice serrée empilée (4 pièces), puis un virage incliné en pente | 7,06 / 7,23 / 3,64 | −0,34 |
| 2 | Fin de parcours : un tour d'hélice serrée (2 pièces) avant les freins, à 39-49 km/h | 7,12 / 7,26 / 3,81 | −0,28 |
| 3 | Un deuxième tonneau à la place de la droite de 5 tuiles (5 inversions) | **7,24 / 7,53 / 3,98** | **−0,16** |

Ce que l'empilement a rapporté : +0,14 de proximité (piste au-dessus d'elle-même : 0 → 4 compteurs), +0,09 d'hélices, +0,11 d'inversion. L'écart restant vient surtout de la vitesse moyenne (18 contre 25 mph, −0,13). Le frein de bloc à mi-parcours fait retomber le train à 22 km/h, et Frightmare n'en a pas. L'emprise reste 28×19 (1,3 fois celle de la référence). Checkpoint : `nf-724`.

## 2. Ce que le serveur donne aujourd'hui, et ce qui a manqué

| Besoin | Aujourd'hui | Ce qui a manqué |
|---|---|---|
| Comprendre la référence | `coaster_describe` : séquence de pièces, hauteurs, vitesses estimées ; `coaster_test` : vitesses et G mesurés par pièce | Une vue **spatiale** (plan et élévation), un découpage en **éléments** avec leur rôle, l'endroit où la piste se croise elle-même |
| Savoir pourquoi la note est basse | Notes finales, vitesse max et moyenne, durée, longueur, G, chutes (API `Ride`) | La **décomposition** de l'excitation en ses composantes |
| Comparer à la référence | Rien : comparaison faite à la main | Un rapport côte à côte, écart par composante |
| Placer les éléments au bon endroit | Fenêtres de vitesse, `speeds` par macro | Le volume libre (où empiler), le dégagement réel des pièces inversées, la prédiction des G |
| Assembler une section qui retombe sur la station | Fermeture A* (sans inversions ni contrainte de vitesse), `dryRun` | Une **recherche de variantes sous contraintes** (géométrie, vitesse, emprise, collisions) |
| Garder un état fiable | Lecture du circuit à chaque appel | La détection d'un parc rechargé, un modèle versionné |

## 3. Informations et outils à ajouter, par priorité

### P1. Décomposition de la note (`coaster_rating_breakdown`) — fait

> **Fait (7 octobre 2026).** Mesuré en jeu, recalcul exact sur les trois notes : Frightmare 7,40 / 7,82 / 4,63 (jeu 7,40 / 7,82 / 4,63), Nightmare Frenzy 6,83 / 7,34 / 3,75 (jeu identique). Mise en œuvre :
>
> - `tools/gen-tables.mjs` génère `protocol/src/generated/rideRatings.ts` : `RatingsData` de chaque type (base, modificateurs, seuils), hauteurs (`clearanceHeight`, `vehicleZOffset`), drapeau `hasAirTime`, rangs de `RideFlag` et `RideEntryFlag`.
> - `planners/ratings.ts` reproduit `RideRatings.cpp` à l'entier près (saturation de `RideRatingsAdd`, exigences ÷ 2 levées par les inversions, pénalité d'intensité, multiplicateurs de l'objet, temps en l'air). Virages, inversions (`normalToInversion`), hélices et chutes sont recomptés sur les pièces comme `Vehicle::UpdateMeasurements`. Cela inclut une bizarrerie : la pièce qui termine un virage n'en commence pas un autre, donc un virage gauche suivi d'un virage droit ne compte qu'un virage.
> - Méthode `track.rating_scan` du plugin : compteurs de proximité calculés sur les éléments réels de la carte (comme `ride_ratings_score_close_proximity`), abri de chaque bloc (`TrackGetIsSheltered`, ou sous terre), scénerie autour de la station, voitures par train, multiplicateurs de l'objet.
> - L'API donne les vitesses en mph entiers. Le jeu compte en crans de `velocity >> 16` (2,25 mph). Le serveur essaie les crans compatibles et garde celui qui retombe sur les trois notes.
> - `coaster_test` et `coaster_describe { ride }` renvoient `rating` ; `coaster_rating_breakdown { ride }` le donne sans nouvel essai. Chaque terme indique sa valeur d'entrée, son plafond et ses sous-parts. `levers` chiffre l'effet marginal de variations types.
> - Limite : l'abri est estimé bloc par bloc, alors que le jeu le mesure à chaque tick. Il ne pèse rien sur ces deux circuits.
>
> Correction des chiffres ci-dessous, lus avant le calcul exact : la vitesse moyenne pèse environ 4,4 centièmes **par cran de 2,25 mph** (environ 5 avec le multiplicateur du véhicule), et non par mph. Une inversion vaut +0,12 ; l'écart de vitesse moyenne avec Frightmare (18 → 25 mph) ne vaut que +0,13.

**Pourquoi.** L'écart de 0,57 avec Frightmare ne se lit pas dans les notes. En lisant `RideRatings.cpp`, on trouve que la vitesse moyenne pèse environ 4,4 centièmes par mph (≈ +0,37 d'écart ici), chaque inversion ≈ +0,11 (jusqu'à 6), chaque pièce qui touche le sol jusqu'à 70 pièces, et la longueur seule ≈ +0,05. Sans ces chiffres, Claude allonge la piste au lieu d'accélérer le train.

**Quoi.** Pour un circuit testé, renvoyer chaque terme de l'excitation (et de l'intensité), avec sa valeur, son plafond et la marge restante. Pour twister_rc (`TwisterRollerCoaster.h`, `RatingsData`) :

- base, longueur, durée (plafond 150 s), vitesse max, **vitesse moyenne** ;
- G (bonus et pénalité latérale) ;
- virages : nombre de virages plats, inclinés et en pente par longueur (1, 2, 3+ éléments), **hélices** (plafond 9) et **inversions** (plafond 6) ;
- chutes : nombre (plafond 9) et plus haute chute ;
- abri, **proximité** (sol touché, propre piste au-dessus et au-dessous, chemins, eau), scénerie ;
- exigences non remplies (pénalités ÷ 2).

**Comment.**

- Ce que l'API `Ride` expose déjà : `maxSpeed`, `averageSpeed`, `rideTime`, `rideLength`, G, `totalAirTime`, `numDrops`, `highestDropHeight`.
- Ce qu'elle n'expose pas : `numInversions`, `numHelices`, comptes de virages (`turnCountDefault/Banked/Sloped`), `shelteredLength`, scores de proximité. On peut :
  1. recompter côté serveur à partir des pièces (`isInversion`, `isHelix`, groupes de virages consécutifs, comme `GetTurnCount*` dans `RideRatings.cpp`) ;
  2. estimer la proximité depuis le cache de carte (bloc de piste à la hauteur du sol, piste propre à moins de 10 unités au-dessus ou au-dessous, etc., `ride_ratings_score_close_proximity`) ;
  3. reproduire la formule avec les coefficients du `RatingsData` du type (à générer dans `tools/gen-tables.mjs`, comme les autres tables) et vérifier qu'on retombe sur la note du jeu à ±0,1.
- Ajouter le tableau à `coaster_test` (sur le circuit testé) et à `coaster_describe` (estimation, pour la référence).

### P2. Comparaison à la référence (`coaster_compare { ride, reference }`) — fait

> **Fait (7 octobre 2026).** `coaster_compare` teste d'abord la référence, puis le circuit, s'ils n'ont pas de mesure pour leur forme actuelle. Les mesures sont gardées par attraction avec l'empreinte du circuit (nombre de pièces + hachage), dans `<dossier utilisateur>/claude-coaster-measures.json` ; `retest: true` force un essai. Réponse : notes et écarts, écart d'excitation par composante au grain le plus fin (sous-parts des virages, G, chutes, proximité, abri), emprise, densité, longueur, durée, vitesses, profil de vitesse tous les 10 % de la longueur, G par cinquième du parcours, suite des éléments, et les trois leviers qui rapportent le plus.
>
> Mesuré, Nightmare Frenzy contre Frightmare (écart −0,57) : « +0,15 : piste qui touche sa propre piste au-dessus/au-dessous 0 → 13 ; +0,13 : vitesse moyenne 18 mph → 25 mph ; +0,13 : hélices 0 → 9 pièces ». Suivent l'inversion manquante (+0,11), la longueur (+0,05) et la durée (+0,04). Les G négatifs de Nightmare Frenzy lui rapportent 0,16 de plus que Frightmare, et le passage au-dessus de sa station 0,07 de plus. Le diagnostic chiffre le constat de P3 : l'écart vient surtout d'une piste qui ne s'empile pas sur elle-même et ne fait pas d'hélice, plus que de la longueur.

**Pourquoi.** Chaque essai a été comparé à Frightmare de mémoire, et une fois aux valeurs du `.td6` au lieu des mesures. L'utilisateur a dû rappeler de tester la référence d'abord.

**Quoi.** Teste la référence si elle n'a pas de mesures récentes. Puis met côte à côte : notes, composantes P1 avec l'écart, emprise, densité, longueur, durée, vitesse moyenne, profil de vitesse le long du parcours (en fraction de la longueur), G par section, éléments. Conclut par les trois leviers qui rapportent le plus (« +0,37 : vitesse moyenne 23,7 → 32 mph ; +0,11 : une inversion de plus ; … »).

**Comment.** Garder les mesures de `coaster_test` par attraction (profil, composantes, date, empreinte du circuit) dans l'état du serveur pour ne pas retester inutilement.

### P3. Lecture spatiale et découpage en éléments de la référence

**Pourquoi.** La densité de Frightmare (0,50) vient d'une piste qui s'enroule sur elle-même : spirales empilées, passages sous le lift, tout l'intérieur occupé. Notre circuit laissait vide un rectangle d'environ 15×14 tuiles en son centre. La séquence textuelle de `coaster_describe` ne montre ni où les éléments sont posés ni où la piste se croise.

**Quoi.**

- `coaster_describe` renvoie une **image** (plan, couleur = niveau, numéros d'éléments) et une **élévation dépliée** (hauteur et vitesse en fonction de la distance parcourue), comme `get_region_map { format: png }`.
- Découpage en **éléments** : lift, première chute, chaque inversion, virage, hélice, colline, section de freins, avec le rôle, l'emprise, les niveaux d'entrée et de sortie, la vitesse d'entrée et le minimum mesurés.
- Liste des **croisements** (tuiles où la piste passe au-dessus d'elle-même, écart en niveaux) et des **zones vides** dans l'emprise.

**Comment.** Tout se calcule à partir des pièces et de `pieceElements`. Le découpage reprend `elementKind`.

> **En cours (7 octobre 2026).** Découpage en éléments, croisements, plus grand vide et volume libre calculés par `planners/space.ts` (COASTER_SPACE.md, étape 1) ; Frightmare et Nightmare Frenzy redonnent les chiffres de COASTER_SPACE.md section 1. Reste à les exposer dans `coaster_describe` et `coaster_compare`, avec l'image du plan (étape 2).

### P4. Recherche de section sous contraintes (`coaster_search_section`)

**Pourquoi.** C'est ce qui a le plus fait avancer le circuit, mais Claude l'a écrit à la main hors du serveur (`test/_plan.tmp.ts`, puis une recherche sur environ 1000 variantes). Exemples : trouver la longueur de droite et la hauteur de chute qui ramènent exactement sur la station, rejeter les variantes qui sortent de l'emprise ou entrent trop vite dans une inversion. Avec `dryRun` seul, chaque essai coûte un appel et les échecs de géométrie arrivent un par un.

**Quoi.** Entrée : un gabarit de macros avec des paramètres variables (`{op:'straight', length:'?0..6'}`, `{op:'turn', size:['medium','large']}`…), une pose de départ (bout du circuit) et d'arrivée (station, ou une pose libre), une emprise permise et des contraintes (pas de collision, niveau minimal, toutes les fenêtres de vitesse respectées, nombre minimal d'inversions). Sortie : les N meilleures variantes classées (avertissements, longueur, vitesse moyenne simulée, emprise), prêtes à passer à `coaster_build_plan`.

**Comment.** Énumération bornée (quelques milliers de compilations : `compileMacros` + `Occupancy` + `simulate` prennent quelques millisecondes chacun), puis validation de la meilleure par `queryAction`. C'est une généralisation de la fermeture A*, qui ne connaît ni les inversions ni la vitesse.

### P5. Physique plus fidèle : G prédits, meilleures mesures

**Pourquoi.** Le modèle de vitesse fait 5 à 6 km/h d'écart moyen, mais rate les sommets d'inversion : il prédit 41 km/h au sommet du grand tire-bouchon, le jeu en mesure 28. Les G ne sont pas prédits du tout : l'intensité de 14,6 n'a été vue qu'après l'essai.

**Quoi et comment.**

- **G par pièce** : le jeu calcule `G = gravité + |v| × 98 / facteur` avec un facteur vertical et latéral par pièce (`verticalFactor` et `lateralFactor` dans `ride/ted/*.h` et `TrackData.cpp`, fonctions de `track_progress`). Les extraire dans `data/track_segments.json` par `tools/gen-tables.mjs` (constantes et formules simples), puis prédire les G de chaque pièce avec la vitesse du modèle. Avertir au-delà des seuils de `coaster_test` (5 G verticaux, 2,8 latéraux) et estimer l'intensité.
- **Mesures** : à vitesse 4, une frame couvre 4 ticks. Des pièces courtes n'ont aucun relevé (`@?`), et la « vitesse d'entrée » tombe n'importe où dans la pièce. Relever aussi `trackProgress` (position dans la pièce) ou mesurer à vitesse 1 sur un tour, pour avoir la vraie vitesse d'entrée et le vrai minimum.
- **Correction par genre d'élément** : caler un écart par `elementKind` (sommet d'inversion surtout) à partir des mesures, au lieu d'un seul `invExtra` global. La recherche sur grille l'a ramené à 0, faute de mieux.
- Ajouter les vitesses min et max mesurées au calage (aujourd'hui seule la vitesse d'entrée sert).

### P6. Dégagement réel et volume libre

**Pourquoi.** La sortie de l'Immelmann en (36,118) a été refusée par le jeu alors que le contrôle du serveur (2,5 niveaux d'écart) la laissait passer : une pièce inversée occupe plus de hauteur. Il a fallu exclure à la main x < 37.

**Quoi et comment.**

- ~~Exporter la hauteur de dégagement de chaque bloc (`clearanceZ` des séquences TED) dans la table des segments, et l'utiliser dans `Occupancy` et `blockProblem`.~~ **Fait pour `Occupancy` (7 octobre 2026).** `gen-tables.mjs` génère `TRACK_BLOCK_CLEARANCE` et `TRACK_BLOCK_VERTICAL`, en contrôlant que les positions des blocs sont identiques à `data/track_segments.json` (350 pièces). Le conflit suit `TrackPlaceAction` et `MapCanConstructWithClearAt` : chaque bloc occupe [base arrondie à 8, base + clearanceZ + dégagement du véhicule[, plafonné à 24 pour les blocs verticaux, et deux blocs se gênent si leurs intervalles se chevauchent. Les quarts de tuile restent ignorés, donc le contrôle reste prudent. Effet mesuré : une hélice serrée descendante passe désormais 2 niveaux sous une droite, ce qui était refusé avec l'ancien écart fixe de 2,5 niveaux. Reste : `blockProblem` (terrain, chemins) ne connaît toujours pas le dégagement.
- Une couche de carte « volume libre » : pour chaque tuile de l'emprise, les intervalles de niveaux libres compte tenu du circuit. Elle sert à empiler (gagner de la densité) et à trouver l'intérieur inoccupé (voir P3).

### P7. Éléments manquants dans les macros

**Pourquoi.** Frightmare utilise des pièces que les macros n'exposent pas. Exemples : `rightLargeHalfLoopUp` suivi de `invertedFlatToDown90QuarterLoop` (plongée verticale), `up60ToUp90` → `up90ToInvertedFlatQuarterLoop` (quart de boucle), virages d'1 tuile à 90°, grandes courbes inclinées en pente par la diagonale. On peut les poser avec `piece{name}`, mais sans vitesse ni fenêtre propres et avec des transitions à deviner.

**Quoi.** Macros `vertical_drop{height}`, `quarter_loop{dir}` (montée verticale vers l'envers, puis sortie en tire-bouchon ou en demi-boucle), `dive{dir}` (demi-boucle vers la chute verticale), `swoop{dir, quarters}` (huitièmes inclinés enchaînés au ras du sol), `helix` montante (existe, à documenter), et `turn size:'large'` en pente.

### P8. Fiabilité de l'état entre les appels

**Pourquoi.** Pendant les essais, le parc a été rechargé deux fois depuis une ancienne sauvegarde, sans que le serveur le signale. Claude a retiré 66 puis 40 pièces d'un circuit qui n'était plus celui qu'il croyait. Autre cas : un serveur MCP pas encore redémarré, donc avec l'ancien code, a écrasé deux fois le calage du modèle de vitesse.

**Quoi et comment.**

- Empreinte du circuit (nombre de pièces + hachage) dans chaque réponse `coaster_*`. Avertir si elle diffère de la dernière vue par ce serveur, et si la date du jeu a reculé (parc rechargé).
- Fichier de calage versionné (`version`, `serverVersion`, méthode d'ajustement). Refuser d'écrire avec une méthode plus ancienne que celle du fichier.
- `session_info` : version du code serveur chargé et date de compilation de `dist/`, pour savoir si un `/mcp` est nécessaire.

## 4. Ordre de mise en œuvre et critère de réussite

| Étape | Contenu | Effet attendu |
|---|---|---|
| 1 | P1 décomposition + P2 comparaison — **fait** | Claude sait quel levier tirer et de combien (recalcul exact sur Frightmare et Nightmare Frenzy) |
| 1 bis | Compacité : mesures d'espace (calcul fait), `bounds`, fin de P6 ([COASTER_SPACE.md](COASTER_SPACE.md)) | Claude voit qu'un élément est isolé et construit dans l'emprise de la référence |
| 2 | P4 recherche de section, avec les objectifs d'espace de COASTER_SPACE.md | Plus de scripts hors serveur ; fermetures exactes sous contraintes |
| 3 | P3 vue spatiale et éléments | Remplir l'intérieur, empiler comme la référence |
| 4 | P5 G prédits + mesures fines | Plus de surprise d'intensité après l'essai |
| 5 | P6 dégagement, P7 macros, P8 état | Moins de refus du jeu ; éléments de la référence disponibles |

**Critère** : partant d'une zone libre et de la seule consigne « dans le style de Frightmare », Claude construit en moins de 40 appels d'outils un circuit du même type qui obtient :

- une excitation à 0,3 près de la référence mesurée ;
- une intensité sous 8 ;
- une emprise d'au plus 1,2 fois celle de la référence ;
- une seule chaîne de levage ;
- aucun élément hors de sa fenêtre de vitesse.

Le scénario est à ajouter à SPEC 15.2 (tâches d'évaluation).
