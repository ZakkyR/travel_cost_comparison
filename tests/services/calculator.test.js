import { calcGasCost, calcRow } from '../../src/services/calculator.js';

const station = { station_name: '南与野', line: '埼京線', driving_distance_km: 4.2 };
const parking = { parking_name: 'P1', daily_max_fee: 600, last_checked: '2026-06-01' };
const fareCache = { fare_yen: 570, travel_minutes: 28, transfers: 0, route_url: 'https://x.com', is_manual: 0, fetched_at: '2026-06-20T10:00:00Z' };
const settings = { fuel_efficiency_km_per_l: 15, gas_price_per_l: 175 };

test('calcGasCost returns integer round trip cost', () => {
  // (4.2 * 2) / 15 * 175 = 98
  expect(calcGasCost(4.2, 15, 175)).toBe(98);
  expect(Number.isInteger(calcGasCost(3.7, 15, 175))).toBe(true);
});

test('calcRow returns correct totals', () => {
  const row = calcRow(station, parking, fareCache, settings);
  expect(row.fare_round_trip).toBe(1140);
  expect(row.parking_fee).toBe(600);
  expect(row.gas_cost).toBe(98);
  expect(row.total_cost).toBe(1838);
  expect(row.fare_source).toBe('api');
});

test('calcRow sets fare_source to manual when is_manual=1', () => {
  expect(calcRow(station, parking, { ...fareCache, is_manual: 1 }, settings).fare_source).toBe('manual');
});

test('calcRow returns null total_cost when parking is null', () => {
  const row = calcRow(station, null, fareCache, settings);
  expect(row.parking_fee).toBeNull();
  expect(row.total_cost).toBeNull();
});

test('calcRow returns null total_cost when fareCache is null', () => {
  const row = calcRow(station, parking, null, settings);
  expect(row.fare_round_trip).toBeNull();
  expect(row.total_cost).toBeNull();
});
