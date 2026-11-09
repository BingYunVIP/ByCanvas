# Repository Guidelines

## Project Structure

`backend/app/` contains the FastAPI application, routers, protocol helpers, and configuration. `backend/serve.py` starts the service. `frontend/` contains the static HTML, CSS, JavaScript modules, model data, and assets; the backend serves it directly, so there is no frontend build step. `tools/` holds maintenance and startup scripts, while `ByCanvas.sh` is the main install and service-management entry point. Backend tests, if added, belong under `backend/tests/`.

## Build, Test, and Development

- `cd backend && uv sync --group dev` installs backend dependencies, including pytest.
- `cd backend && uv run python serve.py 7400 127.0.0.1` starts a local server on port 7400.
- `cd backend && uv run pytest` runs the backend test suite when tests are present.
- `node --check frontend/js/app.js` checks a JavaScript module's syntax; repeat for changed modules.
- `bash ByCanvas.sh help` lists deployment and service commands. Use `install` only when intentionally configuring a host.

## Coding Style

Follow nearby code conventions. Python uses 4-space indentation, descriptive `snake_case` names, and application modules under `backend/app/`. Frontend JavaScript uses ES modules and 2-space indentation; use `camelCase` for variables and functions. Keep frontend changes compatible with direct static serving, and keep model capability data synchronized with its source via `tools/sync_model_capabilities.py` when applicable.

## Testing Guidelines

There is no committed test directory at present. Add backend tests as `test_*.py` under `backend/tests/` and run them with `cd backend && uv run pytest`. For frontend changes, run `node --check` on touched JavaScript modules and manually verify affected behavior in the locally served application. For deployment-script changes, exercise the relevant command in a disposable test environment rather than changing a production host.

## Commits and Pull Requests

Recent commits use short, imperative summaries, often in Chinese, such as `ByCanvas.sh 增加 update / rollback`; keep titles concise and focused on one change. Pull requests should describe user-visible or operational impact, list validation performed, link related issues when available, and include screenshots for visual frontend changes. Call out configuration or deployment implications explicitly.

## Configuration and Security

Do not commit API keys, credentials, local environment files, or generated deployment state. Preserve the design that API keys and user conversations remain in browser storage; avoid adding server-side persistence without documenting the security and privacy impact.
