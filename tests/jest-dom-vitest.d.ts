import type { TestingLibraryMatchers } from '@testing-library/jest-dom/matchers';

// Vitest 5 exposes `Assertion<R, T>` (matcher return type, received value) and no longer
// reads the `jest.Matchers` augmentation that `@testing-library/jest-dom` ships, so its
// matchers disappear from the type of `expect(...)`. Re-declare them on the Vitest
// interface until the package supports Vitest 5.
declare module 'vitest' {
  interface Assertion<R = any, T = any> extends TestingLibraryMatchers<any, R> {}

  interface AsymmetricMatchersContaining extends TestingLibraryMatchers<any, any> {}
}
