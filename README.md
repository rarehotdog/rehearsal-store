# A Thousand Stores — Store Design Rehearsal & Spatial Stress-Testing Studio

Requires Node 22.18+ (verified on Node 24). Run: `npm ci`, `npm run dev`, open `http://localhost:3000`.

## Preview and production sync

- Use `npm ci` for reproducible installation, `npm run lint` for type checks,
  and `npm test` for server, spatial, and result-summary tests.
- The AI Studio entrypoint is `src/main.ts`, `index.html`, and `styles.css`.
  `npm run sync:cloud-ui` regenerates the `web/client/` mirror.
- `npm run build` creates the Vite app; `npm run build:cloud-ui` creates
  the compatible `/app.js` and `/styles.css` layout used by GDH.
- The server proxies financial engine calls to `ENGINE_BASE_URL`, defaulting
  to https://thousand-stores-personal.vercel.app, which runs the GDH engine
  independently of the expiring hackathon Cloud Run project. An unavailable backend
  returns an explicit error rather than simulated success.
- Pull external GitHub changes into the AI Studio workspace using
  Settings > GitHub, connected to `rarehotdog/rehearsal-store`. Do not keep
  the expiring original account connected. Saving code to GitHub and deploying Cloud Run are
  separate operations.
- The spatial wafer and swarm are illustrative; the separate 36-month engine
  status reports actual scenario outcomes and marks cached replay results.
- Selecting a wafer cell compares its assumed inflow against the captured
  layout without inventing fixture coordinates or regenerating the wafer.
  This is not a verified replay of that cell's 3D trajectory. PNGs and reports
  keep that distinction and show `Blocked`/`N/A` for unavailable spatial metrics.
- Browser regression check: start the dev server, run `npx playwright install chromium`
  once, then `npm run test:ui -- http://localhost:3000`. The same command accepts
  a deployed URL and performs a fresh deterministic financial-engine run.
  It verifies actual swarm rendering/motion, all wafer modes and filters, sweep
  completion, exact mouse/touch cell selection, run #10000 and 10,000-row CSVs
  at desktop 1440px, intermediate 1200px/900px, and mobile 390px/320px (mobile DPR 2).
  Category/design/scenario and camera controls, header/toolbar bounds, Jump and
  Tour start/stop are covered with normal clicks (no forced clicks).
  Use `UI_VIEWPORT_WIDTH=320 npm run test:ui -- <URL>` for the narrow-screen check.
  Set `UI_HEADFUL=1` to show the browser while it performs the checks.

Full integration flow:
https://github.com/rarehotdog/GDH/blob/main/docs/PERSONAL_HOSTING.md

The preserved UI snapshot is upstream commit `83f4c346` (2026-10-16 20:25:16 KST).
After pulling, remove or update any old `ENGINE_BASE_URL` override in AI Studio's
environment settings; otherwise it still takes precedence over the new default.
Personal repositories: https://github.com/rarehotdog/rehearsal-store and
https://github.com/rarehotdog/GDH.

All original branches and commit history are retained. Original PR metadata,
reviews and patches are preserved in [migration archive](docs/migration-archive/README.md).
Historical source URLs there are provenance, not runtime dependencies.
This repository is now standalone (`fork: false`). See
[independent migration](docs/INDEPENDENT_MIGRATION.md) for the new repository ID
and the AI Studio reconnection step after replacement of the old fork.

## Architecture & Core Modules
- **3D Spatial Floorplan Internals (`src/engine/threeFloorplanStage.ts`)**: Interactive Three.js WebGL rotatable store floorplan with 16-slot LED queue buffer bars, 24-cell shared walkway sensor matrix, real-time customer agents, and CAD dimension rulers.
- **2.5D Isometric & 2D CAD Blueprint (`src/engine/canvasRenderer.ts`)**: Dual Baseline vs. Proposed floorplan comparison with 360° orbit, congestion heatmap, lighting, and HVAC airflow overlays.
- **10,000-Store Monte Carlo & Telemetry (`src/engine/d3StatsCharts.ts`)**: D3.js survival distribution chart across 6 operational scenarios and 6 real-time KPI sparklines.
- **Discrete-Event Simulation Core (`src/engine/rehearsalCore.ts`)**: Seeded A* pathfinding, queue buffer dynamics, and spatial clearance validation.
- **Server Endpoints (`server.ts`, Node 22.18+ `node:http`)**: `POST /run` → `{ runId }`, `GET /runs/:id` → `{ result: RunResult }`, `GET /runs/:id/export?format=csv`.
