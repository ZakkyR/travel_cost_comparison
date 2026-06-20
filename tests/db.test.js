import { createTestDb } from './helpers/testDb.js';

test('creates all tables', () => {
  const db = createTestDb();
  const tables = db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
  ).all().map(r => r.name);
  expect(tables).toEqual(['fare_cache', 'parkings', 'settings', 'stations']);
  db.close();
});
