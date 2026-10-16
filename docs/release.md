# Release Checklist (poltergeist)

Releases require explicit product-owner approval. Stop on failed gates; fix the cause before proceeding. Never move an existing tag or publish unverified artifacts.

## Prepare

1. Update compatible dependencies without raising the Node.js 24 floor. Keep TypeScript 6 until TypeDoc supports the TypeScript 7 compiler API.
2. Bump both `package.json` and `src/cli/version.ts`.
3. Move every unreleased changelog bullet into the new version section, with a one-line `**Highlights:**` first. Preserve an empty `Unreleased` section.
4. Run the clean gates:
   ```sh
   pnpm install --frozen-lockfile
   pnpm run lint
   pnpm run build
   pnpm run typecheck
   pnpm vitest --config vitest.config.ci.ts
   pnpm run test:coverage
   node --test scripts/test-release.mjs
   pnpm run build:bun:all
   ```
5. Review and merge the release preparation PR only after exact-head CI is green. Confirm the merged default-branch CI before tagging.

## Build a draft

To validate CLI dependency changes without creating a tag or release, run `gh workflow run release.yml --ref main -f dry_run=true -f version=<current-package-version>`. This checks the supplied version against `package.json`, runs the CLI build, tests, lint, type check, and release guards, then uploads an npm tarball as a workflow artifact. Dry runs never sign macOS artifacts, create a release, publish npm, or update Homebrew. Signed macOS packaging still requires the approved tag workflow below.

Create a signed `v<version>` tag at the verified release commit using the configured Git signing setup, then push the tag. The tag workflow builds the npm tarball, companion app, and universal Homebrew CLI archive, and creates a **draft** GitHub Release named `poltergeist <version>`. Its body comes directly from the version's changelog section via `scripts/release-notes.mjs`.

The macOS jobs use an ephemeral CI keychain and the personal Developer ID identity. The companion app targets macOS 15.0; the Bun CLI binaries target macOS 13.0. `scripts/verify-macos-target.mjs` checks every architecture before packaging, requires both arm64 and x86_64, and rejects a deployment target above the documented floor. Never override a failed check without restoring compatibility.

The app is signed, notarized, stapled, and verified by `apps/mac/scripts/{build,notarize,verify}-release.sh`. The Homebrew job builds four Bun slices and calls `scripts/package-macos-universal.sh`, which assembles, signs, verifies, smoke-tests, and notarizes both executables before writing the archive and SHA-256. The CLI notarization receipt is a separate release asset because bare executables cannot carry stapled tickets.

For a local signing recovery, invoke the existing `release-mac-app` skill's `mac-release codesign-run --with-package-secrets -- <repo script>` with the managed keychain configuration. Wait for its shared keychain lock; never sign outside that helper. Prefer resuming the failed workflow for the same version when possible. Do not delete or replace a published tag.

## Verify and publish

Download **every** draft asset before publishing. Inspect the extracted app and both CLI executables:

```sh
node scripts/verify-macos-target.mjs Poltergeist.app/Contents/MacOS/Poltergeist 15.0
node scripts/verify-macos-target.mjs poltergeist 13.0
node scripts/verify-macos-target.mjs polter 13.0
apps/mac/scripts/verify-release.sh Poltergeist.app
xcrun stapler validate Poltergeist.app
codesign --verify --strict --all-architectures poltergeist
codesign --verify --strict --all-architectures polter
```

Verify the CLI receipt says `Accepted`, compare the archive's SHA-256 with its checksum asset, and run both binaries with `--version` plus a real command in a synthetic project. Check that all package versions match the tag and that the draft release body equals the changelog section.

Publish npm through GitHub Actions after verifying every draft asset. Configure npm trusted publishing for this repository's `release.yml` workflow, then dispatch `gh workflow run release.yml --ref main -f dry_run=false -f version=<version>`. The current workflow checks out the matching release tag and requires a draft release, publishes the original tarball with scripts disabled and provenance enabled, and verifies its registry integrity. This allows a workflow repair to resume the same release without moving its tag. The job needs `contents: write` because GitHub only exposes draft assets to writers. Before the first OIDC publication, inspect and refresh the npm trusted-publisher record using the npm skill. Do not publish locally. Verify with:

```sh
npm view @steipete/poltergeist@<version> version dist-tags.latest dist.tarball dist.integrity time --json
npx --yes @steipete/poltergeist@<version> --version
```

The workflow waits up to five minutes for npm processing. If processing takes longer, wait for registry visibility and rerun the non-dry dispatch; it skips publication only when the existing registry integrity matches the draft tarball. Run the npx smoke test from a clean temporary directory. Then publish the verified GitHub draft. The `release: published` workflow dispatches the Homebrew tap update only after assets are public.

## Close out

Read back `repos/steipete/poltergeist/releases/tags/v<version>` and verify it is public, complete, and has the exact changelog body. Download every public asset by URL and compare the verified bytes. Read `steipete/homebrew-tap/Formula/poltergeist.rb` and confirm its version and SHA-256 match the downloaded universal CLI archive. Smoke-test a clean Homebrew installation in an isolated prefix; preserve the user's installation. Update this repository's `homebrew/poltergeist.rb` mirror after the asset checksum is known.

Keep the empty `Unreleased` stub. Report registry integrity and publish time, CI/release URLs, asset checks, signing/notarization results, deployment targets, and installer smoke results. Poltergeist does not ship a Go module or Sparkle appcast.
