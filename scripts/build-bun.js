#!/usr/bin/env bun
//
//  build-bun.js
//  Poltergeist
//

// Don't use Bun shell ($) as it breaks bytecode compilation
import { spawnSync } from "child_process";
import { join } from "path";
import { existsSync, mkdirSync, statSync } from "fs";

const projectRoot = join(import.meta.dir, "..");
const distDir = join(projectRoot, "dist-bun");
// Bun expects targets prefixed with "bun-" (e.g., bun-darwin-arm64)
const targets = ["bun-darwin-x64", "bun-darwin-arm64", "bun-linux-x64", "bun-linux-arm64", "bun-windows-x64"];

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
    const result = spawnSync("bun", buildArgs, { stdio: "inherit" });
    if (result.status !== 0) {
      throw new Error(`Build failed with exit code ${result.status}`);
    }
    
    // Get file size for reporting
    try {
      const stats = statSync(outputPath);
      const bytes = stats.size;
      const size = bytes < 1024 ? `${bytes}B` :
                   bytes < 1048576 ? `${(bytes / 1024).toFixed(1)}KB` :
                   `${(bytes / 1048576).toFixed(1)}MB`;
      
      console.log(`✅ Built ${outputName} (${size})`);
    } catch {
      console.log(`✅ Built ${outputName}`);
    }
    
    // Make binary executable on Unix systems
    if (!target?.includes("windows")) {
      spawnSync("chmod", ["+x", outputPath], { stdio: "inherit" });
    }
    
    return outputPath;
  } catch (error) {
    console.error(`❌ Failed to build ${outputName}:`, error.message);
    throw error;
  }
}

async function buildPolterBinary(bytecode = false) {
  const outputPath = join(distDir, "polter");
  
  console.log(`🔨 Building polter${bytecode ? " with bytecode" : ""}...`);
  
  const buildArgs = [
    "build",
    join(projectRoot, "scripts/polter-bun.ts"),
    "--compile",
    "--outfile", outputPath,
    "--minify"
  ];
  
  if (bytecode) {
    buildArgs.push("--bytecode");
  }
  
  try {
    const result = spawnSync("bun", buildArgs, { stdio: "inherit" });
    if (result.status !== 0) {
      throw new Error(`Build failed with exit code ${result.status}`);
    }
    
    // Get file size for reporting
    try {
      const stats = statSync(outputPath);
      const bytes = stats.size;
      const size = bytes < 1024 ? `${bytes}B` :
                   bytes < 1048576 ? `${(bytes / 1024).toFixed(1)}KB` :
                   `${(bytes / 1048576).toFixed(1)}MB`;
      
      console.log(`✅ Built polter (${size})`);
    } catch {
      console.log(`✅ Built polter`);
    }
    
    // Make binary executable
    spawnSync("chmod", ["+x", outputPath], { stdio: "inherit" });
    
    return outputPath;
  } catch (error) {
    console.error(`❌ Failed to build polter:`, error.message);
    throw error;
  }
}

async function buildAll() {
  console.log("🚀 Poltergeist Bun Binary Builder");
  console.log("==================================\n");
  
  // Build native optimized binary first
  // Skip bytecode compilation for now due to compatibility issues
  console.log("📦 Building native optimized binaries...");
  console.log("⚠️  Skipping bytecode compilation due to compatibility issues");
  const nativeBinary = await buildBinary(null, false);
  
  // Build polter binary as well
  console.log("\n📦 Building polter wrapper binary...");
  const polterBinary = await buildPolterBinary(false);
  
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
    console.log("\n🧪 Testing native binaries...");
    for (const [name, binary] of [["poltergeist", nativeBinary], ["polter", polterBinary]]) {
      const result = spawnSync(binary, ["--version"], { encoding: "utf8" });
      if (result.status !== 0 || !result.stdout.trim()) {
        throw new Error(`${name} smoke test failed`);
      }
      console.log(`${name} version output: ${result.stdout.trim()}`);
    }
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
