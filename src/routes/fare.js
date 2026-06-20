// src/routes/fare.js
import { Router } from 'express';
import { setManualFare, clearCachedFare } from '../services/fareCache.js';

export function createFareRouter(db) {
  const router = Router();

  router.get('/cache', (req, res) => {
    res.json(db.prepare('SELECT * FROM fare_cache ORDER BY station_name,destination').all());
  });

  router.post('/manual', (req, res) => {
    const { station_name, destination, fare_type = 'IC', fare_yen } = req.body;
    if (!station_name || !destination || fare_yen == null) {
      return res.status(400).json({ error: 'station_name, destination, fare_yen are required' });
    }
    setManualFare(db, station_name, destination, fare_type, fare_yen);
    res.json({ ok: true });
  });

  router.delete('/cache', (req, res) => {
    const { station_name, destination, fare_type = 'IC' } = req.body;
    if (!station_name || !destination) {
      return res.status(400).json({ error: 'station_name and destination are required' });
    }
    clearCachedFare(db, station_name, destination, fare_type);
    res.json({ ok: true });
  });

  return router;
}
