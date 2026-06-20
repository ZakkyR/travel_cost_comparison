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
