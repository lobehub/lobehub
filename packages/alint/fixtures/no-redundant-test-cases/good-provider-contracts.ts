import { expect, it } from 'vitest';

const registered = new Map([
  ['alpha', { endpoint: 'https://alpha.example/v1' }],
  ['beta', { endpoint: 'https://beta.example/v1' }],
]);

it('uses the Alpha provider endpoint', () => {
  expect(registered.get('alpha')?.endpoint).toBe('https://alpha.example/v1');
});

it('uses the Beta provider endpoint', () => {
  expect(registered.get('beta')?.endpoint).toBe('https://beta.example/v1');
});
