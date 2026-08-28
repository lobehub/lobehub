/**
 * @vitest-environment happy-dom
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useKnowledgeBaseStore } from '@/store/library';
import { initialState } from '@/store/library/initialState';

import Editing from './Editing';

vi.mock('@/features/NavPanel/OverlayContainer', () => ({
  useOverlayPopoverPortalProps: () => undefined,
}));

describe('LibraryList Item Editing', () => {
  const updateKnowledgeBase = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    useKnowledgeBaseStore.setState(
      {
        ...initialState,
        updateKnowledgeBase,
      },
      false,
    );
  });

  it('saves the inline rename input on blur and closes editing', async () => {
    const toggleEditing = vi.fn();
    useKnowledgeBaseStore.setState({ knowledgeBaseRenamingId: 'kb-1' });

    render(<Editing id="kb-1" name="My Library" toggleEditing={toggleEditing} />);

    const input = screen.getByRole('textbox');
    expect(input).toHaveValue('My Library');

    fireEvent.change(input, { target: { value: 'Renamed Library' } });
    fireEvent.blur(input);

    await waitFor(() => {
      expect(updateKnowledgeBase).toHaveBeenCalledWith('kb-1', { name: 'Renamed Library' });
      expect(toggleEditing).toHaveBeenCalledWith(false);
    });
  });
});
