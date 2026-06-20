import { Router } from 'express';
import multer from 'multer';
import { parse } from 'csv-parse/sync';

const upload = multer({ storage: multer.memoryStorage() });

export function createImportRouter(db) {
  const router = Router();

  router.post('/stations', upload.single('file'), (req, res) => {
    const records = parse(req.file.buffer, { columns: true, skip_empty_lines: true, bom: true });
    let imported = 0;
    const errors = [];
    const stmt = db.prepare(
      'INSERT INTO stations (station_name,line,driving_distance_km,note) VALUES (?,?,?,?) ON CONFLICT(station_name) DO UPDATE SET line=excluded.line,driving_distance_km=excluded.driving_distance_km,note=excluded.note'
    );
    for (const [i, row] of records.entries()) {
      const dist = Number(row.driving_distance_km);
      if (!row.station_name || isNaN(dist)) {
        errors.push(`行${i + 2}: station_name または driving_distance_km が不正`);
        continue;
      }
      try { stmt.run(row.station_name, row.line || null, dist, row.note || null); imported++; }
      catch (e) { errors.push(`行${i + 2}: ${e.message}`); }
    }
    res.json({ imported, errors });
  });

  router.post('/parkings', upload.single('file'), (req, res) => {
    const records = parse(req.file.buffer, { columns: true, skip_empty_lines: true, bom: true });
    let imported = 0;
    const errors = [];
    const stmt = db.prepare(
      'INSERT INTO parkings (station_name,parking_name,daily_max_fee,is_primary,conditions,lat,lng,last_checked,source_url,note) VALUES (?,?,?,?,?,?,?,?,?,?)'
    );
    for (const [i, row] of records.entries()) {
      const fee = Number(row.daily_max_fee);
      if (!row.station_name || !row.parking_name || isNaN(fee)) {
        errors.push(`行${i + 2}: station_name, parking_name, daily_max_fee が不正`);
        continue;
      }
      try {
        stmt.run(row.station_name, row.parking_name, fee,
          row.is_primary ? Number(row.is_primary) : 0,
          row.conditions || null, row.lat ? Number(row.lat) : null, row.lng ? Number(row.lng) : null,
          row.last_checked || null, row.source_url || null, row.note || null);
        imported++;
      } catch (e) { errors.push(`行${i + 2}: ${e.message}`); }
    }
    res.json({ imported, errors });
  });

  return router;
}
