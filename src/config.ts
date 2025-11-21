/**
 * Observer configuration with hardcoded location
 * Update these values with your actual location
 */
const num = (v: string | undefined) => {
  if (v === undefined) return undefined;
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : undefined;
};

const defaults = {
  latitude: 49.2827,
  longitude: -123.1207,
  altitude: 30,
  temperature: 15,
  pressure: 1013.25
};

export const OBSERVER_CONFIG = {
  latitude: num(process.env.OBSERVER_LATITUDE) ?? defaults.latitude,
  longitude: num(process.env.OBSERVER_LONGITUDE) ?? defaults.longitude,
  altitude: num(process.env.OBSERVER_ALTITUDE) ?? defaults.altitude,
  temperature: num(process.env.OBSERVER_TEMPERATURE) ?? defaults.temperature,
  pressure: num(process.env.OBSERVER_PRESSURE) ?? defaults.pressure
};
