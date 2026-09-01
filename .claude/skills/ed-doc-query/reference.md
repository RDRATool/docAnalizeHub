# ed-doc-query リファレンス

`replaceMd/viewer-ed/ed-graph-data.js`（生成物、2026-07-29 時点で 753ノード / 2097関係）の中身と、
ED書のドキュメント種別間の参照関係の詳細。SKILL.md で足りないときだけ読む。

## 1. 関係の全件（19パターン）

`node .claude/skills/ed-doc-query/scripts/ed-query.mjs matrix` で最新値を出せる。

| 参照元 | 関係 | 参照元の項目 | 参照先 | 件数 | ID一致 | 名称一致 |
| --- | --- | --- | --- | --- | --- | --- |
| 20_画面仕様 | TBL CRUD | `01_機能概要`【利用テーブル】 | TBL | 378 | - | - |
| 30_バッチ処理仕様 | 入力 | `概要` ◆入力一覧 | TBL | 338 | - | - |
| 110_詳細業務フロー | TBLに触れる | 本文の `〜TBL` | TBL | 295 | - | - |
| 30_バッチ処理仕様 | 出力 | `概要` ◆出力一覧 | TBL | 255 | - | - |
| 110_詳細業務フロー | 担当 | 本文の担当表記 | アクター | 104 | - | - |
| 110_詳細業務フロー | バッチを起動 | 本文のバッチID・バッチ名 | 30_バッチ処理仕様 | 66 | 18 | 48 |
| 30_バッチ処理仕様 | 出力 | `概要` ◆出力一覧 | 60_ファイル仕様 | 54 | - | - |
| 20_画面仕様 | 画面遷移 | `ED_T_画面遷移図/01_画面遷移一覧` | 20_画面仕様 | 53 | - | - |
| 110_詳細業務フロー | 画面機能を使う | 本文の機能ID・一覧の名称 | 20_画面仕様 | 49 | 28 | 21 |
| 110_詳細業務フロー | 画面を使う | 本文の画面ID・画面名 | 20_画面仕様 | 46 | 4 | 42 |
| 110_詳細業務フロー | ファイルを扱う | 本文のファイル名 | 60_ファイル仕様 | 39 | 0 | 39 |
| 30_バッチ処理仕様 | 入力 | `概要` ◆入力一覧 | 60_ファイル仕様 | 38 | - | - |
| 20_画面仕様 | 入出力ファイル | ファイルID前方一致・機能名一致 | 60_ファイル仕様 | 37 | - | - |
| 110_詳細業務フロー | 起動契機 | 本文の `TPC_xxx` | 起動契機 | 26 | - | - |
| 30_バッチ処理仕様 | 入力 | ◆入力一覧（引数・環境変数） | データ | 25 | - | - |
| 30_バッチ処理仕様 | 出力 | ◆出力一覧（実体なしCSV/PDF/ZIP） | データ | 15 | - | - |
| 110_詳細業務フロー | バッチ機能を起動 | 本文の機能ID・機能名 | 30_バッチ処理仕様 | 5 | 3 | 2 |
| 20_画面仕様 | 所属 | IDの階層 | 20_画面仕様 | 115 | - | - |
| 30_バッチ処理仕様 | 所属 | IDの階層 | 30_バッチ処理仕様 | 90 | - | - |
| 110_詳細業務フロー | 所属 | 一覧の機能グループ | 110_詳細業務フロー | 69 | - | - |

所属（`contains`）は既定で集計・トレースから除外している。含めるときは `--contains`。

被参照側の合計は TBL 1266（バッチ593・画面378・フロー295）、60_ファイル仕様 168（バッチ92・フロー39・画面37）、
20_画面仕様 148（フロー95・画面遷移53）、30_バッチ処理仕様 71（すべてフローから）、110_詳細業務フロー 0。

CRUD の内訳は R=250、CRUD=42、RU=21、RD=17、C=11、CRD=10 ほか。

## 2. ノード

| kind | ID接頭辞 | 件数 | 生成元 |
| --- | --- | --- | --- |
| screen 画面 | `screen:` | 115 | `20_画面仕様/**/ED_T_XXnnn_Fnn_*.xlsx/` |
| screengroup 画面機能 | `sgroup:` | 41 | 画面IDの機能部（`SE001`）。名称は `ED_T_画面一覧.md` |
| batch バッチ | `batch:` | 90 | `30_バッチ処理仕様/**/ED_T_XXnnn_Bnn_*.xlsx/` |
| batchgroup バッチ機能 | `bgroup:` | 60 | 同上。名称は `ED_T_バッチ処理一覧.xlsx/02_バッチ構成.md` |
| file ファイル | `file:` | 148 | `60_ファイル仕様/**/*.xlsx/01_ファイル仕様.md` |
| flow 業務フロー | `flow:` | 69 | `110_詳細業務フロー/**.md`（38）＋一覧のみ（31） |
| flowgroup フローG | `fgroup:` | 17 | `TPC詳細業務フロー一覧.md` の機能グループ |
| table TBL | `table:` | 170 | 各仕様書から抽出した派生。DB仕様と未突合 |
| dataitem データ | `dataitem:` | 29 | バッチ入出力のうち実体ファイルが無いもの |
| actor アクター | `actor:` | 4 | `center` センタ / `customer` 顧客 / `tpc` オバートリップ（本システム） / `external` 他システム・外部 |
| schedule 起動契機 | `sched:` | 10 | `TPC_D01 D03 D05 D07 D08 M03 M08 M09 M10 Z01` |

主なフィールド。`show --json` で全部見える。

- 共通: `id` `kind` `code` `label` `path`（`replaceMd/02_ED書` からの相対）`out` `in`
- screen: `category`（顧客/センタ）`group` `groupLabel` `overview` `tables[{ja,en,crud}]` `sheetNames`
- batch: `area`（`請求(SE)` `収納(SN)` `WebUP(WU)` 等11区分）`schedule` `inputs[]` `outputs[]`（`{name,kind,note}`）
- file: `physical`（実ファイル名）`format` `charset` `itemCount` `funcName`
- flow: `group` `userKind` `steps` `reconstructed`（AI再構成）`missingDetail`（詳細シート無し）
- table: `en`（物理名）`derived`

## 3. エッジ

`{from, to, type, ev[], crud?, byId?, byName?, fromList?}`。

- `ev` は根拠になった原文行。表由来なら `KO006_F01 利用テーブル: セキュリティTBL [CRUD]`、
  本文由来なら該当行そのもの。**回答にはこれを引用する。**
- `byId` はIDが一致した確実なリンク、`byName` は名称一致の推定リンク。
- `fromList` は詳細シートが無く一覧の行だけから作ったリンク（21件）。すべて推定。
- 名称一致の照合キーは6文字以上に制限されている。「請求番号」のような一般語では繋がない。

## 4. ID体系

| 対象 | 形 | 例 |
| --- | --- | --- |
| 画面 | `XXnnn_Fnn` | `SE001_F03` `KO006_F01` |
| バッチ | `XXnnn_Bnn` | `BT016_B01` `MS002_B01` |
| 機能グループ | `XXnnn` | `SE001` `KT005` `MS002` |
| 業務フロー | `GF_nnn` | `GF_030` `GF_303` |
| 起動契機 | `TPC_[DMZ]nn` | `TPC_D05` |
| ファイル・DB・帳票 | `ED_T_<名称>` | `ED_T_請求リストファイル` |

機能部の先頭2文字は業務区分。バッチの区分名は `show <バッチ>` の「業務」に出る。
`SE` 請求 / `SS` 請求データ照会 / `SN` 収納 / `KS` 決済 / `BT` 媒体読込・変換 / `WU` WebUP /
`MS` マスタ（センタ側） / `MK` マスタ（顧客側） / `SO` 統合回線管理 / `KU` 管理機能 /
`KO` 利用者・権限 / `KT` 共通（TOP画面・掲示板）。
画面には利用者区分もある（`show` の「区分」= 顧客 / センタ / 共通）。

## 5. 検出済みの穴

`issues` コマンドで引ける。

| kind | 件数 | 内容 |
| --- | --- | --- |
| orphan | 128 | どの業務フローからも辿れない画面29・バッチ52、入出力元が特定できないファイル47 |
| missing | 40 | 一覧にあるが詳細シートが無い業務フロー。実体は31フロー（`GF_060` 等、行が重複している） |
| unresolved | 30 | 画面遷移図が指す未定義画面14（`ZZ001_F01` 等）、本文の未定義機能ID16 |
| skip | 9 | IDを持たず解析対象外にしたフォルダ（`ED_T_画面遷移図` `ED_T_メニュー一覧` `ED_T_バッチ処理一覧` 等） |

`skip` のフォルダ自体は実在するので、一覧が必要なときは直接 Read する。

## 6. 使用例

```bash
# 画面が触るTBLと、その画面を使う業務フロー
node .claude/skills/ed-doc-query/scripts/ed-query.mjs show SE001_F03 --refs

# TBLを更新している画面・バッチ・フロー（被参照だけ）
node .claude/skills/ed-doc-query/scripts/ed-query.mjs refs 請求書管理TBL --kind table --dir in --limit 50

# バッチを直したときの影響（下流2ホップ、推定を除く）
node .claude/skills/ed-doc-query/scripts/ed-query.mjs trace BT016_B01 --depth 2

# 業務フローが関わる全要素と、読むべき仕様書
node .claude/skills/ed-doc-query/scripts/ed-query.mjs trace GF_030 --depth 1 --json

# ファイル仕様がどのバッチの入出力か
node .claude/skills/ed-doc-query/scripts/ed-query.mjs refs 請求リストファイル --kind file --dir in

# 画面とバッチがどう繋がるか
node .claude/skills/ed-doc-query/scripts/ed-query.mjs path SE001_F03 MS002_B01
```

## 7. 再生成

グラフは `replaceMd/viewer-ed/build-ed-index.mjs` の出力だが、現在このリポジトリに
ビルドスクリプトは残っていない（`ed-graph-data.js` と ビューア一式だけがある）。
手順と抽出ルールは `replaceMd/viewer-ed/README.md` に書かれている。
元の仕様書を更新してもグラフは自動では追随しないので、`stats` が返す `生成` 日時と
`replaceMd/02_ED書` の更新日時がずれていたら、グラフ側が古い可能性を回答に添える。
