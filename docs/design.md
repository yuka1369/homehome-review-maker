# 設計書 — ほめほめプレビューメイカー

## 1. 全体構成

完全クライアントサイドの静的 Web アプリ。サーバー処理・ビルド工程・外部依存はない。

```
index.html            画面構造 + CSP(meta)
css/style.css         スタイル（CSS 変数でテーマ管理）
js/app.js             UI 層：入力の正規化、DOM 描画、Canvas 書き出し、クリップボード
js/sentiment.js       解析層：感情クラスタリング（純粋関数・DOM 非依存）
tests/*.test.mjs      解析層の単体テスト（node:test）
docs/                 要件定義書・設計書
.github/workflows/    CI（テストのみ、最小権限）
```

```
[入力フォーム] --input--> app.js: clean() --> sentiment.js: analyze()
                                               |
                       { emoji, scoreLabel, clusters, matches, score }
                                               v
                      app.js: render() -- textContent --> プレビューカード / 解析パネル
                      app.js: drawCard() -- fillText --> Canvas --> PNG(blob) ダウンロード
```

## 2. 感情クラスタリング（js/sentiment.js）

軽量・説明可能・オフラインを優先し、**辞書ベースの感情クラスタリング**を採用した。
各ポジティブ語を「感情クラスタ」に事前に割り当てた辞書を持ち、文中の出現をクラスタ単位で集計する。

### 2.1 クラスタ定義

| id | ラベル | 代表語の例 | 絵文字候補 |
|----|--------|-----------|-----------|
| gourmet | 美味しさ | 美味、絶品、ご飯 | 🍚 🍣 🍖 🍜 🍛 |
| tears | 感動 | 感動、涙、潤ん、ウルウル | 😭 🥹 🥲 |
| nostalgia | 懐かしさ | 原風景、懐かし、こたつ、蜜柑、団らん | 🏡 🍊 📺 🎐 |
| happy | 幸福 | 幸福、幸せ、癒、ほっこり | 🌸 🍀 🌈 ☀️ |
| kind | おもてなし | 親切、丁寧、案内、神対応 | 🙏 🤝 💐 |
| beauty | 絶景・魅力 | 絶景、綺麗、魅力、素敵 | 🌅 🗻 ✨ 🌌 |
| hype | 最高 | 最高、すご、神、優勝、ヒシヒシ | 🚀 🔥 👑 💯 |
| cute | 尊さ | かわいい、もふ、尊 | 🐱 🥰 💕 🐣 |
| again | リピート欲 | また行き、リピ、おすすめ | 🔁 🎫 🧳 |

各語には重み（1〜4）があり、強い語ほど高い。

### 2.2 アルゴリズム

1. **正規化** `normalize()` — NFKC（全角英数→半角）、小文字化、カタカナ→ひらがな。表記ゆれ（ウルル/うるる 等）を吸収。辞書側も同じ正規化をかける。
2. **最長一致スキャン** — キーワードを長さ降順にスキャンし、既に覆われた位置と重なる一致は捨てる（「神対応」を「神」と二重計上しない）。
3. **否定判定** — 一致直後の最大 6 文字に `ひらがな0〜2字 + (くない|じゃない|ではない|ません|なかった…)` があれば重み 0（「美味しくない」）。
4. **クラスタ集計** — クラスタごとに重みを合計し降順に並べる（同点は定義順）。
5. **盛り上げ倍率** — 盛り上げ語（本当に/まさに/超…）1 語につき +0.15、`!` 1 つにつき +0.1（最大 5 個）、倍率上限 2.5。
6. **総スコア** = Σクラスタスコア × 倍率。
7. **絵文字** = 最上位クラスタの候補から `seed % 候補数` で選択。ポジティブ語ゼロなら `🙂`。
8. **ふざけ桁** = 総スコアで段（TIERS）を決め、段内の候補から `(seed >>> 3) % 候補数` で選択。

| 総スコア | 表示候補 |
|---------|---------|
| 0〜 | 100 |
| 4〜 | 1000 / 3000 |
| 8〜 | 1万 / 5万 |
| 13〜 | 100万 / 530万 |
| 19〜 | 1億 / 3億 |
| 26〜 | 1兆 / 8000兆 |
| 34〜 | 1京 / 5000兆 |
| 44〜 | 1垓 / 1恒河沙 |
| 56〜 | 1那由他 / 1不可思議 |
| 70〜 | 無量大数 |
| 90〜 | ∞ |

### 2.3 決定性と「引き直し」
`seed = (FNV-1a(正規化テキスト) + salt × 9) >>> 0`。同じ文なら同じ結果になり、引き直しボタンで `salt` を増やすと絵文字・桁のバリエーションが変わる。入力を編集すると `salt` は 0 に戻る。
※ FNV-1a は見た目の揺らぎ用であり、セキュリティ用途ではない。

### 2.4 公開 API
```js
analyze(text: string, salt?: number) => {
  emoji: string, scoreLabel: string, score: number, intensity: number,
  clusters: { id, label, score, words: string[] }[],
  matches: { word, cluster, weight, negated, index }[]
}
normalize(s) / hash(s) / scoreToLabel(score, seed) / CLUSTERS / TIERS / LIMITS
```

### 2.5 拡張方法
辞書は `CLUSTERS` 配列のみで完結する。新しいクラスタや語を足すときは `words` に `[語, 重み]` を追加するだけでよい（正規化は自動）。

## 3. UI（js/app.js）

- **入力正規化 `clean()`**: NFC 化、C0 制御文字と Unicode 双方向制御文字（U+202A–202E, U+2066–2069, U+200E/F）を除去、書記素（コードポイント）単位で長さ制限、連続改行の圧縮。
- **描画 `render()`**: すべて `textContent` / `replaceChildren` / `createElement` で構築。`innerHTML` は使用しない。アバター色はアカウント名のハッシュから決定（CSSOM の `style.setProperty` は CSP の `style-src 'self'` 下でも許可される）。
- **画像書き出し `drawCard()`**: Canvas 2D に `fillText` で描画（文字列は HTML として解釈されない）。`Intl.Segmenter` による書記素単位の折り返しで絵文字の分断を防ぐ。2 倍解像度。下部に透かし。`toBlob` → `URL.createObjectURL` → 固定ファイル名 `homehome-review.png` でダウンロード → URL を revoke。
- **コピー**: `navigator.clipboard.writeText`（失敗時はメッセージ表示のみ）。

## 4. セキュリティ設計

| 脅威 | 対策 |
|------|------|
| XSS（入力に HTML/JS を混入） | `textContent` と Canvas `fillText` のみで出力。CSP で `script-src 'self'`、インラインスクリプト・`eval` 不可 |
| 外部への情報送信 / トラッキング | 外部通信なし。CSP `connect-src 'none'`、`default-src 'none'`。解析タグなし。`referrer: no-referrer` |
| サプライチェーン攻撃 | 実行時の依存ゼロ・CDN 不使用。CI も追加アクションは `actions/checkout` のみ、`permissions: contents: read` |
| 外部リソース読み込み・フォーム送信悪用 | `object-src 'none'`、`base-uri 'none'`、`form-action 'none'` |
| 表示偽装（RLO 等の Bidi 文字） | 入力から双方向制御文字を除去 |
| 巨大入力による DoS（自分のタブ） | `maxlength` + JS 側でも長さ制限、解析対象は先頭 600 文字 |
| 偽レビューとしての悪用 | 実在サービスのロゴ・名称を使わない汎用デザイン、画像に透かし、画面に注意書き |
| 秘密情報の漏えい | 秘密情報を一切持たない設計。`.gitignore` で `.env` 等を除外 |

**既知の制約**: GitHub Pages はレスポンスヘッダを設定できないため、CSP は `<meta>` で指定している。`frame-ancestors`（クリックジャッキング対策）は meta では効かないが、本アプリには認証や状態変更操作がないためリスクは低いと判断した。独自ドメイン + CDN でヘッダを付与できる場合は `frame-ancestors 'none'` と `X-Content-Type-Options: nosniff` の追加を推奨する。

## 5. テスト

- `node --test tests/*.test.mjs`：正規化、否定、最長一致、倍率、桁変換の単調性、異常入力（null・HTML・Bidi・超長文）、決定性、引き直し。
- 手動 / E2E 確認：CSP 違反がコンソールに出ないこと、XSS 文字列が文字として表示されること、375px 幅で横スクロールが出ないこと、PNG 保存。

## 6. デプロイ
GitHub リポジトリの Settings → Pages → 「Deploy from a branch」→ `main` / `/(root)`。ビルドは不要。
