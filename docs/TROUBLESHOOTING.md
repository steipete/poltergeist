# Poltergeist Troubleshooting Guide

This guide helps you resolve common issues with Poltergeist.

## Table of Contents

- [Installation Issues](#installation-issues)
- [Daemon Startup Issues](#daemon-startup-issues)
- [Polter Command Issues](#polter-command-issues)
- [File Watching Issues](#file-watching-issues)
- [Build Failures](#build-failures)
- [Performance Issues](#performance-issues)

## Installation Issues

### Issue: `polter` command returns "unknown command"

**Symptom:** When running `polter`, you get an error: `error: unknown command 'polter'`

**Cause:** The polter command wrapper may be incorrectly configured or the installation is incomplete.

**Solutions:**

1. **Check installation method:**
   - If installed via Homebrew: `brew reinstall poltergeist`
   - If installed via npm: `npm install -g @steipete/poltergeist`

2. **Verify binary locations:**
   ```bash
   which poltergeist
   which polter
   ```

3. **Use the poltergeist subcommand as fallback:**
   ```bash
   poltergeist polter <target> [args...]
   ```

4. **Check PATH environment:**
   ```bash
   echo $PATH
   # Ensure the installation directory is in PATH
   ```

## Daemon Startup Issues

### Issue: "Daemon startup timeout"

**Symptom:** Error message: `Daemon startup timeout after 30000ms`

**Cause:** The daemon takes longer than expected to start, often due to:
- Large projects with many files
- Slow Watchman initialization
- System resource constraints

**Solutions:**

1. **Increase the timeout using environment variable:**
   ```bash
   export POLTERGEIST_DAEMON_TIMEOUT=60000  # 60 seconds
   poltergeist start
   ```

2. **Add to your shell profile for persistence:**
   ```bash
   # ~/.bashrc or ~/.zshrc
   export POLTERGEIST_DAEMON_TIMEOUT=60000
   ```

3. **Check Watchman status:**
   ```bash
   watchman version
   watchman watch-list
   ```

4. **Clear Watchman state if corrupted:**
   ```bash
   watchman shutdown-server
   rm -rf /usr/local/var/run/watchman/*
   ```

### Issue: "Daemon already running"

**Symptom:** Cannot start Poltergeist because it thinks a daemon is already running

**Solutions:**

1. **Check actual daemon status:**
   ```bash
   poltergeist status
   ```

2. **Stop the existing daemon:**
   ```bash
   poltergeist stop
   ```

3. **Clean up stale state files:**
   ```bash
   poltergeist clean --all
   ```

4. **Force cleanup (last resort):**
   ```bash
   rm -rf /tmp/poltergeist/*
   ```

## Polter Command Issues

### Issue: "Binary not found"

**Symptom:** `polter` cannot find the executable to run

**Solutions:**

1. **Verify target configuration:**
   ```bash
   poltergeist list
   ```

2. **Check outputPath in config:**
   ```json
   {
     "targets": [{
       "name": "my-app",
       "type": "executable",
       "outputPath": "./dist/my-app.js"  // Must be correct
     }]
   }
   ```

3. **Ensure build has completed:**
   ```bash
   poltergeist status
   poltergeist logs my-app
   ```

### Issue: "Build in progress" hangs forever

**Symptom:** `polter` waits indefinitely for a build that never completes

**Solutions:**

1. **Use --no-wait flag to skip waiting:**
   ```bash
   polter my-app --no-wait
   ```

2. **Force execution despite build status:**
   ```bash
   polter my-app --force
   ```

3. **Check build logs:**
   ```bash
   poltergeist logs my-app
   ```

4. **Restart the daemon:**
   ```bash
   poltergeist restart
   ```

## File Watching Issues

### Issue: Changes not detected

**Symptom:** File modifications don't trigger rebuilds

**Solutions:**

1. **Check watchPaths configuration:**
   ```json
   {
     "watchPaths": [
       "src/**/*.ts",    // Ensure patterns are correct
       "*.json"
     ]
   }
   ```

2. **Verify Watchman is working:**
   ```bash
   watchman watch-project .
   watchman trigger-list .
   ```

3. **Check exclusions aren't too broad:**
   ```json
   {
     "watchman": {
       "excludeDirs": ["node_modules", "dist"]  // Don't exclude source dirs
     }
   }
   ```

4. **Increase settling delay for rapid changes:**
   ```json
   {
     "settlingDelay": 2000  // Wait 2s after changes stop
   }
   ```

### Issue: Too many file events

**Symptom:** Error about exceeding maxFileEvents limit

**Solutions:**

1. **Increase the limit:**
   ```json
   {
     "watchman": {
       "maxFileEvents": 50000  // Default is 10000
     }
   }
   ```

2. **Add more exclusions:**
   ```json
   {
     "watchman": {
       "excludeDirs": [
         "node_modules",
         ".git",
         "dist",
         "build",
         "coverage"
       ]
     }
   }
   ```

## Build Failures

### Issue: Build command fails

**Symptom:** Build errors in logs

**Solutions:**

1. **Test build command manually:**
   ```bash
   # Copy the exact command from your config
   npm run build  # or whatever your buildCommand is
   ```

2. **Check environment variables:**
   ```json
   {
     "targets": [{
       "environment": {
         "NODE_ENV": "development",
         "PATH": "/usr/local/bin:$PATH"
       }
     }]
   }
   ```

3. **Ensure working directory is correct:**
   ```json
   {
     "targets": [{
       "workingDirectory": "./packages/my-app"
     }]
   }
   ```

## Performance Issues

### Issue: Slow build times

**Solutions:**

1. **Enable build parallelization:**
   ```json
   {
     "buildScheduling": {
       "parallelization": 4  // Run up to 4 builds in parallel
     }
   }
   ```

2. **Use performance profiling:**
   ```json
   {
     "performance": {
       "profile": "balanced"  // or "speed" for faster builds
     }
   }
   ```

3. **Optimize watch patterns:**
   ```json
   {
     "watchPaths": [
       "src/**/*.ts",  // Be specific
       "!src/**/*.test.ts"  // Exclude test files
     ]
   }
   ```

### Issue: High CPU/Memory usage

**Solutions:**

1. **Limit parallelization:**
   ```json
   {
     "buildScheduling": {
       "parallelization": 1  // Sequential builds
     }
   }
   ```

2. **Reduce Watchman's crawl frequency:**
   ```json
   {
     "watchman": {
       "recrawlThreshold": 10  // Less aggressive recrawling
     }
   }
   ```

## Debug Mode

For detailed troubleshooting, enable verbose logging:

```bash
# Run in foreground with verbose output
poltergeist start --foreground --verbose

# Check detailed logs
poltergeist logs --tail 1000

# Run polter with verbose output
polter my-app --verbose
```

## Getting Help

If these solutions don't resolve your issue:

1. **Check for updates:**
   ```bash
   npm update -g @steipete/poltergeist
   # or
   brew upgrade poltergeist
   ```

2. **Report issues:**
   - GitHub Issues: https://github.com/steipete/poltergeist/issues
   - Include:
     - Your `poltergeist.config.json`
     - Output of `poltergeist status --verbose`
     - Error messages and logs
     - OS and Node.js version

3. **Check documentation:**
   - README: https://github.com/steipete/poltergeist
   - Examples: https://github.com/steipete/poltergeist/tree/main/examples
   - API Docs: https://github.com/steipete/poltergeist/tree/main/docs