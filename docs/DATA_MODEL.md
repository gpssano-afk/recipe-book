# データモデル・永続化設計

状態：Phase 1AでRecipeと関連型、DB v1、レシピCRUD・meta計数を実装。Phase 1Bの画像・定番を実装し、DB v1を維持。Phase 1Cのバックアップv1・全件置換復元・容量管理を実装。履歴操作・将来移行は未実装。[機能仕様](PRODUCT_SPEC.md) / [構成](ARCHITECTURE.md) / [テスト](TEST_PLAN.md)

## 1. 型と不変条件

以下は実装の設計例。TypeScriptの型だけでは外部入力を検証できないため、同じ制約をランタイムvalidatorで検査する。文字数・数値・画像の個別上限は[PRODUCT_SPEC](PRODUCT_SPEC.md)を正本とする。

```typescript
type Id = string; // crypto.randomUUID() によるUUID v4
type Instant = string; // UTC、YYYY-MM-DDTHH:mm:ss.sssZ
type LocalDate = string; // 実在するYYYY-MM-DD
type Category = 'main' | 'side' | 'soup' | 'staple' | 'dessert' | 'other';

interface Ingredient {
  name: string;
  amount: string;
}

interface Recipe {
  id: Id;
  title: string;
  category: Category;
  ingredients: Ingredient[];
  servings: number | null;
  steps: string[];
  cookingMinutes: number | null;
  memo: string;
  tags: string[];
  sourceUrl: string | null;
  isFavorite: boolean;
  imageIds: Id[]; // 表示順、最大6、重複不可
  coverImageId: Id | null; // imageIds内の料理写真のみ
  createdAt: Instant;
  updatedAt: Instant;
  revision: number; // 初回1、レシピ変更ごとに+1
}

interface ImageAsset {
  id: Id;
  recipeId: Id;
  kind: 'dish' | 'screenshot';
  mime: 'image/jpeg' | 'image/png' | 'image/webp';
  width: number;
  height: number;
  byteLength: number;
  blob: Blob; // 圧縮済み本体。元ファイルではない
  thumbnail: {
    mime: 'image/jpeg';
    width: number;
    height: number;
    byteLength: number;
    blob: Blob;
  } | null; // dishでは必須、screenshotではnull
  createdAt: Instant;
}

interface MealDecision {
  id: Id; // 「これに決定」の操作IDを兼用
  recipeId: Id;
  recipeTitleSnapshot: string;
  categorySnapshot: Category;
  decidedAt: Instant;
}

interface CookingLog {
  id: Id; // 作成操作IDを兼用
  recipeId: Id;
  decisionId: Id | null;
  cookedOn: LocalDate;
  memo: string;
  createdAt: Instant;
  updatedAt: Instant;
  revision: number;
}

interface Meta {
  key: 'state';
  dataRevision: number; // 全ユーザーデータ変更で+1
  lastChangedAt: Instant | null;
  lastExportRequestedAt: Instant | null;
  lastExportRevision: number | null;
  lossNoticeAcknowledged: boolean;
  mediaBytes: number; // 本体+サムネイル
  metadataBytes: number; // 下記のバックアップ非画像部分
}
```

`main=主菜`、`side=副菜`、`soup=汁物`、`staple=主食`、`dessert=デザート`、`other=その他`。型の名前やenumの永続値を表示文言の都合で変更しない。

IDは一度生成したら編集・バックアップ・復元で維持する。コピー機能は初期版にはない。タグは別storeにせず、全Recipeから候補一覧を導出する。材料行・手順行は配列順でよく、永続行IDは作らない。

参照は以下を必ず満たす。

- 全画像の `recipeId` が存在し、そのRecipeの `imageIds` にちょうど1回含まれる。画像の共有・孤児画像は許可しない。
- `coverImageId` は同じレシピの `kind=dish` の画像を指すか、料理写真がなければnull。
- 履歴の `recipeId` は存在する。`decisionId` があれば同じ料理の決定を指す。1つの決定を参照する調理履歴は最大1件。
- `revision` は1以上の安全な整数。日時は厳密なUTC形式で、更新日時は登録日時以上。通常更新では `max(現在時刻, 直前updatedAt)` を用い、時計が戻ってもrevisionで競合を検出する。
- 履歴の集計値（最終調理日・回数）は保存しない。調理履歴から導出して二重管理を避ける。

## 2. IndexedDBの物理構造

DB名は `sano-recipe-book`、初期 `DB_VERSION=1`。同じオリジン上の別アプリと衝突させない固定名にする。GitHub Pagesのパス単位でIndexedDBが隔離されるわけではない。

| Store | keyPath | index | 用途 |
| --- | --- | --- | --- |
| recipes | id | category、updatedAt | 一覧・更新。初期版は最大1,000件のテキスト検索をメモリ内で行う |
| images | id | recipeId | 圧縮画像とサムネイルのBlob |
| mealDecisions | id | recipeId、decidedAt | 決定履歴 |
| cookingLogs | id | recipeId、cookedOn、decisionId（unique） | 調理履歴、重複紐付け防止 |
| meta | key | なし | 計数・バックアップ案内・更新世代 |

IndexedDBのbooleanはindexキーに使わないため、お気に入りindexは作らない。`decisionId=null` は有効なindexキーではないためindexに入らず、複数の手動履歴を許可できる。validatorでも同じ整合性を検証する。履歴・画像は必要なindexで読み、一覧で画像storeを全件ロードしない。

Phase 1から上の5storeを作り、Phase 2までは2種類の履歴配列が空の状態とする。これによりPhase 2追加時の構造変更を避ける。DB構造を変えず意味を変える場合でも、移行の要否とバックアップ互換性を検討する。

## 3. 保存・削除・競合

アプリ内のDB操作はrepositoryモジュールへ集約し、画面から直接storeを書き換えない。

1. フォーム検証、画像圧縮、Blob変換、容量計算をトランザクション外で済ませる。
2. 操作開始時に読んだ `meta.dataRevision` とレシピ/履歴revisionを保持する。
3. 対象storeとmetaのreadwriteトランザクションを開き、最新revisionと上限を再検査する。不一致なら競合エラーで中断する。
4. 書き込み、関連削除、容量計数更新、`dataRevision+1` を同じトランザクションで行う。
5. `transaction.done` 完了後にUIとメモリ内一覧を更新し、他タブへ変更通知する。

メタデータ容量計算用の整合したスナップショットはreadonlyトランザクションで取得する。その後の検証で時間がかかっても、手順3の世代照合で古いスナップショットからの書き込みを防ぐ。差分計算は純粋関数とし、必要な時だけ全件再計算する。画像全体のbase64化を通常保存のたびに実施しない。

複数タブは利用想定の中心ではないが、放置タブで上書きしない。`BroadcastChannel`（非対応時はフォーカス復帰時のmeta照合）で一覧を再取得し、編集中なら「別画面で更新されました」を表示。競合時は入力を残し、利用者が再読み込み・再編集を選ぶ。自動マージしない。

レシピ削除はrecipes/images/mealDecisions/cookingLogs/metaを1トランザクションで処理する。決定履歴取消は決定の削除と関連調理履歴の `decisionId=null` を同時実行する。調理履歴削除はレシピの `updatedAt` を変えず、metaのみ更新する。画像変更は新Blobの準備後に旧画像との置換を行い、処理途中に旧画像を削除しない。

同一操作の再送でUUIDが既存の場合は、同じ入力なら既存成功として返し、別入力なら競合として拒否する。新規登録・決定・履歴登録で二重作成を防ぐ。編集の応答不明時はDBのrevision・内容を再読して確認する。

QuotaExceededError、AbortError、接続切断などではトランザクションをabortし、成功表示しない。DBを開けない場合にメモリだけの擬似保存へ切り替えない。`versionchange` では接続を閉じ、更新のための再読み込みを促す。upgradeの `blocked` は他のタブを閉じる案内を表示する。

## 4. 容量の契約

MiB=1,048,576bytes、KiB=1,024bytes。以下はブラウザの保証容量ではなく、低メモリ端末でもバックアップしやすくする**アプリ独自の採用初期案**。実機での適正値は未確認。

| 対象 | 上限 |
| --- | --- |
| レシピ | 1,000件 |
| 画像レコード | 1レシピ6件、全体最大6,000件 |
| 決定履歴・調理履歴 | それぞれ20,000件 |
| 全画像本体＋サムネイルのバイト合計 | 40MiB |
| バックアップの非画像部分 | 8MiB |
| インポートするJSONファイル | 64MiB |

「非画像部分」は後述のバックアップオブジェクトで各 `base64` を空文字へ置換して `JSON.stringify` したUTF-8バイト数（画像の寸法等・履歴・JSON構造を含む）。生成日時の長さは固定とする。メタ情報metaはバックアップに含めない。画像のbase64長は各Blobについて `4 * ceil(byteLength / 3)` と計算できる。

全体上限は、非画像部分 + 本体/サムネイルすべてのbase64長が64MiB以下であることも検証する。件数・媒体・非画像部分・全体のいずれかを超える変更は保存前に拒否し、既存データを残す。この契約により、アプリに保存できた状態を同じ版のインポーターがサイズ超過で拒否することを防ぐ。閾値付近は画面に案内する。

ブラウザの `navigator.storage.estimate()` はオリジン全体の概算で、成功可否の保証ではない。アプリ計数を下回っていても実際のトランザクションは容量不足になりうる。データを自動で間引かない。履歴上限では履歴一覧から個別削除できる。画像削除や縮小で容量を減らす操作は上限付近でも可能にする。

## 5. バックアップ形式v1

ファイル名：`sano-gohan-backup-YYYYMMDD-HHmmss.json`（UTC）、MIME `application/json`、UTF-8、暗号化・ZIPなし。base64にはData URLの接頭辞や改行を含めない。Base64は暗号化ではない。ファイルを公開リポジトリへ入れないよう案内する。

```typescript
interface BackupBinary {
  mime: 'image/jpeg' | 'image/png' | 'image/webp';
  width: number;
  height: number;
  byteLength: number;
  base64: string;
}

interface BackupImage {
  id: Id;
  recipeId: Id;
  kind: 'dish' | 'screenshot';
  createdAt: Instant;
  original: BackupBinary; // 圧縮済み保存本体という意味。入力原本ではない
  thumbnail: BackupBinary | null;
}

interface BackupV1 {
  format: 'sano-gohan-backup';
  formatVersion: 1;
  exportedAt: Instant;
  recipes: Recipe[];
  images: BackupImage[];
  mealDecisions: MealDecision[];
  cookingLogs: CookingLog[];
}
```

DB_VERSIONはファイルに保存しない。バックアップ形式は内部DB構造から独立させる。v1のプロパティはすべて必須で、未知のキーは誤形式として拒否する。後方互換性は将来版の変換処理で明示的に扱う。空DBのバックアップは4配列が空。

### エクスポート

全データstoreとmetaを同じreadonlyトランザクションで読み、整合したスナップショットと世代番号を確保する。取得完了後、画像を順次base64へ変換し、バイト上限を確認してファイルを生成する。生成中の通常編集はUIで抑止するが、他タブの更新があっても出力は取得時点のデータとして有効。

ユーザー操作のダウンロードリンク（Blob URL）を使用する。生成完了・ダウンロード要求後、metaの `lastExportRequestedAt` と `lastExportRevision` を記録する。取得した世代番号を記録するため、その間の別タブ更新までバックアップ済みと誤認しない。ブラウザは保存先での書き込み完了を確実には通知しないので、UIは「書き出しを開始しました。ファイルを確認してください」と表示する。Object URLは利用終了後に解放する。

### インポート検証（DB変更前）

1. File.sizeが64MiB以下かを読み込み前に確認。拡張子・MIMEだけで正当性を判断しない。
2. UTF-8として厳密に復号し、標準 `JSON.parse` で構文解析する。解析結果を反復走査し、深さ20超、危険なキー（`__proto__` / `prototype` / `constructor`）を拒否する。独自JSONパーサーは作らない。同名プロパティは標準パーサーに従い最後の値となり、その結果全体を検証する（出力側は重複を生成しない）。
3. format/version、厳密なキー、型、enum、整数、日時、文字数、配列件数、ユニークIDを検証する。未来formatVersionは「新しいアプリが必要」として拒否する。
4. URL・タグ・材料等に共通入力契約を適用する。欠損値を黙って補完したり、不正行だけ捨てたりしない。復元時に過去の登録日時を現在日時へ書き換えない。
5. 参照整合性と全体容量を検証する。端末時計が戻って調理日が今日より未来に見える場合は日時設定の確認を促して拒否する。レシピ登録日時等の未来値は厳密な形式と前後関係だけ検査し、端末時計差で拒否しない。
6. base64の文字・padding・長さ、宣言バイト数、画像のマジックバイト・MIME・寸法・画素上限を確認する。画像を1枚ずつ復号して実際の寸法と照合し、料理写真・サムネイル・スクリーンショットそれぞれの保存後上限も検査する。復号不可能、アニメーション、SVG等は拒否する。通常の画像選択にも同じヘッダ検査を使い、PNGのacTLやWebPのアニメーションフラグを含むものは静止画として受け付けない。
7. 画像Blobを準備し、現在/復元後の件数と復元元日時をプレビューする。1件でも不正なら全体を拒否し、項目の位置と理由のみ表示する。

受信オブジェクトをそのままdeep mergeせず、許可したキーだけで新しい型のオブジェクトを組み立てる。復元する画像は上記検証を通ったバイト列をBlobに戻し、再圧縮しない。これにより同じ版での往復に画質劣化や容量増加を起こさない。メタデータの除去は通常の画像追加時に行う。外部で編集されたバックアップに付随メタデータがある可能性はあるため、信頼できる自分のバックアップを選ぶよう案内し、アプリから画像を外部送信しない。

### 確認・全件置換

利用者が上書きを確認した後、recipes/images/mealDecisions/cookingLogs/metaの単一readwriteトランザクションを開始する。プレビュー時の `dataRevision` と同じか検証し、変わっていれば再プレビュー・再確認する。各データstoreをclearして検証済み全件をput、metaを再計算して書き込む。`dataRevision` は現在値+1、最終出力記録はnullとする。

全件putの前後に画像デコードやファイル読込などの非IDB非同期処理を挟まない。commit完了までは成功扱いにしない。例外・容量不足・アプリ終了による中断は全体rollbackとなり、旧データが残る。トランザクション完了直後にアプリが終了した場合は新データ全体が残る。部分的な新旧混在を認めない。復元成功後は全画面のデータを読み直す。

検証・確認中はキャンセル可能でDB不変。書き込み開始後はキャンセルボタンを出さず、短い処理中表示を出す。アプリを閉じないよう表示するが、閉じても上記原子性で保護する。JSON/base64にはメモリ増幅があるため、64MiB付近の実機試験を公開条件とする。大容量ZIP/ストリーム対応は将来の形式v2で検討する。

## 6. スキーマ更新と将来の移行

- DB_VERSIONを上げたときだけ、`oldVersion` に応じた順番でupgrade処理を行う。v1→v2→v3等を飛び越える利用者も同じ結果になるようにする。
- upgradeトランザクション内はIDB処理のみ。画像再圧縮など重い移行は別途計画し、移行途中の状態をアプリへ公開しない。
- 各旧版の匿名fixtureで件数・ID・画像・履歴を確認し、途中失敗時は旧DBを保持する。失敗時に `deleteDatabase` でリセットしない。
- 新DBを古いアプリが開いてVersionErrorとなった場合は更新を案内し、古い形式への書き戻しや自動ダウングレードをしない。
- 将来版は過去のバックアップv1をメモリ上で新形式へ変換・検証して復元できるよう維持する。新形式を旧アプリへ読み込ませることは保証しない。
- 移行を伴う更新は事前バックアップを案内する。旧Service Worker・別タブが開いたままのケースをリリース前に試す。

端末のブラウザデータ削除・故障・ブラウザ側の消去はトランザクションでも防げない。オリジン（ドメイン/プロトコル/ポート）が変わる移転ではDBが引き継がれないため、旧URLで出力し新URLで復元する手順を公開前に用意する。
