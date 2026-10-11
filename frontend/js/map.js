// MapLibre wrapper: basemap, overlays, route drawing, pins and popups.
import { cssVar, esc } from "./util.js";

const STYLES = {
  light: "https://basemaps.cartocdn.com/gl/voyager-gl-style/style.json",
  dark: "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json",
};
const EMPTY = { type: "FeatureCollection", features: [] };

export class MapView {
  constructor(el, { center, zoom, theme, onMapClick, onPinDrag, onRouteClick }) {
    this.theme = theme;
    this.data = { routes: EMPTY, runs: EMPTY, network: EMPTY, police: EMPTY, hospital: EMPTY, cctv: EMPTY };
    this.visible = { risk: false, police: false, hospital: false, cctv: false, blackspots: true };
    this.bsMarkers = [];
    this.blackspots = [];
    this.handlers = { onMapClick, onPinDrag, onRouteClick };
    this.map = new maplibregl.Map({
      container: el, style: STYLES[theme], center: [center[1], center[0]], zoom,
      attributionControl: { compact: true }, maxPitch: 0, dragRotate: false,
    });
    this.map.touchZoomRotate.disableRotation();
    this.map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "bottom-right");
    this.map.addControl(new maplibregl.ScaleControl({ unit: "metric" }), "bottom-right");
    this.map.on("style.load", () => this._installOverlays());
    // overlays only need the style, not every tile, so don't wait for "load"
    this.ready = new Promise((res) => this.map.once("style.load", res));
    this.map.on("click", (e) => {
      const hits = this.map.queryRenderedFeatures(e.point, { layers: ["route-alt", "route-alt-hit", "poi-police", "poi-hospital", "poi-cctv"].filter((l) => this.map.getLayer(l)) });
      const route = hits.find((h) => h.layer.id.startsWith("route-alt"));
      if (route) return this.handlers.onRouteClick?.(route.properties.key);
      const poi = hits.find((h) => h.layer.id.startsWith("poi-"));
      if (poi) return this._poiPopup(poi, e.lngLat);
      this.handlers.onMapClick?.(e.lngLat);
    });
    for (const l of ["route-alt-hit", "poi-police", "poi-hospital", "poi-cctv"]) {
      this.map.on("mouseenter", l, () => { this.map.getCanvas().style.cursor = "pointer"; });
      this.map.on("mouseleave", l, () => { this.map.getCanvas().style.cursor = ""; });
    }
    this.pins = { origin: null, destination: null };
  }

  setTheme(theme) {
    if (theme === this.theme) return;
    this.theme = theme;
    this.map.setStyle(STYLES[theme]);
  }

  _colors() {
    return {
      good: cssVar("--st-good"), warning: cssVar("--st-warning"), serious: cssVar("--st-serious"), critical: cssVar("--st-critical"),
      casing: this.theme === "dark" ? "#0d0d0d" : "#ffffff",
    };
  }

  _installOverlays() {
    const m = this.map, c = this._colors();
    const before = m.getStyle().layers.find((l) => l.type === "symbol")?.id;
    for (const [id, data] of Object.entries(this.data)) {
      if (!m.getSource(id)) m.addSource(id, { type: "geojson", data });
    }
    const levelColor = ["match", ["get", "level"], 0, c.good, 1, c.good, 2, c.warning, 3, c.serious, c.critical];
    m.addLayer({
      id: "network", type: "line", source: "network", layout: { "line-cap": "round", visibility: this.visible.risk ? "visible" : "none" },
      paint: {
        "line-color": ["step", ["get", "r"], c.good, 1.0, c.warning, 1.6, c.serious, 2.5, c.critical],
        "line-width": ["interpolate", ["linear"], ["zoom"], 10, 1.2, 14, 3, 17, 6], "line-opacity": 0.8,
      },
    }, before);
    // alternative routes (identity colour, lighter)
    m.addLayer({ id: "route-alt-casing", type: "line", source: "routes", filter: ["!", ["get", "selected"]],
      layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": c.casing, "line-width": 9, "line-opacity": 0.9 } });
    m.addLayer({ id: "route-alt", type: "line", source: "routes", filter: ["!", ["get", "selected"]],
      layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": ["get", "color"], "line-width": 5, "line-opacity": 0.55 } });
    m.addLayer({ id: "route-alt-hit", type: "line", source: "routes", filter: ["!", ["get", "selected"]],
      paint: { "line-color": "#000", "line-width": 18, "line-opacity": 0 } });
    // selected route: casing in identity colour + risk-coloured core
    m.addLayer({ id: "route-sel-casing", type: "line", source: "routes", filter: ["get", "selected"],
      layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": ["get", "color"], "line-width": 11 } });
    m.addLayer({ id: "route-sel-inner", type: "line", source: "routes", filter: ["get", "selected"],
      layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": c.casing, "line-width": 7 } });
    m.addLayer({ id: "route-runs", type: "line", source: "runs",
      layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": levelColor, "line-width": 5 } });
    const poi = (id, color, r) => m.addLayer({
      id: `poi-${id}`, type: "circle", source: id, layout: { visibility: this.visible[id] ? "visible" : "none" },
      paint: { "circle-color": color, "circle-radius": ["interpolate", ["linear"], ["zoom"], 10, r - 1.5, 15, r + 2],
        "circle-stroke-color": c.casing, "circle-stroke-width": 2 },
    });
    poi("cctv", "#6250d6", 4); poi("police", "#2a78d6", 6); poi("hospital", "#e34948", 5);
  }

  _set(id, data) {
    this.data[id] = data;
    const s = this.map.getSource(id);
    if (s) s.setData(data);
  }

  drawRoutes(routes, order, selected, colors) {
    const feats = order.filter((k) => routes[k]).map((k) => ({
      type: "Feature", properties: { key: k, selected: k === selected, color: colors[k] },
      geometry: { type: "LineString", coordinates: routes[k].geometry },
    }));
    // draw the selected one last
    feats.sort((a, b) => a.properties.selected - b.properties.selected);
    this._set("routes", { type: "FeatureCollection", features: feats });
    const sel = routes[selected];
    this._set("runs", { type: "FeatureCollection", features: (sel?.runs || []).map((r) => ({
      type: "Feature", properties: { level: r.level }, geometry: { type: "LineString", coordinates: r.coords },
    })) });
  }

  clearRoutes() { this._set("routes", EMPTY); this._set("runs", EMPTY); }

  fit(coords, padding) {
    if (!coords?.length) return;
    const b = coords.reduce((bb, c) => bb.extend(c), new maplibregl.LngLatBounds(coords[0], coords[0]));
    this.map.fitBounds(b, { padding, duration: 700, maxZoom: 16 });
  }

  flyTo(lat, lon, zoom = 13) { this.map.flyTo({ center: [lon, lat], zoom, duration: 900 }); }

  // ---- layers ----------------------------------------------------------
  setNetwork(geojson) { this._set("network", geojson); }
  setPois(layers) {
    const fc = (arr) => ({ type: "FeatureCollection", features: (arr || []).map((p) => ({
      type: "Feature", properties: { name: p.name || "" }, geometry: { type: "Point", coordinates: [p.lon, p.lat] } })) });
    this._set("police", fc(layers.police)); this._set("hospital", fc(layers.hospital)); this._set("cctv", fc(layers.cctv));
  }
  setVisible(layer, on) {
    this.visible[layer] = on;
    const id = layer === "risk" ? "network" : `poi-${layer}`;
    if (layer === "blackspots") { this.bsMarkers.forEach((mk) => (mk.getElement().style.display = on ? "" : "none")); return; }
    if (this.map.getLayer(id)) this.map.setLayoutProperty(id, "visibility", on ? "visible" : "none");
  }

  setBlackspots(list, onRouteFrom) {
    this.bsMarkers.forEach((m) => m.remove());
    this.blackspots = list;
    this.bsMarkers = list.map((b) => {
      const el = document.createElement("div");
      el.className = "bs-marker";
      el.title = b.name;
      el.innerHTML = `<svg viewBox="0 0 24 24"><path d="M12 2.5l10 17.5H2z" fill="${cssVar("--st-critical")}" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/><path d="M12 9v5M12 16.8h.01" stroke="#fff" stroke-width="2.2" stroke-linecap="round"/></svg>`;
      el.style.display = this.visible.blackspots ? "" : "none";
      const mk = new maplibregl.Marker({ element: el, anchor: "bottom" }).setLngLat([b.lon, b.lat]).addTo(this.map);
      el.addEventListener("click", (ev) => { ev.stopPropagation(); this.blackspotPopup(b); });
      return mk;
    });
  }

  blackspotPopup(b) {
    const cat = { audit: "Gujarat Road Safety Authority audit", state_list: "State Traffic Branch / GRSA list",
      morth: "MoRTH NH blackspot (official)", incident: "Documented fatal crash" }[b.category] || b.category;
    const html = `<div class="pop"><h4>${esc(b.name)}</h4><div class="pk">${esc(cat)} · ${esc(b.period)}</div>
      <div class="pstats"><div><b>${b.accidents ?? "–"}</b><span>crashes</span></div><div><b>${b.deaths ?? "–"}</b><span>deaths</span></div>
      <div><b>×${(b.risk_multiplier ?? 1).toFixed(1)}</b><span>risk weight</span></div></div>
      <div class="pk">Risk weight from Empirical-Bayes: model predicted ${b.n_pred_per_year ?? "–"}/yr, observed ${b.n_obs_per_year ?? "n/a"}/yr.</div>
      <div class="pk" style="margin-top:6px">Source: <a href="${esc(b.source_url)}" target="_blank" rel="noopener">${esc(b.source)}</a></div></div>`;
    new maplibregl.Popup({ offset: 18, maxWidth: "300px" }).setLngLat([b.lon, b.lat]).setHTML(html).addTo(this.map);
  }

  _poiPopup(f, lngLat) {
    const kind = { "poi-police": "Police station", "poi-hospital": "Hospital", "poi-cctv": "CCTV camera" }[f.layer.id];
    new maplibregl.Popup({ offset: 10 }).setLngLat(lngLat)
      .setHTML(`<div class="pop"><h4>${esc(f.properties.name || kind)}</h4><div class="pk">${kind} · OpenStreetMap</div></div>`).addTo(this.map);
  }

  // ---- pins ------------------------------------------------------------
  setPin(role, pt) {
    if (!pt) { this.pins[role]?.remove(); this.pins[role] = null; return; }
    if (!this.pins[role]) {
      const el = document.createElement("div");
      if (role === "origin") el.className = "pin-o";
      else {
        el.className = "pin";
        el.innerHTML = `<svg viewBox="0 0 30 40"><path d="M15 39C15 39 2 23.5 2 14a13 13 0 0126 0c0 9.5-13 25-13 25z" fill="#d03b3b" stroke="#fff" stroke-width="1.5"/><circle cx="15" cy="14" r="4.6" fill="#fff"/></svg>`;
      }
      const mk = new maplibregl.Marker({ element: el, draggable: true, anchor: role === "origin" ? "center" : "bottom" });
      mk.on("dragend", () => { const ll = mk.getLngLat(); this.handlers.onPinDrag?.(role, ll.lat, ll.lng); });
      this.pins[role] = mk;
      mk.setLngLat([pt.lon, pt.lat]).addTo(this.map);
    } else this.pins[role].setLngLat([pt.lon, pt.lat]);
  }

  contextPopup(lngLat, title, onFrom, onTo) {
    this._ctx?.remove();
    const div = document.createElement("div");
    div.className = "pop";
    div.innerHTML = `<h4>${esc(title)}</h4><div class="pk">${lngLat.lat.toFixed(5)}, ${lngLat.lng.toFixed(5)}</div>
      <div class="actions"><button data-a="from">Directions from here</button><button data-a="to">Directions to here</button></div>`;
    div.querySelector('[data-a="from"]').onclick = () => { this._ctx.remove(); onFrom(); };
    div.querySelector('[data-a="to"]').onclick = () => { this._ctx.remove(); onTo(); };
    this._ctx = new maplibregl.Popup({ offset: 6, maxWidth: "300px" }).setLngLat(lngLat).setDOMContent(div).addTo(this.map);
    return (name) => { const h = div.querySelector("h4"); if (h) h.textContent = name; };
  }

  highlight(lat, lon) {
    if (!this._hl) {
      const el = document.createElement("div");
      el.style.cssText = "width:16px;height:16px;border-radius:50%;background:var(--accent);border:3px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.4)";
      this._hl = new maplibregl.Marker({ element: el });
    }
    this._hl.setLngLat([lon, lat]).addTo(this.map);
  }
  unhighlight() { this._hl?.remove(); }
}
