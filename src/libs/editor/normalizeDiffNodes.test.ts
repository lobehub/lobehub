import { describe, expect, it } from 'vitest';

import { normalizeEditorDataDiffNodes } from './normalizeDiffNodes';

describe('normalizeEditorDataDiffNodes', () => {
  it('should replace block diff nodes with their origin content', () => {
    const editorData = {
      root: {
        children: [
          {
            children: [
              { text: 'before', type: 'text' },
              { text: 'after', type: 'text' },
            ],
            diffType: 'modify',
            type: 'diff',
          },
          {
            children: [{ children: [{ text: 'new', type: 'text' }], type: 'paragraph' }],
            diffType: 'add',
            type: 'diff',
          },
          {
            children: [{ children: [{ text: 'deleted', type: 'text' }], type: 'paragraph' }],
            diffType: 'remove',
            type: 'diff',
          },
        ],
        type: 'root',
      },
    };

    expect(normalizeEditorDataDiffNodes(editorData)).toEqual({
      root: {
        children: [
          { text: 'before', type: 'text' },
          { children: [{ text: 'deleted', type: 'text' }], type: 'paragraph' },
        ],
        type: 'root',
      },
    });
  });

  it('should flatten list item diff nodes to the rejected list item state', () => {
    const editorData = {
      root: {
        children: [
          {
            children: [
              {
                children: [
                  {
                    children: [
                      { children: [{ text: 'origin item', type: 'text' }], type: 'listitem' },
                      { children: [{ text: 'modified item', type: 'text' }], type: 'listitem' },
                    ],
                    diffType: 'listItemModify',
                    type: 'diff',
                  },
                ],
                type: 'listitem',
              },
              {
                children: [
                  {
                    children: [{ text: 'removed item', type: 'text' }],
                    diffType: 'listItemRemove',
                    type: 'diff',
                  },
                ],
                type: 'listitem',
              },
              {
                children: [
                  {
                    children: [{ text: 'added item', type: 'text' }],
                    diffType: 'listItemAdd',
                    type: 'diff',
                  },
                ],
                type: 'listitem',
              },
            ],
            type: 'list',
          },
        ],
        type: 'root',
      },
    };

    expect(normalizeEditorDataDiffNodes(editorData)).toEqual({
      root: {
        children: [
          {
            children: [
              {
                children: [{ text: 'origin item', type: 'text' }],
                type: 'listitem',
              },
              {
                children: [{ text: 'removed item', type: 'text' }],
                type: 'listitem',
              },
              {
                children: [],
                type: 'listitem',
              },
            ],
            type: 'list',
          },
        ],
        type: 'root',
      },
    });
  });

  it('should recursively normalize nested diff nodes without mutating the input', () => {
    const editorData = {
      root: {
        children: [
          {
            children: [
              {
                children: [
                  { children: [{ text: 'nested origin', type: 'text' }], type: 'paragraph' },
                  { children: [{ text: 'nested modified', type: 'text' }], type: 'paragraph' },
                ],
                diffType: 'modify',
                type: 'diff',
              },
            ],
            diffType: 'remove',
            type: 'diff',
          },
        ],
        type: 'root',
      },
    };
    const original = structuredClone(editorData);

    expect(normalizeEditorDataDiffNodes(editorData)).toEqual({
      root: {
        children: [
          {
            children: [{ text: 'nested origin', type: 'text' }],
            type: 'paragraph',
          },
        ],
        type: 'root',
      },
    });
    expect(editorData).toEqual(original);
  });
});
