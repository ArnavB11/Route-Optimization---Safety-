// Device location acquisition is separate from route matching. Never invent a fix.
export class LocationTracker {
  constructor({ geolocation, permissions, onPosition, onStatus, clock = () => Date.now() }) {
    Object.assign(this, { geolocation, permissions, onPosition, onStatus, clock });
    this.active = false; this.watch = null; this.timer = null; this.generation = 0;
  }

  start() {
    this.stop();
    this.active = true; this.started = this.clock(); this.permission = "unknown";
    this.best = null; this.latest = null; this.lastDelivered = -Infinity;
    this.attempts = 0; this.lastAttempt = -Infinity; this.lastStatus = "";
    this.lastRefresh = -Infinity; this.refreshPending = false; this.refreshVersion = 0;
    this.status("acquiring", "Finding your device location…");
    const token = this.generation;
    this.timer = setInterval(() => this.tick(), 3000);
    // Permission queries never request permission. Location calls below do.
    if (this.permissions?.query) {
      Promise.resolve().then(() => this.permissions.query({ name: "geolocation" })).then((permission) => {
        if (!this.active || token !== this.generation) return;
        this.permissionObject = permission;
        this.permissionChanged = () => {
          if (!this.active || token !== this.generation) return;
          this.permission = permission.state;
          if (permission.state === "denied") this.denied();
          else if (permission.state === "granted") {
            if (!this.precise()) this.status("acquiring", "Location allowed. Finding your position…");
            if (this.watch === null) this.acquire();
          }
          else if (permission.state === "prompt" && !this.latest) this.permissionStatus();
        };
        permission.addEventListener?.("change", this.permissionChanged);
        this.permissionChanged();
      }).catch(() => {});
    }
    this.acquire();
  }

  acquire() {
    if (!this.active || this.permission === "denied") return;
    if (!this.geolocation?.watchPosition) {
      this.status("unsupported", "This browser cannot provide device location. Open the trip on a location-enabled browser or use route preview.");
      clearInterval(this.timer); this.timer = null; return;
    }
    if (this.timer === null) this.timer = setInterval(() => this.tick(), 3000);
    if (this.watch !== null) this.geolocation.clearWatch(this.watch);
    this.watch = null; this.attempts++; this.lastAttempt = this.clock();
    this.refreshVersion++; this.refreshPending = false;
    const token = this.generation, attempt = this.attempts;
    const current = () => this.active && token === this.generation && attempt === this.attempts && this.permission !== "denied";
    const success = (position) => { if (current()) this.position(position); };
    const failure = (error) => { if (current()) this.error(error); };
    try {
      const id = this.geolocation.watchPosition(success, failure, { enableHighAccuracy: true, maximumAge: 5000, timeout: 25000 });
      // Some providers/test doubles call back synchronously, including denial.
      if (!current()) this.geolocation.clearWatch(id);
      else this.watch = id;
    } catch { failure({ code: 2 }); }
    // Wi-Fi/network acquisition can bootstrap devices without a GPS sensor.
    // Keep the high-accuracy watch alive; an approximate fix never enables turns.
    if (current() && this.geolocation.getCurrentPosition) {
      try { this.geolocation.getCurrentPosition(success, failure, { enableHighAccuracy: false, maximumAge: 15000, timeout: 10000 }); }
      catch { /* The high-accuracy watch remains available. */ }
    }
  }

  valid(position) {
    const c = position?.coords, t = position?.timestamp;
    return c && [c.latitude, c.longitude, c.accuracy, t].every(Number.isFinite)
      && Math.abs(c.latitude) <= 90 && Math.abs(c.longitude) <= 180 && c.accuracy >= 0
      && this.clock() - t <= 15000 && t <= this.clock() + 5000;
  }

  position(position) {
    if (!this.valid(position)) {
      if (!this.precise()) {
        if (this.latest && this.valid(this.latest)) this.approximate(this.latest);
        else this.status("stale", "The browser returned an old or invalid location. Getting a fresh position…");
      }
      return;
    }
    if (!this.latest || position.timestamp >= this.latest.timestamp) this.latest = position;
    if (position.coords.accuracy > 35) {
      if (!this.precise()) this.approximate(position);
      return;
    }
    // A delayed fallback response must not replace a newer accurate watch fix.
    if (position.timestamp <= this.lastDelivered) return;
    this.best = position; this.lastDelivered = position.timestamp; this.lastStatus = "";
    this.onPosition(position);
  }

  precise() { return this.best && this.clock() - this.best.timestamp <= 15000; }
  approximate(position) {
    const accuracy = Math.round(position.coords.accuracy);
    this.status("approximate", `Your location is approximate (about ${accuracy >= 1000 ? `${(accuracy / 1000).toFixed(1)} km` : `${accuracy} m`}). The circle shows the location uncertainty.`, position);
  }
  status(kind, message, position) {
    const key = `${kind}:${message}:${position?.timestamp ?? ""}`;
    if (key === this.lastStatus) return;
    this.lastStatus = key; this.onStatus({ kind, message, position });
  }
  denied() {
    this.permission = "denied";
    if (this.watch !== null) this.geolocation?.clearWatch(this.watch);
    this.watch = null; clearInterval(this.timer); this.timer = null;
    this.status("denied", "Location permission is blocked. Allow location for this site in your browser and device settings, then choose Retry location.");
  }
  permissionStatus() {
    if (this.clock() - this.started >= 25000) {
      this.status("permission-stalled", "Location permission has not completed. Open this trip in your browser to continue.");
    } else this.status("permission", "Allow location access to show your position on the map.");
  }
  error(error) {
    if (error?.code === 1) { this.denied(); return; }
    // A bootstrap timeout must not hide a working high-accuracy watch.
    if (this.precise()) return;
    if (this.latest && this.valid(this.latest)) { this.approximate(this.latest); return; }
    if (this.permission === "prompt") {
      this.permissionStatus(); return;
    }
    this.status(error?.code === 3 ? "timeout" : "unavailable", error?.code === 3
      ? "Your browser has not returned a fresh location yet. Retry location, or try a phone with precise location enabled."
      : "Your device’s location service is unavailable. Check browser and device location settings, then retry.");
  }
  refresh() {
    if (!this.geolocation?.getCurrentPosition || this.refreshPending || this.clock() - this.lastRefresh < 10000) return;
    this.refreshPending = true; this.lastRefresh = this.clock();
    const token = this.generation, version = ++this.refreshVersion;
    const current = () => this.active && token === this.generation && version === this.refreshVersion && this.permission !== "denied";
    const success = (position) => { if (current()) { this.refreshPending = false; this.position(position); } };
    const failure = (error) => { if (current()) { this.refreshPending = false; this.error(error); } };
    try {
      // Watches may be quiet while stationary. Ask for a genuinely fresh fix,
      // rather than ageing/reusing the old timestamp or inferring no movement.
      this.geolocation.getCurrentPosition(success, failure, {enableHighAccuracy:true,maximumAge:0,timeout:12000});
    } catch { failure({code:2}); }
  }
  tick() {
    if (!this.active || this.permission === "denied") return;
    // Permission prompts have no guaranteed browser timeout, especially in
    // embedded webviews. Offer a concrete handoff instead of waiting forever.
    if (this.permission === "prompt" && !this.latest) { this.permissionStatus(); return; }
    if (this.best && this.permission !== "prompt" && this.clock() - this.best.timestamp >= 10000) this.refresh();
    if (this.precise()) return;
    if (this.latest && this.valid(this.latest)) this.approximate(this.latest);
    else if (this.clock() - this.started > 25000 && !["denied", "unavailable", "timeout", "permission", "unsupported"].some((s) => this.lastStatus.startsWith(s + ":"))) {
      this.status(this.best ? "stale" : "timeout", this.best
        ? "Location updates have paused. Reconnecting to your device’s location service…"
        : "No location has been received yet. Check the location prompt and device settings, or try route preview.");
    }
    if (this.permission !== "prompt" && this.attempts < 3 && this.clock() - this.lastAttempt >= this.attempts * 30000) this.acquire();
  }
  stop() {
    this.active = false; this.generation++;
    if (this.watch !== null) this.geolocation?.clearWatch(this.watch);
    this.watch = null; clearInterval(this.timer); this.timer = null;
    this.permissionObject?.removeEventListener?.("change", this.permissionChanged);
    this.permissionObject = null;
  }
}
