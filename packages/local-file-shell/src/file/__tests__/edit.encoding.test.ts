import fs from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { editLocalFile, readLocalFile, writeLocalFile } from '../index';

/**
 * Regression tests for encoding parity between read and write tools
 * (lobehub/lobehub#20563): reads decode UTF-16 via file-loaders, so edits
 * against the old_string a read produced must match too — and a file's
 * encoding must survive an edit or an overwrite.
 */
describe('editLocalFile encoding parity', () => {
  let tmpDir: string;

  const utf16le = (text: string) =>
    Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text, 'utf16le')]);

  beforeEach(async () => {
    tmpDir = path.join(os.tmpdir(), `local-file-shell-encoding-test-${process.pid}`);
    await mkdir(tmpDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { force: true, recursive: true });
  });

  it('edits a UTF-16LE BOM file whose old_string was copied from a read', async () => {
    const filePath = path.join(tmpDir, 'utf16.txt');
    await writeFile(
      filePath,
      utf16le('line one\r\n  indented target line\r\nEDIT-U16-MARKER tail\r\n'),
    );

    // The agent copies old_string from a readLocalFile call — LF-only there.
    const result = await editLocalFile({
      file_path: filePath,
      new_string: 'EDIT-U16-MARKER tail EDITED',
      old_string: 'EDIT-U16-MARKER tail',
    });

    expect(result.success).toBe(true);

    const readBack = await readLocalFile({ path: filePath, fullContent: true });
    expect(readBack.content).toContain('EDIT-U16-MARKER tail EDITED');

    // The file stays UTF-16LE with its BOM — not transcoded to UTF-8.
    const bytes = await readFile(filePath);
    expect(bytes[0]).toBe(0xff);
    expect(bytes[1]).toBe(0xfe);
    expect(bytes.length).toBe(
      utf16le('line one\r\n  indented target line\r\nEDIT-U16-MARKER tail EDITED\r\n').length,
    );
  });

  it('edits a UTF-8 BOM file and preserves the BOM', async () => {
    const filePath = path.join(tmpDir, 'utf8bom.txt');
    await writeFile(
      filePath,
      Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('target line\nsecond\n')]),
    );

    const result = await editLocalFile({
      file_path: filePath,
      new_string: 'target line EDITED',
      old_string: 'target line',
    });

    expect(result.success).toBe(true);

    const bytes = await readFile(filePath);
    expect(bytes.subarray(0, 3)).toEqual(Buffer.from([0xef, 0xbb, 0xbf]));
    expect(bytes.toString('utf8')).toContain('target line EDITED');
  });

  it('edits a BOM-less UTF-16LE file detected by the shared heuristic', async () => {
    const filePath = path.join(tmpDir, 'utf16-nobom.txt');
    await writeFile(filePath, Buffer.from('alpha\nbeta\nEDIT-NOBOM-MARKER\n', 'utf16le'));

    const result = await editLocalFile({
      file_path: filePath,
      new_string: 'EDIT-NOBOM-MARKER DONE',
      old_string: 'EDIT-NOBOM-MARKER',
    });

    expect(result.success).toBe(true);

    const readBack = await readLocalFile({ path: filePath, fullContent: true });
    expect(readBack.content).toContain('EDIT-NOBOM-MARKER DONE');
  });

  it('keeps CRLF endings through a UTF-16 edit', async () => {
    const filePath = path.join(tmpDir, 'utf16-crlf.txt');
    const before = utf16le('a\r\nEDIT-KEEP-CRLF\r\nb\r\n');
    await writeFile(filePath, before);

    const result = await editLocalFile({
      file_path: filePath,
      new_string: 'EDIT-KEEP-CRLF ok',
      old_string: 'EDIT-KEEP-CRLF',
    });

    expect(result.success).toBe(true);

    const bytes = await readFile(filePath);
    const after = bytes.toString('utf16le');
    // BOM + body; the CR bytes must all still be there.
    expect(bytes[0]).toBe(0xff);
    expect(after.replace(/^\uFEFF/, '')).toBe('a\r\nEDIT-KEEP-CRLF ok\r\nb\r\n');
    expect(bytes.length).toBe(before.length + ' ok'.length * 2);
  });

  it('writeLocalFile keeps the encoding of an existing UTF-16 file', async () => {
    const filePath = path.join(tmpDir, 'write-utf16.txt');
    await writeFile(filePath, utf16le('original\r\n'));

    const result = await writeLocalFile({ content: 'replaced\r\ncontent\r\n', path: filePath });

    expect(result.success).toBe(true);

    const bytes = await readFile(filePath);
    expect(bytes[0]).toBe(0xff);
    expect(bytes[1]).toBe(0xfe);
    expect(bytes.toString('utf16le').replace(/^\uFEFF/, '')).toBe('replaced\r\ncontent\r\n');
  });

  it('writeLocalFile creates new files as UTF-8 without a BOM', async () => {
    const filePath = path.join(tmpDir, 'new.txt');

    const result = await writeLocalFile({ content: 'fresh\n', path: filePath });

    expect(result.success).toBe(true);

    const bytes = await readFile(filePath);
    expect(bytes.toString('utf8')).toBe('fresh\n');
  });
});
