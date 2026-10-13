# 佐野家のごはん — recipe-book

家庭のレシピ、ネットで見つけた料理、自分なりのアレンジを一か所に集める、スマートフォン向けのレシピ管理アプリです。将来の「佐野家の定番」や献立ルーレットで毎日の料理選びを助けるPWAを目指します。

**Phase 1Aの開発版です。動くレシピブックを実装しました。PWA・バックアップ・公開用CI・本番サイトはまだありません。**

**この版には家庭の本番データを入力しないでください。バックアップ・復元が未完成のため、ブラウザのデータ削除・保存領域の自動解放・端末故障などでレシピを失うと復旧できません。** アプリ内にも同じ案内を表示します。

## 目的と採用技術

個人開発として開発・運用コストを最小限に抑え、初期版はAndroid Chromeのスマートフォン1台で使います。

- React + TypeScript + Vite
- GitHub Pagesの `/recipe-book/` サブパスに対応するhashルーティング（公開・PWAはPhase 4）
- IndexedDBでレシピを端末内保存。写真・履歴用のstoreもDB v1に用意
- サーバー、ユーザー登録、ログイン、クラウドDB、有料APIは不要

採用ライブラリはReact 19.3.0、React DOM 19.3.0、React Router 7.18.4、idb 8.0.4。Vite 7.3.7、TypeScript 5.9.3（strict）、ESLint、Vitest、fake-indexeddb、Playwrightを開発・検証に使用します。実際のバージョンはpackage.jsonとnpm lockfileで固定しています。追加理由・ライセンスは[DECISIONS](docs/DECISIONS.md#d13-phase-1aのライブラリとhashルーティング)に記録しています。

## 開発・検証コマンド

Node.js 22.12以上（検証環境は24.19.0）とnpmを使用します。

```sh
npm ci
npm run dev
npm run typecheck
npm run lint
npm test
npm run build
npm run test:e2e
npm run preview
```

開発時は `http://localhost:5173/recipe-book/`、previewは `http://localhost:4173/recipe-book/` を開きます。E2Eはビルド済みのdistをローカルで配信します。Chromiumがなければ `npx playwright install chromium` を実行してください。Linuxで `/usr/bin/chromium` があれば自動使用します。別の実行ファイルは `CHROMIUM_PATH=/path/to/chromium npm run test:e2e` で指定できます。開発用キャッシュ先が書込み不可の場合は `npm ci --cache /tmp/recipe-npm-cache` を使用します。

## Phase 1Aで動く機能

- ホーム：一覧・追加への導線、空状態、データ消失リスクの案内
- レシピ一覧：料理名・カテゴリ・時間、料理名/材料名/タグ/メモの検索、カテゴリ絞り込み、更新順/料理名順、30件ずつの追加表示
- 登録・編集：料理名、カテゴリ、材料と分量、人数、手順、時間、メモ、タグ、元URL。材料・手順の追加/削除/上下移動
- 詳細：全入力情報、登録/更新日時、元URLの安全な別タブリンク、編集・確認付き削除
- 料理名だけの登録、入力上限検証、不正URL拒否、編集キャンセル、未保存変更の破棄確認
- IndexedDBへの原子的な保存・関連削除、recipe revisionとmeta世代による競合検出、再読み込み・ブラウザ再起動後の再表示

写真はプレースホルダーです。お気に入り操作はありません。ルーレットと設定は「未実装」の案内画面です。保存失敗時は入力を保持し、DB障害を空データとして表示しません。

DB名は `sano-recipe-book`、DB_VERSION=1、storeはrecipes/images/mealDecisions/cookingLogs/meta。通常のPhase 1A操作で写真と両履歴のstoreにデータを作成しません。保存成功を表示するのはトランザクション完了後です。失敗・初期化障害で既存DBを自動削除しません。未保存入力の自動永続化は行わず、OSによる強制終了時の保持は保証しません。

## 次のPhaseで予定する機能

- 写真を持つレシピの登録、編集、削除
- タグ選択による絞り込み、お気に入り「佐野家の定番」
- 料理写真やスクリーンショットの添付と端末内での圧縮
- カテゴリ・お気に入り・タグ・最近の調理を条件にした献立ルーレット
- 献立の決定履歴と実際に作った調理履歴
- 外部ブラウザでのWeb検索と、URL・必要情報の手動登録
- 写真を含むファイルへのバックアップと復元

OCR、AI画像解析、外部サイトからの自動取り込み、買い物リスト、家族間同期は将来の検討対象です。

## データについて

データは利用端末のブラウザ内に保存します。ブラウザデータの削除、端末故障、保存領域の自動解放等で失われる可能性があり、永続性は保証できません。**バックアップは初期版の必須機能ですが、Phase 1Aでは未実装です。テスト用の架空データだけを入力してください。** 保存先はオリジン（プロトコル/ドメイン/ポート）ごとに異なるため、devとpreview、別ブラウザや別プロファイル間ではデータを共有しません。入力データをGitHubや外部APIへ送信しません。

## 設計書

| 文書 | 内容 |
| --- | --- |
| [AGENTS.md](AGENTS.md) | Codexの共通開発ルール・次回作業の入口 |
| [PRODUCT_SPEC](docs/PRODUCT_SPEC.md) | 機能、入力・出力、例外、受け入れ条件 |
| [SCREEN_DESIGN](docs/SCREEN_DESIGN.md) | 8画面、画面遷移、片手操作、エラー表示 |
| [DATA_MODEL](docs/DATA_MODEL.md) | 型、IndexedDB、写真、バックアップ、移行 |
| [ARCHITECTURE](docs/ARCHITECTURE.md) | 技術構成、PWA、公開方針、自動取り込みの調査 |
| [ROADMAP](docs/ROADMAP.md) | Phase別の実装範囲・完了条件 |
| [TEST_PLAN](docs/TEST_PLAN.md) | テスト計画と実行状況の記録方法 |
| [DECISIONS](docs/DECISIONS.md) | 判断理由、採用初期案、未確認事項 |

## 今後の開発

1. Phase 1A：基本レシピブック・IndexedDB（今回実装）。1B：写真・お気に入り。1C：バックアップ・復元・容量管理。
2. Phase 2：献立ルーレット、決定履歴、調理履歴。
3. Phase 3：Web検索導線、URL保存・手動登録フローの完成。
4. Phase 4：UI改善、PWA、Android実機検証、GitHub Pages本番公開。
5. Future：規約と技術の条件を満たす自動取り込み、買い物リスト、家族共有。

初期版の一般利用開始はPhase 4の完了後です。Phase 1Cでバックアップを使え、Phase 2より前からデータ互換性を管理する計画です。

次回は[AGENTS.md](AGENTS.md)と[ROADMAP](docs/ROADMAP.md)を読み、Phase 1Bから進めます。検証結果と未検証事項は[TEST_PLAN](docs/TEST_PLAN.md)に記録します。Android実機・ソフトキーボード・TalkBack・PWA・本番GitHub Pagesは未検証です。
