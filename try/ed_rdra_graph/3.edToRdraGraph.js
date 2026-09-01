#!/usr/bin/env node
'use strict';

/**
 * ED 書のグラフデータ（viewer-ed/ed-graph-data.js）を
 * RDRAGraph の「関連データ」（1行目=システム名／2行目以降=関係・モデル1・モデル2・オブジェクト結合文字列）へ変換する。
 *
 * 使い方:
 *   node try/ed_rdra_graph/3.edToRdraGraph.js
 *   node try/ed_rdra_graph/3.edToRdraGraph.js --input replaceMd/viewer-ed/ed-graph-data.js --system オバートリップ
 */

const fs = require('fs');
const path = require('path');

const PROJECT_ROOT = path.resolve(__dirname, '../..');

const DEFAULTS = {
  input: path.join(PROJECT_ROOT, 'replaceMd', 'viewer-ed', 'ed-graph-data.js'),
  outDir: __dirname,
  baseName: 'ed-rdra-graph',
  system: '',
  noMd: false,
};

/** ED のノード種別 → RDRA モデル */
const MODEL_BY_KIND = {
  flowgroup: '業務',
  flow: 'BUC',
  screengroup: 'アクティビティ',
  batchgroup: 'アクティビティ',
  screen: 'UC',
  batch: 'UC',
  table: '情報',
  file: '情報',
  dataitem: '情報',
  actor: 'アクター',
  schedule: 'タイマー',
};

/** ED のエッジ（fromの種別|type|toの種別）→ RDRA の関係 */
const RELATION_BY_EDGE = {
  'flowgroup|contains|flow': '#child',
  'flow|uses-screengroup|screengroup': '#child',
  'flow|runs-group|batchgroup': '#child',
  'screengroup|contains|screen': '#edge',
  'batchgroup|contains|batch': '#edge',
  'flow|uses-screen|screen': '#edge',
  'flow|runs|batch': '#edge',
  'flow|performs|actor': '#edge',
  'flow|touches|table': '#edge',
  'flow|uses-file|file': '#edge',
  'flow|scheduled|schedule': '#edge',
  'screen|crud|table': '#edge',
  'screen|io-file|file': '#edge',
  'screen|transition|screen': '#arrow',
  'batch|reads|table': '#edge',
  'batch|writes|table': '#edge',
  'batch|reads|file': '#edge',
  'batch|writes|file': '#edge',
  'batch|reads|dataitem': '#edge',
  'batch|writes|dataitem': '#edge',
};

/** 出力する行（関係／モデル1／モデル2）の並び順 */
const ROW_ORDER = [
  '#child\t業務\tBUC',
  '#child\tBUC\tアクティビティ',
  '#edge\tBUC\tアクティビティ',
  '#edge\tアクティビティ\tUC',
  '#edge\tBUC\tUC',
  '#arrow\tUC\tUC',
  '#edge\tBUC\tアクター',
  '#edge\tBUC\t外部システム',
  '#edge\tBUC\tタイマー',
  '#edge\tBUC\t情報',
  '#edge\tUC\t情報',
  '#comment\t業務\t説明',
  '#comment\tBUC\t説明',
  '#comment\tアクティビティ\t説明',
  '#comment\tUC\t説明',
  '#comment\t情報\t説明',
];

function parseArgs(argv) {
  const opts = { ...DEFAULTS };
  for (let i = 2; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '-h' || a === '--help') opts.help = true;
    else if (a === '--input') opts.input = path.resolve(argv[++i]);
    else if (a === '--out-dir') opts.outDir = path.resolve(argv[++i]);
    else if (a === '--base-name') opts.baseName = argv[++i];
    else if (a === '--system') opts.system = argv[++i];
    else if (a === '--no-md') opts.noMd = true;
    else throw new Error(`不明な引数: ${a}`);
  }
  return opts;
}

function printHelp() {
  console.log(`ED グラフデータ → RDRAGraph 関連データ 変換

  node try/ed_rdra_graph/3.edToRdraGraph.js [options]

  --input <path>      入力 ed-graph-data.js（既定: replaceMd/viewer-ed/ed-graph-data.js）
  --out-dir <path>    出力ディレクトリ（既定: try/ed_rdra_graph）
  --base-name <name>  出力ファイル名のベース（既定: ed-rdra-graph）
  --system <name>     1行目のシステム名（既定: データから推定）
  --no-md             解説付き .md を出力しない
  -h, --help          この表示`);
}

function loadGraph(file) {
  const src = fs.readFileSync(file, 'utf8');
  const start = src.indexOf('{');
  if (start < 0) throw new Error(`JSON が見つかりません: ${file}`);
  return JSON.parse(src.slice(start).replace(/;\s*$/, ''));
}

/** 関連データの区切り文字（TAB / @@ / //）と改行を含まない一行文字列にする */
function sanitize(text) {
  return String(text ?? '')
    .replace(/[\t\r\n]+/g, ' ')
    .replace(/@@/g, '＠＠')
    .replace(/\/\//g, '／／')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function joinText(value) {
  if (Array.isArray(value)) return value.map((v) => sanitize(v)).filter(Boolean).join(' ');
  return sanitize(value);
}

/** ノード種別ごとのオブジェクト名（RDRA のオブジェクト名） */
function baseNameOf(node) {
  const label = sanitize(node.label || node.name || node.code || node.id);
  switch (node.kind) {
    case 'flow':
    case 'screen':
    case 'batch':
    case 'screengroup':
    case 'batchgroup': {
      const code = sanitize(node.code);
      return code && !label.startsWith(code) ? `${code} ${label}` : label;
    }
    default:
      return label;
  }
}

/** モデル内でオブジェクト名が衝突する場合に識別子を付けて一意化する */
function buildNameIndex(nodes, modelOf) {
  const names = new Map();
  const buckets = new Map();
  for (const node of nodes) {
    const model = modelOf(node);
    if (!model) continue;
    const key = `${model}\u0000${baseNameOf(node)}`;
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(node);
  }
  for (const [key, group] of buckets) {
    const base = key.split('\u0000')[1];
    if (group.length === 1) {
      names.set(group[0].id, base);
      continue;
    }
    const used = new Set();
    group.forEach((node, i) => {
      const hint = sanitize(node.ownerCode || node.code || node.en || node.funcName) || String(i + 1);
      let name = `${base}（${hint}）`;
      if (used.has(name)) name = `${base}（${hint}-${i + 1}）`;
      used.add(name);
      names.set(node.id, name);
    });
  }
  return names;
}

/** ED の説明系フィールド → #comment 用のテキスト */
function describe(node) {
  switch (node.kind) {
    case 'flow':
      return joinText(node.overview) || joinText(node.remark);
    case 'screen':
    case 'batch':
      return joinText(node.desc) || joinText(node.overview);
    case 'screengroup':
      return node.category ? `カテゴリ：${sanitize(node.category)}` : '';
    case 'batchgroup':
      return node.area ? `エリア：${sanitize(node.area)}` : '';
    case 'table':
      return node.en ? `テーブル物理名：${sanitize(node.en)}` : '';
    case 'file': {
      const parts = [];
      if (node.physical) parts.push(`物理ファイル：${sanitize(node.physical)}`);
      if (node.format) parts.push(`形式：${sanitize(node.format)}`);
      if (node.itemCount) parts.push(`項目数：${node.itemCount}`);
      if (node.funcName) parts.push(`出力機能：${sanitize(node.funcName)}`);
      // 属性が空でも、関連を持たないファイルがグラフから消えないよう仕様書パスを残す
      if (!parts.length && node.path) parts.push(`仕様書：${sanitize(node.path)}`);
      return parts.join(' ');
    }
    case 'dataitem':
      return node.ioKind ? `入出力区分：${sanitize(node.ioKind)}` : '';
    default:
      return '';
  }
}

function guessSystemName(graph) {
  const self = graph.nodes.find((n) => n.kind === 'actor' && /本システム/.test(n.label || ''));
  if (self) return sanitize(self.label).replace(/[（(].*?[)）]/g, '').trim();
  return sanitize(graph.meta?.root) || 'システム';
}

function convert(graph, systemName) {
  const nodeById = new Map(graph.nodes.map((n) => [n.id, n]));

  // 「他システム・外部」レーンはアクターではなく外部システムとして扱う
  const modelOf = (node) => {
    if (!node) return '';
    if (node.kind === 'actor' && node.id === 'actor:external') return '外部システム';
    return MODEL_BY_KIND[node.kind] || '';
  };

  const nameById = buildNameIndex(graph.nodes, modelOf);

  const rows = new Map(); // "関係\tモデル1\tモデル2" -> {pairs:Set, order:[]}
  const addPair = (relation, model1, model2, object1, object2) => {
    if (!relation || !model1 || !model2 || !object1 || !object2) return false;
    const key = `${relation}\t${model1}\t${model2}`;
    if (!rows.has(key)) rows.set(key, { pairs: new Set(), order: [] });
    const row = rows.get(key);
    const pair = `${object1}@@${object2}`;
    if (row.pairs.has(pair)) return false;
    row.pairs.add(pair);
    row.order.push(pair);
    return true;
  };

  const stats = { edges: 0, mapped: 0, duplicated: 0, comments: 0 };
  const unknown = new Map();
  const missing = new Set();

  for (const edge of graph.edges) {
    stats.edges += 1;
    const from = nodeById.get(edge.from);
    const to = nodeById.get(edge.to);
    if (!from || !to) {
      missing.add(!from ? edge.from : edge.to);
      continue;
    }
    const signature = `${from.kind}|${edge.type}|${to.kind}`;
    const relation = RELATION_BY_EDGE[signature];
    if (!relation) {
      unknown.set(signature, (unknown.get(signature) || 0) + 1);
      continue;
    }
    const added = addPair(relation, modelOf(from), modelOf(to), nameById.get(from.id), nameById.get(to.id));
    if (added) stats.mapped += 1;
    else stats.duplicated += 1;
  }

  for (const node of graph.nodes) {
    const model = modelOf(node);
    if (!model) continue;
    const text = describe(node);
    if (!text) continue;
    if (addPair('#comment', model, '説明', nameById.get(node.id), text)) stats.comments += 1;
  }

  const orderedKeys = [
    ...ROW_ORDER.filter((k) => rows.has(k)),
    ...[...rows.keys()].filter((k) => !ROW_ORDER.includes(k)).sort(),
  ];

  const lines = [systemName];
  for (const key of orderedKeys) {
    lines.push(`${key}\t${rows.get(key).order.join('//')}`);
  }

  return {
    tsv: `${lines.join('\n')}\n`,
    rows: orderedKeys.map((k) => ({ key: k, count: rows.get(k).order.length })),
    stats,
    unknown,
    missing,
    nameById,
    modelOf,
  };
}

function buildMarkdown(graph, result, systemName, opts) {
  // 種別 × モデルで実際の件数を数える（actor は外部システムに分かれる）
  const pairCounts = new Map();
  for (const node of graph.nodes) {
    const model = result.modelOf(node);
    if (!model) continue;
    const key = `${node.kind}\u0000${model}`;
    pairCounts.set(key, (pairCounts.get(key) || 0) + 1);
  }

  const modelCounts = {};
  for (const [key, count] of pairCounts) {
    const model = key.split('\u0000')[1];
    modelCounts[model] = (modelCounts[model] || 0) + count;
  }

  const kindRows = [...pairCounts]
    .sort((a, b) => {
      const kinds = Object.keys(MODEL_BY_KIND);
      return kinds.indexOf(a[0].split('\u0000')[0]) - kinds.indexOf(b[0].split('\u0000')[0]);
    })
    .map(([key, count]) => {
      const [kind, model] = key.split('\u0000');
      const note = kind === 'actor' && model === '外部システム' ? '（`actor:external`）' : '';
      return `| \`${kind}\`${note} | ${model} | ${count} |`;
    })
    .join('\n');

  const modelRows = Object.entries(modelCounts)
    .map(([model, count]) => `| ${model} | ${count} |`)
    .join('\n');

  const inputRel = path.relative(PROJECT_ROOT, opts.input).replace(/\\/g, '/');

  const edgeRows = Object.entries(RELATION_BY_EDGE)
    .map(([sig, rel]) => {
      const [fromKind, type, toKind] = sig.split('|');
      const m1 = MODEL_BY_KIND[fromKind];
      const m2 = MODEL_BY_KIND[toKind];
      return `| \`${fromKind}\` --${type}--> \`${toKind}\` | ${rel} | ${m1} | ${m2} |`;
    })
    .join('\n');

  const dataRows = result.rows.map((r) => `| ${r.key.split('\t').join(' | ')} | ${r.count} |`).join('\n');

  return `# ED 書 → RDRAGraph 関連データ

\`${inputRel}\` を
RDRAGraph の関連データ形式（\`RDRA_knowledge/RDRAGraph.md\`）へ変換したもの。

- システム名（1行目）: **${systemName}**
- 生成元データ: ${graph.meta?.generated ?? '-'} / ルート \`${graph.meta?.root ?? '-'}\`
- ノード ${graph.nodes.length} 件 / エッジ ${graph.edges.length} 件
- 変換結果: 関連 ${result.stats.mapped} 件（重複統合 ${result.stats.duplicated} 件）＋ 説明 ${result.stats.comments} 件
- 関連データ本体: \`${opts.baseName}.tsv\`（TAB 区切り。RDRAGraph へそのまま貼り付け可）
- 再生成: \`node try/ed_rdra_graph/3.edToRdraGraph.js\`

## モデルの対応

| ED ノード種別 | RDRA モデル | 件数 |
|---|---|---|
${kindRows}

RDRA モデル別のオブジェクト数は次のとおり。

| RDRA モデル | オブジェクト数 |
|---|---|
${modelRows}

RDRA の構造規則（\`RDRA.md\`）に沿って次のように解釈している。

- 「BUC は業務フローの単位になる」ため、詳細業務フロー（\`GF_xxx\`）を **BUC**、その業務フロー群を **業務** とした
- 「アクティビティは意味をもったまとまった一つの作業」のため、画面／バッチの機能グループ（\`KO006\`・\`BT016\` 等）を **アクティビティ** とした
- 「UC はシステムを使ってまとまった一つの意味をもつ作業」のため、個々の画面・バッチ機能を **UC** とした
- 「UC は情報を操作する」ため、テーブル・ファイル・データ項目を **情報** に集約した
- 業務フローのレーンのうち「他システム・外部」だけは **外部システム**、それ以外を **アクター** とした
- バッチのジョブネット（\`TPC_D01\` 等）を **タイマー** とした

## エッジの対応

| ED エッジ | 関係 | モデル1 | モデル2 |
|---|---|---|---|
${edgeRows}

## 出力された関連データの行

| 関係 | モデル1 | モデル2 | 関連数 |
|---|---|---|---|
${dataRows}

## 変換で落ちる情報

- \`crud\`（CRUD 種別）と \`reads\` / \`writes\` の区別: RDRA の \`#edge UC 情報\` は属性を持てないため、すべて同一の関連に統合している
- \`ev\`（根拠となる記述の引用）・\`issues\`（整合性の指摘 ${graph.issues?.length ?? 0} 件）・\`docChunk\`（本文チャンク）: 関連データに対応する表現がないため出力しない
- 状態モデル・状態・条件・バリエーション: ED 書のグラフデータに該当する情報がないため出力しない

## 関連データ（\`${opts.baseName}.tsv\` と同一内容）

\`\`\`
${result.tsv.trimEnd()}
\`\`\`
`;
}

function main() {
  let opts;
  try {
    opts = parseArgs(process.argv);
  } catch (err) {
    console.error(err.message);
    printHelp();
    process.exit(1);
  }
  if (opts.help) {
    printHelp();
    return;
  }

  const graph = loadGraph(opts.input);
  const systemName = opts.system || guessSystemName(graph);
  const result = convert(graph, systemName);

  fs.mkdirSync(opts.outDir, { recursive: true });
  const tsvPath = path.join(opts.outDir, `${opts.baseName}.tsv`);
  fs.writeFileSync(tsvPath, result.tsv, 'utf8');
  console.log(`[出力] ${tsvPath}`);

  if (!opts.noMd) {
    const mdPath = path.join(opts.outDir, `${opts.baseName}.md`);
    fs.writeFileSync(mdPath, buildMarkdown(graph, result, systemName, opts), 'utf8');
    console.log(`[出力] ${mdPath}`);
  }

  console.log(`システム名: ${systemName}`);
  console.log(`エッジ ${result.stats.edges} 件 → 関連 ${result.stats.mapped} 件（重複統合 ${result.stats.duplicated} 件）`);
  console.log(`説明（#comment）: ${result.stats.comments} 件`);
  console.log(`関連データ行数: ${result.rows.length} 行`);
  for (const row of result.rows) console.log(`  ${row.key.replace(/\t/g, ' / ')} : ${row.count}`);

  if (result.unknown.size) {
    console.warn('未対応のエッジがありました:');
    for (const [sig, count] of result.unknown) console.warn(`  ${sig} : ${count}`);
  }
  if (result.missing.size) {
    console.warn(`ノード未定義の参照: ${[...result.missing].join(', ')}`);
  }
}

main();
