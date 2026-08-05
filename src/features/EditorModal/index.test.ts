import { createModal } from '@lobehub/ui/base-ui';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { openEditorModal } from '.';

vi.mock('@lobehub/ui/base-ui', () => ({
  Button: () => null,
  createModal: vi.fn(() => ({ close: vi.fn(), destroy: vi.fn(), update: vi.fn() })),
  ModalFooter: () => null,
  useModalContext: () => ({ close: vi.fn() }),
}));

vi.mock('./EditorModalContent', () => ({ default: () => null }));

const lastModalProps = () => vi.mocked(createModal).mock.calls.at(-1)![0] as Record<string, any>;

describe('openEditorModal', () => {
  beforeEach(() => {
    vi.mocked(createModal).mockClear();
  });

  it('runs the caller cleanup on any close, not only user dismissal', () => {
    // Regression: `onOpenChange` fires only for Escape / backdrop / the header
    // close button. The footer's Cancel goes through the instance's `close()`,
    // which just flips the stack entry — so wiring cleanup to `onOpenChange`
    // left the caller's editing flag set and the editor could never reopen.
    const onClose = vi.fn();
    openEditorModal({ onClose, value: 'original' });

    const props = lastModalProps();
    expect(props.onOpenChange).toBeUndefined();
    expect(typeof props.onOpenChangeComplete).toBe('function');

    props.onOpenChangeComplete(true);
    expect(onClose).not.toHaveBeenCalled();

    props.onOpenChangeComplete(false);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('tolerates a caller that passes no cleanup', () => {
    openEditorModal({ value: 'original' });

    expect(() => lastModalProps().onOpenChangeComplete(false)).not.toThrow();
  });
});
