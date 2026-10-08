# Compacité d'un circuit : ce que le serveur doit mesurer et imposer

> Rédigé le 7 octobre 2026, après la retouche de Nightmare Frenzy (COASTER_REFERENCE.md, « Suite »). L'excitation est passée à 0,16 de Frightmare, mais le circuit reste un anneau autour d'un intérieur vide, sur une emprise 1,3 fois plus grande. Ce document complète COASTER_REFERENCE.md (P3, P4, P6) et passe avant la suite de P4.

## 1. Constat mesuré

Mesures faites sur les deux circuits du parc (pièces gardées dans `claude-coaster-measures.json`), avec les définitions de la section 3 :

| | Frightmare (ride 5) | Nightmare Frenzy (ride 9) |
|---|---|---|
| Emprise | 24×17 = 408 tuiles | 28×19 = 532 tuiles |
| Couverture (tuiles de piste / emprise) | 45 % | 31 % |
| Tuiles empilées (la piste passe au-dessus d'une autre partie d'elle-même) | **80** | **20** |
| Plus grand rectangle vide dans l'emprise | 8×8 (16 %) | 19×6 (21 %) |
| Lift : tuiles avec de la piste dessous | 11 (écart min. 2,5 niveaux) | 0 (voisin à 3 tuiles) |
| Grande demi-boucle : voisin le plus proche | 0 tuile, 5 tuiles partagées (1,5 niveau) | 1 tuile, aucune partagée |
| Tire-bouchon : voisin le plus proche | 0 tuile, piste 10,5 niveaux dessous | 4 tuiles |
| Éléments à 0 tuile d'une autre partie du circuit | 21 sur 27 | 4 sur 14 |

Frightmare est un bloc. Presque chaque élément touche ou croise une autre partie du circuit, souvent à 1 ou 2,5 niveaux d'écart. La seconde moitié du parcours passe sous le lift, sous la première chute et à travers la boucle. Nightmare Frenzy pose ses éléments côte à côte, chacun isolé.

## 2. Pourquoi le serveur ne le voit pas

1. **Pas de lecture spatiale de la référence.** `coaster_describe` donne une séquence de pièces et des hauteurs. Il ne dit pas qui passe sous qui, à quelle distance, ni où est le vide.
2. **Pas d'objectif d'espace pendant la construction.** `coaster_build_plan` enchaîne les macros depuis le bout du circuit, comme une tortue. L'emprise et la densité ne sont données qu'après coup, sans avertissement d'élément isolé ni d'emprise dépassée. On ne peut ni dire « passe sous le lift » ni « reste dans ce rectangle ».
3. **Un contrôle de collision trop prudent.** Jusqu'au 7 octobre, le serveur imposait 2,5 niveaux d'écart entre deux blocs. Frightmare se croise à 1 et 1,5 niveau : son tracé était impossible à reconstruire. C'est corrigé pour l'essentiel (dégagement réel par bloc, `TRACK_BLOCK_CLEARANCE`). Les quarts de tuile occupés restent ignorés, si bien que certains croisements acceptés par le jeu sont encore refusés.
4. **Une recherche de section sans critère d'espace.** P4 prévoit de fermer une section sous contraintes de géométrie et de vitesse, mais ne cherche ni à croiser le circuit existant ni à rester compact.

## 3. Mesures à calculer (`planners/space.ts`, fonctions pures)

Toutes se calculent à partir des pièces (`pieceElements`, `TrackBlock` avec `cz`) et, pour le vide et le volume libre, du cache de carte. Unités : tuiles, niveaux (16 unités monde).

> **Fait (7 octobre 2026), étape 1.** `planners/space.ts` : `spaceElements`, `spaceProfile`, `largestEmptyRect`, `freeVolume`, `isClosed` ; tests dans `test/space.test.ts`. `tools/space-analysis.mjs` appelle désormais `spaceProfile` (sur les mesures gardées, ou sur des `.td6` passés en argument). Mesuré : Frightmare (ride 5, en jeu `112:a707f934`, et `Frightmare.TD6`) et Nightmare Frenzy (ride 9, `87:464ee5d4`) donnent exactement les chiffres de la section 1. Le `.td6` a les mêmes 112 pièces que le circuit du parc ; il commence 3 pièces plus tôt dans la boucle, d'où des indices décalés de 3.

**Éléments.** Découper le circuit en éléments : lift (pièces à chaîne), station, freins, puis chaque suite de pièces du même genre (`elementKind`, sans le côté ni le préfixe `banked`/`halfBanked`). Une pièce sans genre (droite ou transition : `flatToDown25`, `leftBankToFlat`…) ferme l'élément en cours et n'appartient à aucun élément. C'est la règle du prototype qui a produit la section 1. L'idée de rattacher les transitions à l'élément suivant n'a pas été retenue : elle changerait les chiffres de référence sans rien apporter de mesurable. Dans les croisements, une suite de pièces hors élément compte comme une seule « liaison » (`flat+onRidePhoto+flatToLeftBank`).

**Pièces voisines dans le parcours.** Deux pièces dont les indices diffèrent d'au plus 2, modulo la longueur du circuit, sont voisines. Elles ne comptent jamais dans les mesures de proximité. Sur un tracé en cours de construction (non fermé, détecté sur les poses par `isClosed`), les indices ne bouclent pas : sinon la première et la dernière pièce d'un tracé court passeraient pour voisines.

Par élément :

- `tiles` : tuiles occupées (ensemble des blocs).
- `nearestGap` : plus petite distance de Tchebychev (0 à 4, au-delà « > 4 ») entre une tuile de l'élément et une tuile portant une pièce non voisine hors de l'élément.
- `shared` : nombre de tuiles de l'élément qui portent aussi une pièce non voisine, et `minLevelGap` : plus petit écart vertical en niveaux entre les blocs concernés. 0 tuile partagée signifie que l'élément est posé à côté du reste, pas mêlé à lui.
- `crossings` : liste `{ autreÉlément, tuiles, écart min en niveaux, dessus | dessous | mêlé }`, triée par nombre de tuiles. C'est la donnée à imiter. Exemple mesuré sur Frightmare : le lift passe au-dessus de la liaison photo (7 tuiles, 4,5 niveaux), de la spirale descendante (4 tuiles, 5 niveaux), de l'hélice montante finale (4 tuiles, 8 niveaux) et de la grande hélice descendante (2 tuiles, 2,5 niveaux).

Pour le circuit :

- `coverage` = tuiles de piste distinctes / tuiles de l'emprise.
- `stackedTiles` : tuiles portant au moins deux pièces non voisines.
- `largestVoid` : plus grand rectangle de l'emprise sans aucune piste, à n'importe quelle hauteur (taille, position, part de l'emprise).
- `isolated` : éléments dont `nearestGap ≥ 2` et `shared = 0`.
- `freeVolume` (P6) : pour chaque tuile d'un rectangle, les intervalles de niveaux libres entre le sol et un plafond, compte tenu du dégagement réel des blocs (`blockSpan`) et, avec le cache de carte, du terrain, de l'eau, des chemins (3 niveaux, comme `blockProblem`) et des pièces d'attraction déjà posées (`ri`). Il sert à proposer où empiler. Pas encore utilisé par un outil (étapes 4 et 5).
- Écart vertical : plus petit écart entre deux blocs quelconques de la tuile, et non entre le bloc le plus bas de l'élément et les autres comme dans le prototype. Les chiffres de la section 1 n'en changent pas.

Valeurs de référence à figer dans les tests unitaires, calculées sur `Frightmare.TD6` relu par `designLayout` : couverture ≈ 45 %, 80 tuiles empilées, vide 8×8, lift 11 tuiles partagées. Comparer avec une tolérance, car le `.td6` et le circuit posé dans le parc peuvent différer d'une pièce.

## 4. Ce que les outils doivent exposer

### 4.1 Lecture : `coaster_describe` et `coaster_compare`

- `space` dans `coaster_describe` (circuit ou `.td6`) : profil global (emprise, couverture, empilement, plus grand vide) et tableau par élément (`nearestGap`, `shared`, `minLevelGap`, croisements). Rester sous le budget de réponse : 1 ligne par élément.
- Une image du plan, comme `get_region_map { format: png }` : couleur = niveau, numéro d'élément, hachures sur les tuiles empilées, vide le plus grand encadré. Le texte seul ne suffit pas pour voir le vide.
- `coaster_compare` ajoute ces mesures côte à côte et des **leviers d'espace**, rédigés comme ceux des notes : « grande demi-boucle isolée (voisin à 1 tuile, 0 partagée) ; dans la référence, 0 tuile et 5 partagées à 1,5 niveau » ; « emprise 1,3 × la référence » ; « vide 19×6 au centre ».

### 4.2 Construction : `coaster_build_plan`, fermeture, recherche de section

- **`bounds`** (rectangle de tuiles, et en option niveaux min et max) sur `coaster_build_plan`, sur la fermeture A* et sur `coaster_search_section` (P4). Une pièce hors du rectangle est refusée avant toute simulation, avec l'élément fautif. Valeur conseillée pour imiter une référence : son emprise, majorée de 10 % au plus.
- **Mesures après chaque appel** : `layout` gagne `coverage`, `stackedTiles`, `largestVoid` et la liste des éléments isolés. Un avertissement `ISOLÉ` part pour tout élément posé à 2 tuiles ou plus du reste sans rien partager, avec ce que fait la référence pour le même genre d'élément.
- **Objectifs de la recherche de section (P4)** : en plus de la géométrie et de la vitesse, classer les variantes par tuiles partagées gagnées, puis par emprise, et rejeter celles qui sortent de `bounds`. Paramètre `prefer: { under: <indices de pièces>, through: <élément> }` pour viser un passage sous le lift ou à travers une boucle.
- **Fermeture A*** : respecter `bounds` et, à coût égal, préférer les pièces qui passent au-dessus ou au-dessous du circuit existant.

### 4.3 Collision : finir P6

- Générer aussi `quarterTile` (quarts de tuile occupés, rotation selon la direction) par bloc dans `gen-tables.mjs`, et ne déclarer un conflit que si les quarts se recoupent, comme `MapCanConstructWithClearAt`. Sans cela, certains croisements serrés de Frightmare restent refusés par le serveur alors que le jeu les accepte.
- Appliquer le dégagement réel dans `blockProblem` (terrain, chemins, entrées).
- Valider en jeu : reconstruire à blanc (`dryRun`) les sections de Frightmare qui se croisent à 1 et 1,5 niveau ; le serveur ne doit en refuser aucune que le jeu accepte.

## 5. Méthode de construction compacte (guide pour Claude, à reporter dans SPEC 14)

1. Lire la référence : `coaster_describe` (séquence, notes et `space`), puis `coaster_compare` si un essai existe déjà. Relever l'emprise, la couverture, l'empilement et les croisements marquants : ce qui passe sous le lift, à travers la boucle, sous la première chute.
2. Fixer `bounds` = emprise de la référence × 1,1 au plus, placée sur une zone libre et possédée (`get_region_map`).
3. Poser la station et le lift sur un bord de `bounds`, et laisser le côté sous le lift libre : la seconde moitié du parcours y passera.
4. Construire la première moitié (chute, grande inversion, premiers virages) en restant dans `bounds` et en tournant vers l'intérieur plutôt que vers l'extérieur.
5. Pour la seconde moitié, demander à la recherche de section des variantes qui passent sous le lift et à travers ou sous la grande inversion, puis empiler hélices et virages en pente dans le vide restant (`largestVoid`).
6. Après chaque appel : lire `space` et les avertissements `ISOLÉ`, et corriger tout de suite, pas à la fin. Tester (`coaster_test`) puis comparer (`coaster_compare`) : notes **et** espace.
7. Ne jamais sacrifier une fenêtre de vitesse pour gagner de la place : un élément mal placé en vitesse coûte plus que de la densité.

## 6. Critère de réussite

En partant d'une zone libre et de la consigne « dans le style de Frightmare », en moins de 40 appels d'outils, sur un circuit du même type :

- emprise au plus 1,2 × 408 tuiles, et chaque côté au plus 1,2 × celui de la référence ;
- couverture d'au moins 40 % et au moins 50 tuiles empilées ;
- plus grand vide d'au plus 20 % de l'emprise ;
- au plus 2 éléments isolés, hors station et lift ;
- en plus des critères de COASTER_REFERENCE section 4 : excitation à 0,3 près de la référence mesurée, intensité sous 8, un seul lift droit, aucun élément hors de sa fenêtre de vitesse.

## 7. Ordre de mise en œuvre proposé

| Étape | Contenu | Validation |
|---|---|---|
| 1 — **fait** | `planners/space.ts` + tests (valeurs de la section 1 sur Frightmare.TD6) | tests unitaires, puis en jeu sur les rides 5 et 9 : mêmes chiffres que la section 1 (vérifié, voir section 3) |
| 2 | `space` dans `coaster_describe`, `coaster_compare` (mesures, leviers d'espace, image) | lecture en jeu des deux circuits |
| 3 | Quarts de tuile dans le dégagement (fin de P6, collisions) | `dryRun` des croisements serrés de Frightmare |
| 4 | `bounds`, mesures et avertissements `ISOLÉ` dans `coaster_build_plan` et la fermeture | construction en jeu d'une section dans un rectangle imposé |
| 5 | `coaster_search_section` (P4) avec `bounds` et objectifs d'empilement | fermeture d'une seconde moitié qui passe sous le lift |
| 6 | Essai complet : critère de la section 6 | circuit construit en jeu, comparé à Frightmare |
