import { describe, expect, it } from 'vitest';

import type { JsonPatchDelta } from './json';
import { applyJsonPatch, createJsonPatch } from './json';

const createTextNode = (id: string, text: string) => ({
  detail: 0,
  format: 0,
  id,
  mode: 'normal',
  style: '',
  text,
  type: 'text',
  version: 1,
});

const createParagraphNode = (id: string, text?: string) => ({
  children: text ? [createTextNode(`${id}-text`, text)] : [],
  direction: null,
  format: 'start',
  id,
  indent: 0,
  textFormat: 0,
  textStyle: '',
  type: 'paragraph',
  version: 1,
});

const expectJsonPatch = (patch: JsonPatchDelta | undefined): JsonPatchDelta => {
  expect(patch).toBeDefined();

  return patch!;
};

describe('json diff', () => {
  it('should emit an array delta for semantically matched deletions', () => {
    const base = {
      root: {
        children: [
          createParagraphNode('1'),
          createParagraphNode('2'),
          createParagraphNode('3', 'tail'),
        ],
      },
    };
    const current = {
      root: {
        children: [createParagraphNode('1'), createParagraphNode('3', 'tail')],
      },
    };

    const patch = expectJsonPatch(createJsonPatch(base, current));

    expect(patch).toEqual({
      root: {
        children: {
          _1: [createParagraphNode('2'), 0, 0],
          _t: 'a',
        },
      },
    });
    expect(applyJsonPatch(base, patch)).toEqual(current);
  });

  it('should emit an array delta for semantically matched insertions', () => {
    const base = {
      root: {
        children: [createParagraphNode('1'), createParagraphNode('3', 'tail')],
      },
    };
    const current = {
      root: {
        children: [
          createParagraphNode('1'),
          createParagraphNode('2'),
          createParagraphNode('3', 'tail'),
        ],
      },
    };

    const patch = expectJsonPatch(createJsonPatch(base, current));

    expect(patch).toEqual({
      root: {
        children: {
          1: [createParagraphNode('2')],
          _t: 'a',
        },
      },
    });
    expect(applyJsonPatch(base, patch)).toEqual(current);
  });

  it('should align rekeyed lexical nodes without degrading into array removals', () => {
    const base = {
      root: {
        children: [
          createParagraphNode('p-1', 'alpha'),
          createParagraphNode('p-2', 'beta'),
          createParagraphNode('p-3', 'gamma'),
        ],
      },
    };
    const current = {
      root: {
        children: [
          createParagraphNode('next-1', 'alpha'),
          createParagraphNode('next-2', 'beta updated'),
          createParagraphNode('next-3', 'gamma'),
        ],
      },
    };

    const patch = expectJsonPatch(createJsonPatch(base, current));
    const childDelta = (patch as Record<string, any>).root.children as Record<string, unknown>;

    expect(childDelta._t).toBe('a');
    expect(Object.keys(childDelta).filter((key) => key.startsWith('_') && key !== '_t')).toEqual(
      [],
    );
    expect(applyJsonPatch(base, patch)).toEqual(current);
  });

  it('should return undefined when two documents are identical', () => {
    const document = {
      root: {
        children: [createParagraphNode('1', 'alpha')],
      },
    };

    expect(createJsonPatch(document, document)).toBeUndefined();
  });
});
