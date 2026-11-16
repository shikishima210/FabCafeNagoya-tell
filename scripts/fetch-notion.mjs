// 公開中の Notion「レーザーカッターデータベース」から記録を集めて data/records.json に書き出す。
// 鍵（トークン）は不要。公開ページを読むだけです。
// 使い方: node scripts/fetch-notion.mjs
import { writeFile, mkdir, readFile } from "node:fs/promises";

const SITE = "https://honey-addition-681.notion.site";
const ROOT_PAGE = "3a4e13ac-e3b5-44e2-8d27-275a47def15d";
const OUT = new URL("../data/records.json", import.meta.url);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const V = (x) => x?.value?.value ?? x?.value;

async function post(path, body, tries = 5) {
  for (let i = 0; i < tries; i++) {
    const res = await fetch(SITE + path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (res.ok) return res.json();
    if (res.status === 429 || res.status >= 500) { await sleep(2000 * (i + 1)); continue; }
    throw new Error(`${path} → HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
  throw new Error(`${path} → 何度試しても失敗しました`);
}

const loadPage = (pageId) =>
  post("/api/v3/loadPageChunk", { pageId, limit: 200, cursor: { stack: [] }, chunkNumber: 0, verticalColumns: false });

const queryCollection = (c) =>
  post("/api/v3/queryCollection?src=initial_load", {
    collection: { id: c.collection_id, spaceId: c.space_id },
    collectionView: { id: c.view_ids[0], spaceId: c.space_id },
    loader: { type: "reducer", reducers: { collection_group_results: { type: "results", limit: 5000 } }, searchQuery: "", userTimeZone: "Asia/Tokyo" },
  });

// プロパティの値（Notion の内部形式）を文字列にする
const text = (v) => (Array.isArray(v) ? v.map((seg) => seg[0]).join("") : "").trim();
const toNum = (s) => { const n = parseFloat(String(s).replace(/[^\d.\-]/g, "")); return Number.isFinite(n) ? n : null; };

// 素材別ページごとに項目名が少しずつ違うので、呼び名でまとめる
const FIELD = {
  type: /^加工種類/,
  th: /^厚さ/,
  power: /^パワー/,
  speed: /^スピード/,
  freq: /^PPI/i,
  result: /^結果/,
  tags: /^タグ/,
  memo: /加工回数|レンズ|テキスト|メモ/,
};

function mapSchema(schema) {
  const keys = {};
  for (const [key, s] of Object.entries(schema || {})) {
    const name = String(s.name || "").trim();
    if (key === "title") { keys.name = key; continue; }
    for (const [field, re] of Object.entries(FIELD)) {
      if (!keys[field] && re.test(name)) keys[field] = key;
    }
  }
  return keys;
}

async function main() {
  const root = await loadPage(ROOT_PAGE);
  const pages = Object.entries(root.recordMap.block)
    .map(([id, b]) => [id, V(b)])
    .filter(([, b]) => b && b.type === "page" && b.parent_id === ROOT_PAGE);

  const records = [];
  for (const [pageId, page] of pages) {
    const cat = text(page.properties?.title);
    const chunk = await loadPage(pageId);
    const views = Object.values(chunk.recordMap.block).map(V).filter((b) => b && /collection_view/.test(b.type) && b.collection_id);
    const seen = new Set();
    for (const cv of views) {
      if (seen.has(cv.collection_id)) continue;
      seen.add(cv.collection_id);
      const q = await queryCollection(cv);
      const col = V(q.recordMap?.collection?.[cv.collection_id]) ?? V(chunk.recordMap?.collection?.[cv.collection_id]);
      const k = mapSchema(col?.schema);
      const ids = q.result?.reducerResults?.collection_group_results?.blockIds ?? [];
      for (const id of ids) {
        const p = V(q.recordMap.block[id])?.properties;
        if (!p) continue;
        const name = text(p[k.name]);
        if (!name) continue;
        const tags = text(p[k.tags]).split(",").map((t) => t.trim()).filter(Boolean);
        if (tags.includes("default")) continue; // Trotec の初期設定（メーカー参考値）は載せない
        records.push({
          name,
          cat,
          type: text(p[k.type]) || "",
          th: toNum(text(p[k.th])),
          power: toNum(text(p[k.power])),
          speed: toNum(text(p[k.speed])),
          freq: text(p[k.freq]),
          result: text(p[k.result]),
          memo: text(p[k.memo]),
          tags,
          url: `${SITE}/${id.replace(/-/g, "")}`,
        });
      }
      await sleep(400);
    }
    console.log(`${cat}: 累計 ${records.length}件`);
  }

  if (records.length < 30) throw new Error(`記録が ${records.length}件しか取れませんでした。書き出しを中止します。`);
  records.sort((a, b) => a.cat.localeCompare(b.cat, "ja") || a.name.localeCompare(b.name, "ja"));

  try {
    const prev = JSON.parse(await readFile(OUT, "utf8"));
    if (JSON.stringify(prev.records) === JSON.stringify(records)) { console.log(`変更なし（${records.length}件）`); return; }
  } catch (_) { /* 初回は前回ファイルなし */ }
  await mkdir(new URL("../data/", import.meta.url), { recursive: true });
  await writeFile(OUT, JSON.stringify({ updatedAt: new Date().toISOString(), source: `${SITE}/${ROOT_PAGE.replace(/-/g, "")}`, count: records.length, records }, null, 1) + "\n");
  console.log(`書き出し完了: ${records.length}件 → data/records.json`);
}

main().catch((e) => { console.error(e); process.exit(1); });
