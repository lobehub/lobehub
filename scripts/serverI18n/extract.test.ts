import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import ts from 'typescript';
import { afterEach, describe, expect, it } from 'vitest';

import { assertBoundedTranslationUses, extractTranslationUses, selectKeys } from './extract';

const directories: string[] = [];
const extract = async (code: string) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'server-i18n-'));
  directories.push(directory);
  const file = path.join(directory, 'entry.ts');
  await writeFile(
    file,
    `type T<N extends string> = ((key: string) => string) & { __serverNamespace?: N };\ndeclare const t: T<'chat'>;\n${code}`,
  );
  return extractTranslationUses(ts.createProgram([file], { strict: true, noLib: true }), [file]);
};
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe('server translation extraction', () => {
  it('keeps literal aliases and finite unions', async () => {
    const uses = await extract(
      "const alias = t; alias('one'); declare const key: 'two' | 'three'; t(key);",
    );
    expect(uses.flatMap((use) => use.patterns)).toEqual(['one', 'two', 'three']);
  });
  it('retains all matching template keys without retaining another prefix', async () => {
    const uses = await extract(
      'declare const code: string; const key = `response.${code}`; t(key);',
    );
    expect(selectKeys(['response.401', 'response.500', 'other.401'], uses[0].patterns)).toEqual([
      'response.401',
      'response.500',
    ]);
  });
  it('retains template suffixes and the namespace of a passed translator', async () => {
    const uses = await extract(
      'function render(copy: T<"home">, kind: string) { copy(`brief.${kind}.title`); }',
    );
    expect(uses[0].namespace).toBe('home');
    expect(
      selectKeys(['brief.a.title', 'brief.b.title', 'brief.b.body'], uses[0].patterns),
    ).toEqual(['brief.a.title', 'brief.b.title']);
  });
  it('requires explicit registration before retaining an entire namespace for an open string', async () => {
    const uses = await extract('declare const code: string; t(code);');
    expect(uses[0].patterns).toEqual(['.*']);
    expect(() => assertBoundedTranslationUses(uses, [])).toThrow(
      'unbounded dynamic translation key',
    );
    expect(() =>
      assertBoundedTranslationUses(uses, [
        { file: uses[0].file, namespace: 'chat', reason: 'External error codes' },
      ]),
    ).not.toThrow();
    expect(() =>
      assertBoundedTranslationUses(uses, [
        { file: uses[0].file, namespace: 'home', reason: 'Another catalog' },
      ]),
    ).toThrow('unbounded dynamic translation key');
  });
  it('rejects opaque dynamic keys instead of silently omitting them', async () => {
    await expect(extract('declare const key: any; t(key);')).rejects.toThrow(
      'Cannot statically classify translation key',
    );
  });
  it('rejects an unresolved namespace', async () => {
    await expect(extract('declare const copy: T<string>; copy("key");')).rejects.toThrow(
      'Unknown server translation namespace',
    );
  });
});

it('rejects losing namespace identity through a callback signature', async () => {
  await expect(
    extract('function forward(copy: (key: string) => string) { copy("lost"); } forward(t);'),
  ).rejects.toThrow('namespace erased');
});

it('preserves optional translators selected with a fallback', async () => {
  const uses = await extract(
    'declare const supplied: T<"chat"> | undefined; const copy = supplied ?? t; copy("title");',
  );
  expect(uses[0].patterns).toEqual(['title']);
});

it('bounds an opaque interpolation by its fixed prefix', async () => {
  const uses = await extract('declare const key: unknown; t(`response.${key}`);');
  expect(selectKeys(['response.401', 'title'], uses[0].patterns)).toEqual(['response.401']);
});

it('rejects erasing a translator inside an object', async () => {
  await expect(
    extract(
      'declare const bundle: { t: T<"chat"> }; const hidden: { t: (key: string) => string } = bundle; hidden.t("lost");',
    ),
  ).rejects.toThrow('namespace erased');
});

it('allows inferred destructuring and dropping an unused translation method', async () => {
  const uses = await extract(
    'declare const bundle: { t: T<"chat">; find: T<"chat"> }; const { t: copy } = bundle; copy("one"); const {t: other}: {t: T<"chat">} = bundle; other("two");',
  );
  expect(uses.flatMap((use) => use.patterns)).toEqual(['one', 'two']);
});
