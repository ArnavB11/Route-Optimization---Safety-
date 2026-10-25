import { api, photon } from "./api.js";
import { breakdownBar } from "./charts.js";
import { MapView } from "./map.js?v=20261025";
import { arrivalTime, parsePoint, routeReasons, savedTrips, tripKey, validPoint } from "./trip.js";
import {
  $, $$, ICON, cssVar, debounce, esc, fmtDist, fmtDuration, fmtHour, kindIcon, riskLevel, signed, store,
} from "./util.js";

// ---------------------------------------------------------------------------
const ROUTE_META = {
  safest: { name: "Safer choice", css: "--r-safest", blurb: "Lower estimated risk within your extra-time limit" },
  balanced: { name: "Less detour", css: "--r-balanced", blurb: "Best risk reduction per extra minute" },
  fastest: { name: "Fastest", css: "--r-fastest", blurb: "Shortest estimated travel time" },
};
const MODE_LABEL = { car: "car", two_wheeler: "two-wheeler", walk: "walking" };

const state = {
  cities: [], regions: {}, city: null,
  origin: null, destination: null,
  mode: "car", hour: nowHour(), safety: 0.7, detour: 0.25,
  result: null, selected: "safest", tab: "overview",
  layerData: {}, theme: initialTheme(), pending: null,
  saved: savedTrips(store.get("sr-saved-trips", [])), searchReset: [],
};

function nowHour() {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date());
  const value = (kind) => Number(parts.find((part) => part.type === kind).value);
  return value("hour") + value("minute") / 60;
}
function initialTheme() {
  const q = new URLSearchParams(location.search).get("theme");
  if (q === "light" || q === "dark") return q;
  const t = store.get("sr-theme-v", null);
  if (t === "light" || t === "dark") return t;
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
  store.set("sr-city", state.city);

  map = new MapView($("#map"), {
    center: city.center, zoom: city.zoom, theme: state.theme,
    onMapClick: onMapClick, onPinDrag: onPinDrag, onRouteClick: (k) => select(k),
  });
  renderCityChips();
  bindControls();
  renderEmpty();
  await map.ready;
  await loadRegionLayers(city.region).catch(() => toast("Safety map layers are unavailable. You can still plan a route."));

  // restore a shared link
  const o = params.get("o"), d = params.get("d");
  if (params.get("mode")) setMode(params.get("mode"), false);
  for (const [key, field, max] of [["h", "hour", 24 - 1 / 60], ["s", "safety", 1], ["detour", "detour", 1]]) {
    const value = Number(params.get(key));
    if (params.has(key) && Number.isFinite(value) && value >= 0 && value <= max) state[field] = value;
  }
  syncControls();
  if (o && d) {
    const origin = parsePoint(o), destination = parsePoint(d);
    if (origin && destination && regionOf(origin.lat, origin.lon) === regionOf(destination.lat, destination.lon)) {
      await setPoint("origin", origin, true, true);
      await setPoint("destination", destination, true, true);
      if (params.get("route") === "fastest") state.selected = "fastest";
      maybePlan();
    } else toast("This trip link has invalid locations. Please choose your start and destination.");
  }
}

// ---------------------------------------------------------------------------
function renderCityChips() {
  $("#city-chips").innerHTML = state.cities.map((c) =>
    `<button class="chip ${c.id === state.city ? "on" : ""}" data-city="${c.id}" aria-pressed="${c.id === state.city}" ${c.ready ? "" : "disabled title='Not built yet'"}>${esc(c.name)}</button>`).join("");
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
    resetSearch();
    clearRoute();
    map.setNetwork({ type: "FeatureCollection", features: [] });
    state.origin = state.destination = null;
    $("#in-origin").value = ""; $("#in-destination").value = "";
    map.setPin("origin", null); map.setPin("destination", null);
    await loadRegionLayers(c.region).catch(() => toast("Map layers unavailable. Route planning is still available."));
    renderEmpty();
  }
}

async function loadRegionLayers(reg) {
  if (!state.layerData[reg]) state.layerData[reg] = await api.layers(reg);
  if (reg !== region()) return;
  const L = state.layerData[reg];
  map.setPois(L);
  map.setBlackspots(L.blackspots);
  if (map.visible.risk) refreshNetwork();
}

let networkRevision = 0;
const refreshNetwork = debounce(async () => {
  const ticket = ++networkRevision;
  if (!map.visible.risk) return;
  const reg = region(), mode = state.mode, hour = state.hour;
  try {
    const data = await api.network(reg, mode, hour);
    if (ticket === networkRevision && reg === region() && mode === state.mode && hour === state.hour && map.visible.risk) map.setNetwork(data);
  } catch (e) { if (ticket === networkRevision) toast(e.message); }
}, 200);

function resetSearch() { state.searchReset.forEach((reset) => reset()); }

// ---------------------------------------------------------------------------
function bindControls() {
  // search fields
  for (const role of ["origin", "destination"]) {
    const field = $(`.field[data-role="${role}"]`), input = $("input", field), list = $(".suggest", field);
    let items = [], active = -1, revision = 0, searchController;
    list.id = `suggest-${role}`;
    input.setAttribute("role", "combobox");
    input.setAttribute("aria-autocomplete", "list");
    input.setAttribute("aria-controls", list.id);
    input.setAttribute("aria-expanded", "false");
    const close = () => {
      list.classList.remove("open"); input.setAttribute("aria-expanded", "false");
      input.removeAttribute("aria-activedescendant"); items = []; active = -1;
    };
    state.searchReset.push(() => { revision++; searchController?.abort(); close(); });
    const show = (rows) => {
      const selected = items[active];
      items = rows;
      active = selected ? rows.findIndex((r) => r.name === selected.name && r.lat === selected.lat && r.lon === selected.lon) : -1;
      list.innerHTML = rows.length ? rows.map((r, i) => `<li id="${list.id}-${i}" role="option" aria-selected="${i === active}" class="${i === active ? "active" : ""}" data-i="${i}"><span class="s-ico">${kindIcon(r.kind)}</span>
        <span class="s-main"><div class="s-name">${esc(r.name)}</div><div class="s-sub">${esc(r.kind)}${r.sub ? " · " + esc(r.sub) : ""}</div></span></li>`).join("")
        : `<li class="s-empty">No matches. Try another name or choose a point on the map.</li>`;
      list.classList.add("open"); input.setAttribute("aria-expanded", "true");
      if (active >= 0) input.setAttribute("aria-activedescendant", `${list.id}-${active}`);
      $$("li[data-i]", list).forEach((li) => li.addEventListener("mousedown", (ev) => { ev.preventDefault(); pick(+li.dataset.i); }));
    };
    const pick = (i) => {
      const r = items[i];
      if (!r) return;
      revision++; searchController?.abort(); close();
      input.value = r.name;
      setPoint(role, { lat: r.lat, lon: r.lon, label: r.name }).then((ok) => {
        if (!ok) return;
        if (!state.destination && role === "origin") $("#in-destination").focus();
        maybePlan();
      });
    };
    const run = debounce(async () => {
      const ticket = revision, searchCity = state.city, q = input.value.trim();
      if (q.length < 2 || document.activeElement !== input) return close();
      searchController?.abort(); searchController = new AbortController();
      const signal = searchController.signal;
      const current = () => !signal.aborted && ticket === revision && searchCity === state.city && document.activeElement === input;
      const point = parsePoint(q);
      if (point) return show([{ name: q, kind: "Coordinates", ...point }]);
      let rows = [];
      try {
        const { results } = await api.search(q, searchCity, signal);
        if (!current()) return;
        rows = results.map((r) => ({ ...r, sub: cityName() }));
        if (rows.length) show(rows.slice(0, 8));
      } catch (e) { if (!current()) return; }
      if (rows.length < 4 && current()) {
        const ext = await photon(q, state.regions[region()].bbox, signal);
        if (!current()) return;
        for (const e of ext) if (!rows.some((r) => r.name.toLowerCase() === e.name.toLowerCase())) rows.push(e);
      }
      if (current()) show(rows.slice(0, 8));
    }, 180);
    input.addEventListener("input", () => {
      revision++; searchController?.abort(); close(); state[role] = null;
      map.setPin(role, null); clearRoute(); renderEmpty(); run();
    });
    input.addEventListener("focus", () => { if (input.value.trim().length >= 2) run(); });
    input.addEventListener("blur", () => { revision++; searchController?.abort(); setTimeout(close, 120); });
    input.addEventListener("keydown", (ev) => {
      if (!list.classList.contains("open")) return;
      const lis = $$("li[data-i]", list);
      if ((ev.key === "ArrowDown" || ev.key === "ArrowUp") && lis.length) {
        ev.preventDefault();
        active = active < 0 ? (ev.key === "ArrowDown" ? 0 : lis.length - 1) : (active + (ev.key === "ArrowDown" ? 1 : -1) + lis.length) % lis.length;
        lis.forEach((li, i) => { li.classList.toggle("active", i === active); li.setAttribute("aria-selected", i === active); });
        input.setAttribute("aria-activedescendant", `${list.id}-${active}`);
        lis[active].scrollIntoView({ block: "nearest" });
      } else if (ev.key === "Enter") { ev.preventDefault(); pick(active >= 0 ? active : 0); }
      else if (ev.key === "Escape") close();
    });
  }
  $("#btn-swap").onclick = () => {
    resetSearch(); clearRoute();
    [state.origin, state.destination] = [state.destination, state.origin];
    $("#in-origin").value = state.origin?.label || "";
    $("#in-destination").value = state.destination?.label || "";
    map.setPin("origin", state.origin); map.setPin("destination", state.destination);
    maybePlan();
  };
  $("#btn-plan").onclick = () => {
    if (!state.origin || !state.destination) return toast("Choose a starting point and destination first.");
    plan();
  };
  $("#btn-clear").onclick = () => {
    resetSearch(); clearRoute(); state.origin = state.destination = null;
    for (const role of ["origin", "destination"]) { $("#in-" + role).value = ""; map.setPin(role, null); }
    history.replaceState(null, "", `?city=${encodeURIComponent(state.city)}`); renderEmpty();
  };
  $("#btn-locate").onclick = locate;
  $("#btn-map-view").onclick = () => {
    $("#panel").classList.toggle("map-only");
    const hidden = $("#panel").classList.contains("map-only");
    $("#btn-map-view").textContent = hidden ? "Show trip" : "Show map";
    $("#btn-map-view").setAttribute("aria-expanded", !hidden);
    if (state.result) fitSelected();
  };
  $$(".mode").forEach((b) => (b.onclick = () => setMode(b.dataset.mode)));
  const hour = $("#in-hour");
  hour.oninput = () => { state.hour = Math.min(1439, Math.round(+hour.value * 60)) / 60; syncControls(); replan(); refreshNetwork(); };
  $("#btn-now").onclick = () => { state.hour = nowHour(); syncControls(); replan(); refreshNetwork(); };
  const safety = $("#in-safety");
  safety.oninput = () => { state.safety = +safety.value; syncControls(); replan(); };
  const detours = $$("#in-detour button");
  detours.forEach((button, index) => {
    button.onclick = () => { state.detour = +button.dataset.v; syncControls(); replan(); };
    button.onkeydown = (event) => {
      if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;
      event.preventDefault();
      const next = (index + (["ArrowRight", "ArrowDown"].includes(event.key) ? 1 : -1) + detours.length) % detours.length;
      detours[next].click(); detours[next].focus();
    };
  });
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
    if (panel.classList.contains("map-only")) panel.classList.remove("map-only");
    else panel.classList.toggle("expanded");
    $("#btn-map-view").textContent = "Show map";
    $("#btn-map-view").setAttribute("aria-expanded", "true");
  };
  panel.addEventListener("transitionend", (event) => { if (event.propertyName === "height" && state.result) fitSelected(); });
  syncControls();
}

function cityName() { return state.cities.find((c) => c.id === state.city)?.name || ""; }

function syncControls() {
  const h = $("#in-hour"), s = $("#in-safety");
  h.value = state.hour; s.value = state.safety;
  s.style.setProperty("--fill", `${state.safety * 100}%`);
  const dark = state.hour >= 19.5 || state.hour < 6;
  $("#hour-val").innerHTML = `${fmtHour(state.hour)} · ${dark ? "night" : state.hour >= 18 ? "dusk" : "day"}`;
  $("#trip-summary").textContent = `${fmtHour(state.hour)} · up to ${Math.round(state.detour * 100)}% extra`;
  h.setAttribute("aria-valuetext", `${fmtHour(state.hour)} India time`);
  s.setAttribute("aria-valuetext", state.safety >= .6 ? "Prefer safety" : "Prefer shorter travel time");
  const sv = state.safety;
  $("#safety-val").textContent = sv >= 0.85 ? "Maximum safety" : sv >= 0.6 ? "Prefer safety" : sv >= 0.35 ? "Balanced" : sv > 0.05 ? "Prefer speed" : "Speed only";
  $$("#in-detour button").forEach((b) => { b.classList.toggle("on", +b.dataset.v === state.detour); b.setAttribute("aria-checked", +b.dataset.v === state.detour); b.tabIndex = +b.dataset.v === state.detour ? 0 : -1; });
}

function setMode(mode, doPlan = true) {
  if (!Object.hasOwn(MODE_LABEL, mode)) return;
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
    map.map.once("style.load", () => { if (state.result) drawResult(false); if (state.layerData[region()]) map.setPois(state.layerData[region()]); });
    map.setTheme(theme);
  }
  if (state.result) renderResult();
}

// ---------------------------------------------------------------------------
async function setPoint(role, pt, skipLabel, noFly) {
  if (!validPoint(pt)) return false;
  const reg = regionOf(pt.lat, pt.lon);
  if (!reg) { toast("That point is outside the five supported cities."); return false; }
  resetSearch();
  clearRoute();
  if (reg !== region()) {
    const c = cityForRegion(reg, pt.lat, pt.lon);
    await switchCity(c.id, false);
  } else {
    const c = cityForRegion(reg, pt.lat, pt.lon);
    if (c.id !== state.city) { state.city = c.id; renderCityChips(); }
  }
  const point = { lat: pt.lat, lon: pt.lon, label: pt.label || "" };
  state[role] = point;
  map.setPin(role, pt);
  const input = role === "origin" ? $("#in-origin") : $("#in-destination");
  if (pt.label) input.value = pt.label;
  if (!pt.label || skipLabel) {
    input.value = "Locating…";
    try {
      const r = await api.reverse(pt.lat, pt.lon);
      if (state[role] !== point) return false;
      point.label = r.name; input.value = r.name;
    } catch (e) { if (state[role] !== point) return false; point.label = `${pt.lat.toFixed(5)}, ${pt.lon.toFixed(5)}`; input.value = point.label; }
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

async function onPinDrag(role, lat, lon) {
  if (await setPoint(role, { lat, lon })) maybePlan();
  else map.setPin(role, state[role]);
}

let locationRevision = 0;
function locate() {
  if (!navigator.geolocation) return toast("Location isn't available in this browser.");
  resetSearch();
  const ticket = ++locationRevision;
  const previous = $("#in-origin").value;
  $("#in-origin").value = "Finding your location…";
  $("#btn-locate").disabled = true;
  const failed = (message) => {
    if (ticket !== locationRevision) return;
    $("#in-origin").value = previous; $("#btn-locate").disabled = false; toast(message);
  };
  navigator.geolocation.getCurrentPosition(async (position) => {
    if (ticket !== locationRevision) return;
    const { latitude: lat, longitude: lon } = position.coords;
    if (!regionOf(lat, lon)) return failed("Your location is outside our supported cities. Choose a starting point on the map.");
    $("#btn-locate").disabled = false;
    if (await setPoint("origin", { lat, lon, label: "Your location" })) maybePlan();
  }, () => failed("Couldn't get your location. You can choose a starting point on the map."),
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
  $("#results").setAttribute("aria-busy", "true");
  $("#btn-plan").textContent = "Finding routes…";
  $("#btn-plan").disabled = true;
  $("#panel").classList.add("has-trip");
  if (!state.result) $("#results").innerHTML = `<div class="loading"><div class="skel"></div><div class="skel"></div><div class="skel"></div></div>`;
  else $("#results").style.opacity = 0.55;
  try {
    const res = await api.route({
      origin: state.origin, destination: state.destination, mode: state.mode, hour: state.hour,
      safety_weight: state.safety, max_detour: state.detour, include_analysis: false,
    }, ctl.signal);
    if (ctl.signal.aborted || state.pending !== ctl) return;
    const first = !state.result;
    state.result = res;
    if (!res.routes[state.selected]) state.selected = "safest";
    renderResult();
    drawResult(first);
    $("#risk-legend").hidden = false;
    updateUrl();
  } catch (e) {
    if (e.name === "AbortError" || state.pending !== ctl) return;
    state.result = null;
    map.clearRoutes();
    $("#risk-legend").hidden = !map.visible.risk;
    $("#results").innerHTML = `<div class="empty-state">${ICON.warn}<h3>Couldn't plan that trip</h3><p>${esc(e.message)}</p><button class="text-btn" id="btn-retry">Try again</button></div>`;
    $("#btn-retry").onclick = plan;
  } finally {
    if (state.pending === ctl) { $("#results").style.opacity = 1; $("#results").setAttribute("aria-busy", "false"); $("#btn-plan").disabled = false; $("#btn-plan").textContent = "Find routes"; state.pending = null; }
  }
}

function updateUrl() {
  const p = new URLSearchParams({
    city: state.city, o: `${state.origin.lat.toFixed(5)},${state.origin.lon.toFixed(5)}`,
    d: `${state.destination.lat.toFixed(5)},${state.destination.lon.toFixed(5)}`,
    mode: state.mode, h: state.hour, s: state.safety, detour: state.detour, route: state.selected,
  });
  history.replaceState(null, "", `?${p}`);
}

function clearRoute() {
  locationRevision++;
  $("#btn-locate").disabled = false;
  history.replaceState(null, "", `?city=${encodeURIComponent(state.city)}`);
  $("#btn-plan").disabled = false;
  $("#btn-plan").textContent = "Find routes";
  $("#panel").classList.remove("has-trip");
  state.selected = "safest";
  state.tab = "overview";
  state.pending?.abort();
  state.pending = null;
  state.result = null;
  $("#results").style.opacity = 1;
  $("#results").setAttribute("aria-busy", "false");
  map?.clearRoutes();
  $("#risk-legend").hidden = !map?.visible.risk;
}

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
  const height = $("#panel").getBoundingClientRect().height;
  map.fit(all, mobile ? { top: 45, bottom: Math.min(height + 24, innerHeight - 140), left: 24, right: 24 } : { top: 60, bottom: 60, left: 450, right: 80 });
}

function select(k, focus = false) {
  if (!state.result?.routes[k]) return;
  state.selected = k;
  updateUrl();
  renderResult();
  drawResult(false);
  if (focus) $(`.route-card[data-k="${k}"]`)?.focus();
}

// ---------------------------------------------------------------------------
function renderEmpty() {
  const c = state.cities.find((x) => x.id === state.city);
  const ex = EXAMPLES[c?.region] || [];
  const saved = state.saved.filter((t) => t.city === state.city);
  $("#results").innerHTML = `<div class="empty-state">${ICON.shield}
    <h3>Plan a safer trip in ${esc(c?.name || "Gujarat")}</h3>
    <p>Choose your start and destination. Compare the fastest route with a choice that considers known crash locations, junctions and lighting.</p>
    ${saved.length ? `<div class="saved-heading">Saved trips <span>On this browser</span></div><div class="saved-trips">${saved.map((t) => `<div class="saved-row"><button class="saved-open" data-key="${esc(tripKey(t))}"><b>${esc(t.origin.label || "Starting point")}</b><small>to ${esc(t.destination.label || "Destination")} · ${MODE_LABEL[t.mode]}</small></button><button class="icon-btn saved-delete" data-key="${esc(tripKey(t))}" aria-label="Delete saved trip from ${esc(t.origin.label || "starting point")} to ${esc(t.destination.label || "destination")}">×</button></div>`).join("")}</div>` : ""}
    ${ex.length ? `<div class="sec-title">Try a trip</div><div class="examples">${ex.map((e, i) => `<button class="example" data-i="${i}">${ICON.route}<span><b>${esc(e.from.label)} → ${esc(e.to.label)}</b><small>${esc(e.note)}</small></span></button>`).join("")}</div>` : ""}
  </div>`;
  $$(".saved-open").forEach((button) => (button.onclick = async () => {
    const trip = state.saved.find((t) => tripKey(t) === button.dataset.key);
    if (!trip) return;
    setMode(trip.mode, false);
    await setPoint("origin", trip.origin, false, true);
    await setPoint("destination", trip.destination, false, true);
    maybePlan();
  }));
  $$(".saved-delete").forEach((button) => (button.onclick = () => {
    const value = state.saved.filter((t) => tripKey(t) !== button.dataset.key);
    if (store.set("sr-saved-trips", value)) { state.saved = value; renderEmpty(); }
    else toast("Browser storage is unavailable. Please try again.");
  }));
  $$(".example").forEach((b) => (b.onclick = async () => {
    const e = ex[+b.dataset.i];
    if (e.hour != null) { state.hour = e.hour; }
    setMode(e.mode || "car", false);
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
    { from: { lat: 21.1673, lon: 72.7853, label: "SVNIT campus" }, to: { lat: 21.1418, lon: 72.7562, label: "Dumas Road" }, hour: 21, note: "An evening trip from campus" },
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
    return `<div class="headline same">${ICON.shield}<div><b>One route fits both your preferences</b> for ${MODE_LABEL[res.mode]} travel at ${fmtHour(res.hour)}.</div></div>`;
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
  return `<div class="headline">${ICON.shield}<div><b>Safer choice: ${mins > 0 ? `+${mins} min` : "no extra time"}, ${Math.round(c.risk_reduction_pct)}% lower estimated risk</b>${extra.length ? " · " + extra.join(" · ") : ""}.${bal}${c.detour_capped ? ` <span style="color:var(--ink-2)">(Limited by your ${Math.round(c.max_detour * 100)}% detour cap.)</span>` : ""}</div></div>`;
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
  else facts.push(`<span class="fact">${ICON.shield}No mapped blackspots</span>`);
  if (res.is_dark) facts.push(`<span class="fact">${ICON.bulb}${r.exposure.unlit_km.toFixed(1)} km poorly lit</span>`);
  facts.push(`<span class="fact">${ICON.junction}${r.exposure.uncontrolled_junctions} uncontrolled junctions</span>`);
  facts.push(`<span class="fact">${ICON.turnR}${r.exposure.right_turns} right turns</span>`);
  return `<div class="route-card ${state.selected === k ? "sel" : ""}" data-k="${k}" style="--rc:var(${meta.css})" tabindex="0" role="button" aria-pressed="${state.selected === k}">
    <div class="rc-top"><span class="rc-key"></span>
      <div class="rc-main"><div class="rc-name">${meta.name}${k === "fastest" ? '<span class="tag">Time first</span>' : ""}</div>
        <div class="rc-time">${fmtDuration(r.time_s)}<small>Est. arrival ${arrivalTime(res.hour, r.time_s)}</small></div><div class="rc-sub">${sub}</div></div>
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
      ${["overview", "directions"].map((t) => `<button class="tab ${state.tab === t ? "on" : ""}" data-t="${t}" role="tab" aria-selected="${state.tab === t}">${t[0].toUpperCase() + t.slice(1)}</button>`).join("")}
    </div><div id="tab-body" role="tabpanel"></div><div class="trip-actions"><button class="text-btn" id="btn-save">Save trip</button><button class="text-btn" id="btn-share">Copy trip link</button></div>
    <p class="note">Safety and travel times are estimates, based on available road data. Conditions can change.</p>`;
  $$(".route-card").forEach((c) => {
    c.onclick = () => select(c.dataset.k);
    c.onkeydown = (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); select(c.dataset.k, true); } };
  });
  $$(".tab").forEach((t) => (t.onclick = () => { state.tab = t.dataset.t; renderResult(); $(`.tab[data-t="${state.tab}"]`).focus(); }));
  const saved = state.saved.some((t) => tripKey(t) === tripKey(state));
  $("#btn-save").textContent = saved ? "Trip saved" : "Save trip";
  $("#btn-save").disabled = saved;
  $("#btn-save").onclick = () => {
    const trip = { city: state.city, mode: state.mode, origin: {...state.origin}, destination: {...state.destination} };
    const value = [trip, ...state.saved.filter((t) => tripKey(t) !== tripKey(trip))].slice(0, 5);
    if (store.set("sr-saved-trips", value)) { state.saved = value; renderResult(); toast("Trip saved on this browser only"); }
    else toast("Browser storage is unavailable. Use Copy trip link instead.");
  };
  $("#btn-share").onclick = async () => {
    try { await navigator.clipboard.writeText(location.href); toast("Trip link copied"); }
    catch { toast("Copy the address from your browser to share this trip."); }
  };
  const body = $("#tab-body");
  if (state.tab === "overview") renderOverview(body, sel, res);
  else if (state.tab === "directions") renderDirections(body, sel);

}

function renderOverview(el, r, res) {
  const f = res.routes.fastest, isF = r === f;
  const tile = (l, v, d, good) => `<div class="tile"><div class="l">${l}</div><div class="v">${v}</div>${d != null ? `<div class="d ${good == null ? "" : good ? "good" : "bad"}">${d}</div>` : ""}</div>`;
  const reasons = routeReasons(r, f, res.is_dark);
  const offsets = (res.snap_distance_m || []).map((distance, index) => ({distance, name: index ? "destination" : "starting point"})).filter((p) => p.distance > 75);
  el.innerHTML = `
    <div class="route-insight"><div class="sec-title">${isF ? "About this route" : "Why this choice"}</div><ul>${reasons.map((reason) => `<li>${esc(reason)}</li>`).join("")}</ul></div>
    ${offsets.length ? `<div class="access-note">${ICON.pin}<span>${offsets.map((point) => `Your ${point.name} is about ${fmtDist(point.distance)} from the route`).join(". ")}. Check how to reach the road; this connection is not included in the time estimate.</span></div>` : ""}
    <div class="tiles">
      ${tile("Safety score", `${r.score.toFixed(0)}<small style="font-size:13px;color:var(--ink-2)">/100</small>`, isF ? r.label : `${signed(r.score - f.score, 0)} vs fastest`, isF ? null : r.score >= f.score)}
      ${tile("Known blackspots", r.blackspots.length, "near this route", null)}
      ${tile("Travel time", fmtDuration(r.time_s), isF ? `at ${fmtHour(res.hour)}` : `${signed((r.time_s - f.time_s) / 60, 0, " min")} vs fastest`, isF ? null : r.time_s <= f.time_s + 30)}
      ${tile("Distance", fmtDist(r.distance_m), isF ? `${Math.round(r.exposure.arterial_share * 100)}% on main roads` : `${signed((r.distance_m - f.distance_m) / 1000, 1, " km")} vs fastest`, null)}
    </div>
    <details class="route-details"><summary>What to expect along the way</summary><div class="sec-title">Safety factors</div><div id="bd"></div>
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
    </details><div class="sec-title">Accident blackspots on this route</div>
    ${r.blackspots.length ? r.blackspots.map((b, i) => `<div class="bs-item" data-i="${i}">${ICON.warn}<div><b>${esc(b.name)}</b><small>${b.accidents ?? "–"} crashes · ${b.deaths ?? "–"} deaths on record</small></div></div>`).join("")
      : `<div class="bs-item" style="cursor:default">${ICON.shield.replace("<svg", '<svg style="color:var(--st-good)"')}<div><b>None</b><small>No blackspots from our dataset were found near this route.</small></div></div>`}`;
  breakdownBar($("#bd", el), [
    { name: "Road & junction design", value: r.breakdown.road, color: cssVar("--r-safest") },
    { name: "Blackspot history", value: r.breakdown.blackspot, color: cssVar("--r-fastest") },
    { name: "Darkness", value: r.breakdown.lighting, color: cssVar("--r-balanced") },
    { name: "Personal security", value: r.breakdown.security, color: "#eda100" },
  ]);
  $$(".bs-item[data-i]", el).forEach((b) => (b.onclick = () => {
    const bs = r.blackspots[+b.dataset.i];
    map.flyTo(bs.lat, bs.lon, 15.5);
    const full = state.layerData[res.region]?.blackspots.find((x) => x.id === bs.id);
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
    li.tabIndex = 0;
    li.setAttribute("role", "button");
    li.setAttribute("aria-label", `Show on map: ${s.text}`);
    li.onkeydown = (event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); map.flyTo(s.lat, s.lon, 16.5); } };
    li.onmouseenter = () => map.highlight(s.lat, s.lon);
    li.onmouseleave = () => map.unhighlight();
    li.onclick = () => map.flyTo(s.lat, s.lon, 16.5);
  });
}

// ---------------------------------------------------------------------------
async function openDrawer() {
  $("#drawer").hidden = false; $("#drawer-scrim").hidden = false;
  $("#btn-drawer-close").focus();
  $("#drawer-body").innerHTML = `
    <div class="about-intro">A more informed way to choose your route.</div>
    <p>SafeRoute compares routes using road layout, junctions, recorded crash locations and estimated lighting. Choose a safer option and see how much extra time it takes.</p>
    <div class="sec-title">What the score means</div>
    <p>A higher score means lower estimated risk per kilometre. It is a comparison tool, not a guarantee of safety or a probability of avoiding a crash.</p>
    <div class="sec-title">What we know</div>
    <p>Roads and places come from OpenStreetMap. Historical crash records come from MoRTH and published Gujarat road safety reports. Satellite night lights help estimate lighting where street records are missing.</p>
    <div class="sec-title">What can change</div>
    <p>Traffic, roadworks and lighting may differ from the estimates. We do not have live traffic, incident or crime feeds. Follow road signs and local conditions.</p>
    <div class="sec-title">Our project</div>
    <p>Our team focuses on safety. Travel time helps you judge the detour. Air quality and traffic optimisation are outside this team's scope.</p>`;
}

function closeDrawer() { if (!$("#drawer").hidden) $("#btn-insights").focus(); $("#drawer").hidden = true; $("#drawer-scrim").hidden = true; }

init().catch((e) => {
  console.error(e);
  $("#results").innerHTML = `<div class="empty-state">${ICON.warn}<h3>Route planning is unavailable</h3><p>Please check your connection and try again.</p><button class="text-btn" id="btn-reload">Try again</button></div>`;
  $("#btn-reload").onclick = () => location.reload();
});
