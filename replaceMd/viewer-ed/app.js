/* ED書 業務フロー関係性ビューア */
(function () {
'use strict';

const G = window.__ED_GRAPH__;
const P = window.EDParser;
if (!G) { document.getElementById('boot').textContent = 'ed-graph-data.js が読めない。node build-ed-index.mjs を実行して生成する。'; return; }

const $ = (s, r) => (r || document).querySelector(s);
const $$ = (s, r) => [...(r || document).querySelectorAll(s)];
const esc = P.esc;

// ---------------------------------------------------------------- index
const N = new Map(G.nodes.map((n) => [n.id, n]));
const OUT = new Map(), IN = new Map();
for (const e of G.edges) {
  (OUT.get(e.from) || OUT.set(e.from, []).get(e.from)).push(e);
  (IN.get(e.to) || IN.set(e.to, []).get(e.to)).push(e);
}
const out = (id) => OUT.get(id) || [];
const inc = (id) => IN.get(id) || [];

const KIND = {
  flow:        { label: '業務フロー', color: 'var(--k-flow)',   raw: '#f0a04b' },
  flowgroup:   { label: 'フローG',   color: 'var(--k-group)',  raw: '#7d8794' },
  screen:      { label: '画面',       color: 'var(--k-screen)', raw: '#58a6ff' },
  screengroup: { label: '画面機能',   color: '#3d6fa8',         raw: '#3d6fa8' },
  batch:       { label: 'バッチ',     color: 'var(--k-batch)',  raw: '#a685f7' },
  batchgroup:  { label: 'バッチ機能', color: '#6f56a8',         raw: '#6f56a8' },
  file:        { label: 'ファイル',   color: 'var(--k-file)',   raw: '#4ec9a7' },
  dataitem:    { label: 'データ',     color: '#3a8f78',         raw: '#3a8f78' },
  table:       { label: 'TBL',        color: 'var(--k-table)',  raw: '#e06c9f' },
  actor:       { label: 'アクター',   color: 'var(--k-actor)',  raw: '#d7dae0' },
  schedule:    { label: '起動契機',   color: 'var(--k-sched)',  raw: '#c9b458' },
};
const ETYPE = {
  'uses-screen':      { label: '画面を使う',       raw: '#58a6ff' },
  'uses-screengroup': { label: '画面機能を使う',   raw: '#3d6fa8' },
  'runs':             { label: 'バッチを起動',     raw: '#a685f7' },
  'runs-group':       { label: 'バッチ機能を起動', raw: '#6f56a8' },
  'uses-file':        { label: 'ファイルを扱う',   raw: '#4ec9a7' },
  'touches':          { label: 'TBLに触れる',      raw: '#e06c9f' },
  'crud':             { label: 'TBL CRUD',         raw: '#c25b86' },
  'reads':            { label: '入力',             raw: '#7fb3d5' },
  'writes':           { label: '出力',             raw: '#e8955b' },
  'io-file':          { label: '入出力ファイル',   raw: '#4ec9a7' },
  'transition':       { label: '画面遷移',         raw: '#8b93a1' },
  'performs':         { label: '担当',             raw: '#9aa2b1' },
  'scheduled':        { label: '起動契機',         raw: '#c9b458' },
  'contains':         { label: '所属',             raw: '#555c68' },
};

const state = {
  view: 'flow',
  flow: null,
  doc: null,
  sel: null,
  ruby: false,
};

// ふりがな表示トグル。build 時に除去済みの label と、原文とを切り替える。
const disp = (s) => (s == null ? '' : state.ruby ? String(s) : P.stripRuby(String(s)));
const labelOf = (n) => (n ? disp(n.label || n.name || n.id) : '?');

// ---------------------------------------------------------------- boot
$('#boot').remove();
$('#top').hidden = false;
$('#main').hidden = false;

$$('#tabs button').forEach((b) => b.onclick = () => setView(b.dataset.view));
function setView(v) {
  state.view = v;
  $$('#tabs button').forEach((b) => b.classList.toggle('on', b.dataset.view === v));
  $$('#main .view').forEach((s) => s.hidden = s.dataset.view !== v);
  if (v === 'graph') graphInit();
  if (v === 'matrix') renderMatrix();
  if (v === 'check') renderCheck();
  if (v === 'doc' && !state.doc) renderDocTree();
  setHash();
}

// 幅が足りない環境では参照パネルが本体に重なるので、初期状態で畳んでおく
if (innerWidth < 1180) document.body.classList.add('norel');
$('#relToggle').onclick = () => {
  document.body.classList.toggle('norel');
  if (gs.ready && state.view === 'graph') resizeCanvas();
};

$('#ruby').onchange = (e) => {
  state.ruby = e.target.checked;
  renderFlowTree(); if (state.flow) openFlow(state.flow, true);
  renderDocTree(); if (state.doc) openDoc(state.doc);
  if (state.view === 'matrix') renderMatrix();
};

// =================================================================
// 汎用: 関係パネル
// =================================================================
function relationPanel(nodeId, host) {
  const n = N.get(nodeId);
  if (!n) { host.innerHTML = '<div class="empty">選択なし</div>'; return; }
  const h = [];
  h.push('<div class="rel">');
  h.push('<div class="card">');
  h.push(`<h2>${esc(labelOf(n))}</h2>`);
  h.push(`<div><span class="badge kind" style="background:${KIND[n.kind].raw}">${KIND[n.kind].label}</span>`);
  if (n.code) h.push(` <span class="cd">${esc(n.code)}</span>`);
  h.push('</div>');
  const sub = [n.groupLabel, n.category, n.group, n.format, n.schedule].filter(Boolean);
  if (sub.length) h.push(`<p>${esc(sub.map(disp).join(' / '))}</p>`);
  if (n.desc) h.push(`<p>${esc(disp(n.desc))}</p>`);
  else if (n.overview) h.push(`<p>${esc(Array.isArray(n.overview) ? n.overview.map(disp).join(' ') : disp(n.overview)).slice(0, 300)}</p>`);
  if (n.unit) h.push(`<p><a class="ref" data-doc="${esc(n.unit)}">仕様書を開く →</a></p>`);
  h.push('</div>');

  h.push(relList('この要素が参照するもの', out(nodeId), 'to'));
  h.push(relList('この要素を参照するもの', inc(nodeId), 'from'));
  h.push('</div>');
  host.innerHTML = h.join('');
  wire(host);
}

function relList(title, list, dir) {
  if (!list.length) return `<h3>${title}</h3><div class="empty">なし</div>`;
  const byType = new Map();
  for (const e of list) (byType.get(e.type) || byType.set(e.type, []).get(e.type)).push(e);
  const h = [`<h3>${title}（${list.length}）</h3>`];
  for (const [t, es] of [...byType].sort((a, b) => (ETYPE[a[0]] ? 0 : 1) - (ETYPE[b[0]] ? 0 : 1))) {
    h.push('<div class="grp2">');
    h.push(`<b>${(ETYPE[t] || { label: t }).label}（${es.length}）</b>`);
    for (const e of es) {
      const o = N.get(e[dir]);
      if (!o) continue;
      const c = KIND[o.kind] || { raw: '#888' };
      h.push(`<a class="r${e.byName ? ' inf' : ''}" data-node="${esc(o.id)}" style="border-left-color:${c.raw}">`);
      if (o.code) h.push(`<span class="cd">${esc(o.code)}</span>`);
      h.push(esc(labelOf(o)));
      if (e.crud) h.push(`<span class="tag">${esc(e.crud)}</span>`);
      if (e.byName) h.push('<span class="tag">推定</span>');
      if (e.ev && e.ev[0]) h.push(`<span class="ev">${esc(disp(e.ev[0]))}</span>`);
      h.push('</a>');
    }
    h.push('</div>');
  }
  return h.join('');
}

/** data-node / data-doc / data-flow のクリックを結線する */
function wire(root) {
  $$('[data-node]', root).forEach((el) => el.onclick = (ev) => { ev.preventDefault(); gotoNode(el.dataset.node); });
  $$('[data-doc]', root).forEach((el) => el.onclick = (ev) => { ev.preventDefault(); setView('doc'); openDoc(el.dataset.doc); });
  $$('[data-flow]', root).forEach((el) => el.onclick = (ev) => { ev.preventDefault(); setView('flow'); openFlow(el.dataset.flow); });
}

/** ノード種別に応じて最適なビューへ飛ぶ */
function gotoNode(id) {
  const n = N.get(id);
  if (!n) return;
  state.sel = id;
  if (n.kind === 'flow') { setView('flow'); openFlow(id); return; }
  if (n.unit) { setView('doc'); openDoc(n.unit); return; }
  // 実体ドキュメントを持たない（TBL・アクター等）はグラフで見る
  setView('graph'); graphFocus(id);
}

// =================================================================
// 業務フロービュー
// =================================================================
const flows = G.nodes.filter((n) => n.kind === 'flow');

function flowRichness(f) {
  return out(f.id).filter((e) => e.type !== 'performs').length;
}

function renderFlowTree() {
  const mode = $('#flowSort').value;
  const host = $('#flowTree');
  let html = '';
  if (mode === 'group') {
    const groups = new Map();
    for (const f of flows) {
      const g = disp(f.group) || '（未分類）';
      (groups.get(g) || groups.set(g, []).get(g)).push(f);
    }
    for (const [g, list] of groups) {
      list.sort((a, b) => (a.code || '').localeCompare(b.code || ''));
      html += `<div class="grp">${esc(g)}（${list.length}）</div>` + list.map(flowItem).join('');
    }
  } else {
    const list = flows.slice();
    if (mode === 'code') list.sort((a, b) => (a.code || 'ZZ').localeCompare(b.code || 'ZZ'));
    else list.sort((a, b) => flowRichness(b) - flowRichness(a));
    html = list.map(flowItem).join('');
  }
  host.innerHTML = html;
  $$('.it', host).forEach((el) => el.onclick = () => openFlow(el.dataset.flow));
}
function flowItem(f) {
  const r = flowRichness(f);
  return `<div class="it${state.flow === f.id ? ' on' : ''}${f.missingDetail ? ' dim' : ''}" data-flow="${esc(f.id)}" title="${esc(labelOf(f))}">
    <span class="mx">${f.missingDetail ? '詳細なし' : r}</span>
    <span class="cd">${esc(f.code || '—')}</span>${esc(labelOf(f))}</div>`;
}
$('#flowSort').onchange = renderFlowTree;

function openFlow(id, keepScroll) {
  const f = N.get(id);
  if (!f) return;
  state.flow = id; state.sel = id;
  $$('#flowTree .it').forEach((el) => el.classList.toggle('on', el.dataset.flow === id));
  setHash();

  const h = ['<div class="dochead">'];
  h.push(`<h1>${esc(labelOf(f))}</h1>`);
  const meta = [];
  if (f.code) meta.push(`<span><b>${esc(f.code)}</b></span>`);
  if (f.group) meta.push(`<span>グループ: ${esc(disp(f.group))}</span>`);
  if (f.userKind) meta.push(`<span>ユーザ区分: ${esc(disp(f.userKind))}</span>`);
  if (f.steps) meta.push(`<span>記述行数: ${f.steps}</span>`);
  if (f.reqFlow) meta.push(`<span>参考(要件定義書): ${esc(disp(f.reqFlow))}</span>`);
  if (f.reconstructed) meta.push('<span class="badge warn">AI が図形シートの画像から再構成（原本要確認）</span>');
  if (f.missingDetail) meta.push('<span class="badge warn">一覧のみ・詳細シートなし</span>');
  h.push(`<div class="meta">${meta.join('')}</div>`);
  if (f.overview) h.push(`<div class="ov">${esc(disp(f.overview))}</div>`);
  h.push('</div>');
  $('#flowHead').innerHTML = h.join('');

  renderFlowMap(f);
  renderFlowBody(f);
  relationPanel(id, $('#flowRel'));
  if (!keepScroll) $('.pane-c', $('.view[data-view=flow]')).scrollTop = 0;
}

// ---------- 関係マップ（レイヤ図） ----------
let lastMapSvg = '';
const MAP_CAP = 16;               // 1 列に出す最大件数（超えたら折り畳む）
const mapExpanded = new Set();    // 展開した列

function collectFlowScope(f, opts) {
  const showInf = opts.inferred, indirect = opts.indirect;
  const cols = {
    actor: new Map(), screen: new Map(), batch: new Map(), file: new Map(), table: new Map(),
  };
  const links = [];
  const put = (m, node, why) => {
    if (!m.has(node.id)) m.set(node.id, { node, why: [] });
    if (why) m.get(node.id).why.push(why);
  };

  for (const e of out(f.id)) {
    if (e.byName && !showInf) continue;
    const t = N.get(e.to); if (!t) continue;
    let col = null;
    if (t.kind === 'actor') col = 'actor';
    else if (t.kind === 'screen' || t.kind === 'screengroup') col = 'screen';
    else if (t.kind === 'batch' || t.kind === 'batchgroup') col = 'batch';
    else if (t.kind === 'file' || t.kind === 'dataitem') col = 'file';
    else if (t.kind === 'table') col = 'table';
    else continue;
    put(cols[col], t, e);
    links.push({ from: f.id, to: t.id, type: e.type, inf: !!e.byName });
  }

  if (indirect) {
    const mid = [...cols.screen.values(), ...cols.batch.values()].map((x) => x.node);
    for (const m of mid) {
      // 画面機能・バッチ機能グループは配下の実体も引き込む
      const expand = (m.kind === 'screengroup' || m.kind === 'batchgroup')
        ? out(m.id).filter((e) => e.type === 'contains').map((e) => N.get(e.to)).filter(Boolean)
        : [m];
      for (const u of expand) {
        if (u !== m) {
          put(u.kind === 'batch' ? cols.batch : cols.screen, u, null);
          links.push({ from: m.id, to: u.id, type: 'contains', inf: false });
        }
        for (const e of out(u.id)) {
          const t = N.get(e.to); if (!t) continue;
          if (t.kind === 'file' || t.kind === 'dataitem') { put(cols.file, t, e); links.push({ from: u.id, to: t.id, type: e.type, inf: true, indirect: true }); }
          else if (t.kind === 'table') { put(cols.table, t, e); links.push({ from: u.id, to: t.id, type: e.type, inf: true, indirect: true }); }
        }
      }
    }
  }
  return { cols, links };
}

function renderFlowMap(f) {
  const host = $('#flowMap');
  const opts = { inferred: $('#mapInferred').checked, indirect: $('#mapIndirect').checked };
  const { cols, links } = collectFlowScope(f, opts);

  const COLS = [
    ['actor', 'アクター'], ['screen', '画面'], ['batch', 'バッチ'], ['file', 'ファイル'], ['table', 'TBL'],
  ].filter(([k]) => cols[k].size);

  if (!COLS.length) {
    host.innerHTML = '<div class="empty">この業務フローからは関係を抽出できていない。'
      + (f.missingDetail ? '一覧にのみ存在し、詳細シートが無い。' : '本文に画面ID・バッチID・TBL名が現れない。')
      + '</div>';
    lastMapSvg = '';
    return;
  }

  const NW = 172, NH = 22, VGAP = 5, HGAP = 96, PADT = 44, PADL = 20, SRCW = 156;
  const pos = new Map();
  const more = [];
  let maxRows = 0;
  // 直接リンクを持つものを上に、以降は名前順。長い列は折り畳む。
  const directTo = new Set(links.filter((l) => l.from === f.id).map((l) => l.to));
  COLS.forEach(([k], ci) => {
    let list = [...cols[k].values()];
    list.sort((a, b) => (directTo.has(b.node.id) - directTo.has(a.node.id))
      || labelOf(a.node).localeCompare(labelOf(b.node)));
    const cap = mapExpanded.has(k) ? list.length : MAP_CAP;
    const hidden = list.length - cap;
    if (hidden > 0) list = list.slice(0, cap);
    const x = PADL + SRCW + HGAP + ci * (NW + HGAP);
    list.forEach((it, ri) => pos.set(it.node.id, { x, y: PADT + ri * (NH + VGAP), n: it.node }));
    if (hidden > 0) more.push({ k, x, y: PADT + list.length * (NH + VGAP), n: hidden });
    else if (mapExpanded.has(k) && cols[k].size > MAP_CAP) more.push({ k, x, y: PADT + list.length * (NH + VGAP), n: 0 });
    maxRows = Math.max(maxRows, list.length + (hidden > 0 || mapExpanded.has(k) ? 1 : 0));
  });
  const H = Math.max(PADT + maxRows * (NH + VGAP) + 16, 150);
  const W = PADL + SRCW + HGAP + COLS.length * (NW + HGAP) + 10;
  // 起点（業務フロー自身）
  pos.set(f.id, { x: PADL, y: H / 2 - NH / 2, n: f, w: SRCW });

  const s = [];
  s.push(`<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">`);
  COLS.forEach(([k, lb], ci) => {
    const x = PADL + SRCW + HGAP + ci * (NW + HGAP);
    s.push(`<text class="colhd" x="${x}" y="${PADT - 16}">${esc(lb)}（${cols[k].size}）</text>`);
  });
  // links
  for (const l of links) {
    const a = pos.get(l.from), b = pos.get(l.to);
    if (!a || !b) continue;
    const x1 = a.x + (a.w || NW), y1 = a.y + NH / 2, x2 = b.x, y2 = b.y + NH / 2;
    const mx = (x1 + x2) / 2;
    const col = (ETYPE[l.type] || { raw: '#666' }).raw;
    s.push(`<path class="lk${l.inf ? ' inf' : ''}" data-a="${esc(l.from)}" data-b="${esc(l.to)}"
      d="M${x1} ${y1} C${mx} ${y1} ${mx} ${y2} ${x2} ${y2}" stroke="${col}" opacity="${l.indirect ? .32 : .62}"/>`);
  }
  // nodes
  for (const [, p] of pos) {
    const n = p.n, w = p.w || NW;
    const c = KIND[n.kind] || { raw: '#888' };
    const txt = (n.code ? n.code + '  ' : '') + labelOf(n);
    const max = Math.floor((w - 12) / 6.4);
    s.push(`<g class="nd" data-node="${esc(n.id)}"><title>${esc((n.code ? n.code + ' ' : '') + labelOf(n))}</title>`);
    s.push(`<rect x="${p.x}" y="${p.y}" width="${w}" height="${NH}" rx="4" fill="${c.raw}" stroke="${c.raw}"/>`);
    s.push(`<text x="${p.x + 7}" y="${p.y + 15}">${esc(txt.length > max ? txt.slice(0, max - 1) + '…' : txt)}</text>`);
    s.push('</g>');
  }
  // 「+N件」の折り畳みトグル
  for (const m of more) {
    s.push(`<g class="mr" data-col="${esc(m.k)}"><title>クリックで${m.n ? '展開' : '折り畳み'}</title>`);
    s.push(`<rect x="${m.x}" y="${m.y}" width="${NW}" height="${NH}" rx="4" fill="none" stroke="#3a414c" stroke-dasharray="3 3"/>`);
    s.push(`<text x="${m.x + 7}" y="${m.y + 15}" fill="#8b93a1" font-size="11">${m.n ? `＋ 他 ${m.n} 件を表示` : '− 折り畳む'}</text>`);
    s.push('</g>');
  }
  s.push('</svg>');
  lastMapSvg = s.join('');
  host.innerHTML = lastMapSvg;

  const svg = $('svg', host);
  $$('.mr', svg).forEach((g) => g.onclick = () => {
    const k = g.dataset.col;
    mapExpanded.has(k) ? mapExpanded.delete(k) : mapExpanded.add(k);
    renderFlowMap(f);
  });
  $$('.nd', svg).forEach((g) => {
    g.onclick = () => gotoNode(g.dataset.node);
    g.onmouseenter = () => hl(g.dataset.node, true);
    g.onmouseleave = () => hl(null, false);
  });
  function hl(id, on) {
    if (!on) { $$('.mut', svg).forEach((e) => e.classList.remove('mut')); return; }
    const keep = new Set([id]);
    $$('.lk', svg).forEach((p) => { if (p.dataset.a === id || p.dataset.b === id) { keep.add(p.dataset.a); keep.add(p.dataset.b); } });
    $$('.lk', svg).forEach((p) => p.classList.toggle('mut', !(keep.has(p.dataset.a) && keep.has(p.dataset.b))));
    $$('.nd', svg).forEach((g) => g.classList.toggle('mut', !keep.has(g.dataset.node)));
  }
}
$('#mapIndirect').onchange = $('#mapInferred').onchange = () => { if (state.flow) renderFlowMap(N.get(state.flow)); };
$('#mapExport').onclick = () => {
  if (!lastMapSvg) return;
  const style = '<style>.nd text{font:11.5px sans-serif;fill:#0d1013}.colhd{fill:#6b7484;font:11px sans-serif}.lk{fill:none;stroke-width:1.4}.lk.inf{stroke-dasharray:3 3}</style>';
  const svg = lastMapSvg.replace('>', '><rect width="100%" height="100%" fill="#1a1d23"/>' + style);
  download(new Blob([svg], { type: 'image/svg+xml' }), `flowmap_${(N.get(state.flow).code || 'flow')}.svg`);
};

// ---------- フロー本文 ----------
function renderFlowBody(f) {
  const host = $('#flowBody');
  if (!f.path) { host.innerHTML = ''; return; }
  loadDoc(f.path, (sheets) => {
    if (!sheets) { host.innerHTML = '<div class="empty">本文を読み込めない</div>'; return; }
    const raw = sheets[0] && sheets[0].t ? sheets[0].t : '';
    const lines = raw.split(/\r?\n/);
    const h = ['<div class="section">詳細業務フロー（原文）</div><div class="steps">'];
    for (const l of lines) {
      if (!l.trim()) { h.push('<div class="ln">&nbsp;</div>'); continue; }
      h.push(`<div class="ln">${linkify(l)}</div>`);
    }
    h.push('</div>');
    host.innerHTML = h.join('');
    wire(host);
  });
}

/** 本文中の画面ID・バッチID・TBL名をクリック可能にする */
function linkify(line) {
  const marks = [];
  const push = (re, fn) => {
    for (const m of line.matchAll(re)) {
      const id = fn(m);
      if (id && N.has(id)) marks.push({ s: m.index, e: m.index + m[0].length, id, kind: N.get(id).kind });
    }
  };
  push(/\b([A-Z]{2}\d{3})[_\-]?(F\d{2})\b/g, (m) => `screen:${m[1]}_${m[2]}`);
  push(/\b([A-Z]{2}\d{3})[_\-]?(B\d{2})\b/g, (m) => `batch:${m[1]}_${m[2]}`);
  push(/([一-鿿々ァ-ヶー\w／\/]{2,20}?TBL)/g, (m) => `table:${P.matchKey(m[1])}`);
  push(/\b([A-Z]{2}\d{3})\b/g, (m) => (N.has(`sgroup:${m[1]}`) ? `sgroup:${m[1]}` : N.has(`bgroup:${m[1]}`) ? `bgroup:${m[1]}` : null));
  marks.sort((a, b) => a.s - b.s || b.e - a.e);
  let outp = '', at = 0;
  for (const m of marks) {
    if (m.s < at) continue;
    outp += esc(line.slice(at, m.s));
    const k = m.kind === 'batch' || m.kind === 'batchgroup' ? 'k-batch' : m.kind === 'table' ? 'k-table' : '';
    outp += `<a class="ref ${k}" data-node="${esc(m.id)}">${esc(line.slice(m.s, m.e))}</a>`;
    at = m.e;
  }
  return outp + esc(line.slice(at));
}

// =================================================================
// 本文チャンクの遅延ロード（file:// でも動くよう script タグで取る）
// =================================================================
window.__ED_DOCS__ = window.__ED_DOCS__ || {};
const chunkState = new Map(); // no -> 'loading' | 'done'
const chunkWaiters = new Map();
window.__ED_DOC_CHUNK_READY__ = (no) => {
  chunkState.set(no, 'done');
  (chunkWaiters.get(no) || []).forEach((fn) => fn());
  chunkWaiters.delete(no);
};
function loadDoc(unitKey, cb) {
  if (window.__ED_DOCS__[unitKey]) return cb(window.__ED_DOCS__[unitKey]);
  const no = G.docChunk[unitKey];
  if (no === undefined) return cb(null);
  const done = () => cb(window.__ED_DOCS__[unitKey] || null);
  if (chunkState.get(no) === 'done') return done();
  (chunkWaiters.get(no) || chunkWaiters.set(no, []).get(no)).push(done);
  if (chunkState.get(no) === 'loading') return;
  chunkState.set(no, 'loading');
  const s = document.createElement('script');
  s.src = `docs/chunk-${String(no).padStart(2, '0')}.js`;
  s.onerror = () => { chunkState.set(no, 'done'); (chunkWaiters.get(no) || []).forEach((f) => f()); chunkWaiters.delete(no); };
  document.head.appendChild(s);
}

// =================================================================
// 仕様書ビュー
// =================================================================
const DOC_AREAS = {
  screen: { kinds: ['screen'], groupBy: (n) => `${disp(n.category)} / ${disp(n.groupLabel) || n.group}` },
  batch:  { kinds: ['batch'],  groupBy: (n) => disp(n.area || n.groupLabel) },
  file:   { kinds: ['file'],   groupBy: (n) => (n.ownerCode ? n.ownerCode.slice(0, 5) : 'その他') },
  flow:   { kinds: ['flow'],   groupBy: (n) => disp(n.group) },
};

function renderDocTree() {
  const area = $('#docArea').value;
  const cfg = DOC_AREAS[area];
  const filt = P.matchKey($('#docFilter').value || '');
  const list = G.nodes.filter((n) => cfg.kinds.includes(n.kind) && n.unit)
    .filter((n) => !filt || P.matchKey(`${n.code} ${n.label} ${n.name} ${n.groupLabel || ''}`).includes(filt));
  const groups = new Map();
  for (const n of list) {
    const g = cfg.groupBy(n) || '—';
    (groups.get(g) || groups.set(g, []).get(g)).push(n);
  }
  const h = [];
  for (const [g, items] of [...groups].sort((a, b) => a[0].localeCompare(b[0]))) {
    items.sort((a, b) => (a.code || '').localeCompare(b.code || ''));
    h.push(`<div class="grp">${esc(g)}（${items.length}）</div>`);
    for (const n of items) {
      h.push(`<div class="it${state.doc === n.unit ? ' on' : ''}" data-doc="${esc(n.unit)}" title="${esc(labelOf(n))}">
        <span class="cd">${esc(n.code || '')}</span>${esc(labelOf(n))}</div>`);
    }
  }
  $('#docTree').innerHTML = h.join('') || '<div class="grp">該当なし</div>';
  $$('#docTree .it').forEach((el) => el.onclick = () => openDoc(el.dataset.doc));
}
$('#docArea').onchange = renderDocTree;
$('#docFilter').oninput = renderDocTree;

const unitToNode = new Map(G.nodes.filter((n) => n.unit).map((n) => [n.unit, n]));

function openDoc(unitKey) {
  setView('doc');
  state.doc = unitKey;
  const n = unitToNode.get(unitKey);
  if (n) { state.sel = n.id; $('#docArea').value = n.kind === 'flow' ? 'flow' : n.kind; }
  renderDocTree();
  setHash();

  const h = ['<div class="dochead">'];
  h.push(`<h1>${esc(n ? labelOf(n) : unitKey)}</h1>`);
  const meta = [];
  if (n) {
    meta.push(`<span class="badge kind" style="background:${KIND[n.kind].raw}">${KIND[n.kind].label}</span>`);
    if (n.code) meta.push(`<span><b>${esc(n.code)}</b></span>`);
    if (n.groupLabel) meta.push(`<span>${esc(disp(n.groupLabel))}</span>`);
    if (n.category) meta.push(`<span>${esc(disp(n.category))}</span>`);
    if (n.format) meta.push(`<span>${esc(n.format)} / ${esc(n.charset || '')}</span>`);
    if (n.physical) meta.push(`<span>物理名: <code>${esc(n.physical)}</code></span>`);
    if (n.itemCount) meta.push(`<span>項目数: ${n.itemCount}</span>`);
    if (n.schedule) meta.push(`<span>実行: ${esc(disp(n.schedule))}</span>`);
    if (n.reconstructed) meta.push('<span class="badge warn">AI が画像から再構成</span>');
  }
  meta.push(`<span style="color:var(--fg3)">${esc(unitKey)}</span>`);
  h.push(`<div class="meta">${meta.join('')}</div>`);
  const ovl = n && Array.isArray(n.overview) ? n.overview : n && n.overview ? [n.overview] : [];
  if (ovl.length) h.push(`<div class="ov">${ovl.map((x) => esc(disp(x))).join('<br>')}</div>`);
  h.push('</div>');
  $('#docHead').innerHTML = h.join('');
  if (n) relationPanel(n.id, $('#docRel')); else $('#docRel').innerHTML = '';

  $('#docBody').innerHTML = '<div class="empty" style="padding:20px;color:var(--fg3)">読み込み中…</div>';
  loadDoc(unitKey, (sheets) => {
    if (state.doc !== unitKey) return;
    if (!sheets) { $('#docBody').innerHTML = '<div class="empty">本文が見つからない</div>'; return; }
    renderSheets(sheets);
  });
}

function renderSheets(sheets) {
  const host = $('#docBody');
  let cur = 0;
  const draw = () => {
    const h = ['<div class="sheettabs">'];
    sheets.forEach((s, i) => h.push(`<button data-i="${i}" class="${i === cur ? 'on' : ''}">${esc(disp(s.n))}</button>`));
    h.push('</div><div class="sheet">');
    const s = sheets[cur];
    if (s.t != null) {
      h.push(`<pre class="raw">${linkify(s.t)}</pre>`);
    } else if (s.r && s.r.length) {
      let maxc = 0;
      for (const [, cs] of s.r) for (const [c] of cs) maxc = Math.max(maxc, c);
      h.push('<table class="xl">');
      for (const [rn, cs] of s.r) {
        h.push(`<tr><td class="rn">${rn}</td>`);
        const m = new Map(cs);
        for (let c = 0; c <= maxc; c++) {
          const v = m.get(c);
          h.push(`<td>${v ? linkify(disp(v)) : ''}</td>`);
        }
        h.push('</tr>');
      }
      h.push('</table>');
    } else if (s.p) {
      h.push(`<pre class="raw">${linkify(s.p.join('\n'))}</pre>`);
    } else {
      h.push('<div class="empty" style="padding:20px;color:var(--fg3)">（空のシート）</div>');
    }
    h.push('</div>');
    host.innerHTML = h.join('');
    $$('.sheettabs button', host).forEach((b) => b.onclick = () => { cur = +b.dataset.i; draw(); });
    wire(host);
  };
  draw();
}

// =================================================================
// マトリクス
// =================================================================
/** 業務フロー → 対象種別ノード の到達（direct=1 / indirect=2） */
function flowReach(kind, indirect) {
  const res = new Map(); // flowId -> Map(nodeId -> {lv, inf, ev})
  for (const f of flows) {
    const m = new Map();
    const mids = [];
    for (const e of out(f.id)) {
      const t = N.get(e.to); if (!t) continue;
      if (t.kind === kind) m.set(t.id, { lv: 1, inf: !!e.byName, ev: e.ev[0] || '', type: e.type });
      if (['screen', 'batch', 'screengroup', 'batchgroup'].includes(t.kind)) mids.push(t);
    }
    if (indirect) {
      for (const mid of mids) {
        const expand = (mid.kind.endsWith('group'))
          ? out(mid.id).filter((e) => e.type === 'contains').map((e) => N.get(e.to)).filter(Boolean)
          : [mid];
        for (const u of expand) {
          if (u.kind === kind && !m.has(u.id)) m.set(u.id, { lv: 2, inf: false, ev: `${labelOf(mid)} 配下`, type: 'contains' });
          for (const e of out(u.id)) {
            const t = N.get(e.to);
            if (t && t.kind === kind && !m.has(t.id)) m.set(t.id, { lv: 2, inf: false, ev: `${labelOf(u)} 経由: ${e.ev[0] || (ETYPE[e.type] || {}).label || e.type}`, type: e.type });
          }
        }
      }
    }
    res.set(f.id, m);
  }
  return res;
}

let mxCache = null;
function renderMatrix() {
  const kind = $('#mxTarget').value;
  const indirect = $('#mxIndirect').checked;
  const gapsOnly = $('#mxGaps').checked;
  const reach = flowReach(kind, indirect);

  const rows = flows.filter((f) => !f.missingDetail).sort((a, b) => (a.code || 'ZZ').localeCompare(b.code || 'ZZ'));
  const hitCount = new Map();
  for (const f of rows) for (const id of reach.get(f.id).keys()) hitCount.set(id, (hitCount.get(id) || 0) + 1);

  let colsAll = G.nodes.filter((n) => n.kind === kind);
  if (gapsOnly) colsAll = colsAll.filter((n) => !hitCount.get(n.id));
  else colsAll = colsAll.filter((n) => hitCount.get(n.id));
  colsAll.sort((a, b) => (a.code || '').localeCompare(b.code || '') || labelOf(a).localeCompare(labelOf(b)));

  mxCache = { rows, cols: colsAll, reach, kind };

  const h = [`<table class="mx"><thead><tr><th class="corner">業務フロー ＼ ${KIND[kind].label}（${colsAll.length}）</th>`];
  for (const c of colsAll) h.push(`<th><div class="rot" data-node="${esc(c.id)}" title="${esc(labelOf(c))}">${esc((c.code ? c.code + ' ' : '') + labelOf(c))}</div></th>`);
  h.push('</tr></thead><tbody>');
  for (const f of rows) {
    const m = reach.get(f.id);
    h.push(`<tr><th data-flow="${esc(f.id)}" title="${esc(labelOf(f))}"><span class="cd">${esc(f.code || '')}</span>${esc(labelOf(f))}</th>`);
    for (const c of colsAll) {
      const hit = m.get(c.id);
      if (!hit) { h.push('<td></td>'); continue; }
      const cls = hit.lv === 1 ? (hit.inf ? 'inf' : 'd1') : 'd2';
      h.push(`<td class="h ${cls}" data-f="${esc(f.id)}" data-c="${esc(c.id)}"></td>`);
    }
    h.push('</tr>');
  }
  h.push('</tbody></table>');
  $('#mxWrap').innerHTML = h.join('');
  $('#mxInfo').innerHTML = `<b>凡例</b> <span style="color:#58a6ff">■</span> 直接（ID一致）　<span style="color:#58a6ff88">■</span> 直接（名称一致・推定）　<span style="color:#58a6ff55">■</span> 間接（画面・バッチ経由）　／　セルにカーソルを合わせると根拠を表示`;

  wire($('#mxWrap'));
  $$('#mxWrap td.h').forEach((td) => {
    td.onmouseenter = () => {
      const f = N.get(td.dataset.f), c = N.get(td.dataset.c);
      const hit = reach.get(f.id).get(c.id);
      $('#mxInfo').innerHTML = `<b>${esc(labelOf(f))}</b> → <b>${esc(labelOf(c))}</b>`
        + ` <span class="badge">${hit.lv === 1 ? (hit.inf ? '直接・推定' : '直接') : '間接'}</span>`
        + `<br><code>${esc(disp(hit.ev).slice(0, 300))}</code>`;
      td.closest('tr').classList.add('hl');
    };
    td.onmouseleave = () => td.closest('tr').classList.remove('hl');
    td.onclick = () => gotoNode(td.dataset.c);
  });
}
$('#mxTarget').onchange = $('#mxIndirect').onchange = $('#mxGaps').onchange = renderMatrix;
$('#mxCsv').onclick = () => {
  if (!mxCache) return;
  const { rows, cols, reach } = mxCache;
  const out = [['業務フローID', '業務フロー名', ...cols.map((c) => (c.code || '') + ' ' + labelOf(c))]];
  for (const f of rows) {
    const m = reach.get(f.id);
    out.push([f.code || '', labelOf(f), ...cols.map((c) => { const h = m.get(c.id); return !h ? '' : h.lv === 1 ? (h.inf ? '△' : '●') : '○'; })]);
  }
  downloadCsv(out, `matrix_flow_x_${mxCache.kind}.csv`);
};

// =================================================================
// 品質チェック
// =================================================================
function renderCheck() {
  const c = G.meta.counts;
  const covered = (k) => G.nodes.filter((n) => n.kind === k && n.cov > 0).length;
  const h = ['<div class="check">'];
  h.push('<h2>カバレッジ</h2><p class="lead">「業務フローから辿れるか」を仕様書の抜け漏れ検出に使う。0 件のものは業務フローに登場しない = 記述漏れか、業務フロー外の機能。</p>');
  h.push('<div class="stats">');
  for (const [k, lb] of [['flow', '業務フロー'], ['screen', '画面'], ['batch', 'バッチ'], ['file', 'ファイル'], ['table', 'TBL']]) {
    const tot = c[k] || 0;
    const cov = k === 'flow' ? flows.filter((f) => out(f.id).length).length : covered(k);
    h.push(`<div class="stat"><b>${cov} / ${tot}</b><span>${lb}${k === 'flow' ? '（関係抽出済）' : '（フローから到達）'}</span></div>`);
  }
  h.push('</div>');

  const groups = [
    ['orphan', 'どの業務フローからも辿れない要素', '画面・バッチ・ファイルのうち、業務フロー（110）に登場しないもの。業務フロー側の記述漏れか、業務フロー化されていない機能。'],
    ['unresolved', '解決できなかった参照', '業務フロー本文に出てくる ID のうち、対応する仕様書が見つからないもの。'],
    ['missing', '対応物が無い', '一覧にはあるが実体シートが無いもの。'],
    ['parse', '解析できなかったシート', '見出し行を特定できず、構造として読めなかったシート。'],
    ['skip', '対象外にしたフォルダ', 'ID を持たないため関係グラフに載せなかったもの（一覧・共通仕様など）。'],
  ];
  for (const [kind, title, lead] of groups) {
    const list = G.issues.filter((i) => i.kind === kind);
    if (!list.length) continue;
    h.push(`<h2>${title}（${list.length}）</h2><p class="lead">${lead}</p>`);
    h.push('<table><thead><tr><th style="width:60%">内容</th><th>場所</th></tr></thead><tbody>');
    for (const i of list.slice(0, 400)) {
      const unit = i.where && unitToNode.has(i.where) ? i.where : '';
      h.push(`<tr><td>${esc(disp(i.msg))}</td><td class="${unit ? 'lnk' : ''}" ${unit ? `data-doc="${esc(unit)}"` : ''}>${esc(i.where || '')}</td></tr>`);
    }
    if (list.length > 400) h.push(`<tr><td colspan="2">… 他 ${list.length - 400} 件</td></tr>`);
    h.push('</tbody></table>');
  }

  h.push('<h2>解析の前提</h2><p class="lead">'
    + '・詳細業務フローの多くは図形シートのため、AI が PNG 画像から再構成したテキストを解析している。該当フローには「AI が画像から再構成」バッジが付く。関係の根拠となった原文行を必ず併記しているので、重要な判断の前には原本を確認する。<br>'
    + '・業務フロー本文に ID が書かれていない参照は、画面名・バッチ名・ファイル名との<b>名称一致</b>で推定している。推定リンクは破線・「推定」タグ・マトリクスの薄い色で区別している。<br>'
    + '・Excel のふりがなが本文末尾に連結されているため、表示時に除去している（ヘッダの「ふりがな表示」で原文に戻せる）。'
    + '</p>');
  h.push(`<h2>生成情報</h2><p class="lead">${esc(G.meta.generated)} / ノード ${G.nodes.length} / 関係 ${G.edges.length} / 本文チャンク ${G.meta.chunks}</p>`);
  h.push('</div>');
  $('#checkBody').innerHTML = h.join('');
  wire($('#checkBody'));
}

// =================================================================
// 関係グラフ（Canvas + 自前の力学レイアウト）
// =================================================================
const gs = {
  ready: false, nodes: [], links: [], byId: new Map(),
  hidK: new Set(['contains']), hidE: new Set(['contains']),
  focus: null, hops: 2, inferred: true,
  cam: { x: 0, y: 0, k: 1 }, sel: null, hover: null, timer: 0, drag: null,
  topLabels: new Set(),   // 常時ラベルを出す主要ノード
};
let canvas, ctx;

function graphInit() {
  if (!gs.ready) {
    canvas = $('#gCanvas'); ctx = canvas.getContext('2d');
    buildFilters();
    bindCanvas();
    gs.ready = true;
    // 初回は全体を出しても読めないので、選択中の業務フローを起点にする
    const seed = state.sel && N.has(state.sel) ? state.sel : state.flow;
    if (seed && N.has(seed)) { gs.focus = seed; $('#gFocus').value = labelOf(N.get(seed)); }
  }
  resizeCanvas();
  rebuildGraph();
}

function buildFilters() {
  const cnt = {}; for (const n of G.nodes) cnt[n.kind] = (cnt[n.kind] || 0) + 1;
  const ec = {}; for (const e of G.edges) ec[e.type] = (ec[e.type] || 0) + 1;
  $('#fNodes').innerHTML = Object.keys(KIND).filter((k) => cnt[k]).map((k) =>
    `<label class="f"><input type="checkbox" data-k="${k}" ${gs.hidK.has(k) ? '' : 'checked'}>
     <span class="sw" style="background:${KIND[k].raw}"></span>${KIND[k].label}<span class="n">${cnt[k]}</span></label>`).join('');
  $('#fEdges').innerHTML = Object.keys(ETYPE).filter((t) => ec[t]).map((t) =>
    `<label class="f"><input type="checkbox" data-e="${t}" ${gs.hidE.has(t) ? '' : 'checked'}>
     <span class="sw" style="background:${ETYPE[t].raw}"></span>${ETYPE[t].label}<span class="n">${ec[t]}</span></label>`).join('');
  $$('#fNodes input').forEach((i) => i.onchange = () => { i.checked ? gs.hidK.delete(i.dataset.k) : gs.hidK.add(i.dataset.k); rebuildGraph(); });
  $$('#fEdges input').forEach((i) => i.onchange = () => { i.checked ? gs.hidE.delete(i.dataset.e) : gs.hidE.add(i.dataset.e); rebuildGraph(); });
  $('#gHops').oninput = (e) => { gs.hops = +e.target.value; $('#gHopsV').textContent = gs.hops; rebuildGraph(); };
  $('#gInferred').onchange = (e) => { gs.inferred = e.target.checked; rebuildGraph(); };
  $('#gRelayout').onclick = () => { layoutSeed(); run(); };
  $('#gPng').onclick = exportPng;
  $('#gCsv').onclick = exportCsv;
  $('#gFocus').oninput = () => {
    const q = P.matchKey($('#gFocus').value);
    if (!q) { $('#gFocusPick').innerHTML = ''; if (gs.focus) { gs.focus = null; rebuildGraph(); } return; }
    const hits = G.nodes.filter((n) => P.matchKey(`${n.code} ${n.label}`).includes(q)).slice(0, 24);
    $('#gFocusPick').innerHTML = hits.map((n) =>
      `<div data-id="${esc(n.id)}"><span style="color:${KIND[n.kind].raw}">■</span> ${esc((n.code ? n.code + ' ' : '') + labelOf(n))}</div>`).join('');
    $$('#gFocusPick div').forEach((d) => d.onclick = () => {
      gs.focus = d.dataset.id; $('#gFocus').value = labelOf(N.get(d.dataset.id));
      $('#gFocusPick').innerHTML = ''; rebuildGraph();
    });
  };
}

function graphFocus(id) {
  graphInit();
  gs.focus = id; gs.sel = id;
  $('#gFocus').value = labelOf(N.get(id));
  const n = N.get(id);
  if (n && gs.hidK.has(n.kind)) { gs.hidK.delete(n.kind); buildFilters(); }
  rebuildGraph();
  relationPanel(id, $('#graphRel'));
}

function rebuildGraph() {
  // 1) 可視エッジ
  let es = G.edges.filter((e) => !gs.hidE.has(e.type) && (gs.inferred || !e.byName));
  es = es.filter((e) => N.get(e.from) && N.get(e.to) && !gs.hidK.has(N.get(e.from).kind) && !gs.hidK.has(N.get(e.to).kind));

  // 2) フォーカスから n ホップ
  let keep = null;
  if (gs.focus && N.has(gs.focus)) {
    const adj = new Map();
    for (const e of es) {
      (adj.get(e.from) || adj.set(e.from, []).get(e.from)).push(e.to);
      (adj.get(e.to) || adj.set(e.to, []).get(e.to)).push(e.from);
    }
    keep = new Set([gs.focus]);
    let frontier = [gs.focus];
    for (let d = 0; d < gs.hops; d++) {
      const nx = [];
      for (const id of frontier) for (const o of adj.get(id) || []) if (!keep.has(o)) { keep.add(o); nx.push(o); }
      frontier = nx;
    }
    es = es.filter((e) => keep.has(e.from) && keep.has(e.to));
  }

  const ids = new Set();
  for (const e of es) { ids.add(e.from); ids.add(e.to); }
  if (keep) for (const id of keep) if (!gs.hidK.has(N.get(id).kind)) ids.add(id);

  const prev = new Map(gs.nodes.map((n) => [n.id, n]));
  gs.nodes = [...ids].map((id) => {
    const p = prev.get(id);
    const n = N.get(id);
    return p || { id, n, x: 0, y: 0, vx: 0, vy: 0, r: 4 + Math.min(9, Math.sqrt((n.in || 0) + (n.out || 0)) * 1.7) };
  });
  gs.byId = new Map(gs.nodes.map((n) => [n.id, n]));
  gs.links = es.map((e) => ({ e, a: gs.byId.get(e.from), b: gs.byId.get(e.to) })).filter((l) => l.a && l.b);

  // 次数の高い順に少数だけラベルを常時表示する
  const deg = new Map();
  for (const l of gs.links) { deg.set(l.a.id, (deg.get(l.a.id) || 0) + 1); deg.set(l.b.id, (deg.get(l.b.id) || 0) + 1); }
  gs.topLabels = new Set([...deg].sort((a, b) => b[1] - a[1])
    .slice(0, gs.nodes.length <= 40 ? gs.nodes.length : 14).map(([id]) => id));

  $('#gStat').textContent = `ノード ${gs.nodes.length} / 関係 ${gs.links.length}`
    + (gs.focus ? ` — 起点「${labelOf(N.get(gs.focus))}」から ${gs.hops} ホップ` : ' — 全体');
  if (!prev.size || gs.nodes.some((n) => !n.x && !n.y)) layoutSeed();
  run();
}

function layoutSeed() {
  const R = Math.min(canvas.clientWidth, canvas.clientHeight) * 0.42;
  // 種別ごとに角度帯を割り当てると初期状態から構造が見える
  const kinds = [...new Set(gs.nodes.map((n) => n.n.kind))];
  const slot = new Map(kinds.map((k, i) => [k, i]));
  const per = new Map();
  gs.nodes.forEach((n) => {
    const k = n.n.kind;
    const i = (per.get(k) || 0); per.set(k, i + 1);
    const cnt = gs.nodes.filter((x) => x.n.kind === k).length;
    const base = (slot.get(k) / kinds.length) * Math.PI * 2;
    const a = base + (i / Math.max(cnt, 1)) * (Math.PI * 2 / kinds.length);
    const rr = R * (0.45 + 0.55 * ((i % 7) / 7));
    n.x = Math.cos(a) * rr; n.y = Math.sin(a) * rr; n.vx = n.vy = 0;
  });
  if (gs.focus && gs.byId.has(gs.focus)) { const f = gs.byId.get(gs.focus); f.x = 0; f.y = 0; }
  gs.cam = { x: canvas.clientWidth / 2, y: canvas.clientHeight / 2, k: 1 };
}

function step() {
  const ns = gs.nodes, ls = gs.links;
  const K = 1 / Math.sqrt(Math.max(ns.length, 1));
  // 反発（近傍のみの粗い O(n^2)。700 ノード程度なら実用範囲）
  for (let i = 0; i < ns.length; i++) {
    const a = ns[i];
    for (let j = i + 1; j < ns.length; j++) {
      const b = ns[j];
      let dx = b.x - a.x, dy = b.y - a.y;
      let d2 = dx * dx + dy * dy;
      if (d2 > 250000 || d2 === 0) continue;
      const d = Math.sqrt(d2);
      const f = (9000 * K) / d2;
      const fx = (dx / d) * f, fy = (dy / d) * f;
      a.vx -= fx; a.vy -= fy; b.vx += fx; b.vy += fy;
    }
  }
  // 引力
  for (const l of ls) {
    const dx = l.b.x - l.a.x, dy = l.b.y - l.a.y;
    const d = Math.hypot(dx, dy) || 1;
    const f = (d - 130) * 0.010;
    const fx = (dx / d) * f, fy = (dy / d) * f;
    l.a.vx += fx; l.a.vy += fy; l.b.vx -= fx; l.b.vy -= fy;
  }
  // 中心へ
  for (const n of ns) {
    n.vx -= n.x * 0.0010; n.vy -= n.y * 0.0010;
    n.vx *= 0.82; n.vy *= 0.82;
    if (gs.drag && gs.drag.node === n) continue;
    n.x += n.vx; n.y += n.vy;
  }
  if (gs.focus && gs.byId.has(gs.focus)) { const f = gs.byId.get(gs.focus); f.x *= 0.9; f.y *= 0.9; }
}

function run() {
  clearTimeout(gs.timer);
  let i = 0;
  const tick = () => {
    for (let k = 0; k < 2; k++) step();
    draw();
    if (++i < 180) gs.timer = requestAnimationFrame(tick);
  };
  cancelAnimationFrame(gs.timer);
  tick();
}

function draw() {
  const w = canvas.width / devicePixelRatio, h = canvas.height / devicePixelRatio;
  ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
  ctx.clearRect(0, 0, w, h);
  ctx.save();
  ctx.translate(gs.cam.x, gs.cam.y); ctx.scale(gs.cam.k, gs.cam.k);

  const hi = gs.hover || gs.sel;
  const near = new Set();
  if (hi) { near.add(hi); for (const l of gs.links) { if (l.a.id === hi) near.add(l.b.id); if (l.b.id === hi) near.add(l.a.id); } }

  for (const l of gs.links) {
    const on = !hi || (near.has(l.a.id) && near.has(l.b.id));
    ctx.globalAlpha = on ? 0.5 : 0.05;
    ctx.strokeStyle = (ETYPE[l.e.type] || { raw: '#777' }).raw;
    ctx.lineWidth = on ? 1.3 : 0.7;
    ctx.setLineDash(l.e.byName ? [3, 3] : []);
    ctx.beginPath(); ctx.moveTo(l.a.x, l.a.y); ctx.lineTo(l.b.x, l.b.y); ctx.stroke();
  }
  ctx.setLineDash([]);
  for (const n of gs.nodes) {
    const on = !hi || near.has(n.id);
    ctx.globalAlpha = on ? 1 : 0.16;
    ctx.fillStyle = KIND[n.n.kind].raw;
    ctx.beginPath(); ctx.arc(n.x, n.y, n.r, 0, 7); ctx.fill();
    if (n.id === gs.sel || n.id === gs.focus) {
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.stroke();
    }
  }
  // ラベルは「拡大したとき」「強調中」「主要ノード」だけ。
  // 全部出すと 400 ノードでは文字が重なって読めなくなる。
  ctx.globalAlpha = 1;
  ctx.font = '11px "Segoe UI","Yu Gothic UI",sans-serif';
  ctx.textAlign = 'center';
  for (const n of gs.nodes) {
    const show = (hi && near.has(n.id)) || gs.cam.k > 1.7 || gs.topLabels.has(n.id)
      || n.id === gs.sel || n.id === gs.focus;
    if (!show) continue;
    ctx.fillStyle = hi && !near.has(n.id) ? '#5a616c' : '#e6eaf1';
    const t = (n.n.code ? n.n.code + ' ' : '') + labelOf(n.n);
    ctx.fillText(t.length > 24 ? t.slice(0, 23) + '…' : t, n.x, n.y - n.r - 4);
  }
  ctx.restore();
}

function resizeCanvas() {
  const p = canvas.parentElement;
  canvas.width = p.clientWidth * devicePixelRatio;
  canvas.height = p.clientHeight * devicePixelRatio;
  canvas.style.width = p.clientWidth + 'px';
  canvas.style.height = p.clientHeight + 'px';
  if (!gs.cam.x) gs.cam = { x: p.clientWidth / 2, y: p.clientHeight / 2, k: 1 };
  draw();
}
addEventListener('resize', () => { if (gs.ready && state.view === 'graph') resizeCanvas(); });

function toWorld(ev) {
  const r = canvas.getBoundingClientRect();
  return { x: (ev.clientX - r.left - gs.cam.x) / gs.cam.k, y: (ev.clientY - r.top - gs.cam.y) / gs.cam.k };
}
function pick(p) {
  let best = null, bd = 1e9;
  for (const n of gs.nodes) {
    const d = Math.hypot(n.x - p.x, n.y - p.y);
    if (d < Math.max(n.r + 5, 9) && d < bd) { best = n; bd = d; }
  }
  return best;
}
function bindCanvas() {
  canvas.onmousedown = (ev) => {
    const p = toWorld(ev), n = pick(p);
    gs.drag = n ? { node: n, dx: n.x - p.x, dy: n.y - p.y } : { pan: true, x: ev.clientX, y: ev.clientY, cx: gs.cam.x, cy: gs.cam.y };
    canvas.classList.add('drag');
  };
  canvas.onmousemove = (ev) => {
    if (gs.drag) {
      if (gs.drag.pan) { gs.cam.x = gs.drag.cx + (ev.clientX - gs.drag.x); gs.cam.y = gs.drag.cy + (ev.clientY - gs.drag.y); }
      else { const p = toWorld(ev); gs.drag.node.x = p.x + gs.drag.dx; gs.drag.node.y = p.y + gs.drag.dy; gs.drag.node.vx = gs.drag.node.vy = 0; }
      draw();
      return;
    }
    const n = pick(toWorld(ev));
    const id = n ? n.id : null;
    if (id !== gs.hover) { gs.hover = id; canvas.title = n ? `${n.n.code || ''} ${labelOf(n.n)}` : ''; draw(); }
  };
  canvas.onmouseup = (ev) => {
    const wasNode = gs.drag && gs.drag.node;
    const moved = gs.drag && gs.drag.pan && (Math.abs(ev.clientX - gs.drag.x) + Math.abs(ev.clientY - gs.drag.y) > 4);
    gs.drag = null; canvas.classList.remove('drag');
    if (wasNode) { gs.sel = wasNode.id; relationPanel(wasNode.id, $('#graphRel')); draw(); }
    else if (!moved) { gs.sel = null; $('#graphRel').innerHTML = ''; draw(); }
  };
  canvas.ondblclick = (ev) => { const n = pick(toWorld(ev)); if (n) graphFocus(n.id); };
  canvas.onwheel = (ev) => {
    ev.preventDefault();
    const r = canvas.getBoundingClientRect();
    const mx = ev.clientX - r.left, my = ev.clientY - r.top;
    const k2 = Math.max(0.15, Math.min(5, gs.cam.k * (ev.deltaY < 0 ? 1.12 : 1 / 1.12)));
    gs.cam.x = mx - (mx - gs.cam.x) * (k2 / gs.cam.k);
    gs.cam.y = my - (my - gs.cam.y) * (k2 / gs.cam.k);
    gs.cam.k = k2; draw();
  };
}

function exportPng() {
  const a = document.createElement('a');
  a.download = 'ed-graph.png'; a.href = canvas.toDataURL('image/png'); a.click();
}
function exportCsv() {
  const rows = [['from種別', 'fromID', 'from名称', '関係', 'to種別', 'toID', 'to名称', '根拠', '推定']];
  for (const l of gs.links) {
    const a = l.a.n, b = l.b.n;
    rows.push([KIND[a.kind].label, a.code || '', labelOf(a), (ETYPE[l.e.type] || { label: l.e.type }).label,
      KIND[b.kind].label, b.code || '', labelOf(b), disp((l.e.ev || [])[0] || ''), l.e.byName ? '推定' : '']);
  }
  downloadCsv(rows, 'ed-relations.csv');
}

// =================================================================
// 検索
// =================================================================
const searchIdx = G.nodes.map((n) => ({
  n, key: P.matchKey([n.code, n.label, n.name, n.groupLabel, n.funcName, n.desc, n.listName].filter(Boolean).join(' ')),
}));
let popIdx = -1;
$('#q').oninput = doSearch;
$('#q').onfocus = doSearch;
$('#q').onkeydown = (ev) => {
  const rows = $$('#searchPop .sr');
  if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
    ev.preventDefault();
    popIdx = Math.max(0, Math.min(rows.length - 1, popIdx + (ev.key === 'ArrowDown' ? 1 : -1)));
    rows.forEach((r, i) => r.classList.toggle('on', i === popIdx));
    if (rows[popIdx]) rows[popIdx].scrollIntoView({ block: 'nearest' });
  } else if (ev.key === 'Enter' && rows[popIdx]) { rows[popIdx].click(); }
  else if (ev.key === 'Escape') { $('#searchPop').hidden = true; $('#q').blur(); }
};
document.addEventListener('click', (ev) => {
  if (!ev.target.closest('#searchPop') && ev.target !== $('#q')) $('#searchPop').hidden = true;
});
function doSearch() {
  const q = P.matchKey($('#q').value);
  const pop = $('#searchPop');
  if (q.length < 1) { pop.hidden = true; return; }
  const hits = searchIdx.filter((x) => x.key.includes(q))
    .sort((a, b) => rank(a.n) - rank(b.n) || a.key.length - b.key.length).slice(0, 40);
  popIdx = hits.length ? 0 : -1;
  pop.innerHTML = hits.length
    ? hits.map((x, i) => `<div class="sr${i === 0 ? ' on' : ''}" data-id="${esc(x.n.id)}">
        <span class="badge kind" style="background:${KIND[x.n.kind].raw}">${KIND[x.n.kind].label}</span>
        <b>${esc(x.n.code || '')}</b> ${esc(labelOf(x.n))}
        <small><br>${esc(disp(x.n.groupLabel || x.n.group || x.n.category || ''))} ${esc(x.n.unit || '')}</small></div>`).join('')
    : '<div class="none">該当なし</div>';
  pop.hidden = false;
  $$('#searchPop .sr').forEach((r) => r.onclick = () => { pop.hidden = true; gotoNode(r.dataset.id); });
}
const RANKS = { flow: 0, screen: 1, batch: 2, file: 3, table: 4, screengroup: 5, batchgroup: 6 };
const rank = (n) => (RANKS[n.kind] === undefined ? 9 : RANKS[n.kind]);

// =================================================================
// 出力ユーティリティ
// =================================================================
function download(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
function downloadCsv(rows, name) {
  const body = rows.map((r) => r.map((c) => `"${String(c == null ? '' : c).replace(/"/g, '""')}"`).join(',')).join('\r\n');
  download(new Blob(['﻿' + body], { type: 'text/csv' }), name);
}

// =================================================================
// ディープリンク
// =================================================================
let applying = false;   // applyHash 実行中は URL を書き戻さない
function setHash() {
  if (applying) return;
  const h = state.view === 'flow' && state.flow ? `#view=flow&node=${encodeURIComponent(state.flow)}`
    : state.view === 'doc' && state.doc ? `#view=doc&doc=${encodeURIComponent(state.doc)}`
    : `#view=${state.view}`;
  if (location.hash !== h) location.hash = h;
}
function hashOf() { return location.hash; }

function applyHash() {
  applying = true;
  try {
    const p = new URLSearchParams(location.hash.replace(/^#/, ''));
    const v = p.get('view') || 'flow';
    if (v === 'doc' && p.get('doc')) { setView('doc'); openDoc(p.get('doc')); return; }
    setView(v);
    if (v === 'flow') openFlow(p.get('node') && N.has(p.get('node')) ? p.get('node') : (state.flow || defaultFlow()));
  } finally {
    applying = false;
    setHash();
  }
}
addEventListener('hashchange', () => { if (!applying) applyHash(); });
function defaultFlow() {
  return flows.slice().sort((a, b) => flowRichness(b) - flowRichness(a))[0].id;
}

// ---------------------------------------------------------------- go
renderFlowTree();
applyHash();
})();
