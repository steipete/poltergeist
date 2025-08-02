// Test the fixed regex conversion
const pattern = 'frontend/**/*.ts';
const file = 'frontend/src/app.ts';

// Fixed conversion logic
let regexPattern = pattern
  .replace(/\*\*/g, '___DOUBLESTAR___')   // Temporarily replace **
  .replace(/[.+^${}()|[\]\\]/g, '\\$&')  // Escape regex special chars
  .replace(/___DOUBLESTAR___/g, '.*')     // ** matches any path depth
  .replace(/\*/g, '[^/]*')               // * matches within directory
  .replace(/\?/g, '.');                  // ? matches single char

// Ensure pattern matches from start to end
regexPattern = '^' + regexPattern + '$';

console.log('Original pattern:', pattern);
console.log('File to match:', file);
console.log('Converted regex:', regexPattern);

const regex = new RegExp(regexPattern);
const result = regex.test(file);
console.log('Match result:', result);

// Test other patterns
const patterns = [
  'frontend/**/*.ts',
  'src/**/*.js',
  '*.json',
  'docs/*.md'
];

const files = [
  'frontend/src/app.ts',
  'frontend/components/button.ts',
  'src/main.js',
  'src/utils/helper.js',
  'package.json',
  'docs/readme.md'
];

console.log('\nTesting multiple patterns:');
patterns.forEach(pat => {
  console.log(`\nPattern: ${pat}`);
  files.forEach(f => {
    let reg = pat
      .replace(/\*\*/g, '___DOUBLESTAR___')
      .replace(/[.+^${}()|[\]\\]/g, '\\$&')
      .replace(/___DOUBLESTAR___/g, '.*')
      .replace(/\*/g, '[^/]*')
      .replace(/\?/g, '.');
    reg = '^' + reg + '$';
    const match = new RegExp(reg).test(f);
    console.log(`  ${f}: ${match}`);
  });
});