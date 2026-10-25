// Formatting helpers and the inline icon set.
export const $ = (s, el = document) => el.querySelector(s);
export const $$ = (s, el = document) => [...el.querySelectorAll(s)];

export function fmtDuration(s) {
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  return `${h} h ${String(m % 60).padStart(2, "0")} min`;
}
export function fmtDist(m) {
  return m < 950 ? `${Math.round(m / 10) * 10} m` : `${(m / 1000).toFixed(m < 9950 ? 1 : 0)} km`;
}
export function fmtHour(h) {
  const hh = Math.floor(h), mm = Math.round((h - hh) * 60);
  const ampm = hh < 12 ? "AM" : "PM";
  const h12 = ((hh + 11) % 12) + 1;
  return `${h12}:${String(mm).padStart(2, "0")} ${ampm}`;
}
export function signed(n, digits = 0, unit = "") {
  const v = Number(n.toFixed(digits));
  return `${v > 0 ? "+" : v < 0 ? "−" : "±"}${Math.abs(v).toFixed(digits)}${unit}`;
}
export function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
export function debounce(fn, ms) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}
export const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } },
};

// Risk level from relative risk (route risk per km / traffic-weighted network average).
export const RISK_LEVELS = [
  { max: 1.0, key: "good", label: "Low" },
  { max: 1.6, key: "warning", label: "Moderate" },
  { max: 2.5, key: "serious", label: "High" },
  { max: Infinity, key: "critical", label: "Very high" },
];
export function riskLevel(rel) { return RISK_LEVELS.find((l) => rel < l.max); }
export function cssVar(name) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }

const P = (d) => `<svg viewBox="0 0 24 24">${d}</svg>`;
export const ICON = {
  pin: P('<path d="M12 21s-6.5-5.6-6.5-11A6.5 6.5 0 0112 3.5 6.5 6.5 0 0118.5 10c0 5.4-6.5 11-6.5 11z"/><circle cx="12" cy="10" r="2.3"/>'),
  road: P('<path d="M8 3L5 21M16 3l3 18M12 4v2.5M12 10.5v3M12 17.5V20"/>'),
  train: P('<rect x="6" y="3.5" width="12" height="13" rx="3"/><path d="M6 10.5h12M9 20l-2 1.5M15 20l2 1.5M9 13.5h.01M15 13.5h.01"/>'),
  plane: P('<path d="M10.5 20.5l1.5-6-6 1v-2l6-4V4.5a1.5 1.5 0 013 0V9.5l6 4v2l-6-1 1.5 6z"/>'),
  school: P('<path d="M3 9l9-5 9 5-9 5z"/><path d="M7 11.5v4.5c3 2 7 2 10 0v-4.5"/>'),
  hospital: P('<rect x="4" y="4" width="16" height="16" rx="3"/><path d="M12 8v8M8 12h8"/>'),
  police: P('<path d="M12 3l7 2.5v5.5c0 4.4-3 8-7 9.5-4-1.5-7-5.1-7-9.5V5.5z"/><path d="M12 8.5l1.1 2.3 2.4.3-1.8 1.7.5 2.4-2.2-1.2-2.2 1.2.5-2.4-1.8-1.7 2.4-.3z"/>'),
  park: P('<path d="M12 21v-5M7.5 16h9L12 3z"/>'),
  shop: P('<path d="M4 9l1.5-5h13L20 9M4 9v11h16V9M4 9h16M9 20v-6h6v6"/>'),
  area: P('<path d="M3 20h18M5 20V9l5-4 5 4v11M15 20v-7h4v7"/>'),
  place: P('<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="2.5"/>'),
  locate: P('<circle cx="12" cy="12" r="3.2"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/><circle cx="12" cy="12" r="7.5"/>'),
  shield: P('<path d="M12 3l7 2.6v5.6c0 4.6-3 8.6-7 10.3-4-1.7-7-5.7-7-10.3V5.6z"/><path d="M8.8 12l2.2 2.2 4.4-4.6"/>'),
  warn: P('<path d="M12 4l9 16H3z"/><path d="M12 10v4.5M12 17.5h.01"/>'),
  moon: P('<path d="M20 14.5A8 8 0 019.5 4 8 8 0 1020 14.5z"/>'),
  sun: P('<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>'),
  bulb: P('<path d="M9 18h6M10 21h4M12 3a6 6 0 00-3.5 10.9c.6.5 1 1.2 1 2V16h5v-.1c0-.8.4-1.5 1-2A6 6 0 0012 3z"/>'),
  turnR: P('<path d="M7 20v-7a4 4 0 014-4h8M15 5l4 4-4 4"/>'),
  turnL: P('<path d="M17 20v-7a4 4 0 00-4-4H5M9 5L5 9l4 4"/>'),
  straight: P('<path d="M12 20V4M7 9l5-5 5 5"/>'),
  uturn: P('<path d="M8 20V9a4 4 0 018 0v6M12 12l4 4 4-4"/>'),
  roundabout: P('<circle cx="12" cy="11" r="4"/><path d="M12 15v6M16 11h4M17 8l3 3-3 3"/>'),
  depart: P('<circle cx="12" cy="12" r="4"/><circle cx="12" cy="12" r="8.5"/>'),
  arrive: P('<path d="M12 21s-6.5-5.6-6.5-11A6.5 6.5 0 0112 3.5 6.5 6.5 0 0118.5 10c0 5.4-6.5 11-6.5 11z"/><circle cx="12" cy="10" r="2.3"/>'),
  junction: P('<path d="M12 3v18M3 12h18"/>'),
  clock: P('<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>'),
  route: P('<circle cx="6" cy="18" r="2.5"/><circle cx="18" cy="6" r="2.5"/><path d="M8.5 18H15a3 3 0 000-6H9a3 3 0 010-6h6.5"/>'),
};
export function kindIcon(kind) {
  const k = (kind || "").toLowerCase();
  if (k.includes("road")) return ICON.road;
  if (k.includes("rail") || k.includes("station")) return ICON.train;
  if (k.includes("airport") || k.includes("aerodrome")) return ICON.plane;
  if (k.includes("univers") || k.includes("college") || k.includes("school")) return ICON.school;
  if (k.includes("hospital")) return ICON.hospital;
  if (k.includes("police")) return ICON.police;
  if (k.includes("park")) return ICON.park;
  if (k.includes("shop") || k.includes("mall")) return ICON.shop;
  if (k.includes("area") || k.includes("suburb") || k.includes("neighbourhood")) return ICON.area;
  if (k.includes("location")) return ICON.locate;
  return ICON.pin;
}
