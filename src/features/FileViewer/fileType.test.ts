import { describe, expect, it } from 'vitest';

import { isPdfFile } from './fileType';

describe('isPdfFile', () => {
  it('detects PDF files by MIME type', () => {
    expect(isPdfFile({ fileType: 'pdf' })).toBe(true);
    expect(isPdfFile({ fileType: 'application/pdf' })).toBe(true);
    expect(isPdfFile({ fileType: 'application/pdf; charset=utf-8' })).toBe(true);
    expect(isPdfFile({ fileType: 'APPLICATION/PDF' })).toBe(true);
    expect(isPdfFile({ fileType: 'application/x-pdf' })).toBe(true);
  });

  it('detects PDF files by filename or path extension', () => {
    expect(isPdfFile({ fileName: 'report.PDF' })).toBe(true);
    expect(isPdfFile({ path: '/tmp/demo.pdf' })).toBe(true);
    expect(isPdfFile({ fileName: 'untitled', path: '/tmp/demo.pdf' })).toBe(true);
    expect(isPdfFile({ fileName: '国内大模型蒸馏风波的来龙去脉 (1).pdf' })).toBe(true);
  });

  it('detects PDF documents whose fileType is a MIME string and name has no extension', () => {
    expect(
      isPdfFile({ fileName: '国内大模型蒸馏风波的来龙去脉', fileType: 'application/pdf' }),
    ).toBe(true);
  });

  it('detects PDF documents whose fileType is generic but source path ends with .pdf', () => {
    expect(
      isPdfFile({
        fileName: '国内大模型蒸馏风波的来龙去脉',
        fileType: 'custom/document',
        path: 'assets/495734/a3bedf85-3ccb-43c0-9e94-b526fb435bac.pdf',
      }),
    ).toBe(true);
  });

  it('detects PDF via signed URL path with query string', () => {
    expect(
      isPdfFile({
        fileName: '国内大模型蒸馏风波的来龙去脉',
        fileType: 'custom/document',
        path: 'https://lobechat-cloud.example.r2.cloudflarestorage.com/assets/495734/a3bedf85.pdf?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Signature=abc',
      }),
    ).toBe(true);
  });

  it('rejects non-PDF files', () => {
    expect(isPdfFile({ fileName: 'report.docx', fileType: 'application/msword' })).toBe(false);
    expect(isPdfFile({ path: '/tmp/notes.txt' })).toBe(false);
    expect(isPdfFile({ fileType: 'custom/document' })).toBe(false);
    expect(isPdfFile({})).toBe(false);
  });
});
