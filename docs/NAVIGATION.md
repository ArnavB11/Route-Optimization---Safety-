# Live route location

Select a route and choose **Follow my location**. The selected route remains on the map, with a location arrow that moves as the browser reports your position. A compact card shows location status and estimated remaining distance/time. There is no voice guidance, speech synthesis, microphone access or audio control.

Drag the map to explore; **Recenter** resumes following the current measured position. **Stop tracking** clears the location watch, timers, pending reroutes, accuracy circle, arrow and optional screen wake lock. Selecting a new trip or leaving the page also releases these resources. **Preview route** uses explicitly labelled simulated movement without requesting location; it does not verify the device GPS.

## Location and arrow behaviour

A high-accuracy watch and a network-position request acquire device location. The arrow uses measured coordinates, without snapping it to the road or inventing movement. Its bearing uses a valid device heading while moving, or displacement greater than reported location uncertainty (at least 5 m). Heading remains stable at rest. If no heading is known it initially points north; it is not a compass reading. Fresh approximate positions also move the arrow, coloured grey with an accuracy circle. Precise positions use a blue arrow and show reported accuracy.

Route-progress, arrival and rerouting calculations still require accuracy within 35 m and a fix no older than 15 seconds. Approximate fixes show position without advancing those calculations. Arrival requires accuracy within 12 m for walking or 22 m for vehicles. The mapped endpoint and actual destination can differ; the app does not claim arrival across an unmapped connection.

The app refreshes quiet stationary watches, makes up to three automatic watch acquisition attempts per start, and ignores callbacks from stopped sessions. Returning to the foreground restarts acquisition. Reported coordinates and timestamps are never fabricated.

## Permission and browser requirements

The planner's **Use my location** button shares the same acquisition service. It preserves the entered starting point while requesting location and shows persistent status rather than a generic error toast. Precise fixes select the origin automatically; fresh approximate readings require explicit confirmation. Cancel, manual origin editing, a city/route reset and page exit invalidate pending callbacks. A separate 35-second deadline stops requests even if browser permission remains unanswered. Out-of-coverage readings are reported separately from acquisition failures. No IP-based or city-centre guess is substituted for the device position.

Live location requires HTTPS or localhost and browser/device location permission. Keep the page open and unlocked. Background tracking, offline navigation and real-device on-road behaviour are not guaranteed.

Permission, unavailable service, timeouts and approximate readings have distinct status messages. Expand **Location help** for **Retry location**, browser handoff and preview controls. An unanswered permission request switches to a handoff message after 25 seconds. On Windows, **Open in Microsoft Edge** uses the [Windows browser URI scheme](https://learn.microsoft.com/en-us/windows/apps/develop/launch/launch-default-app). Hosts can block external app launch; **Copy trip link** and the selectable address remain available. Open that address in a regular browser, allow location, and choose **Follow my location**. The original watch stops when handing off.

An embedded browser that never completes location permission cannot supply movement to this page. Desktop Wi-Fi positions can be hundreds of metres away; use a phone with precise location enabled for a more accurate arrow. A phone's `127.0.0.1` refers to the phone, not the desktop; serve over HTTPS for another device.

## Route progress and rerouting

Geometry projection uses a bounded progress window to reduce jumps at crossings. Remaining time is a model estimate from the route, not live traffic or measured travel speed. Off-route confirmation needs at least three precise fixes over eight seconds, more than 35 m from the route when walking or 55 m for vehicles. Reroutes preserve mode, safety preference and detour limit. Requests have a 20-second timeout and a 30-second retry cooldown. Failed or unsupported reroutes leave the existing route visible. Starts snapped more than 75 m from the measured location cannot replace the route across an unmodelled connection.

Locations remain in browser memory; rerouting sends the current position to this project's backend. No GPS history database is created. Trip links include origin/destination coordinates and settings.

## Verification

Frontend tests cover route projection, progress, arrival, rerouting, acquisition/permission recovery, heading stability, moving approximate positions, marker rotation/reuse, recenter and cleanup. Browser preview checks can verify rendering without granting location. Real-device movement remains unverified. These features do not validate road legality, comprehensive turn restrictions, current closures or the crash-risk model.
