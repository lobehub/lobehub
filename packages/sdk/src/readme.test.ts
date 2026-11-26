import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { LobeHub } from './generated/sdk.gen';

const methodsOf = (instance: object) =>
  Object.getOwnPropertyNames(Object.getPrototypeOf(instance))
    .filter((name) => name !== 'constructor')
    .sort();

/** `resource → methods` of the generated SDK, read off the class itself. */
const generatedResources = () => {
  const root = new LobeHub();
  const getters = Object.entries(Object.getOwnPropertyDescriptors(LobeHub.prototype))
    .filter(([, descriptor]) => descriptor.get)
    .map(([name]) => name);
  return Object.fromEntries(
    getters.map((name) => [name, methodsOf((root as unknown as Record<string, object>)[name])]),
  );
};

/** `resource → methods` from the README's Resources table. */
const documentedResources = () => {
  const readme = readFileSync(path.join(import.meta.dirname, '..', 'README.md'), 'utf8');
  // Cells are padded by the markdown formatter.
  const rows = [...readme.matchAll(/^\|\s*`(\w+)`\s*\|(.+)\|$/gm)];
  return Object.fromEntries(
    rows.map(([, resource, methods]) => [
      resource,
      [...methods.matchAll(/`(\w+)`/g)].map(([, method]) => method).sort(),
    ]),
  );
};

describe('README', () => {
  it('lists every generated resource and method in its Resources table', () => {
    const generated = generatedResources();
    expect(Object.keys(generated).length).toBeGreaterThanOrEqual(28);
    expect(documentedResources()).toEqual(generated);
  });
});
