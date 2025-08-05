#!/usr/bin/env node
//
//  check-esm-deps.js
//  Poltergeist
//

import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = join(__dirname, '..');

// Read package.json
const packageJson = JSON.parse(readFileSync(join(projectRoot, 'package.json'), 'utf-8'));

// Dependencies to check
const dependencies = packageJson.dependencies || {};

console.log('🔍 Checking ESM compatibility of dependencies...\n');
console.log('Dependencies:', Object.keys(dependencies).length);
console.log('=' .repeat(60));

const results = {
  esm: [],
  commonjs: [],
  dual: [],
  unknown: []
};

// Check each dependency
for (const [name, version] of Object.entries(dependencies)) {
  const depPath = join(projectRoot, 'node_modules', name);
  const depPackageJsonPath = join(depPath, 'package.json');
  
  if (!existsSync(depPackageJsonPath)) {
    console.log(`⚠️  ${name}: Not installed`);
    results.unknown.push(name);
    continue;
  }
  
  try {
    const depPackageJson = JSON.parse(readFileSync(depPackageJsonPath, 'utf-8'));
    
    // Check for ESM indicators
    const hasType = depPackageJson.type;
    const hasExports = depPackageJson.exports;
    const hasModule = depPackageJson.module;
    const hasMain = depPackageJson.main;
    
    let moduleType = 'unknown';
    let details = [];
    
    if (hasType === 'module') {
      moduleType = 'ESM';
      results.esm.push(name);
      details.push('type: "module"');
    } else if (hasExports && typeof hasExports === 'object') {
      // Check if exports includes ESM
      const exportsStr = JSON.stringify(hasExports);
      if (exportsStr.includes('import') || exportsStr.includes('.mjs')) {
        if (exportsStr.includes('require') || exportsStr.includes('.cjs')) {
          moduleType = 'Dual (ESM + CJS)';
          results.dual.push(name);
          details.push('exports with both');
        } else {
          moduleType = 'ESM';
          results.esm.push(name);
          details.push('exports with import');
        }
      } else {
        moduleType = 'CommonJS';
        results.commonjs.push(name);
        details.push('exports without ESM');
      }
    } else if (hasModule) {
      moduleType = 'Dual (ESM + CJS)';
      results.dual.push(name);
      details.push(`module: "${hasModule}"`);
      if (hasMain) details.push(`main: "${hasMain}"`);
    } else if (hasMain) {
      // Check file extension
      if (hasMain.endsWith('.mjs')) {
        moduleType = 'ESM';
        results.esm.push(name);
      } else if (hasMain.endsWith('.cjs')) {
        moduleType = 'CommonJS';
        results.commonjs.push(name);
      } else {
        // Assume CommonJS if no type field
        moduleType = 'CommonJS';
        results.commonjs.push(name);
      }
      details.push(`main: "${hasMain}"`);
    } else {
      results.unknown.push(name);
    }
    
    // Check the actual files for require() usage
    let usesRequire = false;
    if (hasMain && existsSync(join(depPath, hasMain))) {
      const mainContent = readFileSync(join(depPath, hasMain), 'utf-8');
      if (mainContent.includes('require(') || mainContent.includes('module.exports')) {
        usesRequire = true;
        if (moduleType === 'ESM') {
          moduleType = 'Mixed/Problematic';
        }
      }
    }
    
    const indicator = moduleType === 'ESM' ? '✅' : 
                     moduleType === 'Dual (ESM + CJS)' ? '🔄' :
                     moduleType === 'CommonJS' ? '❌' : '❓';
    
    console.log(`${indicator} ${name.padEnd(25)} ${moduleType.padEnd(20)} ${details.join(', ')}`);
    if (usesRequire && moduleType !== 'CommonJS') {
      console.log(`   ⚠️  Contains require() or module.exports`);
    }
    
  } catch (error) {
    console.log(`❓ ${name}: Error reading package.json`);
    results.unknown.push(name);
  }
}

console.log('\n' + '=' .repeat(60));
console.log('\n📊 Summary:\n');
console.log(`✅ Pure ESM:        ${results.esm.length} packages`);
if (results.esm.length > 0) {
  console.log(`   ${results.esm.join(', ')}`);
}

console.log(`\n🔄 Dual (ESM+CJS):  ${results.dual.length} packages`);
if (results.dual.length > 0) {
  console.log(`   ${results.dual.join(', ')}`);
}

console.log(`\n❌ CommonJS only:   ${results.commonjs.length} packages`);
if (results.commonjs.length > 0) {
  console.log(`   ${results.commonjs.join(', ')}`);
}

if (results.unknown.length > 0) {
  console.log(`\n❓ Unknown:         ${results.unknown.length} packages`);
  console.log(`   ${results.unknown.join(', ')}`);
}

// Suggest alternatives for CommonJS packages
console.log('\n' + '=' .repeat(60));
console.log('\n💡 Recommendations for CommonJS dependencies:\n');

const alternatives = {
  'fb-watchman': 'Consider using native fs.watch or chokidar (ESM-compatible)',
  'node-notifier': 'Consider using node-notifier@11 beta or native notifications',
  'commander': 'Already ESM-compatible in v12+, update if needed',
  'winston': 'Consider pino (ESM) or winston@4 (experimental ESM)',
  'write-file-atomic': 'Version 5+ has ESM support'
};

for (const pkg of results.commonjs) {
  if (alternatives[pkg]) {
    console.log(`${pkg}:`);
    console.log(`  → ${alternatives[pkg]}`);
  }
}

console.log('\n🚀 To enable bytecode compilation:');
console.log('1. Replace or update CommonJS dependencies');
console.log('2. Ensure all dependencies export ESM modules');
console.log('3. Test with: bun build --compile --bytecode\n');