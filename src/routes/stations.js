import { Router } from 'express';

export function createStationsRouter(db) {
  const router = Router();

  router.get('/', (req, res) => {
    res.json(db.prepare('SELECT * FROM stations ORDER BY station_name').all());
  });

  router.post('/', (req, res) => {
    const { station_name, line = null, driving_distance_km, note = null } = req.body;
    if (!station_name || driving_distance_km == null) {
      return res.status(400).json({ error: 'station_name and driving_distance_km are required' });
    }
    db.prepare('INSERT INTO stations (station_name,line,driving_distance_km,note) VALUES (?,?,?,?)')
      .run(station_name, line, driving_distance_km, note);
    res.status(201).json({ ok: true });
  });

  router.put('/:name', (req, res) => {
    const fields = ['line', 'driving_distance_km', 'note'].filter(f => f in req.body);
    if (!fields.length) return res.status(400).json({ error: 'No fields to update' });
    const set = fields.map(f => `${f}=?`).join(',');
    const result = db.prepare(`UPDATE stations SET ${set} WHERE station_name=?`)
      .run(...fields.map(f => req.body[f]), req.params.name);
    result.changes ? res.json({ ok: true }) : res.status(404).json({ error: 'Not found' });
  });

  router.delete('/:name', (req, res) => {
    db.prepare('DELETE FROM stations WHERE station_name=?').run(req.params.name);
    res.json({ ok: true });
  });

  return router;
}
