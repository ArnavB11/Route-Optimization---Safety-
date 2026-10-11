import { api, photon } from "./api.js";
import { breakdownBar, columns, paretoChart, riskProfile } from "./charts.js";
import { MapView } from "./map.js";
import {
  $, $$, ICON, cssVar, debounce, esc, fmtDist, fmtDuration, fmtHour, kindIcon, riskLevel, signed, store,
} from "./util.js";

// ---------------------------------------------------------------------------
const ROUTE_META = {
  safest: { name: "Safest", css: "--r-safest", blurb: "Lowest crash & security risk within your detour limit" },
  balanced: { name: "Balanced", css: "--r-balanced", blurb: "Best risk reduction per extra minute" },
  fastest: { name: "Fastest", css: "--r-fastest", blurb: "Standard shortest-time route" },
};
const MODE_LABEL = { car: "car", two_wheeler: "two-wheeler", walk: "walking" };

const state = {
  cities: [], regions: {}, city: null,
  origin: null, destination: null,
  mode: "car", hour: nowHour(), safety: 0.7, detour: 0.25,
  result: null, selected: "safest", tab: "overview",
  layerData: {}, theme: initialTheme(), pending: null,
};

function nowHour() { const d = new Date(); return Math.min(23.5, d.getHours() + (d.getMinutes() >= 30 ? 0.5 : 0)); }
function initialTheme() {
  const q = new URLSearchParams(location.search).get("theme");
  if (q === "light" || q === "dark") return q;
  const t = store.get("sr-theme-v", null);
  if (t) return t;
  return matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}
function routeColor(k) { return cssVar(ROUTE_META[k].css); }
function region() { return state.cities.find((c) => c.id === state.city)?.region; }
function toast(msg, ms = 4200) {
  const t = $("#toast");
  t.textContent = msg; t.hidden = false;
  clearTimeout(toast._t); toast._t = setTimeout(() => (t.hidden = true), ms);
}
function regionOf(lat, lon) {
  for (const [k, r] of Object.entries(state.regions)) {
    const [s, w, n, e] = r.bbox;
    if (lat >= s && lat <= n && lon >= w && lon <= e) return k;
  }
  return null;
}
function cityForRegion(reg, lat, lon) {
  const cands = state.cities.filter((c) => c.region === reg);
  return cands.sort((a, b) => ((a.center[0] - lat) ** 2 + (a.center[1] - lon) ** 2) - ((b.center[0] - lat) ** 2 + (b.center[1] - lon) ** 2))[0];
}

// ---------------------------------------------------------------------------
let map;

async function init() {
  applyTheme(state.theme, false);
  const { cities, regions } = await api.cities();
  state.cities = cities; state.regions = regions;
  const params = new URLSearchParams(location.search);
  const saved = store.get("sr-city", "ahmedabad");
  state.city = cities.find((c) => c.id === (params.get("city") || saved) && c.ready)?.id || cities.find((c) => c.ready)?.id;
  const city = cities.find((c) => c.id === state.city);

  map = new MapView($("#map"), {
    center: city.center, zoom: city.zoom, theme: state.theme,
    onMapClick: onMapClick, onPinDrag: onPinDrag, onRouteClick: (k) => select(k),
  });
  renderCityChips();
  bindControls();
  renderEmpty();
  await map.ready;
  await loadRegionLayers(city.region);

  // restore a shared link
  const o = params.get("o"), d = params.get("d");
  if (params.get("mode")) setMode(params.get("mode"), false);
  if (params.get("h")) state.hour = +params.get("h");
  if (params.get("s")) state.safety = +params.get("s");
  syncControls();
  if (o && d) {
    const [olat, olon] = o.split(",").map(Number), [dlat, dlon] = d.split(",").map(Number);
    await setPoint("origin", { lat: olat, lon: olon }, true, true);
    await setPoint("destination", { lat: dlat, lon: dlon }, true, true);
    plan();
  }
}

// ---------------------------------------------------------------------------
function renderCityChips() {
  $("#city-chips").innerHTML = state.cities.map((c) =>
    `<button class="chip ${c.id === state.city ? "on" : ""}" data-city="${c.id}" ${c.ready ? "" : "disabled title='Not built yet'"}>${esc(c.name)}</button>`).join("");
  $$("#city-chips .chip").forEach((b) => (b.onclick = () => switchCity(b.dataset.city)));
}

async function switchCity(id, fly = true) {
  const c = state.cities.find((x) => x.id === id);
  if (!c || !c.ready) return;
  const regionChanged = c.region !== region();
  state.city = id;
  store.set("sr-city", id);
  renderCityChips();
  if (fly) map.flyTo(c.center[0], c.center[1], c.zoom);
  if (regionChanged) {
    clearRoute();
    state.origin = state.destination = null;
    $("#in-origin").value = ""; $("#in-destination").value = "";
    map.setPin("origin", null); map.setPin("destination", null);
    await loadRegionLayers(c.region);
    renderEmpty();
  }
}

async function loadRegionLayers(reg) {
  if (!state.layerData[reg]) state.layerData[reg] = await api.layers(reg);
  const L = state.layerData[reg];
  map.setPois(L);
  map.setBlackspots(L.blackspots);
  if (map.visible.risk) refreshNetwork();
}

const refreshNetwork = debounce(async () => {
  if (!map.visible.risk) return;
  try { map.setNetwork(await api.network(region(), state.mode, state.hour)); } catch (e) { toast(e.message); }
}, 200);

// ---------------------------------------------------------------------------
function bindControls() {
  // search fields
  for (const role of ["origin", "destination"]) {
    const field = $(`.field[data-role="${role}"]`), input = $("input", field), list = $(".suggest", field);
    let items = [], active = -1;
    const show = (rows) => {
      items = rows; active = -1;
      if (!rows.length) { list.innerHTML = `<li class="s-empty">No matches in ${esc(cityName())}. Try another name or click the map.</li>`; list.classList.add("open"); return; }
      list.innerHTML = rows.map((r, i) => `<li role="option" data-i="${i}"><span class="s-ico">${kindIcon(r.kind)}</span>
        <span class="s-main"><div class="s-name">${esc(r.name)}</div><div class="s-sub">${esc(r.kind)}${r.sub ? " · " + esc(r.sub) : ""}</div></span></li>`).join("");
      list.classList.add("open");
      $$("li[data-i]", list).forEach((li) => li.addEventListener("mousedown", (ev) => { ev.preventDefault(); pick(+li.dataset.i); }));
    };
    const pick = (i) => {
      const r = items[i];
      if (!r) return;
      list.classList.remove("open");
      input.value = r.name;
      setPoint(role, { lat: r.lat, lon: r.lon, label: r.name }).then(() => { maybePlan(); });
    };
    const run = debounce(async () => {
      const q = input.value.trim();
      if (q.length < 2) { list.classList.remove("open"); return; }
      const m = q.match(/^\s*(-?\d+\.\d+)\s*,\s*(-?\d+\.\d+)\s*$/);
      if (m) return show([{ name: `${(+m[1]).toFixed(5)}, ${(+m[2]).toFixed(5)}`, kind: "Coordinates", lat: +m[1], lon: +m[2] }]);
      const { results } = await api.search(q, state.city);
      let rows = results.map((r) => ({ ...r, sub: cityName() }));
      if (rows.length < 4) {
        const ext = await photon(q, state.regions[region()].bbox);
        for (const e of ext) if (!rows.some((r) => r.name.toLowerCase() === e.name.toLowerCase())) rows.push(e);
      }
      show(rows.slice(0, 8));
    }, 180);
    input.addEventListener("input", run);
    input.addEventListener("focus", () => { if (input.value.trim().length >= 2) run(); });
    input.addEventListener("blur", () => setTimeout(() => list.classList.remove("open"), 120));
    input.addEventListener("keydown", (ev) => {
      const lis = $$("li[data-i]", list);
      if (ev.key === "ArrowDown" || ev.key === "ArrowUp") {
        ev.preventDefault();
        active = (active + (ev.key === "ArrowDown" ? 1 : -1) + lis.length) % lis.length;
        lis.forEach((li, i) => li.classList.toggle("active", i === active));
      } else if (ev.key === "Enter") { ev.preventDefault(); pick(active >= 0 ? active : 0); }
      else if (ev.key === "Escape") list.classList.remove("open");
    });
  }
  $("#btn-swap").onclick = () => {
    [state.origin, state.destination] = [state.destination, state.origin];
    $("#in-origin").value = state.origin?.label || "";
    $("#in-destination").value = state.destination?.label || "";
    map.setPin("origin", state.origin); map.setPin("destination", state.destination);
    maybePlan();
  };
  $("#btn-locate").onclick = locate;
  $$(".mode").forEach((b) => (b.onclick = () => setMode(b.dataset.mode)));
  const hour = $("#in-hour");
  hour.oninput = () => { state.hour = +hour.value; syncControls(); replan(); refreshNetwork(); };
  $("#btn-now").onclick = () => { state.hour = nowHour(); syncControls(); replan(); refreshNetwork(); };
  const safety = $("#in-safety");
  safety.oninput = () => { state.safety = +safety.value; syncControls(); replan(); };
  $$("#in-detour button").forEach((b) => (b.onclick = () => {
    state.detour = +b.dataset.v; syncControls(); replan();
  }));
  // map controls
  $("#btn-layers").onclick = (ev) => { ev.stopPropagation(); const p = $("#layers-pop"); p.hidden = !p.hidden; $("#btn-layers").classList.toggle("on", !p.hidden); };
  document.addEventListener("click", (ev) => { if (!ev.target.closest("#map-ctl")) { $("#layers-pop").hidden = true; $("#btn-layers").classList.remove("on"); } });
  $$("#layers-pop input").forEach((cb) => {
    cb.checked = map.visible[cb.dataset.layer];
    cb.onchange = () => {
      map.setVisible(cb.dataset.layer, cb.checked);
      if (cb.dataset.layer === "risk") { $("#risk-legend").hidden = !cb.checked && !state.result; if (cb.checked) refreshNetwork(); }
    };
  });
  $("#btn-theme").onclick = () => applyTheme(state.theme === "dark" ? "light" : "dark", true);
  $("#btn-recenter").onclick = () => fitSelected();
  $("#btn-insights").onclick = openDrawer;
  $("#btn-drawer-close").onclick = closeDrawer;
  $("#drawer-scrim").onclick = closeDrawer;
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeDrawer(); });
  // mobile bottom sheet
  const panel = $("#panel");
  $("#sheet-handle").onclick = () => {
    if (panel.classList.contains("expanded")) { panel.classList.remove("expanded"); panel.classList.add("collapsed"); }
    else if (panel.classList.contains("collapsed")) panel.classList.remove("collapsed");
    else panel.classList.add("expanded");
  };
  syncControls();
}

function cityName() { return state.cities.find((c) => c.id === state.city)?.name || ""; }

function syncControls() {
  const h = $("#in-hour"), s = $("#in-safety");
  h.value = state.hour; s.value = state.safety;
  s.style.setProperty("--fill", `${state.safety * 100}%`);
  const dark = state.hour >= 19.5 || state.hour < 6;
  $("#hour-val").innerHTML = `${fmtHour(state.hour)} · ${dark ? "night" : state.hour >= 18 ? "dusk" : "day"}`;
  const sv = state.safety;
  $("#safety-val").textContent = sv >= 0.85 ? "Maximum safety" : sv >= 0.6 ? "Prefer safety" : sv >= 0.35 ? "Balanced" : sv > 0.05 ? "Prefer speed" : "Speed only";
  $$("#in-detour button").forEach((b) => b.classList.toggle("on", +b.dataset.v === state.detour));
}

function setMode(mode, doPlan = true) {
  state.mode = mode;
  $$(".mode").forEach((b) => { const on = b.dataset.mode === mode; b.classList.toggle("active", on); b.setAttribute("aria-selected", on); });
  if (doPlan) { replan(); refreshNetwork(); }
}

function applyTheme(theme, persist) {
  state.theme = theme;
  document.documentElement.dataset.theme = theme;
  if (persist) { store.set("sr-theme-v", theme); try { localStorage.setItem("sr-theme", theme); } catch (e) { /* ignore */ } }
  $("#btn-theme").innerHTML = theme === "dark" ? ICON.sun : ICON.moon;
  if (map) {
    map.setTheme(theme);
    map.map.once("style.load", () => { if (state.result) drawResult(false); if (state.layerData[region()]) map.setPois(state.layerData[region()]); });
  }
  if (state.result) renderResult();
}

// ---------------------------------------------------------------------------
async function setPoint(role, pt, skipLabel, noFly) {
  const reg = regionOf(pt.lat, pt.lon);
  if (!reg) { toast("That point is outside the five supported cities."); return false; }
  if (reg !== region()) {
    const c = cityForRegion(reg, pt.lat, pt.lon);
    await switchCity(c.id, false);
  } else {
    const c = cityForRegion(reg, pt.lat, pt.lon);
    if (c.id !== state.city) { state.city = c.id; renderCityChips(); }
  }
  state[role] = { lat: pt.lat, lon: pt.lon, label: pt.label || "" };
  map.setPin(role, pt);
  const input = role === "origin" ? $("#in-origin") : $("#in-destination");
  if (pt.label) input.value = pt.label;
  if (!pt.label || skipLabel) {
    input.value = "Locating…";
    try {
      const r = await api.reverse(pt.lat, pt.lon);
      state[role].label = r.name; input.value = r.name;
    } catch (e) { input.value = `${pt.lat.toFixed(5)}, ${pt.lon.toFixed(5)}`; }
  }
  if (!noFly && (!state.origin || !state.destination)) map.flyTo(pt.lat, pt.lon, Math.max(map.map.getZoom(), 14));
  return true;
}

function onMapClick(ll) {
  const update = map.contextPopup(ll, "Dropped pin",
    () => setPoint("origin", { lat: ll.lat, lon: ll.lng }).then(maybePlan),
    () => setPoint("destination", { lat: ll.lat, lon: ll.lng }).then(maybePlan));
  if (regionOf(ll.lat, ll.lng)) api.reverse(ll.lat, ll.lng).then((r) => update(r.name)).catch(() => {});
  else update("Outside supported cities");
}

function onPinDrag(role, lat, lon) { setPoint(role, { lat, lon }).then(maybePlan); }

function locate() {
  if (!navigator.geolocation) return toast("Location isn't available in this browser.");
  $("#in-origin").value = "Finding your location…";
  navigator.geolocation.getCurrentPosition(async (p) => {
    const { latitude: lat, longitude: lon } = p.coords;
    if (!regionOf(lat, lon)) {
      $("#in-origin").value = "";
      toast("You're outside Surat, Ahmedabad, Gandhinagar, Vadodara and Rajkot — pick a start point on the map.");
      return;
    }
    await setPoint("origin", { lat, lon, label: "Your location" });
    maybePlan();
  }, () => { $("#in-origin").value = ""; toast("Couldn't get your location (permission denied or unavailable)."); },
  { enableHighAccuracy: true, timeout: 10000 });
}

// ---------------------------------------------------------------------------
function maybePlan() { if (state.origin && state.destination) plan(); }
const replan = debounce(maybePlan, 280);

async function plan() {
  if (!state.origin || !state.destination) return;
  state.pending?.abort();
  const ctl = new AbortController();
  state.pending = ctl;
  if (!state.result) $("#results").innerHTML = `<div class="loading"><div class="skel"></div><div class="skel"></div><div class="skel"></div></div>`;
  else $("#results").style.opacity = 0.55;
  try {
    const res = await api.route({
      origin: state.origin, destination: state.destination, mode: state.mode, hour: state.hour,
      safety_weight: state.safety, max_detour: state.detour,
    }, ctl.signal);
    if (ctl.signal.aborted) return;
    const first = !state.result;
    state.result = res;
    if (!res.routes[state.selected]) state.selected = "safest";
    renderResult();
    drawResult(first);
    $("#risk-legend").hidden = false;
    updateUrl();
  } catch (e) {
    if (e.name === "AbortError") return;
    state.result = null;
    map.clearRoutes();
    $("#results").innerHTML = `<div class="empty-state">${ICON.warn}<h3>Couldn't plan that trip</h3><p>${esc(e.message)}</p></div>`;
  } finally {
    $("#results").style.opacity = 1;
  }
}

function updateUrl() {
  const p = new URLSearchParams({
    city: state.city, o: `${state.origin.lat.toFixed(5)},${state.origin.lon.toFixed(5)}`,
    d: `${state.destination.lat.toFixed(5)},${state.destination.lon.toFixed(5)}`,
    mode: state.mode, h: state.hour, s: state.safety,
  });
  history.replaceState(null, "", `?${p}`);
}

function clearRoute() { state.result = null; map?.clearRoutes(); $("#risk-legend").hidden = !map?.visible.risk; }

function routeKeys() {
  const r = state.result.routes;
  return ["safest", "balanced", "fastest"].filter((k) => r[k]);
}

function drawResult(fit) {
  const r = state.result.routes;
  const colors = Object.fromEntries(routeKeys().map((k) => [k, routeColor(k)]));
  map.drawRoutes(r, routeKeys(), state.selected, colors);
  if (fit) fitSelected();
}

function fitSelected() {
  if (!state.result) return;
  const all = routeKeys().flatMap((k) => state.result.routes[k].geometry);
  const mobile = innerWidth <= 760;
  map.fit(all, mobile ? { top: 70, bottom: innerHeight * 0.58, left: 30, right: 30 } : { top: 60, bottom: 60, left: 450, right: 80 });
}

function select(k) {
  if (!state.result?.routes[k]) return;
  state.selected = k;
  renderResult();
  drawResult(false);
}

// ---------------------------------------------------------------------------
function renderEmpty() {
  const c = state.cities.find((x) => x.id === state.city);
  const ex = EXAMPLES[c?.region] || [];
  $("#results").innerHTML = `<div class="empty-state">${ICON.shield}
    <h3>Plan a safer trip in ${esc(c?.name || "Gujarat")}</h3>
    <p>Search two places, click the map, or use your location. We compare the usual fastest route with one that avoids crash blackspots, risky junctions and dark roads.</p>
    ${ex.length ? `<div class="examples">${ex.map((e, i) => `<button class="example" data-i="${i}">${ICON.route}<span><b>${esc(e.from.label)} → ${esc(e.to.label)}</b><small>${esc(e.note)}</small></span></button>`).join("")}</div>` : ""}
  </div>`;
  $$(".example").forEach((b) => (b.onclick = async () => {
    const e = ex[+b.dataset.i];
    if (e.hour != null) { state.hour = e.hour; }
    if (e.mode) setMode(e.mode, false);
    syncControls();
    await setPoint("origin", e.from, false, true); await setPoint("destination", e.to, false, true);
    plan();
  }));
}

const EXAMPLES = {
  ahmedabad: [
    { from: { lat: 23.0300, lon: 72.5070, label: "Bodakdev" }, to: { lat: 23.0700, lon: 72.6500, label: "Naroda" }, hour: 21, note: "Night drive across SG Highway blackspots" },
    { from: { lat: 23.0225, lon: 72.5714, label: "Ahmedabad centre" }, to: { lat: 23.2156, lon: 72.6369, label: "Gandhinagar" }, hour: 23, mode: "two_wheeler", note: "Late-night two-wheeler commute to the capital" },
  ],
  surat: [
    { from: { lat: 21.1673, lon: 72.7853, label: "SVNIT campus" }, to: { lat: 21.1418, lon: 72.7562, label: "Dumas Road" }, hour: 21, note: "The project's validation trip (Phase 4)" },
    { from: { lat: 21.2049, lon: 72.8410, label: "Surat Railway Station" }, to: { lat: 21.1702, lon: 72.9500, label: "Kadodara" }, hour: 22, mode: "two_wheeler", note: "Towards the Kadodara blackspot at night" },
  ],
  vadodara: [
    { from: { lat: 22.3121, lon: 73.1795, label: "MS University" }, to: { lat: 22.2400, lon: 73.1950, label: "Makarpura GIDC" }, hour: 21, note: "Avoiding the NH-48 corridor at night" },
  ],
  rajkot: [
    { from: { lat: 22.3039, lon: 70.8022, label: "Rajkot centre" }, to: { lat: 22.2800, lon: 70.7600, label: "Kalavad Road" }, hour: 20, note: "Past Indira Circle in the evening" },
  ],
};

function headline(res) {
  const c = res.comparison, r = res.routes;
  if (c.same_route) {
    return `<div class="headline same">${ICON.shield}<div><b>The fastest route is already the safest option</b> for ${MODE_LABEL[res.mode]} travel at ${fmtHour(res.hour)}.</div></div>`;
  }
  const mins = Math.round(c.time_delta_s / 60);
  const extra = [];
  if (c.blackspots_avoided) extra.push(`avoids ${c.blackspots_avoided} accident blackspot${c.blackspots_avoided > 1 ? "s" : ""}`);
  if (res.is_dark && c.unlit_km_delta < -0.2) extra.push(`${Math.abs(c.unlit_km_delta).toFixed(1)} km less unlit road`);
  let bal = "";
  if (r.balanced) {
    const bm = Math.round((r.balanced.time_s - r.fastest.time_s) / 60);
    bal = ` The <b>balanced</b> route cuts risk by ${Math.round(100 * (1 - r.balanced.risk / r.fastest.risk))}% ${bm > 0 ? `for +${bm} min` : "at no extra time"}.`;
  }
  return `<div class="headline">${ICON.shield}<div><b>Safest route: ${mins > 0 ? `+${mins} min` : "no extra time"}, ${Math.round(c.risk_reduction_pct)}% lower risk</b>${extra.length ? " · " + extra.join(" · ") : ""}.${bal}${c.detour_capped ? ` <span style="color:var(--ink-2)">(Limited by your ${Math.round(c.max_detour * 100)}% detour cap.)</span>` : ""}</div></div>`;
}

function scoreRing(score, label) {
  const lvl = score >= 72 ? "good" : score >= 60 ? "warning" : score >= 45 ? "serious" : "critical";
  const C = 2 * Math.PI * 22;
  return `<div><div class="score" title="Safety score ${score.toFixed(0)}/100"><svg viewBox="0 0 54 54"><circle class="trk" cx="27" cy="27" r="22"/>
    <circle class="val" cx="27" cy="27" r="22" stroke="var(--st-${lvl})" stroke-dasharray="${(C * score / 100).toFixed(1)} ${C.toFixed(1)}" stroke-linecap="round"/></svg>
    <b>${score.toFixed(0)}</b></div><div class="score-lbl">${esc(label)}</div></div>`;
}

function card(k, res) {
  const r = res.routes[k], f = res.routes.fastest, meta = ROUTE_META[k];
  const dT = (r.time_s - f.time_s) / 60;
  const dR = 100 * (r.risk / f.risk - 1);
  const sub = k === "fastest"
    ? `${fmtDist(r.distance_m)} · ${meta.blurb}`
    : `${fmtDist(r.distance_m)} · <span class="${dT > 0.5 ? "up" : ""}">${signed(dT, 0, " min")}</span> · <span class="${dR < -1 ? "down" : ""}">${signed(dR, 0, "%")} risk</span>`;
  const facts = [];
  if (r.blackspots.length) facts.push(`<span class="fact warn"><i class="sdot" style="background:var(--st-critical)"></i>${r.blackspots.length} blackspot${r.blackspots.length > 1 ? "s" : ""}</span>`);
  else facts.push(`<span class="fact">${ICON.shield}No known blackspots</span>`);
  if (res.is_dark) facts.push(`<span class="fact">${ICON.bulb}${r.exposure.unlit_km.toFixed(1)} km poorly lit</span>`);
  facts.push(`<span class="fact">${ICON.junction}${r.exposure.uncontrolled_junctions} uncontrolled junctions</span>`);
  facts.push(`<span class="fact">${ICON.turnR}${r.exposure.right_turns} right turns</span>`);
  return `<div class="route-card ${state.selected === k ? "sel" : ""}" data-k="${k}" style="--rc:var(${meta.css})" tabindex="0" role="button" aria-pressed="${state.selected === k}">
    <div class="rc-top"><span class="rc-key"></span>
      <div class="rc-main"><div class="rc-name">${meta.name}${k === "fastest" ? '<span class="tag">Normal route</span>' : ""}</div>
        <div class="rc-time">${fmtDuration(r.time_s)}</div><div class="rc-sub">${sub}</div></div>
      ${scoreRing(r.score, r.label)}</div>
    <div class="rc-facts">${facts.join("")}</div></div>`;
}

function renderResult() {
  const res = state.result;
  if (!res) return;
  const keys = res.comparison.same_route ? ["fastest"] : routeKeys();
  if (res.comparison.same_route) state.selected = "fastest";
  const sel = res.routes[state.selected];
  $("#results").innerHTML = headline(res) + keys.map((k) => card(k, res)).join("") + `
    <div class="tabs" role="tablist">
      ${["overview", "directions", "analysis"].map((t) => `<button class="tab ${state.tab === t ? "on" : ""}" data-t="${t}" role="tab">${t[0].toUpperCase() + t.slice(1)}</button>`).join("")}
    </div><div id="tab-body"></div>
    <p class="note">Scores compare risk per km with the average road a ${MODE_LABEL[res.mode]} trip in this city uses (score 70 = average). Computed in ${res.stats.compute_ms} ms.</p>`;
  $$(".route-card").forEach((c) => {
    c.onclick = () => select(c.dataset.k);
    c.onkeydown = (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); select(c.dataset.k); } };
  });
  $$(".tab").forEach((t) => (t.onclick = () => { state.tab = t.dataset.t; renderResult(); }));
  const body = $("#tab-body");
  if (state.tab === "overview") renderOverview(body, sel, res);
  else if (state.tab === "directions") renderDirections(body, sel);
  else renderAnalysis(body, res);
}

function renderOverview(el, r, res) {
  const f = res.routes.fastest, isF = r === f;
  const pct = (a, b) => (b ? 100 * (a / b - 1) : 0);
  const tile = (l, v, d, good) => `<div class="tile"><div class="l">${l}</div><div class="v">${v}</div>${d != null ? `<div class="d ${good == null ? "" : good ? "good" : "bad"}">${d}</div>` : ""}</div>`;
  const dRisk = pct(r.risk, f.risk);
  el.innerHTML = `
    <div class="tiles">
      ${tile("Safety score", `${r.score.toFixed(0)}<small style="font-size:13px;color:var(--ink-2)">/100</small>`, isF ? r.label : `${signed(r.score - f.score, 0)} vs fastest`, isF ? null : r.score >= f.score)}
      ${tile("Crash risk", res.mode === "walk" ? `${r.relative_risk.toFixed(2)}×` : `${r.crashes_per_million_trips.toFixed(2)}`, res.mode === "walk" ? "relative to average road" : isF ? "est. crashes per million trips" : `${signed(dRisk, 0, "%")} vs fastest`, isF ? null : dRisk <= 0)}
      ${tile("Travel time", fmtDuration(r.time_s), isF ? `at ${fmtHour(res.hour)}` : `${signed((r.time_s - f.time_s) / 60, 0, " min")} vs fastest`, isF ? null : r.time_s <= f.time_s + 30)}
      ${tile("Distance", fmtDist(r.distance_m), isF ? `${Math.round(r.exposure.arterial_share * 100)}% on main roads` : `${signed((r.distance_m - f.distance_m) / 1000, 1, " km")} vs fastest`, null)}
    </div>
    <div class="sec-title">Where the risk comes from</div><div id="bd"></div>
    <div class="sec-title">Route exposure</div>
    <div class="kv">
      <span>Main-road share</span><span>${Math.round(r.exposure.arterial_share * 100)}%</span>
      <span>High-risk stretches</span><span>${r.exposure.high_risk_km.toFixed(1)} km</span>
      <span>Junctions (signalised / uncontrolled)</span><span>${r.exposure.signalised_junctions} / ${r.exposure.uncontrolled_junctions}</span>
      <span>Right turns across traffic</span><span>${r.exposure.right_turns}</span>
      ${res.is_dark ? `<span>Poorly lit distance</span><span>${r.exposure.unlit_km.toFixed(1)} km</span>` : `<span>Street-lit share (for night)</span><span>${Math.round(r.exposure.lit_share * 100)}%</span>`}
      <span>Top speed on route</span><span>${Math.round(r.exposure.max_speed_kmh)} km/h</span>
      <span>Within 1 km of police</span><span>${Math.round(r.exposure.police_within_1km_share * 100)}%</span>
      <span>Farthest point from a hospital</span><span>${r.exposure.max_hospital_km.toFixed(1)} km</span>
    </div>
    <div class="sec-title">Accident blackspots on this route</div>
    ${r.blackspots.length ? r.blackspots.map((b, i) => `<div class="bs-item" data-i="${i}">${ICON.warn}<div><b>${esc(b.name)}</b><small>${b.accidents ?? "–"} crashes · ${b.deaths ?? "–"} deaths on record</small></div></div>`).join("")
      : `<div class="bs-item" style="cursor:default">${ICON.shield.replace("<svg", '<svg style="color:var(--st-good)"')}<div><b>None</b><small>This route stays clear of all documented blackspots.</small></div></div>`}`;
  breakdownBar($("#bd", el), [
    { name: "Road & junction design", value: r.breakdown.road, color: cssVar("--r-safest") },
    { name: "Blackspot history", value: r.breakdown.blackspot, color: cssVar("--r-fastest") },
    { name: "Darkness", value: r.breakdown.lighting, color: cssVar("--r-balanced") },
    { name: "Personal security", value: r.breakdown.security, color: "#eda100" },
  ]);
  $$(".bs-item[data-i]", el).forEach((b) => (b.onclick = () => {
    const bs = r.blackspots[+b.dataset.i];
    map.flyTo(bs.lat, bs.lon, 15.5);
    const full = state.layerData[res.region].blackspots.find((x) => x.id === bs.id);
    if (full) setTimeout(() => map.blackspotPopup(full), 600);
  }));
}

function stepIcon(s) {
  if (s.type === "depart") return ICON.depart;
  if (s.type === "arrive") return ICON.arrive;
  if (s.type === "roundabout") return ICON.roundabout;
  if (s.type === "uturn") return ICON.uturn;
  if (s.modifier === "right") return ICON.turnR;
  if (s.modifier === "left") return ICON.turnL;
  return ICON.straight;
}

function renderDirections(el, r) {
  el.innerHTML = `<ol class="steps">${r.directions.map((s, i) => {
    const lv = s.relative_risk != null ? riskLevel(s.relative_risk) : null;
    return `<li class="step" data-i="${i}"><span class="st-ico">${stepIcon(s)}</span><div class="st-body">${esc(s.text)}
      <div class="st-meta">${s.distance_m ? `<span>${fmtDist(s.distance_m)}</span>` : ""}${s.time_s >= 30 ? `<span>${fmtDuration(s.time_s)}</span>` : ""}
      ${lv ? `<span class="st-risk"><i style="background:var(--st-${lv.key})"></i>${lv.label} risk</span>` : ""}</div></div></li>`;
  }).join("")}</ol>`;
  $$(".step", el).forEach((li) => {
    const s = r.directions[+li.dataset.i];
    li.onmouseenter = () => map.highlight(s.lat, s.lon);
    li.onmouseleave = () => map.unhighlight();
    li.onclick = () => map.flyTo(s.lat, s.lon, 16.5);
  });
}

function renderAnalysis(el, res) {
  const r = res.routes, sel = state.selected;
  el.innerHTML = `<div class="sec-title">Risk along the route</div><div id="ch-profile"></div>
    <div class="sec-title">Time vs safety trade-off (Pareto front)</div><div id="ch-pareto"></div>
    <p class="note">Each dot is the optimal route for one safety weight λ in C = λ·R/R₀ + (1−λ)·T/T₀. No dot on the curve can get safer without getting slower.</p>`;
  const series = [{ name: ROUTE_META[sel].name, color: routeColor(sel), points: r[sel].profile }];
  if (sel !== "fastest") series.push({ name: "Fastest", color: routeColor("fastest"), points: r.fastest.profile });
  riskProfile($("#ch-profile", el), series);
  paretoChart($("#ch-pareto", el), res.pareto,
    routeKeys().map((k) => ({ key: k, name: ROUTE_META[k].name, color: routeColor(k), time_s: r[k].time_s, score: r[k].score, distance_m: r[k].distance_m })),
    (k) => select(k));
}

// ---------------------------------------------------------------------------
async function openDrawer() {
  $("#drawer").hidden = false; $("#drawer-scrim").hidden = false;
  const c = state.cities.find((x) => x.id === state.city);
  const meth = await api.methodology();
  if (!state.layerData[c.region]) state.layerData[c.region] = await api.layers(c.region);
  const L = state.layerData[c.region];
  const s = c.stats;
  const delta = (a, b) => `${signed(100 * (a / b - 1), 0, "%")} vs 2021`;
  $("#drawer-body").innerHTML = `
    <div class="sec-title">${esc(c.name)} — road crashes (MoRTH 2022)</div>
    ${s ? `<div class="tiles">
      <div class="tile"><div class="l">Road accidents</div><div class="v">${s.accidents_2022.toLocaleString("en-IN")}</div><div class="d ${s.accidents_2022 > s.accidents_2021 ? "bad" : "good"}">${delta(s.accidents_2022, s.accidents_2021)}</div></div>
      <div class="tile"><div class="l">Persons killed</div><div class="v">${s.killed_2022.toLocaleString("en-IN")}</div><div class="d ${s.killed_2022 > s.killed_2021 ? "bad" : "good"}">${delta(s.killed_2022, s.killed_2021)}</div></div>
      <div class="tile"><div class="l">Persons injured</div><div class="v">${s.injured_2022.toLocaleString("en-IN")}</div><div class="d ${s.injured_2022 > s.injured_2021 ? "bad" : "good"}">${delta(s.injured_2022, s.injured_2021)}</div></div>
      <div class="tile"><div class="l">Deaths per 100 crashes</div><div class="v">${(100 * s.killed_2022 / s.accidents_2022).toFixed(0)}</div><div class="d">India avg: 37</div></div>
    </div>` : `<p>Gandhinagar is not a million-plus city, so MoRTH publishes no city row; it is modelled together with Ahmedabad.</p>`}
    <div class="sec-title">When crashes happen (India, MoRTH 2022)</div><div id="ch-tod"></div>
    <p class="note">Bars show relative risk per vehicle-km: share of crashes ÷ share of traffic in each 3-hour window. Line = average (1.0). Night driving is up to ${Math.max(...meth.tod_risk.map((t) => t.risk)).toFixed(1)}× riskier.</p>
    <div class="sec-title">Documented blackspots in this region (${L.blackspots.length})</div>
    ${L.blackspots.map((b) => `<div class="bs-item" data-id="${b.id}">${ICON.warn}<div><b>${esc(b.name)}</b><small>${b.accidents ?? "–"} crashes · ${b.deaths ?? "–"} deaths · ${esc(b.period)} · weight ×${b.risk_multiplier.toFixed(1)}</small></div></div>`).join("")}
    <div class="sec-title">How the safety score works</div>
    <div class="formula">Edge risk  R_e = k · f_c · L · S(v) · TOD(h) · CMF_light · EB_bs
Junction   R_j = k_j · arms · control · AADT_minor^0.35 · S(v) · turn
Severity   S(v) = (1−φ)(v/40)² + φ(v/40)⁴      (Nilsson power model)
Route cost C = W_t·T/T₀ + W_s·R/R₀              (A*, turn-aware)</div>
    <ul>
      <li><b>Crash frequency</b> f_c by road class, calibrated so the model reproduces each city's MoRTH 2022 crash total.</li>
      <li><b>Severity</b> grows with operating speed (Nilsson power model; φ = ${meth.fatal_share} local fatal share).</li>
      <li><b>Junctions</b>: risk per manoeuvre — right turns across traffic ×${meth.turn_risk.right}, U-turns ×${meth.turn_risk.uturn}, left ×${meth.turn_risk.left}.</li>
      <li><b>Darkness</b>: unlit roads at night ×1.39 (HSM lighting CMF). Lighting is inferred from NASA VIIRS night-time lights.</li>
      <li><b>Blackspots</b>: official/audited crash records blended with the model by Empirical Bayes.</li>
      <li><b>Personal security</b> (lighting, activity, police proximity, CCTV) weighted by mode: car ${meth.security_gamma.car}, two-wheeler ${meth.security_gamma.two_wheeler}, walk ${meth.security_gamma.walk}.</li>
    </ul>
    <div class="sec-title">Data coverage — ${esc(state.regions[c.region].name)}</div>
    <div class="kv">
      <span>Road network modelled</span><span>${c.network_km?.toLocaleString("en-IN")} km</span>
      <span>Police stations (OSM)</span><span>${c.coverage.police}</span>
      <span>Hospitals (OSM)</span><span>${c.coverage.hospitals}</span>
      <span>Mapped traffic signals</span><span>${c.coverage.signals_tagged}</span>
      <span>Roads with speed limit tag</span><span>${(100 * c.coverage.osm_maxspeed).toFixed(1)}%</span>
    </div>
    <p class="note">Where OSM is sparse (signals, lamps), the model uses class-based priors and satellite night-lights; see docs/METHODOLOGY.md.</p>
    <div class="sec-title">Sources</div>
    <ul class="src-list">
      <li>MoRTH, <i>Road Accidents in India 2022</i> (city totals, time-of-day, road features) and <i>2019</i> (Annexure 52 blackspots)</li>
      <li>Gujarat Road Safety Authority audit &amp; State Traffic Branch lists, via Gujarat Samachar (2025, 2026)</li>
      <li>OpenStreetMap contributors (road network, POIs) · NASA Black Marble VNP46A2 night lights (GIBS)</li>
      <li>AASHTO Highway Safety Manual CMFs · Nilsson (2004) · Rosén &amp; Sander (2009) · BPR (1964) · Webster (1958)</li>
    </ul>`;
  const hrs = (a, b) => `${String(a).padStart(2, "0")}–${String(b).padStart(2, "0")}`;
  columns($("#ch-tod"), meth.tod_risk.map((t) => ({
    label: hrs(t.from, t.to), value: +t.risk.toFixed(2),
    tip: `<b>${hrs(t.from, t.to)} h</b><br>${t.crash_share}% of crashes · ~${t.traffic_share}% of traffic<br>Relative risk <b>${t.risk.toFixed(2)}×</b>`,
  })), { unit: "×", refLine: 1 });
  $$("#drawer-body .bs-item").forEach((b) => (b.onclick = () => {
    const bs = L.blackspots.find((x) => x.id === b.dataset.id);
    closeDrawer(); map.flyTo(bs.lat, bs.lon, 15.5); setTimeout(() => map.blackspotPopup(bs), 700);
  }));
}
function closeDrawer() { $("#drawer").hidden = true; $("#drawer-scrim").hidden = true; }

init().catch((e) => {
  console.error(e);
  toast(`Couldn't start: ${e.message}. Is the backend running?`, 10000);
});
