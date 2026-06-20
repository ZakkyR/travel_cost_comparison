import { Router } from 'express';

export function selectParking(db, stationName) {
  const primary = db.prepare(
    'SELECT * FROM parkings WHERE station_name=? AND is_primary=1 ORDER BY daily_max_fee ASC LIMIT 1'
  ).get(stationName);
  if (primary) return primary;
  return db.prepare(
    'SELECT * FROM parkings WHERE station_name=? ORDER BY daily_max_fee ASC LIMIT 1'
  ).get(stationName) ?? null;
}

export function createParkingsRouter(db) {
  const router = Router();

  router.get('/', (req, res) => {
    const { station } = req.query;
    const rows = station
      ? db.prepare('SELECT * FROM parkings WHERE station_name=? ORDER BY is_primary DESC,daily_max_fee ASC').all(station)
      : db.prepare('SELECT * FROM parkings ORDER BY station_name,is_primary DESC,daily_max_fee ASC').all();
    res.json(rows);
  });

  router.post('/', (req, res) => {
    const { station_name, parking_name, daily_max_fee, is_primary=0,
            conditions=null, lat=null, lng=null, last_checked=null, source_url=null, note=null } = req.body;
    if (!station_name || !parking_name || daily_max_fee == null) {
      return res.status(400).json({ error: 'station_name, parking_name, daily_max_fee are required' });
    }
    const result = db.prepare(
      'INSERT INTO parkings (station_name,parking_name,daily_max_fee,is_primary,conditions,lat,lng,last_checked,source_url,note) VALUES (?,?,?,?,?,?,?,?,?,?)'
    ).run(station_name, parking_name, daily_max_fee, is_primary, conditions, lat, lng, last_checked, source_url, note);
    res.status(201).json({ id: result.lastInsertRowid });
  });

  router.put('/:id', (req, res) => {
    const allowed = ['parking_name','daily_max_fee','is_primary','conditions','lat','lng','last_checked','source_url','note'];
    const fields = allowed.filter(f => f in req.body);
    if (!fields.length) return res.status(400).json({ error: 'No fields to update' });
    const set = fields.map(f => `${f}=?`).join(',');
    const result = db.prepare(`UPDATE parkings SET ${set} WHERE id=?`).run(...fields.map(f => req.body[f]), req.params.id);
    result.changes ? res.json({ ok: true }) : res.status(404).json({ error: 'Not found' });
  });

  router.delete('/:id', (req, res) => {
    db.prepare('DELETE FROM parkings WHERE id=?').run(req.params.id);
    res.json({ ok: true });
  });

  return router;
}
