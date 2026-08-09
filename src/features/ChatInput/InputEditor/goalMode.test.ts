import type { IEditor } from '@lobehub/editor';
import { describe, expect, it, vi } from 'vitest';

import { enterGoalMode } from './goalMode';

const createEditor = (content: string) =>
  ({
    focus: vi.fn(),
    getDocument: vi.fn().mockReturnValue(content),
    setDocument: vi.fn(),
  }) as unknown as IEditor;

describe('enterGoalMode', () => {
  it('enables goal mode without changing an existing draft', () => {
    const editor = createEditor('ship the homepage');
    const setGoalMode = vi.fn();

    enterGoalMode(editor, setGoalMode);

    expect(editor.setDocument).not.toHaveBeenCalled();
    expect(setGoalMode).toHaveBeenCalledWith(true);
    expect(editor.focus).toHaveBeenCalled();
  });

  it('replaces the partial slash query selected from the command menu', () => {
    const editor = createEditor('/go');
    const setGoalMode = vi.fn();

    enterGoalMode(editor, setGoalMode, true);

    expect(editor.setDocument).toHaveBeenCalledWith('markdown', '', {
      keepHistory: true,
    });
    expect(setGoalMode).toHaveBeenCalledWith(true);
  });
});
