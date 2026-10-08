#!/usr/bin/env node
// Analyse spatiale des circuits mesurés (docs/COASTER_SPACE.md, section 1) : proximité entre éléments, empilement, vide.
// Usage : corepack pnpm build && node tools/space-analysis.mjs   (lit <dossier utilisateur>/claude-coaster-measures.json)
import { readFileSync } from "node:fs";
const root = new URL("../packages/server/dist/planners/", import.meta.url).href;
const { SegmentTable, pieceElements } = await import(root + "track.js");
const { elementKind } = await import(root + "speed.js");
const table = SegmentTable.fromFile();
const measures = JSON.parse(readFileSync(process.env.OPENRCT2_USER_DIR ? process.env.OPENRCT2_USER_DIR + "/claude-coaster-measures.json" : process.env.HOME + "/.config/OpenRCT2/claude-coaster-measures.json", "utf8"));

for (const m of measures) {
  const pcs = m.pieces;
  const blocks = pcs.map((p) => pieceElements(p, table.require(p.type)));
  // Éléments : lift, puis chaque suite de pièces d'un même genre ; transitions rattachées à l'élément suivant.
  const els = [];
  let cur = null;
  pcs.forEach((p, i) => {
    const name = SegmentTable.nameOf(p.type);
    const kind = p.chain ? "lift" : /Station/.test(name) ? "station" : /[bB]rakes/.test(name) ? "brakes" : elementKind(name)?.replace(/^(banked|halfBanked)/, "") ?? null;
    if (kind && (!cur || cur.kind !== kind || cur.closed)) { cur = { kind, from: i, to: i, closed: false }; els.push(cur); }
    else if (kind && cur) cur.to = i;
    else if (cur) cur.closed = true;
  });
  const tilesOf = (a, b) => { const s = new Map(); for (let i = a; i <= b; i++) for (const e of blocks[i]) { const k = e.x + "," + e.y; s.set(k, Math.min(s.get(k) ?? 1e9, e.z)); } return s; };
  const all = new Map(); // tuile -> liste de {i, z}
  blocks.forEach((bs, i) => bs.forEach((e) => { const k = e.x + "," + e.y; (all.get(k) ?? all.set(k, []).get(k)).push({ i, z: e.z }); }));
  const n = pcs.length;
  const far = (i, a, b) => { const d = Math.min(Math.abs(i - a), Math.abs(i - b), n - Math.abs(i - a), n - Math.abs(i - b)); return (i < a || i > b) && d > 2; };
  console.log(`\n=== ${m.name} (${m.layout.footprint.size}) ===`);
  const rows = [];
  for (const el of els) {
    if (el.kind === "station" || el.kind === "brakes") continue;
    const t = tilesOf(el.from, el.to);
    let gap = 99, shared = 0, minDz = 999;
    for (const [k, z] of t) {
      const [x, y] = k.split(",").map(Number);
      const here = (all.get(k) ?? []).filter((o) => far(o.i, el.from, el.to));
      if (here.length) { shared++; minDz = Math.min(minDz, ...here.map((o) => Math.abs(o.z - z) / 16)); }
      for (let dx = -4; dx <= 4; dx++) for (let dy = -4; dy <= 4; dy++) {
        if ((all.get(`${x + dx},${y + dy}`) ?? []).some((o) => far(o.i, el.from, el.to))) gap = Math.min(gap, Math.max(Math.abs(dx), Math.abs(dy)));
      }
    }
    rows.push(`${el.kind.padEnd(34)} pièces ${String(el.from).padStart(3)}-${String(el.to).padEnd(3)} tuiles ${String(t.size).padStart(3)}  piste voisine à ${gap > 4 ? ">4" : gap} tuile(s)  tuiles partagées ${shared}${shared ? ` (écart min ${minDz} niv.)` : ""}`);
  }
  console.log(rows.join("\n"));
  // Global.
  const fp = m.layout.footprint, W = fp.x2 - fp.x1 + 1, H = fp.y2 - fp.y1 + 1;
  const stacked = [...all.values()].filter((l) => new Set(l.map((o) => o.i)).size > 1 && l.some((a) => l.some((b) => Math.abs(a.i - b.i) > 2 && Math.abs(a.i - b.i) < n - 2))).length;
  // Plus grand rectangle vide dans l'emprise.
  let best = 0, bestR = null;
  for (let x1 = fp.x1; x1 <= fp.x2; x1++) for (let y1 = fp.y1; y1 <= fp.y2; y1++)
    for (let x2 = x1; x2 <= fp.x2; x2++) { let ok = true; for (let y2 = y1; y2 <= fp.y2 && ok; y2++) {
      for (let x = x1; x <= x2; x++) if (all.has(`${x},${y2}`)) { ok = false; break; }
      if (ok && (x2 - x1 + 1) * (y2 - y1 + 1) > best) { best = (x2 - x1 + 1) * (y2 - y1 + 1); bestR = `${x2 - x1 + 1}×${y2 - y1 + 1} en (${x1},${y1})`; } } }
  console.log(`tuiles de piste ${all.size} / emprise ${W * H} = couverture ${(all.size / (W * H) * 100).toFixed(0)} %, tuiles empilées (piste au-dessus d'une autre partie du circuit) ${stacked}, plus grand vide ${bestR} = ${(best / (W * H) * 100).toFixed(0)} % de l'emprise`);
}
