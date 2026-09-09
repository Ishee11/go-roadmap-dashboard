# Go Roadmap Dashboard

Public read-only dashboard for the Go backend middle learning roadmap.

The private repository `Ishee11/go-learning-roadmap` remains the source of truth. This public repository contains only:

- the static dashboard UI;
- `data/skills.yaml` — the public P0 skill catalog with MIN/TARGET;
- `data/skill-progress.yaml` — the public snapshot of CURRENT levels, notes, and evidence references intentionally shown by the dashboard.

It does **not** contain private session notes, knowledge files, interview materials, or the full learning repository.

## Publishing with GitHub Pages

Use **Settings → Pages → Deploy from a branch**, select `main` and `/ (root)`.

The site URL is:

`https://ishee11.github.io/go-roadmap-dashboard/`

No build step, backend, database, or GitHub Actions are required. The site reads the two YAML files directly in the browser and calculates readiness/gaps itself.

## Updating

After a learning session, update the private source of truth first. Then sync the intentionally public skill catalog/progress snapshot into `data/` here.
