# Go Roadmap Dashboard

Public read-only dashboard for the Go backend middle learning roadmap.

The private repository `Ishee11/go-learning-roadmap` remains the source of truth. This public repository contains only:

- the static dashboard UI;
- `data/catalogs.yaml` — manifest of priority layers shown by the dashboard;
- `data/skills.yaml` and `data/skill-progress.yaml` — public P0 catalog/progress;
- `data/skills-p1.yaml` and `data/skill-progress-p1.yaml` — public P1 catalog/progress;
- `data/experience.yaml` — public snapshot of experience-based practical targets and their current status.

The dashboard uses one shared skill-level scale, but calculates readiness separately for each priority. P1 gaps therefore do not reduce the P0 readiness percentage.

Experience readiness is shown as a separate section. It tracks whether skills implied by interview experience stories are not tested, being learned, demonstrated, or retained. These statuses do not automatically inherit progress from the general roadmap.

Adding a future P2/P3 layer should be data-driven: create the corresponding catalog/progress YAML files and register them in `data/catalogs.yaml`; the dashboard does not need a new hard-coded priority list.

It does **not** contain private session notes, knowledge files, interview materials, or the full learning repository.

## Publishing with GitHub Pages

Use **Settings → Pages → Deploy from a branch**, select `main` and `/ (root)`.

The site URL is:

`https://ishee11.github.io/go-roadmap-dashboard/`

No build step, backend, database, or GitHub Actions are required. The site reads the manifest and YAML catalogs directly in the browser and calculates readiness/gaps itself.

## Updating

After a learning session, update the private source of truth first. Then sync only the intentionally public manifest/catalog/progress snapshots into `data/` here. Experience targets are synced separately into `data/experience.yaml`.
