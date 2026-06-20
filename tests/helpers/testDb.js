import Database from 'better-sqlite3';
import { initDb } from '../../src/db.js';

export function createTestDb() {
  const db = new Database(':memory:');
  db.pragma('journal_mode = WAL');
  initDb(db);
  return db;
}
