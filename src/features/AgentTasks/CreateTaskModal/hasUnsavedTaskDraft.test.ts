import { describe, expect, it } from 'vitest';

import { hasUnsavedTaskDraft } from './hasUnsavedTaskDraft';

const docWith = (...children: unknown[]) => ({
  root: { children: [{ children, type: 'paragraph' }], type: 'root' },
});

describe('hasUnsavedTaskDraft', () => {
  it('is clean for an untouched modal', () => {
    expect(hasUnsavedTaskDraft({ editorJson: docWith(), instruction: '', title: '' })).toBe(false);
  });

  it('ignores whitespace-only text', () => {
    expect(hasUnsavedTaskDraft({ editorJson: docWith(), instruction: ' \n', title: '  ' })).toBe(
      false,
    );
  });

  it('counts a title or an instruction', () => {
    expect(hasUnsavedTaskDraft({ editorJson: docWith(), instruction: '', title: 'Ship' })).toBe(
      true,
    );
    expect(hasUnsavedTaskDraft({ editorJson: docWith(), instruction: 'Do it', title: '' })).toBe(
      true,
    );
  });

  it('counts an uploaded attachment', () => {
    const editorJson = docWith({ fileUrl: 'https://x/f.pdf', status: 'uploaded', type: 'file' });
    expect(hasUnsavedTaskDraft({ editorJson, instruction: '', title: '' })).toBe(true);
  });

  it('counts an attachment that is still uploading or failed', () => {
    const uploading = docWith({ status: 'pending', type: 'file' });
    const failed = docWith({ status: 'error', type: 'image' });
    expect(hasUnsavedTaskDraft({ editorJson: uploading, instruction: '', title: '' })).toBe(true);
    expect(hasUnsavedTaskDraft({ editorJson: failed, instruction: '', title: '' })).toBe(true);
  });

  it('is clean when there is no editor document yet', () => {
    expect(hasUnsavedTaskDraft({ editorJson: undefined, instruction: '', title: '' })).toBe(false);
  });
});
