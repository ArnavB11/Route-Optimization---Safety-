// Pure trip helpers shared by the interface and regression checks.
export function validPoint(point) {
  return !!point && typeof point.lat === "number" && typeof point.lon === "number"
    && Number.isFinite(point.lat) && Number.isFinite(point.lon)
    && Math.abs(point.lat) <= 90 && Math.abs(point.lon) <= 180;
}

export function parsePoint(text) {
  if (typeof text !== "string") return null;
  const parts = text.split(",");
  if (parts.length !== 2 || parts.some((x) => !x.trim())) return null;
  const [lat, lon] = parts.map(Number);
  return validPoint({ lat, lon }) ? { lat, lon } : null;
}

export function tripKey(trip) {
  return [trip.city, trip.mode, trip.origin.lat.toFixed(5), trip.origin.lon.toFixed(5),
    trip.destination.lat.toFixed(5), trip.destination.lon.toFixed(5)].join(":");
}

export function savedTrips(value) {
  if (!Array.isArray(value)) return [];
  return value.filter((t) => t && validPoint(t.origin) && validPoint(t.destination)
    && typeof t.city === "string" && ["car", "two_wheeler", "walk"].includes(t.mode)).slice(0, 5);
}

export function routeReasons(route, fastest, dark) {
  const facts = [];
  const avoided = fastest.blackspot_ids.filter((id) => !route.blackspot_ids.includes(id)).length;
  if (avoided) facts.push(`Avoids ${avoided} mapped crash location${avoided === 1 ? "" : "s"}`);
  const lessDark = fastest.exposure.unlit_km - route.exposure.unlit_km;
  if (dark && lessDark >= 0.2) facts.push(`${lessDark.toFixed(1)} km less road with estimated poor lighting`);
  const fewerTurns = fastest.exposure.right_turns - route.exposure.right_turns;
  if (fewerTurns > 0) facts.push(`${fewerTurns} fewer right turn${fewerTurns === 1 ? "" : "s"} across traffic`);
  const fewerJunctions = fastest.exposure.uncontrolled_junctions - route.exposure.uncontrolled_junctions;
  if (fewerJunctions > 0) facts.push(`${fewerJunctions} fewer junction${fewerJunctions === 1 ? "" : "s"} without signals`);
  if (!facts.length) facts.push(route.risk < fastest.risk
    ? "Lower combined estimated risk from road and junction conditions"
    : "Lowest estimated travel time for this trip");
  return facts.slice(0, 3);
}

export function arrivalTime(hour, seconds) {
  const total = Math.round(hour * 60 + seconds / 60);
  const minute = ((total % 1440) + 1440) % 1440;
  const h = Math.floor(minute / 60);
  return `${(h % 12) || 12}:${String(minute % 60).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}${total >= 1440 ? " next day" : ""}`;
}
