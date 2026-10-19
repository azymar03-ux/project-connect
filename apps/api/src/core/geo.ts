export function distanceKm(
  aLat: number,
  aLng: number,
  bLat: number,
  bLng: number,
) {
  const r = 6371.0088,
    rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(bLat - aLat),
    dLng = rad(bLng - aLng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(aLat)) * Math.cos(rad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * r * Math.asin(Math.min(1, Math.sqrt(h)));
}
export function boundingBox(lat: number, lng: number, km: number) {
  const dLat = km / 111.32,
    dLng = km / (111.32 * Math.max(0.01, Math.cos((lat * Math.PI) / 180)));
  return {
    minLat: lat - dLat,
    maxLat: lat + dLat,
    minLng: lng - dLng,
    maxLng: lng + dLng,
  };
}
