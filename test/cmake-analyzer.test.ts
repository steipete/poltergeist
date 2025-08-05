import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { CMakeAnalyzer } from '../src/utils/cmake-analyzer.js';
import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

describe('CMakeAnalyzer', () => {
  let analyzer: CMakeAnalyzer;
  let testDir: string;

  beforeEach(() => {
    testDir = path.join(__dirname, 'test-cmake-project');
    fs.mkdirSync(testDir, { recursive: true });
    analyzer = new CMakeAnalyzer(testDir);
  });

  afterEach(() => {
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  describe('optimizeWatchPatterns', () => {
    it('should not modify patterns that are already optimized', () => {
      const patterns = [
        'src/{core,utils,helpers}/**/*.{c,h}',
        'tests/**/*.{c,h}'
      ];
      
      const optimized = (analyzer as any).optimizeWatchPatterns(patterns);
      expect(optimized).toEqual(patterns.sort());
    });

    it('should combine patterns with same prefix and suffix', () => {
      const patterns = [
        'src/core/**/*.{c,h}',
        'src/utils/**/*.{c,h}',
        'src/helpers/**/*.{c,h}'
      ];
      
      const optimized = (analyzer as any).optimizeWatchPatterns(patterns);
      expect(optimized).toEqual(['src/{core,helpers,utils}/**/*.{c,h}']);
    });

    it('should handle patterns with different suffixes separately', () => {
      const patterns = [
        'src/core/**/*.c',
        'src/core/**/*.h',
        'src/utils/**/*.c',
        'src/utils/**/*.h'
      ];
      
      const optimized = (analyzer as any).optimizeWatchPatterns(patterns);
      expect(optimized).toEqual([
        'src/{core,utils}/**/*.c',
        'src/{core,utils}/**/*.h'
      ]);
    });

    it('should remove redundant subdirectory patterns', () => {
      const patterns = [
        'spine-c/**/*.{c,h}',
        'spine-c/src/**/*.{c,h}',
        'spine-c/include/**/*.{c,h}',
        'spine-c/src/internal/**/*.{c,h}'
      ];
      
      const optimized = (analyzer as any).optimizeWatchPatterns(patterns);
      expect(optimized).toEqual(['spine-c/**/*.{c,h}']);
    });

    it('should handle complex real-world patterns', () => {
      const patterns = [
        '**/CMakeLists.txt',
        'cmake/**/*.cmake',
        '**/*.{c,h}',
        'spine-c-unit-tests/**/*.{c,cpp,cxx,cc,h,hpp,hxx}',
        'spine-c-unit-tests/memory/**/*.{c,cpp,cxx,cc,h,hpp,hxx}',
        'spine-c-unit-tests/minicppunit/**/*.{c,cpp,cxx,cc,h,hpp,hxx}',
        'spine-c-unit-tests/teamcity/**/*.{c,cpp,cxx,cc,h,hpp,hxx}',
        'spine-c-unit-tests/tests/**/*.{c,cpp,cxx,cc,h,hpp,hxx}',
        'spine-c/include/**/*.{c,cpp,cxx,cc,h,hpp,hxx}',
        'spine-c/include/spine/**/*.{c,cpp,cxx,cc,h,hpp,hxx}',
        'spine-c/src/**/*.{c,cpp,cxx,cc,h,hpp,hxx}',
        'spine-c/src/spine/**/*.{c,cpp,cxx,cc,h,hpp,hxx}'
      ];
      
      const optimized = (analyzer as any).optimizeWatchPatterns(patterns);
      
      // Should remove subdirectory patterns that are covered by parent patterns
      expect(optimized).not.toContain('spine-c-unit-tests/memory/**/*.{c,cpp,cxx,cc,h,hpp,hxx}');
      expect(optimized).not.toContain('spine-c/include/spine/**/*.{c,cpp,cxx,cc,h,hpp,hxx}');
      expect(optimized).toContain('spine-c-unit-tests/**/*.{c,cpp,cxx,cc,h,hpp,hxx}');
      expect(optimized).toContain('**/*.{c,h}');
    });

    it('should handle single patterns without optimization', () => {
      const patterns = ['src/main.c', 'include/header.h'];
      
      const optimized = (analyzer as any).optimizeWatchPatterns(patterns);
      expect(optimized).toEqual(patterns.sort());
    });

    it('should handle empty pattern array', () => {
      const patterns: string[] = [];
      
      const optimized = (analyzer as any).optimizeWatchPatterns(patterns);
      expect(optimized).toEqual([]);
    });

    it('should combine deeply nested patterns', () => {
      const patterns = [
        'project/src/module1/submodule/**/*.{c,h}',
        'project/src/module2/submodule/**/*.{c,h}',
        'project/src/module3/submodule/**/*.{c,h}'
      ];
      
      const optimized = (analyzer as any).optimizeWatchPatterns(patterns);
      expect(optimized).toEqual(['project/src/{module1,module2,module3}/submodule/**/*.{c,h}']);
    });

    it('should not combine patterns with different depths', () => {
      const patterns = [
        'src/core/**/*.c',
        'src/core/internal/**/*.c',
        'tests/**/*.c'
      ];
      
      const optimized = (analyzer as any).optimizeWatchPatterns(patterns);
      // Should keep parent pattern and remove redundant child
      expect(optimized).toContain('src/core/**/*.c');
      expect(optimized).not.toContain('src/core/internal/**/*.c');
      expect(optimized).toContain('tests/**/*.c');
    });

    it('should handle patterns with special characters', () => {
      const patterns = [
        'src/my-module/**/*.{c,h}',
        'src/your-module/**/*.{c,h}',
        'src/@special/**/*.{c,h}',
        'src/module_test/**/*.{c,h}'
      ];
      
      const optimized = (analyzer as any).optimizeWatchPatterns(patterns);
      // Should combine patterns with special characters
      expect(optimized.some(p => p.includes('{@special,module_test,my-module,your-module}'))).toBe(true);
    });

    it('should handle Windows-style paths', () => {
      const patterns = [
        'src\\core\\**\\*.c',
        'src\\utils\\**\\*.c'
      ];
      
      // Should handle gracefully even if not optimized
      const optimized = (analyzer as any).optimizeWatchPatterns(patterns);
      expect(optimized).toEqual(patterns.sort());
    });

    it('should preserve order of non-optimizable patterns', () => {
      const patterns = [
        'package.json',
        'tsconfig.json',
        'src/index.ts',
        'src/core/**/*.ts',
        'src/utils/**/*.ts'
      ];
      
      const optimized = (analyzer as any).optimizeWatchPatterns(patterns);
      // Non-wildcard patterns should remain
      expect(optimized).toContain('package.json');
      expect(optimized).toContain('tsconfig.json');
      expect(optimized).toContain('src/index.ts');
      // Wildcard patterns should be optimized
      expect(optimized).toContain('src/{core,utils}/**/*.ts');
    });
  });

  describe('isPatternRedundant', () => {
    it('should detect redundant subdirectory patterns', () => {
      const isRedundant = (analyzer as any).isPatternRedundant(
        'src/core/internal/**/*.c',
        'src/core/**/*.c'
      );
      expect(isRedundant).toBe(true);
    });

    it('should not mark non-subdirectory patterns as redundant', () => {
      const isRedundant = (analyzer as any).isPatternRedundant(
        'src/core/**/*.c',
        'src/utils/**/*.c'
      );
      expect(isRedundant).toBe(false);
    });

    it('should not mark parent patterns as redundant', () => {
      const isRedundant = (analyzer as any).isPatternRedundant(
        'src/**/*.c',
        'src/core/**/*.c'
      );
      expect(isRedundant).toBe(false);
    });

    it('should handle patterns without wildcards correctly', () => {
      const isRedundant = (analyzer as any).isPatternRedundant(
        'src/main.c',
        'src/**/*.c'
      );
      expect(isRedundant).toBe(false);
    });

    it('should handle exact same patterns', () => {
      const isRedundant = (analyzer as any).isPatternRedundant(
        'src/**/*.c',
        'src/**/*.c'
      );
      expect(isRedundant).toBe(false); // Same patterns are not redundant to each other
    });

    it('should handle patterns with different extensions', () => {
      const isRedundant = (analyzer as any).isPatternRedundant(
        'src/**/*.c',
        'src/**/*.h'
      );
      expect(isRedundant).toBe(false);
    });

    it('should handle deeply nested redundant patterns', () => {
      const isRedundant = (analyzer as any).isPatternRedundant(
        'src/core/internal/utils/helpers/**/*.c',
        'src/**/*.c'
      );
      expect(isRedundant).toBe(true);
    });
  });

  describe('generateWatchPatterns integration', () => {
    it('should generate optimized patterns for CMake analysis', () => {
      // Create a mock CMake analysis result
      const mockAnalysis = {
        version: '3.10',
        generator: 'Unix Makefiles',
        sourceDirectories: [
          'src/core',
          'src/utils',
          'src/platform',
          'include',
          'include/public',
          'tests',
          'tests/unit',
          'tests/integration'
        ],
        language: 'c',
        buildDirectory: 'build',
        targets: [],
        presets: null
      };

      const patterns = analyzer.generateWatchPatterns(mockAnalysis);
      
      // Should contain base patterns
      expect(patterns).toContain('**/CMakeLists.txt');
      expect(patterns).toContain('cmake/**/*.cmake');
      expect(patterns).toContain('**/*.{c,h}');
      
      // Should have optimized directory patterns
      const hasOptimizedSrcPattern = patterns.some(p => 
        p.includes('src/{') && p.includes('core') && p.includes('utils')
      );
      expect(hasOptimizedSrcPattern).toBe(true);
      
      // Should not have redundant patterns
      const redundantPatterns = patterns.filter(p => 
        p === 'include/public/**/*.{c,h}' || 
        p === 'tests/unit/**/*.{c,h}'
      );
      expect(redundantPatterns).toHaveLength(0);
    });
  });

  describe('optimization efficiency', () => {
    it('should significantly reduce pattern string size', () => {
      const patterns = [
        'project/module1/src/**/*.{c,cpp,h,hpp}',
        'project/module2/src/**/*.{c,cpp,h,hpp}',
        'project/module3/src/**/*.{c,cpp,h,hpp}',
        'project/module4/src/**/*.{c,cpp,h,hpp}',
        'project/module5/src/**/*.{c,cpp,h,hpp}',
        'project/common/utils/**/*.{c,cpp,h,hpp}',
        'project/common/helpers/**/*.{c,cpp,h,hpp}',
        'project/common/core/**/*.{c,cpp,h,hpp}'
      ];
      
      const optimized = (analyzer as any).optimizeWatchPatterns(patterns);
      
      const originalSize = JSON.stringify(patterns).length;
      const optimizedSize = JSON.stringify(optimized).length;
      const reduction = ((originalSize - optimizedSize) / originalSize) * 100;
      
      // Should achieve at least 30% reduction for this pattern set
      expect(reduction).toBeGreaterThan(30);
      
      // Should have correct optimized patterns
      expect(optimized).toContain('project/{module1,module2,module3,module4,module5}/src/**/*.{c,cpp,h,hpp}');
      expect(optimized).toContain('project/common/{core,helpers,utils}/**/*.{c,cpp,h,hpp}');
    });

    it('should handle mixed pattern types efficiently', () => {
      const patterns = [
        '**/CMakeLists.txt',
        'CMakePresets.json',
        'src/core/**/*.{c,h}',
        'src/utils/**/*.{c,h}',
        'src/platform/**/*.{c,h}',
        'include/**/*.h',
        'include/public/**/*.h',
        'tests/**/*.{c,cpp,cc}',
        'tests/unit/**/*.{c,cpp,cc}',
        'tests/integration/**/*.{c,cpp,cc}'
      ];
      
      const optimized = (analyzer as any).optimizeWatchPatterns(patterns);
      
      // Should keep non-optimizable patterns
      expect(optimized).toContain('**/CMakeLists.txt');
      expect(optimized).toContain('CMakePresets.json');
      
      // Should optimize src directories
      expect(optimized).toContain('src/{core,platform,utils}/**/*.{c,h}');
      
      // Should remove redundant include/public pattern
      expect(optimized).toContain('include/**/*.h');
      expect(optimized).not.toContain('include/public/**/*.h');
      
      // Should remove redundant test subdirectories
      expect(optimized).toContain('tests/**/*.{c,cpp,cc}');
      expect(optimized).not.toContain('tests/unit/**/*.{c,cpp,cc}');
    });
  });

  describe('generateTargetWatchPatterns integration', () => {
    it('should generate optimized patterns for a target with source files', () => {
      const mockTarget = {
        name: 'mylib',
        type: 'static_library' as const,
        sourceFiles: [
          'src/core/main.c',
          'src/core/helper.c',
          'src/utils/string.c',
          'src/utils/math.c',
          'src/platform/linux.c',
          'src/platform/windows.c'
        ],
        outputPath: 'build/libmylib.a'
      };

      const mockAnalysis = {
        version: '3.10',
        generator: 'Unix Makefiles',
        sourceDirectories: [],
        language: 'c' as const,
        buildDirectory: 'build',
        targets: [mockTarget],
        presets: null
      };

      const patterns = (analyzer as any).generateTargetWatchPatterns(mockTarget, mockAnalysis);
      
      // Should contain CMakeLists.txt
      expect(patterns).toContain('**/CMakeLists.txt');
      
      // Should have optimized the source directories
      const hasOptimizedPattern = patterns.some(p => 
        p === 'src/{core,platform,utils}/**/*.{c,cpp,cxx,cc,h,hpp,hxx}'
      );
      expect(hasOptimizedPattern).toBe(true);
      
      // Should not have individual directory patterns
      expect(patterns).not.toContain('src/core/**/*.{c,cpp,cxx,cc,h,hpp,hxx}');
      expect(patterns).not.toContain('src/utils/**/*.{c,cpp,cxx,cc,h,hpp,hxx}');
    });

    it('should fallback to general patterns when target has no source files', () => {
      const mockTarget = {
        name: 'all',
        type: 'custom' as const,
        sourceFiles: [],
        outputPath: ''
      };

      const mockAnalysis = {
        version: '3.10',
        generator: 'Unix Makefiles',
        sourceDirectories: ['src', 'include'],
        language: 'mixed' as const,
        buildDirectory: 'build',
        targets: [mockTarget],
        presets: null
      };

      const patterns = (analyzer as any).generateTargetWatchPatterns(mockTarget, mockAnalysis);
      
      // Should use general patterns
      expect(patterns).toContain('**/CMakeLists.txt');
      expect(patterns).toContain('**/*.{c,cpp,cxx,cc,h,hpp,hxx}');
      
      // Should have source directories from analysis
      const hasSrcPattern = patterns.some(p => p.includes('src/**/*.'));
      const hasIncludePattern = patterns.some(p => p.includes('include/**/*.'));
      expect(hasSrcPattern).toBe(true);
      expect(hasIncludePattern).toBe(true);
    });
  });
});