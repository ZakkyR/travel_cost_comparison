import request from 'supertest';
import express from 'express';
import { createFareRouter } from '../../src/routes/fare.js';
import { createTestDb } from '../helpers/testDb.js';

function makeApp(db) {
  const app = express();
  app.use(express.json());
  app.use('/api/fare', createFareRouter(db));
  return app;
}

let db;
beforeEach(() => {
  db = createTestDb();
});
afterEach(() => db.close());

test('GET /cache returns empty array initially', async () => {
  const res = await request(makeApp(db)).get('/api/fare/cache');
  expect(res.status).toBe(200);
  expect(res.body).toEqual([]);
});

test('POST /manual inserts a manual fare entry', async () => {
  const res = await request(makeApp(db)).post('/api/fare/manual').send({
    station_name: '南与野', destination: '東京', fare_type: 'IC', fare_yen: 570
  });
  expect(res.status).toBe(200);
  expect(res.body).toEqual({ ok: true });
  const rows = db.prepare('SELECT * FROM fare_cache').all();
  expect(rows).toHaveLength(1);
  expect(rows[0].is_manual).toBe(1);
});

test('POST /manual returns 400 when required fields missing', async () => {
  const res = await request(makeApp(db)).post('/api/fare/manual').send({ station_name: '南与野' });
  expect(res.status).toBe(400);
});

test('GET /cache returns inserted fare', async () => {
  db.prepare(
    'INSERT INTO fare_cache VALUES (?,?,?,?,?,?,?,?,?)'
  ).run('南与野', '東京', 'IC', 570, 28, 0, 'https://x', 1, new Date().toISOString());
  const res = await request(makeApp(db)).get('/api/fare/cache');
  expect(res.status).toBe(200);
  expect(res.body).toHaveLength(1);
  expect(res.body[0].station_name).toBe('南与野');
});

test('DELETE /cache removes non-manual fare', async () => {
  const now = new Date().toISOString();
  db.prepare('INSERT INTO fare_cache VALUES (?,?,?,?,?,?,?,?,?)').run('南与野', '東京', 'IC', 570, 28, 0, null, 0, now);
  const res = await request(makeApp(db)).delete('/api/fare/cache').send({
    station_name: '南与野', destination: '東京', fare_type: 'IC'
  });
  expect(res.status).toBe(200);
  expect(res.body).toEqual({ ok: true });
  expect(db.prepare('SELECT COUNT(*) as c FROM fare_cache').get().c).toBe(0);
});

test('DELETE /cache does not remove manual fare', async () => {
  const now = new Date().toISOString();
  db.prepare('INSERT INTO fare_cache VALUES (?,?,?,?,?,?,?,?,?)').run('南与野', '東京', 'IC', 570, 28, 0, null, 1, now);
  await request(makeApp(db)).delete('/api/fare/cache').send({
    station_name: '南与野', destination: '東京', fare_type: 'IC'
  });
  expect(db.prepare('SELECT COUNT(*) as c FROM fare_cache').get().c).toBe(1);
});

test('DELETE /cache returns 400 when required fields missing', async () => {
  const res = await request(makeApp(db)).delete('/api/fare/cache').send({ station_name: '南与野' });
  expect(res.status).toBe(400);
});
