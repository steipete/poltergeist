# Poltergeist Release Checklist

This checklist ensures consistent and reliable releases of Poltergeist.

## Pre-Release Checklist

### 1. Version Management
- [ ] Update version in `package.json`
- [ ] Update hardcoded version in `src/cli.ts` (line ~23)
- [ ] Update hardcoded version in `src/polter.ts` (line ~23)
- [ ] Verify all three versions match exactly

### 2. Changelog
- [ ] Add new version section to `CHANGELOG.md`
- [ ] Document all changes, fixes, and improvements
- [ ] Follow single-line format for each entry
- [ ] Review changelog for clarity and completeness

### 3. Code Quality
- [ ] Run linter: `npm run lint`
- [ ] Run type checking: `npm run typecheck`
- [ ] Fix any linting or type errors

### 4. Testing
- [ ] Run full test suite: `npm test`
- [ ] Ensure all tests pass
- [ ] Test key functionality manually if needed

### 5. Build Process
- [ ] Clean previous builds: `rm -rf dist dist-bun`
- [ ] Build TypeScript: `npm run build`
- [ ] Build Bun binary: `npm run build:bun`

### 6. Binary Verification
- [ ] Test binary version without package.json:
  ```bash
  mv package.json package.json.bak
  ./dist-bun/poltergeist --version  # Should show correct version
  mv package.json.bak package.json
  ```
- [ ] Test binary in isolated directory:
  ```bash
  mkdir -p /tmp/test-poltergeist
  cp dist-bun/poltergeist /tmp/test-poltergeist/
  cd /tmp/test-poltergeist
  ./poltergeist --version  # Should show correct version
  rm -rf /tmp/test-poltergeist
  ```
- [ ] Verify binary size is reasonable (~50-60MB)

## Release Process

### 1. Create Release Tarball
```bash
cd dist-bun
tar -czf poltergeist-macos-universal-v{VERSION}.tar.gz poltergeist polter
shasum -a 256 poltergeist-macos-universal-v{VERSION}.tar.gz
```

### 2. Git Operations
- [ ] Commit all changes: `git add -A && git commit -m "Release v{VERSION}"`
- [ ] Create git tag: `git tag v{VERSION}`
- [ ] Push changes: `git push origin main`
- [ ] Push tag: `git push origin v{VERSION}`

### 3. GitHub Release
- [ ] Go to GitHub releases page
- [ ] Click "Draft a new release"
- [ ] Select the tag `v{VERSION}`
- [ ] Title: `Release v{VERSION}`
- [ ] Copy changelog entries for this version
- [ ] Upload the tarball: `poltergeist-macos-universal-v{VERSION}.tar.gz`
- [ ] Publish release

### 4. Homebrew Formula Update
- [ ] Calculate SHA256 of the tarball
- [ ] Update formula in `steipete/homebrew-poltergeist`:
  ```ruby
  url "https://github.com/steipete/poltergeist/releases/download/v{VERSION}/poltergeist-macos-universal-v{VERSION}.tar.gz"
  sha256 "{SHA256_HASH}"
  ```
- [ ] Test installation: `brew upgrade poltergeist`
- [ ] Verify version: `poltergeist --version`

## Post-Release Verification

### 1. Clean Installation Test
- [ ] On a clean system or VM:
  ```bash
  brew install steipete/poltergeist/poltergeist
  poltergeist --version  # Should show correct version
  ```

### 2. Binary Distribution Test
- [ ] Download release from GitHub
- [ ] Extract and run without any package.json present
- [ ] Verify version is correct

### 3. Documentation
- [ ] Update README.md if needed
- [ ] Update any version references in documentation

## Rollback Plan

If issues are discovered post-release:

1. **Delete the GitHub release** (keep the tag for history)
2. **Fix the issue** in code
3. **Increment patch version** (e.g., 1.7.1 -> 1.7.2)
4. **Follow full release process** again

## Important Notes

⚠️ **CRITICAL**: The version must be hardcoded in `cli.ts` and `polter.ts`. The binary should NEVER read version from the filesystem at runtime.

⚠️ **CRITICAL**: Always test the binary in an environment without package.json to ensure it reports the correct compiled-in version.

⚠️ **Binary Format**: Poltergeist is distributed as a pre-compiled Bun executable, NOT as a Node.js package. The Homebrew formula downloads from GitHub releases, not npm.

## Version History

- **1.7.1**: Fixed version string to be compile-time constant (no filesystem reads)
- **1.7.0**: Initial release with dynamic version reading bug