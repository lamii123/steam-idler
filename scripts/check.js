#!/usr/bin/env node
/**
 * Dependency-free repository checks. Runs in CI before the test suite so a
 * broken import or a stale external asset reference fails fast.
 */
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const errors = [];
let checked = 0;

const REQUIRED_FILES = [
  '.env.example',
  'LICENSE',
  'README.md',
  'package.json',
  'public/index.html',
  'src/app.js',
  'src/server.js',
];

const TEXT_EXTENSIONS = new Set(['.js', '.mjs', '.cjs', '.json', '.html', '.css', '.md', '.yml', '.yaml']);
const FORBIDDEN_PATTERNS = [
  { pattern: /fonts\.googleapis\.com|fonts\.gstatic\.com/g, reason: 'external Google Fonts reference' },
];

function walk(dir, files = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, files);
    else files.push(full);
  }
  return files;
}

for (const file of REQUIRED_FILES) {
  if (!fs.existsSync(path.join(root, file))) errors.push(`missing required file: ${file}`);
}

const sourceFiles = [
  ...walk(path.join(root, 'src')),
  ...walk(path.join(root, 'test')),
  ...walk(path.join(root, 'public', 'js')),
  ...walk(path.join(root, 'scripts')),
].filter((file) => file.endsWith('.js'));

for (const file of sourceFiles) {
  const relative = path.relative(root, file);
  const isBrowserModule = relative.startsWith('public' + path.sep + 'js');

  const result = isBrowserModule
    ? spawnSync(process.execPath, ['--input-type=module', '--check'], {
        input: fs.readFileSync(file, 'utf8'),
        encoding: 'utf8',
      })
    : spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });

  if (result.status !== 0) {
    errors.push(`syntax error in ${relative}\n${(result.stderr || '').trim()}`);
  }
  checked += 1;
}

for (const file of [...walk(path.join(root, 'src')), ...walk(path.join(root, 'public'))]) {
  if (!TEXT_EXTENSIONS.has(path.extname(file))) continue;

  const relative = path.relative(root, file);
  const text = fs.readFileSync(file, 'utf8');

  for (const { pattern, reason } of FORBIDDEN_PATTERNS) {
    pattern.lastIndex = 0;
    if (pattern.test(text)) errors.push(`${relative}: ${reason}`);
  }
}

// Browser modules are loaded directly, so every relative import must resolve.
// This catches files moved during refactors even though there is no bundler.
const RELATIVE_IMPORT_PATTERN =
  /(?:import|export)\s+(?:[^'";]+?\s+from\s+)?['"](\.[^'"]+)['"]/g;

for (const file of walk(path.join(root, 'public', 'js'))) {
  if (!file.endsWith('.js')) continue;

  const relative = path.relative(root, file);
  const text = fs.readFileSync(file, 'utf8');

  for (const match of text.matchAll(RELATIVE_IMPORT_PATTERN)) {
    const specifier = match[1];
    const resolved = path.resolve(path.dirname(file), specifier);

    if (!fs.existsSync(resolved)) {
      errors.push(`${relative}: unresolved import ${specifier}`);
    }
  }
}

if (errors.length > 0) {
  console.error('Repository checks failed:\n');
  for (const error of errors) console.error(`  - ${error}`);
  process.exit(1);
}

console.log(`Repository checks passed (${checked} JavaScript files).`);
