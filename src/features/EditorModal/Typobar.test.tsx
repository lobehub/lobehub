/**
 * @vitest-environment happy-dom
 */
import type { ChatInputActionsProps } from '@lobehub/editor/react';
import { render } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import TypoBar from './Typobar';

const chatInputActionsMock = vi.hoisted(() => vi.fn(() => null));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock('@lobehub/editor', () => ({
  HotkeyEnum: {
    Bold: 'bold',
    BulletList: 'bulletList',
    CodeInline: 'codeInline',
    Italic: 'italic',
    NumberList: 'numberList',
    Strikethrough: 'strikethrough',
    Underline: 'underline',
  },
  getHotkeyById: (id: string) => ({ keys: [`hotkey:${id}`] }),
}));

vi.mock('@lobehub/editor/react', () => ({
  ChatInputActionBar: ({ left }: { left: ReactNode }) => <div>{left}</div>,
  ChatInputActions: chatInputActionsMock,
  useEditorState: () => ({
    blockquote: vi.fn(),
    bold: vi.fn(),
    bulletList: vi.fn(),
    checkList: vi.fn(),
    code: vi.fn(),
    codeblock: vi.fn(),
    insertMath: vi.fn(),
    isBlockquote: false,
    isBold: false,
    isCode: false,
    isItalic: false,
    isStrikethrough: false,
    isUnderline: false,
    italic: vi.fn(),
    numberList: vi.fn(),
    strikethrough: vi.fn(),
    underline: vi.fn(),
  }),
}));

vi.mock('antd-style', () => ({
  cssVar: {
    colorFillQuaternary: 'rgba(0, 0, 0, 0.04)',
  },
}));

describe('EditorModal TypoBar', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should attach popupContainer to every tooltip config', () => {
    const popupContainer = document.createElement('div');

    render(<TypoBar popupContainer={popupContainer} />);

    expect(chatInputActionsMock).toHaveBeenCalled();

    const [{ items }] = chatInputActionsMock.mock.calls.at(-1) as [
      { items: ChatInputActionsProps['items'] },
    ];

    const actionableItems = items.filter((item) => item.type !== 'divider');

    expect(actionableItems).toHaveLength(11);

    for (const item of actionableItems) {
      expect(item.tooltipProps).toEqual(
        expect.objectContaining({
          popupContainer,
        }),
      );
    }

    const italicItem = actionableItems.find((item) => item.key === 'italic');
    expect(italicItem?.tooltipProps).toEqual(
      expect.objectContaining({
        hotkey: ['hotkey:italic'],
        popupContainer,
      }),
    );
  });
});
