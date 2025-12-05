# Changelog

## Unreleased

## 0.1.0 — 2025-12-05

### Added
- Core command set: `tweet`, `reply`, `read`, `replies`, `thread`, `search`, `mentions`, and `whoami`.
- Dual transports: GraphQL (cookie-based) and Sweetistics (API key); `auto` engine switches to Sweetistics when a key is present.
- Sweetistics features: media uploads (images or single video), 15s request timeouts, and conversation fetch with `force=true` so threads/replies are always fresh.
- Browser credential sourcing: Firefox (`--firefox-profile`) and Chrome (`--chrome-profile`) alongside env/CLI; JSON5 configs (`~/.config/bird/config.json5`, `./.birdrc.json5`) with `allowChrome`/`allowFirefox` toggles and engine defaults.
- `whoami` works with both transports and prefers Sweetistics when available; colorized help banner plus example block.
- CI coverage: push/PR workflow (Node 22, pnpm 10, Go stable) running `pnpm test`; test suite expanded (≥70% coverage).
