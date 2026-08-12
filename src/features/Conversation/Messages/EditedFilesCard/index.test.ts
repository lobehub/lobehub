import { getFilePathDisplayInfo } from '@lobechat/shared-tool-ui/components';
import { fireEvent, render, screen } from '@testing-library/react';
import { createElement } from 'react';
import { describe, expect, it, vi } from 'vitest';

import EditedFilesCard, {
  AGGREGATE_EDITED_FILE_ICON_SIZE,
  getEditedFileIconName,
  getEditedFilesCardMode,
  SINGLE_EDITED_FILE_ICON_SIZE,
} from './index';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { path?: string }) =>
      options?.path ? `${key}:${options.path}` : key,
  }),
}));

const singleEntry = {
  diffTexts: [
    'diff --git a/Acceptance/index.tsx b/Acceptance/index.tsx\n--- a/Acceptance/index.tsx\n+++ b/Acceptance/index.tsx\n@@ -1 +1 @@\n-old\n+new',
  ],
  kind: 'modified' as const,
  linesAdded: 7,
  linesDeleted: 2,
  path: '/workspace/Acceptance/index.tsx',
  sandboxBacked: false,
  sourceToolCallIds: ['tool-1'],
};

describe('getEditedFilesCardMode', () => {
  it('uses the dedicated direct summary for a single edited file', () => {
    expect(getEditedFilesCardMode(1)).toBe('single');
  });

  it('uses the collapsible aggregate for multiple edited files', () => {
    expect(getEditedFilesCardMode(2)).toBe('aggregate');
  });
});

describe('getEditedFileIconName', () => {
  it('uses the edited file basename to select its file-type icon', () => {
    expect(getEditedFileIconName('/workspace/Acceptance/index.tsx')).toBe('index.tsx');
  });
});

describe('getFilePathDisplayInfo', () => {
  it('keeps the parent directory and basename for long absolute paths', () => {
    expect(getFilePathDisplayInfo('/very/long/workspace/Acceptance/index.tsx')).toEqual({
      displayPath: 'Acceptance/index.tsx',
      name: 'index.tsx',
    });
  });
});

describe('SINGLE_EDITED_FILE_ICON_SIZE', () => {
  it('keeps the single-file icon container compact', () => {
    expect(SINGLE_EDITED_FILE_ICON_SIZE).toBe(40);
  });
});

describe('AGGREGATE_EDITED_FILE_ICON_SIZE', () => {
  it('keeps the multi-file summary as compact as the single-file card', () => {
    expect(AGGREGATE_EDITED_FILE_ICON_SIZE).toBe(40);
  });
});

describe('SingleEditedFileCard', () => {
  it('groups line deltas below the title and exposes the diff action as a secondary control', () => {
    render(createElement(EditedFilesCard, { entries: [singleEntry] }));

    const title = screen.getByText('editedFiles.singleTitle:Acceptance/index.tsx');
    const action = screen.getByRole('button', { name: 'editedFiles.viewChanges' });
    const summary = title.parentElement;

    expect(summary).toHaveTextContent('+7');
    expect(summary).toHaveTextContent('-2');
    expect(summary).not.toContainElement(action);
    expect(action).toHaveAttribute('data-view-changes');
    expect(action).toHaveAttribute('aria-expanded', 'false');

    fireEvent.click(action);
    expect(action).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('button', { name: 'editedFiles.hideChanges' })).toBeInTheDocument();
  });
});
