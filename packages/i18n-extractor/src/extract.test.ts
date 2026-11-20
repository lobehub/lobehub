import path from 'node:path';

import ts from 'typescript';
import { describe, expect, it } from 'vitest';

import type { ExtractTranslationUsesOptions } from './extract';
import {
  assertBoundedTranslationUses,
  extractTranslationUses,
  i18nextPreset,
  selectKeys,
} from './extract';
import { createFixture, translatorType } from './testUtils';

const extract = async (code: string, options?: ExtractTranslationUsesOptions) => {
  const root = await createFixture({
    'entry.ts': `${translatorType}\ndeclare const t: T<'chat'>;\n${code}`,
  });
  const file = path.join(root, 'entry.ts');
  return extractTranslationUses(
    ts.createProgram([file], { noLib: true, strict: true }),
    [file],
    options,
  );
};

describe('extractTranslationUses', () => {
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

  it('expands template literal key types', async () => {
    const uses = await extract(
      "declare const level: 'low' | 'high'; declare const key: `level.${typeof level}`; t(key);",
    );
    expect(selectKeys(['level.low', 'level.high', 'level.mid'], uses[0].patterns)).toEqual([
      'level.high',
      'level.low',
    ]);
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
      'unknown translation namespace',
    );
  });

  it('records each namespace of a union-branded translator', async () => {
    const uses = await extract('declare const copy: T<"chat" | "home">; copy("title");');
    expect(uses.map((use) => use.namespace)).toEqual(['chat', 'home']);
  });

  it('rejects losing namespace identity through a callback signature', async () => {
    await expect(
      extract('function forward(copy: (key: string) => string) { copy("lost"); } forward(t);'),
    ).rejects.toThrow('namespace erased');
  });

  it('rejects erasing a translator inside an object', async () => {
    await expect(
      extract(
        'declare const bundle: { t: T<"chat"> }; const hidden: { t: (key: string) => string } = bundle; hidden.t("lost");',
      ),
    ).rejects.toThrow('namespace erased');
  });

  it('rejects indirect calls that bypass the typed call site', async () => {
    await expect(extract('t.call(undefined, "lost");')).rejects.toThrow(
      'Unsupported indirect translation call',
    );
  });

  it('preserves optional translators selected with a fallback', async () => {
    const uses = await extract(
      'declare const supplied: T<"chat"> | undefined; const copy = supplied ?? t; copy("title");',
    );
    expect(uses[0].patterns).toEqual(['title']);
  });

  it('marks calls whose result may be undefined as optional', async () => {
    const uses = await extract(
      'declare const find: ((key: string) => string | undefined) & { __i18nNamespace?: "chat" }; find("maybe"); t("always");',
    );
    expect(uses.map((use) => use.optional)).toEqual([true, false]);
  });

  it('bounds an opaque interpolation by its fixed prefix', async () => {
    const uses = await extract('declare const key: unknown; t(`response.${key}`);');
    expect(selectKeys(['response.401', 'title'], uses[0].patterns)).toEqual(['response.401']);
  });

  it('allows inferred destructuring and dropping an unused translation method', async () => {
    const uses = await extract(
      'declare const bundle: { t: T<"chat">; find: T<"chat"> }; const { t: copy } = bundle; copy("one"); const {t: other}: {t: T<"chat">} = bundle; other("two");',
    );
    expect(uses.flatMap((use) => use.patterns)).toEqual(['one', 'two']);
  });

  it('supports a custom marker and translator fields', async () => {
    const root = await createFixture({
      'entry.ts':
        'type M<N extends string> = ((key: string) => string) & { __ns?: N }; declare const bundle: { tr: M<"app"> }; const hidden: { tr: (key: string) => string } = bundle;',
    });
    const file = path.join(root, 'entry.ts');
    const program = ts.createProgram([file], { noLib: true, strict: true });
    expect(() => extractTranslationUses(program, [file], { marker: '__ns' })).not.toThrow();
    expect(() =>
      extractTranslationUses(program, [file], { marker: '__ns', translatorFields: ['tr'] }),
    ).toThrow('preserve the __ns marker');
  });

  it('skips files that implement the translator', async () => {
    const uses = await extract('declare const code: any; t(code);', { skip: () => true });
    expect(uses).toEqual([]);
  });

  it('stringifies nullish interpolation members like JavaScript does', async () => {
    const uses = await extract(
      "declare const reason: 'safety' | undefined | null; t(`block.${reason}`);",
    );
    expect(
      selectKeys(
        ['block.safety', 'block.undefined', 'block.null', 'block.other'],
        uses[0].patterns,
      ),
    ).toEqual(['block.null', 'block.safety', 'block.undefined']);
  });

  it('keeps flow narrowing instead of widening through a computed initializer', async () => {
    const uses = await extract(
      'declare function read(): string | undefined; const reason = read(); if (reason) t(`block.${reason}`);',
    );
    expect(uses[0].patterns).toEqual(['block\\..*']);
  });

  it('analyzes the expression under a type assertion', async () => {
    const uses = await extract(
      "declare const id: 'done' | 'todo'; t(`group.${id}` as any); t(('plain') as string); t('bang'!);",
    );
    expect(uses.map((use) => use.patterns)).toEqual([
      ['group\\.done', 'group\\.todo'],
      ['plain'],
      ['bang'],
    ]);
  });

  it('still rejects an opaque key behind a type assertion', async () => {
    await expect(extract('declare const key: any; t(key as string);')).rejects.toThrow(
      'Cannot statically classify translation key',
    );
  });

  it('reads the namespace from a configured option', async () => {
    const uses = await extract(
      "declare const ns: 'error' | 'topic'; declare const options: { ns: 'common' }; t('a', { ns: 'home' }); t('b', { ns }); t('c', options); t('d', {});",
      { namespaceOption: 'ns' },
    );
    expect(uses.map((use) => `${use.namespace}:${use.patterns.join('|')}`)).toEqual([
      'home:a',
      'error:b',
      'topic:b',
      'common:c',
      'chat:d',
    ]);
  });

  it('keeps the branded namespace when the option may be omitted', async () => {
    const uses = await extract("declare const options: { ns?: 'home' }; t('a', options);", {
      namespaceOption: 'ns',
    });
    expect(uses.map((use) => use.namespace)).toEqual(['home', 'chat']);
  });

  it('rejects an open namespace option', async () => {
    await expect(
      extract("declare const ns: string; t('a', { ns });", { namespaceOption: 'ns' }),
    ).rejects.toThrow('unknown translation namespace');
  });

  it('ignores the namespace option unless configured', async () => {
    const uses = await extract("t('a', { ns: 'home' });");
    expect(uses[0].namespace).toBe('chat');
  });

  it('splits a namespace prefix from the key', async () => {
    const uses = await extract(
      "declare const code: 'A' | 'B'; t('home:title'); t(`runtime:${code}`); t('plain');",
      { namespaceSeparator: ':' },
    );
    expect(uses.map((use) => `${use.namespace}|${use.patterns.join(',')}`)).toEqual([
      'home|title',
      'runtime|A,B',
      'chat|plain',
    ]);
  });

  it('keeps a prefixed key in the branded namespace unless a separator is configured', async () => {
    const uses = await extract("t('home:title');");
    expect(uses[0]).toMatchObject({ namespace: 'chat', patterns: ['home:title'] });
  });

  it('treats a translator listed in an unknown-typed array as a reference', async () => {
    const root = await createFixture({
      'entry.ts': `${translatorType}\ndeclare const t: T<'chat'>;\ndeclare function useMemo<V>(factory: () => V, deps: readonly unknown[]): V;\nuseMemo(() => t('memo'), [t]);`,
    });
    const file = path.join(root, 'entry.ts');
    const uses = extractTranslationUses(ts.createProgram([file], { strict: true }), [file]);
    expect(uses.flatMap((use) => use.patterns)).toEqual(['memo']);
  });

  it('still rejects passing a translator to an unknown parameter', async () => {
    await expect(extract('declare function sink(value: unknown): void; sink(t);')).rejects.toThrow(
      'namespace erased',
    );
  });

  it('retains plural suffixes when a count option is passed', async () => {
    const uses = await extract(
      "declare const count: number; declare const options: { count?: number }; t('views', { count }); t('items', options); t('plain', {});",
      { countOption: 'count' },
    );
    const keys = [
      'items_one',
      'plain',
      'plain_one',
      'views',
      'views_few',
      'views_one',
      'views_ordinal_two',
      'views_other',
      'views_total',
    ];
    expect(uses.map((use) => selectKeys(keys, use.patterns))).toEqual([
      ['views', 'views_few', 'views_one', 'views_ordinal_two', 'views_other'],
      ['items_one'],
      ['plain'],
    ]);
  });

  it('does not treat a string count as plural', async () => {
    const uses = await extract("t('views', { count: '3' });", { countOption: 'count' });
    expect(selectKeys(['views', 'views_other'], uses[0].patterns)).toEqual(['views']);
  });

  it('retains context suffixes, alone and combined with plurals', async () => {
    const uses = await extract(
      "declare const gender: 'male' | 'female' | undefined; declare const count: number; t('friend', { context: gender, count }); t('label', { context: 'short' });",
      { contextOption: 'context', countOption: 'count' },
    );
    const keys = [
      'friend',
      'friend_female_one',
      'friend_male',
      'friend_other',
      'friend_robot',
      'label',
      'label_long',
      'label_short',
    ];
    expect(uses.map((use) => selectKeys(keys, use.patterns))).toEqual([
      ['friend', 'friend_female_one', 'friend_male', 'friend_other'],
      ['label', 'label_short'],
    ]);
  });

  it('bounds an open context by the key prefix', async () => {
    const uses = await extract("declare const kind: string; t('label', { context: kind });", {
      contextOption: 'context',
    });
    expect(selectKeys(['label', 'label_any', 'other'], uses[0].patterns)).toEqual([
      'label',
      'label_any',
    ]);
  });

  it('keeps plural suffixes on namespace-prefixed keys', async () => {
    const uses = await extract("t('error:retry', { count: 2 });", {
      countOption: 'count',
      namespaceSeparator: ':',
    });
    expect(uses[0].namespace).toBe('error');
    expect(selectKeys(['retry_one'], uses[0].patterns)).toEqual(['retry_one']);
  });

  it('extracts i18next-branded translators with the preset', async () => {
    const root = await createFixture({
      'entry.ts':
        "type TFunction<N extends string> = ((key: string, options?: { ns?: string }) => string) & { $TFunctionBrand: N };\ndeclare const t: TFunction<'chat'>;\nt('a'); t('error:b'); t('c', { ns: 'topic' });",
    });
    const file = path.join(root, 'entry.ts');
    const uses = extractTranslationUses(
      ts.createProgram([file], { noLib: true, strict: true }),
      [file],
      i18nextPreset,
    );
    expect(uses.map((use) => `${use.namespace}|${use.patterns.join(',')}`)).toEqual([
      'chat|a',
      'error|b',
      'topic|c',
    ]);
  });
});
