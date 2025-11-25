# Release Checklist (poltergeist)

Mirror the mcporter flow: no warnings, stop on any failure, and verify both npm (npx) and Homebrew installers.

1) Bump versions  
   - `package.json` `version`  
   - `src/cli/version.ts` (used by the CLI banner)

2) Clean gates  
   - `pnpm run lint`  
   - `pnpm run test`  
   - `pnpm run build`

3) Build Bun binaries  
   - `pnpm run build:bun:all`  
   - Create universal macOS bundle:  
     ```bash
     lipo -create dist-bun/poltergeist-bun-darwin-x64 dist-bun/poltergeist-bun-darwin-arm64 -output dist-bun/poltergeist-macos-universal
     lipo -create dist-bun/polter-bun-darwin-x64 dist-bun/polter-bun-darwin-arm64 -output dist-bun/polter-macos-universal
     tar -czf dist-bun/poltergeist-macos-universal-v<ver>.tar.gz -C dist-bun poltergeist-macos-universal polter-macos-universal
     shasum -a 256 dist-bun/poltergeist-macos-universal-v<ver>.tar.gz
     ```

4) Homebrew formula  
   - Update `homebrew/poltergeist.rb` URL, SHA256, version, and version check.  
   - Later: push formula change (or tap PR) after assets are live.

5) Commit & tag  
   - `./scripts/committer "release: v<ver>" …`  
   - `git tag v<ver>` and push branch+tag.

6) Publish npm  
   - `pnpm publish --access public`

7) GitHub release  
   - Create release for `v<ver>` with changelog notes.  
   - Upload `poltergeist-macos-universal-v<ver>.tar.gz` (plus optional per-platform Bun binaries).

8) Verification (must pass)  
   - npx:  
     ```bash
     rm -rf /tmp/poltergeist-npx && mkdir /tmp/poltergeist-npx && cd /tmp/poltergeist-npx
     npx @steipete/poltergeist@<ver> --version
     ```  
   - Homebrew (after release asset live):  
     ```bash
     brew uninstall poltergeist || true
     brew install --build-from-source ./homebrew/poltergeist.rb
     poltergeist --version
     brew uninstall poltergeist
     ```

9) Post-release  
   - Add new “Unreleased” stub in `CHANGELOG.md` if needed.  
   - Deprecate the previous version in npm if it was bad (optional).

