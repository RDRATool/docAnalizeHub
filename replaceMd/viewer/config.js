/*
 * config.js — 辞書・分類ルールの外出し設定
 *
 * PLAN.md §6「リスクと対策」に従い、名称が変わりうるもの（システム名・アクター名）と
 * 目視調整が必要なもの（丸数字→フローグループ）はすべてここに集約する。
 * ブラウザでは window.RGConfig、Node では require() で参照される。
 */
(function (root, factory) {
  const mod = factory();
  root.RGConfig = mod;
  if (typeof module !== 'undefined' && module.exports) module.exports = mod;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  /* ---------------------------------------------------------------
   * 1. ドキュメント種別の判定ルール
   *    章番号（タイトル先頭）の完全一致 or 前方一致で kind / domain を決める。
   *    先に書いたものが優先。
   * ------------------------------------------------------------- */
  const DOC_RULES = [
    { chapter: '2.2.1', kind: 'flowIndex', domain: 'tpc' },
    { chapter: '2.2.2', kind: 'flowDetail', domain: 'tpc' },
    { chapter: '2.2.3', kind: 'funcList', domain: 'tpc' },
    { chapter: '2.2.4', kind: 'dataList', domain: 'tpc' },
    { chapter: '2.3.1', kind: 'flowIndex', domain: 'web' },
    { chapter: '2.3.2', kind: 'flowDetail', domain: 'web' },
    { chapter: '2.3.3', kind: 'funcList', domain: 'web' },
    { chapter: '2.3.4', kind: 'dataList', domain: 'web' },
    { chapter: '2.4.1', kind: 'authList', domain: 'tpc' },
    { chapter: '2.4.2', kind: 'authList', domain: 'web' },
    { chapter: '別.1.1', kind: 'diagram', domain: 'tpc' },
    { chapter: '別.3.1', kind: 'flowIndex', domain: 'cur' },
    { chapter: '別.3.2', kind: 'diagram', domain: 'cur' },
    { chapter: '別.3.3', kind: 'diagram', domain: 'cur' },
    { chapter: '別.3.4', kind: 'diagram', domain: 'cur' },
    { chapter: '別.3.5', kind: 'dataList', domain: 'cur' },
    { chapter: '別.3.6', kind: 'ifList', domain: 'cur' },
    { chapter: '2.1', kind: 'policy', domain: 'common' },
    { chapter: '2.5', kind: 'other', domain: 'common' },
    { chapter: '1.1', kind: 'policy', domain: 'common' },
    { chapter: '1.2', kind: 'policy', domain: 'common' },
  ];

  /* デッキ名 → 既定ドメイン（章ルールで決まらなかったときのフォールバック） */
  const DECK_DEFAULTS = [
    { match: '別.3', domain: 'cur', kind: 'flowDetail' },
    { match: '別.1', domain: 'tpc', kind: 'diagram' },
    { match: '2_業務要件', domain: 'tpc', kind: 'other' },
    { match: '1_新システム概要', domain: 'common', kind: 'policy' },
  ];

  const DOMAIN_LABELS = {
    tpc: 'オバートリップ（新）',
    web: '媒体Web化',
    cur: 'オバートリップ（現行）',
    common: '共通・全体',
  };

  const KIND_LABELS = {
    funcList: '新機能一覧',
    authList: '権限一覧',
    flowIndex: '業務フロー一覧',
    flowDetail: '業務フロー詳細',
    dataList: '取扱データ一覧',
    ifList: '他システムI/F一覧',
    diagram: '図',
    policy: '方針・概要',
    other: 'その他',
  };

  /* ---------------------------------------------------------------
   * 2. 丸数字 → 業務フローグループ（媒体Web化 2.3.3 の「新業務フロー該当箇所」列）
   *
   *    ★要目視調整★
   *    実データから確認できたものだけラベルを埋めてある。
   *    null のものは 2.3.2 のスライドに丸数字見出しが残っておらず未確定。
   *    判明したらここに書き足すだけでビューアの表示・リンクに反映される。
   * ------------------------------------------------------------- */
  const WEB_FLOW_GROUPS = {
    1: 'サービス申込',                    // 2.3.4 業務列より
    2: '顧客情報登録',                    // 2.3.4 業務列より
    3: 'システム利用準備',                // 2.3.2 slide142 見出しより
    4: '媒体作成・授受',                  // 2.3.2 slide124/133/143 本文より
    5: '明細利用',                        // 2.3.2 slide133/143 本文より
    6: null,
    7: null,
    8: '請求内訳コードの追加、変更',      // 2.3.2 slide146 見出しより
    9: null,
    10: null,
    11: null,
    12: null,
    13: 'ユーザアカウント管理',           // 2.3.2 slide152/153 見出しより
    14: 'システム運用作業',               // 2.3.2 slide155 本文より
    15: 'ログ管理、システム監査対応',     // 2.3.1 一覧 5-3 からの推定
    16: 'FAQ精査、登録、参照',            // 2.3.1 一覧 5-4 からの推定
  };

  /* ---------------------------------------------------------------
   * 3. システム名辞書
   *    業務フロー本文の「(...)」やシステム関連図の矢印から拾う。
   *    aliases に書いた表記はすべて name に正規化される。
   * ------------------------------------------------------------- */
  const SYSTEMS = [
    { name: 'オバートリップ', aliases: ['オバートリップ', 'TPC', 'オバートリップ/TPC', 'TPC/オバートリップ', 'オバートリップ(TPC)'] },
    { name: '次期ビリングONE', aliases: ['次期ビリングONE', 'ビリングONE', 'ABCファイナンス 次期ビリングONE'] },
    { name: '統合回線管理システム', aliases: ['統合回線管理システム', '統合回線管理'] },
    { name: '統合債権管理システム', aliases: ['統合債権管理システム', '統合債権'] },
    { name: 'リエンタ', aliases: ['リエンタ'] },
    { name: 'オーダー管理', aliases: ['オーダー管理'] },
    { name: 'HHH印刷', aliases: ['HHH印刷'] },
    { name: '経理ツール', aliases: ['経理ツール'] },
    { name: 'N-Active', aliases: ['N-Active', 'NActive'] },
    { name: '金融機関', aliases: ['金融機関', 'みずほ銀行'] },
    { name: '共通IDデータベース', aliases: ['共通IDデータベース', '共通ID DB'] },
    { name: '媒体変換装置', aliases: ['媒体変換装置', 'ABC印刷 媒体変換装置', '媒体変換ツール'] },
    { name: 'セキュアコネクト', aliases: ['セキュアコネクト'] },
    { name: 'ビリング管理ツール', aliases: ['ビリング管理ツール'] },
    { name: 'PRIME', aliases: ['PRIME'] },
    { name: 'CUSTOM', aliases: ['CUSTOM'] },
    { name: 'ACCEL', aliases: ['ACCEL'] },
    { name: 'N-LINCS', aliases: ['N-LINCS'] },
    { name: 'XION', aliases: ['XION'] },
    { name: '他システム', aliases: ['他システム'] },
    { name: 'キャリア', aliases: ['キャリア', '各キャリア'] },
  ];

  /* ---------------------------------------------------------------
   * 4. アクター（ロール）辞書
   *    ここに載っていない「(...)」も、システム辞書に該当しなければ
   *    アクター候補として拾う（辞書は表記ゆれの吸収が主目的）。
   * ------------------------------------------------------------- */
  const ACTORS = [
    { name: '顧客', aliases: ['顧客', 'お客様', 'お客さま'] },
    { name: 'CS担当', aliases: ['CS担当', 'SO統括/CS担当'] },
    { name: 'SO統括担当', aliases: ['SO統括担当', 'SO統括者'] },
    { name: 'AM', aliases: ['AM', '法人AM', 'ABC南北 法人AM', 'ABC南 日本法人AM'] },
    { name: 'TPC運用担当', aliases: ['TPC運用担当'] },
    { name: '運用担当', aliases: ['運用担当', '運用リーダ'] },
    { name: 'シス運', aliases: ['シス運', 'システム運用主管', 'ABCファイナンス システム運用主管'] },
    { name: '料金センタ', aliases: ['料金センタ', '料金', 'ABCファイナンス 料金センタ'] },
    { name: '運用主管', aliases: ['運用主管', 'ABC印刷 運用主管', 'ABCファイナンス 運用主管', '加古川', '東京'] },
    { name: '各SSC', aliases: ['各SSC', 'ABCファイナンス 各SSC', 'ABCファイナンス 埼玉SSC'] },
    { name: 'ビリング担当', aliases: ['ビリング担当'] },
    { name: 'ISS社', aliases: ['ISS社'] },
    { name: '保守', aliases: ['保守'] },
  ];

  /* 「(...)」で拾っても意味を持たないもの（アクター・システムどちらでもない） */
  const PAREN_NOISE = [
    '選択', '追加', '既存追加', '確定', '小計', '（小計）', '参照', '更新', '照会',
    '1_2', '2_2', '新', '現行', '旧', '案', '予定', '未定', '同上', '略',
  ];

  /* ---------------------------------------------------------------
   * 5. 表ヘッダの列名 → 論理カラム名
   *    デッキごとに列名が揺れるためエイリアスで吸収する。
   * ------------------------------------------------------------- */
  const COLUMN_ALIASES = {
    id: ['ID', 'Ｉ Ｄ', 'No.', 'No'],
    category: ['分類'],
    name: ['機能名'],
    funcType: ['機能区分', '機能 区分'],
    requirement: ['機能要件'],
    flowRef: ['新業務フロー該当箇所', '新業務フロー 該当箇所'],
    note: ['備考'],
    entity: ['エンティティ名', '帳票・ファイル等名称', '情報・帳票・ファイル等名称'],
    task: ['業務'],
    system: ['システム', '区分', '分類(詳細)'],
    desc: ['説明'],
    items: ['主なデータ項目'],
    linkSystem: ['連携システム'],
    linkInfo: ['連携情報'],
    direction: ['送受方向', '送受 方向'],
    cycle: ['接続周期'],
    method: ['方式'],
  };

  /* ---------------------------------------------------------------
   * 6. ノード種別・エッジ種別のメタ（色・ラベル）
   * ------------------------------------------------------------- */
  const NODE_TYPES = {
    doc: { label: 'ドキュメント', color: '#7f8ea3' },
    func: { label: '機能', color: '#3b82f6' },
    flow: { label: '業務フロー', color: '#10b981' },
    entity: { label: 'データ', color: '#f59e0b' },
    system: { label: 'システム', color: '#a855f7' },
    actor: { label: 'アクター', color: '#ef4444' },
    external: { label: '外部資料', color: '#64748b' },
    request: { label: '改善要望', color: '#ec4899' },
  };

  const EDGE_TYPES = {
    contains: { label: '記載', dash: '', weight: 1 },
    implements: { label: '該当フロー', dash: '', weight: 3 },
    uses: { label: 'フローで利用', dash: '', weight: 3 },
    authorizes: { label: '権限定義', dash: '4 3', weight: 2 },
    dataflow: { label: 'データ授受', dash: '', weight: 2 },
    performs: { label: '担当', dash: '2 3', weight: 1 },
    next: { label: '次スライド', dash: '1 4', weight: 0.3 },
    refers: { label: '言及', dash: '5 3', weight: 1 },
  };

  /* 既定で非表示にするエッジ種別。
     スライドの連番（next）は情報量が薄いわりに本数が多いので既定では隠す。 */
  const DEFAULT_HIDDEN_EDGES = ['next'];

  /* AI による画像再構成の注記（信頼度バッジの判定に使う） */
  const RECONSTRUCTED_MARK = 'PNG画像から内容を再構成';

  return {
    DOC_RULES,
    DECK_DEFAULTS,
    DOMAIN_LABELS,
    KIND_LABELS,
    WEB_FLOW_GROUPS,
    SYSTEMS,
    ACTORS,
    PAREN_NOISE,
    COLUMN_ALIASES,
    NODE_TYPES,
    EDGE_TYPES,
    DEFAULT_HIDDEN_EDGES,
    RECONSTRUCTED_MARK,
  };
});
