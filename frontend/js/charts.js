// Small hand-built SVG charts (no chart library). Specs: 2px lines, hairline
// grid, ≥8px markers with a 2px surface ring, legend for ≥2 series, hover
// tooltip on every chart, and a table view as the non-visual fallback.
import { esc, fmtDuration } from "./util.js";


function niceTicks(max, n = 4) {
  const raw = max / n;
  const mag = 10 ** Math.floor(Math.log10(raw || 1));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) || raw;
  const ticks = [];
  for (let v = 0; v <= max + 1e-9; v += step) ticks.push(+v.toFixed(6));
  if (ticks[ticks.length - 1] < max) ticks.push(+(ticks[ticks.length - 1] + step).toFixed(6));
  return ticks;
}

function tableToggle(host, headers, rows) {
  const btn = document.createElement("button");
  btn.className = "table-toggle";
  btn.textContent = "Show data table";
  const wrap = document.createElement("div");
  wrap.hidden = true;
  wrap.innerHTML = `<table class="data-table"><thead><tr>${headers.map((h) => `<th>${esc(h)}</th>`).join("")}</tr></thead>
    <tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
  btn.onclick = () => { wrap.hidden = !wrap.hidden; btn.textContent = wrap.hidden ? "Show data table" : "Hide data table"; };
  host.append(btn, wrap);
}

/** Risk along the route: relative risk (1 = average road) vs distance. */
export function riskProfile(host, series) {
  host.innerHTML = "";
  const W = Math.max(280, host.clientWidth || 340), H = 170, m = { l: 34, r: 10, t: 10, b: 24 };
  const xmax = Math.max(...series.map((s) => s.points.at(-1)[0]));
  const ycap = 4;
  const ymaxData = Math.max(...series.flatMap((s) => s.points.map((p) => Math.min(p[1], ycap))));
  const yt = niceTicks(Math.max(2, ymaxData), 4);
  const ymax = yt.at(-1);
  const xt = niceTicks(xmax, 4).filter((v) => v <= xmax + 1e-9);
  const X = (v) => m.l + (v / xmax) * (W - m.l - m.r);
  const Y = (v) => m.t + (1 - Math.min(v, ycap) / ymax) * (H - m.t - m.b);

  const legend = document.createElement("div");
  legend.className = "chart-legend";
  legend.innerHTML = series.map((s) => `<span><i style="background:${s.color}"></i>${esc(s.name)}</span>`).join("")
    + `<span><i style="background:var(--axis);height:1px"></i>Average road = 1×</span>`;
  const wrap = document.createElement("div");
  wrap.className = "chart";
  let svg = `<svg viewBox="0 0 ${W} ${H}" height="${H}" role="img" aria-label="Risk along route">`;
  for (const v of yt) svg += `<line class="gl" x1="${m.l}" x2="${W - m.r}" y1="${Y(v)}" y2="${Y(v)}"/><text x="${m.l - 6}" y="${Y(v) + 4}" text-anchor="end">${v}×</text>`;
  for (const v of xt) svg += `<text x="${X(v)}" y="${H - 6}" text-anchor="middle">${v} km</text>`;
  svg += `<line class="ax" x1="${m.l}" x2="${W - m.r}" y1="${Y(0)}" y2="${Y(0)}"/>`;
  svg += `<line x1="${m.l}" x2="${W - m.r}" y1="${Y(1)}" y2="${Y(1)}" stroke="var(--axis)" stroke-width="1"/>`;
  [...series].reverse().forEach((s) => {
    const d = s.points.map((p, i) => `${i ? "L" : "M"}${X(p[0]).toFixed(1)},${Y(p[1]).toFixed(1)}`).join("");
    svg += `<path class="ar" fill="${s.color}" d="${d}L${X(s.points.at(-1)[0])},${Y(0)}L${X(0)},${Y(0)}Z"/>`;
    svg += `<path class="ln" stroke="${s.color}" d="${d}"/>`;
  });
  svg += `<line class="xh" x1="0" x2="0" y1="${m.t}" y2="${H - m.b}" visibility="hidden"/>`;
  series.forEach((s, i) => { svg += `<circle data-i="${i}" r="4" fill="${s.color}" stroke="var(--surface)" stroke-width="2" visibility="hidden"/>`; });
  svg += `<rect x="${m.l}" y="0" width="${W - m.l - m.r}" height="${H}" fill="transparent"/></svg>`;
  wrap.innerHTML = svg + `<div class="tip"></div>`;
  host.append(legend, wrap);

  const el = wrap.querySelector("svg"), tip = wrap.querySelector(".tip"), xh = el.querySelector(".xh");
  const valAt = (pts, x) => { for (let i = 1; i < pts.length; i++) if (pts[i][0] >= x) return pts[i][1]; return pts.at(-1)[1]; };
  el.addEventListener("pointermove", (ev) => {
    const r = el.getBoundingClientRect();
    const px = ((ev.clientX - r.left) / r.width) * W;
    const x = Math.max(0, Math.min(xmax, ((px - m.l) / (W - m.l - m.r)) * xmax));
    xh.setAttribute("x1", X(x)); xh.setAttribute("x2", X(x)); xh.setAttribute("visibility", "visible");
    let rows = "";
    series.forEach((s, i) => {
      const inRange = x <= s.points.at(-1)[0];
      const c = el.querySelector(`circle[data-i="${i}"]`);
      if (!inRange) { c.setAttribute("visibility", "hidden"); return; }
      const v = valAt(s.points, x);
      c.setAttribute("cx", X(x)); c.setAttribute("cy", Y(v)); c.setAttribute("visibility", "visible");
      rows += `<div class="row"><i style="background:${s.color}"></i>${esc(s.name)} <b>${v.toFixed(2)}×</b></div>`;
    });
    tip.innerHTML = `<div>${x.toFixed(1)} km</div>${rows}`;
    tip.style.left = `${(X(x) / W) * r.width}px`; tip.style.top = `${m.t + 10}px`;
    tip.classList.add("on");
  });
  el.addEventListener("pointerleave", () => {
    tip.classList.remove("on"); xh.setAttribute("visibility", "hidden");
    el.querySelectorAll("circle").forEach((c) => c.setAttribute("visibility", "hidden"));
  });
  const rows = [];
  const step = Math.max(0.5, Math.round(xmax / 10 * 2) / 2);
  for (let x = 0; x <= xmax; x += step) rows.push([`${x.toFixed(1)} km`, ...series.map((s) => (x <= s.points.at(-1)[0] ? valAt(s.points, x).toFixed(2) + "×" : "–"))]);
  tableToggle(host, ["Distance", ...series.map((s) => s.name)], rows);
}

/** Pareto front: travel time vs safety score. */
export function paretoChart(host, points, named, onPick) {
  host.innerHTML = "";
  const W = Math.max(280, host.clientWidth || 340), H = 180, m = { l: 34, r: 14, t: 14, b: 28 };
  const all = [...points, ...named];
  const tmin = Math.min(...all.map((p) => p.time_s)) / 60, tmax = Math.max(...all.map((p) => p.time_s)) / 60;
  const pad = Math.max(0.5, (tmax - tmin) * 0.1);
  const x0 = Math.max(0, Math.floor(tmin - pad)), x1 = Math.ceil(tmax + pad);
  const smin = Math.min(...all.map((p) => p.score)), smax = Math.max(...all.map((p) => p.score));
  const y0 = Math.max(0, Math.floor((smin - 5) / 10) * 10), y1 = Math.min(100, Math.ceil((smax + 5) / 10) * 10);
  const X = (v) => m.l + ((v - x0) / (x1 - x0)) * (W - m.l - m.r);
  const Y = (v) => m.t + (1 - (v - y0) / (y1 - y0)) * (H - m.t - m.b);
  const legend = document.createElement("div");
  legend.className = "chart-legend";
  legend.innerHTML = named.map((p) => `<span><i class="sq" style="background:${p.color};border-radius:50%"></i>${esc(p.name)}</span>`).join("")
    + `<span><i class="sq" style="background:var(--muted);border-radius:50%"></i>Other trade-offs</span>`;
  const wrap = document.createElement("div");
  wrap.className = "chart";
  let svg = `<svg viewBox="0 0 ${W} ${H}" height="${H}" role="img" aria-label="Time versus safety trade-off">`;
  for (let v = y0; v <= y1; v += 10) svg += `<line class="gl" x1="${m.l}" x2="${W - m.r}" y1="${Y(v)}" y2="${Y(v)}"/><text x="${m.l - 6}" y="${Y(v) + 4}" text-anchor="end">${v}</text>`;
  const xs = niceTicks(x1 - x0, 4).map((v) => v + x0).filter((v) => v <= x1);
  for (const v of xs) svg += `<text x="${X(v)}" y="${H - 8}" text-anchor="middle">${v} min</text>`;
  svg += `<line class="ax" x1="${m.l}" x2="${W - m.r}" y1="${H - m.b}" y2="${H - m.b}"/>`;
  const sorted = [...points].sort((a, b) => a.time_s - b.time_s);
  svg += `<path class="ln" stroke="var(--axis)" d="${sorted.map((p, i) => `${i ? "L" : "M"}${X(p.time_s / 60)},${Y(p.score)}`).join("")}"/>`;
  points.forEach((p, i) => { svg += `<circle data-p="${i}" cx="${X(p.time_s / 60)}" cy="${Y(p.score)}" r="4" fill="var(--muted)" stroke="var(--surface)" stroke-width="2"/>`; });
  named.forEach((p, i) => {
    const cx = X(p.time_s / 60), cy = Y(p.score);
    svg += `<circle data-n="${i}" cx="${cx}" cy="${cy}" r="6" fill="${p.color}" stroke="var(--surface)" stroke-width="2" style="cursor:pointer"/>`;
  });
  // selective direct labels: only the named routes, nudged to avoid overlaps
  const placed = [];
  named.forEach((p) => {
    let ly = Y(p.score) - 11;
    while (placed.some((q) => Math.abs(q.y - ly) < 12 && Math.abs(q.x - X(p.time_s / 60)) < 60)) ly -= 12;
    placed.push({ x: X(p.time_s / 60), y: ly });
    const anchor = X(p.time_s / 60) > W - 60 ? "end" : X(p.time_s / 60) < m.l + 30 ? "start" : "middle";
    svg += `<text class="tl" x="${X(p.time_s / 60)}" y="${ly}" text-anchor="${anchor}">${esc(p.name)}</text>`;
  });
  svg += `<text x="${m.l}" y="${m.t - 4}" text-anchor="start">Safety score</text></svg>`;
  wrap.innerHTML = svg + `<div class="tip"></div>`;
  host.append(legend, wrap);
  const el = wrap.querySelector("svg"), tip = wrap.querySelector(".tip");
  const show = (p, cx, cy, label) => {
    const r = el.getBoundingClientRect();
    tip.innerHTML = `${label ? `<b>${esc(label)}</b><br>` : ""}${fmtDuration(p.time_s)} · score <b>${p.score.toFixed(0)}</b><br>${(p.distance_m / 1000).toFixed(1)} km`;
    tip.style.left = `${(cx / W) * r.width}px`; tip.style.top = `${(cy / H) * r.height}px`;
    tip.classList.add("on");
  };
  el.querySelectorAll("circle[data-p]").forEach((c) => {
    const p = points[+c.dataset.p];
    c.addEventListener("pointerenter", () => show(p, +c.getAttribute("cx"), +c.getAttribute("cy"), p.balanced ? "Balanced" : "Alternative"));
    c.addEventListener("pointerleave", () => tip.classList.remove("on"));
  });
  el.querySelectorAll("circle[data-n]").forEach((c) => {
    const p = named[+c.dataset.n];
    c.addEventListener("pointerenter", () => show(p, +c.getAttribute("cx"), +c.getAttribute("cy"), p.name));
    c.addEventListener("pointerleave", () => tip.classList.remove("on"));
    c.addEventListener("click", () => onPick && onPick(p.key));
  });
  tableToggle(host, ["Route", "Time", "Distance", "Score"],
    [...named.map((p) => [p.name, fmtDuration(p.time_s), `${(p.distance_m / 1000).toFixed(1)} km`, p.score.toFixed(0)]),
     ...points.filter((p) => !named.some((n) => Math.abs(n.time_s - p.time_s) < 1)).map((p) => ["Alternative", fmtDuration(p.time_s), `${(p.distance_m / 1000).toFixed(1)} km`, p.score.toFixed(0)])]);
}

/** Composition of route risk as a single stacked bar + legend. */
export function breakdownBar(host, parts) {
  const total = parts.reduce((a, p) => a + p.value, 0) || 1;
  host.innerHTML = `<div class="stackbar">${parts.filter((p) => p.value > 0.004).map((p) =>
    `<div title="${esc(p.name)}: ${(100 * p.value / total).toFixed(0)}%" style="width:${(100 * p.value / total).toFixed(2)}%;background:${p.color}"></div>`).join("")}</div>
    <div class="chart-legend" style="margin-top:8px">${parts.map((p) =>
    `<span><i class="sq" style="background:${p.color}"></i>${esc(p.name)} ${(100 * p.value / total).toFixed(0)}%</span>`).join("")}</div>`;
}

/** Single-series column chart (time-of-day risk). */
export function columns(host, data, { color = "var(--accent)", unit = "", refLine = null } = {}) {
  host.innerHTML = "";
  const W = Math.max(280, host.clientWidth || 440), H = 170, m = { l: 34, r: 8, t: 12, b: 26 };
  const ymax = niceTicks(Math.max(...data.map((d) => d.value)), 4).at(-1);
  const bw = Math.min(24, ((W - m.l - m.r) / data.length) * 0.62);
  const slot = (W - m.l - m.r) / data.length;
  const Y = (v) => m.t + (1 - v / ymax) * (H - m.t - m.b);
  const wrap = document.createElement("div");
  wrap.className = "chart";
  let svg = `<svg viewBox="0 0 ${W} ${H}" height="${H}" role="img">`;
  for (const v of niceTicks(ymax, 4)) svg += `<line class="gl" x1="${m.l}" x2="${W - m.r}" y1="${Y(v)}" y2="${Y(v)}"/><text x="${m.l - 6}" y="${Y(v) + 4}" text-anchor="end">${v}${unit}</text>`;
  if (refLine != null) svg += `<line x1="${m.l}" x2="${W - m.r}" y1="${Y(refLine)}" y2="${Y(refLine)}" stroke="var(--ink-2)" stroke-width="1"/>`;
  data.forEach((d, i) => {
    const x = m.l + slot * i + (slot - bw) / 2, y = Y(d.value), h = Y(0) - y, r = Math.min(4, h);
    svg += `<path data-i="${i}" fill="${d.color || color}" d="M${x},${Y(0)}V${y + r}Q${x},${y} ${x + r},${y}H${x + bw - r}Q${x + bw},${y} ${x + bw},${y + r}V${Y(0)}Z"/>`;
    svg += `<text x="${x + bw / 2}" y="${H - 8}" text-anchor="middle">${esc(d.label)}</text>`;
    svg += `<rect data-h="${i}" x="${m.l + slot * i}" y="${m.t}" width="${slot}" height="${H - m.t - m.b}" fill="transparent"/>`;
  });
  svg += `<line class="ax" x1="${m.l}" x2="${W - m.r}" y1="${Y(0)}" y2="${Y(0)}"/></svg>`;
  wrap.innerHTML = svg + `<div class="tip"></div>`;
  host.append(wrap);
  const el = wrap.querySelector("svg"), tip = wrap.querySelector(".tip");
  el.querySelectorAll("rect[data-h]").forEach((rc) => {
    const d = data[+rc.dataset.h];
    rc.addEventListener("pointerenter", () => {
      const r = el.getBoundingClientRect();
      tip.innerHTML = d.tip || `${esc(d.label)}: <b>${d.value}${unit}</b>`;
      const cx = m.l + slot * (+rc.dataset.h + 0.5);
      tip.style.left = `${(cx / W) * r.width}px`; tip.style.top = `${(Y(d.value) / H) * r.height}px`;
      tip.classList.add("on");
    });
    rc.addEventListener("pointerleave", () => tip.classList.remove("on"));
  });
  tableToggle(host, ["Interval", "Value"], data.map((d) => [d.label, `${d.value}${unit}`]));
}
