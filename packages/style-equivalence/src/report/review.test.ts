import { describe, expect, it } from 'vitest';

import {
  cellVerdict,
  completionText,
  conditionName,
  defaultReworkNote,
  describeConditions,
  groupDifferences,
  hasRenderedDifference,
  hasScreenshots,
  keyAction,
  nextOpen,
  nextSelection,
  reviewGrid,
  shotNotes,
  showsAgentNote,
  standInNote,
} from './review';

const item = (key: string, state: string) => ({ key, state });

describe('nextOpen', () => {
  const items = [
    item('a', 'passed'),
    item('b', 'todo'),
    item('c', 'reworked'),
    item('d', 'waiting-agent'),
    item('e', 'changed'),
  ];

  it('moves to the next item that still needs the reviewer', () => {
    expect(nextOpen(items, 'b')).toBe('e');
  });

  it('wraps around and returns undefined when nothing is left', () => {
    expect(nextOpen(items, 'e')).toBe('b');
    expect(nextOpen([item('a', 'passed')], 'a')).toBeUndefined();
  });

  it('starts from the first open item without a current one', () => {
    expect(nextOpen(items, undefined)).toBe('b');
  });
});

describe('nextSelection', () => {
  it('leaves nothing selected once every item is handled, so the completion state shows', () => {
    expect(nextSelection([item('a', 'passed'), item('b', 'reworked')], 'b')).toBeUndefined();
    expect(nextSelection([item('a', 'passed')], undefined)).toBeUndefined();
    expect(nextSelection([item('a', 'passed'), item('b', 'todo')], 'a')).toBe('b');
  });
});

describe('keyAction', () => {
  it('maps J K Y N outside text inputs', () => {
    expect(keyAction('j', false)).toBe('next');
    expect(keyAction('k', false)).toBe('previous');
    expect(keyAction('y', false)).toBe('pass');
    expect(keyAction('n', false)).toBe('rework');
    expect(keyAction('x', false)).toBeUndefined();
  });

  it('ignores every shortcut while the reviewer is typing', () => {
    for (const key of ['j', 'k', 'y', 'n']) expect(keyAction(key, true)).toBeUndefined();
  });

  it('ignores every shortcut while a panel covers the queue', () => {
    for (const key of ['j', 'k', 'y', 'n']) expect(keyAction(key, false, true)).toBeUndefined();
    expect(keyAction('j', false, false)).toBe('next');
  });
});

describe('reviewGrid', () => {
  const conditions = [
    'light/375/default',
    'light/1280/default',
    'light/1280/hover-target',
    'dark/1280/default',
    'dark/375/default',
    'light/1280/default/rtl',
  ];
  const combos = [
    { index: 0, label: 'online：否' },
    { index: 1, label: 'online：是' },
  ];

  it('uses theme columns at the default width and combo rows', () => {
    const grid = reviewGrid(combos, conditions, [
      { combo: 1, condition: 'light/1280/default', summary: ['边框 无 → 1px solid'] },
    ]);
    expect(grid.columns.map((column) => [column.label, column.title])).toEqual([
      ['light/1280/default', '亮色'],
      ['dark/1280/default', '暗色'],
    ]);
    expect(grid.rows[1].cells[0]).toMatchObject({
      differs: true,
      summary: ['边框 无 → 1px solid'],
    });
    expect(grid.rows[0].cells[0].differs).toBe(false);
  });

  it('shows the interaction states of the light theme at the same width', () => {
    const grid = reviewGrid(
      combos,
      [...conditions, 'light/1280/focus-visible', 'dark/1280/hover-target'],
      [{ combo: 0, condition: 'light/1280/focus-visible', summary: ['描边 无 → 2px'] }],
    );
    expect(grid.states.columns.map((column) => [column.label, column.title])).toEqual([
      ['light/1280/hover-target', '鼠标悬停'],
      ['light/1280/focus-visible', '键盘聚焦'],
    ]);
    expect(grid.states.rows[0].cells[1]).toMatchObject({
      differs: true,
      summary: ['描边 无 → 2px'],
    });
    expect(grid.restDifferences).toEqual([]);
  });

  it('counts the other conditions and lists only the ones that differ', () => {
    const grid = reviewGrid(combos, conditions, [
      { combo: 0, condition: 'light/375/default', summary: ['间距 0px → 8px'] },
    ]);
    expect(grid.restCount).toBe(6);
    expect(grid.restDifferences).toEqual([
      {
        combo: 0,
        condition: 'light/375/default',
        label: 'online：否',
        summary: ['间距 0px → 8px'],
      },
    ]);
  });

  it('falls back to the widest width when 1280 is absent', () => {
    const grid = reviewGrid(
      [{ index: 0, label: '默认' }],
      ['light/375/default', 'light/991/default'],
      [],
    );
    expect(grid.columns.map((column) => column.label)).toEqual(['light/991/default']);
  });
});

describe('completionText', () => {
  const counts = (extra: object) => ({
    'changed': 0,
    'passed': 0,
    'reworked': 0,
    'todo': 0,
    'waiting-agent': 0,
    ...extra,
  });

  it('says the PR can merge when nothing is left', () => {
    expect(completionText(counts({ passed: 13 }), { mergeable: true, reasons: [] })).toEqual([
      '全部看完了，可以合并。',
    ]);
  });

  it('counts each send-back once and says who acts next', () => {
    expect(
      completionText(counts({ passed: 12, reworked: 1 }), {
        mergeable: false,
        reasons: ['needs sign-off 1', 'rework open 1'],
      }),
    ).toEqual(['全部看完了。', '1 项已打回，等 agent 改完会回到这里请你复看。']);
  });

  it('turns tool problems into plain sentences', () => {
    expect(
      completionText(counts({ passed: 3 }), {
        mergeable: false,
        reasons: ['mutation not fully caught', 'calibration mismatch 2'],
      }),
    ).toEqual([
      '全部看完了。',
      '工具自检没通过：注入的已知改动没有全部被发现。',
      '工具自检没通过：2 处合成渲染和真实挂载不一致。',
    ]);
  });
});

describe('cellVerdict', () => {
  const key = 'a.tsx|A#0';

  it('says whether the two sides match', () => {
    expect(cellVerdict(key, { differs: false, summary: [] })).toEqual({ text: '一致', tone: 'ok' });
    expect(cellVerdict(key, { differs: true, summary: ['颜色 红 → 蓝'] })).toEqual({
      text: '不一样：颜色 红 → 蓝',
      tone: 'error',
    });
  });

  it('names the only side of a one-sided element instead of claiming a match', () => {
    expect(cellVerdict('a.tsx|unpaired:head:A#2', { differs: false, summary: [] })).toEqual({
      text: '只有改之后，没有可对比的',
      tone: 'neutral',
    });
    expect(cellVerdict('a.tsx|unpaired:base:A#2', { differs: false, summary: [] })).toEqual({
      text: '只有改之前，改之后不见了',
      tone: 'neutral',
    });
  });

  it('points at the unstyled same-position element when the other side has one', () => {
    expect(cellVerdict('a.tsx|unpaired:head:A#2', { differs: false, summary: [] }, 'base')).toEqual(
      { text: '改之前同一位置的元素没有样式类，左右对照看', tone: 'neutral' },
    );
  });
});

describe('standInNote', () => {
  it('says plainly that a screenshot shows a placeholder, naming the component', () => {
    expect(standInNote(['Tabs', 'Select'])).toBe(
      '替身：这里画的是占位块，不是真实组件（Tabs、Select）',
    );
  });

  it('says nothing when the screenshot shows real elements', () => {
    expect(standInNote(undefined)).toBeUndefined();
    expect(standInNote([])).toBeUndefined();
  });
});

describe('shotNotes', () => {
  it('says the inner elements a descendant rule targets are not drawn', () => {
    expect(
      shotNotes(
        { flags: ['INNER_TARGET', 'INNER_TARGET_PARTLY_FORWARDED:h1|A,B'], standIns: {} },
        'head',
      ),
    ).toEqual(['只画了容器本身：规则要命中的 h1 在组件内部，截图里没有']);
    expect(shotNotes({ flags: ['INNER_TARGET'], standIns: {} }, 'base')).toEqual([
      '只画了容器本身：规则要命中的内部元素在组件里，截图里没有',
    ]);
  });

  it('combines a stand-in note with the inner-target note', () => {
    expect(
      shotNotes({ flags: ['INNER_TARGET'], standIns: { base: ['Tabs'] } }, 'base'),
    ).toHaveLength(2);
    expect(shotNotes({ flags: [], standIns: { base: ['Tabs'] } }, 'head')).toEqual([]);
  });
});

describe('hasScreenshots', () => {
  it('shows screenshots for an element but not for a whole-file item or a render failure', () => {
    expect(hasScreenshots({ category: 'needs-signoff', key: 'a.tsx|A#0' })).toBe(true);
    expect(hasScreenshots({ category: 'needs-signoff', key: 'a.tsx|file' })).toBe(false);
    expect(hasScreenshots({ category: 'blocking', key: 'a.tsx|A#0' })).toBe(false);
  });
});

describe('groupDifferences', () => {
  const entry = (condition: string, summary: string, label = '默认') => ({
    combo: 0,
    condition,
    label,
    summary: [summary],
  });

  it('folds conditions that show the same difference into one group, in first-seen order', () => {
    const groups = groupDifferences([
      entry('light/375/default', '颜色 红 → 蓝'),
      entry('dark/375/default', '颜色 黑 → 白'),
      entry('light/575/default', '颜色 红 → 蓝'),
    ]);
    expect(
      groups.map((group) => [group.summary, group.entries.map((item) => item.condition)]),
    ).toEqual([
      [['颜色 红 → 蓝'], ['light/375/default', 'light/575/default']],
      [['颜色 黑 → 白'], ['dark/375/default']],
    ]);
  });

  it('keeps different combos apart even when the difference reads the same', () => {
    const groups = groupDifferences([
      entry('light/375/default', '间距 0 → 8px', 'online：否'),
      entry('light/375/default', '间距 0 → 8px', 'online：是'),
    ]);
    expect(groups).toHaveLength(2);
  });
});

describe('describeConditions', () => {
  it('merges widths that share the same states into one line per theme', () => {
    const labels = ['light/375', 'light/575'].flatMap((prefix) =>
      ['default', 'hover-target'].map((state) => `${prefix}/${state}`),
    );
    expect(describeConditions([...labels, 'dark/375/default'])).toEqual([
      '亮色 · 375、575（默认、hover）',
      '暗色 · 375（默认）',
    ]);
  });

  it('lists widths with different states separately', () => {
    expect(
      describeConditions([
        'light/375/default',
        'light/375/hover-target',
        'light/575/default',
        'light/768/default',
        'light/768/hover-target',
      ]),
    ).toEqual(['亮色 · 375、768（默认、hover）；575（默认）']);
  });

  it('names a single condition for a tag', () => {
    expect(conditionName('dark/1280/focus-visible')).toBe('暗色 1280 focus');
    expect(conditionName('light/1280/default/rtl')).toBe('亮色 1280 RTL');
  });
});

describe('rework reason', () => {
  const view = (overrides: object = {}) => ({
    category: 'needs-signoff',
    comboDifferences: [] as Array<{ combo: number; condition: string; summary: string[] }>,
    combos: [{ index: 0, label: '默认' }],
    differingConditions: [] as string[],
    summary: [] as string[],
    ...overrides,
  });

  it('needs no typed reason only when the item has a rendered difference', () => {
    expect(hasRenderedDifference(view({ category: 'difference' }))).toBe(true);
    expect(hasRenderedDifference(view({ differingConditions: ['light/375/default'] }))).toBe(true);
    expect(hasRenderedDifference(view())).toBe(false);
    expect(hasRenderedDifference(view({ category: 'unpaired' }))).toBe(false);
  });

  it('records a single difference the way the screenshots read', () => {
    const summary = ['文字颜色 rgb(102, 102, 102) → rgb(176, 176, 176)'];
    expect(
      defaultReworkNote(
        view({
          category: 'difference',
          comboDifferences: [{ combo: 0, condition: 'light/1280/default', summary }],
          summary,
        }),
      ),
    ).toBe('不一样：文字颜色 rgb(102, 102, 102) → rgb(176, 176, 176)（亮色 1280 默认）');
  });

  it('counts conditions per distinct difference', () => {
    const light = ['文字颜色 红 → 蓝'];
    const dark = ['文字颜色 黑 → 白'];
    expect(
      defaultReworkNote(
        view({
          category: 'difference',
          comboDifferences: [
            { combo: 0, condition: 'light/375/default', summary: light },
            { combo: 0, condition: 'light/575/default', summary: light },
            { combo: 0, condition: 'dark/375/default', summary: dark },
          ],
        }),
      ),
    ).toBe('不一样：文字颜色 红 → 蓝（2 个条件）；文字颜色 黑 → 白（暗色 375 默认）');
  });

  it('names the combo when the element has several', () => {
    expect(
      defaultReworkNote(
        view({
          category: 'difference',
          comboDifferences: [
            { combo: 1, condition: 'light/1280/default', summary: ['边框 无 → 1px'] },
          ],
          combos: [
            { index: 0, label: 'online：否' },
            { index: 1, label: 'online：是' },
          ],
        }),
      ),
    ).toBe('不一样：online：是 · 边框 无 → 1px（亮色 1280 默认）');
  });

  it('falls back to the case summary and stays empty without a difference', () => {
    expect(defaultReworkNote(view({ category: 'difference', summary: ['间距 0 → 8px'] }))).toBe(
      '不一样：间距 0 → 8px',
    );
    expect(defaultReworkNote(view())).toBe('');
  });
});

describe('showsAgentNote', () => {
  it('shows a written agent note even when the item did not wait for one', () => {
    expect(showsAgentNote({ needsAgent: false, note: { finding: 'x', suggestion: 'pass' } })).toBe(
      true,
    );
  });

  it('asks for an agent note only on an item that waits for one', () => {
    expect(showsAgentNote({ needsAgent: true })).toBe(true);
    expect(showsAgentNote({ needsAgent: false })).toBe(false);
  });

  it('shows only written notes on the case page', () => {
    expect(showsAgentNote({ needsAgent: true }, 'written')).toBe(false);
  });
});
