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
