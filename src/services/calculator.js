export function calcGasCost(distanceKm, fuelEfficiency, gasPrice) {
  if (!fuelEfficiency) return 0;
  return Math.round((distanceKm * 2) / fuelEfficiency * gasPrice);
}

export function calcRow(station, parking, fareCache, settings) {
  const fareRoundTrip = fareCache ? fareCache.fare_yen * 2 : null;
  const parkingFee = parking ? parking.daily_max_fee : null;
  const gasCost = calcGasCost(station.driving_distance_km, settings.fuel_efficiency_km_per_l, settings.gas_price_per_l);
  const totalCost = fareRoundTrip != null && parkingFee != null ? fareRoundTrip + parkingFee + gasCost : null;

  return {
    station_name: station.station_name,
    line: station.line ?? null,
    total_cost: totalCost,
    fare_round_trip: fareRoundTrip,
    parking_fee: parkingFee,
    gas_cost: gasCost,
    parking_name: parking?.parking_name ?? null,
    last_checked: parking?.last_checked ?? null,
    travel_minutes: fareCache?.travel_minutes ?? null,
    transfers: fareCache?.transfers ?? null,
    route_url: fareCache?.route_url ?? null,
    driving_distance_km: station.driving_distance_km,
    fare_source: fareCache ? (fareCache.is_manual ? 'manual' : 'api') : null,
    fare_cached_at: fareCache?.fetched_at ?? null,
  };
}
