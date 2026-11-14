import { LocationTracker } from "./location.js";
import { NavigationSession, pointAt, positionHeading, metres } from "./navigation.js";
import { $, fmtDist, fmtDuration } from "./util.js";

// Owns every navigation resource; stop() also invalidates pending reroutes.
export class NavigationUI {
  constructor({ map, reroute, onRoute, toast, geolocation = navigator.geolocation, clock = () => Date.now(), wakeLock = navigator.wakeLock, permissions = navigator.permissions, clipboard = navigator.clipboard, pageURL = () => window.location?.href || "", userAgent = navigator.userAgent || "" }) {
    Object.assign(this, { map, reroute, onRoute, toast, geolocation, clock, wakeLock, permissions, clipboard, pageURL, userAgent });
    this.generation = 0; this.watch = null; this.timer = null; this.wake = null;
    this.controller = null; this.active = false; this.follow = true;
    $("#nav-stop").onclick = () => this.stop();
    $("#nav-location-retry").onclick = () => {
      if (!this.active || this.preview) return;
      this.controller?.abort(); this.controller = null;
      this.location.start();
    };
    $("#nav-location-preview").onclick = () => { if (this.active) this.start(this.trip, true); };
    $("#nav-location-copy").onclick = async () => {
      try {
        await this.clipboard.writeText(this.pageURL());
        this.toast("Trip link copied. Paste it in Chrome, Edge or Safari, then choose Follow my location there.");
      } catch {
        $("#nav-location-url").focus(); $("#nav-location-url").select();
        this.toast("Copy the selected trip address and paste it in your browser.");
      }
    };
    $("#nav-location-url").onclick = () => $("#nav-location-url").select();
    $("#nav-open-browser").onclick = () => {
      // Do not leave location watches running in two browsers.
      this.location?.stop(); this.releaseWake();
      this.show({status:"uncertain", locationState:"handoff", message:"Continue in Microsoft Edge. Allow location and choose Follow my location there."});
    };
    $("#nav-follow").onclick = () => {
      this.follow = true; this.updateFollowButton();
      if (this.position) this.map.followPosition(this.position.point, this.position.accuracy);
    };
    this.map.map.on("dragstart", () => { if (this.active) { this.follow = false; this.updateFollowButton(); } });
    window.addEventListener("resize", () => { if (this.active && this.follow && this.position) this.map.followPosition(this.position.point, this.position.accuracy); });
    window.addEventListener("pagehide", () => this.stop(false));
    document.addEventListener("visibilitychange", () => {
      if (!this.active) return;
      if (document.hidden) { this.hiddenAt = this.clock(); }
      else {
        if (this.clock() - (this.hiddenAt || 0) > 15000) this.show({ status: "uncertain", message: "Updating your location…" });
        this.requestWake();
        if (!this.preview && !this.session.finished) this.location?.start();
      }
    });
  }

  start(trip, preview = false) {
    if (!preview && (!window.isSecureContext || !this.geolocation)) {
      this.toast("Live navigation needs location access on HTTPS or localhost. You can still preview the route."); return;
    }
    let session;
    try { session = new NavigationSession(trip.result.routes[trip.selected], trip.result.mode, trip.destination); }
    catch (error) { this.toast(error.message); return; }
    this.stop(false);
    this.session = session; this.trip = trip; this.preview = preview; this.position = null; this.headingFix = null; this.heading = 0;
    this.active = true; this.follow = true; this.lastReceived = this.clock(); this.lastReroute = -Infinity;
    this.updateFollowButton();
    this.map.setNavigationMode?.(true);
    document.body.classList.add("navigating");
    $("#navigation").hidden = false;
    $("#nav-label").textContent = preview ? "ROUTE PREVIEW · SIMULATED LOCATION" : "LIVE LOCATION";
    $("#nav-note").textContent = preview ? "Simulation only. No device location is used." : "Keep this page open. Follow road signs and local conditions.";
    $("#nav-stop").textContent = preview ? "End preview" : "Stop tracking";
    $("#nav-stop").focus();
    this.show({ status: "waiting", message: preview ? "Starting route preview…" : "Finding your location…" });
    this.map.navigationPosition(null);
    const token = this.generation;
    if (!preview) this.requestWake();
    if (preview) {
      let progress = 0;
      const advance = () => {
        if (!this.active || token !== this.generation) return;
        const [lon, lat] = pointAt(this.session.route, progress);
        this.receive({ coords: { latitude: lat, longitude: lon, accuracy: 5, speed: trip.result.mode === "walk" ? 1.4 : 10 }, timestamp: this.clock() });
        progress += trip.result.mode === "walk" ? 5 : 18;
      };
      advance();
      if (this.active && !this.session.finished) this.timer = setInterval(advance, 1000);
    } else {
      this.location = new LocationTracker({
        geolocation: this.geolocation, permissions: this.permissions, clock: this.clock,
        onPosition: (position) => {
          if (this.active && token === this.generation) this.receive(position);
        },
        onStatus: (status) => {
          if (!this.active || token !== this.generation) return;
          this.controller?.abort(); this.controller = null;
          this.session.offSince = null; this.session.offCount = 0;
          if (status.kind === "denied") this.releaseWake();
          this.show({status:"uncertain", message:status.message, locationState:status.kind, location:status.position});
        },
      });
      this.location.start();
    }
  }

  receive(position) {
    if (!this.active || this.session.finished) return;
    const c = position.coords;
    const fix = { lat: c.latitude, lon: c.longitude, accuracy: c.accuracy, speed: c.speed, timestamp: position.timestamp };
    this.lastReceived = this.clock();
    const result = this.session.update(fix, this.clock());
    if (result.status === "uncertain") { this.renderPosition(position); this.show(result); return; }
    this.renderPosition(position);
    if (result.status === "offroute") {
      this.show(result);
      if (result.reroute && !this.preview) this.recalculate(fix);
      return;
    }
    if (this.controller) { this.controller.abort(); this.controller = null; }
    this.show(result);
    if (this.session.finished) { this.releaseTracking(); this.releaseWake(); $("#nav-stop").textContent = "Done"; }
  }

  async recalculate(fix) {
    if (this.controller || this.clock() - this.lastReroute < 30000) return;
    this.lastReroute = this.clock();
    const controller = new AbortController(), token = this.generation;
    this.controller = controller;
    this.show({ status: "rerouting", message: "Finding a new route from your location…" });
    try {
      const result = await this.reroute(this.trip, fix, AbortSignal.any([controller.signal, AbortSignal.timeout(20000)]));
      if (!this.active || token !== this.generation || controller.signal.aborted) return;
      const route = result.routes[this.trip.selected] || result.routes.safest;
      // Do not replace the route across an unmodelled road connection.
      if (result.snap_distance_m[0] > 75) throw new Error("Your location is away from the mapped roads. Rejoin a road when safe.");
      this.session = new NavigationSession(route, result.mode, this.trip.destination);
      this.trip.result = result;
      this.onRoute(result, fix, this.trip.selected);
      this.receive({ coords: { latitude: fix.lat, longitude: fix.lon, accuracy: fix.accuracy, speed: fix.speed }, timestamp: fix.timestamp });
    } catch (error) {
      if (!this.active || token !== this.generation || controller.signal.aborted) return;
      this.show({ status: "offroute", message: error.name === "TimeoutError" ? "Route update timed out. Rejoin the route when safe." : error.message || "Couldn’t update the route. Rejoin the route when safe." });
    } finally { if (this.controller === controller) this.controller = null; }
  }

  show(result) {
    this.last = result;
    const locationProblem = result.status === "uncertain" && !this.preview;
    $("#nav-location-actions").hidden = !locationProblem;
    const tripURL = this.pageURL();
    $("#nav-location-url").value = tripURL;
    const canOpenEdge = /Windows/i.test(this.userAgent) && /^https?:\/\//i.test(tripURL);
    $("#nav-open-browser").hidden = !canOpenEdge;
    $("#nav-open-browser").href = canOpenEdge ? `microsoft-edge:${tripURL}` : "";
    $("#nav-location-help").textContent = !locationProblem ? "" : result.locationState === "approximate"
      ? "Desktops often provide an approximate Wi-Fi location. The arrow shows this approximate reading; the circle shows its uncertainty."
      : ["permission", "permission-stalled", "handoff"].includes(result.locationState) ? "No location prompt? Open this trip in your browser using the button below, or copy its address into Chrome, Edge or Safari. Allow location there, then choose Follow my location."
      : "You can retry location or preview this route without sharing your device location.";
    if (result.location) this.renderPosition(result.location, true);
    else if (result.locationState && result.locationState !== "approximate") {
      this.position = null; this.map.navigationPosition(null);
    }
    $("#navigation").dataset.status = result.status;
    $("#nav-instruction").textContent = result.status === "navigating" ? "Your location is updating on the route" : result.message;
    $("#nav-remaining").textContent = Number.isFinite(result.remaining) ? `${fmtDist(result.remaining)} remaining` : "Distance updates with your location";
    $("#nav-time").textContent = Number.isFinite(result.remainingSeconds) ? `About ${result.remainingSeconds < 60 ? "1 min" : fmtDuration(result.remainingSeconds)}` : "Your selected route";
    if (result.status === "arrived" || result.status === "route-end") {
      $("#nav-time").textContent = result.status === "arrived" ? "Arrived" : "Mapped route complete";
      $("#nav-remaining").textContent = result.status === "arrived" ? "At your destination" : "Check the remaining access to your destination";
    }
  }

  renderPosition(position, approximate = false) {
    const c = position.coords;
    const heading = positionHeading(this.headingFix, position, this.heading);
    const previous = this.headingFix?.coords;
    if (!previous || previous.accuracy > 35 || metres([previous.longitude,previous.latitude], [c.longitude,c.latitude]) >= Math.max(5, previous.accuracy, c.accuracy)) this.headingFix = position;
    this.heading = heading;
    this.position = {point:[c.longitude,c.latitude], accuracy:c.accuracy};
    this.map.navigationPosition(this.position.point, c.accuracy, approximate, heading);
    if (this.follow) this.map.followPosition(this.position.point, c.accuracy);
  }

  updateFollowButton() { $("#nav-follow").textContent = this.follow ? "Following location" : "Recenter"; }
  async requestWake() {
    if (!this.wakeLock || this.wake || document.hidden) return;
    const token = this.generation;
    try {
      const lock = await this.wakeLock.request("screen");
      if (!this.active || token !== this.generation || this.session.finished) { await lock.release(); return; }
      this.wake = lock;
      lock.addEventListener("release", () => { if (this.wake === lock) this.wake = null; });
    } catch { /* Navigation works without a screen wake lock. */ }
  }
  releaseWake() { const lock = this.wake; this.wake = null; lock?.release().catch(() => {}); }
  releaseTracking() {
    this.location?.stop();
    if (this.watch !== null) this.geolocation?.clearWatch(this.watch);
    this.watch = null; clearInterval(this.timer); this.timer = null;
  }
  stop(focus = true) {
    const wasActive = this.active;
    this.active = false; this.generation++;
    this.releaseTracking(); this.releaseWake(); this.controller?.abort(); this.controller = null;
    this.map.navigationPosition(null);
    this.map.setNavigationMode?.(false);
    document.body.classList.remove("navigating"); $("#navigation").hidden = true;
    if (focus && wasActive) { $("#btn-navigate")?.focus(); this.toast("Navigation ended. Location tracking stopped."); }
  }
}
