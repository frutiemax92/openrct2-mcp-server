#!/usr/bin/env node
// Analyse spatiale des circuits mesurés (docs/COASTER_SPACE.md, section 1) : proximité entre éléments, empilement, vide.
// Calcul : planners/space.ts (spaceProfile). Usage : corepack pnpm build && node tools/space-analysis.mjs [Fichier.TD6…]
// Sans argument, lit <dossier utilisateur>/claude-coaster-measures.json (pièces relevées en jeu par coaster_test).
import { readFileSync } from "node:fs";
import { basename } from "node:path";
const root = new URL("../packages/server/dist/planners/", import.meta.url).href;
const { SegmentTable } = await import(root + "track.js");
const { spaceProfile } = await import(root + "space.js");
const { designLayout, parseTrackDesign } = await import(root + "td6.js");
const table = SegmentTable.fromFile();

const circuits = process.argv.length > 2
  ? process.argv.slice(2).map((f) => ({ name: basename(f), pieces: designLayout(parseTrackDesign(readFileSync(f), basename(f)), table, { x: 0, y: 0, z: 0 }, 0).pieces }))
  : JSON.parse(readFileSync((process.env.OPENRCT2_USER_DIR ?? process.env.HOME + "/.config/OpenRCT2") + "/claude-coaster-measures.json", "utf8"))
      .map((m) => ({ name: `${m.name} (ride ${m.rideId}, ${m.fingerprint})`, pieces: m.pieces }));

const pct = (v) => `${Math.round(v * 100)} %`;
for (const c of circuits) {
  const s = spaceProfile(table, c.pieces);
  const fp = s.footprint;
  console.log(`\n=== ${c.name} : ${fp.w}×${fp.h} = ${fp.area} tuiles, ${c.pieces.length} pièces${s.closed ? "" : ", ouvert"} ===`);
  for (const e of s.elements) {
    const cross = e.crossings.slice(0, 3).map((x) => `${x.side} ${x.kind} ${x.tiles}t/${x.minLevelGap}`).join(", ");
    console.log(`${e.kind.padEnd(32)} ${String(e.from).padStart(3)}-${String(e.to).padEnd(3)} tuiles ${String(e.tiles).padStart(3)}  voisin ${e.nearestGap ?? ">4"}  partagées ${String(e.shared).padStart(2)}${e.shared ? ` (${e.minLevelGap} niv.)` : "        "}${e.isolated ? "  ISOLÉ" : ""}${cross ? `  ${cross}` : ""}`);
  }
  const v = s.largestVoid;
  const zero = s.elements.filter((e) => e.nearestGap === 0).length;
  console.log(`couverture ${pct(s.coverage)} (${s.trackTiles} tuiles), empilées ${s.stackedTiles}, plus grand vide ${v ? `${v.w}×${v.h} en (${v.x},${v.y}) = ${pct(v.share)}` : "aucun"}, éléments à 0 tuile ${zero} sur ${s.elements.length}, isolés ${s.isolated.length}`);
}
