// Points git at the repository's tracked hooks. Runs from the npm `prepare` script,
// so it does nothing outside a git checkout (for example, in an extracted package).
import {spawnSync} from 'node:child_process';

const inRepository =
  spawnSync('git', ['rev-parse', '--is-inside-work-tree'], {stdio: 'ignore'}).status === 0;
if (inRepository) {
  spawnSync('git', ['config', 'core.hooksPath', '.githooks'], {stdio: 'inherit'});
}
