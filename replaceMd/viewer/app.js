/*
 * app.js — 要件定義書 相互参照ビューア（UI）
 *
 * graph-data.js（build-index.mjs の生成物）を読み込み、
 *   F-02 エクスプローラ / F-03 ドキュメント / F-04 参照パネル / F-05 検索 /
 *   F-06 機能ID逆引き / F-07 履歴・ディープリンク / F-08〜F-13 グラフ・マトリクス /
 *   F-14〜F-18 品質チェック・エクスポート
 * を提供する。外部ライブラリ不使用。
 */
(function () {
  'use strict';

  // #region agent log
  const __dbg = (hypothesisId, location, message, data) => {
    fetch('http://127.0.0.1:7480/ingest/82681717-6d41-4b44-842a-0d89af77aeee',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'0f9781'},body:JSON.stringify({sessionId:'0f9781',runId:'post-fix',hypothesisId,location,message,data,timestamp:Date.now()})}).catch(()=>{});
  };
  // #endregion

  const G = window.__REQ_GRAPH__;
  const P = window.RGParser;
  const CFG = window.RGConfig;

  // #region agent log
  __dbg('B', 'app.js:globals', 'script globals after load', {
    hasG: !!G, hasP: !!P, hasCFG: !!CFG,
    docCount: G && G.docs && G.docs.length,
    protocol: location.protocol, href: location.href
  });
  // #endregion

  if (!G) {
    const el = document.getElementById('boot-error');
    el.hidden = false;
    el.textContent =
      'graph-data.js が読み込めませんでした。\n\n'
      + 'viewer/src で次を実行してインデックスを生成してください:\n'
      + '    node build-index.mjs';
    // #region agent log
    __dbg('B', 'app.js:no-graph', 'graph missing early return', { bootHidden: el.hidden });
    // #endregion
    return;
  }

  /* ================================================================
   * 0. インデックス構築
   * ================================================================ */
  const docById = new Map(G.docs.map((d) => [d.id, d]));
  const nodeById = new Map(G.nodes.map((n) => [n.id, n]));
  const outEdges = new Map();
  const inEdges = new Map();
  for (const e of G.edges) {
    if (!outEdges.has(e.s)) outEdges.set(e.s, []);
    if (!inEdges.has(e.t)) inEdges.set(e.t, []);
    outEdges.get(e.s).push(e);
    inEdges.get(e.t).push(e);
  }
  const adj = new Map();                     // 無向隣接（経路探索・ホップ計算用）
  for (const e of G.edges) {
    if (!adj.has(e.s)) adj.set(e.s, new Set());
    if (!adj.has(e.t)) adj.set(e.t, new Set());
    adj.get(e.s).add(e.t);
    adj.get(e.t).add(e.s);
  }

  /* 機能ID → ノード（ドメインをまたいで引けるようにする） */
  const funcByCode = new Map();
  for (const n of G.nodes) {
    if (n.type !== 'func') continue;
    const code = n.meta.funcId;
    if (!code) continue;
    if (!funcByCode.has(code)) funcByCode.set(code, []);
    funcByCode.get(code).push(n);
  }

  /* 検索用の正規化テキスト（ロード時に 1 度だけ作る） */
  const searchDocs = G.docs.map((d) => ({
    doc: d,
    hay: P.normText(d.title + ' ' + d.path + ' ' + d.body.replace(/<br\s*\/?>/g, ' ')).toLowerCase(),
  }));

  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));
  const el = (tag, cls, text) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  };
  const typeColor = (t) => (CFG.NODE_TYPES[t] || {}).color || '#888';
  const typeLabel = (t) => (CFG.NODE_TYPES[t] || {}).label || t;
  const edgeLabel = (t) => (CFG.EDGE_TYPES[t] || {}).label || t;

  /* ================================================================
   * 1. 状態 と ルーティング（F-07）
   * ================================================================ */
  const state = {
    view: 'doc',
    selDoc: null,
    selNode: null,
    leftMode: 'tree',
    query: '',
    graph: {
      focus: '', focusSet: false, hops: 2,
      nodeTypes: new Set(Object.keys(CFG.NODE_TYPES)),
      edgeTypes: new Set(Object.keys(CFG.EDGE_TYPES).filter((t) => !CFG.DEFAULT_HIDDEN_EDGES.includes(t))),
      path: [],
    },
    issueTypes: new Set(),
  };
  let suppressHash = false;
  const history = { stack: [], pos: -1 };

  function pushHistory(hash) {
    if (history.stack[history.pos] === hash) return;
    history.stack = history.stack.slice(0, history.pos + 1);
    history.stack.push(hash);
    history.pos = history.stack.length - 1;
    updateNavButtons();
  }
  function updateNavButtons() {
    $('#nav-back').disabled = history.pos <= 0;
    $('#nav-fwd').disabled = history.pos >= history.stack.length - 1;
  }

  function buildHash() {
    const p = [`view=${state.view}`];
    if (state.selDoc) p.push(`doc=${encodeURIComponent(state.selDoc)}`);
    if (state.selNode) p.push(`node=${encodeURIComponent(state.selNode)}`);
    return '#' + p.join('&');
  }
  function syncHash(record = true) {
    const h = buildHash();
    if (location.hash !== h) {
      suppressHash = true;
      location.hash = h;
      setTimeout(() => { suppressHash = false; }, 0);
    }
    if (record) pushHistory(h);
  }
  function applyHash(hash) {
    const params = new URLSearchParams((hash || '').replace(/^#/, ''));
    const view = params.get('view');
    const doc = params.get('doc');
    const node = params.get('node');
    if (doc && docById.has(doc)) { state.selDoc = doc; state.selNode = null; }
    else if (node && nodeById.has(node)) { state.selNode = node; state.selDoc = null; }
    if (view) state.view = view;
    renderAll();
  }
  window.addEventListener('hashchange', () => {
    if (suppressHash) return;
    applyHash(location.hash);
  });

  /* 選択操作 ------------------------------------------------------- */
  function selectDoc(id, opts = {}) {
    if (!docById.has(id)) return;
    state.selDoc = id;
    state.selNode = null;
    if (state.view !== 'doc' && !opts.keepView) state.view = 'doc';
    renderAll();
    syncHash();
  }
  function selectNode(id, opts = {}) {
    const n = nodeById.get(id);
    if (!n) return;
    if (n.type === 'doc') return selectDoc(id, opts);
    state.selNode = id;
    state.selDoc = null;
    renderAll();
    syncHash();
  }

  /* ================================================================
   * 2. 左ペイン
   * ================================================================ */

  /* --- F-02 エクスプローラ（フォルダ階層ツリー） ------------------- */
  const treeRoot = { name: '', children: new Map(), docs: [] };
  for (const d of G.docs) {
    let cur = treeRoot;
    for (const part of d.dir.split('/')) {
      if (part === '.' || part === '') continue;
      if (!cur.children.has(part)) cur.children.set(part, { name: part, children: new Map(), docs: [] });
      cur = cur.children.get(part);
    }
    cur.docs.push(d);
  }
  /* 初期状態では深い階層を畳んでおく（全開だと 180 行超になり見通しが悪い） */
  const collapsed = new Set();
  (function collapseDeep(node, key, depth) {
    for (const [name, child] of node.children) {
      const k = key + '/' + name;
      if (depth >= 1) collapsed.add(k);
      collapseDeep(child, k, depth + 1);
    }
  })(treeRoot, '', 0);

  /** 選択中スライドまでの経路を開く */
  function revealDoc(docId) {
    const d = docById.get(docId);
    if (!d) return;
    let key = '';
    for (const part of d.dir.split('/')) {
      if (!part || part === '.') continue;
      key += '/' + part;
      collapsed.delete(key);
    }
  }

  function countDocs(node) {
    let n = node.docs.length;
    for (const c of node.children.values()) n += countDocs(c);
    return n;
  }

  function renderTree() {
    const host = $('#tree');
    host.innerHTML = '';
    if (state.selDoc) revealDoc(state.selDoc);
    const build = (node, pathKey, depth) => {
      const frag = document.createDocumentFragment();
      for (const [name, child] of node.children) {
        const key = pathKey + '/' + name;
        const isOpen = !collapsed.has(key);
        const wrap = el('div', 'tree-node');
        const row = el('div', 'tree-row');
        row.appendChild(el('span', 'tree-caret', isOpen ? '▼' : '▶'));
        row.appendChild(el('span', 'tree-label', name.replace(/\.pptx$/, '')));
        row.appendChild(el('span', 'tree-count', String(countDocs(child))));
        row.onclick = () => { isOpen ? collapsed.add(key) : collapsed.delete(key); renderTree(); };
        wrap.appendChild(row);
        if (isOpen) {
          const kids = el('div', 'tree-children');
          kids.appendChild(build(child, key, depth + 1));
          wrap.appendChild(kids);
        }
        frag.appendChild(wrap);
      }
      for (const d of node.docs.sort((a, b) => (a.slide || 0) - (b.slide || 0))) {
        const row = el('div', 'tree-row' + (state.selDoc === d.id ? ' is-sel' : ''));
        row.appendChild(el('span', 'tree-caret', ''));
        row.appendChild(el('span', 'tree-label', `${d.slide != null ? d.slide + '. ' : ''}${d.title}`));
        const chip = el('span', 'kind-chip', CFG.KIND_LABELS[d.kind] || d.kind);
        row.appendChild(chip);
        row.title = d.path;
        row.onclick = () => selectDoc(d.id);
        frag.appendChild(row);
      }
      return frag;
    };
    host.appendChild(build(treeRoot, '', 0));
    const sel = host.querySelector('.is-sel');
    if (sel) sel.scrollIntoView({ block: 'nearest' });
  }

  /* --- F-05 全文検索 / F-06 機能ID逆引き --------------------------- */
  function runSearch(q) {
    const query = P.normText(q).toLowerCase();
    const host = $('#search-results');
    host.innerHTML = '';
    if (!query) { host.appendChild(el('div', 'empty', '検索語を入力してください。')); return; }

    /* F-06: 機能ID を入れたら定義・権限・参照フローをまとめて出す */
    const code = P.normFuncId(query);
    if (code && funcByCode.has(code)) {
      const head = el('div', 'rel-head');
      head.appendChild(el('span', null, `機能ID ${code} の逆引き`));
      host.appendChild(head);
      for (const n of funcByCode.get(code)) host.appendChild(nodeItem(n));
    }

    const hits = [];
    for (const { doc, hay } of searchDocs) {
      const i = hay.indexOf(query);
      if (i < 0) continue;
      let count = 0, from = 0, k;
      while ((k = hay.indexOf(query, from)) >= 0) { count++; from = k + query.length; }
      hits.push({ doc, i, count });
    }
    hits.sort((a, b) => b.count - a.count || a.doc.path.localeCompare(b.doc.path, 'ja'));

    const head = el('div', 'rel-head');
    head.appendChild(el('span', null, '全文検索'));
    head.appendChild(el('span', 'n', `${hits.length} 件`));
    host.appendChild(head);
    if (!hits.length) { host.appendChild(el('div', 'empty', '該当なし')); return; }

    for (const h of hits.slice(0, 200)) {
      const btn = el('button', 'item' + (state.selDoc === h.doc.id ? ' is-sel' : ''));
      btn.appendChild(el('div', 'item-title', h.doc.title));
      btn.appendChild(el('div', 'item-sub', `${h.doc.deck} / スライド${h.doc.slide}・${h.count} 件ヒット`));
      const snip = el('div', 'item-snippet');
      snip.innerHTML = makeSnippet(h.doc.body, query);
      btn.appendChild(snip);
      btn.onclick = () => { selectDoc(h.doc.id); highlightInDoc(query); };
      host.appendChild(btn);
    }
  }

  function makeSnippet(body, query) {
    const flat = P.normText(body.replace(/<br\s*\/?>/g, ' ').replace(/[|#>*]/g, ' '));
    const i = flat.toLowerCase().indexOf(query);
    if (i < 0) return P.escapeHtml(flat.slice(0, 90)) + '…';
    const s = Math.max(0, i - 35);
    const raw = flat.slice(s, i + query.length + 45);
    const esc = P.escapeHtml(raw);
    const re = new RegExp(P.escapeHtml(query).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
    return (s > 0 ? '…' : '') + esc.replace(re, (m) => `<mark>${m}</mark>`) + '…';
  }

  /* --- 要素一覧（機能・フロー・データ…） -------------------------- */
  function renderNodeList() {
    const host = $('#node-list');
    host.innerHTML = '';
    const groups = ['func', 'flow', 'entity', 'system', 'actor', 'external', 'request'];
    for (const t of groups) {
      const list = G.nodes.filter((n) => n.type === t);
      if (!list.length) continue;
      const head = el('div', 'rel-head');
      const dot = el('span', 'type-dot'); dot.style.background = typeColor(t);
      head.appendChild(dot);
      head.appendChild(el('span', null, typeLabel(t)));
      head.appendChild(el('span', 'n', String(list.length)));
      let open = t === 'func';
      head.style.cursor = 'pointer';
      const box = el('div');
      box.hidden = !open;
      head.onclick = () => { open = !open; box.hidden = !open; };
      host.appendChild(head);
      for (const n of list.sort((a, b) => a.label.localeCompare(b.label, 'ja'))) box.appendChild(nodeItem(n));
      host.appendChild(box);
    }
  }

  function nodeItem(n) {
    const btn = el('button', 'item' + (state.selNode === n.id ? ' is-sel' : ''));
    const row = el('div', 'rel-item');
    const dot = el('span', 'type-dot'); dot.style.background = typeColor(n.type);
    row.appendChild(dot);
    const main = el('div', 'rel-main');
    main.appendChild(el('div', 'rel-label', n.label));
    main.appendChild(el('div', 'rel-sub', `${typeLabel(n.type)}${n.sub ? ' · ' + n.sub : ''} · ${n.docs.length} スライド`));
    row.appendChild(main);
    btn.appendChild(row);
    btn.onclick = () => selectNode(n.id);
    return btn;
  }

  function setLeftMode(mode) {
    state.leftMode = mode;
    $$('#left-mode .seg-btn').forEach((b) => b.classList.toggle('is-active', b.dataset.mode === mode));
    $('#tree').hidden = mode !== 'tree';
    $('#search-results').hidden = mode !== 'search';
    $('#node-list').hidden = mode !== 'nodes';
    if (mode === 'nodes' && !$('#node-list').childElementCount) renderNodeList();
  }

  /* ================================================================
   * 3. ドキュメントビュー（F-03）
   * ================================================================ */

  /** 本文 HTML 内の参照表記をクリック可能にする */
  function decorateRefs(html, doc) {
    /* [03-01] 形式の機能参照 */
    html = html.replace(/\[(\d{2}[-_]\d{2})\]/g, (all, raw) => {
      const code = P.normFuncId(raw);
      const cands = funcByCode.get(code) || [];
      const hit = cands.find((n) => n.meta.domain === doc.domain) || cands[0];
      if (!hit) return `<span class="xref is-dead" title="定義が見つかりません">${all}</span>`;
      return `<a class="xref" data-node="${P.escapeHtml(hit.id)}" title="${P.escapeHtml(hit.label)}">${all}</a>`;
    });
    /* 「〜.xls」形式の外部資料参照 */
    html = html.replace(/「([^」]*\.(?:xls|xlsx|xlsm|doc|docx|ppt|pptx|csv|pdf|txt)[^」]*)」/gi, (all, f) => {
      const id = `ext:${f}`;
      if (!nodeById.has(id)) return all;
      return `「<a class="xref" data-node="${P.escapeHtml(id)}">${P.escapeHtml(f)}</a>」`;
    });
    /* 改善要望No. */
    html = html.replace(/改善要望\s*No\.?\s*([0-9]+(?:-[0-9]+)?)/g, (all, no) => {
      const id = `req:${no}`;
      if (!nodeById.has(id)) return all;
      return `<a class="xref" data-node="${P.escapeHtml(id)}">${all}</a>`;
    });
    return html;
  }

  function renderDoc() {
    const head = $('#doc-head');
    const body = $('#doc-body');
    head.innerHTML = '';
    body.innerHTML = '';
    const d = state.selDoc ? docById.get(state.selDoc) : null;

    if (!d) {
      head.appendChild(el('h1', 'doc-title', '要件定義書 相互参照ビューア'));
      const p = el('div', 'doc-path', `${G.meta.docCount} スライド / ${G.meta.nodeCount} 要素 / ${G.meta.edgeCount} 参照関係`);
      head.appendChild(p);
      const intro = el('div', 'md');
      intro.innerHTML = `
        <h2>使い方</h2>
        <ul>
          <li><b>左ペイン</b>：フォルダ階層からスライドを選ぶ。「要素」タブで機能・業務フロー・データから引くこともできる。</li>
          <li><b>中央</b>：本文。<code>[03-01]</code> のような参照はクリックで飛べる。</li>
          <li><b>右ペイン</b>：選択中の対象が <b>参照している先</b> と <b>参照されている元</b>。</li>
          <li><b>上部タブ</b>：参照グラフ / トレーサビリティ / 現行↔新 / 品質チェック。</li>
          <li><kbd>/</kbd> で検索へ。機能ID（例 <code>03-01</code>）を入れると逆引きになる。</li>
        </ul>`;
      body.appendChild(intro);
      return;
    }

    head.appendChild(el('h1', 'doc-title', d.title));
    head.appendChild(el('div', 'doc-path', d.path));
    const tags = el('div', 'doc-tags');
    const add = (text, cls) => tags.appendChild(el('span', 'tag' + (cls ? ' ' + cls : ''), text));
    add(CFG.DOMAIN_LABELS[d.domain] || d.domain, 'accent');
    add(CFG.KIND_LABELS[d.kind] || d.kind);
    add(`${d.deck} / スライド${d.slide}`);
    if (d.chapter) add(`章 ${d.chapter}`);
    if (d.flow && nodeById.has(d.flow)) {
      const t = el('span', 'tag accent');
      t.textContent = 'フロー: ' + nodeById.get(d.flow).label;
      t.style.cursor = 'pointer';
      t.onclick = () => selectNode(d.flow);
      tags.appendChild(t);
    }
    if (d.reconstructed) add('⚠ AI が画像から再構成（要原本確認）', 'warn');
    if (d.duplicateOf && d.duplicateOf !== d.id) add('内容が他スライドと重複', 'warn');
    head.appendChild(tags);

    body.innerHTML = P.renderMarkdown(d.body, (h) => decorateRefs(h, d));
    body.querySelectorAll('a.xref[data-node]').forEach((a) => {
      a.onclick = (ev) => { ev.preventDefault(); selectNode(a.dataset.node); };
    });
    body.scrollTop = 0;
  }

  function highlightInDoc(query) {
    if (!query) return;
    const body = $('#doc-body');
    const walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT);
    const targets = [];
    while (walker.nextNode()) {
      const t = walker.currentNode;
      if (t.nodeValue.toLowerCase().includes(query)) targets.push(t);
    }
    let first = null;
    for (const t of targets) {
      const frag = document.createDocumentFragment();
      const parts = t.nodeValue.split(new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi'));
      parts.forEach((p, i) => {
        if (i % 2 === 1) {
          const m = el('mark', null, p);
          if (!first) first = m;
          frag.appendChild(m);
        } else frag.appendChild(document.createTextNode(p));
      });
      t.parentNode.replaceChild(frag, t);
    }
    if (first) first.scrollIntoView({ block: 'center' });
  }

  /* ================================================================
   * 4. 右ペイン：参照関係（F-04）
   * ================================================================ */
  function renderRelations() {
    const host = $('#relations');
    host.innerHTML = '';
    const id = state.selNode || state.selDoc;
    $('#right-title').textContent = '参照関係';
    if (!id) { host.appendChild(el('div', 'empty', 'スライドまたは要素を選ぶと、参照関係が出ます。')); return; }

    const node = nodeById.get(id);
    if (node && node.type !== 'doc') host.appendChild(nodeDetail(node));

    const out = (outEdges.get(id) || []);
    const inc = (inEdges.get(id) || []);
    renderEdgeGroups(host, '参照している先', out, 't');
    renderEdgeGroups(host, '参照されている元', inc, 's');

    if (node && node.docs.length) {
      const head = el('div', 'rel-head');
      head.appendChild(el('span', null, '記載スライド'));
      head.appendChild(el('span', 'n', String(node.docs.length)));
      host.appendChild(head);
      for (const did of node.docs) {
        const d = docById.get(did);
        if (!d) continue;
        const b = el('button', 'rel-item');
        const dot = el('span', 'type-dot'); dot.style.background = typeColor('doc');
        b.appendChild(dot);
        const main = el('div', 'rel-main');
        main.appendChild(el('div', 'rel-label', d.title));
        main.appendChild(el('div', 'rel-sub', `${d.deck} / スライド${d.slide}`));
        b.appendChild(main);
        b.onclick = () => selectDoc(d.id);
        host.appendChild(b);
      }
    }
  }

  function renderEdgeGroups(host, title, list, side) {
    if (!list.length) return;
    const byType = new Map();
    for (const e of list) {
      if (!byType.has(e.type)) byType.set(e.type, []);
      byType.get(e.type).push(e);
    }
    const head = el('div', 'rel-head');
    head.appendChild(el('span', null, title));
    head.appendChild(el('span', 'n', String(list.length)));
    host.appendChild(head);

    for (const [type, es] of [...byType].sort((a, b) => b[1].length - a[1].length)) {
      const grp = el('div', 'rel-group');
      const h = el('div', 'rel-head');
      h.style.borderBottom = 'none';
      h.appendChild(el('span', null, edgeLabel(type)));
      h.appendChild(el('span', 'n', String(es.length)));
      grp.appendChild(h);
      const seen = new Set();
      for (const e of es) {
        const otherId = e[side];
        if (seen.has(otherId)) continue;
        seen.add(otherId);
        const other = nodeById.get(otherId);
        if (!other) continue;
        const b = el('button', 'rel-item');
        const dot = el('span', 'type-dot'); dot.style.background = typeColor(other.type);
        b.appendChild(dot);
        const main = el('div', 'rel-main');
        main.appendChild(el('div', 'rel-label', other.label));
        const bits = [typeLabel(other.type)];
        if (e.label) bits.push(e.label);
        main.appendChild(el('div', 'rel-sub', bits.join(' · ')));
        if (e.evidence) {
          const ev = el('div', 'rel-ev', '“' + e.evidence.slice(0, 70) + '”');
          ev.title = e.evidence;
          main.appendChild(ev);
        }
        b.appendChild(main);
        b.onclick = () => selectNode(otherId);
        grp.appendChild(b);
      }
      host.appendChild(grp);
    }
  }

  function nodeDetail(n) {
    const box = el('div', 'detail-block');
    const h = el('div', 'rel-head');
    const dot = el('span', 'type-dot'); dot.style.background = typeColor(n.type);
    h.appendChild(dot);
    h.appendChild(el('span', null, typeLabel(n.type)));
    box.appendChild(h);
    box.appendChild(el('div', 'item-title', n.label));
    if (n.sub) box.appendChild(el('div', 'item-sub', n.sub));

    const dl = el('dl');
    const put = (k, v) => {
      if (!v) return;
      dl.appendChild(el('dt', null, k));
      const dd = el('dd');
      dd.innerHTML = P.renderInline(String(v));
      dl.appendChild(dd);
    };
    const m = n.meta || {};
    put('分類', m.category);
    put('機能区分', m.funcType);
    put('機能要件', m.requirement);
    put('説明', m.desc);
    put('主なデータ項目', m.items);
    put('業務', m.task);
    put('備考', m.note);
    if (m.permissions) {
      dl.appendChild(el('dt', null, '権限'));
      const dd = el('dd');
      const t = el('table');
      t.className = 'matrix';
      for (const [role, val] of Object.entries(m.permissions)) {
        const tr = el('tr');
        const th = el('th', null, role);
        const td = el('td', null, val);
        td.style.textAlign = 'left';
        tr.appendChild(th); tr.appendChild(td);
        t.appendChild(tr);
      }
      dd.appendChild(t);
      dl.appendChild(dd);
    }
    if (dl.childElementCount) box.appendChild(dl);

    const act = el('div');
    act.style.marginTop = '8px';
    const gbtn = el('button', 'btn', 'グラフで見る');
    gbtn.onclick = () => {
      state.graph.focus = n.id;
      state.graph.focusSet = true;
      state.graph.path = [];
      state.view = 'graph';
      renderAll(); syncHash();
    };
    act.appendChild(gbtn);
    box.appendChild(act);
    return box;
  }

  /* ================================================================
   * 5. 参照グラフ（F-08〜F-10, F-13）
   * ================================================================ */
  const canvas = $('#graph-canvas');
  const ctx = canvas.getContext('2d');
  const cam = { x: 0, y: 0, k: 1 };
  let layoutNodes = [];   // {id,x,y,vx,vy,r,node}
  let layoutEdges = [];
  let posById = new Map();
  let hoverId = null;
  let dragNode = null;
  let panning = false;
  let lastPtr = { x: 0, y: 0 };

  function buildFilterChips() {
    const nb = $('#filter-nodes');
    nb.innerHTML = '';
    for (const [t, meta] of Object.entries(CFG.NODE_TYPES)) {
      const c = el('button', 'chip' + (state.graph.nodeTypes.has(t) ? ' on' : ''));
      c.style.color = state.graph.nodeTypes.has(t) ? meta.color : '';
      const d = el('span', 'dot'); d.style.background = meta.color;
      c.appendChild(d);
      c.appendChild(document.createTextNode(meta.label));
      c.onclick = () => {
        state.graph.nodeTypes.has(t) ? state.graph.nodeTypes.delete(t) : state.graph.nodeTypes.add(t);
        buildFilterChips(); rebuildGraph(true);
      };
      nb.appendChild(c);
    }
    const eb = $('#filter-edges');
    eb.innerHTML = '';
    for (const [t, meta] of Object.entries(CFG.EDGE_TYPES)) {
      const c = el('button', 'chip' + (state.graph.edgeTypes.has(t) ? ' on' : ''), meta.label);
      c.onclick = () => {
        state.graph.edgeTypes.has(t) ? state.graph.edgeTypes.delete(t) : state.graph.edgeTypes.add(t);
        buildFilterChips(); rebuildGraph(true);
      };
      eb.appendChild(c);
    }
  }

  function fillNodeSelect(sel, placeholder) {
    sel.innerHTML = '';
    sel.appendChild(new Option(placeholder, ''));
    const groups = ['func', 'flow', 'entity', 'system', 'actor', 'doc', 'external', 'request'];
    for (const t of groups) {
      const list = G.nodes.filter((n) => n.type === t).sort((a, b) => a.label.localeCompare(b.label, 'ja'));
      if (!list.length) continue;
      const og = document.createElement('optgroup');
      og.label = typeLabel(t);
      for (const n of list) og.appendChild(new Option(n.label.slice(0, 60), n.id));
      sel.appendChild(og);
    }
  }

  /**
   * 起点ノード。
   * 「起点」プルダウンを操作していない間は選択中の対象に追従し、
   * 明示的に選んだあと（「（全体）」を含む）はその指定を優先する。
   */
  function currentFocus() {
    if (state.graph.focusSet) {
      return nodeById.has(state.graph.focus) ? state.graph.focus : '';
    }
    const sel = state.selNode || state.selDoc;
    return sel && nodeById.has(sel) ? sel : '';
  }

  /** 表示対象のサブグラフを求める（F-09 フォーカスモード） */
  function computeSubgraph() {
    const useEdge = (e) => state.graph.edgeTypes.has(e.type)
      && state.graph.nodeTypes.has((nodeById.get(e.s) || {}).type)
      && state.graph.nodeTypes.has((nodeById.get(e.t) || {}).type);
    const usable = G.edges.filter(useEdge);
    const focus = currentFocus();

    let ids;
    if (state.graph.path.length) {
      ids = new Set(state.graph.path);
    } else if (focus) {
      const nb = new Map();
      for (const e of usable) {
        if (!nb.has(e.s)) nb.set(e.s, new Set());
        if (!nb.has(e.t)) nb.set(e.t, new Set());
        nb.get(e.s).add(e.t); nb.get(e.t).add(e.s);
      }
      ids = new Set([focus]);
      let frontier = [focus];
      for (let h = 0; h < state.graph.hops; h++) {
        const next = [];
        for (const id of frontier) for (const o of (nb.get(id) || [])) if (!ids.has(o)) { ids.add(o); next.push(o); }
        frontier = next;
      }
    } else {
      ids = new Set();
      for (const n of G.nodes) if (state.graph.nodeTypes.has(n.type)) ids.add(n.id);
    }

    const nodes = [...ids].map((id) => nodeById.get(id)).filter(Boolean)
      .filter((n) => state.graph.nodeTypes.has(n.type) || n.id === focus);
    const keep = new Set(nodes.map((n) => n.id));
    const edges = usable.filter((e) => keep.has(e.s) && keep.has(e.t));
    return { nodes, edges };
  }

  /** 力学レイアウト（Fruchterman-Reingold + グリッド近似） */
  function layoutGraph(nodes, edges, iterations) {
    const n = nodes.length;
    if (!n) return;
    const W = 1200, H = 820;
    const k = Math.sqrt((W * H) / n) * 0.85;
    const idx = new Map(nodes.map((p, i) => [p.id, i]));

    nodes.forEach((p, i) => {
      if (p.x == null || !isFinite(p.x)) {
        const a = (i / n) * Math.PI * 2;
        const r = 40 + Math.sqrt(i / n) * Math.min(W, H) * 0.45;
        p.x = W / 2 + Math.cos(a) * r;
        p.y = H / 2 + Math.sin(a) * r;
      }
      p.dx = 0; p.dy = 0;
    });

    const links = edges.map((e) => [idx.get(e.s), idx.get(e.t), (CFG.EDGE_TYPES[e.type] || {}).weight || 1])
      .filter(([a, b]) => a != null && b != null);

    const cell = k * 2;
    for (let it = 0; it < iterations; it++) {
      const temp = k * 0.28 * (1 - it / iterations) + 0.6;

      /* 斥力：近傍セルのみ見る */
      const grid = new Map();
      for (const p of nodes) {
        const gx = Math.floor(p.x / cell), gy = Math.floor(p.y / cell);
        const key = gx + ',' + gy;
        if (!grid.has(key)) grid.set(key, []);
        grid.get(key).push(p);
        p.dx = 0; p.dy = 0;
      }
      for (const p of nodes) {
        const gx = Math.floor(p.x / cell), gy = Math.floor(p.y / cell);
        for (let ox = -1; ox <= 1; ox++) for (let oy = -1; oy <= 1; oy++) {
          const bucket = grid.get((gx + ox) + ',' + (gy + oy));
          if (!bucket) continue;
          for (const q of bucket) {
            if (q === p) continue;
            let dx = p.x - q.x, dy = p.y - q.y;
            let d2 = dx * dx + dy * dy;
            if (d2 < 0.01) { dx = Math.random() - 0.5; dy = Math.random() - 0.5; d2 = 0.01; }
            const d = Math.sqrt(d2);
            const f = (k * k) / d;
            p.dx += (dx / d) * f;
            p.dy += (dy / d) * f;
          }
        }
      }

      /* 引力 */
      for (const [a, b, w] of links) {
        const pa = nodes[a], pb = nodes[b];
        const dx = pa.x - pb.x, dy = pa.y - pb.y;
        const d = Math.sqrt(dx * dx + dy * dy) || 0.01;
        const f = ((d * d) / k) * Math.min(w, 3) * 0.6;
        const ux = (dx / d) * f, uy = (dy / d) * f;
        pa.dx -= ux; pa.dy -= uy;
        pb.dx += ux; pb.dy += uy;
      }

      /* 中心への弱い重力 + 移動 */
      for (const p of nodes) {
        p.dx += (W / 2 - p.x) * 0.012;
        p.dy += (H / 2 - p.y) * 0.012;
        if (p.pinned) continue;
        const d = Math.sqrt(p.dx * p.dx + p.dy * p.dy) || 1;
        const lim = Math.min(d, temp);
        p.x += (p.dx / d) * lim;
        p.y += (p.dy / d) * lim;
      }
    }
  }

  function rebuildGraph(keepPositions) {
    const { nodes, edges } = computeSubgraph();
    const prev = posById;
    layoutNodes = nodes.map((n) => {
      const old = keepPositions ? prev.get(n.id) : null;
      const deg = (outEdges.get(n.id) || []).length + (inEdges.get(n.id) || []).length;
      return {
        id: n.id, node: n,
        x: old ? old.x : null, y: old ? old.y : null,
        r: Math.min(16, 4 + Math.sqrt(deg) * 1.6),
      };
    });
    layoutEdges = edges;
    const iters = layoutNodes.length > 400 ? 90 : layoutNodes.length > 150 ? 160 : 260;
    layoutGraph(layoutNodes, layoutEdges, iters);
    posById = new Map(layoutNodes.map((p) => [p.id, p]));
    fitView();
    drawGraph();
  }

  function fitView() {
    if (!layoutNodes.length) return;
    const xs = layoutNodes.map((p) => p.x), ys = layoutNodes.map((p) => p.y);
    const minX = Math.min(...xs), maxX = Math.max(...xs);
    const minY = Math.min(...ys), maxY = Math.max(...ys);
    const w = canvas.clientWidth || 800, h = canvas.clientHeight || 600;
    const pad = 60;
    cam.k = Math.min((w - pad * 2) / Math.max(maxX - minX, 1), (h - pad * 2) / Math.max(maxY - minY, 1), 2.2);
    cam.x = w / 2 - ((minX + maxX) / 2) * cam.k;
    cam.y = h / 2 - ((minY + maxY) / 2) * cam.k;
  }

  function resizeCanvas() {
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (!w || !h) return;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function drawGraph() {
    if (state.view !== 'graph') return;
    resizeCanvas();
    const w = canvas.clientWidth, h = canvas.clientHeight;
    const css = getComputedStyle(document.body);
    ctx.clearRect(0, 0, w, h);
    ctx.save();
    ctx.translate(cam.x, cam.y);
    ctx.scale(cam.k, cam.k);

    const selId = state.selNode || state.selDoc;
    const near = new Set();
    if (hoverId || selId) {
      for (const e of layoutEdges) {
        if (e.s === (hoverId || selId)) near.add(e.t);
        if (e.t === (hoverId || selId)) near.add(e.s);
      }
    }

    /* エッジ */
    for (const e of layoutEdges) {
      const a = posById.get(e.s), b = posById.get(e.t);
      if (!a || !b) continue;
      const hot = (hoverId && (e.s === hoverId || e.t === hoverId)) || (selId && (e.s === selId || e.t === selId));
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.strokeStyle = hot ? typeColor(nodeById.get(e.s).type) : 'rgba(130,140,155,.28)';
      ctx.lineWidth = hot ? 1.6 / cam.k : 0.8 / cam.k;
      const dash = (CFG.EDGE_TYPES[e.type] || {}).dash;
      ctx.setLineDash(dash ? dash.split(' ').map((v) => Number(v) / cam.k) : []);
      ctx.stroke();
      ctx.setLineDash([]);
      /* 矢羽根 */
      if (cam.k > 0.55) {
        const dx = b.x - a.x, dy = b.y - a.y;
        const d = Math.hypot(dx, dy) || 1;
        const ex = b.x - (dx / d) * (b.r + 2), ey = b.y - (dy / d) * (b.r + 2);
        const ang = Math.atan2(dy, dx);
        const s = 5 / cam.k;
        ctx.beginPath();
        ctx.moveTo(ex, ey);
        ctx.lineTo(ex - s * Math.cos(ang - 0.4), ey - s * Math.sin(ang - 0.4));
        ctx.lineTo(ex - s * Math.cos(ang + 0.4), ey - s * Math.sin(ang + 0.4));
        ctx.closePath();
        ctx.fillStyle = hot ? typeColor(nodeById.get(e.s).type) : 'rgba(130,140,155,.35)';
        ctx.fill();
      }
    }

    /* ノード */
    for (const p of layoutNodes) {
      const isSel = p.id === selId;
      const dim = (hoverId || selId) && !isSel && !near.has(p.id) && p.id !== hoverId;
      ctx.globalAlpha = dim ? 0.28 : 1;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fillStyle = typeColor(p.node.type);
      ctx.fill();
      if (isSel) {
        ctx.lineWidth = 3 / cam.k;
        ctx.strokeStyle = css.getPropertyValue('--fg') || '#000';
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }

    /* ラベル */
    const showAll = layoutNodes.length <= 60 || cam.k > 1.1;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    for (const p of layoutNodes) {
      const important = p.id === selId || p.id === hoverId || near.has(p.id) || p.r > 9;
      if (!showAll && !important) continue;
      const label = p.node.label.length > 22 ? p.node.label.slice(0, 21) + '…' : p.node.label;
      const fs = Math.max(9, 11 / cam.k);
      ctx.font = `${fs}px ${css.fontFamily}`;
      const tw = ctx.measureText(label).width;
      ctx.fillStyle = 'rgba(255,255,255,.75)';
      if (!document.body.classList.contains('dark')) {
        ctx.fillRect(p.x - tw / 2 - 2, p.y + p.r + 1, tw + 4, fs + 2);
      }
      ctx.fillStyle = css.getPropertyValue('--fg') || '#222';
      ctx.fillText(label, p.x, p.y + p.r + 2);
    }

    ctx.restore();
    const hint = $('#graph-hint');
    if (layoutNodes.length <= 1 && currentFocus()) {
      hint.textContent = '表示できる関係がありません — 「ホップ」を増やすか、エッジ種別のフィルタを緩めてください。';
    } else {
      hint.textContent =
        `${layoutNodes.length} ノード / ${layoutEdges.length} リンク — ドラッグで移動・ホイールで拡大縮小・クリックで詳細`;
    }
  }

  function pickNode(mx, my) {
    const x = (mx - cam.x) / cam.k, y = (my - cam.y) / cam.k;
    let best = null, bd = Infinity;
    for (const p of layoutNodes) {
      const d = Math.hypot(p.x - x, p.y - y);
      if (d < Math.max(p.r + 4 / cam.k, 8 / cam.k) && d < bd) { best = p; bd = d; }
    }
    return best;
  }

  function bindGraphEvents() {
    const stage = $('#graph-stage');
    const tip = $('#graph-tip');

    canvas.addEventListener('mousedown', (ev) => {
      const r = canvas.getBoundingClientRect();
      const p = pickNode(ev.clientX - r.left, ev.clientY - r.top);
      if (p) { dragNode = p; p.pinned = true; }
      else { panning = true; canvas.classList.add('dragging'); }
      lastPtr = { x: ev.clientX, y: ev.clientY };
    });
    window.addEventListener('mousemove', (ev) => {
      const r = canvas.getBoundingClientRect();
      const mx = ev.clientX - r.left, my = ev.clientY - r.top;
      if (dragNode) {
        dragNode.x += (ev.clientX - lastPtr.x) / cam.k;
        dragNode.y += (ev.clientY - lastPtr.y) / cam.k;
        lastPtr = { x: ev.clientX, y: ev.clientY };
        drawGraph();
        return;
      }
      if (panning) {
        cam.x += ev.clientX - lastPtr.x;
        cam.y += ev.clientY - lastPtr.y;
        lastPtr = { x: ev.clientX, y: ev.clientY };
        drawGraph();
        return;
      }
      if (state.view !== 'graph') return;
      if (mx < 0 || my < 0 || mx > r.width || my > r.height) { hoverId = null; tip.hidden = true; return; }
      const p = pickNode(mx, my);
      const id = p ? p.id : null;
      if (id !== hoverId) {
        hoverId = id;
        drawGraph();
      }
      if (p) {
        tip.hidden = false;
        tip.innerHTML = `<b>${P.escapeHtml(p.node.label)}</b><br>`
          + `<span style="color:${typeColor(p.node.type)}">${typeLabel(p.node.type)}</span>`
          + (p.node.sub ? ' · ' + P.escapeHtml(p.node.sub) : '');
        tip.style.left = Math.min(mx + 14, r.width - 290) + 'px';
        tip.style.top = (my + 14) + 'px';
      } else tip.hidden = true;
    });
    window.addEventListener('mouseup', (ev) => {
      if (dragNode) {
        const moved = Math.hypot(ev.clientX - lastPtr.x, ev.clientY - lastPtr.y);
        if (moved < 3) selectNode(dragNode.id);
        dragNode = null;
      } else if (panning) {
        panning = false; canvas.classList.remove('dragging');
      }
    });
    canvas.addEventListener('click', (ev) => {
      const r = canvas.getBoundingClientRect();
      const p = pickNode(ev.clientX - r.left, ev.clientY - r.top);
      if (p) selectNode(p.id);
    });
    canvas.addEventListener('wheel', (ev) => {
      ev.preventDefault();
      const r = canvas.getBoundingClientRect();
      const mx = ev.clientX - r.left, my = ev.clientY - r.top;
      const f = ev.deltaY < 0 ? 1.12 : 1 / 1.12;
      const nk = Math.max(0.15, Math.min(6, cam.k * f));
      cam.x = mx - (mx - cam.x) * (nk / cam.k);
      cam.y = my - (my - cam.y) * (nk / cam.k);
      cam.k = nk;
      drawGraph();
    }, { passive: false });

    window.addEventListener('resize', () => { if (state.view === 'graph') drawGraph(); });
    stage.addEventListener('mouseleave', () => { tip.hidden = true; });
  }

  /* F-13 パス探索 */
  function findPath(a, b) {
    if (!a || !b || a === b) return [];
    const allow = (id) => state.graph.nodeTypes.has((nodeById.get(id) || {}).type);
    const nb = new Map();
    for (const e of G.edges) {
      if (!state.graph.edgeTypes.has(e.type)) continue;
      if (!allow(e.s) || !allow(e.t)) continue;
      if (!nb.has(e.s)) nb.set(e.s, new Set());
      if (!nb.has(e.t)) nb.set(e.t, new Set());
      nb.get(e.s).add(e.t); nb.get(e.t).add(e.s);
    }
    const prev = new Map([[a, null]]);
    const q = [a];
    while (q.length) {
      const cur = q.shift();
      if (cur === b) break;
      for (const nx of (nb.get(cur) || [])) {
        if (prev.has(nx)) continue;
        prev.set(nx, cur);
        q.push(nx);
      }
    }
    if (!prev.has(b)) return null;
    const path = [];
    for (let cur = b; cur != null; cur = prev.get(cur)) path.push(cur);
    return path.reverse();
  }

  /* ================================================================
   * 6. トレーサビリティマトリクス（F-11）
   * ================================================================ */
  function renderMatrix() {
    const stage = $('#matrix-stage');
    stage.innerHTML = '';
    const domain = $('#matrix-domain').value;
    const kind = $('#matrix-kind').value;
    const gapsOnly = $('#matrix-gaps').checked;

    const rows = G.nodes.filter((n) => n.type === 'func' && n.meta.domain === domain)
      .sort((a, b) => (a.meta.funcId || '').localeCompare(b.meta.funcId || ''));

    let cols, hitOf;
    if (kind === 'flow') {
      const flowIds = new Set();
      for (const e of G.edges) {
        if (e.type !== 'implements' && e.type !== 'uses') continue;
        const f = e.type === 'implements' ? e.t : e.s;
        const fn = nodeById.get(f);
        if (fn && fn.type === 'flow' && fn.meta.domain === domain) flowIds.add(f);
      }
      cols = [...flowIds].map((id) => nodeById.get(id))
        .sort((a, b) => String(a.meta.num || 'zz').localeCompare(String(b.meta.num || 'zz'), 'ja', { numeric: true }));
      const set = new Set();
      for (const e of G.edges) {
        if (e.type === 'implements') set.add(e.s + '|' + e.t + '|1');
        if (e.type === 'uses') set.add(e.t + '|' + e.s + '|2');
      }
      hitOf = (r, c) => (set.has(r.id + '|' + c.id + '|1') ? 1 : set.has(r.id + '|' + c.id + '|2') ? 2 : 0);
    } else {
      const roleSet = new Set();
      for (const r of rows) for (const k of Object.keys(r.meta.permissions || {})) roleSet.add(k);
      cols = [...roleSet].sort().map((r) => ({ id: 'role:' + r, label: r, meta: {} }));
      hitOf = (r, c) => {
        const v = (r.meta.permissions || {})[c.label];
        return v && /^[○◯〇]/.test(v) ? 1 : v && /^[△]/.test(v) ? 2 : 0;
      };
    }

    if (!rows.length || !cols.length) {
      stage.appendChild(el('div', 'empty', '表示できるデータがありません。'));
      return;
    }

    const table = el('table', 'matrix');
    const thead = el('thead');
    const hr = el('tr');
    hr.appendChild(el('th', null, `機能 (${rows.length}) × ${kind === 'flow' ? '業務フロー' : '権限ロール'} (${cols.length})`));
    for (const c of cols) {
      const th = el('th', 'rot');
      th.appendChild(el('div', null, c.label));
      th.title = c.label;
      hr.appendChild(th);
    }
    thead.appendChild(hr);
    table.appendChild(thead);

    const tbody = el('tbody');
    let gapCount = 0;
    for (const r of rows) {
      const hits = cols.map((c) => hitOf(r, c));
      const isGap = hits.every((h) => !h);
      if (isGap) gapCount++;
      if (gapsOnly && !isGap) continue;
      const tr = el('tr', isGap ? 'gap' : '');
      const th = el('th', null, `${r.meta.funcId || ''} ${r.meta.name || r.label}`);
      th.title = r.label;
      th.onclick = () => selectNode(r.id);
      tr.appendChild(th);
      hits.forEach((h, i) => {
        const td = el('td', h === 1 ? 'hit' : h === 2 ? 'hit-2' : '');
        td.title = `${r.meta.funcId} × ${cols[i].label}`;
        if (h) td.onclick = () => selectNode(r.id);
        tr.appendChild(td);
      });
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);

    const note = el('div', 'item-sub',
      `空白行（どこにも紐付かない機能）: ${gapCount} 件 — 要件の抜けの候補。濃い塗り＝直接の割当、薄い塗り＝フロー本文からの参照/条件付き権限。`);
    note.style.marginBottom = '8px';
    stage.appendChild(note);
    stage.appendChild(table);
    matrixExport = { rows, cols, hitOf, kind, domain };
  }
  let matrixExport = null;

  /* ================================================================
   * 7. 現行 ↔ 新 対比（F-19）
   * ================================================================ */
  function renderCompare() {
    const stage = $('#compare-stage');
    stage.innerHTML = '';

    const curFlows = G.nodes.filter((n) => n.type === 'flow' && n.meta.domain === 'cur');
    const newFlows = G.nodes.filter((n) => n.type === 'flow' && n.meta.domain === 'tpc');
    const score = (a, b) => {
      const ka = P.keyOf(a.meta.name || ''), kb = P.keyOf(b.meta.name || '');
      if (!ka || !kb) return 0;
      if (ka === kb) return 3;
      if (ka.includes(kb) || kb.includes(ka)) return 2;
      const common = [...new Set(ka)].filter((ch) => kb.includes(ch)).length;
      return common / Math.max(ka.length, kb.length) > 0.6 ? 1 : 0;
    };

    const table = el('table', 'matrix');
    table.style.width = '100%';
    const thead = el('thead');
    const hr = el('tr');
    ['現行（別.3）', '対応度', 'オバートリップ（新 2.2）'].forEach((t) => hr.appendChild(el('th', null, t)));
    thead.appendChild(hr);
    table.appendChild(thead);
    const tbody = el('tbody');
    const usedNew = new Set();

    for (const c of curFlows.sort((a, b) => String(a.meta.num || '').localeCompare(String(b.meta.num || ''), 'ja', { numeric: true }))) {
      let best = null, bs = 0;
      for (const n of newFlows) {
        const s = score(c, n);
        if (s > bs) { bs = s; best = n; }
      }
      if (best) usedNew.add(best.id);
      const tr = el('tr');
      const th = el('th', null, c.label);
      th.onclick = () => selectNode(c.id);
      tr.appendChild(th);
      const td0 = el('td', null, bs >= 3 ? '＝' : bs === 2 ? '≒' : bs === 1 ? '△' : '—');
      td0.style.color = bs >= 2 ? 'var(--ok)' : bs === 1 ? 'var(--warn)' : 'var(--fg-faint)';
      tr.appendChild(td0);
      const td1 = el('td', null, best && bs ? best.label : '（対応不明・新規／廃止の可能性）');
      td1.style.textAlign = 'left';
      if (best && bs) { td1.style.cursor = 'pointer'; td1.onclick = () => selectNode(best.id); }
      tr.appendChild(td1);
      tbody.appendChild(tr);
    }
    for (const n of newFlows) {
      if (usedNew.has(n.id)) continue;
      const tr = el('tr');
      tr.appendChild(el('th', null, '（現行に対応なし＝新規）'));
      const td0 = el('td', null, '＋');
      td0.style.color = 'var(--accent)';
      tr.appendChild(td0);
      const td1 = el('td', null, n.label);
      td1.style.textAlign = 'left';
      td1.style.cursor = 'pointer';
      td1.onclick = () => selectNode(n.id);
      tr.appendChild(td1);
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);

    stage.appendChild(el('h3', null, '業務フローの対応'));
    stage.appendChild(el('div', 'item-sub', 'フロー名の一致度で機械的に突合したものです。＝完全一致 / ≒部分一致 / △類似 / —対応不明。'));
    stage.appendChild(table);

    /* 現行と新の両方に出てくるデータ */
    const both = G.nodes.filter((n) => n.type === 'entity' && (n.meta.domains || []).length > 1);
    stage.appendChild(el('h3', null, `現行・新の両方に登場するデータ（${both.length} 件）`));
    const list = el('div');
    for (const n of both.sort((a, b) => a.label.localeCompare(b.label, 'ja'))) list.appendChild(nodeItem(n));
    stage.appendChild(list);
  }

  /* ================================================================
   * 8. 品質チェック（F-14〜F-17）
   * ================================================================ */
  function renderIssues() {
    const chips = $('#issue-filter');
    const types = [...new Set(G.issues.map((i) => i.type))];
    if (!state.issueTypes.size) types.forEach((t) => state.issueTypes.add(t));
    chips.innerHTML = '';
    for (const t of types) {
      const n = G.issues.filter((i) => i.type === t).length;
      const c = el('button', 'chip' + (state.issueTypes.has(t) ? ' on' : ''), `${issueTitle(t)} (${n})`);
      c.onclick = () => {
        state.issueTypes.has(t) ? state.issueTypes.delete(t) : state.issueTypes.add(t);
        renderIssues();
      };
      chips.appendChild(c);
    }

    const stage = $('#issues-stage');
    stage.innerHTML = '';
    const groups = new Map();
    for (const i of G.issues) {
      if (!state.issueTypes.has(i.type)) continue;
      if (!groups.has(i.type)) groups.set(i.type, []);
      groups.get(i.type).push(i);
    }
    if (!groups.size) { stage.appendChild(el('div', 'empty', '表示する項目がありません。')); return; }

    for (const [type, list] of [...groups].sort((a, b) => b[1].length - a[1].length)) {
      const g = el('div', 'issue-group');
      const h = el('h3');
      h.appendChild(document.createTextNode(issueTitle(type)));
      const b = el('span', 'badge', String(list.length));
      h.appendChild(b);
      g.appendChild(h);
      g.appendChild(el('div', 'item-sub', issueHelp(type)));
      for (const i of list) {
        const row = el('div', 'issue-row ' + i.level);
        row.appendChild(el('span', 'lv', i.level));
        const msg = el('span', 'msg', i.message);
        row.appendChild(msg);
        const links = el('span');
        if (i.doc && docById.has(i.doc)) links.appendChild(linkBtn('スライド', () => selectDoc(i.doc)));
        if (i.node && nodeById.has(i.node)) links.appendChild(linkBtn('要素', () => selectNode(i.node)));
        if (i.docs) for (const d of i.docs) if (docById.has(d)) links.appendChild(linkBtn(docById.get(d).slide, () => selectDoc(d)));
        row.appendChild(links);
        g.appendChild(row);
      }
      stage.appendChild(g);
    }
  }
  function linkBtn(text, fn) {
    const a = el('a', 'xref', ' ' + text + ' ');
    a.onclick = fn;
    return a;
  }
  function issueTitle(t) {
    return ({
      'unresolved-flow-ref': 'F-14 未解決の業務フロー参照',
      'ambiguous-flow-ref': 'F-14 曖昧な業務フロー参照',
      'unassigned-flow-detail': 'F-14 フロー未割当のスライド',
      'auth-without-func': 'F-16 権限一覧にあるが機能一覧にない',
      'func-without-auth': 'F-16 機能一覧にあるが権限一覧にない',
      'func-name-mismatch': 'F-16 同一IDで機能名が不一致',
      'func-without-flow': 'F-15 業務フローに紐付かない機能',
      'flow-without-func': 'F-15 機能が割り当たっていない業務フロー',
      'id-style-variance': 'F-17 機能ID の表記ゆれ',
      'duplicate-doc': 'F-17 内容が重複したスライド',
      'inferred-flow': '推定でフローを割り当てたスライド',
      'unconfirmed-flow-group': '名称未確定のフローグループ',
    })[t] || t;
  }
  function issueHelp(t) {
    return ({
      'func-without-auth': 'バッチ系など画面を持たない機能は権限一覧に載らないため、必ずしも誤りではありません。',
      'flow-without-func': '一覧に項目はあるが、機能一覧の「新業務フロー該当箇所」から参照されていないフローです。',
      'inferred-flow': '見出しにフロー番号がないスライドを、直前スライドの続きとして扱っています。原本での確認を推奨します。',
      'unconfirmed-flow-group': 'config.js の WEB_FLOW_GROUPS に名称を追記すると解消します。',
      'duplicate-doc': 'フォルダ構成上、同じ内容が 2 箇所に配置されているものです。',
    })[t] || '';
  }

  /* ================================================================
   * 9. エクスポート（F-18）
   * ================================================================ */
  function download(name, text, mime) {
    const blob = new Blob([text], { type: (mime || 'text/plain') + ';charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 0);
  }
  const csvCell = (v) => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';

  function exportEdgesCsv() {
    const lines = ['起点種別,起点,関係,終点種別,終点,出典スライド,根拠'];
    for (const e of layoutEdges.length ? layoutEdges : G.edges) {
      const s = nodeById.get(e.s), t = nodeById.get(e.t);
      if (!s || !t) continue;
      const d = e.doc ? docById.get(e.doc) : null;
      lines.push([typeLabel(s.type), s.label, edgeLabel(e.type), typeLabel(t.type), t.label,
        d ? `${d.deck}/スライド${d.slide}` : '', e.evidence || e.label || ''].map(csvCell).join(','));
    }
    download('参照関係一覧.csv', '﻿' + lines.join('\r\n'), 'text/csv');
  }

  function exportMermaid() {
    const safe = (id) => 'n' + Math.abs([...id].reduce((a, c) => (a * 31 + c.charCodeAt(0)) | 0, 7)).toString(36);
    const lines = ['graph LR'];
    const used = new Set();
    for (const p of layoutNodes) {
      used.add(p.id);
      lines.push(`  ${safe(p.id)}["${p.node.label.replace(/"/g, "'")}"]`);
    }
    for (const e of layoutEdges) {
      if (!used.has(e.s) || !used.has(e.t)) continue;
      lines.push(`  ${safe(e.s)} -->|${edgeLabel(e.type)}| ${safe(e.t)}`);
    }
    for (const p of layoutNodes) {
      lines.push(`  style ${safe(p.id)} fill:${typeColor(p.node.type)}22,stroke:${typeColor(p.node.type)}`);
    }
    download('参照グラフ.mmd', lines.join('\n'), 'text/plain');
  }

  function exportPng() {
    const a = document.createElement('a');
    a.href = canvas.toDataURL('image/png');
    a.download = '参照グラフ.png';
    document.body.appendChild(a); a.click(); a.remove();
  }

  function exportSvg() {
    if (!layoutNodes.length) return;
    const xs = layoutNodes.map((p) => p.x), ys = layoutNodes.map((p) => p.y);
    const pad = 60;
    const minX = Math.min(...xs) - pad, maxX = Math.max(...xs) + pad;
    const minY = Math.min(...ys) - pad, maxY = Math.max(...ys) + pad;
    const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
    const out = [`<svg xmlns="http://www.w3.org/2000/svg" viewBox="${minX} ${minY} ${maxX - minX} ${maxY - minY}" width="${Math.round(maxX - minX)}" height="${Math.round(maxY - minY)}">`,
      '<rect width="100%" height="100%" fill="#ffffff" x="' + minX + '" y="' + minY + '"/>'];
    for (const e of layoutEdges) {
      const a = posById.get(e.s), b = posById.get(e.t);
      if (!a || !b) continue;
      const dash = (CFG.EDGE_TYPES[e.type] || {}).dash;
      out.push(`<line x1="${a.x.toFixed(1)}" y1="${a.y.toFixed(1)}" x2="${b.x.toFixed(1)}" y2="${b.y.toFixed(1)}" stroke="#9aa3b0" stroke-width="0.8"${dash ? ` stroke-dasharray="${dash}"` : ''}/>`);
    }
    for (const p of layoutNodes) {
      out.push(`<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="${p.r.toFixed(1)}" fill="${typeColor(p.node.type)}"/>`);
      out.push(`<text x="${p.x.toFixed(1)}" y="${(p.y + p.r + 11).toFixed(1)}" font-size="10" text-anchor="middle" font-family="sans-serif" fill="#222">${esc(p.node.label.slice(0, 24))}</text>`);
    }
    out.push('</svg>');
    download('参照グラフ.svg', out.join('\n'), 'image/svg+xml');
  }

  function exportMatrixCsv() {
    if (!matrixExport) return;
    const { rows, cols, hitOf } = matrixExport;
    const lines = [['機能ID', '機能名'].concat(cols.map((c) => c.label)).map(csvCell).join(',')];
    for (const r of rows) {
      lines.push([r.meta.funcId || '', r.meta.name || r.label]
        .concat(cols.map((c) => (hitOf(r, c) === 1 ? '○' : hitOf(r, c) === 2 ? '△' : '')))
        .map(csvCell).join(','));
    }
    download('トレーサビリティマトリクス.csv', '﻿' + lines.join('\r\n'), 'text/csv');
  }

  function exportIssuesCsv() {
    const lines = ['種別,レベル,内容,対象スライド'];
    for (const i of G.issues) {
      if (!state.issueTypes.has(i.type)) continue;
      const d = i.doc ? docById.get(i.doc) : null;
      lines.push([issueTitle(i.type), i.level, i.message, d ? d.path : ''].map(csvCell).join(','));
    }
    download('品質チェック結果.csv', '﻿' + lines.join('\r\n'), 'text/csv');
  }

  /* ================================================================
   * 10. レンダリング統括 と イベント配線
   * ================================================================ */
  function renderAll() {
    $$('#tabs .tab').forEach((b) => b.classList.toggle('is-active', b.dataset.view === state.view));
    $$('.view').forEach((v) => v.classList.toggle('is-active', v.id === 'view-' + state.view));

    renderTree();
    renderDoc();
    renderRelations();
    if (state.leftMode === 'nodes') renderNodeList();

    if (state.view === 'graph') {
      const sel = $('#graph-focus');
      const f = currentFocus();
      if (sel.value !== f) sel.value = f;
      rebuildGraph(true);
    } else if (state.view === 'matrix') renderMatrix();
    else if (state.view === 'compare') renderCompare();
    else if (state.view === 'issues') renderIssues();
  }

  function boot() {
    // #region agent log
    try {
      const be = document.getElementById('boot-error');
      const cs = getComputedStyle(be);
      const br = be.getBoundingClientRect();
      __dbg('A', 'app.js:boot-start', 'boot-error overlay state', {
        hasHiddenAttr: be.hasAttribute('hidden'),
        hiddenProp: be.hidden,
        computedDisplay: cs.display,
        computedVisibility: cs.visibility,
        computedZ: cs.zIndex,
        computedBg: cs.backgroundColor,
        rect: { w: br.width, h: br.height, top: br.top, left: br.left },
        textLen: (be.textContent || '').length
      });
      const layout = document.getElementById('layout');
      const lr = layout.getBoundingClientRect();
      const bodyCs = getComputedStyle(document.body);
      __dbg('D', 'app.js:boot-layout', 'layout/body dimensions', {
        bodyDisplay: bodyCs.display, bodyH: bodyCs.height,
        layoutRect: { w: lr.width, h: lr.height },
        win: { w: window.innerWidth, h: window.innerHeight }
      });
    } catch (e) {
      __dbg('C', 'app.js:boot-start-err', 'boot measure failed', { err: String(e) });
    }
    // #endregion

    $('#build-meta').textContent =
      `${G.meta.docCount} スライド · ${G.meta.nodeCount} 要素 · ${G.meta.edgeCount} 関係 · ${(G.meta.generatedAt || '').slice(0, 16).replace('T', ' ')} 生成`;
    /* 要確認（warn）があればそれを、なければ総件数を控えめな色で出す */
    const warn = G.issues.filter((i) => i.level === 'warn').length;
    const badge = $('#issue-badge');
    badge.textContent = warn ? String(warn) : String(G.issues.length);
    badge.title = `要確認 ${warn} 件 / 全 ${G.issues.length} 件`;
    if (!warn) {
      badge.style.background = 'var(--bg-sunken)';
      badge.style.color = 'var(--fg-faint)';
    }

    $$('#tabs .tab').forEach((b) => {
      b.onclick = () => { state.view = b.dataset.view; renderAll(); syncHash(); };
    });
    $$('#left-mode .seg-btn').forEach((b) => { b.onclick = () => setLeftMode(b.dataset.mode); });

    const search = $('#search');
    let timer = null;
    search.addEventListener('input', () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        state.query = search.value;
        setLeftMode('search');
        runSearch(state.query);
      }, 140);
    });
    document.addEventListener('keydown', (ev) => {
      if (ev.key === '/' && document.activeElement !== search) { ev.preventDefault(); search.focus(); search.select(); }
      if (ev.key === 'Escape' && document.activeElement === search) search.blur();
    });

    $('#nav-back').onclick = () => {
      if (history.pos <= 0) return;
      history.pos--; updateNavButtons();
      suppressHash = true;
      location.hash = history.stack[history.pos];
      setTimeout(() => { suppressHash = false; applyHash(location.hash); }, 0);
    };
    $('#nav-fwd').onclick = () => {
      if (history.pos >= history.stack.length - 1) return;
      history.pos++; updateNavButtons();
      suppressHash = true;
      location.hash = history.stack[history.pos];
      setTimeout(() => { suppressHash = false; applyHash(location.hash); }, 0);
    };

    /* グラフ */
    buildFilterChips();
    fillNodeSelect($('#graph-focus'), '（全体）');
    fillNodeSelect($('#path-a'), '始点');
    fillNodeSelect($('#path-b'), '終点');
    $('#graph-focus').onchange = (e) => {
      state.graph.focus = e.target.value;
      state.graph.focusSet = true;
      state.graph.path = [];
      rebuildGraph(false);
    };
    $('#graph-hops').onchange = (e) => { state.graph.hops = Number(e.target.value); rebuildGraph(false); };
    $('#graph-relayout').onclick = () => { layoutNodes.forEach((p) => { p.x = null; p.pinned = false; }); rebuildGraph(false); };
    $('#path-run').onclick = () => {
      const a = $('#path-a').value, b = $('#path-b').value;
      const path = findPath(a, b);
      if (!a || !b) { alert('始点と終点を選んでください。'); return; }
      if (!path) { alert('現在のフィルタ条件では経路が見つかりませんでした。エッジ種別のフィルタを緩めてみてください。'); return; }
      state.graph.path = path;
      rebuildGraph(false);
      const names = path.map((id) => nodeById.get(id).label).join('  →  ');
      $('#graph-hint').textContent = `経路（${path.length - 1} ホップ）: ${names}`;
    };
    const menu = $('#graph-export-menu');
    $('#graph-export').onclick = (e) => { e.stopPropagation(); menu.hidden = !menu.hidden; };
    document.addEventListener('click', () => { menu.hidden = true; });
    menu.onclick = (e) => {
      const k = e.target.dataset.export;
      if (!k) return;
      menu.hidden = true;
      if (k === 'png') exportPng();
      if (k === 'svg') exportSvg();
      if (k === 'mermaid') exportMermaid();
      if (k === 'csv') exportEdgesCsv();
    };
    bindGraphEvents();

    /* マトリクス・課題 */
    $('#matrix-domain').onchange = renderMatrix;
    $('#matrix-kind').onchange = renderMatrix;
    $('#matrix-gaps').onchange = renderMatrix;
    $('#matrix-csv').onclick = exportMatrixCsv;
    $('#issues-csv').onclick = exportIssuesCsv;

    if (location.hash) applyHash(location.hash);
    else { renderAll(); syncHash(); }
    updateNavButtons();

    // #region agent log
    try {
      const be = document.getElementById('boot-error');
      const cs = getComputedStyle(be);
      const tree = document.getElementById('tree');
      const docBody = document.getElementById('doc-body');
      const docHead = document.getElementById('doc-head');
      const viewDoc = document.getElementById('view-doc');
      __dbg('A', 'app.js:boot-end', 'post-render visibility', {
        bootDisplay: cs.display,
        bootHidden: be.hidden,
        treeChildCount: tree ? tree.children.length : -1,
        treeTextLen: tree ? (tree.textContent || '').length : -1,
        docHeadLen: docHead ? (docHead.textContent || '').length : -1,
        docBodyLen: docBody ? (docBody.textContent || '').length : -1,
        viewDocActive: viewDoc && viewDoc.classList.contains('is-active'),
        viewDocDisplay: viewDoc ? getComputedStyle(viewDoc).display : null,
        buildMeta: ($('#build-meta').textContent || '').slice(0, 80),
        selDoc: state.selDoc
      });
      __dbg('E', 'app.js:boot-colors', 'fg/bg contrast check', {
        bodyColor: getComputedStyle(document.body).color,
        bodyBg: getComputedStyle(document.body).backgroundColor,
        docTitleColor: docHead && docHead.querySelector('.doc-title')
          ? getComputedStyle(docHead.querySelector('.doc-title')).color : null
      });
    } catch (e) {
      __dbg('C', 'app.js:boot-end-err', 'post-render measure failed', { err: String(e) });
    }
    // #endregion
  }

  try {
    boot();
  } catch (e) {
    // #region agent log
    __dbg('C', 'app.js:boot-throw', 'boot threw', { err: String(e), stack: e && e.stack });
    // #endregion
    throw e;
  }
})();
