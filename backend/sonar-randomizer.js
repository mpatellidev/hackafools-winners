'use strict';

const SONAR_TIERS = ['tier_1', 'tier_2', 'tier_3'];
const MINIMUM_SHIFT_KM = 1.5;
const MAXIMUM_SHIFT_KM = 4.5;
const MINIMUM_CENTER_DISTANCE_KM = 10;

function clamp(value, min, max) { return Math.min(Math.max(value, min), max); }

function haversineKm([lon1, lat1], [lon2, lat2]) {
  const radius = 6371;
  const toRad = (degrees) => degrees * Math.PI / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const value = Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return radius * 2 * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value));
}

function shuffled(values, random) {
  const result = [...values];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const target = Math.floor(random() * (index + 1));
    [result[index], result[target]] = [result[target], result[index]];
  }
  return result;
}

function randomizedTiers(features, random) {
  const palette = features.map((feature) => feature.properties?.threat_level || 'tier_2');
  for (let attempt = 0; attempt < 120; attempt += 1) {
    const candidate = shuffled(palette, random);
    if (candidate.every((tier, index) => tier !== palette[index])) return candidate;
  }
  return palette.map((_, index) => SONAR_TIERS[(index + 1) % SONAR_TIERS.length]);
}

function geographicBounds(features) {
  const points = features.flatMap((feature) => feature.geometry?.coordinates?.flat(1) || [])
    .filter((point) => Array.isArray(point) && point.length === 2 && point.every(Number.isFinite));
  const longitudes = points.map((point) => point[0]);
  const latitudes = points.map((point) => point[1]);
  return {
    minLon: Math.min(...longitudes), maxLon: Math.max(...longitudes),
    minLat: Math.min(...latitudes), maxLat: Math.max(...latitudes)
  };
}

function shiftedCenter(base, bounds, placed, radiusKm, random) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const distanceKm = MINIMUM_SHIFT_KM + random() * (MAXIMUM_SHIFT_KM - MINIMUM_SHIFT_KM);
    const angle = random() * Math.PI * 2;
    const latitude = base[1] + Math.sin(angle) * distanceKm / 111.32;
    const longitudeScale = 111.32 * Math.cos(base[1] * Math.PI / 180);
    const longitude = base[0] + Math.cos(angle) * distanceKm / longitudeScale;
    const candidate = [
      clamp(longitude, bounds.minLon, bounds.maxLon),
      clamp(latitude, bounds.minLat, bounds.maxLat)
    ];
    const separated = placed.every((entry) => {
      const desiredDistance = Math.max(MINIMUM_CENTER_DISTANCE_KM, (radiusKm + entry.radiusKm) * 0.82);
      return haversineKm(candidate, entry.center) >= desiredDistance;
    });
    if (separated) return candidate;
  }
  return [...base];
}

function randomizeSonars(zonesGeojson, random = Math.random) {
  const features = Array.isArray(zonesGeojson?.features) ? zonesGeojson.features : [];
  if (!features.length) return zonesGeojson;
  const bounds = geographicBounds(features);
  const tiers = randomizedTiers(features, random);
  const placed = [];
  const randomizedFeatures = features.map((feature, index) => {
    const properties = feature.properties || {};
    const baseCenter = Array.isArray(properties.sonar_center) ? properties.sonar_center : feature.geometry.coordinates[0][0];
    const baseRadius = Number(properties.sonar_radius_km || 5);
    const sizeDirection = random() < .5 ? -1 : 1;
    const sizeVariation = .05 + random() * .08;
    const radiusKm = Math.round(baseRadius * (1 + sizeDirection * sizeVariation) * 100) / 100;
    const center = shiftedCenter(baseCenter, bounds, placed, radiusKm, random);
    placed.push({ center, radiusKm });
    return {
      ...feature,
      properties: {
        ...properties,
        sonar_center: center,
        sonar_radius_km: radiusKm,
        sonar_threat_level: tiers[index]
      }
    };
  });
  return { ...zonesGeojson, features: randomizedFeatures };
}

module.exports = { randomizeSonars, haversineKm, SONAR_TIERS };
