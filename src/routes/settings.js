import { Router } from 'express';

const DEFAULTS = {
  home_label: '', destination_default: '',
  fuel_efficiency_km_per_l: 0, gas_price_per_l: 0, fare_type: 'IC',
};

export function createSettingsRouter(db) {
  const router = Router();

  router.get('/', (req, res) => {
    const rows = db.prepare('SELECT key, value FROM settings').all();
    const settings = { ...DEFAULTS };
    for (const { key, value } of rows) {
      if (key in settings) settings[key] = typeof DEFAULTS[key] === 'number' ? Number(value) : value;
    }
    res.json(settings);
  });

  router.put('/', (req, res) => {
    const upsert = db.prepare(
      'INSERT INTO settings (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value'
    );
    db.transaction((data) => {
      for (const [k, v] of Object.entries(data)) {
        if (k in DEFAULTS) upsert.run(k, String(v));
      }
    })(req.body);
    res.json({ ok: true });
  });

  return router;
}
