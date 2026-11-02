import {
  INSERT_ALERT_COMMAND,
  INSERT_CHART_COMMAND,
  INSERT_FOOTNOTE_COMMAND,
  INSERT_VIDEO_COMMAND,
  type SlashOptions,
} from '@lobehub/editor';
import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { useSlashItems } from './useSlashItems';

vi.mock('@lobehub/editor', () => ({
  INSERT_ALERT_COMMAND: 'INSERT_ALERT_COMMAND',
  INSERT_CHART_COMMAND: 'INSERT_CHART_COMMAND',
  INSERT_CHECK_LIST_COMMAND: 'INSERT_CHECK_LIST_COMMAND',
  INSERT_CODEMIRROR_COMMAND: 'INSERT_CODEMIRROR_COMMAND',
  INSERT_FOOTNOTE_COMMAND: 'INSERT_FOOTNOTE_COMMAND',
  INSERT_HEADING_COMMAND: 'INSERT_HEADING_COMMAND',
  INSERT_HORIZONTAL_RULE_COMMAND: 'INSERT_HORIZONTAL_RULE_COMMAND',
  INSERT_IMAGE_COMMAND: 'INSERT_IMAGE_COMMAND',
  INSERT_MATH_COMMAND: 'INSERT_MATH_COMMAND',
  INSERT_ORDERED_LIST_COMMAND: 'INSERT_ORDERED_LIST_COMMAND',
  INSERT_TABLE_COMMAND: 'INSERT_TABLE_COMMAND',
  INSERT_UNORDERED_LIST_COMMAND: 'INSERT_UNORDERED_LIST_COMMAND',
  INSERT_VIDEO_COMMAND: 'INSERT_VIDEO_COMMAND',
}));

vi.mock('@/features/EditorCanvas', () => ({ openFileSelector: vi.fn() }));

type SlashItem = Extract<NonNullable<SlashOptions['items']>[number], { key: string }>;

const findItem = (items: SlashOptions['items'], key: string) =>
  (items as SlashItem[]).find((item) => item.key === key);

describe('useSlashItems', () => {
  it.each([
    ['alert', INSERT_ALERT_COMMAND],
    ['chart', INSERT_CHART_COMMAND],
    ['footnote', INSERT_FOOTNOTE_COMMAND],
  ])('inserts a %s block from the slash menu', (key, command) => {
    const { result } = renderHook(() => useSlashItems());
    const item = findItem(result.current, key);
    const editor = { dispatchCommand: vi.fn(), focus: vi.fn() };

    expect(item).toBeDefined();
    item!.onSelect!(editor as any, {} as any);

    expect(editor.dispatchCommand).toHaveBeenCalledWith(command, undefined);
  });

  it('inserts an empty video block from the slash menu', () => {
    const { result } = renderHook(() => useSlashItems());
    const item = findItem(result.current, 'video');
    const editor = { dispatchCommand: vi.fn(), focus: vi.fn() };

    expect(item).toBeDefined();
    item!.onSelect!(editor as any, {} as any);

    expect(editor.dispatchCommand).toHaveBeenCalledWith(INSERT_VIDEO_COMMAND, {});
  });
});
