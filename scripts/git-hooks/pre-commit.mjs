// Local verification gate, run by .githooks/pre-commit and .githooks/pre-merge-commit.
//
// 1. Refuses to run if the working tree has unstaged or untracked changes, so the
//    tested files are exactly the files being committed.
// 2. On `main`, bumps the patch version unless this commit already changes it.
// 3. Runs the full `npm run check` gate and blocks the commit on failure.
//
// Git computes a clean merge commit's tree before running pre-merge-commit, so files
// staged by that hook are not included. In merge mode, a needed bump is staged and the
// merge is stopped; the following `git commit` completes it through pre-commit, which
// then sees the changed version and runs the full gate.
import {execFileSync, spawnSync} from 'node:child_process';
import {readFileSync} from 'node:fs';

const git = (...args) =>
  execFileSync('git', args, {encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore']}).trim();
const tryGit = (...args) => {
  try {
    return git(...args);
  } catch {
    return undefined;
  }
};
const mergeMode = process.argv[2] === 'merge';
const fail = (message) => {
  console.error(`\n[pre-commit] ${message}\n`);
  process.exit(1);
};
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const run = (args) =>
  spawnSync(npm, args, {stdio: 'inherit', shell: process.platform === 'win32'}).status === 0;

const unstaged = spawnSync('git', ['diff', '--quiet'], {stdio: 'ignore'}).status !== 0;
const untracked = tryGit('ls-files', '--others', '--exclude-standard');
if (unstaged || untracked) {
  fail(
    'Unstaged or untracked changes are present. Stage or stash them so the full ' +
      'verification gate tests exactly what is being committed.' +
      (untracked ? `\nUntracked:\n${untracked}` : '')
  );
}

const versionAt = (revision) => {
  const text = tryGit('show', `${revision}:package.json`);
  return text === undefined ? undefined : JSON.parse(text).version;
};

if (tryGit('symbolic-ref', '--short', '-q', 'HEAD') === 'main') {
  const committed = versionAt('HEAD');
  const staged = JSON.parse(readFileSync('package.json', 'utf8')).version;
  if (committed !== undefined && staged === committed) {
    console.log(`[pre-commit] main: bumping patch version from ${committed}`);
    if (!run(['version', 'patch', '--no-git-tag-version', '--ignore-scripts'])) {
      fail('npm version patch failed.');
    }
    git('add', 'package.json', 'package-lock.json');
    if (mergeMode) {
      const bumped = JSON.parse(readFileSync('package.json', 'utf8')).version;
      fail(
        `Version bumped to ${bumped} and staged. Run \`git commit\` to complete the ` +
          'merge; the full verification gate runs then.'
      );
    }
  } else {
    console.log(`[pre-commit] main: version already changed to ${staged}; not bumping`);
  }
}

console.log('[pre-commit] running the full verification gate (npm run check)');
if (!run(['run', 'check'])) {
  fail('npm run check failed. Fix the failure and commit again; do not use --no-verify.');
}
