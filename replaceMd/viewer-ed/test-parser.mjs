#!/usr/bin/env node
/* ed-parser.js の回帰テスト
 *
 *   node test-parser.mjs
 *
 * ふりがな除去（stripRuby）は「削りすぎ」も「残しすぎ」も表示を壊す。
 * KATAKANA_TAIL_KEEP や RUBY_WINDOW を触ったら必ずこれを通す。
 */
import path from 'node:path';
import url from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const P = require(path.join(path.dirname(url.fileURLToPath(import.meta.url)), 'ed-parser.js'));

// そのまま残さなければならないもの（語尾が正当なカタカナ、またはふりがなが無い）
const KEEP = [
  '詳細業務フロー',
  'モバイル回線別レポート',
  '一括ダウンロード-組織別データ',
  '媒体取込（CUSTOM）',
  '業務日付更新',
  '媒体読込',
  '年次レポート',
  '組織・回線別集計データ',
  '印刷IF送信(請求書・事前通知書)(TPC⇒SmaB)',
  '媒体フォーマット変換（ソフトバンクモバイル）',
  '請求内訳カスタマイズダウンロード設定',
  'WebUp請求確定(加減算一括)',
  'スケジュール(スケジュール設定)',
  '請求書PDF管理TBL',
  '媒体到着スケジュール',
];

// 末尾のふりがなを落とさなければならないもの
const STRIP = {
  '掲示板ケイジバン': '掲示板',
  'TOP画面（顧客）ガメンコキャク': 'TOP画面（顧客）',
  '請求書情報一覧CSVセイキュウショジョウホウイチラン': '請求書情報一覧CSV',
  '権限設定ケンゲンセッテイ': '権限設定',
  '収納(振替　領収書送付)リョウシュウショソウフ': '収納(振替　領収書送付)',
  '請求書発行承認／請求書情報セイキュウショハッコウショウニンセイキュウショジョウホウ': '請求書発行承認／請求書情報',
  '突合ファイル抽出(日次)トツゴウチュウシュツニチジ': '突合ファイル抽出(日次)',
  '内訳分類、回線番号登録ウチワケブンルイカイセンバンゴウトウロク': '内訳分類、回線番号登録',
  'WebUp請求確定(センタ公開)コウカイ': 'WebUp請求確定(センタ公開)',
  'WebUp請求確定(個社別処理)　コシャベツショリ': 'WebUp請求確定(個社別処理)',
  'バッチ処理一覧ショリイチラン': 'バッチ処理一覧',
  // 実データに出る見出しセルの形（システム名は 1294 箇所、機能名は 1262 箇所）
  'システム名メイ': 'システム名',
  '機能名キノウメイ': '機能名',
  '前提条件・制約事項ゼンテイジョウケンセイヤクジコウ': '前提条件・制約事項',
};

// 照合キー（matchKey）は表記ゆれを吸収して同じ値になること
const SAME_KEY = [
  ['ＳＥ００１', 'SE001'],
  ['請求書 情報', '請求書情報'],
  ['請求書（情報）', '請求書情報'],
  ['請求書_情報', '請求書情報'],
];

let fail = 0;
const bad = (msg) => { console.log('  FAIL ' + msg); fail++; };

for (const s of KEEP) {
  const r = P.stripRuby(s);
  if (r !== s) bad(`stripRuby は変えてはいけない: 「${s}」 => 「${r}」`);
}
for (const [s, expect] of Object.entries(STRIP)) {
  const r = P.stripRuby(s);
  if (r !== expect) bad(`stripRuby: 「${s}」 => 「${r}」 期待「${expect}」`);
}
for (const [a, b] of SAME_KEY) {
  if (P.matchKey(a) !== P.matchKey(b)) bad(`matchKey が一致しない: 「${a}」(${P.matchKey(a)}) ≠ 「${b}」(${P.matchKey(b)})`);
}

// Excel ダンプ表のパース
{
  const md = [
    '# サンプル - シート',
    '',
    '|     | A | B | C |',
    '| --- | --- | --- | --- |',
    '| **1** | 機能名キノウメイ |  | 請求書情報画面 |',
    '| **3** |  | 値1<br>値2 |  |',
  ].join('\n');
  const { grid, title, isTable } = P.parseSheet(md);
  if (title !== 'サンプル - シート') bad(`parseSheet のタイトル: ${title}`);
  if (!isTable) bad('parseSheet が表と認識しない');
  if (grid[0][0] !== '機能名キノウメイ') bad(`A1 のセル: ${grid[0][0]}`);
  if (grid[0][2] !== '請求書情報画面') bad(`C1 のセル: ${grid[0][2]}`);
  if (grid[1] && grid[1].length) bad('行番号 2 は空行として保たれるべき');
  if (grid[2][1] !== '値1\n値2') bad(`<br> の展開: ${JSON.stringify(grid[2][1])}`);
  if (P.valueRightOf(grid, /^機能名$/) !== '請求書情報画面') bad('valueRightOf がラベルの右隣を取れない');
}

const total = KEEP.length + Object.keys(STRIP).length + SAME_KEY.length + 6;
console.log(fail ? `\n${fail} 件失敗 / ${total} 件` : `全 ${total} 件パス`);
process.exit(fail ? 1 : 0);
