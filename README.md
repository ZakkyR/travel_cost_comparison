# 駅別移動コスト比較ツール

自宅から目的地へ行く際、どの駅で電車に乗るかによる総コスト（電車代＋駐車場代＋ガソリン代）を比較するパーソナルWebツール。

## セットアップ

### 1. クローンと依存インストール

```bash
git clone <repo-url>
cd travel_cost_comparison
npm install
```

### 2. 環境変数の設定

```bash
cp .env.example .env
```

`.env` を編集して各値を入力：

```
EKISPERT_API_KEY=   # https://ekispert.jp/products/api で無料登録
MCP_API_KEY=        # MCPサーバー認証用の任意の文字列
PORT=3000
```

### 3. ローカル起動

```bash
npm start
# http://localhost:3000 でアクセス
```

### 4. 初回設定の流れ

1. `http://localhost:3000/settings.html` で燃費・ガソリン単価・目的地を設定
2. `http://localhost:3000/data.html` で駅・駐車場データを追加
3. `http://localhost:3000/` で比較表を確認

### 5. Azure App Service へのデプロイ

#### 5-1. App Service の作成と設定
1. Azure Portal で App Service（Free F1、**Linux**、Node.js 20）を作成
2. 「構成 > アプリケーション設定」に以下を追加：
   - `EKISPERT_API_KEY` — 駅すぱあとAPIキー
   - `MCP_API_KEY` — MCP サーバー用 Bearer トークン
   - `WEBSITE_NODE_DEFAULT_VERSION` = `~20`
   - `SCM_DO_BUILD_DURING_DEPLOYMENT` = `false`（CI でビルド済みのため Oryx を起動しない）
3. デプロイセンターで「GitHub Actions」を選択して接続する（ワークフローファイルを自動生成させてから下記の内容で上書きする）

#### 5-2. GitHub Actions ワークフロー

`.github/workflows/deploy.yml` を作成する（Task 14 の Step に含める）：

```yaml
name: Deploy to Azure App Service

on:
  push:
    branches: [main]

jobs:
  build-and-deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: '20'

      - name: Install dependencies (compiles better-sqlite3 on linux/x64)
        run: npm ci

      - name: Run tests
        run: npm test

      - name: Zip artifact (node_modules 込み)
        run: zip -r deploy.zip . --exclude '*.git*' --exclude 'tests/*' --exclude 'docs/*'

      - uses: azure/webapps-deploy@v3
        with:
          app-name: ${{ secrets.AZURE_WEBAPP_NAME }}
          publish-profile: ${{ secrets.AZURE_WEBAPP_PUBLISH_PROFILE }}
          package: deploy.zip
```

GitHub リポジトリの Secrets に `AZURE_WEBAPP_NAME` と `AZURE_WEBAPP_PUBLISH_PROFILE`（Azure Portal の「発行プロファイルのダウンロード」で取得）を設定すること。

**なぜこの構成か：** F1 では Kudu/SCM もアプリと同じ CPU サンドボックスを共有するため、サーバー側での `npm ci` + `node-gyp` コンパイルは 60 CPU 分枠を消費しメモリ不足で失敗するリスクがある。CI（ubuntu-latest, linux/x64）でビルドした `node_modules/` を zip に含めて ZipDeploy することで、App Service 側の CPU 消費なしに ABI 一致したバイナリを配置できる。

#### 5-3. Easy Auth の設定（ブラウザ保護 + MCP API 除外）
1. 「認証 > ID プロバイダー追加 > Microsoft」で Easy Auth を有効化
2. 「認証 > 設定の編集」で以下の JSON を追記して `/api/*` を認証対象外にする：
```json
{
  "globalValidation": {
    "redirectToProvider": "azureActiveDirectory",
    "excludedPaths": ["/api/*"]
  }
}
```
これにより、ブラウザ UI（`/`・`/settings.html`・`/data.html`）は Microsoft ログインで保護され、`/api/*` はアプリ内の Bearer トークン検証（`authMiddleware`）で保護される。

### 6. MCP サーバー（Claude Desktop）

`~/.claude/claude_desktop_config.json` に追記：

```json
{
  "mcpServers": {
    "travel-cost": {
      "command": "node",
      "args": ["絶対パス/mcp-server/index.js"],
      "env": {
        "APP_URL": "https://your-app.azurewebsites.net",
        "MCP_API_KEY": "your-secret-key"
      }
    }
  }
}
```

Claude チャットで「○○駅の安い駐車場を調べてアプリに登録して」と指示するだけでデータ追加できます。

## ⚠️ プライバシー注意事項

**以下のファイルは絶対にコミットしないこと：**
- `stations.csv` / `parkings.csv`（実際のデータ）
- `.env`（APIキー）

pre-commit フックが誤コミットを防止しますが、`git status` で必ず確認してください。
