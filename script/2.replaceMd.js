#!/usr/bin/env node
/*
 * 2.replaceMd.js
 *
 * 指定フォルダー配下を再帰処理し、Markdown ファイルに対して
 * プログラム先頭で定義した複数の文字列置換ルールを適用する。
 * 元ファイルは変更せず、入力と同じフォルダー構成ですべてのファイルを出力する。
 *   - .md … 置換ルールを適用して書き出し
 *   - それ以外 … そのままコピー
 * 実行時は出力フォルダー内をいったん削除してから書き出す。
 *
 * EXAMPLE:
 *   node script/2.replaceMd.js ./1.disassemble
 *   node script/2.replaceMd.js --input-root ./1.disassemble
 *   node script/2.replaceMd.js --input-root ./1.disassemble --output-root ./2.replaceMd
 *
 * 要 Node.js 18 以上。
 */

'use strict';

const fs = require('fs');
const path = require('path');

// ---- 置換ルール（先頭で複数定義） ----------------------------------------
// from: 置換前文字列 / to: 置換後文字列
// 空の from はスキップ。配列の定義順に適用する（リテラル全置換）。
const REPLACEMENTS = [
  { from: 'トップクルーズ', to: 'オバートリップ' },
  { from: 'NTT東西', to: 'ABC南北' },
  { from: 'NTT東', to: 'ABC北' },
  { from: 'NTT西', to: 'ABC南' },
  { from: 'NTT', to: 'ABC' },
  { from: 'トッパンフォームズ', to: 'HHH印刷' },
  
];

// ---- 引数解析 -------------------------------------------------------------

function printUsage() {
  console.log('使い方:');
  console.log('  node script/2.replaceMd.js <対象フォルダー>');
  console.log('  node script/2.replaceMd.js --input-root <対象フォルダー>');
  console.log('  node script/2.replaceMd.js --input-root <対象フォルダー> --output-root <出力フォルダー>');
  console.log('');
  console.log('既定の出力先: <プロジェクトルート>/2.replaceMd');
  console.log('実行時は出力フォルダー内を削除してから処理します。');
  console.log('置換ルールはプログラム先頭の REPLACEMENTS 配列で定義してください。');
}

function parseArgs(argv) {
  const scriptDir = __dirname;
  const projectRoot = path.resolve(scriptDir, '..');
  const opts = {
    inputRoot: '',
    outputRoot: path.join(projectRoot, '2.replaceMd'),
  };

  const positional = [];
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    switch (a) {
      case '--input-root':
        opts.inputRoot = next() || '';
        break;
      case '--output-root':
        opts.outputRoot = next() || opts.outputRoot;
        break;
      case '-h':
      case '--help':
        opts.help = true;
        break;
      default:
        if (a.startsWith('-')) {
          console.error(`不明な引数: ${a}`);
        } else {
          positional.push(a);
        }
        break;
    }
  }

  if (!opts.inputRoot && positional.length > 0) {
    opts.inputRoot = positional[0];
  }

  return opts;
}

// ---- ヘルパー -------------------------------------------------------------

/** リテラル文字列の全出現を置換する（正規表現は使わない） */
function replaceAllLiteral(text, from, to) {
  if (!from) return text;
  return String(text).split(from).join(to);
}

/** REPLACEMENTS を順に適用する。戻り値: { text, changed } */
function applyReplacements(text) {
  let result = text;
  for (const rule of REPLACEMENTS) {
    if (!rule || rule.from == null) continue;
    const from = String(rule.from);
    if (from === '') continue;
    const to = rule.to == null ? '' : String(rule.to);
    result = replaceAllLiteral(result, from, to);
  }
  return { text: result, changed: result !== text };
}

/** ディレクトリを再帰的に作成 */
function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

/** 出力フォルダー内をすべて削除する（フォルダー自体は残す／無ければ作成） */
function clearOutputRoot(dir) {
  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  ensureDir(dir);
}

/**
 * 入力ルート配下を再帰走査し、相対パスを維持して出力する。
 * @returns {{ total: number, mdCount: number, changedCount: number, copyCount: number }}
 */
function processTree(inputRoot, outputRoot) {
  const stats = { total: 0, mdCount: 0, changedCount: 0, copyCount: 0 };

  function walk(absDir, relDir) {
    let entries;
    try {
      entries = fs.readdirSync(absDir, { withFileTypes: true });
    } catch (e) {
      console.error(`  !! 読み込み失敗: ${absDir} (${e.message})`);
      return;
    }

    // 空フォルダーも構成を合わせるため出力側に作成
    const outDir = relDir ? path.join(outputRoot, relDir) : outputRoot;
    ensureDir(outDir);

    for (const ent of entries) {
      const absPath = path.join(absDir, ent.name);
      const relPath = relDir ? path.join(relDir, ent.name) : ent.name;

      if (ent.isDirectory()) {
        walk(absPath, relPath);
        continue;
      }
      if (!ent.isFile()) continue;

      stats.total++;
      const outPath = path.join(outputRoot, relPath);
      ensureDir(path.dirname(outPath));

      const isMd = path.extname(ent.name).toLowerCase() === '.md';
      if (isMd) {
        stats.mdCount++;
        let src;
        try {
          src = fs.readFileSync(absPath, 'utf8');
        } catch (e) {
          console.error(`  !! 読込失敗: ${relPath} (${e.message})`);
          continue;
        }
        const { text, changed } = applyReplacements(src);
        try {
          fs.writeFileSync(outPath, text, 'utf8');
        } catch (e) {
          console.error(`  !! 書出失敗: ${relPath} (${e.message})`);
          continue;
        }
        if (changed) {
          stats.changedCount++;
          console.log(`  [置換] ${relPath}`);
        } else {
          console.log(`  [出力] ${relPath}`);
        }
      } else {
        stats.copyCount++;
        try {
          fs.copyFileSync(absPath, outPath);
          console.log(`  [コピー] ${relPath}`);
        } catch (e) {
          console.error(`  !! コピー失敗: ${relPath} (${e.message})`);
        }
      }
    }
  }

  walk(inputRoot, '');
  return stats;
}

// ---- main -----------------------------------------------------------------

function main() {
  const opts = parseArgs(process.argv);

  if (opts.help) {
    printUsage();
    process.exit(0);
  }

  if (!opts.inputRoot || !String(opts.inputRoot).trim()) {
    console.error('対象フォルダーが指定されていません。\n');
    printUsage();
    process.exit(1);
  }

  const inputRoot = path.resolve(opts.inputRoot);
  const outputRoot = path.resolve(opts.outputRoot);

  if (!fs.existsSync(inputRoot) || !fs.statSync(inputRoot).isDirectory()) {
    console.error(`対象フォルダーが見つかりません: ${inputRoot}`);
    process.exit(1);
  }

  console.log('==================================================');
  console.log('Markdown 文字列置換');
  console.log(`  入力: ${inputRoot}`);
  console.log(`  出力: ${outputRoot}`);
  console.log(`  置換ルール数: ${REPLACEMENTS.filter((r) => r && r.from != null && String(r.from) !== '').length}`);
  console.log('==================================================');

  console.log('出力フォルダーをクリアしています...');
  clearOutputRoot(outputRoot);
  const stats = processTree(inputRoot, outputRoot);

  console.log('');
  console.log('----- 完了 -----');
  console.log(`  処理ファイル数: ${stats.total}`);
  console.log(`  Markdown数: ${stats.mdCount}（うち置換あり: ${stats.changedCount}）`);
  console.log(`  コピー数: ${stats.copyCount}`);
  console.log(`  出力先: ${outputRoot}`);
}

main();
