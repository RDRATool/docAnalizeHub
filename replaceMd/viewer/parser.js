/*
 * parser.js — Markdown 解析・ID 正規化・軽量レンダラ
 *
 * build-index.mjs（Node）とビューア（ブラウザ）の両方から使う共有モジュール。
 * file:// でも動かすため ESM ではなくクラシックスクリプトとして書き、
 * window.RGParser と module.exports の両方に出す。
 */
(function (root, factory) {
  const cfg = (typeof require !== 'undefined' && typeof module !== 'undefined')
    ? require('./config.js')
    : root.RGConfig;
  const mod = factory(cfg);
  root.RGParser = mod;
  if (typeof module !== 'undefined' && module.exports) module.exports = mod;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (CONFIG) {
  'use strict';

  /* =============================================================
   * 1. 正規化
   * ============================================================= */

  /** 全角英数・全角記号・全角空白をならし、連続空白を 1 つにする */
  function normText(s) {
    if (s == null) return '';
    return String(s)
      .replace(/[！-～]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xFEE0))
      .replace(/　/g, ' ')
      .replace(/[‐-―−－]/g, '-')   // 各種ダッシュ → ハイフン
      .replace(/[：]/g, ':')
      .replace(/[～〜]/g, '~')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /** 比較用キー：正規化のうえ空白・記号を落とす */
  function keyOf(s) {
    return normText(s).replace(/[\s:：.,、。（）()\[\]「」【】\-~/]/g, '').toLowerCase();
  }

  /**
   * 機能 ID の正規化。
   * 2.2.3 は `01_01`、2.4.1 は `01-01` と区切りが揺れる（PLAN §1.3）ので
   * `-` に寄せる。形式に合わないものは null。
   */
  function normFuncId(s) {
    const t = normText(s).replace(/[_]/g, '-').replace(/\s/g, '');
    const m = t.match(/^(\d{2})-(\d{2})$/);
    return m ? `${m[1]}-${m[2]}` : null;
  }

  /** セル内に複数 ID が入るケース（`01-02<br>08-02`）に対応した抽出 */
  function extractFuncIds(cell) {
    const out = [];
    for (const part of String(cell || '').split(/<br\s*\/?>|\r?\n/)) {
      const id = normFuncId(part);
      if (id && !out.includes(id)) out.push(id);
    }
    return out;
  }

  /** 本文中の `[03-01]` 形式の参照をすべて拾う */
  function extractBracketFuncIds(text) {
    const out = [];
    for (const m of String(text || '').matchAll(/\[(\d{2}[-_]\d{2})\]/g)) {
      const id = normFuncId(m[1]);
      if (id && !out.includes(id)) out.push(id);
    }
    return out;
  }

  /* =============================================================
   * 2. 業務フロー参照のパース
   * ============================================================= */

  /**
   * 「9-1.　請求 : 銀行振込」「4-1.　データ取込」「3-7：データ取得：汎用請求」
   * 「共通：システム利用準備」「8.　随時作業」などを
   * { num, name, raw } に分解する。
   *
   * PLAN §1.3 のとおり **番号を主キー、名称は表示用** とする。
   * 番号がないもの（共通：〜）は num=null / name のみ。
   */
  function parseFlowRef(raw) {
    const t = normText(raw);
    if (!t) return null;
    if (/^[-ー－]$/.test(t)) return null;                 // 「－」= 該当なし
    if (/^(各所|その他各所|なし|N\/A)$/i.test(t)) {
      return { num: null, name: t, raw: t, ambiguous: true };
    }
    // 「11. 共通：システム利用準備」「共通：パスワード忘れ」
    const kyotsu = t.match(/^(?:(\d+)[.:]\s*)?共通\s*[:]\s*(.+)$/);
    if (kyotsu) {
      return { num: kyotsu[1] || null, name: `共通:${kyotsu[2].trim()}`, raw: t, common: true };
    }
    // 「9-1.　請求 : 銀行振込」「3-7：データ取得：汎用請求」「8. 随時作業」
    const m = t.match(/^(\d+(?:-\d+)?)\s*[.:]\s*(.*)$/);
    if (m) return { num: m[1], name: (m[2] || '').trim(), raw: t };
    // 番号なし（「随時作業」「全体」など）
    return { num: null, name: t, raw: t };
  }

  /** 丸数字 → 数値（①=1 … ⑳=20） */
  function circledToNumber(ch) {
    const c = ch.charCodeAt(0);
    if (c >= 0x2460 && c <= 0x2473) return c - 0x2460 + 1;
    return null;
  }

  /**
   * 媒体Web化の「⑨ 3.」「⑫ 12.(11)」「⑬3.」形式を分解する。
   * → [{ group: 9, step: '3' }, ...]
   */
  function parseCircledFlowRefs(cell) {
    const out = [];
    const text = String(cell || '').replace(/<br\s*\/?>/g, ' ');
    const re = /([①-⑳])\s*([0-9]+)?\s*\.?\s*(?:\(([^)]*)\))?/g;
    for (const m of text.matchAll(re)) {
      const group = circledToNumber(m[1]);
      if (group == null) continue;
      const steps = [];
      if (m[2]) steps.push(m[2]);
      if (m[3]) for (const s of m[3].match(/\d+/g) || []) steps.push(s);
      if (steps.length === 0) steps.push(null);
      for (const step of steps) out.push({ group, step });
    }
    return out;
  }

  /* =============================================================
   * 3. Markdown 構造の解析
   * ============================================================= */

  /** ファイル名 `55_2.2.3 新機能一覧（オバートリップ） （1_35）.md` を分解 */
  function parseFileName(base) {
    const name = base.replace(/\.md$/i, '');
    const m = name.match(/^(\d+)_(.*)$/);
    return m
      ? { seq: Number(m[1]), title: m[2] }
      : { seq: null, title: name };
  }

  /** 先頭行 `# 2_業務要件 - スライド16` から デッキ名 / スライド番号 */
  function parseDocHeader(md) {
    const first = (md.split(/\r?\n/).find((l) => l.trim()) || '').trim();
    const m = first.match(/^#\s*(.+?)\s*-\s*スライド\s*(\d+)\s*$/);
    return m ? { deck: m[1].trim(), slide: Number(m[2]) } : { deck: null, slide: null };
  }

  /** 章番号（`2.2.3` / `別.3.5`）をタイトル先頭から取り出す */
  function parseChapter(title) {
    const t = normText(title);
    const m = t.match(/^(別\.\d+(?:\.\d+)*|\d+(?:\.\d+)*)/);
    return m ? m[1] : null;
  }

  /** `#`〜`####` の見出しを行番号つきで列挙 */
  function parseHeadings(md) {
    const out = [];
    md.split(/\r?\n/).forEach((line, i) => {
      const m = line.match(/^(#{1,6})\s+(.*)$/);
      if (m) out.push({ level: m[1].length, text: m[2].trim(), line: i });
    });
    return out;
  }

  /** `| a | b |` 行をセル配列に */
  function splitRow(line) {
    return line.replace(/^\s*\|/, '').replace(/\|\s*$/, '').split('|').map((s) => s.trim());
  }

  const isSep = (line) => /^\s*\|(\s*:?-{2,}:?\s*\|)+\s*$/.test(line);
  const isRow = (line) => /^\s*\|/.test(line);

  /**
   * Markdown テーブルをすべて抽出。
   * ヘッダが 2 段（権限一覧のロール階層）になっているものは
   * header に 1 段目、subHeader に 2 段目を入れて返す。
   */
  function parseTables(md) {
    const lines = md.split(/\r?\n/);
    const tables = [];
    let i = 0;
    while (i < lines.length) {
      if (isRow(lines[i]) && isSep(lines[i + 1] || '')) {
        const header = splitRow(lines[i]);
        const rows = [];
        let j = i + 2;
        while (j < lines.length && isRow(lines[j])) {
          if (!isSep(lines[j])) rows.push(splitRow(lines[j]));
          j++;
        }
        // 1 行目が「値なしのラベル行」ならサブヘッダとみなす
        let subHeader = null;
        if (rows.length && rows[0].filter(Boolean).length && looksLikeSubHeader(header, rows[0])) {
          subHeader = rows.shift();
        }
        tables.push({ header, subHeader, rows, startLine: i });
        i = j;
      } else {
        i++;
      }
    }
    return tables;
  }

  /** 「ID 列が空 かつ 他に文字がある」= 権限一覧のロール 2 段目ヘッダ */
  function looksLikeSubHeader(header, row) {
    const idIdx = header.findIndex((h) => keyOf(h) === 'id');
    if (idIdx < 0) return false;
    if (normText(row[idIdx])) return false;
    const filled = row.filter((c) => normText(c)).length;
    return filled >= 2 && filled < row.length;
  }

  /**
   * ヘッダのセル名から論理カラム index を解決する。
   * 見つからない列は undefined。
   */
  function resolveColumns(header) {
    const map = {};
    const norm = header.map((h) => keyOf(h.replace(/<br\s*\/?>/g, '')));
    for (const [logical, names] of Object.entries(CONFIG.COLUMN_ALIASES)) {
      const wanted = names.map(keyOf);
      const idx = norm.findIndex((h) => h && wanted.includes(h));
      if (idx >= 0) map[logical] = idx;
    }
    return map;
  }

  /**
   * 表のセル結合（空欄）を直前の値で埋める（PLAN §6 forward-fill）。
   * 対象列のみに適用する。
   */
  function forwardFill(rows, colIdx) {
    let last = '';
    return rows.map((r) => {
      const copy = r.slice();
      const v = normText(copy[colIdx] || '');
      if (v) last = copy[colIdx];
      else copy[colIdx] = last;
      return copy;
    });
  }

  /* =============================================================
   * 4. 業務フロー本文（ステップ行）の解析
   * ============================================================= */

  const ARROW = /\s*(?:->|<->|→|⇒|\\rightarrow)\s*/;

  /**
   * `1. 申込(顧客) -> 2. 申込書受領、顧客登録(AM)` のような行を
   * { from, to, raw } に分解し、各ノードから (…) 内の主体を取り出す。
   */
  function parseFlowStepLine(line) {
    const raw = line.replace(/^\s*[-*]\s*/, '').trim();
    if (!raw || !ARROW.test(raw)) return null;
    const parts = raw.split(ARROW).map((s) => s.trim()).filter(Boolean);
    if (parts.length < 2) return null;
    const edges = [];
    for (let i = 0; i < parts.length - 1; i++) {
      edges.push({ from: parseFlowNode(parts[i]), to: parseFlowNode(parts[i + 1]), raw });
    }
    return edges;
  }

  /** `7. データ取得・明細情報取込(TPC運用担当)` → { step, label, paren } */
  function parseFlowNode(s) {
    let t = s.replace(/\/\/.*$/, '').trim();          // 行末コメント除去
    const parens = [];
    t = t.replace(/[（(]([^（()）]{1,40})[）)]/g, (all, inner) => {
      parens.push(inner.trim());
      return '';
    });
    const funcIds = extractBracketFuncIds(s);
    t = t.replace(/\[[^\]]*\]/g, '').trim();
    const m = t.match(/^(\d+(?:[-.]\d+)?)\s*[.．]?\s*(.*)$/);
    return {
      step: m ? m[1] : null,
      label: (m ? m[2] : t).replace(/^[.．、]\s*/, '').trim(),
      parens,
      funcIds,
    };
  }

  /* =============================================================
   * 5. 参照抽出（外部資料・改善要望）
   * ============================================================= */

  function extractExternalDocs(text) {
    const out = [];
    for (const m of String(text).matchAll(/「([^」]*\.(?:xls|xlsx|xlsm|doc|docx|ppt|pptx|csv|pdf|txt)[^」]*)」/gi)) {
      const v = m[1].trim();
      if (!out.includes(v)) out.push(v);
    }
    return out;
  }

  function extractImprovementRequests(text) {
    const out = [];
    for (const m of String(text).matchAll(/改善要望\s*No\.?\s*([0-9]+(?:-[0-9]+)?)/g)) {
      if (!out.includes(m[1])) out.push(m[1]);
    }
    return out;
  }

  /* =============================================================
   * 6. 検索インデックス（日本語 bigram）
   * ============================================================= */

  function tokenize(text) {
    const s = normText(String(text).replace(/<br\s*\/?>/g, ' ')).toLowerCase();
    const set = new Set();
    // ASCII 単語はそのまま
    for (const m of s.matchAll(/[a-z0-9][a-z0-9_.-]{1,}/g)) set.add(m[0]);
    // 日本語などは bigram
    const cleaned = s.replace(/[\s|:.,、。()（）\[\]「」【】<>#*_+=/\\-]/g, '');
    for (let i = 0; i < cleaned.length - 1; i++) set.add(cleaned.slice(i, i + 2));
    return set;
  }

  /* =============================================================
   * 7. 軽量 Markdown レンダラ
   *    対象 md の記法は 見出し / 表 / 箇条書き / 引用 / 水平線 / 強調 / <br> のみ。
   *    外部ライブラリを持ち込まないため自前で処理する。
   * ============================================================= */

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));
  }

  /** インライン装飾。decorate(text) で追加のリンク化ができる */
  function renderInline(s, decorate) {
    let h = escapeHtml(s);
    h = h.replace(/&lt;br\s*\/?&gt;/gi, '<br>');
    h = h.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    h = h.replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, '<em>$1</em>');
    h = h.replace(/`([^`]+)`/g, '<code>$1</code>');
    h = h.replace(/\[([^\]]+)\]\((https?:[^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
    return decorate ? decorate(h) : h;
  }

  function renderMarkdown(md, decorate) {
    const lines = String(md).split(/\r?\n/);
    const out = [];
    let listType = null;
    const closeList = () => { if (listType) { out.push(`</${listType}>`); listType = null; } };

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      if (isRow(line) && isSep(lines[i + 1] || '')) {
        closeList();
        const header = splitRow(line);
        out.push('<div class="tbl-wrap"><table><thead><tr>');
        header.forEach((c) => out.push(`<th>${renderInline(c, decorate)}</th>`));
        out.push('</tr></thead><tbody>');
        let j = i + 2;
        while (j < lines.length && isRow(lines[j])) {
          if (!isSep(lines[j])) {
            out.push('<tr>');
            splitRow(lines[j]).forEach((c) => out.push(`<td>${renderInline(c, decorate)}</td>`));
            out.push('</tr>');
          }
          j++;
        }
        out.push('</tbody></table></div>');
        i = j - 1;
        continue;
      }

      const h = line.match(/^(#{1,6})\s+(.*)$/);
      if (h) {
        closeList();
        const lv = Math.min(h[1].length + 1, 6);
        out.push(`<h${lv}>${renderInline(h[2], decorate)}</h${lv}>`);
        continue;
      }

      if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) { closeList(); out.push('<hr>'); continue; }

      const bq = line.match(/^\s*>\s?(.*)$/);
      if (bq) { closeList(); out.push(`<blockquote>${renderInline(bq[1], decorate)}</blockquote>`); continue; }

      const ol = line.match(/^\s*(\d+)[.)]\s+(.*)$/);
      const ul = line.match(/^\s*[-*+]\s+(.*)$/);
      if (ul) {
        if (listType !== 'ul') { closeList(); out.push('<ul>'); listType = 'ul'; }
        out.push(`<li>${renderInline(ul[1], decorate)}</li>`);
        continue;
      }
      if (ol) {
        if (listType !== 'ol') { closeList(); out.push('<ol>'); listType = 'ol'; }
        out.push(`<li>${renderInline(ol[2], decorate)}</li>`);
        continue;
      }

      if (!line.trim()) { closeList(); continue; }
      closeList();
      out.push(`<p>${renderInline(line, decorate)}</p>`);
    }
    closeList();
    return out.join('\n');
  }

  return {
    normText, keyOf, normFuncId, extractFuncIds, extractBracketFuncIds,
    parseFlowRef, circledToNumber, parseCircledFlowRefs,
    parseFileName, parseDocHeader, parseChapter, parseHeadings,
    parseTables, splitRow, resolveColumns, forwardFill,
    parseFlowStepLine, parseFlowNode,
    extractExternalDocs, extractImprovementRequests,
    tokenize, escapeHtml, renderInline, renderMarkdown,
  };
});
