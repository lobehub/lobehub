import { act, render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import DragUploadZone from './index';

const createPasteEvent = (file: File) => {
  const pasteEvent = new Event('paste') as ClipboardEvent;
  Object.defineProperty(pasteEvent, 'clipboardData', {
    value: {
      items: [{ getAsFile: () => file, kind: 'file', webkitGetAsEntry: () => null }],
    },
  });
  return pasteEvent;
};

describe('DragUploadZone paste upload', () => {
  const file = new File([''], 'test.png', { type: 'image/png' });

  it('routes window pastes into onUploadFiles when enablePasteUpload is set', async () => {
    const onUploadFiles = vi.fn();
    render(
      <DragUploadZone enablePasteUpload onUploadFiles={onUploadFiles}>
        <div>content</div>
      </DragUploadZone>,
    );

    await act(async () => {
      window.dispatchEvent(createPasteEvent(file));
    });

    expect(onUploadFiles).toHaveBeenCalledWith([file]);
  });

  it('ignores window pastes by default', async () => {
    const onUploadFiles = vi.fn();
    render(<DragUploadZone onUploadFiles={onUploadFiles}>content</DragUploadZone>);

    await act(async () => {
      window.dispatchEvent(createPasteEvent(file));
    });

    expect(onUploadFiles).not.toHaveBeenCalled();
  });

  it('ignores window pastes while disabled', async () => {
    const onUploadFiles = vi.fn();
    render(
      <DragUploadZone disabled enablePasteUpload onUploadFiles={onUploadFiles}>
        content
      </DragUploadZone>,
    );

    await act(async () => {
      window.dispatchEvent(createPasteEvent(file));
    });

    expect(onUploadFiles).not.toHaveBeenCalled();
  });
});
