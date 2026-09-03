import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AttachmentThumbs } from './attachments';

vi.mock('@/store/file', () => ({ useFileStore: () => vi.fn() }));

const attachments = [{ id: 'att-1', name: 'screenshot.png', url: 'https://example.com/a.png' }];

afterEach(cleanup);

describe('AttachmentThumbs', () => {
  it('does not trigger the host row while zooming a thumbnail', async () => {
    // The feedback/check row wrapping this list is itself clickable and its handler
    // closes the surrounding drawer, which unmounts the zoom viewer in the tick it
    // opens. Zooming has to stay its own action.
    const onRowClick = vi.fn();

    render(
      <div onClick={onRowClick}>
        <AttachmentThumbs attachments={attachments} />
      </div>,
    );

    await userEvent.click(screen.getByRole('img'));

    expect(onRowClick).not.toHaveBeenCalled();
  });

  it('still lets the host row handle clicks outside the thumbnails', async () => {
    const onRowClick = vi.fn();

    render(
      <div onClick={onRowClick}>
        <span>row body</span>
        <AttachmentThumbs attachments={attachments} />
      </div>,
    );

    await userEvent.click(screen.getByText('row body'));

    expect(onRowClick).toHaveBeenCalledTimes(1);
  });
});
