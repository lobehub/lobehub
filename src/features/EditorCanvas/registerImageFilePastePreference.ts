import { type IEditor, IUploadService } from '@lobehub/editor';
import { COMMAND_PRIORITY_CRITICAL, type LexicalEditor, PASTE_COMMAND } from 'lexical';

/**
 * True when the HTML flavor carries nothing but images — what apps such as
 * Discord put next to the bitmap on "Copy Image".
 */
const isImageOnlyHtml = (html: string) => {
  const body = new DOMParser().parseFromString(html, 'text/html').body;
  if (!body.querySelector('img')) return false;

  const clone = body.cloneNode(true) as HTMLElement;
  clone.querySelectorAll('img').forEach((img) => img.remove());
  return !clone.textContent?.trim() && !clone.querySelector('video, iframe, table, svg');
};

/**
 * Prefer the clipboard's image file over an image-only HTML flavor.
 *
 * Lexical pastes `text/html` whenever it exists, so an image copied from
 * Discord lands as `<img src="https://cdn.discordapp.com/...">`, which then
 * has to be rehosted from a signed third-party URL and fails. The bitmap in
 * the same clipboard is the real image, so upload that instead.
 */
export const registerImageFilePastePreferenceOnLexical = (
  lexicalEditor: LexicalEditor,
  uploadFile: (file: File) => void,
) =>
  lexicalEditor.registerCommand(
    PASTE_COMMAND,
    (event) => {
      if (!('clipboardData' in event) || !event.clipboardData) return false;
      const { clipboardData } = event;

      const files = [...clipboardData.files];
      if (files.length === 0 || !files.every((file) => file.type.startsWith('image/')))
        return false;

      const html = clipboardData.getData('text/html');
      if (!html || !isImageOnlyHtml(html)) return false;

      event.preventDefault();
      for (const file of files) uploadFile(file);
      return true;
    },
    COMMAND_PRIORITY_CRITICAL,
  );

export const registerImageFilePastePreference = (editor: IEditor): (() => void) | undefined => {
  const lexicalEditor = editor.getLexicalEditor?.();
  if (!lexicalEditor) return;
  return registerImageFilePastePreferenceOnLexical(lexicalEditor, (file) => {
    editor
      .requireService(IUploadService)
      ?.uploadFile(file, 'drag-drop-paste', null)
      .catch((error) => console.error('[EditorCanvas] paste image upload failed:', error));
  });
};
