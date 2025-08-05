#!/usr/bin/env bun

import { $ } from 'bun';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';

console.log('🎯 Ultra-slim Bun build experiment\n');

// Create a minimal entry point that excludes unused features
const slimEntry = `#!/usr/bin/env node
// Ultra-slim Poltergeist CLI - removing unused features

import { Command } from 'commander';
import { version } from './version.js';
import { createPoltergeist } from './poltergeist.js';
import { ConfigLoader } from './config.js';
import { StateManager } from './state.js';
import { createLogger } from './logger.js';

// Minimal CLI without heavy dependencies
const program = new Command('poltergeist');

program
  .version(version)
  .description('Poltergeist - Slim build');

// Core commands only
program
  .command('start')
  .description('Start watching')
  .action(async () => {
    console.log('Starting Poltergeist...');
    // Minimal implementation
  });

program
  .command('status')
  .description('Check status')
  .action(() => {
    console.log('Status: OK');
  });

program.parse(process.argv);
`;

// Strategy 1: Bundle with external dependencies
console.log('Strategy 1: External dependencies...');
try {
  await $`bun build ./dist/cli.js --compile --minify --external fb-watchman --external node-notifier --outfile dist-bun/polter-external`;
  const size1 = await $`stat -f "%z" dist-bun/polter-external`.text();
  console.log(`  Size: ${(parseInt(size1) / 1048576).toFixed(1)}MB\n`);
} catch (e) {
  console.log(`  Failed: ${e.message}\n`);
}

// Strategy 2: Production mode with dead code elimination
console.log('Strategy 2: Production build with DCE...');
try {
  const env = {
    NODE_ENV: 'production',
    POLTERGEIST_MINIMAL: 'true'
  };
  await $`env NODE_ENV=production bun build ./dist/cli.js --compile --minify --target=bun --outfile dist-bun/polter-prod`;
  const size2 = await $`stat -f "%z" dist-bun/polter-prod`.text();
  console.log(`  Size: ${(parseInt(size2) / 1048576).toFixed(1)}MB\n`);
} catch (e) {
  console.log(`  Failed: ${e.message}\n`);
}

// Strategy 3: Create slim version without optional features
console.log('Strategy 3: Creating slim entry point...');
if (!existsSync('dist-bun')) {
  mkdirSync('dist-bun');
}

// Create a slim CLI that imports only essentials
const slimCliContent = `#!/usr/bin/env node
import { Command } from 'commander';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

const version = '1.4.0';
const program = new Command('poltergeist');

program
  .version(version)
  .description('Poltergeist - Ultra-slim build');

program
  .command('start')
  .description('Start watching')
  .option('-c, --config <path>', 'Config path')
  .action((options) => {
    console.log('👻 Poltergeist started (slim mode)');
    // Minimal implementation - would need actual logic
  });

program
  .command('status')
  .description('Check status')
  .action(() => {
    const stateDir = '/tmp/poltergeist';
    if (existsSync(stateDir)) {
      console.log('Status: Active');
    } else {
      console.log('Status: Stopped');
    }
  });

program
  .command('version')
  .description('Show version')
  .action(() => {
    console.log(\`Poltergeist v\${version} (slim)\`);
  });

program.parse(process.argv);

if (!process.argv.slice(2).length) {
  program.outputHelp();
}
`;

writeFileSync('dist-bun/cli-slim.js', slimCliContent);

try {
  await $`bun build dist-bun/cli-slim.js --compile --minify --outfile dist-bun/polter-slim`;
  const size3 = await $`stat -f "%z" dist-bun/polter-slim`.text();
  console.log(`  Size: ${(parseInt(size3) / 1048576).toFixed(1)}MB\n`);
} catch (e) {
  console.log(`  Failed: ${e.message}\n`);
}

// Strategy 4: Use Bun's built-in optimization flags
console.log('Strategy 4: Maximum Bun optimizations...');
try {
  await $`bun build ./dist/cli.js --compile --minify --sourcemap=none --target=bun-darwin-arm64 --outfile dist-bun/polter-ultra`;
  
  // Try to strip symbols
  try {
    await $`strip -S dist-bun/polter-ultra`;
    await $`strip -x dist-bun/polter-ultra`; // Remove local symbols too
  } catch {}
  
  const size4 = await $`stat -f "%z" dist-bun/polter-ultra`.text();
  console.log(`  Size: ${(parseInt(size4) / 1048576).toFixed(1)}MB\n`);
} catch (e) {
  console.log(`  Failed: ${e.message}\n`);
}

// Compare all sizes
console.log('📊 Size comparison:');
console.log('==================');
const binaries = [
  { name: 'Original', path: 'poltergeist-min' },
  { name: 'External deps', path: 'dist-bun/polter-external' },
  { name: 'Production', path: 'dist-bun/polter-prod' },
  { name: 'Slim build', path: 'dist-bun/polter-slim' },
  { name: 'Ultra optimized', path: 'dist-bun/polter-ultra' },
];

for (const binary of binaries) {
  if (existsSync(binary.path)) {
    try {
      const size = await $`stat -f "%z" ${binary.path}`.text();
      const mb = (parseInt(size) / 1048576).toFixed(1);
      
      // Test if it works
      let works = '✗';
      try {
        const result = await $`${binary.path} version 2>/dev/null`.quiet();
        works = '✓';
      } catch {}
      
      console.log(`${binary.name.padEnd(15)} ${mb.padStart(6)}MB  ${works}`);
    } catch {}
  }
}

console.log('\n💡 The Bun runtime itself is ~50MB, so that\'s the minimum size.');
console.log('   Additional code adds only 5-7MB to the base runtime.');