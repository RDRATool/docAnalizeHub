#!/usr/bin/env node
/*
 * 1.disassemble.js
 *
 * 0.input 配下の Office ファイル(.xlsx / .docx / .pptx)を officecli + LM Studio で Markdown 化する。
 *   [Excel(.xlsx)] シート単位
 *   - 図形/画像/チャートを含むシート -> 図形テキスト・座標・セル値を LM Studio に渡し、
 *                                       内容を Markdown で再構成して出力(.md)
 *   - テキストのみのシート              -> Markdown(表形式)で出力(.md)
 *   [PowerPoint(.pptx)] スライド単位
 *   - 図形/画像を含むスライド          -> 図形テキスト・座標・表・画像情報を LM Studio に渡し、
 *                                       内容を Markdown で再構成して出力(.md)
 *   - テキスト/表のみのスライド        -> Markdown(見出し+箇条書き+表)で出力(.md)
 *   [Word(.docx)] 文書単位
 *   - 図形/画像を含む文書               -> ページ毎にPNG化して LM Studio に渡し、
 *                                       内容を Markdown で再構成して出力(.md)
 *   - テキストのみの文書                -> 見出し・段落・表を機械的に Markdown 化(.md)
 *   [その他のファイル]                  -> そのまま 1.disassemble へコピーする
 * 入力フォルダーの階層を 1.disassemble 配下に再現する。
 * 出力済みの .md / コピー済みファイルはスキップするため、中断後の再実行で続きから処理できる。
 * LM Studio 未応答時は .md を出さず _work/1.disassemble_lm_pending.json に状態を記録する。
 * 再実行でリトライし、試行が2回とも失敗したときだけフォールバック .md を出力する。
 * 既存のフォールバック .md は --retry-lm-fail で削除して再変換できる。
 * 各種ログ(変換ログ/失敗一覧/officecli 呼び出しログ)は 9.log フォルダーに出力する。
 *
 * NOTES:
 *   LM Studio をローカル起動し、画像入力対応(マルチモーダル/Vision)モデルを
 *   ロードしておくこと。図形シート/スライドは officecli でPNG化し、その画像を
 *   LM Studio に渡して内容を再構成する。既定エンドポイントは http://localhost:1234 。
 *   ※テキスト専用モデルしか使えない場合は --no-lm-image を付けると従来の
 *     「図形テキスト+座標」テキストのみ送信に切り替わる。
 *
 *   LM Studio へ渡す system / user プロンプトはプログラムに持たず、外部の
 *   プロンプト設定ファイル(既定: prompt/1.disassembleConfigPrompt.md)
 *   で定義する。種別(excel/powerpoint/word/pdf)・フォルダー・ファイル単位の
 *   追加指示(## +rule)もこのファイルで設定できる。--prompt-config で差し替え可。
 *
 *   画像を渡して解釈させる際は、example/example.md(画像とその解釈例)の内容も
 *   システムプロンプトに埋め込み、同ファイルが参照する PNG(対象画像/解釈画像)も
 *   user メッセージにキャプション付きで添付する。この例に当てはまる画像は
 *   この例を参考に解釈させる。--example-file で差し替え、--no-example で無効化できる。
 *
 *   入力フォルダー・Excelシート・PowerPoint章扉フォルダーの除外は
 *   prompt/1.disassembleExclude.md に1行ずつ書く。sheet / ppt-folder は
 *   見出しに folder=相対パス を付けてフォルダー単位にスコープできる。
 *   --exclude-config で差し替え可。
 *
 * EXAMPLE:
 *   node script/1.disassemble.js
 *   node script/1.disassemble.js --folder 02_ED書                    # 0.input 配下の指定フォルダーのみ処理
 *   node script/1.disassemble.js --lm-model "qwen/qwen2.5-vl-7b"
 *   node script/1.disassemble.js --no-lm-image                       # 画像を使わずテキストのみ
 *   node script/1.disassemble.js --office-timeout 300                # officecli 1回のタイムアウト(秒)
 *   node script/1.disassemble.js --prompt-config ./my-prompts.md     # プロンプト設定ファイルを差し替え
 *   node script/1.disassemble.js --example-file ./my-example.md      # 画像解釈の参考例ファイルを差し替え
 *   node script/1.disassemble.js --no-example                        # 参考例を埋め込まない
 *   node script/1.disassemble.js --exclude-config ./my-exclude.md    # 除外設定ファイルを差し替え
 *   node script/1.disassemble.js --retry-lm-fail                     # 既存フォールバック.md を再変換
 *
 * 要 Node.js 18 以上(グローバル fetch を使用)。
 */

'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');

// ---- プロンプト設定(外部ファイル) ---------------------------------------
// LM Studio へ渡す system / user プロンプトは外部設定ファイル
// (既定: prompt/1.disassembleConfigPrompt.md)で定義する。
// このプログラムはプロンプト文字列を一切持たず、設定ファイルの
//   ・部品/雛形セクション (## @名前)
//   ・追加指示ルール       (## +rule 条件...)
// を読み込んで組み立てる。設定は --prompt-config で差し替え可能。
// 1.disassembleConfigPrompt.md は他スクリプトからも同じ形式で利用できる共通設定。

// 設定に必須の共通セクション(不足時は起動を中止する)
const REQUIRED_SECTIONS = [
  '@template.system', '@template.user', '@persona', '@rules',
  '@lastRule.image', '@lastRule.text', '@userLine.image', '@userLine.text',
];

// パース済みのプロンプト設定( { sections: {name:body}, rules: [...] } )
let PROMPT_CONFIG = null;

// 画像解釈の参考例(既定: example/example.md)。読み込めた場合のみシステムプロンプトに埋め込む。
let EXAMPLE_TEXT = '';

// example.md が参照する PNG({ role, name, path })。画像モード時に user へ添付する。
let EXAMPLE_IMAGES = [];

// 除外設定(既定: prompt/1.disassembleExclude.md)。無い／空なら除外なし。
let EXCLUDE_CONFIG = { folders: [], sheets: [], pptFolders: [] };

// 内部種別(kind) -> 設定ファイルの種別キー(type)
const PROMPT_TYPE = { excel: 'excel', slide: 'powerpoint', word: 'word', pdf: 'pdf' };

// LM 未応答フォールバック判定・試行上限・状態ファイル名
const LM_FALLBACK_MARKER = 'LM Studio 応答なし';
const LM_MAX_ATTEMPTS = 2;
const LM_PENDING_FILE = '1.disassemble_lm_pending.json';

// LM 未応答の保留状態(キー=1.disassemble 相対の出力.mdパス)
let LM_PENDING = {};
let LM_PENDING_PATH = '';

// 設定ファイルを読み込み・解析する。失敗時は例外。
function loadPromptConfig(configPath) {
  let text;
  try {
    text = fs.readFileSync(configPath, 'utf8');
  } catch (e) {
    throw new Error(`プロンプト設定ファイルを読み込めません: ${configPath} (${e.message})`);
  }
  const parsed = parsePromptConfig(text);
  const missing = REQUIRED_SECTIONS.filter((n) => isNullOrWhiteSpace(parsed.sections[n]));
  if (missing.length > 0) {
    throw new Error(`プロンプト設定に必須セクションがありません: ${missing.join(', ')} (${configPath})`);
  }
  return parsed;
}

// Markdown 設定を { sections, rules } に解析する。
// - <!-- --> コメントと ``` フェンスは解析対象外(例示を安全に書ける)
// - 「## @名前」で始まる行     = 部品/雛形セクション(次の見出しまでが本文)
// - 「## +rule 条件...」で始まる行 = 追加指示ルール(次の見出しまでが指示文)
function parsePromptConfig(text) {
  text = String(text).replace(/\r\n/g, '\n');
  text = text.replace(/<!--[\s\S]*?-->/g, '');  // HTMLコメント除去
  text = text.replace(/```[\s\S]*?```/g, '');    // フェンス除去
  const lines = text.split('\n');
  const sections = {};
  const rules = [];
  let cur = null;
  let seq = 0;
  const flush = () => {
    if (!cur) return;
    const body = cur.buf.join('\n').trim();
    if (cur.kind === 'section') sections[cur.name] = body;
    else rules.push({ cond: cur.cond, seq: cur.seq, text: body });
    cur = null;
  };
  for (const line of lines) {
    const mSec = /^##\s+(@[\w.]+)\s*$/.exec(line);
    const mRule = /^##\s+\+rule\b(.*)$/.exec(line);
    if (mSec) { flush(); cur = { kind: 'section', name: mSec[1], buf: [] }; }
    else if (mRule) { flush(); cur = { kind: 'rule', cond: parseRuleCond(mRule[1]), seq: seq++, buf: [] }; }
    else if (cur) { cur.buf.push(line); }
  }
  flush();
  return { sections, rules };
}

// 「type=excel folder="a/b" file=x.xlsx」を { type, folder, file } に解析。
// 値に空白を含める場合はダブル/シングルクォートで囲む。
function parseRuleCond(s) {
  const cond = {};
  const re = /(\w+)=("([^"]*)"|'([^']*)'|(\S+))/g;
  let m;
  while ((m = re.exec(s)) !== null) {
    const key = m[1];
    const val = m[3] !== undefined ? m[3] : (m[4] !== undefined ? m[4] : m[5]);
    if (key === 'type' || key === 'folder' || key === 'file') cond[key] = val;
  }
  return cond;
}

// 設定セクションを取得。required=true で不足時は例外。
function promptSection(name, required) {
  const v = PROMPT_CONFIG && PROMPT_CONFIG.sections[name];
  if (isNullOrWhiteSpace(v)) {
    if (required) throw new Error(`プロンプト設定に必須セクション ${name} がありません`);
    return '';
  }
  return v;
}

// 雛形の {key} を vars で置換し、空プレースホルダ由来の余分な空行を整理する。
function fillTemplate(tpl, vars) {
  let out = String(tpl).replace(/\{(\w+)\}/g, (_, k) => (k in vars ? String(vars[k] == null ? '' : vars[k]) : `{${k}}`));
  out = out.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n');
  return out.trim();
}

// 追加指示ルール(+rule)を条件照合し、合成順に連結して返す。無ければ ''。
// 合成順(弱→強・後ほど優先): common → type → folder(浅→深) → type+folder → file
function buildAdditionalPrompt(type, relPath) {
  if (!PROMPT_CONFIG || PROMPT_CONFIG.rules.length === 0) return '';
  const rel = String(relPath || '').replace(/\\/g, '/').replace(/^\/+/, '');
  const fileName = rel ? rel.split('/').pop() : '';
  const relFolder = rel ? rel.split('/').slice(0, -1).join('/') : '';

  const matched = [];
  for (const r of PROMPT_CONFIG.rules) {
    if (isNullOrWhiteSpace(r.text)) continue;
    const c = r.cond;
    if (c.type && c.type !== type) continue;
    if (c.folder) {
      const f = c.folder.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
      if (!(relFolder === f || relFolder.startsWith(f + '/'))) continue; // フォルダー境界で前方一致(継承)
    }
    if (c.file) {
      const cf = c.file.replace(/\\/g, '/').replace(/^\/+/, '');
      if (!(fileName === cf || rel === cf || rel.endsWith('/' + cf))) continue;
    }
    matched.push(r);
  }
  if (matched.length === 0) return '';

  const tier = (r) => {
    const c = r.cond;
    if (c.file) return 4;
    if (c.folder && c.type) return 3;
    if (c.folder) return 2;
    if (c.type) return 1;
    return 0;
  };
  const depth = (r) => (r.cond.folder ? r.cond.folder.replace(/^\/+|\/+$/g, '').split('/').length : 0);
  matched.sort((a, b) => tier(a) - tier(b) || depth(a) - depth(b) || a.seq - b.seq);

  const texts = matched.map((r) => r.text.trim()).filter(Boolean);
  if (texts.length === 0) return '';
  const header = promptSection('@additionalHeader', false);
  return (header ? header + '\n' : '') + texts.join('\n');
}

// 内部種別(kind)と hasImage・ctx・relPath から system / userPrompt を組み立てる。
// プロンプト本文はすべて設定ファイル(PROMPT_CONFIG)から取得する。
function buildReconstructPrompt(kind, { hasImage, ctx, relPath }) {
  const type = PROMPT_TYPE[kind] || kind;

  const system = fillTemplate(promptSection('@template.system', true), {
    persona: promptSection('@persona', true),
    systemBody: promptSection(`@${type}.${hasImage ? 'systemImage' : 'systemText'}`, true),
    rules: promptSection('@rules', true),
    examples: hasImage && EXAMPLE_TEXT
      ? `${promptSection('@examplesHeader', false) || '参考例(画像解釈のガイド。対象画像がこれに類似する場合は解釈方法を参考にすること):'}\n\n${EXAMPLE_TEXT}`
      : '',
    lastRule: promptSection(`@lastRule.${hasImage ? 'image' : 'text'}`, true),
    additional: buildAdditionalPrompt(type, relPath),
  });

  const userPrompt = fillTemplate(promptSection('@template.user', true), {
    userIntro: promptSection(`@${type}.userIntro`, true),
    userLine: promptSection(`@userLine.${hasImage ? 'image' : 'text'}`, true),
    ctx,
  });

  return { system, userPrompt };
}

// example.md 本文から「### 対象画像:xxx.png」「### 解釈画像:yyy.png」を出現順に収集する。
// baseDir 相対で存在するものだけ返し、欠落は missing に積む。
function parseExampleImages(text, baseDir) {
  const images = [];
  const missing = [];
  const seen = new Set();
  const re = /^###\s*(対象画像|解釈画像)\s*[:：]\s*(.+\.png)\s*$/gim;
  let m;
  while ((m = re.exec(String(text || ''))) !== null) {
    const role = m[1];
    const name = m[2].trim();
    if (!name || seen.has(role + '\0' + name)) continue;
    seen.add(role + '\0' + name);
    const imgPath = path.join(baseDir, name);
    if (fs.existsSync(imgPath)) images.push({ role, name, path: imgPath });
    else missing.push(name);
  }
  return { images, missing };
}

// 対象ドキュメント PNG と参考例 PNG を、LM 送信用のキャプション付き配列にする。
// docPngPath が無い場合は空（テキストのみ送信）。参考例は画像モード時のみ付く。
function buildLmImageItems(docPngPath) {
  if (!docPngPath) return [];
  const items = [];
  for (const ex of EXAMPLE_IMAGES) {
    items.push({ path: ex.path, caption: `【参考例】${ex.role}: ${ex.name}` });
  }
  items.push({ path: docPngPath, caption: '【対象】再構成するドキュメント画像' });
  return items;
}

// ---- 除外設定 -------------------------------------------------------------
// prompt/1.disassembleExclude.md 形式:
//   ## folder / ## sheet / ## ppt-folder 見出しの下に1行1件。
//   ## sheet / ## ppt-folder は folder=相対パス を付けてスコープ可（セクション繰り返し可）。
//   # コメントと空行は無視（## 見出しは除く）。ファイル無し・空なら除外なし。

// 除外エントリの folder 条件が relDir にマッチするか。folder 未指定は常に真。
function matchExcludeFolder(entryFolder, relDir) {
  if (!entryFolder) return true;
  const d = String(relDir || '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
  const f = String(entryFolder).replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
  if (!f) return true;
  return d === f || d.startsWith(f + '/');
}

function loadExcludeConfig(configPath) {
  const empty = { folders: [], sheets: [], pptFolders: [] };
  let text;
  try {
    text = fs.readFileSync(configPath, 'utf8');
  } catch (_) {
    return empty;
  }
  text = String(text).replace(/\r\n/g, '\n');
  const result = { folders: [], sheets: [], pptFolders: [] };
  let section = null; // 'folder' | 'sheet' | 'ppt-folder'
  let sectionFolder = ''; // sheet / ppt-folder 見出しの folder=（無ければ空=全共通）
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    // 単一 # のコメントのみ無視（## 見出しは残す）
    if (trimmed.startsWith('#') && !trimmed.startsWith('##')) continue;
    // ## name [folder=...] （folder 以外の属性は無視）
    const m = /^##\s+(\S+)(.*)$/.exec(trimmed);
    if (m) {
      const name = m[1];
      if (name === 'folder' || name === 'sheet' || name === 'ppt-folder') {
        section = name;
        const cond = parseRuleCond(m[2] || '');
        sectionFolder = (name !== 'folder' && cond.folder)
          ? String(cond.folder).replace(/\\/g, '/').replace(/^\/+|\/+$/g, '')
          : '';
      } else {
        section = null;
        sectionFolder = '';
      }
      continue;
    }
    if (!section) continue;
    if (section === 'folder') {
      result.folders.push(trimmed.replace(/\\/g, '/').replace(/^\/+|\/+$/g, ''));
    } else if (section === 'sheet') {
      result.sheets.push({ name: trimmed, folder: sectionFolder });
    } else if (section === 'ppt-folder') {
      result.pptFolders.push({ name: trimmed, folder: sectionFolder });
    }
  }
  return result;
}

// 0.input 相対フォルダーパスが除外対象か(完全一致または配下)
function isExcludedFolder(relDir) {
  const d = String(relDir || '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
  if (!d) return false;
  return (EXCLUDE_CONFIG.folders || []).some((p) => d === p || d.startsWith(p + '/'));
}

// Excel シート名の完全一致。folder 付きエントリは relDir 配下のブックだけ。
function isExcludedSheet(name, relDir) {
  const n = String(name);
  return (EXCLUDE_CONFIG.sheets || []).some((e) => e.name === n && matchExcludeFolder(e.folder, relDir));
}

// PowerPoint 章扉タイトル(label)の完全一致。folder 付きは relDir 配下の PPT だけ。
function isExcludedPptFolder(label, relDir) {
  const n = String(label || '').trim();
  return (EXCLUDE_CONFIG.pptFolders || []).some((e) => e.name === n && matchExcludeFolder(e.folder, relDir));
}

// 章番号が除外章 C 自身または C. 配下か
function isChapterUnderExcluded(chapter, excludedNums) {
  if (!chapter || !excludedNums || excludedNums.length === 0) return false;
  const num = chapter.num;
  return excludedNums.some((c) => num === c || num.startsWith(c + '.'));
}

// ---- 引数解析 -------------------------------------------------------------

function parseArgs(argv) {
  const scriptDir = __dirname;
  const projectRoot = path.resolve(scriptDir, '..'); // プロジェクト直下(menu.js と同じ基準)
  const opts = {
    sourceRoot: path.join(projectRoot, '0.input'),
    outputRoot: path.join(projectRoot, '1.disassemble'),
    logRoot: path.join(projectRoot, '9.log'),       // 各種ログ出力先(9.log フォルダーに統一)
    workRoot: path.join(projectRoot, '_work'),      // 中間成果物(LM未応答の状態ファイルなど)
    promptConfig: path.join(projectRoot, 'prompt', '1.disassembleConfigPrompt.md'), // 共通プロンプト設定
    exampleFile: path.join(projectRoot, 'example', 'example.md'), // 画像解釈の参考例ファイル
    excludeConfig: path.join(projectRoot, 'prompt', '1.disassembleExclude.md'), // 除外設定ファイル
    useExample: true,   // 参考例ファイルをシステムプロンプトに埋め込む
    filter: '',
    folder: '',         // 0.input からの相対パス。指定時はそのフォルダー配下のみ処理する
    officeTimeout: 180, // officecli 1回あたりのタイムアウト(秒)。ハング対策。
    lmEndpoint: 'http://localhost:1234/v1/chat/completions',
    // 画像入力対応(Vision)モデル推奨。図形シート/スライドのPNGを渡して再構成する。
    lmModel: 'google/gemma-4-31b-qat',
    lmMaxTokens: 20000,
    lmTimeout: 600,     // LLM 1回あたりのタイムアウト(秒)
    lmImage: true,      // 図形シート/スライドをPNG化してLLMに画像として渡す
    lmImageWidth: 1600, // 送信PNGのレンダリング横幅(px)。小さくするとトークン削減
    retryLmFail: false, // 既存フォールバック.md(LM未応答)を削除して再変換する
  };

  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    switch (a) {
      case '--source-root': opts.sourceRoot = next(); break;
      case '--output-root': opts.outputRoot = next(); break;
      case '--log-root': opts.logRoot = next(); break;
      case '--work-root': opts.workRoot = next(); break;
      case '--prompt-config': opts.promptConfig = next(); break; // プロンプト設定ファイルの差し替え
      case '--example-file': opts.exampleFile = next(); break;   // 画像解釈の参考例ファイルの差し替え
      case '--exclude-config': opts.excludeConfig = next(); break; // 除外設定ファイルの差し替え
      case '--no-example': opts.useExample = false; break;       // 参考例をシステムプロンプトに埋め込まない
      case '--filter': opts.filter = next(); break;            // 相対パス部分一致フィルタ(動作確認用)
      case '--folder': opts.folder = next(); break;            // 0.input 配下の指定フォルダーのみ処理
      case '--office-timeout': opts.officeTimeout = parseInt(next(), 10) || 180; break;
      case '--lm-endpoint': opts.lmEndpoint = next(); break;
      case '--lm-model': opts.lmModel = next(); break;
      case '--lm-max-tokens': opts.lmMaxTokens = parseInt(next(), 10) || 2000; break;
      case '--lm-timeout': opts.lmTimeout = parseInt(next(), 10) || 300; break;
      case '--no-lm-image': opts.lmImage = false; break;       // 画像を使わずテキストのみ送信
      case '--lm-image-width': opts.lmImageWidth = parseInt(next(), 10) || 1600; break;
      case '--retry-lm-fail': opts.retryLmFail = true; break;  // フォールバック.md を再変換
      default:
        console.error(`不明な引数: ${a}`);
        break;
    }
  }
  return opts;
}

const OPT = parseArgs(process.argv);
const OFFICECLI = 'officecli';
const OFFICE_EXTS = new Set(['.xlsx', '.pptx', '.docx']);

// 実行中コンテキスト(未捕捉例外ハンドラから参照)
const RUN = { stat: null, currentFile: '', failedPath: '' };

// ---- LM未応答の状態ファイル -----------------------------------------------

function loadLmPending(filePath) {
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    const obj = JSON.parse(raw);
    if (obj && typeof obj === 'object' && !Array.isArray(obj)) return obj;
  } catch (_) { /* 無い／壊れている場合は空 */ }
  return {};
}

function saveLmPending() {
  if (!LM_PENDING_PATH) return;
  try {
    safeMkdir(path.dirname(LM_PENDING_PATH));
    fs.writeFileSync(LM_PENDING_PATH, JSON.stringify(LM_PENDING, null, 2) + '\n', 'utf8');
  } catch (e) {
    writeLog(`!! LM pending 保存失敗: ${e.message}`);
  }
}

// 出力.md の 1.disassemble 相対パス(キー用)
function outMdRelKey(outMd) {
  return path.relative(OPT.outputRoot, outMd).split(path.sep).join('/');
}

function getLmPendingAttempts(outMd) {
  const ent = LM_PENDING[outMdRelKey(outMd)];
  return (ent && ent.attempts) ? ent.attempts : 0;
}

function recordLmPending(outMd, sourceRel, kind) {
  const key = outMdRelKey(outMd);
  const prev = LM_PENDING[key];
  const attempts = (prev && prev.attempts ? prev.attempts : 0) + 1;
  LM_PENDING[key] = {
    source: sourceRel,
    kind,
    attempts,
    updatedAt: nowSortable(),
  };
  saveLmPending();
  return attempts;
}

function clearLmPending(outMd) {
  const key = outMdRelKey(outMd);
  if (!LM_PENDING[key]) return;
  delete LM_PENDING[key];
  saveLmPending();
}

// 既存.md が LM 未応答フォールバックか
function isLmFallbackMd(filePath) {
  try {
    const text = fs.readFileSync(filePath, 'utf8');
    return text.includes(LM_FALLBACK_MARKER);
  } catch (_) {
    return false;
  }
}

// 既存出力に対する動作: 'skip' | 'convert' | 'retry-fallback'
function decideOutMdAction(outMd) {
  if (!fs.existsSync(outMd)) return 'convert';
  if (OPT.retryLmFail && isLmFallbackMd(outMd)) return 'retry-fallback';
  return 'skip';
}

// 変換してよければ { proceed:true, forceFallback }。スキップ時は proceed:false。
function prepareOutMdForConvert(outMd, label, stat) {
  const action = decideOutMdAction(outMd);
  if (action === 'skip') {
    stat.skipped++;
    writeLog(`    -> [スキップ] ${label} 既存`);
    return { proceed: false, forceFallback: false };
  }
  if (action === 'retry-fallback') {
    try { fs.unlinkSync(outMd); } catch (_) { /* ignore */ }
    clearLmPending(outMd);
    stat.aiRetry++;
    writeLog(`    -> [再実行] ${label} ※前回 LLM応答なし`);
    return { proceed: true, forceFallback: true };
  }
  const prev = getLmPendingAttempts(outMd);
  if (prev > 0) {
    stat.aiRetry++;
    writeLog(`    -> [再実行] ${label} ※pending試行${prev}/${LM_MAX_ATTEMPTS}`);
  }
  return { proceed: true, forceFallback: false };
}

// LM 結果を確定: 成功→.md / 未達上限→pendingのみ / 上限or強制→フォールバック.md
// 戻り値: 'ok' | 'pending' | 'fallback'
function commitLmResult(outMd, res, { sourceRel, kind, label, stat, forceFallback }) {
  if (res.ok) {
    safeMkdir(path.dirname(outMd));
    fs.writeFileSync(outMd, res.md, 'utf8');
    clearLmPending(outMd);
    stat.aiSheets++;
    writeLog(`    -> [AI-MD] ${label}`);
    return 'ok';
  }

  const prevAttempts = getLmPendingAttempts(outMd);
  if (forceFallback || prevAttempts + 1 >= LM_MAX_ATTEMPTS) {
    safeMkdir(path.dirname(outMd));
    fs.writeFileSync(outMd, res.md, 'utf8');
    clearLmPending(outMd);
    stat.aiFallback++;
    writeLog(`    -> [AI-MD(代替)] ${label} ※LLM応答なし`);
    return 'fallback';
  }

  const attempts = recordLmPending(outMd, sourceRel, kind);
  stat.aiPending++;
  writeLog(`    -> [LM未応答] ${label} (試行${attempts}/${LM_MAX_ATTEMPTS}・.md未出力)`);
  return 'pending';
}

// officecli 呼び出しログ(Excel/PowerPoint 共通・単一ファイル)の出力先
let OFFICECLI_LOG_PATH = '';

// 同期スリープ(初期化リトライ用)
function sleepSync(ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) { /* spin */ }
}

// 同期処理をリトライする(NAS 一時エラー対策)
function retrySync(fn, { retries = 3, delayMs = 1000 } = {}) {
  let lastErr;
  for (let i = 0; i < retries; i++) {
    try { return fn(); }
    catch (e) {
      lastErr = e;
      if (i < retries - 1) sleepSync(delayMs);
    }
  }
  throw lastErr;
}

// mkdir をリトライ付きで実行
function safeMkdir(dir) {
  try {
    retrySync(() => fs.mkdirSync(dir, { recursive: true }));
    return true;
  } catch (e) {
    writeLog(`!! フォルダー作成失敗(処理は継続): ${dir} (${e.message})`);
    return false;
  }
}

// ファイル書き込みをリトライ付きで実行。失敗時は false。
function safeWriteFile(filePath, content) {
  try {
    retrySync(() => fs.writeFileSync(filePath, content, 'utf8'));
    return true;
  } catch (e) {
    writeLog(`!! ファイル書き込み失敗: ${filePath} (${e.message})`);
    return false;
  }
}

// 未捕捉例外・未処理 Promise 拒否をログに記録し、可能な限り処理を継続する
function installGlobalErrorHandlers() {
  process.on('uncaughtException', (err) => {
    writeLog(`!! 未捕捉例外 [${RUN.currentFile}]: ${err.stack || err.message}`);
    if (RUN.stat) RUN.stat.errors++;
    if (RUN.failedPath && RUN.currentFile) {
      try {
        fs.appendFileSync(RUN.failedPath, `${RUN.currentFile}\t未捕捉例外: ${err.message}\n`, 'utf8');
      } catch (_) { /* ignore */ }
    }
  });
  process.on('unhandledRejection', (reason) => {
    const msg = reason && reason.stack ? reason.stack : String(reason);
    writeLog(`!! 未処理Promise拒否 [${RUN.currentFile}]: ${msg}`);
    if (RUN.stat) RUN.stat.errors++;
  });
}
installGlobalErrorHandlers();

// officecli 1回の呼び出し結果をログファイルへ追記する
function logOffice(cliArgs, exitCode, errText, rawLen, note) {
  if (!OFFICECLI_LOG_PATH) return;
  const ts = `${nowSortable()}`;
  let line = `[${ts}] officecli ${cliArgs.join(' ')} --json (exit=${exitCode == null ? '-' : exitCode}, stdoutChars=${rawLen}`;
  if (note) line += `, ${note}`;
  line += ')';
  if (errText) line += `\n    stderr: ${errText}`;
  try { fs.appendFileSync(OFFICECLI_LOG_PATH, line + '\n', 'utf8'); } catch (_) { /* ignore */ }
}

// ---- ヘルパー -------------------------------------------------------------

// ファイル名に使えない文字を除去
function getSafeName(name) {
  // Windows で禁止された文字 + 制御文字
  const re = /[<>:"/\\|?*\x00-\x1f]/g;
  return String(name).replace(re, '_').trim();
}

// フォルダー/ファイル名に使うタイトルの最大文字数(Windows のパス長対策)
const NAME_MAX = 60;

// タイトルをファイル/フォルダー名用に安全化+長さ制限する
function toFileLabel(label, fallback) {
  const s = getSafeName(String(label || '')).slice(0, NAME_MAX).trim();
  return s || fallback;
}

// 列文字(A,B,AA..)を数値に変換
function convertToColNum(letters) {
  let n = 0;
  for (const ch of letters) {
    n = n * 26 + (ch.charCodeAt(0) - 'A'.charCodeAt(0) + 1);
  }
  return n;
}

// 数値を列文字に変換
function convertToColLetter(num) {
  let s = '';
  while (num > 0) {
    const r = (num - 1) % 26;
    s = String.fromCharCode('A'.charCodeAt(0) + r) + s;
    num = Math.floor((num - 1) / 26);
  }
  return s;
}

function isNullOrWhiteSpace(v) {
  return v === null || v === undefined || String(v).trim() === '';
}

function isNullOrEmpty(v) {
  return v === null || v === undefined || String(v) === '';
}

// officecli を実行し JSON を返す
function invokeOffice(cliArgs) {
  let res;
  try {
    res = spawnSync(OFFICECLI, [...cliArgs, '--json'], {
      encoding: 'utf8',
      maxBuffer: 256 * 1024 * 1024,
      windowsHide: true,
      timeout: OPT.officeTimeout * 1000,
      killSignal: 'SIGTERM',
    });
  } catch (e) {
    logOffice(cliArgs, null, e.message, 0, '実行エラー');
    writeLog(`    !! officecli 実行エラー: ${e.message} args: ${cliArgs.join(' ')}`);
    return null;
  }

  const raw = res.stdout || '';
  const errText = (res.stderr || '').trim();
  const exitCode = res.status;

  if (res.error && res.error.code === 'ETIMEDOUT') {
    logOffice(cliArgs, exitCode, errText, 0, `タイムアウト(${OPT.officeTimeout}秒)`);
    writeLog(`    !! officecli タイムアウト (${OPT.officeTimeout}秒) args: ${cliArgs.join(' ')}`);
    return null;
  }

  if (isNullOrWhiteSpace(raw)) {
    logOffice(cliArgs, exitCode, errText, 0, '応答なし');
    writeLog(`    !! officecli 応答なし (exit=${exitCode} args=${cliArgs.join(' ')}) stderr: ${errText}`);
    return null;
  }
  try {
    const parsed = JSON.parse(raw);
    logOffice(cliArgs, exitCode, errText, raw.length, parsed && parsed.success === false ? 'success=false' : '');
    return parsed;
  } catch (e) {
    logOffice(cliArgs, exitCode, errText, raw.length, `JSON解析エラー: ${e.message}`);
    writeLog(`    !! officecli JSON解析エラー: ${e.message} stderr: ${errText}`);
    return null;
  }
}

// officecli で指定ページ(PowerPoint=スライド番号 / Excel=シート順)のPNGを生成し、
// 一時ファイルのパスを返す。失敗時は null。
function capturePng(file, page) {
  const tmp = path.join(
    os.tmpdir(),
    `officedis_${process.pid}_${Date.now()}_${Math.random().toString(36).slice(2)}.png`
  );
  const res = invokeOffice([
    'view', file, 'screenshot',
    '--page', String(page),
    '--screenshot-width', String(OPT.lmImageWidth),
    '-o', tmp,
  ]);
  if (res && res.success && fs.existsSync(tmp)) return tmp;
  // -o 指定が効かない環境向けに data 側のパスもフォールバックで確認
  if (res && res.success && typeof res.data === 'string' && fs.existsSync(res.data)) return res.data;
  return null;
}

// 一時PNGを安全に削除する
function removeTemp(p) {
  if (!p) return;
  try { fs.unlinkSync(p); } catch (_) { /* ignore */ }
}

// row.cells オブジェクトを [name, value] の配列にして返す
function cellEntries(row) {
  if (!row || !row.cells || typeof row.cells !== 'object') return [];
  return Object.entries(row.cells);
}

// シートの JSON 行データから Markdown テーブルを生成
function buildMarkdown(sheetObj, title) {
  const out = [];
  if (title) { out.push(`# ${title}`); out.push(''); }

  const cellMap = new Map();
  let maxCol = 0;
  let maxRow = 0;
  const rows = (sheetObj && sheetObj.rows) || [];
  for (const row of rows) {
    const rowNum = parseInt(row.row, 10);
    for (const [name, value] of cellEntries(row)) {
      const val = value == null ? '' : String(value);
      if (isNullOrEmpty(val)) continue;
      const m = /^([A-Z]+)(\d+)$/.exec(name);
      if (m) {
        const col = convertToColNum(m[1]);
        cellMap.set(`${rowNum},${col}`, val);
        if (col > maxCol) maxCol = col;
        if (rowNum > maxRow) maxRow = rowNum;
      }
    }
  }

  if (maxCol === 0) {
    out.push('_(空のシート)_');
    return out.join('\n') + '\n';
  }

  let header = '|     |';
  let sep = '| --- |';
  for (let c = 1; c <= maxCol; c++) {
    header += ' ' + convertToColLetter(c) + ' |';
    sep += ' --- |';
  }
  out.push(header);
  out.push(sep);

  for (let r = 1; r <= maxRow; r++) {
    let line = `| **${r}** |`;
    for (let c = 1; c <= maxCol; c++) {
      let v = cellMap.get(`${r},${c}`);
      if (v == null) v = '';
      v = v.replace(/\|/g, '\\|');
      v = v.replace(/\r?\n/g, '<br>');
      line += ` ${v} |`;
    }
    out.push(line);
  }
  return out.join('\n') + '\n';
}

// 非空セルを "A1: 値" 形式の素のテキストに(LLM入力用、座標把握しやすい簡潔版)
function getCellText(sheetObj, maxChars = 3000) {
  const lines = [];
  const rows = (sheetObj && sheetObj.rows) || [];
  for (const row of rows) {
    for (const [name, value] of cellEntries(row)) {
      let val = value == null ? '' : String(value);
      if (isNullOrEmpty(val)) continue;
      val = val.replace(/\r?\n/g, ' ');
      lines.push(`${name}: ${val}`);
    }
  }
  let txt = lines.join('\n');
  if (txt.length > maxChars) txt = txt.substring(0, maxChars) + '\n...(以下省略)';
  return txt;
}

// sleep(ミリ秒)
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// LM Studio (OpenAI互換API) を呼び出して本文テキストを返す
// imageItems を渡すと、user メッセージに PNG を image_url(base64 data URI)として添付する
// (Vision対応モデルが必要)。各要素は文字列パス、または { path, caption? }。
async function invokeLMStudio(system, userPrompt, imageItems = []) {
  // 画像を base64 データURIにして user content を組み立てる(キャプション付き multipart)
  const normalized = (imageItems || []).map((item) => {
    if (typeof item === 'string') return { path: item, caption: '' };
    if (item && item.path) return { path: item.path, caption: item.caption || '' };
    return null;
  }).filter((item) => item && item.path && fs.existsSync(item.path));

  let userContent = userPrompt;
  if (normalized.length > 0) {
    const parts = [{ type: 'text', text: userPrompt }];
    for (const item of normalized) {
      if (item.caption) parts.push({ type: 'text', text: item.caption });
      try {
        const b64 = fs.readFileSync(item.path).toString('base64');
        parts.push({ type: 'image_url', image_url: { url: `data:image/png;base64,${b64}` } });
      } catch (_) { /* 読めない画像はスキップ */ }
    }
    if (parts.length > 1) userContent = parts; // 画像が1枚以上付いた場合のみ配列形式
  }

  const body = JSON.stringify({
    model: OPT.lmModel,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: userContent },
    ],
    temperature: 0.2,
    max_tokens: OPT.lmMaxTokens,
  });

  for (let attempt = 1; attempt <= 2; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), OPT.lmTimeout * 1000);
    try {
      const resp = await fetch(OPT.lmEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
        body,
        signal: controller.signal,
      });
      clearTimeout(timer);
      if (!resp.ok) {
        if (attempt >= 2) return null;
        await sleep(2000);
        continue;
      }
      const data = await resp.json();
      const msg = data && data.choices && data.choices[0] && data.choices[0].message;
      const txt = msg && msg.content ? String(msg.content) : '';
      if (!isNullOrWhiteSpace(txt)) return txt.trim();
      // content が空(思考で打ち切り等)の場合はフォールバックへ
      if (attempt >= 2) return null;
    } catch (e) {
      clearTimeout(timer);
      if (attempt >= 2) return null;
      await sleep(2000);
    }
  }
  return null;
}

// 図形シートの内容を LM Studio で Markdown 化する
// file / sheetPage を渡すと、シートをPNG化してLLMに画像として添付する
async function convertDrawingToMarkdown(title, sheetName, shapes, sheetObj, picCount, chartCount, file, sheetPage, rel) {
  // 図形を座標(上→下, 左→右)順に整列し、テキストのあるものを列挙
  const shapeLines = [];
  const sorted = [...shapes].sort((a, b) => {
    const ay = parseFloat((a.format && a.format.y) || 0);
    const by = parseFloat((b.format && b.format.y) || 0);
    if (ay !== by) return ay - by;
    const ax = parseFloat((a.format && a.format.x) || 0);
    const bx = parseFloat((b.format && b.format.x) || 0);
    return ax - bx;
  });
  let count = 0;
  for (const sh of sorted) {
    let t = sh.text == null ? '' : String(sh.text);
    if (isNullOrWhiteSpace(t)) continue;
    t = t.replace(/\r?\n/g, ' ').trim();
    const x = sh.format ? sh.format.x : '';
    const y = sh.format ? sh.format.y : '';
    shapeLines.push(`- (x=${x},y=${y}) ${t}`);
    count++;
    if (count >= 250) { shapeLines.push('- ...(図形多数のため以降省略)'); break; }
  }

  const cellText = sheetObj ? getCellText(sheetObj, 2500) : '(なし)';

  const ctx = [];
  ctx.push(`シート名: ${sheetName}`);
  if (picCount > 0) ctx.push(`※画像(picture)が ${picCount} 個含まれます(画像内の文字はテキスト化できません)。`);
  if (chartCount > 0) ctx.push(`※グラフ(chart)が ${chartCount} 個含まれます。`);
  ctx.push('');
  ctx.push('■ 図形テキスト(座標つき / x=列方向, y=行方向):');
  ctx.push(shapeLines.length > 0 ? shapeLines.join('\n') : '(テキスト付き図形なし)');
  ctx.push('');
  ctx.push('■ セルテキスト:');
  ctx.push(cellText);

  // 画像モード時はシートのPNGを生成して添付する
  let pngPath = null;
  if (OPT.lmImage && file && sheetPage) {
    pngPath = capturePng(file, sheetPage);
  }
  const hasImage = !!pngPath;

  const { system, userPrompt } = buildReconstructPrompt('excel', { hasImage, ctx: ctx.join('\n'), relPath: rel });

  const result = await invokeLMStudio(system, userPrompt, buildLmImageItems(pngPath));
  removeTemp(pngPath);

  const src = hasImage ? '図形シートのPNG画像' : '図形テキスト・座標・セル値';
  const head = `# ${title}\n\n> ※このシートは図形で構成されているため、LM Studio(${OPT.lmModel})が${src}から内容を再構成したものです。\n\n`;
  if (isNullOrWhiteSpace(result)) {
    // LLM 失敗時のフォールバック: 抽出した図形テキストをそのまま出力
    let fb = `## 図形テキスト(自動抽出 / ${LM_FALLBACK_MARKER})\n\n`;
    fb += shapeLines.length > 0 ? shapeLines.join('\n') : '(なし)';
    return { md: head + fb, ok: false };
  }
  return { md: head + result, ok: true };
}

// ---- PowerPoint ヘルパー ---------------------------------------------------

// officecli の長さ表記(emu/cm/mm/pt/in/px)を EMU 数値に正規化(座標ソート用)
function parseEmuLen(v) {
  if (v == null) return 0;
  const m = /^(-?[\d.]+)\s*([a-z%]*)$/i.exec(String(v).trim());
  if (!m) return 0;
  const num = parseFloat(m[1]) || 0;
  const unit = (m[2] || 'emu').toLowerCase();
  switch (unit) {
    case 'emu': return num;
    case 'cm': return num * 360000;
    case 'mm': return num * 36000;
    case 'pt': return num * 12700;
    case 'in': return num * 914400;
    case 'px': return num * 9525;
    default: return num;
  }
}

// 改行を畳んだ1行テキストにする(座標列挙・ラベル用)
function flattenText(t) {
  if (t == null) return '';
  return String(t).replace(/\r?\n/g, ' ').replace(/\s+/g, ' ').trim();
}

// 配置順(上→下, 左→右)で図形を並べる比較関数
function compareByPos(a, b) {
  if (a.y !== b.y) return a.y - b.y;
  return a.x - b.x;
}

// table ノード(tr/tc)から2次元セル配列を取り出す
function buildTableData(node) {
  const fmt = node.format || {};
  const rows = [];
  for (const tr of (node.children || [])) {
    if (tr.type !== 'tr') continue;
    const cells = [];
    for (const tc of (tr.children || [])) {
      if (tc.type !== 'tc') continue;
      cells.push(tc.text == null ? '' : String(tc.text));
    }
    rows.push(cells);
  }
  return { rows, x: parseEmuLen(fmt.x), y: parseEmuLen(fmt.y) };
}

// 2次元セル配列を Markdown テーブル文字列にする
function rowsToMarkdown(rows) {
  const out = [];
  let maxCols = 0;
  for (const r of rows) if (r.length > maxCols) maxCols = r.length;
  if (maxCols === 0) return '';
  const esc = (v) => String(v == null ? '' : v).replace(/\|/g, '\\|').replace(/\r?\n/g, '<br>');
  const header = rows[0] || [];
  let h = '|';
  let sep = '|';
  for (let c = 0; c < maxCols; c++) {
    h += ` ${esc(header[c] || '')} |`;
    sep += ' --- |';
  }
  out.push(h);
  out.push(sep);
  for (let r = 1; r < rows.length; r++) {
    let line = '|';
    for (let c = 0; c < maxCols; c++) line += ` ${esc(rows[r][c] || '')} |`;
    out.push(line);
  }
  return out.join('\n');
}

// 1スライドの get 結果(slideObj)を走査し、テキスト図形/表/画像などを抽出・分類する
function analyzeSlide(slideObj) {
  const textShapes = []; // { text, x, y, isTitle }
  const tables = [];     // { rows, x, y }
  let pic = 0;
  let chart = 0;
  let graphical = false; // 画像/グラフ/図形(ダイアグラム)を含むか(表は含めない)
  let titleText = '';

  function walk(node) {
    const children = (node && node.children) || [];
    for (const c of children) {
      const t = c.type;
      const fmt = c.format || {};
      const x = parseEmuLen(fmt.x);
      const y = parseEmuLen(fmt.y);
      if (t === 'textbox' || t === 'placeholder') {
        const txt = c.text == null ? '' : String(c.text).trim();
        if (txt) {
          const isTitle = fmt.isTitle === true || fmt.isTitle === 'true';
          textShapes.push({ text: txt, x, y, isTitle });
          if (isTitle && !titleText) titleText = flattenText(txt);
        }
      } else if (t === 'picture') {
        pic++; graphical = true;
      } else if (t === 'chart') {
        chart++; graphical = true;
      } else if (t === 'table') {
        tables.push(buildTableData(c)); // 表はテキスト同様に機械 Markdown 化(LM 対象外)
      } else if (t === 'group') {
        graphical = true; walk(c);
      } else if (t === 'tr' || t === 'tc' || t === 'paragraph') {
        walk(c);
      } else {
        // オートシェイプ/コネクタ/SmartArt/OLE 等 -> ダイアグラム扱い(AI 系統)
        const txt = c.text == null ? '' : String(c.text).trim();
        if (txt) textShapes.push({ text: txt, x, y, isTitle: false });
        graphical = true;
        walk(c);
      }
    }
  }
  walk(slideObj);

  const isEmpty = textShapes.length === 0 && tables.length === 0 && pic === 0 && chart === 0;

  let label = titleText;
  if (!label && textShapes.length > 0) {
    // 座標を持たない断片(run 等, x=0/y=0)はタイトル候補から除外する
    const coordShapes = textShapes.filter((s) => !(s.x === 0 && s.y === 0));
    const pool = coordShapes.length > 0 ? coordShapes : textShapes;
    const sorted = [...pool].sort(compareByPos); // 上→下, 左→右
    // タイトルプレースホルダーが無い場合は章番号付きタイトル想定で数字始まりを優先
    const numFirst = sorted.find((s) => /^\d/.test(flattenText(s.text)));
    label = flattenText((numFirst || sorted[0]).text);
  }
  // 切り詰めない(ファイル/フォルダー名化の際に toFileLabel で上限を適用する)
  label = (label || '').trim();

  return { textShapes, tables, pic, chart, graphical, isEmpty, label };
}

// ---- 章扉スライド(フォルダー化)判定ヘルパー -------------------------------

// 章扉スライドと判定する本文(タイトル以外)文字数の上限。これ以下を「内容が薄い」とみなす。
const DIVIDER_BODY_MAX = 120;

// タイトル先頭の章番号(例 "2" / "2.1" / "2.1.1")を抽出する。無ければ null。
function parseChapterNumber(label) {
  const m = /^(\d+(?:\.\d+)*)/.exec(String(label || '').trim());
  if (!m) return null;
  const num = m[1];
  return { num, segments: num.split('.') };
}

// 章扉(タイトルだけ)スライドかどうか。
// - 画像/グラフ/表を含むスライドは対象外
// - オートシェイプ等「テキストを設定できるオブジェクト」のテキストは
//   本文として判定に含める(analyzeSlide が textShapes に収集済み)
// - 章番号の有無は問わない(番号なしは呼び出し側で直前の章フォルダー配下に作成)
function isDividerSlide(info) {
  if (!info) return false;
  if (info.pic > 0 || info.chart > 0 || (info.tables && info.tables.length > 0)) return false;
  const labelText = flattenText(info.label || '');
  if (!labelText) return false;
  // タイトル以外の本文テキストを結合(isTitle が付いていない場合は label と一致するものをタイトル扱い)
  const body = (info.textShapes || [])
    .filter((s) => s.isTitle !== true && flattenText(s.text) !== labelText)
    .map((s) => flattenText(s.text))
    .join(' ')
    .trim();
  return body.length <= DIVIDER_BODY_MAX;
}

// 章番号の接頭辞を長い順に返す。"2.1.1" -> ["2.1.1","2.1","2"]
function numberPrefixes(num) {
  const segs = String(num).split('.');
  const out = [];
  for (let i = segs.length; i >= 1; i--) {
    out.push(segs.slice(0, i).join('.'));
  }
  return out;
}

// map(番号->フォルダー絶対パス)から chapter に最も近いフォルダーを探す。
// includeSelf=false のときは自番号を除いた親接頭辞のみ対象にする。
function findFolderByNumber(map, chapter, includeSelf) {
  if (!chapter) return null;
  const prefixes = numberPrefixes(chapter.num);
  for (const pre of prefixes) {
    if (!includeSelf && pre === chapter.num) continue;
    if (map.has(pre)) return map.get(pre);
  }
  return null;
}

// テキスト/表のみスライドを機械的に Markdown 化(タイトル見出し+箇条書き+表)
function buildSlideMarkdown(title, info) {
  const out = [`# ${title}`, ''];
  const sorted = [...info.textShapes].sort(compareByPos);
  for (const s of sorted) {
    const lines = String(s.text).split(/\r?\n/).map((x) => x.trim()).filter(Boolean);
    if (lines.length === 0) continue;
    if (s.isTitle) {
      out.push(`## ${lines.join(' ')}`);
      out.push('');
    } else {
      for (const ln of lines) out.push(`- ${ln}`);
    }
  }
  if (info.tables && info.tables.length > 0) {
    if (out[out.length - 1] !== '') out.push('');
    out.push('## 表');
    out.push('');
    for (const tb of info.tables) {
      const md = rowsToMarkdown(tb.rows);
      if (md) { out.push(md); out.push(''); }
    }
  }
  return out.join('\n') + '\n';
}

// 図形/画像を含むスライドの内容を LM Studio で Markdown 化する
// file を渡すと、スライドをPNG化してLLMに画像として添付する
// (表は機械経路だが、図形スライドに併存する場合は文脈として渡す)
async function convertSlideToMarkdown(title, slideIndex, info, file, rel) {
  const sorted = [...info.textShapes].sort(compareByPos);
  const shapeLines = [];
  let count = 0;
  for (const s of sorted) {
    const t = flattenText(s.text);
    if (!t) continue;
    shapeLines.push(`- (x=${Math.round(s.x)},y=${Math.round(s.y)}) ${t}`);
    count++;
    if (count >= 250) { shapeLines.push('- ...(図形多数のため以降省略)'); break; }
  }

  const ctx = [];
  ctx.push(`スライド番号: ${slideIndex}`);
  if (info.pic > 0) ctx.push(`※画像(picture)が ${info.pic} 個含まれます(画像内の文字はテキスト化できません)。`);
  if (info.chart > 0) ctx.push(`※グラフ(chart)が ${info.chart} 個含まれます。`);
  ctx.push('');
  ctx.push('■ 図形テキスト(座標つき / x=列方向, y=行方向):');
  ctx.push(shapeLines.length > 0 ? shapeLines.join('\n') : '(テキスト付き図形なし)');
  if (info.tables.length > 0) {
    ctx.push('');
    ctx.push('■ 表:');
    info.tables.forEach((tb, i) => {
      ctx.push(`(表${i + 1})`);
      ctx.push(rowsToMarkdown(tb.rows) || '(空の表)');
    });
  }

  // 画像モード時はスライドのPNGを生成して添付する
  let pngPath = null;
  if (OPT.lmImage && file && slideIndex) {
    pngPath = capturePng(file, slideIndex);
  }
  const hasImage = !!pngPath;

  const { system, userPrompt } = buildReconstructPrompt('slide', { hasImage, ctx: ctx.join('\n'), relPath: rel });

  const result = await invokeLMStudio(system, userPrompt, buildLmImageItems(pngPath));
  removeTemp(pngPath);

  const src = hasImage ? 'スライドのPNG画像' : '図形テキスト・座標・表・画像情報';
  const head = `# ${title}\n\n> ※このスライドは LM Studio(${OPT.lmModel})が${src}から内容を再構成したものです。\n\n`;
  if (isNullOrWhiteSpace(result)) {
    // LLM 失敗時のフォールバック: 抽出した図形テキスト・表をそのまま出力
    let fb = `## 図形テキスト(自動抽出 / ${LM_FALLBACK_MARKER})\n\n`;
    fb += shapeLines.length > 0 ? shapeLines.join('\n') : '(なし)';
    if (info.tables.length > 0) {
      fb += '\n\n## 表(自動抽出)\n\n';
      fb += info.tables.map((tb) => rowsToMarkdown(tb.rows)).filter(Boolean).join('\n\n');
    }
    return { md: head + fb, ok: false };
  }
  return { md: head + result, ok: true };
}

// ---- Word ヘルパー ---------------------------------------------------------

// Word 段落スタイルから見出しレベルを返す(0=通常段落)
function headingLevel(style) {
  const m = /^Heading(\d+)$/i.exec(String(style || ''));
  if (m) return Math.min(parseInt(m[1], 10), 6);
  if (/^Title$/i.test(String(style || ''))) return 1;
  return 0;
}

// Word 本文ノードを再帰走査して Markdown 行を生成
function walkWordBody(node, out) {
  if (!node) return;
  const children = node.children || [];
  for (const c of children) {
    const t = c.type;
    if (t === 'paragraph' || t === 'p') {
      const txt = flattenText(c.text);
      if (!txt) continue;
      const lvl = headingLevel((c.format || {}).style);
      if (lvl > 0) {
        out.push(`${'#'.repeat(lvl)} ${txt}`);
        out.push('');
      } else {
        out.push(txt);
        out.push('');
      }
    } else if (t === 'table' || t === 'tbl') {
      const md = rowsToMarkdown(buildTableData(c).rows);
      if (md) { out.push(md); out.push(''); }
    } else if (t !== 'tr' && t !== 'tc' && c.children && c.children.length > 0) {
      walkWordBody(c, out);
    }
  }
}

// Word 本文を機械的に Markdown 化
function buildWordMarkdown(bodyNode, title) {
  const out = [];
  if (title) { out.push(`# ${title}`); out.push(''); }
  walkWordBody(bodyNode, out);
  if (out.length <= (title ? 2 : 0)) out.push('_(空の文書)_');
  return out.join('\n') + '\n';
}

// 図形・画像・チャートの有無を判定
function docHasGraphics(file) {
  const q = invokeOffice(['query', file, 'picture, shape, chart']);
  return !!(q && q.success && (q.data.results || []).length > 0);
}

// Word 文書のページ数を取得
function getWordPageCount(file) {
  const statsRes = invokeOffice(['view', file, 'stats']);
  if (statsRes && statsRes.success && statsRes.data) {
    const pages = parseInt(statsRes.data.pages, 10);
    if (pages > 0) return pages;
  }
  return 1;
}

// 図形/画像を含む Word ページを LM Studio で Markdown 化
async function convertWordPageToMarkdown(title, pageNum, bodyText, file, rel) {
  const ctx = [];
  ctx.push(`ページ番号: ${pageNum}`);
  ctx.push('');
  ctx.push('■ 本文テキスト(補助):');
  const clipped = bodyText.length > 4000 ? bodyText.substring(0, 4000) + '\n...(以下省略)' : bodyText;
  ctx.push(clipped || '(なし)');

  let pngPath = null;
  if (OPT.lmImage && file && pageNum) {
    pngPath = capturePng(file, pageNum);
  }
  const hasImage = !!pngPath;

  const { system, userPrompt } = buildReconstructPrompt('word', { hasImage, ctx: ctx.join('\n'), relPath: rel });
  const result = await invokeLMStudio(system, userPrompt, buildLmImageItems(pngPath));
  removeTemp(pngPath);

  const src = hasImage ? 'ページのPNG画像' : '本文テキスト';
  const head = `> ※LM Studio(${OPT.lmModel})が${src}から内容を再構成したものです。\n\n`;
  if (isNullOrWhiteSpace(result)) {
    return { md: `${head}## 本文(自動抽出 / ${LM_FALLBACK_MARKER})\n\n${clipped}`, ok: false };
  }
  return { md: head + result, ok: true };
}

// Word(.docx)を Markdown 化する
async function processWord(file, rel, destDir, stem, stat, failedPath) {
  const bodyRes = invokeOffice(['get', file, '/body', '--depth', '8']);
  if (!bodyRes || !bodyRes.success || !bodyRes.data) {
    const reason = bodyRes && bodyRes.error ? bodyRes.error.error : '応答なし';
    try { fs.appendFileSync(failedPath, `${rel}\t${reason}\n`, 'utf8'); } catch (_) { /* ignore */ }
    throw new Error(`ファイルを開けません: ${reason}`);
  }
  const bodyNode = (bodyRes.data.results || [])[0];
  if (!bodyNode) {
    try { fs.appendFileSync(failedPath, `${rel}\t本文を取得できません\n`, 'utf8'); } catch (_) { /* ignore */ }
    throw new Error('ファイルを開けません: 本文を取得できません');
  }

  const outMd = path.join(destDir, stem + '.md');
  const prep = prepareOutMdForConvert(outMd, stem, stat);
  if (!prep.proceed) {
    stat.files++;
    return;
  }

  safeMkdir(destDir);
  const title = stem;
  const mechanical = buildWordMarkdown(bodyNode, '');

  if (docHasGraphics(file)) {
    const pageCount = getWordPageCount(file);
    const sections = [];
    let aiOk = true;
    for (let p = 1; p <= pageCount; p++) {
      const res = await convertWordPageToMarkdown(`${title} - ページ${p}`, p, mechanical, file, rel);
      sections.push(`## ページ${p}\n\n${res.md}`);
      if (!res.ok) aiOk = false;
    }
    const md = `# ${title}\n\n${sections.join('\n\n')}\n`;
    // 文書単位: 1ページでも未応答なら成功扱いしない
    const fakeRes = { md, ok: aiOk };
    commitLmResult(outMd, fakeRes, {
      sourceRel: rel,
      kind: 'word',
      label: `図形/画像あり (${pageCount}ページ)`,
      stat,
      forceFallback: prep.forceFallback,
    });
  } else {
    const md = buildWordMarkdown(bodyNode, title);
    fs.writeFileSync(outMd, md, 'utf8');
    clearLmPending(outMd);
    stat.tableSheets++;
    writeLog('    -> [表MD] テキストのみ');
  }
  stat.files++;
}

// 非 Office ファイルを出力先へコピー
function copyPlainFile(file, destDir, fileName, stat) {
  const destFile = path.join(destDir, fileName);
  if (fs.existsSync(destFile)) {
    stat.skipped++;
    writeLog('    -> [スキップ] 既存');
    return;
  }
  safeMkdir(destDir);
  fs.copyFileSync(file, destFile);
  stat.copied++;
  writeLog('    -> [コピー]');
}

// PowerPoint(.pptx)をスライド毎に Markdown 化する
async function processPowerPoint(file, rel, destDir, stem, stat, failedPath) {
  // スライド枚数を取得(stats -> 失敗時は query slide の件数)
  let slideCount = 0;
  const statsRes = invokeOffice(['view', file, 'stats']);
  if (statsRes && statsRes.success && statsRes.data) {
    slideCount = parseInt(statsRes.data.slides, 10) || 0;
  }
  if (slideCount === 0) {
    const q = invokeOffice(['query', file, 'slide']);
    if (q && q.success && q.data) slideCount = (q.data.results || []).length;
  }
  if (slideCount === 0) {
    fs.appendFileSync(failedPath, `${rel}\tスライドを取得できません\n`, 'utf8');
    throw new Error('ファイルを開けません: スライドを取得できません');
  }

  // 各スライドの出力計画
  const plan = [];
  for (let i = 1; i <= slideCount; i++) {
    const sres = invokeOffice(['get', file, `/slide[${i}]`, '--depth', '8']);
    if (!sres || !sres.success || !sres.data) continue;
    const slideObj = (sres.data.results || [])[0];
    if (!slideObj) continue;
    const info = analyzeSlide(slideObj);
    if (info.isEmpty) continue;
    plan.push({ index: i, info });
  }

  if (plan.length === 0) {
    writeLog('    -> 出力なし(空ファイル)');
    stat.files++;
    return;
  }

  // 出力先: 単一なら直接、複数ならファイル名フォルダ配下(拡張子付き)
  const single = (plan.length === 1);
  const baseDir = single ? destDir : path.join(destDir, getSafeName(path.basename(file)));
  fs.mkdirSync(baseDir, { recursive: true });

  // 複数枚時は章扉(タイトルだけ)スライドをフォルダー化する
  const folderByNumber = new Map(); // 章番号 -> フォルダー絶対パス
  if (!single) {
    for (const p of plan) {
      p.chapter = parseChapterNumber(p.info.label);
      p.isDivider = isDividerSlide(p.info);
      p.excluded = p.isDivider && isExcludedPptFolder(p.info.label, path.dirname(rel).split(path.sep).join('/'));
    }
    // ラベル一致で除外した章番号(配下の章扉もまとめて除外するため)
    const excludedChapterNums = plan
      .filter((p) => p.isDivider && p.excluded && p.chapter)
      .map((p) => p.chapter.num);

    // (1) 章番号付きの章扉: 浅い階層から順に作成(親が先に登録されるようにする)
    const numbered = plan
      .filter((p) => p.isDivider && p.chapter)
      .sort((a, b) => a.chapter.segments.length - b.chapter.segments.length || a.index - b.index);
    for (const d of numbered) {
      const underExcluded = isChapterUnderExcluded(d.chapter, excludedChapterNums);
      if (d.excluded || underExcluded) {
        d.excluded = true;
        writeLog(`    -> [除外フォルダー] スライド${d.index} ${d.info.label}`);
        continue;
      }
      const parent = findFolderByNumber(folderByNumber, d.chapter, false) || baseDir;
      const folderName = toFileLabel(d.info.label, `スライド${d.index}`);
      d.folderPath = path.join(parent, folderName);
      fs.mkdirSync(d.folderPath, { recursive: true });
      folderByNumber.set(d.chapter.num, d.folderPath);
      stat.folders = (stat.folders || 0) + 1;
      writeLog(`    -> [フォルダー] スライド${d.index} ${folderName}`);
    }
    // (2) 章番号なしの章扉: スライド順に「直前の章番号付き章扉フォルダー」配下に作成する。
    //     連続しても親は変えない(同列=同じ親)。出現順維持のためスライド番号を先頭に付ける。
    let lastNumberedDir = baseDir;
    for (const p of plan) {
      if (!p.isDivider) continue;
      if (p.chapter) {
        if (!p.excluded) lastNumberedDir = p.folderPath || baseDir;
        continue;
      }
      if (p.excluded) {
        writeLog(`    -> [除外フォルダー] スライド${p.index} ${p.info.label}`);
        continue;
      }
      const folderName = `${String(p.index).padStart(2, '0')}_${toFileLabel(p.info.label, `スライド${p.index}`)}`;
      p.folderPath = path.join(lastNumberedDir, folderName);
      fs.mkdirSync(p.folderPath, { recursive: true });
      stat.folders = (stat.folders || 0) + 1;
      writeLog(`    -> [フォルダー] スライド${p.index} ${folderName}`);
    }
  }

  let curDir = baseDir; // 直前に作成した章扉フォルダー(内容スライドの出力先)
  // 除外中: 章番号文字列=その章配下をスキップ / true=次の章扉まで内容をスキップ
  let skipUntilOutside = null;
  for (const p of plan) {
    // 章扉スライドはファイルを出さずフォルダーのみ(上で作成済み)
    if (!single && p.isDivider) {
      // 番号付き除外の配下にいる間はスキップ継続。外に出たら解除。
      if (typeof skipUntilOutside === 'string') {
        if (p.chapter && (p.chapter.num === skipUntilOutside || p.chapter.num.startsWith(skipUntilOutside + '.'))) {
          continue;
        }
        skipUntilOutside = null;
      } else if (skipUntilOutside === true) {
        // 番号なし除外は次の章扉で解除
        skipUntilOutside = null;
      }

      if (p.excluded) {
        if (p.chapter) skipUntilOutside = p.chapter.num;
        else skipUntilOutside = true;
        // curDir は親のまま維持
        continue;
      }

      curDir = p.folderPath || curDir;
      continue;
    }

    // 除外中の内容スライドは出力しない
    if (skipUntilOutside !== null) {
      stat.skipped++;
      writeLog(`    -> [除外] スライド${p.index}`);
      continue;
    }

    const safeLabel = toFileLabel(p.info.label, `スライド${p.index}`);
    const baseName = single ? stem : `${String(p.index).padStart(2, '0')}_${safeLabel}`;
    // 内容スライドは直前に作成した章扉フォルダー配下へ。無ければ baseDir 直下。
    const outDir = single ? destDir : curDir;
    const outMd = path.join(outDir, baseName + '.md');
    const title = `${stem} - スライド${p.index}`;
    const label = `スライド${p.index}`;

    const prep = prepareOutMdForConvert(outMd, label, stat);
    if (!prep.proceed) continue;

    if (p.info.graphical) {
      const res = await convertSlideToMarkdown(title, p.index, p.info, file, rel);
      commitLmResult(outMd, res, {
        sourceRel: rel,
        kind: 'slide',
        label,
        stat,
        forceFallback: prep.forceFallback,
      });
    } else {
      const md = buildSlideMarkdown(title, p.info);
      fs.writeFileSync(outMd, md, 'utf8');
      clearLmPending(outMd);
      stat.tableSheets++;
      writeLog(`    -> [表MD] スライド${p.index}`);
    }
  }
  stat.files++;
}

// ---- ログ -----------------------------------------------------------------

let LOG_PATH = '';

function pad2(n) { return String(n).padStart(2, '0'); }

function nowHms() {
  const d = new Date();
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
}

function nowSortable() {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
}

function writeLog(msg) {
  const line = `[${nowHms()}] ${msg}`;
  console.log(line);
  if (LOG_PATH) {
    try { fs.appendFileSync(LOG_PATH, line + '\n', 'utf8'); } catch (_) { /* ignore */ }
  }
}

// ---- ファイル走査 ----------------------------------------------------------

// SourceRoot 配下を再帰的に走査して対象ファイルを返す(全ファイル対象)
function listFiles(root) {
  const result = [];
  // OS が自動生成するファイルは除外
  const excludeNames = new Set(['thumbs.db', 'desktop.ini', '.ds_store']);
  function walk(dir) {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
    catch (e) {
      writeLog(`!! フォルダーを読み取れずスキップ: ${dir} (${e.message})`);
      return;
    }
    for (const ent of entries) {
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        const relDir = path.relative(OPT.sourceRoot, full).split(path.sep).join('/');
        if (isExcludedFolder(relDir)) {
          writeLog(`    -> [除外フォルダー] ${relDir}`);
          continue;
        }
        walk(full);
      } else if (ent.isFile()) {
        // Office の一時ロックファイル(~$...)・OS 自動生成ファイルは除外
        if (ent.name.startsWith('~$')) continue;
        if (excludeNames.has(ent.name.toLowerCase())) continue;
        result.push(full);
      }
    }
  }
  walk(root);
  return result;
}

// ---- メイン ---------------------------------------------------------------

async function main() {
  safeMkdir(OPT.outputRoot);
  safeMkdir(OPT.logRoot);
  safeMkdir(OPT.workRoot);

  LOG_PATH = path.join(OPT.logRoot, '_disassemble_log.txt');
  if (!safeWriteFile(LOG_PATH, `[${nowSortable()}] 変換開始 Source=${OPT.sourceRoot} Model=${OPT.lmModel}${OPT.folder ? ` Folder=${OPT.folder}` : ''}${OPT.retryLmFail ? ' RetryLmFail=on' : ''}\n`)) {
    LOG_PATH = '';
    console.log('[警告] ログファイルに書き込めません。コンソールのみに出力します。');
  }

  OFFICECLI_LOG_PATH = path.join(OPT.logRoot, 'officecli_log.txt');
  if (!safeWriteFile(OFFICECLI_LOG_PATH, `[${nowSortable()}] officecli 呼び出しログ Source=${OPT.sourceRoot}\n`)) {
    OFFICECLI_LOG_PATH = '';
  }

  LM_PENDING_PATH = path.join(OPT.workRoot, LM_PENDING_FILE);
  LM_PENDING = loadLmPending(LM_PENDING_PATH);
  writeLog(`LM未応答 pending: ${Object.keys(LM_PENDING).length}件 (${LM_PENDING_PATH})`);
  if (OPT.retryLmFail) writeLog('フォールバック再変換: --retry-lm-fail 有効');

  writeLog(`LLM入力モード: ${OPT.lmImage ? `画像(PNG, width=${OPT.lmImageWidth}px) ※Vision対応モデルが必要` : 'テキストのみ'}`);
  writeLog(`officecli タイムアウト: ${OPT.officeTimeout}秒`);

  // プロンプト設定ファイルを読み込む(必須。失敗時は起動中止)
  try {
    PROMPT_CONFIG = loadPromptConfig(OPT.promptConfig);
    writeLog(`プロンプト設定 読込OK (${OPT.promptConfig}) セクション=${Object.keys(PROMPT_CONFIG.sections).length} 追加ルール=${PROMPT_CONFIG.rules.length}`);
  } catch (e) {
    writeLog(`!! 致命的: ${e.message}`);
    process.exit(1);
  }

  // 除外設定を読み込む(任意。無くても続行)
  EXCLUDE_CONFIG = loadExcludeConfig(OPT.excludeConfig);
  writeLog(`除外設定 読込 (${OPT.excludeConfig}) folder=${EXCLUDE_CONFIG.folders.length} sheet=${EXCLUDE_CONFIG.sheets.length} ppt-folder=${EXCLUDE_CONFIG.pptFolders.length}`);

  // 画像解釈の参考例を読み込む(任意。無くても致命的エラーにはしない)
  if (OPT.useExample) {
    try {
      EXAMPLE_TEXT = fs.readFileSync(OPT.exampleFile, 'utf8').trim();
      writeLog(`画像解釈の参考例 読込OK (${OPT.exampleFile})`);
      const parsed = parseExampleImages(EXAMPLE_TEXT, path.dirname(OPT.exampleFile));
      EXAMPLE_IMAGES = parsed.images;
      writeLog(`画像解釈の参考PNG 読込 ${EXAMPLE_IMAGES.length}件`);
      for (const name of parsed.missing) {
        writeLog(`!! 警告: 参考例が参照するPNGがありません: ${name}`);
      }
    } catch (e) {
      writeLog(`!! 警告: 参考例ファイルを読み込めません(画像解釈は参考例なしで続行): ${OPT.exampleFile} (${e.message})`);
      EXAMPLE_TEXT = '';
      EXAMPLE_IMAGES = [];
    }
  }

  // 起動前チェック: LM Studio 疎通
  try {
    const modelsUri = OPT.lmEndpoint.replace(/\/chat\/completions.*$/, '/models');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 6000);
    const resp = await fetch(modelsUri, { signal: controller.signal });
    clearTimeout(timer);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    writeLog(`LM Studio 疎通OK (${modelsUri})`);
  } catch (e) {
    writeLog(`!! 警告: LM Studio に接続できません (${e.message})。図形シートはフォールバック(図形テキスト羅列)で出力されます。`);
  }

  // 走査ルート決定(--folder 指定時)
  let scanRoot = OPT.sourceRoot;
  if (OPT.folder) {
    scanRoot = path.join(OPT.sourceRoot, OPT.folder);
    if (!fs.existsSync(scanRoot)) {
      writeLog(`!! 指定フォルダーが存在しません: ${OPT.folder}`);
      process.exit(1);
    }
    writeLog(`処理フォルダー: ${OPT.folder}`);
  }

  let files = listFiles(scanRoot);
  const failedPath = path.join(OPT.logRoot, '_failed_files.txt');
  RUN.failedPath = failedPath;
  if (!safeWriteFile(failedPath, '# 開けなかった(破損/暗号化等)ファイル一覧\n')) {
    RUN.failedPath = '';
  }

  if (OPT.filter) files = files.filter((f) => f.includes(OPT.filter));

  const stat = { files: 0, tableSheets: 0, aiSheets: 0, aiFallback: 0, aiPending: 0, aiRetry: 0, copied: 0, skipped: 0, errors: 0, folders: 0 };
  RUN.stat = stat;
  const total = files.length;
  let idx = 0;

  for (const file of files) {
    idx++;
    const rel = path.relative(OPT.sourceRoot, file).split(path.sep).join('/');
    RUN.currentFile = rel;
    const relDir = path.dirname(rel);
    const ext = path.extname(file).toLowerCase();
    const stem = path.basename(file, path.extname(file));
    const fileName = path.basename(file);
    const destDir = (relDir && relDir !== '.') ? path.join(OPT.outputRoot, relDir) : OPT.outputRoot;

    writeLog(`[${idx}/${total}] ${rel}`);

    try {
      // Microsoft Office 以外はそのままコピー
      if (!OFFICE_EXTS.has(ext)) {
        copyPlainFile(file, destDir, fileName, stat);
        continue;
      }

      // PowerPoint はスライド毎に Markdown 化
      if (ext === '.pptx') {
        await processPowerPoint(file, rel, destDir, stem, stat, failedPath);
        continue;
      }

      // Word は文書単位に Markdown 化
      if (ext === '.docx') {
        await processWord(file, rel, destDir, stem, stat, failedPath);
        continue;
      }

      // Excel(.xlsx)処理
      // シート一覧
      const sheetsRes = invokeOffice(['query', file, 'sheet']);
      if (!sheetsRes || !sheetsRes.success) {
        const reason = sheetsRes && sheetsRes.error ? sheetsRes.error.error : '応答なし';
        fs.appendFileSync(failedPath, `${rel}\t${reason}\n`, 'utf8');
        throw new Error(`ファイルを開けません: ${reason}`);
      }
      const allSheets = (sheetsRes.data.results || []).map((r) => String(r.path).replace(/^\//, ''));

      // 図形/画像/チャートを取得(結果オブジェクトも保持)
      const drawRes = invokeOffice(['query', file, 'shape, picture, chart']);
      const drawBySheet = new Map(); // sheet -> { shapes:[], pic:int, chart:int }
      if (drawRes && drawRes.success) {
        for (const r of (drawRes.data.results || [])) {
          const parts = String(r.path).split('/');
          if (parts.length < 2) continue;
          const sn = parts[1];
          if (!drawBySheet.has(sn)) drawBySheet.set(sn, { shapes: [], pic: 0, chart: 0 });
          const bucket = drawBySheet.get(sn);
          switch (r.type) {
            case 'shape': bucket.shapes.push(r); break;
            case 'picture': bucket.pic++; break;
            case 'chart': bucket.chart++; break;
            default: bucket.shapes.push(r); break;
          }
        }
      }

      // セルデータ(全シート分。図形シートの文脈・テキストシートの表に使用)
      const textData = invokeOffice(['view', file, 'text']);

      // シートオブジェクト取得ヘルパ
      const getSheetObj = (name) => {
        if (textData && textData.success && textData.data && textData.data.sheets) {
          return textData.data.sheets.find((s) => s.name === name) || null;
        }
        return null;
      };

      // 各シートの出力計画
      const plan = [];
      for (const s of allSheets) {
        if (isExcludedSheet(s, relDir)) {
          writeLog(`    -> [除外] ${s}`);
          continue;
        }
        const sObj = getSheetObj(s);
        if (drawBySheet.has(s)) {
          plan.push({ sheet: s, kind: 'ai', obj: sObj, draw: drawBySheet.get(s) });
        } else {
          let hasText = false;
          if (sObj && sObj.rows) {
            for (const row of sObj.rows) {
              for (const [, value] of cellEntries(row)) {
                if (!isNullOrEmpty(value)) { hasText = true; break; }
              }
              if (hasText) break;
            }
          }
          if (hasText) plan.push({ sheet: s, kind: 'table', obj: sObj });
        }
      }

      if (plan.length === 0) {
        writeLog('    -> 出力なし(空ファイル)');
        stat.files++;
        continue;
      }

      // 出力先: 単一なら直接、複数ならファイル名フォルダ配下(拡張子付き)
      const single = (plan.length === 1);
      const baseDir = single ? destDir : path.join(destDir, getSafeName(fileName));
      fs.mkdirSync(baseDir, { recursive: true });

      let n = 0;
      for (const p of plan) {
        n++;
        const safeSheet = getSafeName(p.sheet);
        const baseName = single ? stem : `${String(n).padStart(2, '0')}_${safeSheet}`;
        const outMd = path.join(baseDir, baseName + '.md');
        const title = `${stem} - ${p.sheet}`;

        const prep = prepareOutMdForConvert(outMd, p.sheet, stat);
        if (!prep.proceed) continue;

        if (p.kind === 'ai') {
          const sheetPage = allSheets.indexOf(p.sheet) + 1; // ワークブック内のシート順(1始まり)
          const res = await convertDrawingToMarkdown(title, p.sheet, p.draw.shapes, p.obj, p.draw.pic, p.draw.chart, file, sheetPage, rel);
          commitLmResult(outMd, res, {
            sourceRel: rel,
            kind: 'excel',
            label: p.sheet,
            stat,
            forceFallback: prep.forceFallback,
          });
        } else {
          const md = buildMarkdown(p.obj, title);
          fs.writeFileSync(outMd, md, 'utf8');
          clearLmPending(outMd);
          stat.tableSheets++;
          writeLog(`    -> [表MD] ${p.sheet}`);
        }
      }
      stat.files++;
      // 巨大 JSON 参照を解放(OOM 対策)
      drawBySheet.clear();
    } catch (e) {
      stat.errors++;
      writeLog(`    !! エラー: ${e.message}`);
    }
    RUN.currentFile = '';
  }

  writeLog(`完了: ファイル=${stat.files} 表MD=${stat.tableSheets} AI-MD=${stat.aiSheets} AI代替=${stat.aiFallback} LM未応答=${stat.aiPending} 再実行=${stat.aiRetry} フォルダー=${stat.folders} コピー=${stat.copied} スキップ=${stat.skipped} エラー=${stat.errors}`);
  writeLog(`LM未応答 pending残: ${Object.keys(LM_PENDING).length}件`);
  RUN.stat = null;
}

// CLI として直接実行された場合のみ本処理を起動する
// (テスト等で require したときは main を自動起動しない)
if (require.main === module) {
  main().catch((e) => {
    writeLog(`!! 致命的エラー: ${e.stack || e.message}`);
    process.exit(1);
  });
}

// テスト・再利用向けエクスポート(CLI 動作には影響しない)
module.exports = {
  parsePromptConfig,
  loadPromptConfig,
  parseRuleCond,
  buildReconstructPrompt,
  buildAdditionalPrompt,
  parseExampleImages,
  buildLmImageItems,
  isLmFallbackMd,
  LM_FALLBACK_MARKER,
  LM_MAX_ATTEMPTS,
  setPromptConfigForTest: (cfg) => { PROMPT_CONFIG = cfg; },
  setExampleImagesForTest: (imgs) => { EXAMPLE_IMAGES = imgs || []; },
};
