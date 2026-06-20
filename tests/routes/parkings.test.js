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
