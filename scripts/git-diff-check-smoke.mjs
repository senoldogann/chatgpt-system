import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { buildGitDiffArgs } from '../src/git/git-diff-command.ts';

assert.deepEqual(buildGitDiffArgs(false, false), ['diff', '--no-ext-diff', '--no-textconv']);
assert.deepEqual(buildGitDiffArgs(true, false), ['diff', '--no-ext-diff', '--no-textconv', '--cached']);
assert.deepEqual(buildGitDiffArgs(false, true), ['diff', '--no-ext-diff', '--no-textconv', '--check']);
assert.deepEqual(buildGitDiffArgs(true, true), ['diff', '--no-ext-diff', '--no-textconv', '--cached', '--check']);
const repo = await mkdtemp(path.join(tmpdir(), 'git-diff-check-smoke-'));
try {
  const git = (args) => spawnSync('git', args, { cwd: repo, encoding: 'utf8', env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_TERMINAL_PROMPT: '0' } });
  execFileSync('git', ['init', '-q'], { cwd: repo });
  await writeFile(path.join(repo, 'check.txt'), 'clean\n');
  assert.equal(git(['add', 'check.txt']).status, 0);
  await writeFile(path.join(repo, 'check.txt'), 'bad trailing whitespace  \n');
  assert.equal(git(['add', 'check.txt']).status, 0);
  const dirty = git(buildGitDiffArgs(true, true));
  assert.notEqual(dirty.status, 0);
  assert.match(dirty.stdout, /trailing whitespace/i);
  await writeFile(path.join(repo, 'check.txt'), 'clean\n');
  assert.equal(git(['add', 'check.txt']).status, 0);
  assert.equal(git(buildGitDiffArgs(true, true)).status, 0);
  console.log('GIT_DIFF_CHECK_SMOKE_PASS');
} finally {
  await rm(repo, { recursive: true, force: true });
}
