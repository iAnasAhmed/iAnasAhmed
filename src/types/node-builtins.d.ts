/**
 * Minimal ambient declarations for the Node built-ins this project uses.
 *
 * The project's hard rule is that `npm run check` and `npm test` work with zero
 * `npm install` (CLAUDE.md §2). @types/node would break that, so we declare the
 * handful of surfaces we actually touch. If you install @types/node later,
 * delete this file — it exists only to keep the toolchain dependency-free.
 */

declare module 'node:test' {
  export interface TestContext {
    readonly name: string;
  }
  type TestFn = (t: TestContext) => void | Promise<void>;
  export function test(name: string, fn: TestFn): void;
  export function describe(name: string, fn: () => void): void;
  export function it(name: string, fn: TestFn): void;
}

declare module 'node:assert/strict' {
  interface Assert {
    (value: unknown, message?: string): asserts value;
    equal(actual: unknown, expected: unknown, message?: string): void;
    notEqual(actual: unknown, expected: unknown, message?: string): void;
    deepEqual(actual: unknown, expected: unknown, message?: string): void;
    ok(value: unknown, message?: string): asserts value;
    throws(fn: () => unknown, message?: string | RegExp | ErrorConstructor): void;
    doesNotThrow(fn: () => unknown, message?: string): void;
    fail(message?: string): never;
  }
  const assert: Assert;
  export default assert;
}
