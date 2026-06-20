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
