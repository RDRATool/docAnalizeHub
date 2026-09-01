# ED_T_メニュー管理TBL - テーブル仕様

> ※このシートは図形で構成されているため、LM Studio(google/gemma-4-31b-qat)が図形シートのPNG画像から内容を再構成したものです。

# メニュー管理TBL (TS037_MENU)

- システム名: PCコム次期ビリング
- サブシステム名: オバートリップ
- 概要: メニュー表示内容を設定するテーブル
- Mantis ID: 3168

## テーブル定義

| 項番 | フィールド名 (論理項目名) | フィールドID (物理項目名) | NOT NULL | データ型 | 桁数 | 既定値 | PK | キー項目 | 説明 |
| :--- | :--- | :--- | :---: | :--- | :---: | :---: | :---: | :---: | :--- |
| 1 | サービス提供会社コード | TS037_SRV_COM_CD | ○ | Character | 2 | | ○ | | オバートリップ提供会社（コード表参照） |
| 2 | ユーザー識別 | TS037_ID_CLASS | ○ | Character | 2 | | ○ | | 社外用（お客様）/社内用（社員／アライアンス）のログイン識別 　１０：社内用 　２０：社外用 　９０：運用 |
| 3 | 連番 | TS037_TREE_NO | ○ | smallint | 4 | | ○ | | メニューごとに付与する番号 |
| 4 | 親階層№ | TS037_P_TREE_NO | | smallint | 4 | | | | 親になるメニューの連番 |
| 5 | 階層 | TS037_MENU_TYPE | ○ | smallint | 1 | | | | 1：メニューアイテム/2：メニューノード |
| 6 | 並び順 | TS037_SORT_ORDER | ○ | smallint | 4 | | | | 全体を通した並び順（＝連番（TS037_TREE_NO）） |
| 7 | プログラムリンク | TS037_PG_LINK | | character varying | 1000 | | | | 呼び出すプログラム名、呼び出すリンクURL |
| 8 | リンクパラメータ | TS037_LINK_PARAMETER | | character varying | 100 | | | | プログラムに渡すパラメータ |
| 9 | HTMLリンク | TS037_HTML_LINK | | character varying | 10 | | | | プログラム起動時のtarget属性 |
| 10 | メニューアイコン | TS037_ICON_IMAGE | | character varying | 40 | | | | 画面に表示するメニューのアイコン |
| 11 | メニュー名（通常） | TS037_MENU_NAME | ○ | character varying | 40 | | | | ■メニュー名（承認権限あり時）が空の場合：メニュー名（通常）<br>■メニュー名（承認権限あり時）が空以外、かつセキュリティTBL．承認権限・セキュリティTBL．仮承認権限のどちらかがありの場合：メニュー名（承認権限あり時）<br>■それ以外：メニュー名（通常） |
| 12 | メニュー名（承認権限あり時） | TS037_MENU_NAME_SHOHIN | | character varying | 40 | | | | |
| 13 | 請求参照権限制限有無 | TS037_AUTH_B_VIEW_KBN | ○ | character varying | 1 | | | | ０：制限無し（表示） １：セキュリティTBL．請求参照権限が”１：あり”の場合のみ表示 |
| 14 | 通話参照権限制限有無 | TS037_AUTH_T_VIEW_KBN | ○ | character varying | 1 | | | | ０：制限無し（表示） １：セキュリティTBL．通話参照権限が”１：あり”の場合のみ表示 |
| 15 | 更新権限制限有無 | TS037_AUTH_UPD_KBN | ○ | character varying | 1 | | | | ０：制限無し（表示） １：セキュリティTBL．更新権限が”１：あり”の場合のみ表示 |
| 16 | 管理権限制限有無 | TS037_AUTH_MNG_KBN | ○ | character varying | 1 | | | | |