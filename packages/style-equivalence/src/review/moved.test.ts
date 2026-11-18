import { describe, expect, it } from 'vitest';

import { declarationBlocks } from './declarations';
import { movedRules } from './moved';

const baseTable = `table: css\`
    border-collapse: collapse;
    width: 100%;

    th,
    td {
      padding-block: 8px;
      border-block-end: 1px solid \${cssVar.colorBorderSecondary};
    }

    th {
      font-size: 11px;
    }

    td {
      font-size: 12px;
    }
  \``;

const headTexts = {
  'styles.cell': `cell: { paddingBlock: '8px', borderBlockEndWidth: '1px', borderBlockEndStyle: 'solid', borderBlockEndColor: cssVar.colorBorderSecondary }`,
  'styles.table': `table: { borderCollapse: 'collapse', width: '100%' }`,
  'styles.td': `td: { fontSize: '12px' }`,
  'styles.th': `th: { fontSize: '11px' }`,
};

const headElements = [
  { id: 'scroll', slots: ['styles.tableScroll'], tag: 'div' },
  { id: 'table', parent: 'scroll', slots: ['styles.table'], tag: 'table' },
  { id: 'th', parent: 'table', slots: ['styles.cell', 'styles.th'], tag: 'th' },
  { id: 'td', parent: 'table', slots: ['styles.cell', 'styles.td'], tag: 'td' },
  { id: 'other', slots: ['styles.cell'], tag: 'td' },
];

const input = {
  base: { declarations: { 'styles.table': baseTable } },
  head: {
    chain: [headElements[0], headElements[1]],
    elements: headElements,
    texts: headTexts,
  },
};

describe('movedRules', () => {
  it('finds the head descendants that now carry a base descendant rule', () => {
    const moved = movedRules(input)['styles.table'];

    expect(moved.map(({ selector, slot, targets }) => ({ selector, slot, targets }))).toEqual([
      { selector: 'th, td', slot: 'styles.cell', targets: ['th', 'td'] },
      { selector: 'th', slot: 'styles.th', targets: ['th'] },
      { selector: 'td', slot: 'styles.td', targets: ['td'] },
    ]);
    expect(moved.find((entry) => entry.slot === 'styles.th')?.text).toBe(headTexts['styles.th']);
  });

  it('skips a child slot the base already used', () => {
    const moved = movedRules({
      ...input,
      base: { ...input.base, slots: ['styles.td'] },
    })['styles.table'];

    expect(moved.some((entry) => entry.slot === 'styles.td')).toBe(false);
  });

  it('matches an attribute selector against literal attributes', () => {
    const moved = movedRules({
      base: {
        declarations: {
          'styles.tabs': `tabs: css\`
    [role='tablist'] {
      width: 100%;
    }
  \``,
        },
      },
      head: {
        chain: [{ id: 'tabs', slots: ['styles.tabs'], tag: 'div' }],
        elements: [
          { id: 'tabs', slots: ['styles.tabs'], tag: 'div' },
          {
            attributes: { role: 'tablist' },
            id: 'list',
            parent: 'tabs',
            slots: ['styles.list'],
            tag: 'div',
          },
        ],
        texts: { 'styles.list': `list: { width: '100%' }` },
      },
    });

    expect(moved['styles.tabs'].map((entry) => entry.slot)).toEqual(['styles.list']);
  });

  it('leaves class-only and self selectors alone', () => {
    const moved = movedRules({
      base: {
        declarations: {
          'styles.row': `row: css\`
    &:hover {
      color: red;
    }

    &[data-active] {
      color: green;
    }

    & + & {
      margin-top: 4px;
    }

    .title {
      color: blue;
    }
  \``,
        },
      },
      head: {
        chain: [{ id: 'row', slots: ['styles.row'], tag: 'div' }],
        elements: [
          { id: 'row', slots: ['styles.row'], tag: 'div' },
          { id: 'title', parent: 'row', slots: ['styles.title'], tag: 'span' },
        ],
        texts: { 'styles.title': `title: { color: 'blue' }` },
      },
    });

    expect(moved['styles.row'] ?? []).toEqual([]);
  });

  it('follows a descendant written after the nesting selector', () => {
    const moved = movedRules({
      base: {
        declarations: {
          'styles.row': `row: css\`
    &:hover > span {
      color: red;
    }
  \``,
        },
      },
      head: {
        chain: [{ id: 'row', slots: ['styles.row'], tag: 'div' }],
        elements: [
          { id: 'row', slots: ['styles.row'], tag: 'div' },
          { id: 'title', parent: 'row', slots: ['styles.title'], tag: 'span' },
        ],
        texts: { 'styles.title': `title: { color: { default: null, ':hover': 'red' } }` },
      },
    });

    expect(moved['styles.row']?.map((entry) => entry.slot)).toEqual(['styles.title']);
  });
});

describe('declarationBlocks with moved rules', () => {
  it('fills a descendant row from the child that now carries it', () => {
    const [block] = declarationBlocks(
      { 'styles.table': baseTable },
      { 'styles.table': headTexts['styles.table'] },
      [],
      movedRules(input),
    );
    const row = (label: string) => block.rows.find((entry) => entry.label === label);

    expect(row('th, td padding')).toMatchObject({
      after: ['padding-block: 8px'],
      before: ['padding-block: 8px'],
      movedTo: ['<th> <td> · styles.cell'],
      oneSided: false,
    });
    expect(row('th font-size')).toMatchObject({
      after: ['font-size: 11px'],
      movedTo: ['<th> · styles.th'],
    });
    expect(row('td font-size')?.after).toEqual(['font-size: 12px']);
    expect(row('th, td font-size')).toBeUndefined();
    expect(row('th, td border')?.after).toEqual([
      'border-block-end-width: 1px',
      'border-block-end-style: solid',
      'border-block-end-color: colorBorderSecondary',
    ]);
  });
});
