const { glob } = require('glob');
const { join } = require('path');
const { mkdirSync, writeFileSync } = require('fs');

const tmpDir = '/tmp/test-cmake-' + Date.now();
mkdirSync(tmpDir, { recursive: true });
writeFileSync(join(tmpDir, 'CMakeLists.txt'), 'add_executable(test main.cpp)');

glob('**/CMakeLists.txt', { cwd: tmpDir }).then(files => {
  console.log('Found files:', files);
  console.log('Count:', files.length);
});
