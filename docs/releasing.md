# Releasing bird 0.1.x

Target destinations:
- npm: `@steipete/bird`
- Homebrew: tap formula in `steipete/homebrew-tap` (e.g., `bird.rb`)

## Checklist (npm + GitHub)
1) Version bump
   - Update `package.json` `version` (semver, e.g., `0.1.0`).
   - Update `CHANGELOG.md` and tag the release section.

2) Clean build & tests
   - `pnpm install`
   - `pnpm test`
   - `pnpm run build`

3) Publish to npm (scoped)
   - Ensure you are logged in (`npm whoami`).
   - `npm publish --access public` (from repo root). Package name is `@steipete/bird`.

4) Git tag & GitHub release
   - `git tag v0.1.0 && git push origin v0.1.0`
   - Create GitHub release from the tag. Include changelog notes and attach optional binary (see below).

## Optional: attach compiled binary
If you want a single-file binary for Homebrew/GitHub assets:
- Build: `pnpm run binary` (uses Bun to produce `./bird`).
- Upload `bird` to the GitHub release and use it for the Homebrew tarball.

## Homebrew tap update (steipete/homebrew-tap)
1) Package the binary
   - From repo root: `tar -czf bird-macos-universal-v0.1.0.tar.gz bird`
   - Compute SHA: `shasum -a 256 bird-macos-universal-v0.1.0.tar.gz`

2) Update formula in tap repo
   - File: `homebrew-tap/bird.rb` (create if absent). Model it after `poltergeist.rb`.
   - Fields to update:
     - `url "https://github.com/steipete/bird/releases/download/v0.1.0/bird-macos-universal-v0.1.0.tar.gz"`
     - `sha256 "<calculated_sha>"`
     - `version "0.1.0"`
   - Install block: `bin.install "bird"`
   - `test do`: minimal `assert_match "0.1.0", shell_output("#{bin}/bird --version")`

3) Push tap changes
   - `git add bird.rb && git commit -m "bird 0.1.0" && git push`

## Release order suggestion
1) Merge to `main` and tag.
2) Publish npm.
3) Build binary, upload to GitHub release.
4) Update Homebrew tap with new URL/SHA.

## Notes
- Scoped npm name (`@steipete/bird`) requires `--access public` on first publish.
- Homebrew formula assumes macOS universal binary; adjust URL/name if you ship per-arch.
- Config defaults (JSON5) and Safari/Chrome/Firefox cookie selection are documented in `README.md` — keep that in sync for each release.
