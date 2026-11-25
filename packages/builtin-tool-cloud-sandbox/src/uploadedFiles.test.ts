import { describe, expect, it } from 'vitest';

import { systemPrompt } from './systemRole';
import {
  formatSandboxUploadedFilesByMessage,
  formatUploadedFilesPrompt,
  partitionSandboxUploadedFiles,
  SANDBOX_UPLOADED_FILES_DIR,
} from './uploadedFiles';

describe('formatUploadedFilesPrompt', () => {
  it('says nothing at all when the conversation has no attachments', () => {
    // The section used to be static, so every conversation was told to run
    // `listFiles` on a directory that is only created while syncing files —
    // the agent spent a call on `Directory not found` and then had to reason
    // its way out of a failure that was never real.
    expect(formatUploadedFilesPrompt([])).toBe('');
    expect(formatUploadedFilesPrompt([{ name: '' }])).toBe('');
  });

  it('carries the directory instruction with the files it describes', () => {
    const rendered = formatUploadedFilesPrompt([{ name: 'report.csv', size: 2048 }]);

    expect(rendered).toContain('<uploaded_files>');
    expect(rendered).toContain(SANDBOX_UPLOADED_FILES_DIR);
    expect(rendered).toContain(`${SANDBOX_UPLOADED_FILES_DIR}/report.csv`);
    expect(rendered).toContain('</uploaded_files>');
  });
});

describe('systemPrompt', () => {
  it('names the upload directory only through the placeholder', () => {
    // The static prompt must not mention it: everything the agent is told
    // about that directory has to arrive with the files, or a conversation
    // without any is pointed at a path that does not exist.
    expect(systemPrompt).toContain('{{sandbox_uploaded_files}}');
    expect(systemPrompt).not.toContain(SANDBOX_UPLOADED_FILES_DIR);
    expect(systemPrompt).not.toContain('<uploaded_files>');
  });
});

describe('partitionSandboxUploadedFiles', () => {
  it('anchors visible message uploads by messageId and falls back session/truncated files to systemFiles', () => {
    const partitioned = partitionSandboxUploadedFiles(
      [
        { name: 'session.pdf', size: 1024 },
        { messageId: 'u1', name: 'old.csv', size: 2048 },
        { messageId: 'u2', name: 'report.csv', size: 4096 },
        { messageId: 'u2', name: 'notes.txt', size: 512 },
      ],
      new Set(['u2']),
    );

    expect(partitioned.systemFiles.map((f) => f.name)).toEqual(['session.pdf', 'old.csv']);
    expect(Object.keys(partitioned.byMessageId)).toEqual(['u2']);
    expect(partitioned.byMessageId.u2.map((f) => f.name)).toEqual(['report.csv', 'notes.txt']);

    const formatted = formatSandboxUploadedFilesByMessage(partitioned.byMessageId);
    expect(formatted?.u2).toContain(`${SANDBOX_UPLOADED_FILES_DIR}/report.csv`);
    expect(formatted?.u2).toContain(`${SANDBOX_UPLOADED_FILES_DIR}/notes.txt`);
  });

  it('deduplicates by resolved sandbox path across session and message entries', () => {
    const partitioned = partitionSandboxUploadedFiles(
      [
        { name: 'dup.csv', size: 100 },
        { messageId: 'u2', name: 'nested/dup.csv', size: 100 },
      ],
      new Set(['u2']),
    );

    expect(partitioned.systemFiles.map((f) => f.name)).toEqual(['dup.csv']);
    expect(partitioned.byMessageId).toEqual({});
    expect(formatSandboxUploadedFilesByMessage(partitioned.byMessageId)).toBeUndefined();
  });
});
