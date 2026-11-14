// Navigation geometry/state are independent of browser APIs for deterministic tests.
const R = 6371008.8, RAD = Math.PI / 180;
export function metres(a, b) {
  return R * Math.hypot((a[0] - b[0]) * RAD * Math.cos((a[1] + b[1]) / 2 * RAD), (a[1] - b[1]) * RAD);
}

export function prepareRoute(route, destination) {
  if (!route?.geometry || route.geometry.length < 2 || !route.directions?.length) throw new Error("This route has no navigation instructions.");
  const coords = route.geometry, cumulative = [0];
  for (let i = 1; i < coords.length; i++) cumulative.push(cumulative[i - 1] + metres(coords[i - 1], coords[i]));
  const length = cumulative.at(-1);
  if (!(length > 0) || !(route.distance_m > 0)) throw new Error("This route is too short to navigate.");
  let offset = 0;
  const steps = route.directions.map((step) => {
    const value = { ...step, at: (step.distance_from_start_m ?? offset) / route.distance_m * length };
    if (step.type === "arrive") value.text = destination && metres(coords.at(-1), [destination.lon, destination.lat]) > 10 ? "Reach the end of the mapped route" : "Your destination is ahead";
    offset += step.distance_m;
    return value;
  });
  return { coords, cumulative, length, steps, destination, time: route.time_s, scale: route.distance_m / length };
}

export function pointAt(route, progress) {
  const at = Math.max(0, Math.min(progress, route.length));
  let i = 1;
  while (i < route.cumulative.length - 1 && route.cumulative[i] < at) i++;
  const span = route.cumulative[i] - route.cumulative[i - 1];
  const f = span > 0 ? (at - route.cumulative[i - 1]) / span : 0;
  return route.coords[i].map((v, j) => route.coords[i - 1][j] + f * (v - route.coords[i - 1][j]));
}

export function projectPosition(route, point, min = 0, max = Infinity) {
  const kx = R * RAD * Math.cos(point[1] * RAD), ky = R * RAD;
  let best = { distance: Infinity, progress: min, point: route.coords[0] };
  for (let i = 1; i < route.coords.length; i++) {
    const start = route.cumulative[i - 1], end = route.cumulative[i];
    if (end < min || start > max || end === start) continue;
    const a = route.coords[i - 1], b = route.coords[i];
    const dx = (b[0] - a[0]) * kx, dy = (b[1] - a[1]) * ky;
    const px = (point[0] - a[0]) * kx, py = (point[1] - a[1]) * ky;
    let f = Math.max(0, Math.min(1, (px * dx + py * dy) / (dx * dx + dy * dy)));
    f = Math.max(Math.max(0, (min - start) / (end - start)), Math.min(f, Math.min(1, (max - start) / (end - start))));
    const distance = Math.hypot(px - f * dx, py - f * dy);
    if (distance < best.distance) best = { distance, progress: start + f * (end - start), point: [a[0] + f * (b[0] - a[0]), a[1] + f * (b[1] - a[1])] };
  }
  return best;
}

export class NavigationSession {
  constructor(route, mode = "car", destination) {
    this.route = prepareRoute(route, destination);
    this.mode = mode;
    this.progress = 0;
    this.lastFix = null;
    this.lastTimestamp = null;
    this.nextStep = 1;
    this.offSince = null;
    this.offCount = 0;
    this.finished = false;
  }

  update(fix, now = Date.now()) {
    const { lat, lon, accuracy, timestamp } = fix;
    if (![lat, lon, accuracy, timestamp].every(Number.isFinite) || Math.abs(lat) > 90 || Math.abs(lon) > 180 || accuracy < 0 || accuracy > 35 || now - timestamp > 15000 || timestamp > now + 5000 || (this.lastTimestamp !== null && timestamp <= this.lastTimestamp)) {
      this.offSince = null; this.offCount = 0;
      return { status: "uncertain", message: "Waiting for a reliable location…" };
    }
    this.lastTimestamp = timestamp;
    const elapsed = this.lastFix ? (timestamp - this.lastFix.timestamp) / 1000 : 0;
    // Avoid a distant branch winning at crossings. Large jumps require rerouting.
    const window = this.mode === "walk" ? Math.max(60, elapsed * 5) : Math.max(150, elapsed * 60);
    const matched = projectPosition(this.route, [lon, lat], this.lastFix ? Math.max(0, this.progress - 35) : 0, this.lastFix ? this.progress + Math.min(window, 1200) : Infinity);
    const threshold = this.mode === "walk" ? 35 : 55;
    if (matched.distance > threshold) {
      this.offSince ??= now; this.offCount++;
      return { status: "offroute", message: "You’re away from the selected route", reroute: this.offCount >= 3 && now - this.offSince >= 8000, fix };
    }
    this.offSince = null; this.offCount = 0;
    this.progress = Math.max(this.progress, matched.progress);
    this.lastFix = fix;
    const remaining = Math.max(0, (this.route.length - this.progress) * this.route.scale);
    const end = this.route.coords.at(-1);
    const arrivalRadius = this.mode === "walk" ? 12 : 22;
    const destination = this.route.destination;
    const destinationDistance = destination ? metres([lon, lat], [destination.lon, destination.lat]) : 0;
    const endpointGap = destination ? metres(end, [destination.lon, destination.lat]) : 0;
    const atEnd = remaining <= arrivalRadius && (metres([lon, lat], end) <= arrivalRadius || (destination && destinationDistance <= arrivalRadius));
    if (atEnd && accuracy > arrivalRadius) return {status:"uncertain",message:"Near the end of the route. Waiting for a more precise location…"};
    if (atEnd) {
      if (destination && destinationDistance > arrivalRadius && endpointGap <= arrivalRadius) {
        return {status:"navigating",message:"Your destination is ahead",distance:destinationDistance,remaining:destinationDistance,remainingSeconds:0,point:matched.point};
      }
      const atDestination = !destination || metres([lon, lat], [destination.lon, destination.lat]) <= arrivalRadius;
      const status = atDestination ? "arrived" : "route-end";
      const message = atDestination ? "You’ve arrived at your destination" : "The mapped route ends here. Check the remaining way to your destination.";
      this.finished = true;
      return { status, message, remaining, remainingSeconds: 0, point: matched.point };
    }
    const steps = this.route.steps;
    while (this.nextStep < steps.length - 1 && this.progress > steps[this.nextStep].at + 12) this.nextStep++;
    const next = steps[this.nextStep] || steps.at(-1);
    const distance = Math.max(0, (next.at - this.progress) * this.route.scale);
    const currentIndex = Math.max(0, this.nextStep - 1), current = steps[currentIndex];
    const span = Math.max(1, next.at - current.at);
    const fraction = Math.max(0, Math.min(1, (next.at - this.progress) / span));
    const remainingSeconds = current.time_s * fraction + steps.slice(this.nextStep).reduce((sum, s) => sum + s.time_s, 0);
    return { status: "navigating", message: next.text, distance, remaining, remainingSeconds, point: matched.point, step: next, progress: this.progress };
  }
}

// Keep heading stable at rest; derive bearing only from meaningful movement.
export function positionHeading(previous, current, fallback = 0) {
  const c = current.coords;
  if (Number.isFinite(c.heading) && c.heading >= 0 && c.heading < 360 && c.speed >= .5) return c.heading;
  const p = previous?.coords;
  if (!p || c.accuracy > 35 || p.accuracy > 35) return fallback;
  const distance = metres([p.longitude,p.latitude], [c.longitude,c.latitude]);
  if (distance < Math.max(5, p.accuracy, c.accuracy)) return fallback;
  const lat1=p.latitude*RAD, lat2=c.latitude*RAD, delta=(c.longitude-p.longitude)*RAD;
  return (Math.atan2(Math.sin(delta)*Math.cos(lat2), Math.cos(lat1)*Math.sin(lat2)-Math.sin(lat1)*Math.cos(lat2)*Math.cos(delta))/RAD+360)%360;
}
