/**
 * Verify: is public/ in sync with content/?
 *
 * The generated files are committed to the repository so that Cloudflare can
 * deploy without running a build step. That only stays honest if every commit
 * that touches content/ also carries the regenerated output. This script
 * rebuilds in memory, compares against what is on disk and fails when the two
 * disagree — in CI, and for anyone who edits Markdown by hand and forgets to
 * run `npm run build`.
 *
 * Usage: node build/verify.mjs [--quiet]
 * Exit code 0 when in sync, 1 when out of sync or the build fails.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { buildOutputs } from './build.mjs';

/** Compare an in-memory build against the files on disk. Pure, writes nothing. */
export function verifySync(rootDir = '.') {
  const root = resolve(rootDir);
  const { outputs, summary } = buildOutputs(root);

  const missing = [];
  const differing = [];
  const upToDate = [];

  for (const [path, expected] of [...outputs.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const absolute = join(root, path);
    if (!existsSync(absolute)) {
      missing.push(path);
      continue;
    }
    if (readFileSync(absolute, 'utf8') === expected) upToDate.push(path);
    else differing.push(path);
  }

  const inSync = missing.length === 0 && differing.length === 0;
  return { outputs, summary, missing, differing, upToDate, inSync };
}

function main() {
  const quiet = process.argv.includes('--quiet');
  const root = process.argv[2] && !process.argv[2].startsWith('-') ? resolve(process.argv[2]) : process.cwd();
  const result = verifySync(root);

  if (!quiet) {
    console.log('NoCode Blueprint sync check');
    console.log(`  content       ${result.summary.posts} published posts, ${result.summary.pages} pages`);
    console.log(`  generated     ${result.outputs.size} files`);
    console.log(`  on disk       ${result.upToDate.length} up to date, ${result.differing.length} differing, ${result.missing.length} missing`);
  }

  for (const path of result.missing) console.log(`  missing   ${path}`);
  for (const path of result.differing) console.log(`  stale     ${path}`);

  if (result.inSync) {
    if (!quiet) console.log('  public/ is in sync with content/\n');
    return 0;
  }

  console.log('\n  public/ does not match content/. Run `npm run build` and commit the result.\n');
  return 1;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname)) {
  try {
    process.exit(main());
  } catch (error) {
    console.error(`\nVerify failed: ${error.message}\n`);
    if (error.file) console.error(`  in ${error.file}\n`);
    if (process.env.BUILD_DEBUG) console.error(error.stack);
    process.exit(1);
  }
}
