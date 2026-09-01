/* ED書 ビューア — 解析共通ライブラリ
 *
 * Node（build-ed-index.mjs）とブラウザ（app.js）の両方から読む。
 * file:// では type="module" が使えないためクラシックスクリプトで書き、
 * ブラウザでは window.EDParser、Node では module.exports に載せる。
 */
(function (root) {
  'use strict';

  // ------------------------------------------------------------------
  // 文字正規化
  // ------------------------------------------------------------------

  /** 全角英数・全角記号を半角へ寄せ、空白を潰す */
  function normText(s) {
    if (s == null) return '';
    return String(s)
      .replace(/[Ａ-Ｚａ-ｚ０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
      .replace(/　/g, ' ')
      .replace(/[‐‑‒–—―ー−]/g, (c) => (c === 'ー' ? 'ー' : '-'))
      .replace(/[（）]/g, (c) => (c === '（' ? '(' : ')'))
      .replace(/[：]/g, ':')
      .replace(/[／]/g, '/')
      .replace(/\s+/g, ' ')
      .trim();
  }

  // Excel のふりがな（phonetic guide）が本文末尾に連結されている。
  // 「掲示板ケイジバン」「TOP画面（顧客）ガメンコキャク」のような形。
  // 末尾のカタカナ連続を削るが、語そのものがカタカナで終わる正当な名前
  // （「…レポート」「…データ」等）を壊さないよう除外語を持つ。
  // 「…レポート」「…データ」のように語そのものがカタカナで終わる正当な名前。
  // これらが末尾に来ていたらふりがなとは見なさない。
  const KATAKANA_TAIL_KEEP = [
    'レポート', 'データ', 'ファイル', 'ダウンロード', 'アップロード', 'パターン',
    'メール', 'フラグ', 'テーブル', 'システム', 'サーバ', 'サーバー', 'リスト',
    'チェック', 'コード', 'カスタマ', 'グラフ', 'メニュー', 'ログイン', 'ログアウト',
    'パスワード', 'ユーザ', 'ユーザー', 'エラー', 'スケジュール', 'ポップアップ',
    'リエンタ', 'バッチ', 'センタ', 'モバイル', 'マスタ', 'マスタメンテナンス',
    'トップ', 'ボタン', 'リンク', 'タブ', 'ヘッダ', 'ボディ', 'フッタ', 'キー',
    'カスタマイズドデータ', 'インポート', 'エクスポート', 'クリア', 'ソート',
    'メモ', 'プラン', 'クレジット', 'コンビニ', 'キャリア', 'ポイント',
    'フロー', 'シート', 'ステップ', 'ケース', 'レコード', 'カラム', 'ジョブ',
    'タスク', 'ページ', 'フォルダ', 'ディレクトリ', 'サービス', 'プロセス',
    'リクエスト', 'レスポンス', 'インタフェース', 'インターフェース', 'フォーマット',
    'オプション', 'パラメータ', 'タイミング', 'タイプ', 'ルール', 'レイアウト',
    'ヘルプ', 'イベント', 'アイコン', 'タイトル', 'コメント', 'メッセージ',
    'ログ', 'キャンセル', 'デフォルト', 'モード', 'ステータス', 'サイズ',
    'イメージ', 'ツール', 'サンプル', 'テンプレート', 'グループ', 'アドレス',
    'ダイアログ', 'ラジオボタン', 'チェックボックス', 'プルダウン', 'テキスト',
    'ヘッダー', 'フッター', 'タイムアウト', 'リトライ', 'ロック', 'キュー',
  ];

  const RE_KANJI_G = /[一-鿿々]/g;
  const RE_KATA_TAIL = /([ァ-ヶー]{2,})$/;

  /**
   * 末尾に連結された Excel のふりがなを落とす。
   *
   * ふりがなは「本体に含まれる漢字の読み」なので、漢字 1 文字あたり 2 音前後になる。
   * カタカナ列が漢字数以上の長さのときだけふりがなと判定する。
   * これで「詳細業務フロー」の "フロー"（漢字 4 に対し 3 文字）は残り、
   * 「掲示板ケイジバン」の "ケイジバン"（漢字 3 に対し 5 文字）は落ちる。
   *
   * Excel は IME で入力した部分にしかふりがなを持たないため、本体の漢字すべてに
   * 読みが付くとは限らない（「WebUp請求確定(センタ公開)コウカイ」は末尾の
   * 「公開」の分しか無い）。そこで漢字数は末尾 RUBY_WINDOW 文字の範囲だけ数える。
   * 正当なカタカナ語尾は KATAKANA_TAIL_KEEP で守る。
   */
  const RUBY_WINDOW = 8;

  function stripRuby(s) {
    if (!s) return '';
    let out = String(s);
    // 「…画面（顧客）ガメンコキャク」のように連結が重なる場合があるので数回試す
    for (let i = 0; i < 4; i++) {
      const m = out.match(RE_KATA_TAIL);
      if (!m) break;
      const tail = m[1];
      if (KATAKANA_TAIL_KEEP.some((w) => tail === w || tail.endsWith(w))) break;
      const head = out.slice(0, out.length - tail.length).replace(/[\s　]+$/, '');
      const kanji = (head.slice(-RUBY_WINDOW).match(RE_KANJI_G) || []).length;
      // ふりがなは必ず漢字に対して付く。漢字が残らないなら本体を削っている。
      if (!kanji) break;
      if (head.trim().length < 2) break;
      if (tail.length < kanji) break;
      out = head;
    }
    return out.trim();
  }

  /** 照合用キー: ふりがな除去 → 正規化 → 記号・空白除去 → 小文字化 */
  function matchKey(s) {
    return normText(stripRuby(s))
      .replace(/[ \t()（）「」『』【】\[\]{}・,、。.:：;；\/／\\|_\-ー~〜"'’“”]/g, '')
      .toLowerCase();
  }

  // ------------------------------------------------------------------
  // ID
  // ------------------------------------------------------------------

  const RE_SCREEN_ID = /\b([A-Z]{2}\d{3})[_\-]?(F\d{2})\b/g;
  const RE_BATCH_ID = /\b([A-Z]{2}\d{3})[_\-]?(B\d{2})\b/g;
  const RE_GROUP_ID = /\b([A-Z]{2}\d{3})\b/g;
  const RE_FLOW_ID = /\b(GF_\d{3})\b/g;
  const RE_SCHEDULE_ID = /\b(TPC_[A-Z]\d{2})\b/g;
  const RE_TBL = /([一-鿿々ァ-ヶー\w／\/]{2,20}?TBL)/g;

  /** SE001-F03 → SE001_F03 */
  function normId(a, b) {
    return b ? `${a}_${b}` : a;
  }

  // ------------------------------------------------------------------
  // Markdown（Excel シート由来）の表を 2 次元セル配列にする
  // ------------------------------------------------------------------

  /**
   * 行頭が `| **12** |` の Excel ダンプ表を grid[row][col] に変換する。
   * col 0 = Excel の A 列。行番号ラベルの列は落とす。
   * 表以外の行は plain[] に落とす。
   */
  function parseSheet(md) {
    const lines = String(md).split(/\r?\n/);
    const grid = [];
    const plain = [];
    let title = '';
    let sawHeader = false;

    for (const line of lines) {
      if (!title && /^#\s+/.test(line)) {
        title = line.replace(/^#\s+/, '').trim();
        continue;
      }
      if (/^\|/.test(line)) {
        const cells = splitRow(line);
        if (!cells.length) continue;
        // 区切り行 `| --- | --- |`
        if (cells.every((c) => /^-{2,}$/.test(c) || c === '')) continue;
        // 列見出し行 `|  | A | B | C |`
        if (!sawHeader && cells[0] === '' && /^[A-Z]{1,2}$/.test(cells[1] || '')) {
          sawHeader = true;
          continue;
        }
        const label = cells[0];
        const rowNo = /^\*\*(\d+)\*\*$/.exec(label);
        const body = cells.slice(1).map((c) => c.replace(/<br\s*\/?>/gi, '\n').trim());
        if (rowNo) grid[Number(rowNo[1]) - 1] = body;
        else grid.push(body);
      } else if (line.trim()) {
        plain.push(line);
      }
    }
    for (let i = 0; i < grid.length; i++) if (!grid[i]) grid[i] = [];
    return { title, grid, plain, isTable: grid.length > 0 };
  }

  function splitRow(line) {
    const t = line.trim().replace(/^\|/, '').replace(/\|$/, '');
    return t.split('|').map((c) => c.trim());
  }

  /** grid の全セルを空でないものだけ平坦化 */
  function cells(grid) {
    const out = [];
    for (const row of grid) for (const c of row) if (c) out.push(c);
    return out;
  }

  /** 「ラベル」セルの右隣で最初に値が入っているセルを返す */
  function valueRightOf(grid, labelRe, opts) {
    const maxGap = (opts && opts.maxGap) || 24;
    for (let r = 0; r < grid.length; r++) {
      const row = grid[r] || [];
      for (let c = 0; c < row.length; c++) {
        if (!row[c]) continue;
        if (!labelRe.test(stripRuby(row[c]))) continue;
        for (let k = c + 1; k < Math.min(row.length, c + 1 + maxGap); k++) {
          if (row[k]) return row[k];
        }
      }
    }
    return '';
  }

  /** ラベル行を見つけて、その下の行を「非空セルの配列」として順に返す */
  function rowsBelow(grid, labelRe, opts) {
    const o = opts || {};
    const stopRe = o.stopRe;
    const limit = o.limit || 400;
    const out = [];
    let start = -1;
    for (let r = 0; r < grid.length; r++) {
      const row = grid[r] || [];
      if (row.some((c) => c && labelRe.test(stripRuby(c)))) { start = r; break; }
    }
    if (start < 0) return out;
    let blanks = 0;
    for (let r = start + 1; r < grid.length && out.length < limit; r++) {
      const row = (grid[r] || []).filter(Boolean);
      if (!row.length) { if (++blanks >= (o.maxBlank || 2)) break; continue; }
      blanks = 0;
      if (stopRe && row.some((c) => stopRe.test(stripRuby(c)))) break;
      out.push({ r, row, raw: grid[r] || [] });
    }
    return out;
  }

  // ------------------------------------------------------------------
  // 軽量 Markdown レンダラ（表 + 見出し + 箇条書き）
  // ------------------------------------------------------------------

  function esc(s) {
    return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  }

  root.EDParser = {
    normText, stripRuby, matchKey, parseSheet, cells, valueRightOf, rowsBelow, esc, normId,
    RE_SCREEN_ID, RE_BATCH_ID, RE_GROUP_ID, RE_FLOW_ID, RE_SCHEDULE_ID, RE_TBL,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.EDParser;
})(typeof window !== 'undefined' ? window : globalThis);
