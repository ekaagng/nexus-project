import { readdir } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';

const suites = {
  server: ['server/test'],
  frontend: ['src']
};

const suite = process.argv[2];
if (!suite || !Object.hasOwn(suites, suite)) {
  console.error(`Usage: node scripts/run-tests.mjs <${Object.keys(suites).join('|')}>`);
  process.exit(2);
}

const testFilePattern = /\.(?:test|spec)\.(?:[cm]?[jt]sx?)$/i;
const ignoredDirectories = new Set(['node_modules', 'dist', 'coverage', '.git']);

async function discoverTests(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const found = [];

  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const fullPath = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      if (!ignoredDirectories.has(entry.name)) {
        found.push(...await discoverTests(fullPath));
      }
      continue;
    }

    if (entry.isFile() && testFilePattern.test(entry.name)) {
      found.push(fullPath);
    }
  }

  return found;
}

const files = [];
for (const root of suites[suite]) {
  files.push(...await discoverTests(root));
}

if (files.length === 0) {
  console.error(`No test files found for suite "${suite}". Checked: ${suites[suite].join(', ')}`);
  process.exit(1);
}

console.log(`Discovered ${files.length} ${suite} test file(s):`);
for (const file of files) console.log(`  - ${file}`);

const result = spawnSync(
  process.execPath,
  ['--import', 'tsx', '--test', ...files],
  { stdio: 'inherit', shell: false }
);

if (result.error) {
  console.error('Unable to start the Node.js test runner:', result.error);
  process.exit(1);
}

process.exit(result.status ?? 1);
