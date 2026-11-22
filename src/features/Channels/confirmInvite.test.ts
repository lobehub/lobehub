import { createModal } from '@lobehub/ui';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { confirmInvite } from './confirmInvite';

vi.mock('@lobehub/ui', () => ({ createModal: vi.fn() }));

type ModalOptions = {
  content: { props: { onConfirm: () => void } };
  onOpenChange?: (open: boolean) => void;
  onOpenChangeComplete?: (open: boolean) => void;
};

const options = { cancelText: 'Cancel', content: 'Body', okText: 'Invite', title: 'Invite A?' };
const lastModal = () => vi.mocked(createModal).mock.calls.at(-1)![0] as unknown as ModalOptions;

describe('confirmInvite', () => {
  beforeEach(() => {
    vi.mocked(createModal).mockClear();
  });

  it('resolves true when confirmed, even after the dialog finishes closing', async () => {
    const answer = confirmInvite(options);
    const modal = lastModal();
    modal.content.props.onConfirm();
    modal.onOpenChangeComplete?.(false);
    await expect(answer).resolves.toBe(true);
  });

  // Cancel closes through the modal context, which reports only the close completing.
  it('resolves false once a dialog closed by Cancel finishes closing', async () => {
    const answer = confirmInvite(options);
    lastModal().onOpenChangeComplete?.(false);
    await expect(Promise.race([answer, Promise.resolve('pending')])).resolves.toBe(false);
  });

  it('resolves false when dismissed with ✕, Esc or the mask', async () => {
    const answer = confirmInvite(options);
    lastModal().onOpenChange?.(false);
    await expect(answer).resolves.toBe(false);
  });
});
