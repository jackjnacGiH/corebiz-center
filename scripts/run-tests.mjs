import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
const root = fileURLToPath(new URL('../', import.meta.url));
const suites = readdirSync(new URL('../tests/', import.meta.url)).filter(name => name.endsWith('.test.mjs')).sort().map(name => `tests/${name}`);
const result = spawnSync(process.execPath, [
  '--require', './scripts/test-network-guard.cjs', '--experimental-strip-types',
  '--test', '--test-concurrency=2', ...suites,
], { cwd: root, stdio: 'inherit' });
if (result.error) throw result.error;
process.exit(result.status ?? 1);
