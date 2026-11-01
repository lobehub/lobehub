/**
 * @vitest-environment happy-dom
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import Item from './Item';

const setDocument = vi.fn();
const focus = vi.fn();

vi.mock('@/store/chat', () => ({
  useChatStore: (selector: any) =>
    selector({
      mainInputEditor: {
        focus,
        instance: { setDocument },
      },
    }),
}));

describe('SuggestQuestions Item', () => {
  beforeEach(() => {
    focus.mockReset();
    setDocument.mockReset();
  });

  it('does not write to the input when disabled', () => {
    render(<Item disabled description="Prompt description" prompt="Prompt" title="Prompt title" />);

    fireEvent.click(screen.getByText('Prompt title'));

    expect(setDocument).not.toHaveBeenCalled();
    expect(focus).not.toHaveBeenCalled();
  });
});
