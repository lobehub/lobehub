import { beforeEach, describe, expect, it } from 'vitest';

import { persistFailedSendDrafts } from './failedSendDraftStorage';

describe('failed send draft storage', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('does not persist binary preview payloads', () => {
    persistFailedSendDrafts({
      context: [
        {
          editorData: { root: {} },
          files: [
            {
              base64Url: `data:image/png;base64,${'A'.repeat(1000)}`,
              file: new File(['payload'], 'image.png', { type: 'image/png' }),
              id: 'image.png',
              previewUrl: 'blob:preview',
              status: 'success',
            },
          ],
          id: 'draft-1',
          message: 'keep this',
        },
      ],
    });

    const stored = localStorage.getItem('lobehub:failed-send-drafts:v1');
    expect(stored).not.toContain('base64');
    expect(stored).not.toContain('blob:preview');
    expect(stored).toContain('image.png');
  });
});
