# pi-gateway dashboard

This is the bootstrap `pi.sites` dashboard for `pi-gateway`.

Current Phase 1 capabilities:

- gateway config via `config.toml` → `.pi/pi-gateway.json`
- runtime site discovery from `package.json` `pi.sites`
- optional per-site `site.json` manifest loading
- `GET /api/health`
- `GET /api/sites`

Planned next:

- rendered markdown pages
- dedicated agent runtime binding
- status / logs / controls
- browser ↔ agent messaging
- SSE live updates
