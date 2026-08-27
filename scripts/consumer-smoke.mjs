import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const tarballArgument = process.argv[2];
if (!tarballArgument) {
  throw new Error('Usage: node scripts/consumer-smoke.mjs <path-to-package.tgz>');
}

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const tarball = resolve(repositoryRoot, tarballArgument);
const workspace = mkdtempSync(resolve(tmpdir(), 'bozz-routeros-consumer-'));

try {
  writeFileSync(
    resolve(workspace, 'package.json'),
    `${JSON.stringify({ name: 'bozz-routeros-consumer-smoke', private: true, type: 'module' }, null, 2)}\n`,
  );

  execFileSync(
    'npm',
    ['install', '--ignore-scripts', '--no-audit', '--no-fund', tarball],
    { cwd: workspace, stdio: 'inherit' },
  );

  const smokeFile = resolve(workspace, 'smoke.mjs');
  writeFileSync(
    smokeFile,
    `
import assert from 'node:assert/strict';
import {
  RouterOSClient,
  SentenceDecoder,
  encodeSentence,
  routerOSQuery,
} from '@bozz/routeros';

assert.equal(typeof RouterOSClient, 'function');
assert.equal(typeof SentenceDecoder, 'function');
assert.equal(typeof encodeSentence, 'function');
assert.equal(typeof routerOSQuery, 'function');

const decoder = new SentenceDecoder();
const sentences = decoder.push(encodeSentence(['!done', '.tag=consumer-smoke']));
assert.deepEqual(sentences, [['!done', '.tag=consumer-smoke']]);

const query = routerOSQuery().equals('name', 'ether1').toWords();
assert.deepEqual(query, ['?name=ether1']);

console.log('consumer smoke: ok');
`,
  );

  execFileSync(process.execPath, [smokeFile], { cwd: workspace, stdio: 'inherit' });
} finally {
  rmSync(workspace, { recursive: true, force: true });
}
