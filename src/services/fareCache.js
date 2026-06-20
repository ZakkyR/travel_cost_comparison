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
