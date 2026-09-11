# Go Roadmap Dashboard

Public read-only dashboard for the Go backend middle learning roadmap.

The private repository `Ishee11/go-learning-roadmap` remains the source of truth. This public repository contains only:

- the static dashboard UI;
- `data/skills.yaml` and `data/skill-progress.yaml` — public P0 catalog/progress;
- `data/skills-p1.yaml` and `data/skill-progress-p1.yaml` — public P1 catalog/progress.

The dashboard uses one shared skill-level scale, but calculates P0 and P1 readiness separately. P1 gaps therefore do not reduce the P0 readiness percentage.

It does **not** contain private session notes, knowledge files, interview materials, or the full learning repository.

## Publishing with GitHub Pages

Use **Settings → Pages → Deploy from a branch**, select `main` and `/ (root)`.

The site URL is:

`https://ishee11.github.io/go-roadmap-dashboard/`

No build step, backend, database, or GitHub Actions are required. The site reads the YAML catalogs directly in the browser and calculates readiness/gaps itself.

## Updating

After a learning session, update the private source of truth first. Then sync only the intentionally public skill catalogs/progress snapshots into `data/` here.
