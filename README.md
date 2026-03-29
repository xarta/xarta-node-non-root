# xarta-node-non-root-repo

Working git and documentation name for this repo: `xarta-node-non-root-repo`.

Actual local filesystem path on this node: `/xarta-node`.

## Purpose

This is the staged additional public repo for non-root path migration work.

It exists so selected public GUI-facing content can move to `/xarta-node`
without breaking the active fleet-wide public repo workflow that still uses
`/root/xarta-node`.

## Current intended scope

- `gui-fallback/`
- `gui/`
- `gui/db/`

## Current non-scope

- `.lone-wolf/` — node-local repo, nested here but not part of this repo
- `.xarta/` — private repo, not copied here
- the rest of the active public repo under `/root/xarta-node`

## Guardrails

- local-node only for this stage
- no remote origin assumed yet
- preserve public/private separation
- keep `gui-fallback/assets/` gitignored for now
- do not treat this repo as fleet-ready until the path audit has been worked
  through and the distribution model is documented

## Current status

This repo is a local staging point for the migration, not yet the live source of
truth for the Blueprints GUI.

Current staged content on this node:

- `gui-fallback/` contains a public copy of the root-repo `gui-fallback/`
  content, excluding `assets/`, `embed/`, and the old `db` symlink
- `gui/db/` contains a public copy of the shared database pages currently kept
  in `/root/xarta-node/gui-db`
- `gui-fallback/db` is staged here as a symlink to `../gui/db`

Intentional omissions for this stage:

- `gui-fallback/assets/` is still ignored here and remains rooted in the active
  `/root/xarta-node` workflow for now
- `gui/index.html` is intentionally not copied from `.xarta/gui/index.html`
  because the private `/ui` placeholder is not public content
- `gui-embed/` is not yet part of this repo; the setup scripts now support an
  override path for it when that move is ready

Live serving has not been switched to this repo yet.