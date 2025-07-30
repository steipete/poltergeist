#!/bin/bash
# Script to migrate Poltergeist to the generic target system

echo "🚀 Migrating Poltergeist to Generic Target System"
echo "================================================"

# Check if we're in the poltergeist directory
if [ ! -f "package.json" ] || [ ! -d "src" ]; then
  echo "❌ Error: This script must be run from the Poltergeist root directory"
  exit 1
fi

# Backup existing files
echo "📦 Creating backups..."
mkdir -p backups/src
cp src/types.ts backups/src/types.ts.bak 2>/dev/null || true
cp src/config.ts backups/src/config.ts.bak 2>/dev/null || true
cp src/cli.ts backups/src/cli.ts.bak 2>/dev/null || true
cp src/poltergeist.ts backups/src/poltergeist.ts.bak 2>/dev/null || true
cp src/logger.ts backups/src/logger.ts.bak 2>/dev/null || true
cp src/watchman.ts backups/src/watchman.ts.bak 2>/dev/null || true

# Rename new files to replace old ones
echo "📝 Replacing old files with new implementations..."
mv src/types-new.ts src/types.ts
mv src/config-new.ts src/config.ts
mv src/cli-new.ts src/cli.ts
mv src/poltergeist-new.ts src/poltergeist.ts
mv src/logger-new.ts src/logger.ts
mv src/watchman-new.ts src/watchman.ts

# Update imports in all TypeScript files
echo "🔧 Updating imports..."
find src -name "*.ts" -type f -exec sed -i '' \
  -e 's/from .\/logger\.js/from .\/logger.js/g' \
  -e 's/from .\/types\.js/from .\/types.js/g' \
  -e 's/from .\/config\.js/from .\/config.js/g' \
  -e 's/from .\/poltergeist\.js/from .\/poltergeist.js/g' \
  -e 's/from .\/watchman\.js/from .\/watchman.js/g' \
  {} \;

# Update the main index.ts
echo "📦 Updating index.ts exports..."
cat > src/index.ts << 'EOF'
// Poltergeist - The ghost that keeps your projects fresh
export * from './types.js';
export * from './config.js';
export * from './poltergeist.js';
export * from './logger.js';
export * from './watchman.js';
export * from './notifier.js';
export * from './builders/index.js';
EOF

# Make CLI executable
chmod +x src/cli.ts

# Update package.json if needed
echo "📋 Updating package.json..."
# This would update the bin field if needed
# For now, we'll just remind the user

echo ""
echo "✅ Migration complete!"
echo ""
echo "⚠️  Important next steps:"
echo "1. Run 'npm run build' to compile the new TypeScript files"
echo "2. Run 'npm test' to verify everything works"
echo "3. Update your poltergeist.config.json to the new format"
echo "4. Test with a real project"
echo ""
echo "📚 See MIGRATION.md for configuration format changes"