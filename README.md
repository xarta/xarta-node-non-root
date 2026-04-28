# xarta-node-non-root

Public GUI content for the [xarta-node](https://github.com/xarta/xarta-node)
Blueprints fleet stack, served from a non-root filesystem path.

## Purpose

This repo holds the public-facing GUI components that the Blueprints
application serves to users:

- `gui-fallback/` — the primary Blueprints dashboard (HTML/CSS/JS)
- `gui-db/` — shared database schema pages (interactive table and ER diagram views)
- `gui-embed/` — the node-selector embed widget used across the fleet

It complements the main [xarta-node](https://github.com/xarta/xarta-node) repo,
which contains the FastAPI application, bootstrap scripts, and fleet
infrastructure tooling.

## Relationship to xarta-node

The `xarta-node` repo contains `gui-fallback/`, `gui-embed/`, and related GUI
sources at the root level. This repo exists so those assets can be served from
a non-root path (e.g. `/xarta-node` on each fleet LXC) without coupling the
GUI deployment to the root-owned repo layout.

Fleet bootstrap scripts in `xarta-node` (`setup-blueprints.sh`,
`setup-caddy.sh`, `setup-syncthing.sh`) support `BLUEPRINTS_FALLBACK_GUI_DIR`,
`BLUEPRINTS_EMBED_DIR`, and `BLUEPRINTS_ASSETS_DIR` environment variables to
point the application at this repo's content instead.

## Leak scanner policy

Before committing or pushing public repo changes, run:

```bash
bash check-for-leaks.sh
```

If the scanner reports a value from private configuration, do not work around it
by splitting the string, concatenating fragments, encoding it, or reconstructing
the same private literal in public source. That is a scanner bypass, not a fix.
Move the value into ignored/private configuration, remove it from public code, or
change the scanner allowlist only after an intentional review.

## License

MIT — see [LICENSE](LICENSE).

Live serving has not been switched to this repo yet.
