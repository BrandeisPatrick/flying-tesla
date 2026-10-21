# X post draft (Roadster)

Main post (about 260 characters; X counts the link as 23):

> I built a flying-car game that runs in your browser 🚗✈️
> Real downtown San Francisco (OpenStreetMap streets, USGS terrain), 250 AI cars that obey the lights, cold-gas thrusters: hold Space and lift off between the towers.
> Play it: https://brandeispatrick.github.io/roadster/

Attach `press/aerial.jpg` (or a 10–20 s screen recording: pull away from the Beale & Mission light, hold Space,
climb through the towers toward the Bay Bridge, then land on a roof).

Thread, one reply each:

1. Everything you see is procedural: buildings on their real footprints with storefronts and fire escapes, signs
   with the real street names, species-based trees, the Bay Bridge towers and cables. Materials are CC0 scans from
   Poly Haven. (attach `press/street.jpg`)
2. The physics is plain JavaScript: a sprung body with per-wheel suspension (it dives, squats and leans), tyre slip,
   and thruster flight with hover assist. 120 Hz fixed step, deterministic, tested headless along 21 km of real
   streets before it ever ran in a browser.
3. It runs on a browser game engine I'm building alongside it (Three.js / WebGL2, no install, no download): fixed-step
   core, physics, atmosphere and post-processing, OpenStreetMap city worlds, traffic AI in a Worker.
   [link to github.com/BrandeisPatrick/inbrowser-game-engine once it is public]
4. Controls: arrows or WASD to drive, Space to lift, Shift to boost, C to change camera. Works on a laptop GPU;
   no accounts, no telemetry.

Optional closer: "Built with Claude Code over four days." — your call.
Hashtags, if any: #threejs #webgl #gamedev
