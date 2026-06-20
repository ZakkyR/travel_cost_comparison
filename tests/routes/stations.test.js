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
