# Release Checklist (poltergeist)

Mirror the mcporter flow: no warnings, stop on any failure. Verify npm (npx) every time; verify Homebrew only if this project ships a formula.

Communication (shared rule)
- Do not bump versions, publish, tag, or create GitHub releases without explicit product-owner approval. If anything unexpected happens mid-release, pause and confirm before proceeding.

Shared release rules to upstream
- Title format: GitHub release title must be `projectname <version>` (no “v” prefix).
- Version sources: bump both `package.json` and the shared CLI version file (`src/cli/version.ts`), which powers `poltergeist` and `polter`.
- No-warning gate: lint/test/build must finish clean (treat warnings as failures).
- Artifacts + checksums: build platform binaries, produce macOS universal tarball, and record sha256 alongside.
- Installer verification: run `npx <pkg>@<ver> --version` from a clean temp dir after publish.
- Conditional Homebrew section (below) only if the project ships a tap formula.

Steps

1) Bump versions  
   - `package.json` `version`  
   - `src/cli/version.ts` (`poltergeist` and `polter` banners)

2) Clean gates  
   - `pnpm run lint`  
   - `pnpm run build`
   - `pnpm run test`

3) Build Bun binaries  
   - `pnpm run build:bun:all`  
   - Build the Homebrew slices and create the universal macOS bundle:
     ```bash
     version=<ver>
     mkdir -p dist-homebrew
     bun build src/cli.ts --compile --target=bun-darwin-arm64 --outfile dist-homebrew/poltergeist-arm64 --minify
     bun build src/cli.ts --compile --target=bun-darwin-x64 --outfile dist-homebrew/poltergeist-x64 --minify
     bun build scripts/polter-bun.ts --compile --target=bun-darwin-arm64 --outfile dist-homebrew/polter-arm64 --minify
     bun build scripts/polter-bun.ts --compile --target=bun-darwin-x64 --outfile dist-homebrew/polter-x64 --minify
     scripts/package-macos-universal.sh dist-homebrew "$version"
     ```

4) Homebrew (only if this project ships a formula)  
   - Update `homebrew/poltergeist.rb` URL, SHA256, version, and version check.  
   - Push formula change (or open tap PR) after assets are live.

5) Commit & tag  
   - Stage the release files and run `git commit -m "release: v<ver>"`.
   - `git tag v<ver>` and push branch+tag.

6) Publish npm  
   - `pnpm publish --access public`

7) GitHub release  
   - Create release for `v<ver>` with changelog notes.  
   - Title: `poltergeist <ver>` (no “v”).  
   - Upload `poltergeist-macos-universal-v<ver>.tar.gz` (plus optional per-platform Bun binaries).
   - If Homebrew checksum mismatches later, regenerate the tarball with the correct binary names (`poltergeist` and `polter` at archive root), re-upload with `gh release upload --clobber`, and update the formula SHA accordingly.

8) Verification (must pass)  
   - npx:  
     ```bash
     rm -rf /tmp/poltergeist-npx && mkdir /tmp/poltergeist-npx && cd /tmp/poltergeist-npx
     npx @steipete/poltergeist@<ver> --version
     ```  
   - Homebrew (only if applicable and after assets propagate):  
     ```bash
     brew uninstall poltergeist || true
     brew tap steipete/tap || true
     brew install steipete/tap/poltergeist
     poltergeist --version
     brew uninstall poltergeist
     ```

9) Post-release  
   - Add new “Unreleased” stub in `CHANGELOG.md` if needed.  
   - Deprecate a bad npm version if necessary.
