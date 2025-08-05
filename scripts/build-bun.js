#!/usr/bin/env bun
//
//  build-bun.js
//  Poltergeist
//

import { $ } from "bun";
import { join } from "path";
import { existsSync, mkdirSync } from "fs";

const projectRoot = join(import.meta.dir, "..");
const distDir = join(projectRoot, "dist-bun");
const targets = ["darwin-x64", "darwin-arm64", "linux-x64", "linux-arm64", "windows-x64"];

// Ensure dist directory exists
if (!existsSync(distDir)) {
  mkdirSync(distDir, { recursive: true });
}

async function buildBinary(target = null, bytecode = true) {
  const outputName = target ? `poltergeist-${target}` : "poltergeist";
  const outputPath = join(distDir, outputName);
  
  console.log(`🔨 Building ${outputName}${bytecode ? " with bytecode" : ""}...`);
  
  const buildArgs = [
    "build",
    join(projectRoot, "src/cli.ts"),
    "--compile",
    "--outfile", outputPath,
    "--minify"
  ];
  
  // Add bytecode compilation for faster startup
  // Note: Bytecode requires all dependencies to be ESM-compatible
  if (bytecode) {
    buildArgs.push("--bytecode");
  }
  
  // Add target-specific flags
  if (target && target !== "debug") {
    buildArgs.push("--target", target);
  }
  
  try {
    await $`bun ${buildArgs}`;
    
    // Get file size for reporting
    const stats = await $`stat -f "%z" ${outputPath} 2>/dev/null || stat -c "%s" ${outputPath} 2>/dev/null`.text();
    const bytes = parseInt(stats.trim());
    const size = bytes < 1024 ? `${bytes}B` :
                 bytes < 1048576 ? `${(bytes / 1024).toFixed(1)}KB` :
                 `${(bytes / 1048576).toFixed(1)}MB`;
    
    console.log(`✅ Built ${outputName} (${size})`);
    
    // Make binary executable on Unix systems
    if (!target?.includes("windows")) {
      await $`chmod +x ${outputPath}`;
    }
    
    return outputPath;
  } catch (error) {
    console.error(`❌ Failed to build ${outputName}:`, error.message);
    throw error;
  }
}

async function buildAll() {
  console.log("🚀 Poltergeist Bun Binary Builder");
  console.log("==================================\n");
  
  // Build native optimized binary first
  // Try bytecode compilation - will fall back to regular if it fails
  console.log("📦 Building native optimized binary...");
  let nativeBinary;
  try {
    console.log("🚀 Attempting bytecode compilation for faster startup...");
    nativeBinary = await buildBinary(null, true);
  } catch (error) {
    console.log("⚠️  Bytecode compilation failed, building without bytecode...");
    nativeBinary = await buildBinary(null, false);
  }
  
  // Build cross-platform binaries if requested
  if (process.argv.includes("--all-platforms")) {
    console.log("\n📦 Building cross-platform binaries...");
    
    for (const target of targets) {
      try {
        await buildBinary(target, false);
      } catch (error) {
        console.warn(`⚠️ Skipping ${target}: ${error.message}`);
      }
    }
  }
  
  // Build without bytecode for debugging if requested
  if (process.argv.includes("--debug")) {
    console.log("\n🐛 Building debug binary without bytecode...");
    await buildBinary("debug", false);
  }
  
  console.log("\n✨ Build complete!");
  console.log(`📁 Binaries location: ${distDir}`);
  
  // Test the native binary
  if (process.argv.includes("--test")) {
    console.log("\n🧪 Testing native binary...");
    const result = await $`${nativeBinary} --version`.text();
    console.log(`Version output: ${result}`);
  }
}

// Performance optimizations via Bun compile flags
process.env.BUN_JSC_forceRAMSize = "1073741824"; // 1GB RAM for JSC
process.env.BUN_JSC_useJIT = "1";
process.env.BUN_JSC_useBBQJIT = "1";
process.env.BUN_JSC_useDFGJIT = "1";
process.env.BUN_JSC_useFTLJIT = "1";

// Run the build
buildAll().catch((error) => {
  console.error("Build failed:", error);
  process.exit(1);
});