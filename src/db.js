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
      note TEXT,
      FOREIGN KEY (station_name) REFERENCES stations(station_name)
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
  db.pragma('foreign_keys = ON');
  initDb(db);
  return db;
}
