#!/usr/bin/env node
// ED書の関係グラフ照会 CLI。replaceMd/viewer-ed/ed-graph-data.js を読んで
// ドキュメント種別間の参照関係をたどり、実体 .md のパスまで返す。依存なし。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------- 定数
const KIND_JA = {
  flow: '業務フロー', flowgroup: 'フローG', screen: '画面', screengroup: '画面機能',
  batch: 'バッチ', batchgroup: 'バッチ機能', file: 'ファイル', dataitem: 'データ',
  table: 'TBL', actor: 'アクター', schedule: '起動契機',
};
const ETYPE_JA = {
  'uses-screen': '画面を使う', 'uses-screengroup': '画面機能を使う', runs: 'バッチを起動',
  'runs-group': 'バッチ機能を起動', 'uses-file': 'ファイルを扱う', touches: 'TBLに触れる',
  crud: 'TBL CRUD', reads: '入力', writes: '出力', 'io-file': '入出力ファイル',
  transition: '画面遷移', performs: '担当', scheduled: '起動契機', contains: '所属',
};
// 各関係が「どの文書のどの項目」から抽出されたか
const SRC_ITEM = {
  crud: '20_画面仕様 01_機能概要【利用テーブル】',
  transition: '20_画面仕様 ED_T_画面遷移図/01_画面遷移一覧',
  'io-file': '60_ファイル仕様 ファイルID前方一致・機能名一致',
  reads: '30_バッチ処理仕様 概要/◆入力一覧',
  writes: '30_バッチ処理仕様 概要/◆出力一覧',
  touches: '110_詳細業務フロー 本文の「〜TBL」',
  runs: '110_詳細業務フロー 本文のバッチID・バッチ名',
  'runs-group': '110_詳細業務フロー 本文の機能ID・機能名',
  'uses-screen': '110_詳細業務フロー 本文の画面ID・画面名',
  'uses-screengroup': '110_詳細業務フロー 本文の機能ID・一覧の名称',
  'uses-file': '110_詳細業務フロー 本文のファイル名',
  performs: '110_詳細業務フロー 本文の担当表記',
  scheduled: '110_詳細業務フロー 本文の TPC_xxx',
  contains: 'IDの階層（機能グループ）',
};
const CERTAIN_BY_TABLE = new Set(['crud', 'reads', 'writes', 'transition', 'io-file', 'contains']);
const DOC_TYPE = {
  flow: '110_詳細業務フロー', flowgroup: '110_詳細業務フロー',
  screen: '20_画面仕様', screengroup: '20_画面仕様',
  batch: '30_バッチ処理仕様', batchgroup: '30_バッチ処理仕様',
  file: '60_ファイル仕様',
};

// ---------------------------------------------------------------- 読み込み
function findRoot(explicit) {
  const cands = explicit ? [explicit] : [process.cwd(), path.resolve(HERE, '../../../..')];
  for (const c of cands) {
    let d = path.resolve(c);
    for (let i = 0; i < 8; i++) {
      if (fs.existsSync(path.join(d, 'replaceMd/viewer-ed/ed-graph-data.js'))) return d;
      const up = path.dirname(d);
      if (up === d) break;
      d = up;
    }
  }
  die('ed-graph-data.js が見つからない。--root <リポジトリルート> を指定する。');
}
function load(root) {
  const raw = fs.readFileSync(path.join(root, 'replaceMd/viewer-ed/ed-graph-data.js'), 'utf8');
  const g = JSON.parse(raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1));
  g.byId = new Map(g.nodes.map((n) => [n.id, n]));
  g.outE = new Map(); g.inE = new Map();
  for (const e of g.edges) {
    if (!g.outE.has(e.from)) g.outE.set(e.from, []);
    if (!g.inE.has(e.to)) g.inE.set(e.to, []);
    g.outE.get(e.from).push(e); g.inE.get(e.to).push(e);
  }
  return g;
}
const die = (m) => { console.error('error: ' + m); process.exit(1); };

// ---------------------------------------------------------------- 検索
const norm = (s) => String(s || '').normalize('NFKC').replace(/[\s\u3000・()（）［］\[\]「」_\-＿]/g, '').toLowerCase();

function search(g, key, kind) {
  const k = norm(key);
  const pool = g.nodes.filter((n) => !kind || n.kind === kind);
  const exact = pool.filter((n) => n.id === key || norm(n.code) === k || norm(n.label) === k || norm(n.name) === k);
  if (exact.length) return exact;
  return pool.filter((n) => [n.id, n.code, n.label, n.name, n.listName, n.funcName, n.physical]
    .some((v) => v && norm(v).includes(k)));
}
function resolveOne(g, key, kind) {
  const hits = search(g, key, kind);
  if (!hits.length) die(`「${key}」に一致するノードが無い。find で探す。`);
  if (hits.length > 1) {
    const exact = hits.filter((n) => n.id === key || norm(n.code) === norm(key));
    if (exact.length === 1) return exact[0];
    console.error(`候補が ${hits.length} 件。1件に絞って再実行する:`);
    hits.slice(0, 20).forEach((n) => console.error(`  ${n.id}  [${KIND_JA[n.kind]}] ${n.label}`));
    process.exit(2);
  }
  return hits[0];
}

// ---------------------------------------------------------------- 実体ファイル
function mdFiles(root, n) {
  if (!n.path) return [];
  const abs = path.join(root, 'replaceMd/02_ED書', n.path);
  if (!fs.existsSync(abs)) return [];
  if (fs.statSync(abs).isDirectory()) {
    return fs.readdirSync(abs).filter((f) => f.endsWith('.md')).sort()
      .map((f) => `replaceMd/02_ED書/${n.path}/${f}`);
  }
  return [`replaceMd/02_ED書/${n.path}`];
}
// TBL名 → 50_データベース仕様 の定義書候補（グラフには無い突合。必ず中身で確認する）
let DB_INDEX = null;
function dbSpecCandidates(root, label) {
  if (!DB_INDEX) {
    const dir = path.join(root, 'replaceMd/02_ED書/50_データベース仕様');
    DB_INDEX = fs.existsSync(dir)
      ? fs.readdirSync(dir).filter((f) => f.endsWith('.md'))
        .map((f) => ({ f, key: norm(f.replace(/^ED_T_/, '').replace(/\.md$/, '')) }))
      : [];
  }
  const keys = new Set();
  const base = norm(label).replace(/db$/, 'tbl');
  keys.add(base);
  const dup = base.match(/^(.*tbl)(.+tbl)$/); // ふりがな連結「請求ﾏｽﾀTBL請求マスタTBL」
  if (dup) { keys.add(dup[1]); keys.add(dup[2]); }
  keys.add(base.replace(/tbl.*$/, 'tbl'));
  const out = [];
  for (const k of keys) {
    if (!k) continue;
    for (const d of DB_INDEX) {
      if (out.some((o) => o.f === d.f)) continue;
      if (d.key === k) out.push({ ...d, how: '完全一致' });
      else if (d.key.startsWith(k) && /^[0-9～~]/.test(d.key.slice(k.length))) out.push({ ...d, how: '分割TBL' });
      else if (d.key.includes(k) && k.length >= 4) out.push({ ...d, how: '部分一致' });
    }
  }
  return out.slice(0, 4).map((o) => ({ file: `replaceMd/02_ED書/50_データベース仕様/${o.f}`, how: o.how }));
}

// ---------------------------------------------------------------- 表示
const conf = (e) => (e.byId ? '確実(ID一致)' : e.byName ? '推定(名称一致)' : CERTAIN_BY_TABLE.has(e.type) ? '確実(表)' : '抽出(本文)');
const tag = (n) => (n ? `${n.id} [${KIND_JA[n.kind] || n.kind}] ${n.label || ''}` : '?');

function printNode(root, g, n, opt) {
  const line = [];
  line.push(`${n.id}`);
  line.push(`種別: ${KIND_JA[n.kind] || n.kind}${DOC_TYPE[n.kind] ? ` (${DOC_TYPE[n.kind]})` : ' (派生ノード。仕様書の実体は無い)'}`);
  if (n.code) line.push(`ID: ${n.code}`);
  line.push(`名称: ${n.label || n.name || ''}`);
  if (n.funcName && n.funcName !== n.label) line.push(`機能名: ${n.funcName}`);
  if (n.groupLabel) line.push(`機能グループ: ${n.group} ${n.groupLabel}`);
  if (n.category) line.push(`区分: ${n.category}`);
  if (n.area) line.push(`業務: ${n.area}`);
  if (n.userKind) line.push(`利用者: ${n.userKind}`);
  if (n.en) line.push(`物理名: ${n.en}`);
  if (n.physical) line.push(`物理ファイル: ${n.physical} (${n.format || ''} 項目数${n.itemCount ?? '-'})`);
  if (n.reconstructed) line.push('注意: AIが図形シートの画像から再構成した本文。原本要確認');
  if (n.missingDetail) line.push('注意: 一覧に行があるだけで詳細シートが無い。関係はすべて推定');
  const ov = Array.isArray(n.overview) ? n.overview.join(' ') : n.overview;
  if (ov) line.push(`概要: ${String(ov).slice(0, 300)}`);
  if (n.tables?.length) line.push(`利用テーブル: ${n.tables.map((t) => `${t.ja}[${t.crud}]`).join(' ')}`);
  if (n.inputs?.length) line.push(`◆入力一覧: ${n.inputs.map((i) => `${i.name}(${i.kind})`).join(' ')}`);
  if (n.outputs?.length) line.push(`◆出力一覧: ${n.outputs.map((i) => `${i.name}(${i.kind})`).join(' ')}`);
  for (const io of [...(n.inputs || []), ...(n.outputs || [])]) {
    if (io.note && /仕様書/.test(io.note)) line.push(`  備考の文書参照: ${io.name} → ${io.note}`);
  }
  line.push(`関係: 発 ${n.out} / 被 ${n.in}`);
  const files = mdFiles(root, n);
  if (files.length) line.push('実体:\n' + files.map((f) => '  ' + f).join('\n'));
  if (n.kind === 'table') {
    const c = dbSpecCandidates(root, n.label);
    line.push('50_データベース仕様の候補（名寄せ。要確認）:\n' + (c.length ? c.map((x) => `  ${x.file} [${x.how}]`).join('\n') : '  なし'));
  }
  console.log(line.join('\n'));
  if (opt.refs) { console.log(''); printRefs(g, n, opt); }
}

function printRefs(g, n, opt) {
  for (const [dir, list] of [['発（このドキュメントが参照）', g.outE.get(n.id) || []], ['被（このドキュメントを参照）', g.inE.get(n.id) || []]]) {
    if (opt.dir && !dir.startsWith(opt.dir === 'out' ? '発' : '被')) continue;
    const groups = new Map();
    for (const e of list) {
      if (opt.type && e.type !== opt.type) continue;
      if (opt.certain && (e.byName && !e.byId)) continue;
      if (!groups.has(e.type)) groups.set(e.type, []);
      groups.get(e.type).push(e);
    }
    console.log(`== ${dir} ==`);
    if (!groups.size) { console.log('  なし'); continue; }
    for (const [t, es] of [...groups].sort((a, b) => b[1].length - a[1].length)) {
      const other = dir.startsWith('発') ? g.byId.get(es[0].to) : g.byId.get(es[0].from);
      const otherDoc = DOC_TYPE[other?.kind] || `派生:${KIND_JA[other?.kind] || '?'}`;
      console.log(`-- ${ETYPE_JA[t] || t} (${es.length}件) 参照元項目: ${SRC_ITEM[t] || '-'} / 相手: ${otherDoc}`);
      for (const e of es.slice(0, opt.limit)) {
        const o = g.byId.get(dir.startsWith('発') ? e.to : e.from);
        console.log(`   ${tag(o)}${e.crud ? ` [${e.crud}]` : ''}  ${conf(e)}`);
        if (opt.ev !== false) for (const v of (e.ev || []).slice(0, 2)) console.log(`      根拠: ${String(v).replace(/\s+/g, ' ').slice(0, 160)}`);
      }
      if (es.length > opt.limit) console.log(`   ... 他 ${es.length - opt.limit} 件 (--limit で増やす)`);
    }
  }
}

// ---------------------------------------------------------------- コマンド
const CMDS = {
  find(g, root, args, opt) {
    const hits = search(g, args.join(' '), opt.kind);
    if (opt.json) return json(hits.map((n) => pick(n)));
    console.log(`${hits.length} 件`);
    hits.slice(0, opt.limit * 3).forEach((n) => console.log(`${tag(n)}  発${n.out}/被${n.in}${n.path ? '  ' + n.path : ''}`));
  },
  show(g, root, args, opt) {
    const n = resolveOne(g, args.join(' '), opt.kind);
    if (opt.json) return json({ ...pick(n), files: mdFiles(root, n) });
    printNode(root, g, n, opt);
  },
  refs(g, root, args, opt) {
    const n = resolveOne(g, args.join(' '), opt.kind);
    if (opt.json) {
      const conv = (es, k) => es.filter((e) => !opt.type || e.type === opt.type)
        .map((e) => ({ type: e.type, label: ETYPE_JA[e.type], item: SRC_ITEM[e.type], conf: conf(e), crud: e.crud, node: pick(g.byId.get(e[k])), ev: e.ev }));
      return json({ node: pick(n), out: conv(g.outE.get(n.id) || [], 'to'), in: conv(g.inE.get(n.id) || [], 'from') });
    }
    console.log(tag(n) + '\n');
    printRefs(g, n, opt);
  },
  files(g, root, args, opt) {
    const n = resolveOne(g, args.join(' '), opt.kind);
    const f = mdFiles(root, n);
    if (opt.json) return json({ id: n.id, files: f });
    if (!f.length) console.log('実体ファイル無し（派生ノード）');
    f.forEach((x) => console.log(x));
  },
  trace(g, root, args, opt) {
    const start = resolveOne(g, args.join(' '), opt.kind);
    const depth = opt.depth || 2;
    const seen = new Map([[start.id, 0]]);
    let cur = [start.id];
    const rows = [];
    for (let d = 1; d <= depth; d++) {
      const next = [];
      for (const id of cur) {
        const es = opt.dir === 'in' ? (g.inE.get(id) || []) : (g.outE.get(id) || []);
        for (const e of es) {
          if (opt.type && e.type !== opt.type) continue;
          if (e.type === 'contains' && !opt.contains) continue;
          const oid = opt.dir === 'in' ? e.from : e.to;
          if (seen.has(oid)) continue;
          seen.set(oid, d);
          next.push(oid);
          rows.push({ d, from: id, to: oid, type: e.type, conf: conf(e) });
        }
      }
      cur = next;
      if (!cur.length) break;
    }
    if (opt.json) return json(rows.map((r) => ({ ...r, fromNode: pick(g.byId.get(r.from)), toNode: pick(g.byId.get(r.to)) })));
    console.log(`${tag(start)} から ${opt.dir === 'in' ? '被' : '発'}方向 ${depth} ホップ: ${rows.length} 関係 / ${seen.size - 1} ノード\n`);
    const byDepth = {};
    rows.forEach((r) => (byDepth[r.d] = byDepth[r.d] || []).push(r));
    for (const d of Object.keys(byDepth)) {
      console.log(`-- ${d} ホップ (${byDepth[d].length})`);
      byDepth[d].slice(0, opt.limit * 2).forEach((r) => console.log(`   ${tag(g.byId.get(r.from))}  --${ETYPE_JA[r.type] || r.type}-->  ${tag(g.byId.get(r.to))}  ${r.conf}`));
      if (byDepth[d].length > opt.limit * 2) console.log(`   ... 他 ${byDepth[d].length - opt.limit * 2} 件`);
    }
  },
  path(g, root, args, opt) {
    if (args.length < 2) die('path <起点> <終点>');
    const a = resolveOne(g, args[0], null), b = resolveOne(g, args[1], null);
    const prev = new Map([[a.id, null]]);
    let cur = [a.id], found = false;
    while (cur.length && !found) {
      const next = [];
      for (const id of cur) {
        for (const e of [...(g.outE.get(id) || []), ...(g.inE.get(id) || [])]) {
          const oid = e.from === id ? e.to : e.from;
          if (prev.has(oid)) continue;
          prev.set(oid, { id, e });
          if (oid === b.id) { found = true; break; }
          next.push(oid);
        }
        if (found) break;
      }
      cur = next;
    }
    if (!prev.has(b.id)) return console.log('経路なし');
    const chain = [];
    for (let x = b.id; prev.get(x); x = prev.get(x).id) chain.unshift({ to: x, ...prev.get(x) });
    if (opt.json) return json(chain.map((c) => ({ from: pick(g.byId.get(c.id)), to: pick(g.byId.get(c.to)), type: c.e.type, conf: conf(c.e), reverse: c.e.from !== c.id })));
    console.log(tag(a) + '   ※関係の向きは問わずに最短で繋いだ経路。<-- は逆向きの参照');
    chain.forEach((c) => {
      const rev = c.e.from !== c.id;
      console.log(`  ${rev ? '<--' : '  --'}${ETYPE_JA[c.e.type] || c.e.type} (${conf(c.e)})${rev ? '--' : '-->'}  ${tag(g.byId.get(c.to))}`);
    });
  },
  matrix(g, root, args, opt) {
    const m = new Map();
    for (const e of g.edges) {
      if (e.type === 'contains' && !opt.contains) continue;
      const a = g.byId.get(e.from), b = g.byId.get(e.to);
      if (!a || !b) continue;
      const k = `${DOC_TYPE[a.kind] || KIND_JA[a.kind]}\t${ETYPE_JA[e.type] || e.type}\t${SRC_ITEM[e.type] || '-'}\t${DOC_TYPE[b.kind] || `派生:${KIND_JA[b.kind]}`}`;
      const v = m.get(k) || { n: 0, id: 0, name: 0 };
      v.n++; if (e.byId) v.id++; if (e.byName) v.name++;
      m.set(k, v);
    }
    const rows = [...m].sort((x, y) => y[1].n - x[1].n)
      .map(([k, v]) => { const [src, rel, item, dst] = k.split('\t'); return { src, rel, item, dst, ...v }; });
    if (opt.json) return json(rows);
    console.log('参照元\t関係\t参照元の項目\t参照先\t件数\tID一致\t名称一致');
    rows.forEach((r) => console.log(`${r.src}\t${r.rel}\t${r.item}\t${r.dst}\t${r.n}\t${r.id}\t${r.name}`));
  },
  issues(g, root, args, opt) {
    const list = g.issues.filter((i) => !opt.kind || i.kind === opt.kind);
    if (opt.json) return json(list);
    const by = {};
    list.forEach((i) => (by[i.kind] = by[i.kind] || []).push(i));
    for (const [k, v] of Object.entries(by)) {
      console.log(`== ${k} (${v.length}) ==`);
      v.slice(0, opt.limit * 5).forEach((i) => console.log(`  ${i.msg}${i.where ? '  @' + i.where : ''}`));
      if (v.length > opt.limit * 5) console.log(`  ... 他 ${v.length - opt.limit * 5} 件`);
    }
  },
  stats(g, root, args, opt) {
    if (opt.json) return json({ meta: g.meta, kinds: count(g.nodes.map((n) => n.kind)), types: count(g.edges.map((e) => e.type)) });
    console.log(`生成: ${g.meta.generated}  ノード ${g.nodes.length} / 関係 ${g.edges.length}`);
    console.log('ノード種別: ' + Object.entries(count(g.nodes.map((n) => n.kind))).map(([k, v]) => `${KIND_JA[k] || k}=${v}`).join(' '));
    console.log('関係種別: ' + Object.entries(count(g.edges.map((e) => e.type))).map(([k, v]) => `${ETYPE_JA[k] || k}=${v}`).join(' '));
  },
};

const count = (a) => a.reduce((o, k) => ((o[k] = (o[k] || 0) + 1), o), {});
const pick = (n) => n && { id: n.id, kind: n.kind, kindJa: KIND_JA[n.kind], docType: DOC_TYPE[n.kind] || null, code: n.code, label: n.label, path: n.path || null, out: n.out, in: n.in };
const json = (x) => console.log(JSON.stringify(x, null, 1));

// ---------------------------------------------------------------- 引数
const argv = process.argv.slice(2);
const opt = { limit: 12, dir: null, kind: null, type: null, depth: 2, json: false, refs: false, contains: false, certain: false };
const rest = [];
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === '--json') opt.json = true;
  else if (a === '--refs') opt.refs = true;
  else if (a === '--contains') opt.contains = true;
  else if (a === '--certain') opt.certain = true;
  else if (a === '--no-ev') opt.ev = false;
  else if (a.startsWith('--')) opt[a.slice(2)] = argv[++i];
  else rest.push(a);
}
opt.limit = Number(opt.limit) || 12;
opt.depth = Number(opt.depth) || 2;

const cmd = rest.shift();
if (!cmd || !CMDS[cmd]) {
  console.log(`使い方: node ed-query.mjs <command> [key] [options]

  find <語>          種別横断でノードを探す (--kind screen|batch|file|flow|table|screengroup|batchgroup)
  show <key>         ノード詳細＋実体 .md のパス (--refs で参照関係も)
  refs <key>         発/被の参照を関係種別ごとに根拠付きで (--dir out|in --type crud --certain)
  files <key>        実体 .md のパスだけ返す
  trace <key>        多段トレース (--depth N --dir out|in --type ...)
  path <A> <B>       2ノード間の最短経路
  matrix             ドキュメント種別 × 関係 × 参照元項目 の集計（TSV）
  issues             未解決参照・孤立・詳細なしフロー (--kind orphan|missing|unresolved|skip)
  stats              件数サマリ

  共通: --json --limit N --root <repo>
  key は ノードID / ID(SE001_F03, BT016_B01, GF_030, KO006) / 名称の部分一致`);
  process.exit(cmd ? 1 : 0);
}
const root = findRoot(opt.root);
CMDS[cmd](load(root), root, rest, opt);
