# Poltergeist Usage Examples

This document provides comprehensive examples for using Poltergeist across different project types, development workflows, and integration scenarios.

## Table of Contents

- [Basic Project Setups](#basic-project-setups)
- [Advanced Configurations](#advanced-configurations)
- [Development Workflows](#development-workflows)
- [Integration Examples](#integration-examples)
- [Troubleshooting Scenarios](#troubleshooting-scenarios)

## Basic Project Setups

### Swift Package Manager CLI Tool

A simple Swift CLI tool with testing:

```json
{
  "version": "1.0",
  "projectType": "swift",
  "targets": [
    {
      "name": "cli-tool",
      "type": "executable",
      "buildCommand": "swift build -c release",
      "outputPath": "./.build/release/MyCLI",
      "watchPaths": ["Sources/**/*.swift", "Package.swift"]
    },
    {
      "name": "tests",
      "type": "test",
      "testCommand": "swift test --parallel",
      "watchPaths": ["Sources/**/*.swift", "Tests/**/*.swift"]
    }
  ],
  "notifications": {
    "enabled": true,
    "successSound": "Glass",
    "failureSound": "Sosumi"
  }
}
```

**Usage:**
```bash
# Start watching
poltergeist haunt

# In another terminal, test the CLI
pgrun cli-tool --help
pgrun cli-tool --version

# Run tests
swift test  # Tests will auto-run when files change
```

### Node.js Web Application

Full-stack Node.js application with frontend and API:

```json
{
  "version": "1.0",
  "projectType": "node",
  "targets": [
    {
      "name": "api-server",
      "type": "executable",
      "buildCommand": "npm run build:api",
      "outputPath": "./dist/server.js",
      "watchPaths": ["src/api/**/*.ts", "src/shared/**/*.ts"],
      "environment": {
        "NODE_ENV": "development",
        "PORT": "3001"
      }
    },
    {
      "name": "frontend",
      "type": "custom",
      "buildCommand": "npm run build:frontend",
      "outputPath": "./dist/public",
      "watchPaths": ["src/frontend/**/*.{ts,tsx,css,html}"],
      "config": {
        "outputDir": "./dist/public",
        "devServer": true
      }
    },
    {
      "name": "tests",
      "type": "test",
      "testCommand": "npm test",
      "watchPaths": ["src/**/*.ts", "test/**/*.ts"],
      "excludePaths": ["src/frontend/**/*"]
    }
  ],
  "buildScheduling": {
    "parallelization": 2,
    "prioritization": {
      "enabled": true,
      "focusDetectionWindow": 300000
    }
  }
}
```

**Development workflow:**
```bash
# Start Poltergeist
poltergeist haunt

# Start development servers (in separate terminals)
pgrun api-server --watch  # Auto-restarts on changes
pgrun frontend --serve    # Development server with hot reload

# Run tests
npm test  # Tests run automatically on file changes
```

### Rust Application with Docker

Rust application with Docker containerization:

```json
{
  "version": "1.0",
  "projectType": "rust",
  "targets": [
    {
      "name": "rust-app",
      "type": "executable",
      "buildCommand": "cargo build --release",
      "outputPath": "./target/release/myapp",
      "watchPaths": ["src/**/*.rs", "Cargo.toml", "Cargo.lock"]
    },
    {
      "name": "docker-dev",
      "type": "docker",
      "imageName": "myapp/dev",
      "buildCommand": "docker build -f Dockerfile.dev -t myapp/dev:latest .",
      "watchPaths": ["src/**/*.rs", "Dockerfile.dev", "Cargo.toml"],
      "tags": ["latest", "dev"]
    },
    {
      "name": "tests",
      "type": "test", 
      "testCommand": "cargo test --all-features",
      "watchPaths": ["src/**/*.rs", "tests/**/*.rs"]
    }
  ],
  "performance": {
    "profile": "balanced",
    "autoOptimize": true
  }
}
```

**Docker development:**
```bash
# Start monitoring
poltergeist haunt

# Run containerized application
docker run --rm -p 8080:8080 myapp/dev:latest

# Test the application
pgrun rust-app --config ./config/dev.toml
```

## Advanced Configurations

### Multi-Platform macOS Application

macOS app with CLI tool, framework, and tests:

```json
{
  "version": "1.0",
  "projectType": "swift",
  "targets": [
    {
      "name": "mac-app",
      "type": "app-bundle",
      "bundleId": "com.example.myapp",
      "buildCommand": "xcodebuild -project MyApp.xcodeproj -scheme MyApp -configuration Debug build",
      "autoRelaunch": true,
      "watchPaths": ["MyApp/**/*.swift", "Shared/**/*.swift"],
      "excludePaths": ["MyApp/Generated/**/*"]
    },
    {
      "name": "cli-companion",
      "type": "executable",
      "buildCommand": "swift build -c release --product MyAppCLI",
      "outputPath": "./.build/release/MyAppCLI",
      "watchPaths": ["Sources/MyAppCLI/**/*.swift", "Sources/Shared/**/*.swift"]
    },
    {
      "name": "shared-framework",
      "type": "framework",
      "buildCommand": "xcodebuild -project MyApp.xcodeproj -scheme SharedFramework -configuration Debug build",
      "watchPaths": ["Sources/SharedFramework/**/*.swift"]
    },
    {
      "name": "unit-tests",
      "type": "test",
      "testCommand": "swift test --filter MyAppTests",
      "watchPaths": ["Sources/**/*.swift", "Tests/MyAppTests/**/*.swift"]
    },
    {
      "name": "ui-tests",
      "type": "test",
      "testCommand": "xcodebuild test -project MyApp.xcodeproj -scheme MyAppUITests",
      "watchPaths": ["MyApp/**/*.swift", "Tests/MyAppUITests/**/*.swift"],
      "settlingDelay": 3000
    }
  ],
  "buildScheduling": {
    "parallelization": 3,
    "prioritization": {
      "enabled": true,
      "focusDetectionWindow": 600000
    }
  },
  "notifications": {
    "enabled": true,
    "successSound": "Hero",
    "failureSound": "Basso"
  }
}
```

**Development workflow:**
```bash
# Start comprehensive monitoring
poltergeist haunt --verbose

# Work on different components
# - App automatically relaunches on changes
# - CLI tool rebuilds on shared code changes
# - Tests run when relevant files change

# Test CLI integration
pgrun cli-companion --export-data ./data.json
pgrun cli-companion --import-data ./data.json
```

### Microservices Architecture

Multiple services with inter-dependencies:

```json
{
  "version": "1.0",
  "projectType": "mixed",
  "targets": [
    {
      "name": "auth-service",
      "type": "executable",
      "buildCommand": "go build -o ./bin/auth-service ./cmd/auth",
      "outputPath": "./bin/auth-service",
      "watchPaths": ["cmd/auth/**/*.go", "internal/auth/**/*.go", "pkg/**/*.go"],
      "environment": {
        "PORT": "8001",
        "DB_URL": "postgres://localhost/auth_dev"
      }
    },
    {
      "name": "user-service",
      "type": "executable", 
      "buildCommand": "go build -o ./bin/user-service ./cmd/user",
      "outputPath": "./bin/user-service",
      "watchPaths": ["cmd/user/**/*.go", "internal/user/**/*.go", "pkg/**/*.go"],
      "environment": {
        "PORT": "8002",
        "AUTH_SERVICE_URL": "http://localhost:8001"
      }
    },
    {
      "name": "api-gateway",
      "type": "executable",
      "buildCommand": "npm run build:gateway",
      "outputPath": "./dist/gateway.js",
      "watchPaths": ["src/gateway/**/*.ts", "src/shared/**/*.ts"],
      "environment": {
        "PORT": "8000",
        "AUTH_SERVICE": "http://localhost:8001",
        "USER_SERVICE": "http://localhost:8002"
      }
    },
    {
      "name": "frontend",
      "type": "custom",
      "buildCommand": "npm run build:frontend",
      "outputPath": "./dist/public",
      "watchPaths": ["src/frontend/**/*.{ts,tsx,css}"],
      "config": {
        "apiUrl": "http://localhost:8000"
      }
    },
    {
      "name": "integration-tests",
      "type": "test",
      "testCommand": "./scripts/run-integration-tests.sh",
      "watchPaths": ["tests/integration/**/*.go", "tests/fixtures/**/*"],
      "settlingDelay": 5000,
      "maxRetries": 2
    }
  ],
  "buildScheduling": {
    "parallelization": 4,
    "prioritization": {
      "enabled": true,
      "focusDetectionWindow": 900000
    }
  },
  "watchman": {
    "maxFileEvents": 15000,
    "recrawlThreshold": 5
  }
}
```

**Orchestrated startup:**
```bash
# Start all services
poltergeist haunt

# Start services in dependency order (separate terminals)
pgrun auth-service
sleep 2
pgrun user-service  
sleep 2
pgrun api-gateway
pgrun frontend --serve

# Run integration tests
sleep 5
./scripts/run-integration-tests.sh
```

### Performance-Optimized Large Project

Configuration for a large codebase with aggressive optimizations:

```json
{
  "version": "1.0",
  "projectType": "mixed",
  "targets": [
    {
      "name": "core-lib",
      "type": "library",
      "libraryType": "static",
      "buildCommand": "make lib-release",
      "outputPath": "./lib/libcore.a",
      "watchPaths": ["src/core/**/*.cpp", "include/core/**/*.h"],
      "excludePaths": ["src/core/generated/**/*", "src/core/test/**/*"]
    },
    {
      "name": "main-app",
      "type": "executable",
      "buildCommand": "make app-release",
      "outputPath": "./bin/app",
      "watchPaths": ["src/app/**/*.cpp", "src/main.cpp"],
      "settlingDelay": 2000
    },
    {
      "name": "python-bindings",
      "type": "custom",
      "buildCommand": "python setup.py build_ext --inplace",
      "watchPaths": ["bindings/**/*.cpp", "bindings/**/*.py"],
      "config": {
        "parallel": true,
        "optimization": "O3"
      }
    }
  ],
  "performance": {
    "profile": "aggressive",
    "autoOptimize": true
  },
  "watchman": {
    "useDefaultExclusions": true,
    "excludeDirs": [
      "build/intermediates",
      "build/tmp", 
      ".vscode",
      "compile_commands.json",
      "**/*.o",
      "**/*.obj"
    ],
    "maxFileEvents": 25000,
    "recrawlThreshold": 10,
    "rules": [
      {"pattern": "**/generated/**", "action": "ignore"},
      {"pattern": "**/.git/**", "action": "ignore"},
      {"pattern": "**/node_modules/**", "action": "ignore"}
    ]
  },
  "buildScheduling": {
    "parallelization": 6,
    "prioritization": {
      "enabled": true,
      "focusDetectionWindow": 1800000
    }
  }
}
```

## Development Workflows

### Test-Driven Development (TDD)

Configuration optimized for TDD workflow:

```json
{
  "version": "1.0",
  "projectType": "node",
  "targets": [
    {
      "name": "unit-tests",
      "type": "test",
      "testCommand": "npm run test:unit -- --watch",
      "watchPaths": ["src/**/*.ts", "test/unit/**/*.ts"],
      "settlingDelay": 500
    },
    {
      "name": "integration-tests",
      "type": "test",
      "testCommand": "npm run test:integration",
      "watchPaths": ["src/**/*.ts", "test/integration/**/*.ts"],
      "settlingDelay": 2000
    },
    {
      "name": "build-check",
      "type": "custom",
      "buildCommand": "npm run typecheck && npm run lint",
      "watchPaths": ["src/**/*.ts"],
      "config": {
        "fastFail": true
      }
    },
    {
      "name": "coverage",
      "type": "test",
      "testCommand": "npm run test:coverage",
      "watchPaths": ["src/**/*.ts", "test/**/*.ts"],
      "coverageFile": "./coverage/coverage-final.json",
      "settlingDelay": 3000
    }
  ],
  "buildScheduling": {
    "parallelization": 2,
    "prioritization": {
      "enabled": true,
      "focusDetectionWindow": 180000
    }  
  },
  "notifications": {
    "enabled": true,
    "successSound": "Ping",
    "failureSound": "Funk"
  }
}
```

**TDD workflow:**
```bash
# Start TDD session
poltergeist haunt

# Write failing test -> watch it fail
# Write implementation -> watch it pass
# Refactor -> ensure tests still pass

# Check coverage
open coverage/index.html
```

### Continuous Integration Setup

Production-ready CI configuration:

```json
{
  "version": "1.0",
  "projectType": "node",
  "targets": [
    {
      "name": "lint",
      "type": "custom", 
      "buildCommand": "npm run lint:all",
      "watchPaths": ["src/**/*.ts", "test/**/*.ts", ".eslintrc.js", "package.json"]
    },
    {
      "name": "typecheck",
      "type": "custom",
      "buildCommand": "npm run typecheck",
      "watchPaths": ["src/**/*.ts", "test/**/*.ts", "tsconfig.json"]
    },
    {
      "name": "unit-tests",
      "type": "test",
      "testCommand": "npm run test:unit -- --ci --coverage",
      "watchPaths": ["src/**/*.ts", "test/unit/**/*.ts"],
      "coverageFile": "./coverage/unit/coverage-final.json"
    },
    {
      "name": "integration-tests",
      "type": "test", 
      "testCommand": "npm run test:integration -- --ci",
      "watchPaths": ["src/**/*.ts", "test/integration/**/*.ts"],
      "settlingDelay": 3000
    },
    {
      "name": "build-production",
      "type": "custom",
      "buildCommand": "npm run build:prod",
      "outputPath": "./dist",
      "watchPaths": ["src/**/*.ts", "webpack.config.js", "package.json"],
      "environment": {
        "NODE_ENV": "production"
      }
    },
    {
      "name": "security-audit",
      "type": "custom",
      "buildCommand": "npm audit --audit-level=moderate",
      "watchPaths": ["package.json", "package-lock.json"],
      "maxRetries": 1
    }
  ],
  "buildScheduling": {
    "parallelization": 4
  },
  "logging": {
    "level": "info",
    "file": "./.poltergeist-ci.log"
  }
}
```

### Feature Branch Development

Configuration for feature branch workflows:

```json
{
  "version": "1.0",
  "projectType": "swift",
  "targets": [
    {
      "name": "feature-build",
      "type": "executable",
      "buildCommand": "swift build -c debug",
      "outputPath": "./.build/debug/MyApp",
      "watchPaths": ["Sources/**/*.swift", "Package.swift"]
    },
    {
      "name": "affected-tests",
      "type": "test",
      "testCommand": "./scripts/run-affected-tests.sh",
      "watchPaths": ["Sources/**/*.swift", "Tests/**/*.swift"],
      "settlingDelay": 1000
    },
    {
      "name": "lint-changes",
      "type": "custom",
      "buildCommand": "./scripts/lint-git-changes.sh",
      "watchPaths": ["Sources/**/*.swift"]
    }
  ]
}
```

## Integration Examples

### Docker Compose Integration

`docker-compose.yml`:
```yaml
version: '3.8'

services:
  poltergeist:
    image: node:20-alpine
    volumes:
      - .:/app
      - /tmp/poltergeist:/tmp/poltergeist
    working_dir: /app
    command: >
      sh -c "
        apk add --no-cache watchman &&
        npm install -g @steipete/poltergeist &&
        poltergeist haunt
      "
    
  app:
    build: .
    ports:
      - "3000:3000"
    volumes:
      - .:/app
    depends_on:
      - poltergeist
    command: pgrun server --port 3000
```

### Kubernetes Job

`poltergeist-job.yaml`:
```yaml
apiVersion: batch/v1
kind: Job
metadata:
  name: poltergeist-build
spec:
  template:
    spec:
      containers:
      - name: builder
        image: node:20
        command: ["/bin/sh"]
        args:
          - -c
          - |
            npm install -g @steipete/poltergeist
            poltergeist haunt --timeout 300
            pgrun production-build
        volumeMounts:
        - name: source-code
          mountPath: /app
        - name: poltergeist-state
          mountPath: /tmp/poltergeist
      volumes:
      - name: source-code
        persistentVolumeClaim:
          claimName: source-pvc
      - name: poltergeist-state
        emptyDir: {}
      restartPolicy: Never
```

### GitHub Actions Workflow

`.github/workflows/poltergeist-ci.yml`:
```yaml
name: Poltergeist CI

on: [push, pull_request]

jobs:
  build:
    runs-on: ubuntu-latest
    
    steps:
    - uses: actions/checkout@v4
    
    - name: Setup Node.js
      uses: actions/setup-node@v4
      with:
        node-version: '20'
        cache: 'npm'
        
    - name: Install Watchman
      run: |
        sudo apt-get update
        sudo apt-get install -y watchman
        
    - name: Install Poltergeist
      run: npm install -g @steipete/poltergeist
      
    - name: Start Poltergeist
      run: |
        poltergeist haunt &
        POLTERGEIST_PID=$!
        echo "POLTERGEIST_PID=$POLTERGEIST_PID" >> $GITHUB_ENV
        
    - name: Wait for builds
      run: |
        timeout 300 bash -c '
          while [ ! -f /tmp/poltergeist/*-main-build.state ]; do
            echo "Waiting for build..."
            sleep 5
          done
        '
        
    - name: Run application
      run: pgrun main-build --version
      
    - name: Stop Poltergeist
      run: kill $POLTERGEIST_PID
```

### Jenkins Pipeline

`Jenkinsfile`:
```groovy
pipeline {
    agent any
    
    stages {
        stage('Setup') {
            steps {
                script {
                    sh 'npm install -g @steipete/poltergeist'
                }
            }
        }
        
        stage('Build') {
            steps {
                script {
                    sh '''
                        poltergeist haunt &
                        POLTERGEIST_PID=$!
                        
                        # Wait for builds to complete
                        timeout 600 bash -c '
                            while true; do
                                if pgrun production-build --version; then
                                    echo "Build successful!"
                                    break
                                fi
                                sleep 10
                            done
                        '
                        
                        kill $POLTERGEIST_PID
                    '''
                }
            }
        }
        
        stage('Test') {
            steps {
                script {
                    sh 'pgrun test-suite --junit-output'
                }
            }
        }
        
        stage('Deploy') {
            when {
                branch 'main'
            }
            steps {
                script {
                    sh 'pgrun deploy-script --environment production'
                }
            }
        }
    }
    
    post {
        always {
            sh 'poltergeist clean --all'
        }
    }
}
```

## Troubleshooting Scenarios

### Debugging Build Failures

Configuration with enhanced debugging:

```json
{
  "version": "1.0",
  "projectType": "rust",
  "targets": [
    {
      "name": "debug-build",
      "type": "executable",
      "buildCommand": "cargo build --verbose",
      "outputPath": "./target/debug/myapp",
      "watchPaths": ["src/**/*.rs", "Cargo.toml"],
      "maxRetries": 3,
      "settlingDelay": 2000
    }
  ],
  "logging": {
    "level": "debug",
    "file": "./.poltergeist-debug.log"
  }
}
```

**Debug workflow:**
```bash
# Start with verbose logging
POLTERGEIST_LOG_LEVEL=debug poltergeist haunt --verbose

# Monitor logs in another terminal
tail -f .poltergeist-debug.log

# Check state files
poltergeist status --verbose

# Clean and restart if needed
poltergeist clean --all
poltergeist haunt
```

### Handling Large File Changes

Configuration for projects with large generated files:

```json
{
  "version": "1.0",
  "projectType": "mixed",
  "targets": [
    {
      "name": "incremental-build",
      "type": "custom",
      "buildCommand": "./scripts/incremental-build.sh",
      "watchPaths": ["src/**/*.{c,cpp,h}"],
      "excludePaths": [
        "src/generated/**/*",
        "**/*.pb.{c,h}",
        "build/intermediates/**/*"
      ],
      "settlingDelay": 5000,
      "maxRetries": 2
    }
  ],
  "watchman": {
    "maxFileEvents": 50000,
    "recrawlThreshold": 20,
    "settlingDelay": 3000,
    "rules": [
      {"pattern": "**/generated/**", "action": "ignore"},
      {"pattern": "**/*.tmp", "action": "ignore"},
      {"pattern": "**/*.log", "action": "ignore"}
    ]
  },
  "performance": {
    "profile": "aggressive",
    "autoOptimize": true
  }
}
```

### Network-Dependent Builds

Configuration for builds that require network access:

```json
{
  "version": "1.0",
  "projectType": "node",
  "targets": [
    {
      "name": "network-build",
      "type": "custom",
      "buildCommand": "./scripts/build-with-deps.sh",
      "watchPaths": ["src/**/*.ts", "package.json"],
      "maxRetries": 5,
      "settlingDelay": 3000,
      "environment": {
        "NPM_REGISTRY": "https://registry.npmjs.org/",
        "BUILD_TIMEOUT": "300"
      }
    }
  ]
}
```

`scripts/build-with-deps.sh`:
```bash
#!/bin/bash
set -e

echo "🌐 Checking network connectivity..."
if ! curl -sSf https://registry.npmjs.org/ > /dev/null; then
    echo "❌ Network not available, skipping build"
    exit 1
fi

echo "📦 Installing dependencies..."
npm ci --prefer-offline

echo "🔨 Building project..."
npm run build

echo "✅ Build completed successfully"
```

### Memory-Intensive Builds

Configuration for builds that require significant memory:

```json
{
  "version": "1.0",
  "projectType": "swift",
  "targets": [
    {
      "name": "memory-intensive",
      "type": "executable",
      "buildCommand": "swift build -c release -Xswiftc -Osize",
      "outputPath": "./.build/release/LargeApp",
      "watchPaths": ["Sources/**/*.swift"],
      "settlingDelay": 10000,
      "maxRetries": 2,
      "environment": {
        "SWIFT_EXEC": "/usr/bin/swift",
        "BUILD_JOBS": "2"
      }
    }
  ],
  "buildScheduling": {
    "parallelization": 1
  },
  "performance": {
    "profile": "conservative"
  }
}
```

---

These examples provide a comprehensive guide for using Poltergeist across different scenarios. For more advanced use cases and custom integrations, see the [API documentation](API.md) and [contribution guidelines](../CONTRIBUTING.md).