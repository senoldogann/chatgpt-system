// Dependency-free focused contract test; run with: node --experimental-strip-types scripts/native-check-routing-smoke.mjs
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, symlink, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { discoverNativeSwiftTestChecks, isNativeMacosScriptInvocation } from '../src/project/project-native-checks.ts';

assert.equal(isNativeMacosScriptInvocation('npm', ['run', 'test:computer:macos']), true);
assert.equal(isNativeMacosScriptInvocation('pnpm', ['run', 'build:macos']), true);
assert.equal(isNativeMacosScriptInvocation('yarn', ['test:computer:macos']), true);
assert.equal(isNativeMacosScriptInvocation('bun', ['test:computer:macos']), true);
assert.equal(isNativeMacosScriptInvocation('npm', ['run', 'check']), false);
assert.equal(isNativeMacosScriptInvocation('bun', ['install']), false);
assert.equal(isNativeMacosScriptInvocation('node', ['test:macos']), false);
assert.equal(isNativeMacosScriptInvocation('swift', ['test']), false);
const root = await mkdtemp(path.join(os.tmpdir(), 'native-check-discovery-'));
try {
  await mkdir(path.join(root, 'native', 'computer'), { recursive: true });
  await writeFile(path.join(root, 'native', 'computer', 'Package.swift'), '// fixture\n');
  await writeFile(path.join(root, 'Package.swift'), '// root fixture\n');
  const scripts = {
    check: 'npm run build && npm test',
    'test:computer:macos': 'swift test --package-path native/computer',
    'test:macos': 'swift test',
    'test:unsafe:macos': 'swift test --package-path ../escape',
    'test:shell:macos': 'swift test --package-path native/computer && echo bypass',
    'test:linux': 'swift test --package-path native/computer',
    'test:missing:macos': 'swift test --package-path native/missing',
  };
  const checks = await discoverNativeSwiftTestChecks(root, scripts);
  assert.deepEqual(checks, [
    { checkId: 'package-script:test:computer:macos', kind: 'test', command: 'swift', args: ['test', '--package-path', 'native/computer'], cwd: '.', source: 'package.json#scripts.test:computer:macos', execution: 'admin-host' },
    { checkId: 'package-script:test:macos', kind: 'test', command: 'swift', args: ['test'], cwd: '.', source: 'package.json#scripts.test:macos', execution: 'admin-host' },
  ]);
  await symlink(path.join(root, 'native', 'computer'), path.join(root, 'native', 'linked'));
  const linked = await discoverNativeSwiftTestChecks(root, { 'test:linked:macos': 'swift test --package-path native/linked' });
  assert.deepEqual(linked, [], 'symlinked native package must never be passed to host execution');
  console.log('NATIVE_CHECK_DISCOVERY_PASS');
} finally {
  await rm(root, { recursive: true, force: true });
}
