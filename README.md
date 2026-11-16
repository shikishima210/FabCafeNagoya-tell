# レーザーデータベースサーチ

Trotec Speedy 360（CO2 60W）用。素材と厚さを入れると、過去の加工記録（前例）とおすすめの開始値が見られる Web アプリです。

- 記録の元データ：公開中の Notion「レーザーカッターデータベース」
  https://honey-addition-681.notion.site/3a4e13ace3b544e28d27275a47def15d
- GitHub Actions が 1 時間ごとに Notion を読み、`data/records.json` に書き出します（変更があったときだけコミット）。
- タグに `default` が付いた記録（Trotec の初期設定＝メーカー参考値）は載せません。
- アプリ（`index.html`）は `data/records.json` を読むだけなので、サーバーも Notion の鍵もいりません。

## 公開の手順（初回だけ）

1. GitHub で新しいリポジトリを作る（このリポジトリは `FabCafeNagoya-tell`）。公開（Public）にする。
2. このフォルダの中身をすべてアップロードする
   - `index.html` / `README.md` / `scripts/fetch-notion.mjs` / `.github/workflows/update-records.yml`
   - ブラウザでアップロードする場合、`.github` フォルダは隠しフォルダなので、Finder で ⌘⇧. を押して表示してからドラッグする
3. **Actions** タブ →「記録を更新」→ **Run workflow** を押す
   → 1〜2 分で `data/records.json` ができる（緑のチェックが付けば成功）
4. **Settings → Pages** → Source を「Deploy from a branch」、Branch を `main` / `/(root)` にして Save
5. 数分後、`https://<ユーザー名>.github.io/<リポジトリ名>/` で開けるようになる。このURLを共有する

## 運用

- Notion に記録を追加すると、次の毎時17分ごろの更新で反映されます。すぐ反映したいときは手順3を実行。
- 画面右上に「記録 ○件・○月○日 ○:○○ 更新」と出ます。
- 60日間リポジトリに動きがないと、GitHub が定期実行を止めることがあります。止まったら Actions タブで有効にし直してください。
- 手元で試す：`node scripts/fetch-notion.mjs` → `npx serve .` などで開く（`index.html` を直接ダブルクリックすると読み込めません）。

## 注意

- 2023年の発振器交換（42W→62W）より前の記録は、強めに出ることがあります。必ずテスト加工してから本番に入ってください。
- 公開リポジトリにすると、記録（メモ欄を含む）は誰でも見られます。
