import { describe, expect, it } from 'vitest';

import { hasUnsavedGoalDraft } from './hasUnsavedGoalDraft';

const docWith = (...children: unknown[]) => ({
  root: { children: [{ children, type: 'paragraph' }], type: 'root' },
});

describe('hasUnsavedGoalDraft', () => {
  it('is clean for an untouched modal', () => {
    expect(hasUnsavedGoalDraft({ editorJson: docWith(), instruction: '', step: 'describe' })).toBe(
      false,
    );
  });

  it('ignores whitespace-only text', () => {
    expect(
      hasUnsavedGoalDraft({ editorJson: docWith(), instruction: ' \n', step: 'describe' }),
    ).toBe(false);
  });

  it('counts a typed description', () => {
    expect(
      hasUnsavedGoalDraft({ editorJson: docWith(), instruction: 'Ship it', step: 'describe' }),
    ).toBe(true);
  });

  it('treats an unchanged example seed as clean, and an edited one as unsaved', () => {
    const seeded = { editorJson: docWith(), initialInstruction: 'Write a report' };
    expect(
      hasUnsavedGoalDraft({ ...seeded, instruction: 'Write a report\n', step: 'describe' }),
    ).toBe(false);
    expect(
      hasUnsavedGoalDraft({ ...seeded, instruction: 'Write a long report', step: 'describe' }),
    ).toBe(true);
  });

  it('counts an attachment, uploaded or not', () => {
    const uploaded = docWith({ fileUrl: 'https://x/a.png', status: 'uploaded', type: 'image' });
    const uploading = docWith({ status: 'pending', type: 'file' });
    expect(hasUnsavedGoalDraft({ editorJson: uploaded, instruction: '', step: 'describe' })).toBe(
      true,
    );
    expect(hasUnsavedGoalDraft({ editorJson: uploading, instruction: '', step: 'describe' })).toBe(
      true,
    );
  });

  it('always counts a draft past the describe step', () => {
    expect(hasUnsavedGoalDraft({ editorJson: undefined, instruction: '', step: 'preparing' })).toBe(
      true,
    );
    expect(hasUnsavedGoalDraft({ editorJson: undefined, instruction: '', step: 'review' })).toBe(
      true,
    );
  });

  it('is clean when there is no editor document yet', () => {
    expect(hasUnsavedGoalDraft({ editorJson: undefined, instruction: '', step: 'describe' })).toBe(
      false,
    );
  });
});
