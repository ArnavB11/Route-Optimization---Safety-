# Route preview and starting-point location

Select a route and choose **Preview route**. A clearly labelled simulated arrow moves along the selected route. The preview shows estimated remaining distance and time. It does not follow the device or provide live navigation or voice guidance.

Drag the map to explore. **Recenter** follows the simulated position again. **End preview** removes the arrow, stops the timer and returns to route comparison. Completion stops the animation and shows **Done**. Changing the trip or leaving the page also stops the preview.

Preview does not call geolocation, request location permission, reroute from device readings or request a screen wake lock. The simulation does not validate physical GPS, actual journey progress, road legality or the crash-risk model.

## Choose a starting point

The separate **Use my location** control can still set the trip's starting point. This is a bounded location lookup, not live tracking. Browser/device permission and HTTPS or localhost are required. A precise fix selects the origin; a fresh approximate reading requires explicit confirmation. Requests stop after 35 seconds if the browser never responds.

Cancel, manual origin edits, route/city changes and page exit invalidate pending callbacks. Out-of-coverage locations are reported separately. No guessed position is substituted. Search or select a point on the map when device location is unavailable.

## Verification

Frontend tests cover preview movement, recenter, timer cleanup, completion, restart and invalid routes, alongside the separate starting-point acquisition tests. Browser checks verify the preview without granting location permission.
