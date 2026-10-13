# 技術構成・公開・外部取り込み設計

状態：Phase 1A・1B・1Cを実装。画像はCanvas/Blob/createImageBitmapで処理し、追加依存はなし。本文は初期版全体の設計で、PWA/公開/外部検索等は未実装。採用した具体バージョン・hashルーターの実装は[DECISIONS D13](DECISIONS.md#d13-phase-1aのライブラリとhashルーティング)を参照。[機能仕様](PRODUCT_SPEC.md) / [データモデル](DATA_MODEL.md) / [判断記録](DECISIONS.md)

## 1. 技術構成

指定のReact + TypeScript + Vite、GitHub Pages、IndexedDB、PWAを維持する。技術方針の変更は不要。初期版の実行環境はHTTPS上のAndroid Chromeで、1台のブラウザプロファイルを使う。

| 領域 | 採用初期案 | 理由・代替 |
| --- | --- | --- |
| UI | React、TypeScript strict、通常のCSS/CSS Modules | 大型UIフレームワークやCSSユーティリティ基盤を必須にしない |
| ビルド | Vite、npm、対応するNode.js LTS | 実装時に互換バージョンを確認しlockfileで固定する |
| 画面遷移 | React RouterのHashRouter | Pagesで各詳細URLの再読込にサーバーrewriteが不要 |
| 状態 | hooks + 必要最小限のContext | Redux等は初期版には不要 |
| IndexedDB | `idb` の薄いPromiseラッパー | 生APIのイベント処理を減らす。Dexieの高度な購読機能は現規模では不要 |
| 入力検証 | 小さな手書きvalidatorと型ガード | フォームとバックアップで共通化。独自汎用スキーマエンジンは作らない |
| 画像 | ブラウザのCanvas、Blob、createImageBitmap等 | ネイティブ機能で端末内圧縮。画像ヘッダ判定は対応3形式に限定 |
| PWA | `vite-plugin-pwa`、WorkboxのgenerateSW | 更新確認型でapp shellをprecacheする |
| テスト | Vitest、Testing Library、fake-indexeddb、Playwright | ブラウザ依存事項は実ブラウザとAndroid実機で補う |
| バックアップ | JSON + base64、標準API | ZIP依存を増やさず版管理と検証を単純化。大容量は将来検討 |

この表は将来の依存候補であり、今回インストールしない。バージョン番号・Node.jsの具体的なLTS版・各ライブラリのライセンス再確認はPhase 1着手時の作業。最小の構成から始め、依存の変更理由をDECISIONSに記録する。

## 2. ディレクトリと責務

以下は基本配置。PWA用素材や履歴機能など、将来の配置も含む。

```text
src/
  app/                 ルート、共通レイアウト、DB準備状態
  pages/               8画面の組み立て
  components/          RecipeCard、RecipeForm、ImagePicker、ConfirmDialog等
  domain/              型、validator、検索、ルーレット、日付処理
  data/                IndexedDB定義、移行、repository、保存エラー変換
  services/            画像処理、バックアップ、容量見積り
  hooks/               画面用の読込・保存・未保存変更確認
  styles/              色、余白、共通CSS
public/                自作アイコン、manifest用画像
tests/                 unit、integration、e2e、架空fixture
docs/                  設計の正本
```

画面ごとに同じフォーム・カードを作らない。レシピ一覧/定番/保存済み検索で同じ一覧部品を共有し、お気に入り固定条件だけを渡す。汎用Repositoryインターフェースやクラス階層は作らず、必要な関数を公開する。

主な境界関数の契約：

| 関数例 | 契約 |
| --- | --- |
| `saveRecipe(draft, expectedRevision, operationId)` | 検証済み入力と画像を原子的に保存。成功時Recipe、失敗時分類済みエラー |
| `deleteRecipe(id, expectedRevision)` | 関連画像・履歴も含む削除 |
| `searchRecipes(recipes, query)` | ネットワーク/DBに依存しない純粋な検索 |
| `chooseRecipe(candidates, lastDecisionId, currentId, random)` | 候補0/1件と再抽選を扱い、選択または候補なしを返す |
| `recordDecision` / `saveCookingLog` | 操作ID・参照・revision検証と履歴保存 |
| `prepareImages(files)` | DBへ書かず、圧縮結果とプレビュー/検証結果を返す |
| `exportBackup` / `validateBackup` / `restoreBackup` | 読込・検証・書込を分離。検証だけではDB変更なし |

```text
利用者操作 → 画面/hooks → 入力検証・純粋な業務処理
                         ↓
                 repository → IndexedDB
                         ↓ commit完了
                 一覧を更新 → 成功表示

画像選択 → 上限検査 → ローカル圧縮 → フォームで確認 → 一括保存
復元ファイル → 全件検証 → 利用者の確認 → 一括置換 → 再読み込み
Web検索 → 利用者が押した外部リンク → 外部ブラウザ
```

外部ブラウザからアプリへ自動データ転送しない。画面からのURL fetchは初期版に存在しない。

## 3. PWA・オフライン

### 配信物とキャッシュ

- app shell（HTML、JS、CSS、アイコン、同梱の静的素材）だけをprecacheする。CDN配信の実行時依存・外部フォントを避ける。
- レシピ・画像はIndexedDBが正本。Service WorkerのCache Storageへ二重保存しない。外部レシピページ/検索結果/画像をキャッシュしない。
- 未訪問の詳細ルートでもhashは同じHTMLを使うため、app shell導入済みならオフラインで起動できる。コード分割する場合は初期版で必要な全chunkをprecache対象とし、未キャッシュ画面を作らない。
- 初回キャッシュ完了・SW制御の確認後に「オフラインで使えます」を表示する。初回通信失敗は再試行を案内する。
- キャッシュ名はアプリ固有の接頭辞を付ける。他のPagesアプリのキャッシュを一括削除しない。

### インストール・更新

manifestは日本語名「佐野家のごはん」、short_name「佐野家ごはん」、`display: standalone`、自作192/512pxとmaskableアイコン、theme/background色を設定する。標準のリポジトリ公開では `id` / `start_url` / `scope` を `/recipe-book/` に合わせ、Service Workerも同範囲に置く。

ブラウザがインストール条件を満たす場合に操作を案内する。自動プロンプト表示やメニュー文言は環境で異なるため保証しない。通常のブラウザタブでも機能を利用できる。

新しいSWは待機させ、「新しい版があります。保存を終えて更新」の操作で有効化する。編集中・復元中・出力中の自動リロードは行わない。採用初期案は更新確認型（prompt）で、無条件のautoUpdate/skipWaitingは使わない。他タブがある場合は保存して閉じる案内を行い、DBのversionchange/blockedも処理する。

SWファイル更新だけでIndexedDBを消さない。配信のロールバックとDBのダウングレードは別問題。新DBを読めない旧版へ戻すときは、互換版を配信するか前進修正する。復元を伴う変更の前にはバックアップを案内する。

## 4. GitHub Pages公開

想定リポジトリは `gpssano-afk/recipe-book`、標準URL案は `https://gpssano-afk.github.io/recipe-book/`。これは**未公開の想定URL**であり、Pages設定とプランの確認は未実施。リポジトリは前回確認時にpublicだったが、公開時に再確認する。

Viteの `base` は `/recipe-book/`、アセット参照は `import.meta.env.BASE_URL` またはビルド済みimportを使用する。ルート絶対パス `/assets/...` を手書きしない。カスタムドメインへ変える場合はbase/manifest/SW scopeとデータ移転を同時に見直す。

Phase 4でGitHub Actionsによる次の構成を実装する予定：

1. PRでは `npm ci` → 型検査 → lint →単体/結合テスト → build。E2Eも公開条件として実施する。PRから本番配信しない。
2. レビュー後のmain更新または承認済み手動実行で同じ検証を行い、`dist` をPages artifactとしてアップロードする。
3. deploy jobだけに `pages: write` / `id-token: write`、通常jobに `contents: read` を付与し、Pages environmentへデプロイする。
4. 競合する公開をconcurrencyで抑止。Actionsは互換性を確認してバージョン固定し、更新時に検証する。
5. 実URLでサブパスのアセット、詳細URL再読込、manifest、SW scope、オフライン起動を確認する。

今回Actionsファイル・アプリ・公開設定は作成/変更しない。GitHubの無料枠・Pages利用条件を公開前に確認し、課金設定を追加しない。家庭のバックアップや画像をビルド成果物へ含めず、テスト用サンプルも架空のものだけを使う。

同一オリジンの他のPagesアプリとはブラウザストレージの隔離境界を共有する。privateな家庭データは端末内にのみあり、公開アプリに認証はない。共有端末で同じブラウザプロファイルを使う人からの保護は行わない。

## 5. セキュリティ境界

入力は文字列として表示し、HTMLレンダリング、インラインイベント、動的スクリプトを使わない。外部URLの検証とファイルの検証は[DATA_MODEL](DATA_MODEL.md)に従う。ブラウザ内に秘密のAPIキーを置かない。

初期版はAPI通信不要のため、配信時CSPは原則 `default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' blob:; connect-src 'self'; worker-src 'self'; manifest-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'` を候補とする。GitHub Pagesで独自レスポンスヘッダを設定できない前提ではHTML metaの利用可能範囲を確認する。`frame-ancestors` 等はmetaでは有効にできないため対応済みと主張しない。開発サーバー用と本番用を分け、実機で必要な許可範囲を検証する。

元サイトをiframeに埋め込まない。リンク遷移は `noopener noreferrer`。分析・広告・エラーログの外部収集を初期版へ導入しない。ブラウザの画像コーデック等のリスクをゼロとは言えないが、形式・サイズ・画素数の制限と検証で入力範囲を抑える。

## 6. 将来のネットレシピ取り込み調査

この節は中断前に取得した公式資料の内容と既存知識を整理したもの。再開後の外部Web検索・API実行は行っていない。料金・利用規約・CORSレスポンス・認証条件は実装前に再確認する。特定サイトの自動取得を許可済みと扱わない。

### 実現範囲

| 方式 | 初期版 | 将来の可否と条件 |
| --- | --- | --- |
| 検索リンク、元URL保存、利用者による手動入力 | 実施 | ブラウザだけで可能 |
| 利用者が用意したJSON-LD/HTMLのローカル解析 | 対象外 | 権利上利用可能な内容に限り可能。画像・scriptを実行せず文字データとして解析 |
| 外部ページを直接fetchしてJSON-LDを取得 | 対象外 | 相手のCORS許可と規約上の許諾が両方必要。すべてのサイトでの動作は不可能 |
| 公式レシピAPIの直接呼び出し | 対象外 | 無料条件、認証方式、公開クライアントでの資格情報利用可否、CORS、保存/表示の規約をすべて満たす場合だけ検討 |
| 独自のサーバーレス関数から取得 | 対象外 | サーバー運用の一種。費用・鍵管理・アクセス制限・規約・濫用防止の新設計が必要 |
| CORSプロキシ、認証/ボット対策回避、大量スクレイピング | 禁止 | 許可・利用条件を迂回する設計は採用しない |

サーバーレスには「ブラウザだけ」と「管理サーバー不要のクラウド関数」の二つの意味がある。本初期版は前者のみ。Service Workerや `fetch(..., {mode: 'no-cors'})` で第三者HTMLを読めるようにはならない。no-corsのopaque応答では本文を解析できない。外部画像も表示可否とCanvasでの読み取り・保存可否は別で、CORSが必要になる。

### JSON-LDの変換案（将来）

[Schema.org Recipe](https://schema.org/Recipe)はレシピを構造化する語彙であり、転載許諾ではない。文字列・配列・`@graph`、`@type` の配列、複数Recipe、HowToStep/HowToSection等を扱う必要がある。

| JSON-LD項目 | 取り込み先・解釈 |
| --- | --- |
| name | title。上限超過は利用者に修正を求める |
| recipeIngredient | 材料名の自由文として行へ。分量の完全自動分解は保証しない |
| recipeInstructions | Text / HowToStep / HowToSectionを順序を保って手順へ。見出しは文字として残す |
| recipeYield | 人数が明確な整数のときだけservings候補。その他はメモへ |
| totalTime | ISO 8601期間を分へ。解釈できない場合は空欄。prepTime/cookTimeを重複加算しない |
| recipeCategory / keywords | 固定カテゴリ候補とタグに変換し確認 |
| image | URL候補のみ。許諾・CORS等を確認するまで自動取得しない |
| url / author / publisher | 元URL、出典としてメモ等へ。正式対応時は出典フィールドの追加も検討 |

解析結果は必ず編集可能なプレビューへ置き、利用者が保存して初めてRecipeにする。複数Recipeなら選択させる。未知の構造、JS実行でのみ生成される情報、不足項目は自動で補完せず手入力へ戻す。DOMParser等を利用しても解析したHTMLを実DOMへ挿入しない。JSON-LDの `@context` / `@id` を追加ネットワーク取得の指示として扱わない。

### 公式APIの候補比較

| 候補 | 前回確認できた内容 | 判断・未確認 |
| --- | --- | --- |
| [楽天レシピカテゴリ別ランキングAPI](https://webservice.rakuten.co.jp/documentation/recipe-category-ranking) | カテゴリのランキング、タイトル、URL、材料名等。出力一覧に完全な手順・分量はない。参照時のドキュメントはapplicationIdに加えaccessKeyを必須と記載 | 自由語による汎用レシピ検索や全文取り込みの代替ではない。CORS、鍵の公開可否、保存条件、最新料金は未確認。キーを作成していない |
| [Edamam Recipe Search API](https://developer.edamam.com/edamam-recipe-api) | 検索APIの公式案内に有料プラン・試用期間の表示があった | 継続無料の前提にできず初期版不採用。全文・画像の権利や永続保存条件は未確認 |

特定のサイトにJSON-LDがあること、APIが無料であること、ブラウザから読めることは別々に確認する。[楽天ウェブサービス利用規約の参照先](https://webservice.rakuten.co.jp/guide/rule)は前回取得に失敗したため本文未確認であり、利用許諾を得たという判断はしない。

### 利用規約・著作権

写真や表現された説明文の転載と、料理の着想・事実情報の扱いを一律に判断しない。公開されている内容でも自由に複製・再配布できるとは限らない。初期版では自作情報と利用権限のある情報の端末内記録を基本にし、出典URLを保持する。手動コピーやスクリーンショットだから常に適法と断定しない。

家庭内利用とインターネット公開は別の利用形態である。[文化庁「ここが知りたい著作権」](https://www.bunka.go.jp/seisaku/chosakuken/taisetsu/point/index.html)の説明も参照し、写真・本文の公開、共有、APIデータ再配布を追加する前に個別の規約と権利を確認する。robots.txtは許諾の代替にならない。バックアップの公開共有機能は初期版に含めない。

### 参照資料と確認状態

以下は前回調査で参照できた公式・一次資料。内容の要点を設計に反映したが、実装による検証は未実施。

- [MDN: CORS](https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/CORS)：クロスオリジン応答の読取り制約。
- [MDN: ストレージの割当量と削除](https://developer.mozilla.org/en-US/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria)：容量・永続性はブラウザと環境に依存。
- [Vite: GitHub Pagesへの静的配信](https://vite.dev/guide/static-deploy.html#github-pages)：リポジトリ配信時のbaseとActions方針。

対象サイトごとの規約、CORS応答、PWAの実機挙動、Pages設定の最新状態は未確認。これらを確認するまで将来機能を有効化しない。
