# docAnalizeAll3 説明書

Office 設計書（Excel / Word / PowerPoint）を Markdown に分解し、必要に応じて社名・固有名詞などを一括置換するツール群です。

## 概要

本プロジェクトは、次の2段階でドキュメントを扱います。

1. **分解（disassemble）** … `0.input` の Office ファイルをシート／スライド／文書単位の Markdown に変換する  
2. **置換（replaceMd）** … 生成済み Markdown 内の特定文字列を、定義したルールで一括置換する  

図形・画像・チャートを含むページは、ローカルの **LM Studio**（Vision 対応モデル推奨）で内容を再構成します。テキストのみの場合は機械的に Markdown 化します。

```
0.input/                  入力（元の Office 資料など）
    │
    ▼  script/1.disassemble.js
1.disassemble/            分解結果（.md など）
    │
    ▼  script/2.replaceMd.js
_work/replaceMd/          置換結果（既定）
  または任意の出力先
```

実際の運用では、置換後の成果物を `replaceMd/` などに配置して閲覧・解析することもあります。

---

## フォルダー構成

| パス | 役割 |
|------|------|
| `0.input/` | 変換対象の元ファイル置き場。階層はそのまま出力側に再現される |
| `1.disassemble/` | `1.disassemble.js` の出力先 |
| `script/` | 変換・置換スクリプト |
| `prompt/` | LM 用プロンプト設定・除外設定 |
| `example/` | 画像解釈の参考例（`example.md` と参照 PNG） |
| `9.log/` | 変換ログ・失敗一覧・officecli 呼び出しログ |
| `_work/` | 中間状態（LM 未応答の pending など）・置換の既定出力 |
| `replaceMd/` | 置換済みドキュメントの配置例（ビューア含む場合あり） |

---

## 前提環境

| 項目 | 内容 |
|------|------|
| Node.js | **18 以上**（グローバル `fetch` を使用） |
| officecli | PATH 上で `officecli` として実行できること（Excel/Word/PowerPoint の解析・PNG 化） |
| LM Studio | ローカル起動。既定エンドポイント `http://localhost:1234`。図形ページは **Vision（画像入力）対応モデル** をロード推奨 |

Office 以外のファイルは分解時にそのままコピーされます。

---

## クイックスタート

```bash
# 1. LM Studio を起動し、Vision 対応モデルをロード

# 2. 元資料を 0.input に配置

# 3. Markdown へ分解
node script/1.disassemble.js

# 4. 特定フォルダーだけ処理する場合
node script/1.disassemble.js --folder 02_ED書

# 5. 文字列置換（入力フォルダーを指定）
node script/2.replaceMd.js ./1.disassemble
```

---

# 1. `script/1.disassemble.js`

## 目的

`0.input` 配下のファイルを走査し、Office ファイルを Markdown 化して `1.disassemble` に出力します。入力のフォルダー階層を維持します。

既に出力済みの `.md`／コピー済みファイルはスキップするため、中断後の再実行で続きから処理できます。

## ファイル種別ごとの動作

### Excel（`.xlsx`）— シート単位

| 条件 | 処理 |
|------|------|
| 図形／画像／チャートあり | 図形テキスト・座標・セル値（＋任意でシート PNG）を LM Studio に渡し、Markdown を再構成 |
| テキストのみ | セル値を Markdown 表として出力 |
| 除外シート名 | 出力しない（除外設定参照） |

複数シートがあるブックは、`ファイル名.xlsx/` フォルダー配下に `01_シート名.md` 形式で出力します。シートが1つだけの場合は、親フォルダー直下にブック名の `.md` を置きます。

### PowerPoint（`.pptx`）— スライド単位

| 条件 | 処理 |
|------|------|
| 図形／画像あり | 図形テキスト・座標・表・画像情報（＋任意でスライド PNG）を LM に渡し再構成 |
| テキスト／表のみ | 見出し＋箇条書き＋表の Markdown を機械生成 |
| 章扉スライド | タイトル中心の薄いスライドはフォルダー化し、配下に内容スライドを配置 |

章扉のタイトルが除外設定に一致する場合、その章フォルダーと配下の内容スライドは出力しません。

### Word（`.docx`）— 文書単位

| 条件 | 処理 |
|------|------|
| 図形／画像あり | ページ毎に PNG 化し LM で再構成（1ファイル＝1つの `.md`、ページ見出し付き） |
| テキストのみ | 見出し・段落・表を機械的に Markdown 化 |

### その他のファイル

拡張子が `.xlsx` / `.docx` / `.pptx` 以外のものは、階層を保ったまま `1.disassemble` へコピーします。

## LM Studio 連携

- 既定モデル例: `google/gemma-4-31b-qat`（`--lm-model` で変更可）
- 図形シート／スライド／Word ページは、既定で `officecli view … screenshot` により PNG 化し、base64 で LM に添付します
- テキスト専用モデルしか使えない場合は `--no-lm-image` で、図形テキスト＋座標のみの送信に切り替えます
- 画像解釈時は `example/example.md` の本文と、そこで参照される PNG（対象画像／解釈画像）もプロンプトに含めます（`--no-example` で無効化可）

### 未応答時の挙動

1. 1回目失敗 … `.md` は出さず `_work/1.disassemble_lm_pending.json` に状態を記録  
2. 再実行でリトライ  
3. **2回とも失敗**したときだけ、抽出テキストを並べたフォールバック `.md`（本文に `LM Studio 応答なし`）を出力  
4. 既存のフォールバックをやり直す場合は `--retry-lm-fail`

## 設定ファイル

### プロンプト（必須）

- 既定: `prompt/1.disassembleConfigPrompt.md`
- 差し替え: `--prompt-config <path>`
- プログラム本体にプロンプト文字列は持たず、このファイルの `## @名前` セクションと `## +rule` 追加指示から組み立てます
- `+rule` は `type` / `folder` / `file` 条件で、種別・フォルダー・ファイル単位の追加指示を指定できます

### 除外設定（任意）

- 既定: `prompt/1.disassembleExclude.md`
- 差し替え: `--exclude-config <path>`

| 見出し | 内容 |
|--------|------|
| `## folder` | `0.input` からの相対パス。一致フォルダーとその配下を除外 |
| `## sheet` | Excel シート名の完全一致（`folder=` でスコープ可） |
| `## ppt-folder` | PowerPoint 章扉タイトルの完全一致（`folder=` でスコープ可） |

### 画像解釈の参考例（任意）

- 既定: `example/example.md`（同ディレクトリの PNG を参照）
- 差し替え: `--example-file <path>`

## 主なコマンドライン引数

| 引数 | 説明 |
|------|------|
| `--folder <相対パス>` | `0.input` 配下の指定フォルダーのみ処理 |
| `--filter <文字列>` | 相対パス部分一致フィルタ（動作確認用） |
| `--lm-model <名前>` | LM Studio のモデル名 |
| `--lm-endpoint <URL>` | 既定: `http://localhost:1234/v1/chat/completions` |
| `--lm-timeout <秒>` | LLM 1回のタイムアウト（既定 600） |
| `--lm-max-tokens <n>` | 最大トークン（既定 20000） |
| `--no-lm-image` | PNG を送らずテキストのみ |
| `--lm-image-width <px>` | 送信 PNG の横幅（既定 1600） |
| `--office-timeout <秒>` | officecli 1回のタイムアウト（既定 180） |
| `--prompt-config <path>` | プロンプト設定の差し替え |
| `--example-file <path>` | 参考例ファイルの差し替え |
| `--no-example` | 参考例を埋め込まない |
| `--exclude-config <path>` | 除外設定の差し替え |
| `--retry-lm-fail` | 既存フォールバック `.md` を削除して再変換 |
| `--source-root` / `--output-root` / `--log-root` / `--work-root` | 入出力・ログ・作業ディレクトリの変更 |

## 実行例

```bash
node script/1.disassemble.js
node script/1.disassemble.js --folder 02_ED書
node script/1.disassemble.js --lm-model "qwen/qwen2.5-vl-7b"
node script/1.disassemble.js --no-lm-image
node script/1.disassemble.js --office-timeout 300
node script/1.disassemble.js --retry-lm-fail
```

## ログ出力（`9.log/`）

| ファイル | 内容 |
|----------|------|
| `_disassemble_log.txt` | 変換の進行・スキップ・AI-MD／表MD などの実行ログ |
| `_failed_files.txt` | 開けなかった（破損・暗号化等）ファイル一覧 |
| `officecli_log.txt` | officecli 呼び出しの詳細 |

---

# 2. `script/2.replaceMd.js`

## 目的

指定フォルダー配下を再帰処理し、**Markdown（`.md`）に対して文字列置換ルールを適用**します。元ファイルは変更せず、同じフォルダー構成ですべてのファイルを出力先に書き出します。

| 種別 | 処理 |
|------|------|
| `.md` | 先頭の `REPLACEMENTS` ルールを順に適用して書き出し |
| それ以外 | そのままコピー |
| 空フォルダー | 構成維持のため出力側にも作成 |

## 置換ルールの編集

スクリプト先頭の `REPLACEMENTS` 配列を編集します。正規表現は使わず、**リテラル文字列の全出現置換**です。定義順に適用されます（長い固有名詞を先に置くと、短い共通語の置換の影響を避けやすいです）。

```javascript
const REPLACEMENTS = [
  { from: 'トップクルーズ', to: 'オバートリップ' },
  { from: 'NTT東西', to: 'ABC南北' },
  { from: 'NTT東', to: 'ABC北' },
  { from: 'NTT西', to: 'ABC南' },
  { from: 'NTT', to: 'ABC' },
  { from: 'トッパンフォームズ', to: 'HHH印刷' },
];
```

`from` が空のエントリはスキップされます。

## 入出力

| 項目 | 既定 |
|------|------|
| 入力 | 位置引数または `--input-root` で指定（必須） |
| 出力 | `<プロジェクトルート>/_work/replaceMd`（`--output-root` で変更可） |

## コマンドライン引数

| 引数 | 説明 |
|------|------|
| `<対象フォルダー>` | 位置引数。入力ルート |
| `--input-root <path>` | 入力ルート |
| `--output-root <path>` | 出力ルート |
| `-h` / `--help` | 使い方表示 |

## 実行例

```bash
# 分解結果に対して置換（出力は _work/replaceMd）
node script/2.replaceMd.js ./1.disassemble

node script/2.replaceMd.js --input-root ./1.disassemble

# 出力先を明示
node script/2.replaceMd.js --input-root ./1.disassemble --output-root ./replaceMd
```

## 完了時の表示

処理ファイル数、Markdown 数（うち置換あり件数）、コピー数、出力先をコンソールに表示します。置換があったファイルは `[置換]`、変更なしは `[出力]`、非 Markdown は `[コピー]` とログされます。

---

## 推奨ワークフロー

1. 変換対象を `0.input/` に配置する  
2. `prompt/1.disassembleExclude.md` で不要フォルダー・シート・PPT 章を除外する  
3. LM Studio を起動し Vision モデルをロードする  
4. `node script/1.disassemble.js`（必要なら `--folder`）で分解する  
5. `9.log/_failed_files.txt` とログで失敗・スキップを確認する  
6. LM 未応答が残っていれば再実行し、フォールバックだけやり直す場合は `--retry-lm-fail`  
7. `2.replaceMd.js` の `REPLACEMENTS` を案件用に直し、分解結果に対して実行する  

---

## 注意事項

- **パス長**: Windows の制限対策のため、スライド／章タイトル由来のフォルダー・ファイル名は最大約 60 文字に切り詰めます  
- **Office 一時ファイル**: `~$` で始まるロックファイルや `Thumbs.db` 等は走査対象外です  
- **再実行**: 既存出力は基本スキップです。中身をやり直す場合は対象 `.md` を削除するか、フォールバック再変換用の `--retry-lm-fail` を使います  
- **置換の順序**: `NTT` のような短い語を先に置換すると、`NTT東` などが意図どおり残らないことがあります。長い語から定義してください  
- **スクリプト内の旧パス表記**: `2.replaceMd.js` のコメント例に `helper_script/replaceMd.js` とある場合がありますが、実体は `script/2.replaceMd.js` です  
