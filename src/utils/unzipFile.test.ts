import { zip } from 'fflate';
import { describe, expect, it } from 'vitest';

import { unzipFile } from './unzipFile';

describe('unzipFile', () => {
  it('should extract files from a ZIP archive', async () => {
    // Create a mock ZIP file with test data
    const testFiles = {
      'test.txt': new TextEncoder().encode('Hello, World!'),
      'folder/nested.txt': new TextEncoder().encode('Nested file content'),
    };

    const zipped = await new Promise<Uint8Array>((resolve, reject) => {
      zip(testFiles, (error, data) => {
        if (error) reject(error);
        else resolve(data);
      });
    });

    const zipFile = new File([new Uint8Array(zipped)], 'test.zip', { type: 'application/zip' });

    const extractedFiles = await unzipFile(zipFile);

    expect(extractedFiles).toHaveLength(2);
    expect(extractedFiles[0].name).toBe('test.txt');
    expect(extractedFiles[1].name).toBe('nested.txt');

    // Verify file contents
    const content1 = await extractedFiles[0].text();
    expect(content1).toBe('Hello, World!');

    const content2 = await extractedFiles[1].text();
    expect(content2).toBe('Nested file content');
  });

  it('should skip directories in ZIP archive', async () => {
    const testFiles = {
      'file.txt': new TextEncoder().encode('File content'),
      'folder/': new Uint8Array(0), // Directory entry
    };

    const zipped = await new Promise<Uint8Array>((resolve, reject) => {
      zip(testFiles, (error, data) => {
        if (error) reject(error);
        else resolve(data);
      });
    });

    const zipFile = new File([new Uint8Array(zipped)], 'test.zip', { type: 'application/zip' });

    const extractedFiles = await unzipFile(zipFile);

    expect(extractedFiles).toHaveLength(1);
    expect(extractedFiles[0].name).toBe('file.txt');
  });

  it('should skip hidden files and __MACOSX directories', async () => {
    const testFiles = {
      '.hidden': new TextEncoder().encode('Hidden file'),
      '__MACOSX/._file.txt': new TextEncoder().encode('Mac metadata'),
      'visible.txt': new TextEncoder().encode('Visible file'),
    };

    const zipped = await new Promise<Uint8Array>((resolve, reject) => {
      zip(testFiles, (error, data) => {
        if (error) reject(error);
        else resolve(data);
      });
    });

    const zipFile = new File([new Uint8Array(zipped)], 'test.zip', { type: 'application/zip' });

    const extractedFiles = await unzipFile(zipFile);

    expect(extractedFiles).toHaveLength(1);
    expect(extractedFiles[0].name).toBe('visible.txt');
  });

  it('should set correct MIME types for extracted files', async () => {
    const testFiles = {
      'document.pdf': new TextEncoder().encode('PDF content'),
      'image.png': new TextEncoder().encode('PNG content'),
      'code.ts': new TextEncoder().encode('TypeScript code'),
    };

    const zipped = await new Promise<Uint8Array>((resolve, reject) => {
      zip(testFiles, (error, data) => {
        if (error) reject(error);
        else resolve(data);
      });
    });

    const zipFile = new File([new Uint8Array(zipped)], 'test.zip', { type: 'application/zip' });

    const extractedFiles = await unzipFile(zipFile);

    expect(extractedFiles).toHaveLength(3);
    expect(extractedFiles.find((f) => f.name === 'document.pdf')?.type).toBe('application/pdf');
    expect(extractedFiles.find((f) => f.name === 'image.png')?.type).toBe('image/png');
    expect(extractedFiles.find((f) => f.name === 'code.ts')?.type).toBe('text/typescript');
  });

  it('should handle empty ZIP files', async () => {
    const testFiles = {};

    const zipped = await new Promise<Uint8Array>((resolve, reject) => {
      zip(testFiles, (error, data) => {
        if (error) reject(error);
        else resolve(data);
      });
    });

    const zipFile = new File([new Uint8Array(zipped)], 'empty.zip', { type: 'application/zip' });

    const extractedFiles = await unzipFile(zipFile);

    expect(extractedFiles).toHaveLength(0);
  });

  it('should reject on invalid ZIP file', async () => {
    const invalidFile = new File([new Uint8Array([1, 2, 3, 4])], 'invalid.zip', {
      type: 'application/zip',
    });

    await expect(unzipFile(invalidFile)).rejects.toThrow();
  });
});
