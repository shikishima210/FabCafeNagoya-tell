// 公開中の Notion「レーザーカッターデータベース」から記録を集めて data/records.json に書き出す。
// 鍵（トークン）は不要。公開ページを読むだけです。
// 使い方: node scripts/fetch-notion.mjs
import { writeFile, mkdir, readFile } from "node:fs/promises";

// 前回より件数が大きく減っても書き出したい時だけ ALLOW_DROP=1 を付けて実行する
const ALLOW_DROP = process.env.ALLOW_DROP === "1";

const SITE = "https://honey-addition-681.notion.site";
const ROOT_PAGE = "3a4e13ac-e3b5-44e2-8d27-275a47def15d";
const OUT = new URL("../data/records.json", import.meta.url);
const STATUS = new URL("../data/status.json", import.meta.url);

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

// 数値は「数字だけ（％や mm の単位は可）」の時だけ採用する。
// 「50/2回」のような複合値や範囲外の値は null にして、issues に理由を残す（画面ではおすすめ値に使わない）。
const RANGE = {
  th: { label: "厚さ", min: 0, max: 210, unit: /^(mm|ｍｍ|ミリ)?$/i },
  power: { label: "パワー", min: 0, max: 100, unit: /^%?$/ },
  speed: { label: "スピード", min: 0, max: 100, unit: /^%?$/ },
  freq: { label: "PPI/Hz", min: 0, max: 60000, unit: /^(hz|ppi)?$/i },
};
function parseNum(raw, field, issues) {
  const s = String(raw ?? "").normalize("NFKC").trim();
  if (!s) return null;
  const m = s.match(/^(-?\d+(?:\.\d+)?)\s*(.*)$/);
  const r = RANGE[field];
  if (!m || !r.unit.test(m[2].trim())) { issues.push(`${r.label}「${s}」は数値として読めません`); return null; }
  const n = Number(m[1]);
  if (!(n > r.min && n <= r.max)) { issues.push(`${r.label}「${s}」は範囲外です`); return null; }
  return n;
}
// タグは全角・大文字の違いをそろえてから比べる（Default／ＤＥＦＡＵＬＴ も除外する）
const normTag = (t) => String(t).normalize("NFKC").trim().toLowerCase();

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

  if (!pages.length) throw new Error("ルートページの下に素材別ページが見つかりません。書き出しを中止します。");
  const records = [];
  const pageCount = {};
  for (const [pageId, page] of pages) {
    const cat = text(page.properties?.title);
    pageCount[cat] = pageCount[cat] || 0;
    const chunk = await loadPage(pageId);
    const views = Object.values(chunk.recordMap.block).map(V).filter((b) => b && /collection_view/.test(b.type) && b.collection_id);
    const seen = new Set();
    for (const cv of views) {
      if (seen.has(cv.collection_id)) continue;
      seen.add(cv.collection_id);
      const q = await queryCollection(cv);
      const col = V(q.recordMap?.collection?.[cv.collection_id]) ?? V(chunk.recordMap?.collection?.[cv.collection_id]);
      const k = mapSchema(col?.schema);
      // タグ列が見つからないと default 除外が効かなくなるので、その場合は書き出しを止める
      if (!k.name || !k.tags) throw new Error(`「${cat}」の表で${!k.name ? "名前" : "タグ"}の列が見つかりません。メーカー参考値を除外できないため書き出しを中止します。`);
      const ids = q.result?.reducerResults?.collection_group_results?.blockIds;
      if (!Array.isArray(ids)) throw new Error(`「${cat}」の記録一覧を読み取れませんでした（Notion の応答形式が変わった可能性）。書き出しを中止します。`);
      for (const id of ids) {
        const p = V(q.recordMap.block[id])?.properties;
        if (!p) continue;
        const name = text(p[k.name]);
        if (!name) continue;
        const tags = text(p[k.tags]).split(",").map((t) => t.trim()).filter(Boolean);
        if (tags.some((t) => normTag(t) === "default")) continue; // Trotec の初期設定（メーカー参考値）は載せない
        const issues = [];
        const th = parseNum(text(p[k.th]), "th", issues);
        const power = parseNum(text(p[k.power]), "power", issues);
        const speed = parseNum(text(p[k.speed]), "speed", issues);
        const freqN = parseNum(text(p[k.freq]), "freq", issues);
        records.push({
          name,
          cat,
          type: text(p[k.type]) || "",
          th,
          power,
          speed,
          freq: freqN == null ? "" : String(freqN),
          result: text(p[k.result]),
          memo: text(p[k.memo]),
          tags,
          issues,
          url: `${SITE}/${id.replace(/-/g, "")}`,
        });
        pageCount[cat] = (pageCount[cat] || 0) + 1;
      }
      await sleep(400);
    }
    console.log(`${cat}: 累計 ${records.length}件`);
  }

  if (records.length < 30) throw new Error(`記録が ${records.length}件しか取れませんでした。書き出しを中止します。`);
  records.sort((a, b) => a.cat.localeCompare(b.cat, "ja") || a.name.localeCompare(b.name, "ja"));

  let prev = null;
  try { prev = JSON.parse(await readFile(OUT, "utf8")); } catch (_) { /* 初回は前回ファイルなし */ }

  // 前回と比べて、ページごと・全体で件数が大きく減っていたら公開しない（一部ページだけ読めなかった時の上書き防止）
  if (prev && !ALLOW_DROP) {
    const before = prev.pages || {};
    if (!prev.pages) for (const r of prev.records || []) before[r.cat] = (before[r.cat] || 0) + 1;
    const drops = [];
    for (const [cat, n] of Object.entries(before)) {
      const now = pageCount[cat] || 0;
      if (n >= 3 && now < n * 0.5) drops.push(`${cat}: ${n}件 → ${now}件`);
    }
    const total = (prev.records || []).length;
    if (total && records.length < total * 0.8) drops.push(`全体: ${total}件 → ${records.length}件`);
    if (drops.length) throw new Error(`前回より件数が大きく減っています（${drops.join("、")}）。書き出しを中止します。Notion 側で意図して減らした場合は ALLOW_DROP=1 を付けて実行してください。`);
  }

  const issueCount = records.filter((r) => r.issues.length).length;
  console.log(Object.entries(pageCount).map(([c, n]) => `${c} ${n}件`).join(" ／ "));
  if (issueCount) console.log(`数値に問題がある記録: ${issueCount}件（おすすめ値には使いません）`);

  await mkdir(new URL("../data/", import.meta.url), { recursive: true });
  // 自動更新が動いているかを画面で確かめるための記録（毎回書く。コミットは週1回まで）
  await writeFile(STATUS, JSON.stringify({ checkedAt: new Date().toISOString(), count: records.length, pages: pageCount }, null, 1) + "\n");

  if (prev && JSON.stringify(prev.records) === JSON.stringify(records) && JSON.stringify(prev.pages) === JSON.stringify(pageCount)) { console.log(`変更なし（${records.length}件）`); return; }
  await writeFile(OUT, JSON.stringify({ updatedAt: new Date().toISOString(), source: `${SITE}/${ROOT_PAGE.replace(/-/g, "")}`, count: records.length, pages: pageCount, records }, null, 1) + "\n");
  console.log(`書き出し完了: ${records.length}件 → data/records.json`);
}

main().catch((e) => { console.error(e); process.exit(1); });
