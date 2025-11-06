# Poltergeist Release Checklist

This checklist ensures reliable, complete releases without the mistakes we've made in the past.

## Pre-Release Verification

### 1. Version Management ✅
**Mistake we made**: Version string was read from filesystem instead of being compiled in, causing binaries to report different versions depending on where they were run.

- [ ] Update version in `package.json`
- [ ] Update hardcoded version in `src/cli.ts` (line ~23)
- [ ] Update hardcoded version in `src/polter.ts` (line ~23)
- [ ] Verify versions match exactly: `grep -n "version.*1\." src/cli.ts src/polter.ts package.json`

### 2. Build Process Verification ✅
**Mistake we made**: Build script only built `poltergeist`, not `polter`, resulting in shipping old/broken binaries.

- [ ] Verify `scripts/build-bun.js` builds BOTH binaries:
  - [ ] `poltergeist` binary
  - [ ] `polter` binary
- [ ] Run build: `npm run build:bun`
- [ ] Verify both binaries exist in `dist-bun/`:
  ```bash
  ls -la dist-bun/poltergeist dist-bun/polter
  ```
- [ ] Test BOTH binaries work:
  ```bash
  ./dist-bun/poltergeist --version  # Should show correct version
  ./dist-bun/polter --version       # Should show correct version
  ./dist-bun/polter --help          # Should show help text
  ```

### 3. Binary Independence Test ✅
**Mistake we made**: Binary read version from local package.json, not its compiled-in version.

- [ ] Test binaries work WITHOUT package.json:
  ```bash
  mv package.json package.json.bak
  ./dist-bun/poltergeist --version  # Must show correct version
  ./dist-bun/polter --version       # Must show correct version
  mv package.json.bak package.json
  ```
- [ ] Test in isolated directory:
  ```bash
  mkdir -p /tmp/test-poltergeist
  cp dist-bun/poltergeist /tmp/test-poltergeist/
  cp dist-bun/polter /tmp/test-poltergeist/
  cd /tmp/test-poltergeist
  ./poltergeist --version  # Must work
  ./polter --version       # Must work
  cd -
  rm -rf /tmp/test-poltergeist
  ```

### 4. String Verification ✅
**Mistake we made**: Old versions were still embedded in compiled binaries.

- [ ] Check for old version strings in binaries:
  ```bash
  # Should find NO old versions (1.6.x or older)
  strings dist-bun/poltergeist | grep -E "1\.[0-6]\.[0-9]"
  strings dist-bun/polter | grep -E "1\.[0-6]\.[0-9]"
  
  # Should find current version
  strings dist-bun/poltergeist | grep "$(cat package.json | jq -r .version)"
  strings dist-bun/polter | grep "$(cat package.json | jq -r .version)"
  ```

## Release Process

### 1. Testing
- [ ] Run full test suite: `pnpm test`
- [ ] Note any flaky tests but don't block on daemon timing issues
- [ ] Run linting: `pnpm run lint`
- [ ] Run type checking: `pnpm run typecheck`
- [ ] Run formatter check: `pnpm format:check`
- [ ] Run example harness: `pnpm exec tsx scripts/run-examples.ts`

### 2. Changelog
- [ ] Update `CHANGELOG.md` with all changes
- [ ] Use single-line format for consistency
- [ ] Include all bug fixes, even embarrassing ones
- [ ] Format: `- Fixed/Added/Changed description of change`

### 3. Git Operations
- [ ] Commit all changes: `git add -A && git commit -m "Release v{version}"`
- [ ] Create git tag: `git tag v{version}`
- [ ] Push to main: `git push origin main`
- [ ] Push tag: `git push origin v{version}`
  - If tag push times out, try: `git push origin v{version} --no-verify`

### 4. npm Release
- [ ] Ensure logged in: `npm whoami`
- [ ] Publish: `npm publish`
- [ ] Verify on npm: `npm view @steipete/poltergeist@{version}`

### 5. Homebrew Release

#### Create Release Tarball
- [ ] Create tarball with BOTH binaries:
  ```bash
  cd dist-bun
  tar -czf poltergeist-macos-universal-v{version}.tar.gz poltergeist polter
  shasum -a 256 poltergeist-macos-universal-v{version}.tar.gz
  cd ..
  ```
- [ ] Note the SHA256 hash for Homebrew formula

#### GitHub Release
- [ ] Create GitHub release:
  ```bash
  gh release create v{version} \
    --title "Release v{version}" \
    --notes "$(tail -n 20 CHANGELOG.md)" \
    dist-bun/poltergeist-macos-universal-v{version}.tar.gz
  ```

#### Test Release Download
**Critical**: Test that the released tarball actually works!

- [ ] Download and test the release:
  ```bash
  cd /tmp
  curl -L https://github.com/steipete/poltergeist/releases/download/v{version}/poltergeist-macos-universal-v{version}.tar.gz | tar -xz
  ./poltergeist --version  # Must show correct version
  ./polter --version       # Must show correct version
  ./polter --help          # Must show help, not silent fail
  cd -
  ```

#### Update Homebrew Formula
- [ ] Clone homebrew repo: `git clone https://github.com/steipete/homebrew-poltergeist.git /tmp/homebrew-poltergeist`
- [ ] Update formula with new version and SHA256
- [ ] Update version test in formula
- [ ] Commit and push:
  ```bash
  cd /tmp/homebrew-poltergeist
  git add -A
  git commit -m "Update to v{version}"
  git push
  ```

### 6. Post-Release Verification

- [ ] Test Homebrew installation:
  ```bash
  brew update
  brew upgrade steipete/poltergeist/poltergeist
  poltergeist --version  # Must show new version
  polter --version       # Must show new version
  polter --help          # Must work, not silent fail
  ```

- [ ] Test npm installation:
  ```bash
  npm install -g @steipete/poltergeist@{version}
  poltergeist --version
  ```

## Emergency Rollback

If something goes wrong:

1. **npm**: `npm unpublish @steipete/poltergeist@{version}` (within 72 hours)
2. **GitHub**: Delete the release and tag
3. **Homebrew**: Revert the formula commit

## Lessons Learned

### Version String Management
- **Never** read version from filesystem in compiled binaries
- **Always** hardcode version as compile-time constant
- **Test** binaries in isolation without package.json

### Build Process
- **Always** build ALL binaries (poltergeist AND polter)
- **Test** each binary individually after building
- **Verify** build script includes all targets

### Binary Testing
- **Test** with `--version` flag
- **Test** with `--help` flag  
- **Test** with no arguments (should show help, not silent fail)
- **Test** in isolated environment without source code

### Release Artifacts
- **Include** all required binaries in tarball
- **Test** downloaded tarball before updating Homebrew
- **Verify** SHA256 matches after upload

## Automation Opportunities

Consider automating these checks:
- Version consistency check script
- Binary validation test suite
- GitHub Actions workflow for releases
- Automated Homebrew formula PR creation

## Final Note

Take your time with releases. It's better to catch issues before release than to ship broken binaries to users. When in doubt, test in a fresh VM or container to simulate a real user environment.
