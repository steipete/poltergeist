#!/usr/bin/env bun
//
//  build-bun-optimized.js
//  Poltergeist
//

import { $ } from "bun";
import { join, dirname } from "path";
import { existsSync, mkdirSync, writeFileSync, readFileSync } from "fs";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(__dirname, "..");
const distDir = join(projectRoot, "dist-bun");

// Optimization configurations
const OPTIMIZATION_FLAGS = {
  // Bun-specific optimizations
  minify: true,
  
  // Dead code elimination
  treeShaking: true,
  
  // Target modern JavaScript runtime
  target: "bun",
  
  // External modules that should not be bundled
  external: [
    "watchman", // Native binding
  ],
  
  // Environment variables for optimization
  define: {
    "process.env.NODE_ENV": JSON.stringify("production"),
    "DEBUG": "false",
  }
};

// Ensure dist directory exists
if (!existsSync(distDir)) {
  mkdirSync(distDir, { recursive: true });
}

async function createOptimizedEntryPoint() {
  // Create an optimized entry point that preloads critical modules
  const entryContent = `#!/usr/bin/env bun
// Optimized entry point for Poltergeist
// Preload critical modules for faster startup

// Enable Bun's performance optimizations
if (typeof Bun !== 'undefined') {
  // Use Bun's native file system APIs when available
  globalThis.__BUN_OPTIMIZED__ = true;
}

// Import main CLI module
import "./cli-bundled.js";
`;

  const entryPath = join(projectRoot, "src", "cli-optimized.ts");
  writeFileSync(entryPath, entryContent);
  return entryPath;
}

async function buildOptimizedBinary(platform = null) {
  const outputName = platform ? `poltergeist-${platform}` : "poltergeist";
  const outputPath = join(distDir, outputName);
  
  console.log(`🚀 Building highly optimized ${outputName}...`);
  
  // Build command with all optimizations
  const buildCommand = [
    "bun", "build",
    join(projectRoot, "src/cli.ts"),
    "--compile",
    "--outfile", outputPath,
    "--minify",
    "--target", platform || "bun-darwin-arm64",
  ];
  
  // Additional environment variables for maximum optimization
  const env = {
    ...process.env,
    // JavaScriptCore optimizations (as per Jarred's suggestions)
    BUN_JSC_forceRAMSize: "2147483648", // 2GB for better performance
    BUN_JSC_useJIT: "1",
    BUN_JSC_useBBQJIT: "1",
    BUN_JSC_useDFGJIT: "1",
    BUN_JSC_useFTLJIT: "1",
    BUN_JSC_useOMGJIT: "1",
    BUN_JSC_useConcurrentJIT: "1",
    BUN_JSC_jitPolicyScale: "0.0", // Most aggressive JIT compilation
    
    // Bun runtime optimizations
    BUN_DISABLE_TRANSPILER_CACHE: "0",
    BUN_RUNTIME_TRANSPILER_CACHE_PATH: join(projectRoot, ".bun-cache"),
  };
  
  try {
    // Run the build with optimizations
    const result = await $`${buildCommand}`.env(env);
    
    // Get binary size
    const stats = await $`stat -f "%z" ${outputPath} 2>/dev/null || stat -c "%s" ${outputPath} 2>/dev/null`.text();
    const bytes = parseInt(stats.trim());
    const size = formatBytes(bytes);
    
    // Strip debug symbols for smaller binary (macOS/Linux only)
    if (!platform?.includes("windows")) {
      try {
        await $`strip -S ${outputPath}`;
        const strippedStats = await $`stat -f "%z" ${outputPath} 2>/dev/null || stat -c "%s" ${outputPath} 2>/dev/null`.text();
        const strippedBytes = parseInt(strippedStats.trim());
        const strippedSize = formatBytes(strippedBytes);
        console.log(`📦 Stripped debug symbols: ${size} → ${strippedSize}`);
      } catch (e) {
        // Strip might not be available
      }
      
      // Make executable
      await $`chmod +x ${outputPath}`;
    }
    
    // Test the binary
    const version = await $`${outputPath} --version`.text();
    console.log(`✅ Built ${outputName} (${formatBytes(bytes)}) - v${version.trim()}`);
    
    return outputPath;
  } catch (error) {
    console.error(`❌ Failed to build ${outputName}:`, error.message);
    throw error;
  }
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / 1048576).toFixed(1)}MB`;
}

async function runBenchmark(binaryPath) {
  console.log("\n📊 Running startup benchmark...");
  
  const iterations = 10;
  const times = [];
  
  for (let i = 0; i < iterations; i++) {
    const start = performance.now();
    await $`${binaryPath} --version`.quiet();
    const end = performance.now();
    times.push(end - start);
  }
  
  const avg = times.reduce((a, b) => a + b, 0) / times.length;
  const min = Math.min(...times);
  const max = Math.max(...times);
  
  console.log(`  Average: ${avg.toFixed(2)}ms`);
  console.log(`  Min: ${min.toFixed(2)}ms`);
  console.log(`  Max: ${max.toFixed(2)}ms`);
}

async function buildAll() {
  console.log("🔨 Poltergeist Ultra-Optimized Bun Builder");
  console.log("==========================================\n");
  
  // Build for current platform
  const nativeBinary = await buildOptimizedBinary();
  
  // Run benchmark if requested
  if (process.argv.includes("--benchmark")) {
    await runBenchmark(nativeBinary);
  }
  
  // Build for all platforms if requested
  if (process.argv.includes("--all")) {
    const platforms = [
      "bun-darwin-x64",
      "bun-darwin-arm64", 
      "bun-linux-x64",
      "bun-linux-arm64",
      "bun-windows-x64"
    ];
    
    for (const platform of platforms) {
      if (platform.includes(process.platform)) continue; // Skip current platform
      try {
        await buildOptimizedBinary(platform);
      } catch (error) {
        console.warn(`⚠️ Skipping ${platform}: ${error.message}`);
      }
    }
  }
  
  console.log("\n✨ Build complete!");
  console.log(`📁 Optimized binaries: ${distDir}`);
  
  // Show usage instructions
  console.log("\n📖 Usage:");
  console.log(`   ${distDir}/poltergeist [options]`);
  console.log("\n🏃 Run directly:");
  console.log(`   ${nativeBinary} --help`);
}

// Run the build
buildAll().catch((error) => {
  console.error("Build failed:", error);
  process.exit(1);
});