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
