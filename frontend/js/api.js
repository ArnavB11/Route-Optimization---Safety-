// Thin client for the SafeRoute backend.
async function req(path, opts) {
  const r = await fetch(path, opts);
  let body = null;
  try { body = await r.json(); } catch (e) { /* non-JSON */ }
  if (!r.ok) throw new Error(typeof body?.detail === "string" ? body.detail : `Request failed (${r.status}). Please try again.`);
  if (!body) throw new Error("The server returned an empty response. Please try again.");
  return body;
}

export const api = {
  cities: () => req("/api/cities"),
  search: (q, city, signal) => req(`/api/search?q=${encodeURIComponent(q)}${city ? `&city=${encodeURIComponent(city)}` : ""}`, { signal }),
  reverse: (lat, lon) => req(`/api/reverse?lat=${lat}&lon=${lon}`),
  route: (body, signal) => req("/api/route", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal,
  }),
  layers: (region) => req(`/api/layers/${region}`),
  network: (region, mode, hour) => req(`/api/network/${region}?mode=${mode}&hour=${Math.floor(hour)}`),
  methodology: () => req("/api/methodology"),
};

// Photon (komoot) — OSM geocoder used only when the local gazetteer has few hits.
export async function photon(q, bbox, signal) {
  const [s, w, n, e] = bbox;
  const lat = (s + n) / 2, lon = (w + e) / 2;
  const url = `https://photon.komoot.io/api/?q=${encodeURIComponent(q)}&limit=6&lat=${lat}&lon=${lon}&bbox=${w},${s},${e},${n}`;
  try {
    const timeout = AbortSignal.timeout(4500);
    const r = await fetch(url, { signal: signal ? AbortSignal.any([signal, timeout]) : timeout });
    if (!r.ok) return [];
    const j = await r.json();
    return j.features.map((f) => ({
      name: f.properties.name || f.properties.street || q,
      kind: (f.properties.osm_value || "place").replace(/_/g, " "),
      sub: [f.properties.district, f.properties.city || f.properties.county].filter(Boolean).join(", "),
      lat: f.geometry.coordinates[1], lon: f.geometry.coordinates[0], external: true,
    }));
  } catch (e) { return []; }
}
