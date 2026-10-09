/**
 * Minimal test harness shared by build/check.mjs and build/test/run.mjs.
 *
 * Deliberately tiny: the repository has no dependencies, and the CI gate must
 * run on a bare Node install. Groups keep the output readable and the exit
 * code is non-zero as soon as one assertion fails.
 */

const RESET = '\x1b[0m';
const RED = '\x1b[31m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const DIM = '\x1b[2m';
const BOLD = '\x1b[1m';

const colorize = process.stdout.isTTY && !process.env.NO_COLOR;
const paint = (code, text) => (colorize ? `${code}${text}${RESET}` : text);

export class Suite {
  constructor(title) {
    this.title = title;
    this.groups = [];
    this.current = null;
    this.failures = 0;
    this.assertions = 0;
  }

  group(name) {
    this.current = { name, checks: [] };
    this.groups.push(this.current);
    return this;
  }

  #record(name, passed, detail) {
    this.assertions += 1;
    if (!passed) this.failures += 1;
    if (this.current === null) this.group('general');
    this.current.checks.push({ name, passed, detail });
  }

  ok(name, condition, detail = '') {
    this.#record(name, Boolean(condition), condition ? '' : detail);
    return Boolean(condition);
  }

  equal(name, actual, expected) {
    const passed = actual === expected;
    this.#record(name, passed, passed ? '' : `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
    return passed;
  }

  match(name, value, pattern) {
    const passed = pattern.test(String(value));
    this.#record(name, passed, passed ? '' : `${JSON.stringify(String(value).slice(0, 200))} does not match ${pattern}`);
    return passed;
  }

  /** Run `fn`; the check passes when it does not throw. */
  noThrow(name, fn) {
    try {
      fn();
      this.#record(name, true, '');
      return true;
    } catch (error) {
      this.#record(name, false, error.message);
      return false;
    }
  }

  /** Run `fn`; the check passes when it throws. Returns the error, or null. */
  throws(name, fn, expectedMessage) {
    try {
      fn();
      this.#record(name, false, 'expected an error but none was thrown');
      return null;
    } catch (error) {
      const passed = expectedMessage === undefined || error.message.includes(expectedMessage);
      this.#record(name, passed, passed ? '' : `error was "${error.message}", expected it to include "${expectedMessage}"`);
      return error;
    }
  }

  report() {
    console.log(`\n${paint(BOLD, this.title)}`);
    for (const group of this.groups) {
      const failed = group.checks.filter((check) => !check.passed);
      const mark = failed.length === 0 ? paint(GREEN, '✓') : paint(RED, '✗');
      console.log(`  ${mark} ${group.name} ${paint(DIM, `(${group.checks.length - failed.length}/${group.checks.length})`)}`);
      for (const check of failed) {
        console.log(`      ${paint(RED, '✗')} ${check.name}`);
        if (check.detail) {
          for (const line of String(check.detail).split('\n').slice(0, 6)) {
            console.log(`        ${paint(DIM, line)}`);
          }
        }
      }
    }
    const summary = this.failures === 0
      ? paint(GREEN, `passed`)
      : paint(RED, `${this.failures} failed`);
    console.log(`\n  ${this.assertions} assertions, ${summary}\n`);
    return this.failures === 0;
  }
}

export function warn(message) {
  console.log(`  ${paint(YELLOW, '!')} ${message}`);
}

export { paint, RED, GREEN, YELLOW, DIM, BOLD, RESET };
