# 駅別移動コスト比較ツール 設計書

> 作成日: 2026-06-20  
> 元要求仕様: `docs/req/要求仕様書_駅別移動コスト比較ツール.md`

---

## 1. 概要

自宅から目的地（例：東京）へ行く際、「どの駅まで車で行って電車に乗るか」による総コスト（往復電車代＋駐車場代＋往復ガソリン代）を駅ごとに比較表で提示するパーソナルツール。単一ユーザー専用。

---

## 2. システム構成

```
┌─────────────────────────────────────────────────────────┐
│  Web アプリ（Azure App Service / Node.js + Express）     │
│                                                         │
│  /public       ← HTML/CSS/JS フロントエンド（ビルド不要）│
│  /api/compare  ← 比較表の計算                            │
│  /api/stations ← 駅データ CRUD                          │
│  /api/parkings ← 駐車場データ CRUD                      │
│  /api/settings ← 個人設定の読み書き                      │
│  /api/import   ← CSV アップロード                        │
│  /api/fare     ← 駅すぱあとAPI プロキシ                  │
│                                                         │
│  /home/data/travel.db  ← SQLite3（永続ストレージ）       │
└──────────────┬──────────────────────────────────────────┘
               │
               ▼
       ┌───────────────────────┐
       │  駅すぱあとAPI (外部)  │
       │  運賃・乗換数・経路URL │
       └───────────────────────┘

┌──────────────────────────────────────────────────────────┐
│  MCP サーバー（ローカル実行 / Node.js）                   │
│  Claude Desktop から使用。Web APIをAPIキー付きで呼び出す  │
│                                                          │
│  ツール: list/add/update/delete_station                  │
│          list/add/update/delete_parking                  │
│          get_comparison / import_csv                     │
└──────────────────────┬───────────────────────────────────┘
                       │ Authorization: Bearer <API_KEY>
                       ▼
              Web アプリの /api/* エンドポイント
```

### 認証

| アクセス元 | 認証方式 |
|---|---|
| ブラウザ（スマホ・PC） | Azure AD Easy Auth（MSアカウントでログイン） |
| MCP サーバー（ローカル） | APIキー（`Authorization: Bearer <KEY>`）|

Express は「Easy Auth ヘッダーがあれば認証済み、なければ Authorization ヘッダーの APIキーを検証」という2段階チェックを行う。

### コスト

- Azure App Service Free (F1)：**¥0/月**
- SQLite3 は App Service の `/home` 永続ストレージ上に配置。再起動・再デプロイ後もデータが残る。

---

## 3. データモデル（SQLite3）

### テーブル: `stations`

| カラム | 型 | 必須 | 説明 |
|---|---|---|---|
| `station_name` | TEXT | ◯ | 駅名（PK。駅すぱあとAPIに渡す正式名） |
| `line` | TEXT | | 主要路線（表示用） |
| `driving_distance_km` | REAL | ◯ | 自宅からの片道運転距離(km) |
| `note` | TEXT | | 自由メモ |

### テーブル: `fare_cache`

| カラム | 型 | 必須 | 説明 |
|---|---|---|---|
| `station_name` | TEXT | ◯ | 出発駅名（PK複合） |
| `destination` | TEXT | ◯ | 目的地駅名（PK複合） |
| `fare_type` | TEXT | ◯ | "IC" or "ticket"（PK複合） |
| `fare_yen` | INTEGER | ◯ | 片道運賃（円） |
| `travel_minutes` | INTEGER | | 所要時間（分） |
| `transfers` | INTEGER | | 乗換回数 |
| `route_url` | TEXT | | 駅すぱあとが返した経路URL |
| `is_manual` | INTEGER | | 1=手動上書き。0=APIから取得 |
| `fetched_at` | TEXT | | 取得日時（ISO8601） |

運賃の取得・利用ルール：
1. `fare_cache` に（駅名, 目的地, 運賃種別）のレコードがあれば、それを使用
2. `is_manual = 1` のレコードは手動上書きとして永続。APIで上書きしない
3. `is_manual = 0` かつ `fetched_at` が24時間以内ならキャッシュを利用。古ければAPIを再取得
4. API取得失敗時はキャッシュが古くても利用する（完全停止を防ぐ）

### テーブル: `parkings`

| カラム | 型 | 必須 | 説明 |
|---|---|---|---|
| `id` | INTEGER | ◯ | PK（自動採番） |
| `station_name` | TEXT | ◯ | 紐づく駅名（stations.station_name と一致） |
| `parking_name` | TEXT | ◯ | 駐車場名 |
| `daily_max_fee` | INTEGER | ◯ | 1日の上限料金（円） |
| `is_primary` | INTEGER | | 1=この駅のメイン駐車場。0またはNULL=サブ |
| `conditions` | TEXT | | 料金条件メモ |
| `lat` | REAL | | 緯度（将来の地図表示用） |
| `lng` | REAL | | 経度（将来の地図表示用） |
| `last_checked` | TEXT | | 料金確認日（YYYY-MM-DD） |
| `source_url` | TEXT | | 出典URL |
| `note` | TEXT | | 自由メモ |

駐車場の選択ルール：
1. `is_primary = 1` の駐車場を採用
2. 複数ある場合は `daily_max_fee` が最小のものを採用
3. `is_primary` が1件もない場合は全駐車場の中から最安を自動採用

### テーブル: `settings`

| カラム | 型 | 説明 |
|---|---|---|
| `key` | TEXT | PK |
| `value` | TEXT | 値 |

キー一覧：`home_label` / `destination_default` / `fuel_efficiency_km_per_l` / `gas_price_per_l` / `fare_type`（"IC" or "ticket"）

---

## 4. 計算ロジック

各駅 i について：

```
合計コスト(i) = 往復電車代(i) + 駐車場代(i) + 往復ガソリン代(i)

  往復電車代(i)    = 片道運賃(i→目的地) × 2
                     ※ fare_cache の is_manual=1 があればそちらを優先
                     ※ キャッシュが有効なら再APIコールしない（フリープラン上限対策）
  駐車場代(i)      = 採用駐車場の daily_max_fee
  往復ガソリン代(i) = driving_distance_km × 2 ÷ fuel_efficiency × gas_price
```

比較表は `合計コスト` 昇順でソート。最安駅をハイライト表示。

---

## 5. Web API

### エンドポイント一覧

| メソッド | パス | 説明 |
|---|---|---|
| GET | `/api/compare?destination=東京&fare_type=IC` | 比較表を返す |
| GET | `/api/stations` | 駅一覧 |
| POST | `/api/stations` | 駅を追加 |
| PUT | `/api/stations/:name` | 駅を更新 |
| DELETE | `/api/stations/:name` | 駅を削除 |
| GET | `/api/parkings?station=南与野` | 駐車場一覧 |
| POST | `/api/parkings` | 駐車場を追加 |
| PUT | `/api/parkings/:id` | 駐車場を更新 |
| DELETE | `/api/parkings/:id` | 駐車場を削除 |
| GET | `/api/settings` | 設定取得 |
| PUT | `/api/settings` | 設定更新 |
| POST | `/api/import/stations` | 駅CSVアップロード |
| POST | `/api/import/parkings` | 駐車場CSVアップロード |

### `/api/compare` レスポンス例

```json
[
  {
    "station_name": "南与野",
    "line": "埼京線",
    "total_cost": 2180,
    "fare_round_trip": 1140,
    "parking_fee": 600,
    "gas_cost": 440,
    "parking_name": "○○パーキング",
    "last_checked": "2026-06-01",
    "travel_minutes": 28,
    "transfers": 0,
    "route_url": "https://ekispert.jp/...",
    "driving_distance_km": 4.2,
    "fare_source": "api",
    "fare_cached_at": "2026-06-20T10:00:00Z"
  }
]
```

`fare_source`: `"api"`（駅すぱあとから取得）または `"manual"`（手動入力値を使用）

---

## 6. MCP サーバー

### 概要

- ローカルで `node mcp-server/index.js` で起動
- Claude Desktop の `~/.claude/claude_desktop_config.json` に登録して使用
- Web アプリの `/api/*` を `Authorization: Bearer <API_KEY>` 付きで呼び出す

### ツール一覧

| ツール名 | 引数 | 説明 |
|---|---|---|
| `list_stations` | なし | 駅一覧を返す |
| `add_station` | station_name, line, driving_distance_km, note? | 駅を追加 |
| `update_station` | station_name, ...更新フィールド | 駅を更新 |
| `delete_station` | station_name | 駅を削除 |
| `list_parkings` | station_name? | 駐車場一覧（駅名でフィルタ可） |
| `add_parking` | station_name, parking_name, daily_max_fee, is_primary?, conditions?, last_checked?, source_url?, note? | 駐車場を追加 |
| `update_parking` | id, ...更新フィールド | 駐車場を更新 |
| `delete_parking` | id | 駐車場を削除 |
| `get_comparison` | destination?, fare_type? | 比較表を取得 |
| `import_csv` | type("stations"\|"parkings"), csv_content | CSV文字列をインポート |

### Claude チャットでの利用フロー

```
ユーザー:「○○駅周辺の安い駐車場を調べて登録して」
    ↓
Claude チャット
  ① Web検索（Claude自身の機能）で駐車場を調査
  ② 結果を提示し確認
  ③ ユーザーOK → add_parking ツールを呼び出す
  ④「登録しました」と報告
```

---

## 7. フロントエンド UI

素のHTML/CSS/JS（ビルドステップなし）。画面3つ。

### 画面① 比較表（メイン画面）

```
┌─────────────────────────────────────────────────────┐
│  駅別移動コスト比較            ⚙ 設定  📋 データ管理  │
├─────────────────────────────────────────────────────┤
│  目的地: [東京              ]  運賃: [IC ●][きっぷ ○] [比較する] │
├──────┬──────┬──────┬──────┬──────┬──────┬──────┤
│ 駅名  │合計  │電車代│駐車場│ガソリ│時間  │乗換  │
│（リンク）(円) │(往復)│ (円) │ン代  │(分)  │(回)  │
├──────┼──────┼──────┼──────┼──────┼──────┼──────┤
│★南与野│ 2,180│ 1,140│  600 │  440 │  28  │  0   │
│  浦和 │ 2,560│ 1,480│  800 │  280 │  22  │  0   │
│南浦和 │ 2,720│ 1,620│  700 │  400 │  25  │  0   │
│東浦和 │ 3,100│ 1,800│  900 │  400 │  42  │  1   │
├──────┴──────┴──────┴──────┴──────┴──────┴──────┤
│ 駐車場: ○○パーキング（確認日: 2026-06-01 ⚠ 30日以上前）│
└─────────────────────────────────────────────────────┘
```

- ★ が最安駅のハイライト
- 駅名クリック → 駅すぱあとAPIが返した経路URLを新タブで開く
- 駐車場の `last_checked` が30日以上前の場合は ⚠ を表示
- `fare_source = "manual"` の場合は電車代セルに `(手動)` を表示

### 画面② 設定

```
┌─────────────────────────┐
│  設定                    │
├─────────────────────────┤
│  自宅ラベル: [         ]│
│  目的地デフォルト: [    ]│
│  燃費: [  ] km/L        │
│  ガソリン単価: [  ] 円/L│
│  運賃種別: [IC ●][きっぷ○]│
│                [保存]   │
└─────────────────────────┘
```

設定は SQLite3 の `settings` テーブルに保存（スマホ・PC 共通で同じ設定が反映される）。

### 画面③ データ管理

```
┌──────────────────────────────────────────────┐
│  データ管理                                   │
├──────────────────────────────────────────────┤
│  [駅一覧] [駐車場一覧]   CSVインポート: [📁] │
├──────────────────────────────────────────────┤
│  駅一覧                           [+ 追加]  │
│  南与野  埼京線  4.2km   [編集][削除]       │
│  浦和    京浜東北 2.8km   [編集][削除]       │
├──────────────────────────────────────────────┤
│  運賃手動上書き（目的地ごとに設定・APIキャッシュより優先）│
│  南与野→東京: [570] 円  [保存][クリア]      │
└──────────────────────────────────────────────┘
```

---

## 8. 外部API

### 駅すぱあとAPI

- 用途：片道運賃・所要時間・乗換回数・経路URLの取得
- プラン：フリープラン（APIキー必要）
- APIキーは App Service の環境変数 `EKISPERT_API_KEY` に設定。コードに書かない
- フリープランでは経路詳細がURLで返るため、駅名クリックでそのURLを新タブ表示
- APIが利用できない場合は `fare_manual` を使用（手動フォールバック）

---

## 9. エラーハンドリング

| 状況 | 対応 |
|---|---|
| 駅すぱあとAPIが落ちている | 手動入力運賃で比較表を表示。電車代セルに `(手動)` 表示 |
| APIキー未設定 | 比較表に「APIキーが未設定です」の警告を表示。手動運賃があれば表示継続 |
| 設定未入力（初回アクセス） | 「設定画面で燃費・ガソリン単価を入力してください」と促す |
| 駅データが0件 | 「データ管理画面から駅を追加してください」と促す |
| 駐車場に is_primary なし | 最安駐車場を自動採用 |
| 駐車場データなし | 「駐車場データなし」として比較表に表示（除外しない） |
| CSV形式が不正 | エラー行を列挙して通知。正常行のみ取り込む |

---

## 10. プライバシー・セキュリティ

リポジトリに含めてよいもの：
- アプリコード
- `config.example.json`（空テンプレート）
- `stations.example.csv`・`parkings.example.csv`（架空データのみ）
- `.env.example`（キー名のみ、値は空）

リポジトリに**含めてはいけない**もの：
- `stations.csv`・`parkings.csv`（実データ）
- `.env`（実APIキー）
- 本要求仕様書（個人の背景が含まれる）

`.gitignore` 必須項目：`stations.csv`, `parkings.csv`, `.env`, `*.local.*`

誤コミット防止として pre-commit フックを実装し、上記ファイルが staged にある場合はコミットを中断する。

---

## 11. プロジェクト構成

```
travel_cost_comparison/
├── src/
│   ├── server.js           ← Express エントリーポイント
│   ├── db.js               ← SQLite3 接続・マイグレーション
│   ├── routes/
│   │   ├── compare.js
│   │   ├── stations.js
│   │   ├── parkings.js
│   │   ├── settings.js
│   │   ├── import.js
│   │   └── fare.js
│   └── public/
│       ├── index.html      ← 比較表（メイン）
│       ├── settings.html
│       ├── data.html       ← データ管理
│       ├── style.css
│       └── app.js
├── mcp-server/
│   └── index.js            ← MCP サーバー
├── stations.example.csv
├── parkings.example.csv
├── config.example.json
├── .env.example
├── .gitignore
├── package.json
└── README.md
```

---

## 12. v1 スコープ外（将来拡張）

- バス利用パターン（自宅最寄りバス停からの経路）の比較行追加
- 複数目的地のプリセット
- 地図表示（lat/lng の活用）
- 駐車場の満空・予約（akippa等）連携
- 運転距離・ガソリン単価の自動更新

---

## 13. 元要求仕様との差分

| 項目 | 元要求仕様 | 本設計での決定 |
|---|---|---|
| 動作形態 | ローカルWebアプリ推奨 | Azure App Service でホスト |
| データ保存 | localStorage / .gitignoreファイル | SQLite3（App Service永続ストレージ） |
| 認証 | なし（単一ユーザー前提） | Azure AD Easy Auth + APIキー |
| 設定保存先 | localStorage（Webアプリの場合） | SQLite3（マルチデバイス対応のため） |
| MCP サーバー | 記載なし（追加要件） | Web APIを呼び出すローカルMCPサーバーを追加 |
| バス利用パターン | v1スコープ外 | v1スコープ外のまま（バス停API制約のため） |
| 駐車場選択 | 最安を自動採用 | is_primary フラグで主駐車場指定。未指定時は最安を自動採用 |
