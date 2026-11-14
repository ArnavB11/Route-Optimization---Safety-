import { LocationTracker } from "./location.js";

// A bounded request for a trip origin. Coarse readings need explicit selection.
export class PlannerLocation {
  constructor({ geolocation, permissions, onState, onLocation, clock = () => Date.now(), secure = true }) {
    Object.assign(this, {geolocation, permissions, onState, onLocation, clock, secure});
    this.active = false;
  }
  start() {
    this.cancel();
    if (!this.secure) { this.onState({kind:"unsupported",message:"Location needs HTTPS or localhost. Open the secure site or choose a starting point on the map."}); return; }
    this.active = true;
    this.tracker = new LocationTracker({geolocation:this.geolocation, permissions:this.permissions, clock:this.clock,
      onPosition:position => { if (this.active) this.choose(position); },
      onStatus:status => {
        if (!this.active) return;
        this.candidate = status.kind === "approximate" ? status.position : null;
        if (["denied","unsupported"].includes(status.kind)) this.release();
        this.onState(status);
      },
    });
    // Geolocation timeouts need not include time spent on permission prompts.
    this.deadline = setTimeout(() => {
      if (!this.active) return;
      const permission = this.tracker.permission;
      this.release(); this.candidate = null;
      this.onState({kind:permission === "prompt" ? "permission-stalled" : "timeout",message:permission === "prompt"
        ? "This browser has not completed location permission. Open this page in Edge or Chrome, allow location, and try again."
        : "No fresh location was returned. Check your device’s location service, retry, or choose your start on the map."});
    }, 35000);
    this.tracker.start();
  }
  choose(position = this.candidate) {
    if (!this.active || !position) return;
    if (!this.tracker.valid(position)) {
      this.candidate = null;
      this.onState({kind:"stale",message:"That reading has expired. Retry to get your current location."}); return;
    }
    this.release(); this.candidate = null;
    this.onState({kind:"selected",message:"Location found."});
    this.onLocation(position);
  }
  release() {
    this.active = false; clearTimeout(this.deadline); this.deadline = null;
    this.tracker?.stop();
  }
  cancel() {
    this.release(); this.candidate = null;
    this.onState({kind:"idle",message:""});
  }
}
