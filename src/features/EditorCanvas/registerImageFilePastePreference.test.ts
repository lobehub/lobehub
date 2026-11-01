import { createEditor, PASTE_COMMAND } from 'lexical';
import { describe, expect, it, vi } from 'vitest';

import { registerImageFilePastePreferenceOnLexical } from './registerImageFilePastePreference';

const createPasteEvent = (files: File[], html: string) =>
  ({
    clipboardData: { files, getData: (type: string) => (type === 'text/html' ? html : '') },
    preventDefault: vi.fn(),
  }) as unknown as ClipboardEvent;

const setup = () => {
  const editor = createEditor({ onError: (error) => { throw error; } });
  const onFiles = vi.fn();
  registerImageFilePastePreferenceOnLexical(editor, onFiles);
  return { editor, onFiles };
};

const image = new File(['png'], 'image.png', { type: 'image/png' });

describe('registerImageFilePastePreference', () => {
  it('uploads the image file instead of an image-only HTML flavor (Discord copy image)', () => {
    const { editor, onFiles } = setup();
    const event = createPasteEvent(
      [image],
      '<meta charset="utf-8"><img src="https://media.discordapp.net/attachments/1/2/image.png?ex=1">',
    );

    expect(editor.dispatchCommand(PASTE_COMMAND, event)).toBe(true);
    expect(event.preventDefault).toHaveBeenCalled();
    expect(onFiles).toHaveBeenCalledWith(image);
  });

  it('keeps the HTML paste when it carries text besides images', () => {
    const { editor, onFiles } = setup();
    const event = createPasteEvent([image], '<p>hello <img src="https://example.com/a.png"></p>');

    expect(editor.dispatchCommand(PASTE_COMMAND, event)).toBe(false);
    expect(onFiles).not.toHaveBeenCalled();
  });

  it('ignores pastes without image files', () => {
    const { editor, onFiles } = setup();
    const event = createPasteEvent([], '<img src="https://example.com/a.png">');

    expect(editor.dispatchCommand(PASTE_COMMAND, event)).toBe(false);
    expect(onFiles).not.toHaveBeenCalled();
  });
});
