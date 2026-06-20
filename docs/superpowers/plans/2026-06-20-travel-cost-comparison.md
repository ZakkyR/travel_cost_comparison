# 駅別移動コスト比較ツール 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Azure App Service (Free F1) で動作する駅別移動コスト比較 Web アプリと、Claude Desktop から使用できるローカル MCP サーバーを構築する

**Architecture:** Node.js/Express バックエンドが better-sqlite3 で /home/data/travel.db を管理。駅すぱあとAPI で電車運賃を取得・24時間キャッシュし、費用計算結果を JSON で返す。フロントエンドは素の HTML/CSS/JS（ビルドなし）。MCP サーバーはローカルで動作し Web API を Bearer トークンで呼び出す。

**Tech Stack:** Node.js 20+, Express 4, better-sqlite3, dotenv, Jest 29 + supertest, @modelcontextprotocol/sdk 1.x, csv-parse 5.x, multer 1.x, node-fetch 3.x, husky

## Global Constraints

- Node.js 20 LTS 以上を使用すること
- Azure App Service Free (F1) で動作すること（常時接続なし・60 CPU分/日）
- フロントエンドはビルドステップなし（npm run build 等を不要とする）
- SQLite DB パスは環境変数 `DB_PATH`（デフォルト: `process.env.HOME + '/data/travel.db'`）
- 個人情報ファイル（stations.csv, parkings.csv, .env）はリポジトリに含めない
- テストは全て Jest で記述し、DB は `:memory:` インスタンスを使用すること
- 全 `/api/*` エンドポイントに認証ミドルウェアを適用すること
- コミット前に個人情報ファイルの誤 staged を検出する pre-commit フックを設けること
- `"type": "module"` (ESM) で統一すること

### Azure App Service 固有の制約（必須）

1. **SQLite WAL モード必須** — `/home` は CIFS/SMB ネットワークマウントであり、SQLite のロック機構と相性が悪く `SQLITE_BUSY: database is locked` が発生する既知の問題がある。`createDb()` では必ず `PRAGMA journal_mode = WAL` を設定すること。F1 はシングルインスタンス＆シングルユーザーのため WAL で実用上回避可能。
2. **ネイティブモジュールは CI でビルドして ZipDeploy** — `better-sqlite3` はネイティブ addon のため、ABI 不一致でクラッシュする。F1 では Kudu/SCM もアプリと同じ CPU サンドボックス上で動くため `SCM_DO_BUILD_DURING_DEPLOYMENT=true` は NG（60 CPU 分を消費し、メモリ不足でビルド失敗することもある）。正しい構成は「GitHub Actions の ubuntu-latest で `npm ci` → コンパイル済み `node_modules/` ごと zip → Azure ZipDeploy、App Service 側の `SCM_DO_BUILD_DURING_DEPLOYMENT=false`」。CI の Node バージョンを App Service（`WEBSITE_NODE_DEFAULT_VERSION`）と同じメジャーに揃えること（Node 20 で統一）。`package.json` の `engines.node` に `">=20.0.0"` を明記すること。
3. **Easy Auth は `/api/*` パスを除外すること** — Easy Auth を有効にすると全リクエストに認証が要求され、MCP サーバーからの Bearer トークン呼び出しも Microsoft ログインへリダイレクトされて失敗する。Azure Portal の「認証 > 編集 > 未認証の要求」で `excludedPaths` に `/api/*` を追加し、ブラウザ UI は Easy Auth で保護、API はアプリ内 Bearer トークン検証で保護する二層構成にすること。

---

## ファイル構成

```
travel_cost_comparison/
├── src/
│   ├── server.js              # Express エントリーポイント・ルーティング
│   ├── db.js                  # SQLite 接続・テーブル作成
│   ├── auth.js                # 認証ミドルウェア（Easy Auth + APIキー）
│   ├── routes/
│   │   ├── compare.js         # GET /api/compare
│   │   ├── stations.js        # CRUD /api/stations
│   │   ├── parkings.js        # CRUD /api/parkings
│   │   ├── settings.js        # GET/PUT /api/settings
│   │   ├── fare.js            # GET/POST /api/fare/cache, POST /api/fare/manual
│   │   └── import.js          # POST /api/import/stations|parkings
│   ├── services/
│   │   ├── ekispert.js        # 駅すぱあとAPI クライアント
│   │   ├── fareCache.js       # 運賃キャッシュの読み書き・TTL管理
│   │   └── calculator.js      # コスト計算ロジック（純粋関数）
│   └── public/
│       ├── index.html         # 比較表画面
│       ├── settings.html      # 設定画面
│       ├── data.html          # データ管理画面
│       ├── style.css          # 共通スタイル
│       └── app.js             # 共通 JS ユーティリティ
├── mcp-server/
│   └── index.js               # MCP サーバー（全ツール定義）
├── tests/
│   ├── helpers/
│   │   └── testDb.js          # テスト用インメモリ DB セットアップ
│   ├── db.test.js
│   ├── auth.test.js
│   ├── services/
│   │   ├── calculator.test.js
│   │   └── fareCache.test.js
│   └── routes/
│       ├── compare.test.js
│       ├── stations.test.js
│       ├── parkings.test.js
│       ├── settings.test.js
│       └── import.test.js
├── .husky/
│   └── pre-commit
├── stations.example.csv
├── parkings.example.csv
├── .env.example
├── .gitignore
├── package.json
└── README.md
```

---

### Task 1: プロジェクトスキャフォールド

**Files:**
- Create: `package.json`
- Create: `.gitignore`
- Create: `.env.example`
- Create: `stations.example.csv`
- Create: `parkings.example.csv`

**Interfaces:**
- Produces: `npm test` が動作する基盤、`npm start` でサーバー起動できる土台

- [ ] **Step 1: git init**

```bash
cd c:/Users/Zakky/source/repos/travel_cost_comparison
git init
```

Expected: `Initialized empty Git repository in ...`

- [ ] **Step 2: package.json を作成**

```json
{
  "name": "travel-cost-comparison",
  "version": "1.0.0",
  "type": "module",
  "engines": {
    "node": ">=20.0.0"
  },
  "scripts": {
    "start": "node src/server.js",
    "dev": "node --watch src/server.js",
    "test": "node --experimental-vm-modules node_modules/.bin/jest --runInBand"
  },
  "dependencies": {
    "better-sqlite3": "^9.6.0",
    "csv-parse": "^5.5.6",
    "dotenv": "^16.4.5",
    "express": "^4.19.2",
    "multer": "^1.4.5-lts.1",
    "node-fetch": "^3.3.2"
  },
  "devDependencies": {
    "husky": "^9.1.4",
    "jest": "^29.7.0",
    "supertest": "^7.0.0"
  },
  "jest": {
    "transform": {},
    "testEnvironment": "node",
    "extensionsToTreatAsEsm": [".js"]
  }
}
```

- [ ] **Step 3: npm install を実行**

```bash
npm install
```

Expected: `node_modules/` が作成される

- [ ] **Step 4: .gitignore を作成**

```
node_modules/
.env
stations.csv
parkings.csv
*.local.*
*.db
*.db-shm
*.db-wal
.DS_Store
```

- [ ] **Step 5: .env.example を作成**

```
EKISPERT_API_KEY=
MCP_API_KEY=
DB_PATH=
PORT=3000
```

- [ ] **Step 6: サンプル CSV を作成**

`stations.example.csv`:
```
station_name,line,driving_distance_km,note
サンプルA駅,サンプル線,3.0,架空データ。実データは stations.csv に入れる（コミットしない）
サンプルB駅,サンプル線,5.5,架空データ
サンプルC駅,サンプル線,7.2,架空データ
```

`parkings.example.csv`:
```
station_name,parking_name,daily_max_fee,is_primary,conditions,lat,lng,last_checked,source_url,note
サンプルA駅,サンプル駐車場1,600,1,架空データ,,,,,
サンプルA駅,サンプル駐車場2,800,0,架空データ,,,,,
サンプルB駅,サンプル駐車場3,500,1,架空データ,,,,,
```

- [ ] **Step 7: 初回コミット**

```bash
git add package.json package-lock.json .gitignore .env.example stations.example.csv parkings.example.csv
git commit -m "chore: initial project scaffold"
```

---

### Task 2: データベース層

**Files:**
- Create: `src/db.js`
- Create: `tests/helpers/testDb.js`
- Create: `tests/db.test.js`

**Interfaces:**
- Produces:
  - `initDb(db: Database): void` — 全テーブルを作成
  - `createDb(dbPath: string): Database` — ファイル DB を初期化して返す
  - `createTestDb(): Database` — `:memory:` DB を初期化して返す（テスト用）

- [ ] **Step 1: テストを書く**

`tests/db.test.js`:
```js
import { createTestDb } from './helpers/testDb.js';

test('creates all tables', () => {
  const db = createTestDb();
  const tables = db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
  ).all().map(r => r.name);
  expect(tables).toEqual(['fare_cache', 'parkings', 'settings', 'stations']);
  db.close();
});
```

- [ ] **Step 2: テストが失敗することを確認**

```bash
npm test -- tests/db.test.js
```

Expected: FAIL (testDb.js not found)

- [ ] **Step 3: src/db.js を作成**

```js
// src/db.js
import Database from 'better-sqlite3';
import { mkdirSync } from 'fs';
import { dirname } from 'path';

export function initDb(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS stations (
      station_name TEXT PRIMARY KEY,
      line TEXT,
      driving_distance_km REAL NOT NULL,
      note TEXT
    );
    CREATE TABLE IF NOT EXISTS parkings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      station_name TEXT NOT NULL,
      parking_name TEXT NOT NULL,
      daily_max_fee INTEGER NOT NULL,
      is_primary INTEGER DEFAULT 0,
      conditions TEXT,
      lat REAL,
      lng REAL,
      last_checked TEXT,
      source_url TEXT,
      note TEXT
    );
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT
    );
    CREATE TABLE IF NOT EXISTS fare_cache (
      station_name TEXT NOT NULL,
      destination TEXT NOT NULL,
      fare_type TEXT NOT NULL,
      fare_yen INTEGER NOT NULL,
      travel_minutes INTEGER,
      transfers INTEGER,
      route_url TEXT,
      is_manual INTEGER DEFAULT 0,
      fetched_at TEXT NOT NULL,
      PRIMARY KEY (station_name, destination, fare_type)
    );
  `);
}

export function createDb(dbPath) {
  mkdirSync(dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  // Azure App Service の /home は CIFS/SMB マウントのため WAL 必須（SQLITE_BUSY 回避）
  db.pragma('journal_mode = WAL');
  initDb(db);
  return db;
}
```

- [ ] **Step 4: tests/helpers/testDb.js を作成**

```js
// tests/helpers/testDb.js
import Database from 'better-sqlite3';
import { initDb } from '../../src/db.js';

export function createTestDb() {
  const db = new Database(':memory:');
  db.pragma('journal_mode = WAL');
  initDb(db);
  return db;
}
```

- [ ] **Step 5: テストを実行して PASS を確認**

```bash
npm test -- tests/db.test.js
```

Expected: PASS

- [ ] **Step 6: コミット**

```bash
git add src/db.js tests/helpers/testDb.js tests/db.test.js
git commit -m "feat: add SQLite database layer with schema"
```

---

### Task 3: 認証ミドルウェア

**Files:**
- Create: `src/auth.js`
- Create: `tests/auth.test.js`

**Interfaces:**
- Consumes: `process.env.MCP_API_KEY`、Azure AD Easy Auth ヘッダー `X-MS-CLIENT-PRINCIPAL`
- Produces: `authMiddleware(req, res, next)` — Express ミドルウェア関数

- [ ] **Step 1: テストを書く**

`tests/auth.test.js`:
```js
import request from 'supertest';
import express from 'express';
import { authMiddleware } from '../src/auth.js';

function makeApp() {
  const app = express();
  app.use(authMiddleware);
  app.get('/api/test', (req, res) => res.json({ ok: true }));
  return app;
}

beforeEach(() => { process.env.MCP_API_KEY = 'secret123'; });

test('rejects unauthenticated requests with 401', async () => {
  const res = await request(makeApp()).get('/api/test');
  expect(res.status).toBe(401);
});

test('allows request with valid API key', async () => {
  const res = await request(makeApp()).get('/api/test').set('Authorization', 'Bearer secret123');
  expect(res.status).toBe(200);
});

test('allows request with Azure AD Easy Auth header', async () => {
  const principal = Buffer.from(JSON.stringify({ userId: 'user1' })).toString('base64');
  const res = await request(makeApp()).get('/api/test').set('X-MS-CLIENT-PRINCIPAL', principal);
  expect(res.status).toBe(200);
});

test('rejects wrong API key with 401', async () => {
  const res = await request(makeApp()).get('/api/test').set('Authorization', 'Bearer wrongkey');
  expect(res.status).toBe(401);
});
```

- [ ] **Step 2: テストが失敗することを確認**

```bash
npm test -- tests/auth.test.js
```

Expected: FAIL

- [ ] **Step 3: src/auth.js を実装**

```js
// src/auth.js
export function authMiddleware(req, res, next) {
  if (req.headers['x-ms-client-principal']) return next();

  const apiKey = process.env.MCP_API_KEY;
  const auth = req.headers['authorization'];
  if (apiKey && auth === `Bearer ${apiKey}`) return next();

  res.status(401).json({ error: 'Unauthorized' });
}
```

- [ ] **Step 4: テストを実行して PASS を確認**

```bash
npm test -- tests/auth.test.js
```

Expected: PASS (4 tests)

- [ ] **Step 5: コミット**

```bash
git add src/auth.js tests/auth.test.js
git commit -m "feat: add authentication middleware"
```

---

### Task 4: 設定 API

**Files:**
- Create: `src/routes/settings.js`
- Create: `tests/routes/settings.test.js`

**Interfaces:**
- Produces:
  - `createSettingsRouter(db: Database): Router`
  - GET `/api/settings` → `{ home_label: string, destination_default: string, fuel_efficiency_km_per_l: number, gas_price_per_l: number, fare_type: string }`
  - PUT `/api/settings` ← 同上オブジェクト（部分更新可）

- [ ] **Step 1: テストを書く**

`tests/routes/settings.test.js`:
```js
import request from 'supertest';
import express from 'express';
import { createSettingsRouter } from '../../src/routes/settings.js';
import { createTestDb } from '../helpers/testDb.js';

function makeApp(db) {
  const app = express();
  app.use(express.json());
  app.use('/api/settings', createSettingsRouter(db));
  return app;
}

let db;
beforeEach(() => { db = createTestDb(); });
afterEach(() => db.close());

test('GET returns defaults when table is empty', async () => {
  const res = await request(makeApp(db)).get('/api/settings');
  expect(res.status).toBe(200);
  expect(res.body).toMatchObject({
    home_label: '', destination_default: '',
    fuel_efficiency_km_per_l: 0, gas_price_per_l: 0, fare_type: 'IC',
  });
});

test('PUT persists values and GET returns them', async () => {
  const app = makeApp(db);
  await request(app).put('/api/settings').send({
    home_label: '自宅', destination_default: '東京',
    fuel_efficiency_km_per_l: 15, gas_price_per_l: 175, fare_type: 'IC',
  });
  const res = await request(app).get('/api/settings');
  expect(res.body.home_label).toBe('自宅');
  expect(res.body.fuel_efficiency_km_per_l).toBe(15);
});
```

- [ ] **Step 2: テストが失敗することを確認**

```bash
npm test -- tests/routes/settings.test.js
```

Expected: FAIL

- [ ] **Step 3: src/routes/settings.js を実装**

```js
// src/routes/settings.js
import { Router } from 'express';

const DEFAULTS = {
  home_label: '', destination_default: '',
  fuel_efficiency_km_per_l: 0, gas_price_per_l: 0, fare_type: 'IC',
};

export function createSettingsRouter(db) {
  const router = Router();

  router.get('/', (req, res) => {
    const rows = db.prepare('SELECT key, value FROM settings').all();
    const settings = { ...DEFAULTS };
    for (const { key, value } of rows) {
      if (key in settings) settings[key] = typeof DEFAULTS[key] === 'number' ? Number(value) : value;
    }
    res.json(settings);
  });

  router.put('/', (req, res) => {
    const upsert = db.prepare(
      'INSERT INTO settings (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value'
    );
    db.transaction((data) => {
      for (const [k, v] of Object.entries(data)) {
        if (k in DEFAULTS) upsert.run(k, String(v));
      }
    })(req.body);
    res.json({ ok: true });
  });

  return router;
}
```

- [ ] **Step 4: テストを実行して PASS を確認**

```bash
npm test -- tests/routes/settings.test.js
```

Expected: PASS

- [ ] **Step 5: コミット**

```bash
git add src/routes/settings.js tests/routes/settings.test.js
git commit -m "feat: add settings API"
```

---

### Task 5: 駅 CRUD API

**Files:**
- Create: `src/routes/stations.js`
- Create: `tests/routes/stations.test.js`

**Interfaces:**
- Produces:
  - `createStationsRouter(db: Database): Router`
  - GET `/api/stations` → `Array<{station_name, line, driving_distance_km, note}>`
  - POST `/api/stations` ← `{station_name, line?, driving_distance_km, note?}` → 201
  - PUT `/api/stations/:name` ← 更新フィールド → 200 or 404
  - DELETE `/api/stations/:name` → 200

- [ ] **Step 1: テストを書く**

`tests/routes/stations.test.js`:
```js
import request from 'supertest';
import express from 'express';
import { createStationsRouter } from '../../src/routes/stations.js';
import { createTestDb } from '../helpers/testDb.js';

function makeApp(db) {
  const app = express();
  app.use(express.json());
  app.use('/api/stations', createStationsRouter(db));
  return app;
}

let db;
beforeEach(() => { db = createTestDb(); });
afterEach(() => db.close());

test('GET returns empty array initially', async () => {
  expect((await request(makeApp(db)).get('/api/stations')).body).toEqual([]);
});

test('POST adds station and GET returns it', async () => {
  const app = makeApp(db);
  const res = await request(app).post('/api/stations').send({ station_name: '南与野', line: '埼京線', driving_distance_km: 4.2 });
  expect(res.status).toBe(201);
  const list = await request(app).get('/api/stations');
  expect(list.body[0].station_name).toBe('南与野');
});

test('PUT updates driving_distance_km', async () => {
  const app = makeApp(db);
  await request(app).post('/api/stations').send({ station_name: '浦和', driving_distance_km: 3.0 });
  await request(app).put('/api/stations/浦和').send({ driving_distance_km: 3.5 });
  expect((await request(app).get('/api/stations')).body[0].driving_distance_km).toBe(3.5);
});

test('DELETE removes station', async () => {
  const app = makeApp(db);
  await request(app).post('/api/stations').send({ station_name: '東浦和', driving_distance_km: 5.0 });
  await request(app).delete('/api/stations/東浦和');
  expect((await request(app).get('/api/stations')).body).toHaveLength(0);
});

test('POST returns 400 when driving_distance_km is missing', async () => {
  expect((await request(makeApp(db)).post('/api/stations').send({ station_name: '浦和' })).status).toBe(400);
});
```

- [ ] **Step 2: テストが失敗することを確認**

```bash
npm test -- tests/routes/stations.test.js
```

Expected: FAIL

- [ ] **Step 3: src/routes/stations.js を実装**

```js
// src/routes/stations.js
import { Router } from 'express';

export function createStationsRouter(db) {
  const router = Router();

  router.get('/', (req, res) => {
    res.json(db.prepare('SELECT * FROM stations ORDER BY station_name').all());
  });

  router.post('/', (req, res) => {
    const { station_name, line = null, driving_distance_km, note = null } = req.body;
    if (!station_name || driving_distance_km == null) {
      return res.status(400).json({ error: 'station_name and driving_distance_km are required' });
    }
    db.prepare('INSERT INTO stations (station_name,line,driving_distance_km,note) VALUES (?,?,?,?)')
      .run(station_name, line, driving_distance_km, note);
    res.status(201).json({ ok: true });
  });

  router.put('/:name', (req, res) => {
    const fields = ['line', 'driving_distance_km', 'note'].filter(f => f in req.body);
    if (!fields.length) return res.status(400).json({ error: 'No fields to update' });
    const set = fields.map(f => `${f}=?`).join(',');
    const result = db.prepare(`UPDATE stations SET ${set} WHERE station_name=?`)
      .run(...fields.map(f => req.body[f]), req.params.name);
    result.changes ? res.json({ ok: true }) : res.status(404).json({ error: 'Not found' });
  });

  router.delete('/:name', (req, res) => {
    db.prepare('DELETE FROM stations WHERE station_name=?').run(req.params.name);
    res.json({ ok: true });
  });

  return router;
}
```

- [ ] **Step 4: テストを実行して PASS を確認**

```bash
npm test -- tests/routes/stations.test.js
```

Expected: PASS (5 tests)

- [ ] **Step 5: コミット**

```bash
git add src/routes/stations.js tests/routes/stations.test.js
git commit -m "feat: add stations CRUD API"
```

---

### Task 6: 駐車場 CRUD API + 選択ロジック

**Files:**
- Create: `src/routes/parkings.js`
- Create: `tests/routes/parkings.test.js`

**Interfaces:**
- Produces:
  - `selectParking(db, stationName): {id, parking_name, daily_max_fee, last_checked} | null`
    — is_primary=1 の最安、なければ全体最安
  - `createParkingsRouter(db): Router`

- [ ] **Step 1: テストを書く**

`tests/routes/parkings.test.js`:
```js
import request from 'supertest';
import express from 'express';
import { createParkingsRouter, selectParking } from '../../src/routes/parkings.js';
import { createTestDb } from '../helpers/testDb.js';

function makeApp(db) {
  const app = express();
  app.use(express.json());
  app.use('/api/parkings', createParkingsRouter(db));
  return app;
}

let db;
beforeEach(() => {
  db = createTestDb();
  db.prepare('INSERT INTO stations VALUES (?,?,?,?)').run('南与野','埼京線',4.2,null);
});
afterEach(() => db.close());

test('POST adds parking and returns id', async () => {
  const res = await request(makeApp(db)).post('/api/parkings').send({ station_name:'南与野', parking_name:'P1', daily_max_fee:600, is_primary:1 });
  expect(res.status).toBe(201);
  expect(res.body.id).toBeGreaterThan(0);
});

test('GET ?station= returns only that station\'s parkings', async () => {
  db.prepare('INSERT INTO parkings (station_name,parking_name,daily_max_fee,is_primary) VALUES (?,?,?,?)').run('南与野','P1',600,1);
  const res = await request(makeApp(db)).get('/api/parkings?station=南与野');
  expect(res.body).toHaveLength(1);
});

test('selectParking returns is_primary=1 parking', () => {
  db.prepare('INSERT INTO parkings (station_name,parking_name,daily_max_fee,is_primary) VALUES (?,?,?,?)').run('南与野','高い',900,0);
  db.prepare('INSERT INTO parkings (station_name,parking_name,daily_max_fee,is_primary) VALUES (?,?,?,?)').run('南与野','メイン',700,1);
  expect(selectParking(db,'南与野').parking_name).toBe('メイン');
});

test('selectParking falls back to cheapest when no is_primary', () => {
  db.prepare('INSERT INTO parkings (station_name,parking_name,daily_max_fee,is_primary) VALUES (?,?,?,?)').run('南与野','高い',900,0);
  db.prepare('INSERT INTO parkings (station_name,parking_name,daily_max_fee,is_primary) VALUES (?,?,?,?)').run('南与野','安い',500,0);
  expect(selectParking(db,'南与野').parking_name).toBe('安い');
});

test('selectParking returns null when no parkings', () => {
  expect(selectParking(db,'南与野')).toBeNull();
});
```

- [ ] **Step 2: テストが失敗することを確認**

```bash
npm test -- tests/routes/parkings.test.js
```

Expected: FAIL

- [ ] **Step 3: src/routes/parkings.js を実装**

```js
// src/routes/parkings.js
import { Router } from 'express';

export function selectParking(db, stationName) {
  const primary = db.prepare(
    'SELECT * FROM parkings WHERE station_name=? AND is_primary=1 ORDER BY daily_max_fee ASC LIMIT 1'
  ).get(stationName);
  if (primary) return primary;
  return db.prepare(
    'SELECT * FROM parkings WHERE station_name=? ORDER BY daily_max_fee ASC LIMIT 1'
  ).get(stationName) ?? null;
}

export function createParkingsRouter(db) {
  const router = Router();

  router.get('/', (req, res) => {
    const { station } = req.query;
    const rows = station
      ? db.prepare('SELECT * FROM parkings WHERE station_name=? ORDER BY is_primary DESC,daily_max_fee ASC').all(station)
      : db.prepare('SELECT * FROM parkings ORDER BY station_name,is_primary DESC,daily_max_fee ASC').all();
    res.json(rows);
  });

  router.post('/', (req, res) => {
    const { station_name, parking_name, daily_max_fee, is_primary=0,
            conditions=null, lat=null, lng=null, last_checked=null, source_url=null, note=null } = req.body;
    if (!station_name || !parking_name || daily_max_fee == null) {
      return res.status(400).json({ error: 'station_name, parking_name, daily_max_fee are required' });
    }
    const result = db.prepare(
      'INSERT INTO parkings (station_name,parking_name,daily_max_fee,is_primary,conditions,lat,lng,last_checked,source_url,note) VALUES (?,?,?,?,?,?,?,?,?,?)'
    ).run(station_name, parking_name, daily_max_fee, is_primary, conditions, lat, lng, last_checked, source_url, note);
    res.status(201).json({ id: result.lastInsertRowid });
  });

  router.put('/:id', (req, res) => {
    const allowed = ['parking_name','daily_max_fee','is_primary','conditions','lat','lng','last_checked','source_url','note'];
    const fields = allowed.filter(f => f in req.body);
    if (!fields.length) return res.status(400).json({ error: 'No fields to update' });
    const set = fields.map(f => `${f}=?`).join(',');
    const result = db.prepare(`UPDATE parkings SET ${set} WHERE id=?`).run(...fields.map(f => req.body[f]), req.params.id);
    result.changes ? res.json({ ok: true }) : res.status(404).json({ error: 'Not found' });
  });

  router.delete('/:id', (req, res) => {
    db.prepare('DELETE FROM parkings WHERE id=?').run(req.params.id);
    res.json({ ok: true });
  });

  return router;
}
```

- [ ] **Step 4: テストを実行して PASS を確認**

```bash
npm test -- tests/routes/parkings.test.js
```

Expected: PASS (5 tests)

- [ ] **Step 5: コミット**

```bash
git add src/routes/parkings.js tests/routes/parkings.test.js
git commit -m "feat: add parkings CRUD API with primary selection logic"
```

---

### Task 7: 運賃キャッシュサービス + Ekispert クライアント + 運賃 API

**Files:**
- Create: `src/services/ekispert.js`
- Create: `src/services/fareCache.js`
- Create: `src/routes/fare.js`
- Create: `tests/services/fareCache.test.js`

> ⚠️ 駅すぱあとAPIの正確なエンドポイント・レスポンス構造はAPIキー取得後に公式ドキュメントで確認すること。
> `src/services/ekispert.js` の URL・パラメータ・レスポンスパスは要調整。

**Interfaces:**
- Produces:
  - `fetchFare(from, to, fareType, apiKey): Promise<{fare_yen, travel_minutes, transfers, route_url}>`
  - `setManualFare(db, stationName, destination, fareType, fareYen): void`
  - `clearCachedFare(db, stationName, destination, fareType): void`
  - `getOrFetchFare(db, from, to, fareType, apiKey, fetchFn?): Promise<FareCacheRow | null>`
  - `createFareRouter(db): Router`
    - GET `/api/fare/cache` → `FareCacheRow[]`
    - POST `/api/fare/manual` ← `{station_name, destination, fare_type, fare_yen}`
    - DELETE `/api/fare/cache` ← `{station_name, destination, fare_type}`

- [ ] **Step 1: fareCache のテストを書く**

`tests/services/fareCache.test.js`:
```js
import { getOrFetchFare, setManualFare, clearCachedFare } from '../../src/services/fareCache.js';
import { createTestDb } from '../helpers/testDb.js';

let db;
beforeEach(() => { db = createTestDb(); });
afterEach(() => db.close());

const mockFetch = async () => ({ fare_yen: 570, travel_minutes: 28, transfers: 0, route_url: 'https://example.com' });

test('setManualFare stores with is_manual=1', () => {
  setManualFare(db, '南与野', '東京', 'IC', 570);
  const row = db.prepare('SELECT * FROM fare_cache WHERE station_name=?').get('南与野');
  expect(row.fare_yen).toBe(570);
  expect(row.is_manual).toBe(1);
});

test('getOrFetchFare returns manual fare without calling fetch', async () => {
  setManualFare(db, '南与野', '東京', 'IC', 570);
  let called = false;
  const spy = async () => { called = true; return mockFetch(); };
  const result = await getOrFetchFare(db, '南与野', '東京', 'IC', null, spy);
  expect(result.fare_yen).toBe(570);
  expect(called).toBe(false);
});

test('getOrFetchFare calls fetch when no cache and stores result', async () => {
  const result = await getOrFetchFare(db, '南与野', '東京', 'IC', 'apikey', mockFetch);
  expect(result.fare_yen).toBe(570);
  expect(result.is_manual).toBe(0);
});

test('getOrFetchFare uses stale cache when fetch fails', async () => {
  const staleTime = new Date(Date.now() - 25 * 3600 * 1000).toISOString();
  db.prepare('INSERT INTO fare_cache VALUES (?,?,?,?,?,?,?,?,?)').run('南与野','東京','IC',570,28,0,'https://x',0,staleTime);
  const failFetch = async () => { throw new Error('API down'); };
  const result = await getOrFetchFare(db, '南与野', '東京', 'IC', 'apikey', failFetch);
  expect(result.fare_yen).toBe(570);
});

test('clearCachedFare removes non-manual entry', () => {
  db.prepare('INSERT INTO fare_cache VALUES (?,?,?,?,?,?,?,?,?)').run('南与野','東京','IC',570,28,0,null,0,new Date().toISOString());
  clearCachedFare(db, '南与野', '東京', 'IC');
  expect(db.prepare('SELECT * FROM fare_cache WHERE station_name=?').get('南与野')).toBeUndefined();
});
```

- [ ] **Step 2: テストが失敗することを確認**

```bash
npm test -- tests/services/fareCache.test.js
```

Expected: FAIL

- [ ] **Step 3: src/services/ekispert.js を実装**

```js
// src/services/ekispert.js
import fetch from 'node-fetch';

// ※ APIキー取得後に公式ドキュメントでURL・パラメータ・レスポンス構造を確認して調整すること
const BASE_URL = 'https://api.ekispert.jp/v1/json/search/course/light';

export async function fetchFare(from, to, fareType, apiKey) {
  const params = new URLSearchParams({
    key: apiKey,
    from,
    to,
    searchType: '3',
    icCardFlg: fareType === 'IC' ? '1' : '0',
  });

  const res = await fetch(`${BASE_URL}?${params}`);
  if (!res.ok) throw new Error(`Ekispert API error: ${res.status}`);
  const data = await res.json();

  // ※ 以下のパスは実際のAPIレスポンスに合わせて調整すること
  const course = data?.ResultSet?.Course?.[0];
  if (!course) throw new Error('No route found in API response');

  const priceList = Array.isArray(course.Price) ? course.Price : [course.Price];
  const priceEntry = priceList.find(p => fareType === 'IC' ? p?.kind === 'IC' : p?.kind === 'Normal') ?? priceList[0];

  return {
    fare_yen: Number(priceEntry?.Oneway ?? 0),
    travel_minutes: Number(course.Route?.timeOnBoard ?? 0),
    transfers: Number(course.Route?.transferCount ?? 0),
    route_url: course.Route?.linkUrl ?? null,
  };
}
```

- [ ] **Step 4: src/services/fareCache.js を実装**

```js
// src/services/fareCache.js
import { fetchFare as defaultFetch } from './ekispert.js';

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

export function setManualFare(db, stationName, destination, fareType, fareYen) {
  db.prepare(`
    INSERT INTO fare_cache (station_name,destination,fare_type,fare_yen,travel_minutes,transfers,route_url,is_manual,fetched_at)
    VALUES (?,?,?,?,NULL,NULL,NULL,1,?)
    ON CONFLICT(station_name,destination,fare_type) DO UPDATE SET fare_yen=excluded.fare_yen,is_manual=1,fetched_at=excluded.fetched_at
  `).run(stationName, destination, fareType, fareYen, new Date().toISOString());
}

export function clearCachedFare(db, stationName, destination, fareType) {
  db.prepare('DELETE FROM fare_cache WHERE station_name=? AND destination=? AND fare_type=? AND is_manual=0')
    .run(stationName, destination, fareType);
}

export async function getOrFetchFare(db, stationName, destination, fareType, apiKey, fetchFn = defaultFetch) {
  const cached = db.prepare('SELECT * FROM fare_cache WHERE station_name=? AND destination=? AND fare_type=?')
    .get(stationName, destination, fareType);

  if (cached?.is_manual) return cached;
  if (cached && Date.now() - new Date(cached.fetched_at).getTime() < CACHE_TTL_MS) return cached;
  if (!apiKey) return cached ?? null;

  try {
    const result = await fetchFn(stationName, destination, fareType, apiKey);
    db.prepare(`
      INSERT INTO fare_cache (station_name,destination,fare_type,fare_yen,travel_minutes,transfers,route_url,is_manual,fetched_at)
      VALUES (?,?,?,?,?,?,?,0,?)
      ON CONFLICT(station_name,destination,fare_type) DO UPDATE SET
        fare_yen=excluded.fare_yen,travel_minutes=excluded.travel_minutes,
        transfers=excluded.transfers,route_url=excluded.route_url,is_manual=0,fetched_at=excluded.fetched_at
    `).run(stationName, destination, fareType, result.fare_yen, result.travel_minutes, result.transfers, result.route_url, new Date().toISOString());
    return db.prepare('SELECT * FROM fare_cache WHERE station_name=? AND destination=? AND fare_type=?')
      .get(stationName, destination, fareType);
  } catch {
    return cached ?? null;
  }
}
```

- [ ] **Step 5: src/routes/fare.js を実装**

```js
// src/routes/fare.js
import { Router } from 'express';
import { setManualFare, clearCachedFare } from '../services/fareCache.js';

export function createFareRouter(db) {
  const router = Router();

  router.get('/cache', (req, res) => {
    res.json(db.prepare('SELECT * FROM fare_cache ORDER BY station_name,destination').all());
  });

  router.post('/manual', (req, res) => {
    const { station_name, destination, fare_type = 'IC', fare_yen } = req.body;
    if (!station_name || !destination || fare_yen == null) {
      return res.status(400).json({ error: 'station_name, destination, fare_yen are required' });
    }
    setManualFare(db, station_name, destination, fare_type, fare_yen);
    res.json({ ok: true });
  });

  router.delete('/cache', (req, res) => {
    const { station_name, destination, fare_type = 'IC' } = req.body;
    if (!station_name || !destination) {
      return res.status(400).json({ error: 'station_name and destination are required' });
    }
    clearCachedFare(db, station_name, destination, fare_type);
    res.json({ ok: true });
  });

  return router;
}
```

- [ ] **Step 6: テストを実行して PASS を確認**

```bash
npm test -- tests/services/fareCache.test.js
```

Expected: PASS (5 tests)

- [ ] **Step 7: コミット**

```bash
git add src/services/ekispert.js src/services/fareCache.js src/routes/fare.js tests/services/fareCache.test.js
git commit -m "feat: add fare cache service and Ekispert API client"
```

---

### Task 8: コスト計算サービス（純粋関数）

**Files:**
- Create: `src/services/calculator.js`
- Create: `tests/services/calculator.test.js`

**Interfaces:**
- Produces:
  - `calcGasCost(distanceKm: number, fuelEfficiency: number, gasPrice: number): number` — 往復ガソリン代（整数）
  - `calcRow(station, parking, fareCache, settings): CompareRow`
    - `station: {station_name, line, driving_distance_km}`
    - `parking: {parking_name, daily_max_fee, last_checked} | null`
    - `fareCache: {fare_yen, travel_minutes, transfers, route_url, is_manual, fetched_at} | null`
    - `settings: {fuel_efficiency_km_per_l: number, gas_price_per_l: number}`
    - Returns: `{station_name, line, total_cost, fare_round_trip, parking_fee, gas_cost, parking_name, last_checked, travel_minutes, transfers, route_url, driving_distance_km, fare_source, fare_cached_at}`

- [ ] **Step 1: テストを書く**

`tests/services/calculator.test.js`:
```js
import { calcGasCost, calcRow } from '../../src/services/calculator.js';

const station = { station_name: '南与野', line: '埼京線', driving_distance_km: 4.2 };
const parking = { parking_name: 'P1', daily_max_fee: 600, last_checked: '2026-06-01' };
const fareCache = { fare_yen: 570, travel_minutes: 28, transfers: 0, route_url: 'https://x.com', is_manual: 0, fetched_at: '2026-06-20T10:00:00Z' };
const settings = { fuel_efficiency_km_per_l: 15, gas_price_per_l: 175 };

test('calcGasCost returns integer round trip cost', () => {
  // (4.2 * 2) / 15 * 175 = 98
  expect(calcGasCost(4.2, 15, 175)).toBe(98);
  expect(Number.isInteger(calcGasCost(3.7, 15, 175))).toBe(true);
});

test('calcRow returns correct totals', () => {
  const row = calcRow(station, parking, fareCache, settings);
  expect(row.fare_round_trip).toBe(1140);
  expect(row.parking_fee).toBe(600);
  expect(row.gas_cost).toBe(98);
  expect(row.total_cost).toBe(1838);
  expect(row.fare_source).toBe('api');
});

test('calcRow sets fare_source to manual when is_manual=1', () => {
  expect(calcRow(station, parking, { ...fareCache, is_manual: 1 }, settings).fare_source).toBe('manual');
});

test('calcRow returns null total_cost when parking is null', () => {
  const row = calcRow(station, null, fareCache, settings);
  expect(row.parking_fee).toBeNull();
  expect(row.total_cost).toBeNull();
});

test('calcRow returns null total_cost when fareCache is null', () => {
  const row = calcRow(station, parking, null, settings);
  expect(row.fare_round_trip).toBeNull();
  expect(row.total_cost).toBeNull();
});
```

- [ ] **Step 2: テストが失敗することを確認**

```bash
npm test -- tests/services/calculator.test.js
```

Expected: FAIL

- [ ] **Step 3: src/services/calculator.js を実装**

```js
// src/services/calculator.js

export function calcGasCost(distanceKm, fuelEfficiency, gasPrice) {
  return Math.round((distanceKm * 2) / fuelEfficiency * gasPrice);
}

export function calcRow(station, parking, fareCache, settings) {
  const fareRoundTrip = fareCache ? fareCache.fare_yen * 2 : null;
  const parkingFee = parking ? parking.daily_max_fee : null;
  const gasCost = calcGasCost(station.driving_distance_km, settings.fuel_efficiency_km_per_l, settings.gas_price_per_l);
  const totalCost = fareRoundTrip != null && parkingFee != null ? fareRoundTrip + parkingFee + gasCost : null;

  return {
    station_name: station.station_name,
    line: station.line ?? null,
    total_cost: totalCost,
    fare_round_trip: fareRoundTrip,
    parking_fee: parkingFee,
    gas_cost: gasCost,
    parking_name: parking?.parking_name ?? null,
    last_checked: parking?.last_checked ?? null,
    travel_minutes: fareCache?.travel_minutes ?? null,
    transfers: fareCache?.transfers ?? null,
    route_url: fareCache?.route_url ?? null,
    driving_distance_km: station.driving_distance_km,
    fare_source: fareCache ? (fareCache.is_manual ? 'manual' : 'api') : null,
    fare_cached_at: fareCache?.fetched_at ?? null,
  };
}
```

- [ ] **Step 4: テストを実行して PASS を確認**

```bash
npm test -- tests/services/calculator.test.js
```

Expected: PASS (5 tests)

- [ ] **Step 5: コミット**

```bash
git add src/services/calculator.js tests/services/calculator.test.js
git commit -m "feat: add cost calculator service"
```

---

### Task 9: 比較 API

**Files:**
- Create: `src/routes/compare.js`
- Create: `tests/routes/compare.test.js`

**Interfaces:**
- Consumes: `selectParking` (parkings.js), `getOrFetchFare` (fareCache.js), `calcRow` (calculator.js)
- Produces:
  - `createCompareRouter(db): Router`
  - GET `/api/compare?destination=東京&fare_type=IC` → `CompareRow[]`（total_cost 昇順、null は末尾）

- [ ] **Step 1: テストを書く**

`tests/routes/compare.test.js`:
```js
import request from 'supertest';
import express from 'express';
import { createCompareRouter } from '../../src/routes/compare.js';
import { createTestDb } from '../helpers/testDb.js';

function makeApp(db) {
  const app = express();
  app.use('/api/compare', createCompareRouter(db));
  return app;
}

let db;
beforeEach(() => {
  db = createTestDb();
  db.prepare('INSERT INTO stations VALUES (?,?,?,?)').run('南与野','埼京線',4.2,null);
  db.prepare('INSERT INTO stations VALUES (?,?,?,?)').run('浦和','京浜東北線',2.8,null);
  db.prepare('INSERT INTO parkings (station_name,parking_name,daily_max_fee,is_primary) VALUES (?,?,?,?)').run('南与野','P1',600,1);
  db.prepare('INSERT INTO parkings (station_name,parking_name,daily_max_fee,is_primary) VALUES (?,?,?,?)').run('浦和','P2',800,1);
  db.prepare('INSERT INTO settings VALUES (?,?)').run('fuel_efficiency_km_per_l','15');
  db.prepare('INSERT INTO settings VALUES (?,?)').run('gas_price_per_l','175');
  const now = new Date().toISOString();
  db.prepare('INSERT INTO fare_cache VALUES (?,?,?,?,?,?,?,?,?)').run('南与野','東京','IC',570,28,0,'https://x',1,now);
  db.prepare('INSERT INTO fare_cache VALUES (?,?,?,?,?,?,?,?,?)').run('浦和','東京','IC',740,22,0,'https://y',1,now);
});
afterEach(() => db.close());

test('returns rows sorted by total_cost ascending', async () => {
  const res = await request(makeApp(db)).get('/api/compare?destination=東京&fare_type=IC');
  expect(res.status).toBe(200);
  expect(res.body).toHaveLength(2);
  expect(res.body[0].station_name).toBe('南与野');
  expect(res.body[0].total_cost).toBeLessThan(res.body[1].total_cost);
});

test('uses destination_default from settings when not specified', async () => {
  db.prepare('INSERT INTO settings VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run('destination_default','東京');
  const res = await request(makeApp(db)).get('/api/compare');
  expect(res.status).toBe(200);
  expect(res.body).toHaveLength(2);
});

test('returns 400 when destination is empty and no default', async () => {
  const res = await request(makeApp(db)).get('/api/compare?destination=');
  expect(res.status).toBe(400);
});
```

- [ ] **Step 2: テストが失敗することを確認**

```bash
npm test -- tests/routes/compare.test.js
```

Expected: FAIL

- [ ] **Step 3: src/routes/compare.js を実装**

```js
// src/routes/compare.js
import { Router } from 'express';
import { selectParking } from './parkings.js';
import { getOrFetchFare } from '../services/fareCache.js';
import { calcRow } from '../services/calculator.js';

export function createCompareRouter(db) {
  const router = Router();

  router.get('/', async (req, res) => {
    const getSetting = (key) => db.prepare('SELECT value FROM settings WHERE key=?').get(key)?.value ?? null;
    const destination = req.query.destination || getSetting('destination_default') || '';
    if (!destination) return res.status(400).json({ error: 'destination is required' });

    const fareType = req.query.fare_type || getSetting('fare_type') || 'IC';
    const fuelEff = Number(getSetting('fuel_efficiency_km_per_l') ?? 0);
    const gasPrice = Number(getSetting('gas_price_per_l') ?? 0);
    const apiKey = process.env.EKISPERT_API_KEY || null;
    const settings = { fuel_efficiency_km_per_l: fuelEff, gas_price_per_l: gasPrice };

    const stations = db.prepare('SELECT * FROM stations ORDER BY station_name').all();

    const rows = await Promise.all(stations.map(async (station) => {
      const parking = selectParking(db, station.station_name);
      const fare = await getOrFetchFare(db, station.station_name, destination, fareType, apiKey);
      return calcRow(station, parking, fare, settings);
    }));

    rows.sort((a, b) => {
      if (a.total_cost == null && b.total_cost == null) return 0;
      if (a.total_cost == null) return 1;
      if (b.total_cost == null) return -1;
      return a.total_cost - b.total_cost;
    });

    res.json(rows);
  });

  return router;
}
```

- [ ] **Step 4: テストを実行して PASS を確認**

```bash
npm test -- tests/routes/compare.test.js
```

Expected: PASS (3 tests)

- [ ] **Step 5: コミット**

```bash
git add src/routes/compare.js tests/routes/compare.test.js
git commit -m "feat: add compare API"
```

---

### Task 10: CSV インポート API

**Files:**
- Create: `src/routes/import.js`
- Create: `tests/routes/import.test.js`

**Interfaces:**
- Produces:
  - `createImportRouter(db): Router`
  - POST `/api/import/stations` — multipart `file` フィールド → `{imported: number, errors: string[]}`
  - POST `/api/import/parkings` — multipart `file` フィールド → `{imported: number, errors: string[]}`

- [ ] **Step 1: テストを書く**

`tests/routes/import.test.js`:
```js
import request from 'supertest';
import express from 'express';
import { createImportRouter } from '../../src/routes/import.js';
import { createTestDb } from '../helpers/testDb.js';

function makeApp(db) {
  const app = express();
  app.use('/api/import', createImportRouter(db));
  return app;
}

let db;
beforeEach(() => { db = createTestDb(); });
afterEach(() => db.close());

const stationsCsv = 'station_name,line,driving_distance_km,note\n南与野,埼京線,4.2,テスト\n浦和,京浜東北線,2.8,';
const parkingsCsv = 'station_name,parking_name,daily_max_fee,is_primary,conditions,lat,lng,last_checked,source_url,note\n南与野,P1,600,1,平日のみ,,,2026-06-01,,';

test('imports valid stations CSV', async () => {
  const res = await request(makeApp(db)).post('/api/import/stations')
    .attach('file', Buffer.from(stationsCsv), { filename: 'stations.csv', contentType: 'text/csv' });
  expect(res.status).toBe(200);
  expect(res.body.imported).toBe(2);
  expect(res.body.errors).toHaveLength(0);
  expect(db.prepare('SELECT COUNT(*) as c FROM stations').get().c).toBe(2);
});

test('imports valid parkings CSV', async () => {
  db.prepare('INSERT INTO stations VALUES (?,?,?,?)').run('南与野','埼京線',4.2,null);
  const res = await request(makeApp(db)).post('/api/import/parkings')
    .attach('file', Buffer.from(parkingsCsv), { filename: 'parkings.csv', contentType: 'text/csv' });
  expect(res.body.imported).toBe(1);
  expect(res.body.errors).toHaveLength(0);
});

test('reports errors for invalid rows and continues', async () => {
  const bad = 'station_name,line,driving_distance_km,note\n,埼京線,4.2,no name\n南与野,埼京線,bad,bad dist';
  const res = await request(makeApp(db)).post('/api/import/stations')
    .attach('file', Buffer.from(bad), { filename: 's.csv', contentType: 'text/csv' });
  expect(res.body.imported).toBe(0);
  expect(res.body.errors).toHaveLength(2);
});
```

- [ ] **Step 2: テストが失敗することを確認**

```bash
npm test -- tests/routes/import.test.js
```

Expected: FAIL

- [ ] **Step 3: src/routes/import.js を実装**

```js
// src/routes/import.js
import { Router } from 'express';
import multer from 'multer';
import { parse } from 'csv-parse/sync';

const upload = multer({ storage: multer.memoryStorage() });

export function createImportRouter(db) {
  const router = Router();

  router.post('/stations', upload.single('file'), (req, res) => {
    const records = parse(req.file.buffer, { columns: true, skip_empty_lines: true, bom: true });
    let imported = 0;
    const errors = [];
    const stmt = db.prepare(
      'INSERT INTO stations (station_name,line,driving_distance_km,note) VALUES (?,?,?,?) ON CONFLICT(station_name) DO UPDATE SET line=excluded.line,driving_distance_km=excluded.driving_distance_km,note=excluded.note'
    );
    for (const [i, row] of records.entries()) {
      const dist = Number(row.driving_distance_km);
      if (!row.station_name || isNaN(dist)) {
        errors.push(`行${i + 2}: station_name または driving_distance_km が不正`);
        continue;
      }
      try { stmt.run(row.station_name, row.line || null, dist, row.note || null); imported++; }
      catch (e) { errors.push(`行${i + 2}: ${e.message}`); }
    }
    res.json({ imported, errors });
  });

  router.post('/parkings', upload.single('file'), (req, res) => {
    const records = parse(req.file.buffer, { columns: true, skip_empty_lines: true, bom: true });
    let imported = 0;
    const errors = [];
    const stmt = db.prepare(
      'INSERT INTO parkings (station_name,parking_name,daily_max_fee,is_primary,conditions,lat,lng,last_checked,source_url,note) VALUES (?,?,?,?,?,?,?,?,?,?)'
    );
    for (const [i, row] of records.entries()) {
      const fee = Number(row.daily_max_fee);
      if (!row.station_name || !row.parking_name || isNaN(fee)) {
        errors.push(`行${i + 2}: station_name, parking_name, daily_max_fee が不正`);
        continue;
      }
      try {
        stmt.run(row.station_name, row.parking_name, fee,
          row.is_primary ? Number(row.is_primary) : 0,
          row.conditions || null, row.lat ? Number(row.lat) : null, row.lng ? Number(row.lng) : null,
          row.last_checked || null, row.source_url || null, row.note || null);
        imported++;
      } catch (e) { errors.push(`行${i + 2}: ${e.message}`); }
    }
    res.json({ imported, errors });
  });

  return router;
}
```

- [ ] **Step 4: テストを実行して PASS を確認**

```bash
npm test -- tests/routes/import.test.js
```

Expected: PASS (3 tests)

- [ ] **Step 5: コミット**

```bash
git add src/routes/import.js tests/routes/import.test.js
git commit -m "feat: add CSV import API"
```

---

### Task 11: Express サーバー配線

**Files:**
- Create: `src/server.js`

**Interfaces:**
- Consumes: 全ルーター、`authMiddleware`、`createDb`
- Produces:
  - `createApp(db): express.Application` — テスト用エクスポート
  - `npm start` で `http://localhost:3000` が起動する

- [ ] **Step 1: src/server.js を作成**

```js
// src/server.js
import express from 'express';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import dotenv from 'dotenv';
import { createDb } from './db.js';
import { authMiddleware } from './auth.js';
import { createCompareRouter } from './routes/compare.js';
import { createStationsRouter } from './routes/stations.js';
import { createParkingsRouter } from './routes/parkings.js';
import { createSettingsRouter } from './routes/settings.js';
import { createFareRouter } from './routes/fare.js';
import { createImportRouter } from './routes/import.js';

dotenv.config();

const __dirname = dirname(fileURLToPath(import.meta.url));

export function createApp(db) {
  const app = express();
  app.use(express.json());
  app.use(express.static(join(__dirname, 'public')));
  app.use('/api', authMiddleware);
  app.use('/api/compare', createCompareRouter(db));
  app.use('/api/stations', createStationsRouter(db));
  app.use('/api/parkings', createParkingsRouter(db));
  app.use('/api/settings', createSettingsRouter(db));
  app.use('/api/fare', createFareRouter(db));
  app.use('/api/import', createImportRouter(db));
  return app;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const dbPath = process.env.DB_PATH || join(process.env.HOME || '/home', 'data', 'travel.db');
  const db = createDb(dbPath);
  const port = Number(process.env.PORT) || 3000;
  createApp(db).listen(port, () => console.log(`Server running on port ${port}`));
}
```

- [ ] **Step 2: 全テストを実行して PASS を確認**

```bash
npm test
```

Expected: 全テスト PASS

- [ ] **Step 3: 動作確認**

```bash
MCP_API_KEY=test npm start
```

別ターミナルで:
```bash
curl -H "Authorization: Bearer test" http://localhost:3000/api/stations
```

Expected: `[]`

- [ ] **Step 4: コミット**

```bash
git add src/server.js
git commit -m "feat: wire all routes into Express server"
```

---

### Task 12: フロントエンド（3画面）

**Files:**
- Create: `src/public/style.css`
- Create: `src/public/app.js`
- Create: `src/public/index.html`
- Create: `src/public/settings.html`
- Create: `src/public/data.html`

**Interfaces:**
- Consumes: 全 `/api/*` エンドポイント
- Produces: ブラウザで動作する3画面

- [ ] **Step 1: src/public/style.css を作成**

```css
*,*::before,*::after{box-sizing:border-box}
body{font-family:system-ui,sans-serif;margin:0;background:#f5f5f5;color:#333}
header{background:#1a73e8;color:#fff;padding:12px 16px;display:flex;align-items:center;gap:16px}
header h1{margin:0;font-size:1.1rem;flex:1}
header a{color:#fff;text-decoration:none;font-size:.9rem;padding:6px 12px;border:1px solid rgba(255,255,255,.5);border-radius:4px}
main{padding:16px;max-width:960px;margin:0 auto}
.toolbar{display:flex;gap:12px;align-items:center;flex-wrap:wrap;margin-bottom:16px}
.toolbar input{padding:8px;border:1px solid #ccc;border-radius:4px;font-size:1rem}
.btn{padding:8px 16px;background:#1a73e8;color:#fff;border:none;border-radius:4px;cursor:pointer;font-size:1rem}
.btn:hover{background:#1558b0}
.btn-sm{padding:4px 10px;border:1px solid #ccc;background:#fff;border-radius:4px;cursor:pointer;font-size:.85rem}
.btn-danger{border-color:#d93025;color:#d93025}
table{width:100%;border-collapse:collapse;background:#fff;border-radius:8px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,.1)}
th{background:#e8f0fe;padding:10px 8px;text-align:right;font-size:.85rem}
th:first-child{text-align:left}
td{padding:10px 8px;border-top:1px solid #eee;text-align:right;font-size:.9rem}
td:first-child{text-align:left}
tr.best td{background:#fff8e1;font-weight:bold}
a.sl{color:#1a73e8;text-decoration:none}
a.sl:hover{text-decoration:underline}
.warn{color:#d93025;font-size:.75rem}
.badge{font-size:.7rem;background:#fce8e6;color:#c5221f;padding:1px 4px;border-radius:3px}
.alert{background:#fce8e6;border:1px solid #f5c6c3;border-radius:6px;padding:12px 16px;margin-bottom:16px;color:#c5221f}
.info{background:#e8f0fe;border:1px solid #c5d7f9;border-radius:6px;padding:12px 16px;margin-bottom:16px;color:#1558b0}
form label{display:block;margin-bottom:4px;font-size:.9rem;font-weight:500}
form input,form select{width:100%;padding:8px;border:1px solid #ccc;border-radius:4px;font-size:1rem;margin-bottom:12px}
.tab-bar{display:flex;gap:8px;margin-bottom:16px}
.tab-bar button{padding:8px 16px;border:1px solid #ccc;background:#fff;border-radius:4px;cursor:pointer}
.tab-bar button.active{background:#1a73e8;color:#fff;border-color:#1a73e8}
.card{background:#fff;border-radius:8px;box-shadow:0 1px 3px rgba(0,0,0,.1)}
.item{padding:12px 16px;border-top:1px solid #eee;display:flex;gap:8px;align-items:center}
.item:first-child{border-top:none}
.item-info{flex:1}
dialog{border:none;border-radius:8px;padding:24px;min-width:320px;box-shadow:0 4px 20px rgba(0,0,0,.2)}
dialog h3{margin-top:0}
.modal-footer{display:flex;gap:8px;justify-content:flex-end;margin-top:16px}
```

- [ ] **Step 2: src/public/app.js を作成**

```js
// src/public/app.js
export const fmt = (yen) => yen == null ? '—' : yen.toLocaleString('ja-JP') + '円';
export const daysAgo = (d) => d ? Math.floor((Date.now() - new Date(d).getTime()) / 86400000) : Infinity;
export async function apiFetch(path, opts = {}) {
  const res = await fetch(path, opts);
  if (!res.ok) { const e = await res.json().catch(() => ({ error: res.statusText })); throw new Error(e.error || res.statusText); }
  return res.json();
}
```

- [ ] **Step 3: src/public/index.html を作成**

```html
<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>駅別移動コスト比較</title><link rel="stylesheet" href="style.css">
</head>
<body>
<header>
  <h1>駅別移動コスト比較</h1>
  <a href="settings.html">⚙ 設定</a><a href="data.html">📋 データ管理</a>
</header>
<main>
  <div id="alerts"></div>
  <div class="toolbar">
    <input type="text" id="destination" placeholder="目的地（例：東京）" style="min-width:160px">
    <span>
      <label><input type="radio" name="ft" value="IC" checked> IC</label>
      <label><input type="radio" name="ft" value="ticket"> きっぷ</label>
    </span>
    <button class="btn" id="compareBtn">比較する</button>
  </div>
  <div id="result"></div>
</main>
<script type="module">
import { fmt, daysAgo, apiFetch } from './app.js';

async function init() {
  const s = await apiFetch('/api/settings').catch(() => ({}));
  if (s.destination_default) document.getElementById('destination').value = s.destination_default;
  if (s.fare_type) document.querySelector(`input[name=ft][value=${s.fare_type}]`).checked = true;
}

async function compare() {
  const dest = document.getElementById('destination').value.trim();
  const ft = document.querySelector('input[name=ft]:checked').value;
  const alerts = document.getElementById('alerts');
  alerts.innerHTML = '';
  if (!dest) { alerts.innerHTML = '<div class="alert">目的地を入力してください</div>'; return; }
  let rows;
  try { rows = await apiFetch(`/api/compare?destination=${encodeURIComponent(dest)}&fare_type=${ft}`); }
  catch (e) { alerts.innerHTML = `<div class="alert">${e.message}</div>`; return; }
  if (!rows.length) { document.getElementById('result').innerHTML = '<div class="info">データ管理画面から駅を追加してください</div>'; return; }
  if (rows.some(r => !r.fare_source)) alerts.innerHTML += '<div class="alert">駅すぱあとAPIキーが未設定です。手動運賃で表示しています</div>';
  const best = rows.find(r => r.total_cost != null)?.total_cost;
  const tbody = rows.map(r => {
    const isBest = r.total_cost != null && r.total_cost === best;
    const stale = daysAgo(r.last_checked) >= 30 ? '<span class="warn"> ⚠</span>' : '';
    const manual = r.fare_source === 'manual' ? ' <span class="badge">手動</span>' : '';
    const stn = r.route_url ? `<a class="sl" href="${r.route_url}" target="_blank">${isBest?'★':''}${r.station_name}</a>` : `${isBest?'★':''}${r.station_name}`;
    return `<tr class="${isBest?'best':''}">
      <td>${stn}<br><small>${r.line??''}</small></td>
      <td>${fmt(r.total_cost)}</td>
      <td>${fmt(r.fare_round_trip)}${manual}</td>
      <td>${fmt(r.parking_fee)}<br><small>${r.parking_name??''}${stale}</small></td>
      <td>${fmt(r.gas_cost)}</td>
      <td>${r.travel_minutes!=null?r.travel_minutes+'分':'—'}</td>
      <td>${r.transfers!=null?r.transfers+'回':'—'}</td>
    </tr>`;
  }).join('');
  document.getElementById('result').innerHTML = `<table>
    <thead><tr><th>駅名</th><th>合計(円)</th><th>電車代(往復)</th><th>駐車場(円)</th><th>ガソリン代</th><th>時間</th><th>乗換</th></tr></thead>
    <tbody>${tbody}</tbody></table>`;
}

document.getElementById('compareBtn').addEventListener('click', compare);
init().then(compare);
</script>
</body></html>
```

- [ ] **Step 4: src/public/settings.html を作成**

```html
<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>設定</title><link rel="stylesheet" href="style.css">
</head>
<body>
<header><h1>設定</h1><a href="/">← 比較表へ</a><a href="data.html">📋 データ管理</a></header>
<main>
  <div id="alert"></div>
  <form id="f">
    <label>自宅ラベル（表示用）<input type="text" name="home_label" placeholder="例：自宅"></label>
    <label>目的地デフォルト<input type="text" name="destination_default" placeholder="例：東京"></label>
    <label>燃費 (km/L)<input type="number" name="fuel_efficiency_km_per_l" step="0.1" min="0"></label>
    <label>ガソリン単価 (円/L)<input type="number" name="gas_price_per_l" step="1" min="0"></label>
    <label>運賃種別デフォルト
      <select name="fare_type"><option value="IC">IC（交通系ICカード）</option><option value="ticket">きっぷ</option></select>
    </label>
    <button type="submit" class="btn">保存</button>
  </form>
</main>
<script type="module">
import { apiFetch } from './app.js';
const form = document.getElementById('f');
apiFetch('/api/settings').then(s => { for (const [k,v] of Object.entries(s)) { const el = form.elements[k]; if (el) el.value = v; } });
form.addEventListener('submit', async e => {
  e.preventDefault();
  const data = Object.fromEntries(new FormData(form));
  data.fuel_efficiency_km_per_l = Number(data.fuel_efficiency_km_per_l);
  data.gas_price_per_l = Number(data.gas_price_per_l);
  try {
    await apiFetch('/api/settings', { method:'PUT', headers:{'Content-Type':'application/json'}, body:JSON.stringify(data) });
    document.getElementById('alert').innerHTML = '<div class="info">保存しました</div>';
    setTimeout(() => document.getElementById('alert').innerHTML = '', 3000);
  } catch(e) { document.getElementById('alert').innerHTML = `<div class="alert">${e.message}</div>`; }
});
</script>
</body></html>
```

- [ ] **Step 5: src/public/data.html を作成**

```html
<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>データ管理</title><link rel="stylesheet" href="style.css">
</head>
<body>
<header><h1>データ管理</h1><a href="/">← 比較表へ</a><a href="settings.html">⚙ 設定</a></header>
<main>
  <div id="alert"></div>
  <div style="display:flex;gap:12px;align-items:center;flex-wrap:wrap;margin-bottom:16px">
    <div class="tab-bar">
      <button id="t-stations" class="active" onclick="show('stations')">駅一覧</button>
      <button id="t-parkings" onclick="show('parkings')">駐車場一覧</button>
      <button id="t-fare" onclick="show('fare')">運賃手動設定</button>
    </div>
    <label style="margin-left:auto;cursor:pointer">CSVインポート 📁<input type="file" id="csvFile" accept=".csv" style="display:none"></label>
  </div>

  <div id="p-stations">
    <button class="btn" style="margin-bottom:12px" onclick="openStn()">+ 駅を追加</button>
    <div id="stationList" class="card"></div>
  </div>
  <div id="p-parkings" style="display:none">
    <button class="btn" style="margin-bottom:12px" onclick="openPkg()">+ 駐車場を追加</button>
    <div id="parkingList" class="card"></div>
  </div>
  <div id="p-fare" style="display:none">
    <p style="font-size:.9rem;color:#666">目的地ごとに片道運賃を手動で設定します（APIキャッシュより優先されます）。</p>
    <form id="fareForm" style="display:flex;gap:8px;flex-wrap:wrap;align-items:flex-end;margin-bottom:16px">
      <label style="font-size:.85rem">駅名<br><input type="text" name="station_name" style="width:120px;padding:6px;border:1px solid #ccc;border-radius:4px"></label>
      <label style="font-size:.85rem">目的地<br><input type="text" name="destination" style="width:100px;padding:6px;border:1px solid #ccc;border-radius:4px"></label>
      <label style="font-size:.85rem">種別<br><select name="fare_type" style="padding:6px;border:1px solid #ccc;border-radius:4px"><option value="IC">IC</option><option value="ticket">きっぷ</option></select></label>
      <label style="font-size:.85rem">片道運賃(円)<br><input type="number" name="fare_yen" min="0" style="width:100px;padding:6px;border:1px solid #ccc;border-radius:4px"></label>
      <button type="submit" class="btn">保存</button>
    </form>
    <div id="fareList" class="card"></div>
  </div>

  <dialog id="modal">
    <h3 id="modalTitle"></h3>
    <form id="modalForm"></form>
    <div class="modal-footer">
      <button class="btn-sm" onclick="document.getElementById('modal').close()">キャンセル</button>
      <button class="btn" id="modalOk">保存</button>
    </div>
  </dialog>
</main>
<script type="module">
import { apiFetch, daysAgo } from './app.js';
let tab = 'stations';

window.show = (t) => {
  tab = t;
  ['stations','parkings','fare'].forEach(x => {
    document.getElementById(`p-${x}`).style.display = x===t?'':'none';
    document.getElementById(`t-${x}`).classList.toggle('active', x===t);
  });
  if (t==='stations') loadStations();
  if (t==='parkings') loadParkings();
  if (t==='fare') loadFare();
};

// ─── 駅 ───
async function loadStations() {
  const list = await apiFetch('/api/stations');
  document.getElementById('stationList').innerHTML = list.length === 0
    ? '<div class="item">駅が登録されていません</div>'
    : list.map(s => `<div class="item"><div class="item-info"><b>${s.station_name}</b> ${s.line??''} — ${s.driving_distance_km}km${s.note?` (${s.note})`:''}</div>
        <button class="btn-sm" onclick='openStn(${JSON.stringify(s).replace(/'/g,"&#39;")})'>編集</button>
        <button class="btn-sm btn-danger" onclick="delStn('${s.station_name}')">削除</button></div>`).join('');
}
window.openStn = (s=null) => {
  document.getElementById('modalTitle').textContent = s ? '駅を編集' : '駅を追加';
  document.getElementById('modalForm').innerHTML = `
    <label>駅名（駅すぱあとAPIの正式名）<input type="text" name="station_name" value="${s?.station_name??''}" ${s?'readonly':''} style="width:100%;padding:6px;border:1px solid #ccc;border-radius:4px;margin-bottom:8px"></label>
    <label>路線（表示用）<input type="text" name="line" value="${s?.line??''}" style="width:100%;padding:6px;border:1px solid #ccc;border-radius:4px;margin-bottom:8px"></label>
    <label>片道距離 (km)<input type="number" name="driving_distance_km" step="0.1" value="${s?.driving_distance_km??''}" style="width:100%;padding:6px;border:1px solid #ccc;border-radius:4px;margin-bottom:8px"></label>
    <label>メモ<input type="text" name="note" value="${s?.note??''}" style="width:100%;padding:6px;border:1px solid #ccc;border-radius:4px"></label>`;
  document.getElementById('modalOk').onclick = async () => {
    const d = Object.fromEntries(new FormData(document.getElementById('modalForm')));
    d.driving_distance_km = Number(d.driving_distance_km);
    if (s) await apiFetch(`/api/stations/${encodeURIComponent(s.station_name)}`, {method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(d)});
    else await apiFetch('/api/stations', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(d)});
    document.getElementById('modal').close(); loadStations();
  };
  document.getElementById('modal').showModal();
};
window.delStn = async (name) => {
  if (!confirm(`「${name}」を削除しますか？`)) return;
  await apiFetch(`/api/stations/${encodeURIComponent(name)}`, {method:'DELETE'}); loadStations();
};

// ─── 駐車場 ───
async function loadParkings() {
  const list = await apiFetch('/api/parkings');
  document.getElementById('parkingList').innerHTML = list.length === 0
    ? '<div class="item">駐車場が登録されていません</div>'
    : list.map(p => {
        const stale = daysAgo(p.last_checked) >= 30 ? ' <span class="warn">⚠ 古い</span>' : '';
        const prim = p.is_primary ? ' <span style="font-size:.75rem;background:#e8f5e9;color:#2e7d32;padding:1px 6px;border-radius:3px">メイン</span>' : '';
        return `<div class="item"><div class="item-info"><b>${p.station_name}</b>${prim} ${p.parking_name} — ${p.daily_max_fee.toLocaleString()}円/日${stale}</div>
          <button class="btn-sm" onclick='openPkg(${JSON.stringify(p).replace(/'/g,"&#39;")})'>編集</button>
          <button class="btn-sm btn-danger" onclick="delPkg(${p.id})">削除</button></div>`;
      }).join('');
}
window.openPkg = (p=null) => {
  document.getElementById('modalTitle').textContent = p ? '駐車場を編集' : '駐車場を追加';
  document.getElementById('modalForm').innerHTML = `
    <label>駅名<input type="text" name="station_name" value="${p?.station_name??''}" style="width:100%;padding:6px;border:1px solid #ccc;border-radius:4px;margin-bottom:8px"></label>
    <label>駐車場名<input type="text" name="parking_name" value="${p?.parking_name??''}" style="width:100%;padding:6px;border:1px solid #ccc;border-radius:4px;margin-bottom:8px"></label>
    <label>1日上限料金(円)<input type="number" name="daily_max_fee" value="${p?.daily_max_fee??''}" style="width:100%;padding:6px;border:1px solid #ccc;border-radius:4px;margin-bottom:8px"></label>
    <label style="display:flex;align-items:center;gap:8px;margin-bottom:8px"><input type="checkbox" name="is_primary" value="1" ${p?.is_primary?'checked':''}> メイン駐車場として計算に使う</label>
    <label>料金条件<input type="text" name="conditions" value="${p?.conditions??''}" style="width:100%;padding:6px;border:1px solid #ccc;border-radius:4px;margin-bottom:8px"></label>
    <label>確認日<input type="date" name="last_checked" value="${p?.last_checked??''}" style="width:100%;padding:6px;border:1px solid #ccc;border-radius:4px;margin-bottom:8px"></label>
    <label>出典URL<input type="url" name="source_url" value="${p?.source_url??''}" style="width:100%;padding:6px;border:1px solid #ccc;border-radius:4px"></label>`;
  document.getElementById('modalOk').onclick = async () => {
    const fd = new FormData(document.getElementById('modalForm'));
    const d = Object.fromEntries(fd);
    d.daily_max_fee = Number(d.daily_max_fee);
    d.is_primary = fd.get('is_primary') === '1' ? 1 : 0;
    if (p) await apiFetch(`/api/parkings/${p.id}`, {method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(d)});
    else await apiFetch('/api/parkings', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(d)});
    document.getElementById('modal').close(); loadParkings();
  };
  document.getElementById('modal').showModal();
};
window.delPkg = async (id) => {
  if (!confirm('この駐車場を削除しますか？')) return;
  await apiFetch(`/api/parkings/${id}`, {method:'DELETE'}); loadParkings();
};

// ─── 運賃 ───
async function loadFare() {
  const list = await apiFetch('/api/fare/cache').catch(() => []);
  document.getElementById('fareList').innerHTML = list.length === 0
    ? '<div class="item">手動設定された運賃はありません</div>'
    : list.map(r => `<div class="item"><div class="item-info">${r.station_name} → ${r.destination} (${r.fare_type}): ${r.fare_yen.toLocaleString()}円 <span style="font-size:.8rem;color:#666">${r.is_manual?'手動':'APIキャッシュ'}</span></div>
        ${r.is_manual?`<button class="btn-sm btn-danger" onclick="clearFare('${r.station_name}','${r.destination}','${r.fare_type}')">クリア</button>`:''}</div>`).join('');
}
window.clearFare = async (s,d,t) => {
  await apiFetch('/api/fare/cache', {method:'DELETE',headers:{'Content-Type':'application/json'},body:JSON.stringify({station_name:s,destination:d,fare_type:t})});
  loadFare();
};
document.getElementById('fareForm').addEventListener('submit', async e => {
  e.preventDefault();
  const d = Object.fromEntries(new FormData(e.target));
  d.fare_yen = Number(d.fare_yen);
  await apiFetch('/api/fare/manual', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(d)});
  e.target.reset(); loadFare();
});

// ─── CSV ───
document.getElementById('csvFile').addEventListener('change', async e => {
  const file = e.target.files[0]; if (!file) return;
  const type = file.name.toLowerCase().includes('station') ? 'stations' : 'parkings';
  const form = new FormData(); form.append('file', file);
  const r = await apiFetch(`/api/import/${type}`, {method:'POST',body:form});
  const msg = `${r.imported}件インポートしました` + (r.errors.length ? `<br>${r.errors.join('<br>')}` : '');
  document.getElementById('alert').innerHTML = `<div class="${r.errors.length?'alert':'info'}">${msg}</div>`;
  e.target.value = '';
  if (tab==='stations') loadStations();
  if (tab==='parkings') loadParkings();
});

loadStations();
</script>
</body></html>
```

- [ ] **Step 6: ブラウザで3画面の動作確認**

```bash
MCP_API_KEY=test npm start
```

- `http://localhost:3000/` — 比較表（駅データなしなら案内メッセージ）
- `http://localhost:3000/settings.html` — 設定の保存・反映
- `http://localhost:3000/data.html` — 駅・駐車場の追加・削除、CSVインポート

- [ ] **Step 7: コミット**

```bash
git add src/public/
git commit -m "feat: add frontend (compare, settings, data management)"
```

---

### Task 13: MCP サーバー

**Files:**
- Create: `mcp-server/index.js`

**Interfaces:**
- Consumes: Web アプリの `/api/*`（環境変数 `APP_URL`, `MCP_API_KEY`）
- Produces: Claude Desktop から使用可能な MCP サーバー（10ツール）

- [ ] **Step 1: MCP SDK をインストール**

```bash
npm install @modelcontextprotocol/sdk
```

- [ ] **Step 2: mcp-server/index.js を作成**

```js
// mcp-server/index.js
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import fetch from 'node-fetch';
import dotenv from 'dotenv';
dotenv.config();

const BASE_URL = process.env.APP_URL || 'http://localhost:3000';
const API_KEY = process.env.MCP_API_KEY || '';

async function api(method, path, body = null) {
  const opts = { method, headers: { 'Authorization': `Bearer ${API_KEY}`, 'Content-Type': 'application/json' } };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(`${BASE_URL}${path}`, opts);
  if (!res.ok) throw new Error(`API ${res.status}: ${await res.text()}`);
  return res.json();
}

const TOOLS = [
  { name:'list_stations', description:'登録されている駅の一覧を返す', inputSchema:{type:'object',properties:{}} },
  { name:'add_station', description:'駅を追加する', inputSchema:{type:'object',required:['station_name','driving_distance_km'],properties:{station_name:{type:'string'},line:{type:'string'},driving_distance_km:{type:'number'},note:{type:'string'}}} },
  { name:'update_station', description:'駅情報を更新する', inputSchema:{type:'object',required:['station_name'],properties:{station_name:{type:'string'},line:{type:'string'},driving_distance_km:{type:'number'},note:{type:'string'}}} },
  { name:'delete_station', description:'駅を削除する', inputSchema:{type:'object',required:['station_name'],properties:{station_name:{type:'string'}}} },
  { name:'list_parkings', description:'駐車場一覧を返す。station_name で絞り込み可', inputSchema:{type:'object',properties:{station_name:{type:'string'}}} },
  { name:'add_parking', description:'駐車場を追加する', inputSchema:{type:'object',required:['station_name','parking_name','daily_max_fee'],properties:{station_name:{type:'string'},parking_name:{type:'string'},daily_max_fee:{type:'number'},is_primary:{type:'boolean'},conditions:{type:'string'},last_checked:{type:'string'},source_url:{type:'string'},note:{type:'string'}}} },
  { name:'update_parking', description:'駐車場情報を更新する', inputSchema:{type:'object',required:['id'],properties:{id:{type:'number'},parking_name:{type:'string'},daily_max_fee:{type:'number'},is_primary:{type:'boolean'},conditions:{type:'string'},last_checked:{type:'string'},source_url:{type:'string'},note:{type:'string'}}} },
  { name:'delete_parking', description:'駐車場を削除する', inputSchema:{type:'object',required:['id'],properties:{id:{type:'number'}}} },
  { name:'get_comparison', description:'コスト比較表を取得する', inputSchema:{type:'object',properties:{destination:{type:'string'},fare_type:{type:'string',enum:['IC','ticket']}}} },
  { name:'import_csv', description:'CSV文字列をインポートする', inputSchema:{type:'object',required:['type','csv_content'],properties:{type:{type:'string',enum:['stations','parkings']},csv_content:{type:'string'}}} },
];

const server = new Server({ name:'travel-cost-mcp', version:'1.0.0' }, { capabilities:{ tools:{} } });
server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const { name, arguments: args } = req.params;
  const text = (c) => ({ content:[{ type:'text', text: typeof c==='string'?c:JSON.stringify(c,null,2) }] });
  try {
    switch (name) {
      case 'list_stations': return text(await api('GET', '/api/stations'));
      case 'add_station': return text(await api('POST', '/api/stations', args));
      case 'update_station': { const { station_name, ...f } = args; return text(await api('PUT', `/api/stations/${encodeURIComponent(station_name)}`, f)); }
      case 'delete_station': return text(await api('DELETE', `/api/stations/${encodeURIComponent(args.station_name)}`));
      case 'list_parkings': return text(await api('GET', `/api/parkings${args.station_name?`?station=${encodeURIComponent(args.station_name)}`:''}`));
      case 'add_parking': return text(await api('POST', '/api/parkings', { ...args, is_primary: args.is_primary ? 1 : 0 }));
      case 'update_parking': { const { id, ...f } = args; if (f.is_primary!=null) f.is_primary = f.is_primary?1:0; return text(await api('PUT', `/api/parkings/${id}`, f)); }
      case 'delete_parking': return text(await api('DELETE', `/api/parkings/${args.id}`));
      case 'get_comparison': {
        const p = new URLSearchParams();
        if (args.destination) p.set('destination', args.destination);
        if (args.fare_type) p.set('fare_type', args.fare_type);
        return text(await api('GET', `/api/compare?${p}`));
      }
      case 'import_csv': {
        const blob = new Blob([args.csv_content], { type: 'text/csv' });
        const form = new FormData(); form.append('file', blob, `${args.type}.csv`);
        const res = await fetch(`${BASE_URL}/api/import/${args.type}`, { method:'POST', headers:{'Authorization':`Bearer ${API_KEY}`}, body:form });
        return text(await res.json());
      }
      default: throw new Error(`Unknown tool: ${name}`);
    }
  } catch (e) {
    return { content:[{ type:'text', text:`Error: ${e.message}` }], isError:true };
  }
});

await server.connect(new StdioServerTransport());
```

- [ ] **Step 3: ローカル動作確認**

サーバーを起動した状態で別ターミナルで:
```bash
echo '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | MCP_API_KEY=test APP_URL=http://localhost:3000 node mcp-server/index.js
```

Expected: `tools` 配列に10件のツールが含まれるJSONが返る

- [ ] **Step 4: コミット**

```bash
git add mcp-server/index.js package.json package-lock.json
git commit -m "feat: add MCP server for Claude Desktop integration"
```

---

### Task 14: デプロイ設定・pre-commit フック・README

**Files:**
- Create: `.husky/pre-commit`
- Create: `README.md`
- Create: `.github/workflows/deploy.yml`

> ⚠️ Azure 固有の注意点が3つある（詳細は Global Constraints の「Azure App Service 固有の制約」を参照）：
> 1. デプロイ時は `node_modules/` を含めず `SCM_DO_BUILD_DURING_DEPLOYMENT=true` で Oryx ビルド
> 2. Easy Auth 有効化後に `/api/*` を `excludedPaths` に追加する
> 3. WAL 設定は db.js で実装済みだが、README にも明記する

- [ ] **Step 1: Husky で pre-commit フックを設定**

```bash
npx husky init
```

`.husky/pre-commit` を以下の内容に書き換える:
```sh
#!/bin/sh
for f in stations.csv parkings.csv .env; do
  if git diff --cached --name-only | grep -qx "$f"; then
    echo "ERROR: 個人情報ファイル '$f' がステージされています。"
    echo "       git reset HEAD $f  で外してください。"
    exit 1
  fi
done
```

- [ ] **Step 2: README.md を作成**

```markdown
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
```

- [ ] **Step 3: GitHub Actions ワークフローを作成**

```bash
mkdir -p .github/workflows
```

`.github/workflows/deploy.yml` を作成する（上記「5-2. GitHub Actions ワークフロー」の内容）。

- [ ] **Step 4: 全テストを実行して最終確認**

```bash
npm test
```

Expected: 全テスト PASS

- [ ] **Step 5: 最終コミット**

```bash
git add .husky README.md package.json package-lock.json .github/
git commit -m "chore: add pre-commit hook, GitHub Actions deploy workflow, and README"
```

---

## 実装完了チェックリスト

- [ ] `npm test` が全件 PASS
- [ ] `npm start` → `http://localhost:3000/` で比較表が開く
- [ ] 設定画面で燃費・ガソリン単価を保存できる
- [ ] データ管理画面で駅・駐車場の追加・編集・削除ができる
- [ ] CSVインポートが正常行のみ取り込み、エラー行を報告する
- [ ] 手動運賃の設定・クリアができる
- [ ] 駅名クリックで route_url が新タブで開く（手動運賃の場合はリンクなし）
- [ ] MCP サーバーが `tools/list` に10ツールを返す
- [ ] `git commit` 時に `stations.csv` が staged にあるとフックが止める
- [ ] `stations.csv`, `.env` が `.gitignore` で除外されている
