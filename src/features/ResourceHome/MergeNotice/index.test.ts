import { isValidElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DocsMergeNoticeTitle } from './Content';
import { openDocsMergeNotice } from './index';

const { createModal } = vi.hoisted(() => ({ createModal: vi.fn() }));

vi.mock('@lobehub/ui', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  createModal,
}));

describe('openDocsMergeNotice', () => {
  beforeEach(() => {
    createModal.mockClear();
  });

  // A string resolved when the modal opens is the raw key on a cold load,
  // before the `file` namespace arrives; the title component re-renders.
  it('passes the title as a component, not a string resolved at open time', () => {
    openDocsMergeNotice(vi.fn());

    const { title } = createModal.mock.calls[0][0] as { title: unknown };
    expect(typeof title).not.toBe('string');
    expect(isValidElement(title) && title.type).toBe(DocsMergeNoticeTitle);
  });
});
