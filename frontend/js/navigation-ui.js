import { NavigationSession, pointAt, positionHeading, metres } from "./navigation.js";
import { $, fmtDist, fmtDuration } from "./util.js";

// Route previews use simulated positions only and never request device location.
export class RoutePreview {
  constructor({ map, toast, clock = () => Date.now() }) {
    Object.assign(this, { map, toast, clock });
    this.generation = 0; this.timer = null; this.active = false;
    $("#nav-stop").onclick = () => this.stop();
    $("#nav-follow").onclick = () => {
      this.follow = true; this.updateFollowButton();
      if (this.position) this.map.followPosition(this.position);
    };
    this.map.map.on("dragstart", () => {
      if (this.active) { this.follow = false; this.updateFollowButton(); }
    });
    window.addEventListener("resize", () => {
      if (this.active && this.follow && this.position) this.map.followPosition(this.position);
    });
    window.addEventListener("pagehide", () => this.stop(false));
  }

  start(trip) {
    let session;
    try { session = new NavigationSession(trip.result.routes[trip.selected], trip.result.mode, trip.destination); }
    catch (error) { this.toast(error.message); return; }
    this.stop(false);
    this.session = session; this.active = true; this.follow = true;
    this.position = null; this.headingFix = null; this.heading = 0;
    this.updateFollowButton();
    this.map.setNavigationMode?.(true);
    document.body.classList.add("navigating");
    $("#navigation").hidden = false;
    $("#nav-stop").textContent = "End preview";
    $("#nav-stop").focus();
    const token = this.generation;
    let progress = 0;
    const advance = () => {
      if (!this.active || token !== this.generation) return;
      const [longitude, latitude] = pointAt(session.route, progress);
      const position = {coords:{longitude, latitude, accuracy:5, speed:trip.result.mode === "walk" ? 1.4 : 10}, timestamp:this.clock()};
      const result = session.update({lon:longitude, lat:latitude, accuracy:5, timestamp:position.timestamp}, this.clock());
      this.heading = positionHeading(this.headingFix, position, this.heading);
      const previous = this.headingFix?.coords;
      if (!previous || metres([previous.longitude,previous.latitude], [longitude,latitude]) >= 5) this.headingFix = position;
      this.position = [longitude, latitude];
      this.map.navigationPosition(this.position, 0, false, this.heading);
      if (this.follow) this.map.followPosition(this.position);
      $("#navigation").dataset.status = result.status;
      $("#nav-instruction").textContent = session.finished ? "Route preview complete" : "Simulated journey along your selected route";
      $("#nav-remaining").textContent = `${fmtDist(result.remaining ?? session.route.length)} remaining`;
      $("#nav-time").textContent = session.finished ? "Preview complete" : `About ${fmtDuration(Math.max(60, result.remainingSeconds ?? session.route.time))}`;
      if (session.finished) { clearInterval(this.timer); this.timer = null; $("#nav-stop").textContent = "Done"; }
      progress += trip.result.mode === "walk" ? 5 : 18;
    };
    advance();
    if (!session.finished) this.timer = setInterval(advance, 1000);
  }

  updateFollowButton() { $("#nav-follow").textContent = this.follow ? "Following preview" : "Recenter"; }

  stop(focus = true) {
    const wasActive = this.active;
    this.active = false; this.generation++;
    clearInterval(this.timer); this.timer = null;
    this.map.navigationPosition(null);
    this.map.setNavigationMode?.(false);
    document.body.classList.remove("navigating");
    $("#navigation").hidden = true;
    if (focus && wasActive) $("#btn-preview-route")?.focus();
  }
}
