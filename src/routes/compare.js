// src/routes/compare.js
import { Router } from 'express';
import { selectParking } from './parkings.js';
import { getOrFetchFare } from '../services/fareCache.js';
import { calcRow } from '../services/calculator.js';

export function createCompareRouter(db) {
  const router = Router();

  router.get('/', async (req, res) => {
    const getSetting = (key) => db.prepare('SELECT value FROM settings WHERE key=?').get(key)?.value ?? null;
    const destination = req.query.destination || getSetting('destination_default') || '';
    if (!destination) return res.status(400).json({ error: 'destination is required' });

    const fareType = req.query.fare_type || getSetting('fare_type') || 'IC';
    const fuelEff = Number(getSetting('fuel_efficiency_km_per_l') ?? 0);
    const gasPrice = Number(getSetting('gas_price_per_l') ?? 0);
    const apiKey = process.env.EKISPERT_API_KEY || null;
    const settings = { fuel_efficiency_km_per_l: fuelEff, gas_price_per_l: gasPrice };

    const stations = db.prepare('SELECT * FROM stations ORDER BY station_name').all();

    const rows = await Promise.all(stations.map(async (station) => {
      const parking = selectParking(db, station.station_name);
      const fare = await getOrFetchFare(db, station.station_name, destination, fareType, apiKey);
      return calcRow(station, parking, fare, settings);
    }));

    rows.sort((a, b) => {
      if (a.total_cost == null && b.total_cost == null) return 0;
      if (a.total_cost == null) return 1;
      if (b.total_cost == null) return -1;
      return a.total_cost - b.total_cost;
    });

    res.json(rows);
  });

  return router;
}
