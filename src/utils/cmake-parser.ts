import { readFileSync } from 'fs';
import { glob } from 'glob';
import { dirname, join, relative } from 'path';
import type { CMakeTarget } from './cmake-analyzer.js';

export interface CMakeParserDeps {
  glob: typeof glob;
  readFileSync: typeof readFileSync;
}

const defaultDeps: CMakeParserDeps = { glob, readFileSync };

export async function parseCMakeFiles(
  projectRoot: string,
  deps: CMakeParserDeps = defaultDeps
): Promise<CMakeTarget[]> {
  const targets: CMakeTarget[] = [];
  const cmakeFiles = await deps.glob(['CMakeLists.txt', '**/CMakeLists.txt'], {
    cwd: projectRoot,
    ignore: ['build/**', '_build/**', 'out/**', '**/CMakeFiles/**'],
  });

  for (const file of cmakeFiles) {
    const content = deps.readFileSync(join(projectRoot, file), 'utf-8');
    const filePath = join(projectRoot, file);
    const fileDir = dirname(filePath);

    // executables
    const execMatches = content.matchAll(
      /add_executable\s*\(\s*([\w-]+)(?:\s+WIN32)?(?:\s+MACOSX_BUNDLE)?(?:\s+([^)]+))?\s*\)/gm
    );
    for (const match of execMatches) {
      const name = match[1];
      const sources = match[2] ? parseSourceList(match[2], fileDir, projectRoot) : [];
      targets.push({
        name,
        type: 'executable',
        sourceFiles: sources,
        dependencies: [],
        includeDirectories: [],
      });
    }

    // libraries
    const libMatches = content.matchAll(
      /add_library\s*\(\s*([\w-]+)(?:\s+(STATIC|SHARED|MODULE|INTERFACE|OBJECT))?(?:\s+([^)]+))?\s*\)/gm
    );
    for (const match of libMatches) {
      const name = match[1];
      const libType = match[2] || 'STATIC';
      const sources =
        libType !== 'INTERFACE' && match[3] ? parseSourceList(match[3], fileDir, projectRoot) : [];

      targets.push({
        name,
        type: libType === 'SHARED' ? 'shared_library' : 'static_library',
        sourceFiles: sources,
        dependencies: [],
        includeDirectories: [],
      });
    }

    // custom targets
    const customMatches = content.matchAll(/add_custom_target\s*\(\s*([\w-]+)/gm);
    for (const match of customMatches) {
      targets.push({
        name: match[1],
        type: 'custom',
        sourceFiles: [],
        dependencies: [],
        includeDirectories: [],
      });
    }
  }

  return targets;
}

function parseSourceList(sourceString: string, baseDir: string, projectRoot: string): string[] {
  const cleaned = sourceString
    .replace(/\s+/g, ' ')
    .replace(/^\s+|\s+$/g, '')
    .replace(/\$\{[^}]+\}/g, '')
    .trim();

  if (!cleaned) return [];

  const sources = cleaned.match(/("[^"]+"|[^\s]+)/g) || [];

  return sources
    .map((s) => s.replace(/^"|"$/g, ''))
    .filter((s) => s && !s.startsWith('$'))
    .map((s) => {
      if (s.startsWith('/')) return s; // absolute stays absolute
      if (s.includes('${')) return s; // leave variables untouched
      const rel = relative(projectRoot, join(baseDir, s));
      // ignore paths escaping the project root
      if (rel.startsWith('..')) return null;
      return rel;
    })
    .filter((s): s is string => Boolean(s))
    .filter((s) => s.match(/\.(c|cpp|cxx|cc|h|hpp|hxx)$/i));
}
