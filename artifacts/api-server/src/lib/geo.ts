/** Great-circle distance between two lat/lng points, in kilometers
 *  (Haversine formula). Used to filter candidates by the viewer's
 *  preferred radius and to display "X km away" without needing a
 *  PostGIS extension — computed in application code rather than the
 *  database. Fine at the current scale; if the user base grows large
 *  enough that fetching every non-excluded candidate before filtering
 *  becomes a real cost, this is the first place to revisit (e.g. a
 *  bounding-box pre-filter in the SQL query, or an actual geospatial
 *  extension). */
export function haversineDistanceKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371; // Earth's radius in km
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}
