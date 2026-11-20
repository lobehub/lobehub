import { SANDBOX_UPLOADED_FILES_DIR } from '@lobechat/builtin-tool-cloud-sandbox';
import { describe, expect, it } from 'vitest';

import { buildSandboxFilesInitCommand, SANDBOX_FILES_MARKER_DIR } from '../bootstrap';

describe('buildSandboxFilesInitCommand', () => {
  it('only ensures the dir when there is nothing to download', () => {
    expect(buildSandboxFilesInitCommand([])).toBe(`mkdir -p '${SANDBOX_UPLOADED_FILES_DIR}'`);
  });

  it('guards each download with a marker for its own file id', () => {
    const command = buildSandboxFilesInitCommand([
      { id: 'file_a', name: 'data.csv', url: 'https://files.example.com/a' },
    ]);

    expect(command).toContain(`mkdir -p '${SANDBOX_FILES_MARKER_DIR}'`);
    expect(command).toContain(
      `if [ ! -f '${SANDBOX_FILES_MARKER_DIR}/file_a' ]; then curl -fsSL 'https://files.example.com/a' -o '${SANDBOX_UPLOADED_FILES_DIR}/data.csv' && touch '${SANDBOX_FILES_MARKER_DIR}/file_a' || true; fi`,
    );
  });

  it('does not let one synced file stop a file attached later from syncing', () => {
    const command = buildSandboxFilesInitCommand([
      { id: 'file_a', name: 'template.pptx', url: 'https://files.example.com/a' },
      { id: 'file_b', name: 'template v2.pptx', url: 'https://files.example.com/b' },
    ]);

    // No session-wide guard: every file is checked against its own marker.
    expect(command).not.toContain('.lobe-files-initialized');
    expect(command).toContain(`if [ ! -f '${SANDBOX_FILES_MARKER_DIR}/file_a' ]`);
    expect(command).toContain(`if [ ! -f '${SANDBOX_FILES_MARKER_DIR}/file_b' ]`);
    expect(command).toContain(`-o '${SANDBOX_UPLOADED_FILES_DIR}/template v2.pptx'`);
  });

  it('marks a file synced only after its download succeeded', () => {
    const command = buildSandboxFilesInitCommand([
      { id: 'file_a', name: 'data.csv', url: 'https://files.example.com/a' },
    ]);

    // `curl -f` fails on an HTTP error, so `touch` is skipped and the next call retries.
    expect(command).toMatch(/curl -fsSL [^;]+ && touch '[^']+\/file_a' \|\| true/);
  });

  it('de-dupes downloads that resolve to the same sandbox path', () => {
    const command = buildSandboxFilesInitCommand([
      { id: 'file_a', name: 'a/data.csv', url: 'https://files.example.com/a' },
      { id: 'file_b', name: 'b/data.csv', url: 'https://files.example.com/b' },
    ]);

    const curlCount = command.split('curl ').length - 1;
    expect(curlCount).toBe(1);
  });

  it('skips entries without a download url or file id', () => {
    expect(buildSandboxFilesInitCommand([{ id: 'file_a', name: 'data.csv', url: '' }])).toBe(
      `mkdir -p '${SANDBOX_UPLOADED_FILES_DIR}'`,
    );
    expect(buildSandboxFilesInitCommand([{ id: '', name: 'data.csv', url: 'https://x/a' }])).toBe(
      `mkdir -p '${SANDBOX_UPLOADED_FILES_DIR}'`,
    );
  });

  it('escapes single quotes in names and urls', () => {
    const command = buildSandboxFilesInitCommand([
      { id: 'file_a', name: "o'brien.txt", url: "https://x/a'b" },
    ]);

    expect(command).toContain(String.raw`o'\''brien.txt`);
    expect(command).toContain(String.raw`'https://x/a'\''b'`);
  });
});
