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

  it('should handle various image file types with correct MIME types', async () => {
    const testFiles = {
      'photo.jpg': new TextEncoder().encode('JPEG'),
      'photo2.jpeg': new TextEncoder().encode('JPEG2'),
      'graphic.gif': new TextEncoder().encode('GIF'),
      'bitmap.bmp': new TextEncoder().encode('BMP'),
      'vector.svg': new TextEncoder().encode('SVG'),
      'modern.webp': new TextEncoder().encode('WEBP'),
    };

    const zipped = await new Promise<Uint8Array>((resolve, reject) => {
      zip(testFiles, (error, data) => {
        if (error) reject(error);
        else resolve(data);
      });
    });

    const zipFile = new File([new Uint8Array(zipped)], 'images.zip', { type: 'application/zip' });
    const extractedFiles = await unzipFile(zipFile);

    expect(extractedFiles).toHaveLength(6);
    expect(extractedFiles.find((f) => f.name === 'photo.jpg')?.type).toBe('image/jpeg');
    expect(extractedFiles.find((f) => f.name === 'photo2.jpeg')?.type).toBe('image/jpeg');
    expect(extractedFiles.find((f) => f.name === 'graphic.gif')?.type).toBe('image/gif');
    expect(extractedFiles.find((f) => f.name === 'bitmap.bmp')?.type).toBe('image/bmp');
    expect(extractedFiles.find((f) => f.name === 'vector.svg')?.type).toBe('image/svg+xml');
    expect(extractedFiles.find((f) => f.name === 'modern.webp')?.type).toBe('image/webp');
  });

  it('should handle various code file types with correct MIME types', async () => {
    const testFiles = {
      'script.js': new TextEncoder().encode('JS'),
      'component.jsx': new TextEncoder().encode('JSX'),
      'module.ts': new TextEncoder().encode('TS'),
      'component.tsx': new TextEncoder().encode('TSX'),
      'script.py': new TextEncoder().encode('Python'),
      'app.rb': new TextEncoder().encode('Ruby'),
      'main.go': new TextEncoder().encode('Go'),
      'lib.rs': new TextEncoder().encode('Rust'),
      'Main.java': new TextEncoder().encode('Java'),
      'source.c': new TextEncoder().encode('C'),
      'source.cpp': new TextEncoder().encode('C++'),
      'App.cs': new TextEncoder().encode('C#'),
      'index.php': new TextEncoder().encode('PHP'),
      'script.sh': new TextEncoder().encode('Shell'),
    };

    const zipped = await new Promise<Uint8Array>((resolve, reject) => {
      zip(testFiles, (error, data) => {
        if (error) reject(error);
        else resolve(data);
      });
    });

    const zipFile = new File([new Uint8Array(zipped)], 'code.zip', { type: 'application/zip' });
    const extractedFiles = await unzipFile(zipFile);

    expect(extractedFiles).toHaveLength(14);
    expect(extractedFiles.find((f) => f.name === 'script.js')?.type).toBe('text/javascript');
    expect(extractedFiles.find((f) => f.name === 'component.jsx')?.type).toBe('text/javascript');
    expect(extractedFiles.find((f) => f.name === 'module.ts')?.type).toBe('text/typescript');
    expect(extractedFiles.find((f) => f.name === 'component.tsx')?.type).toBe('text/typescript');
    expect(extractedFiles.find((f) => f.name === 'script.py')?.type).toBe('text/x-python');
    expect(extractedFiles.find((f) => f.name === 'app.rb')?.type).toBe('text/x-ruby');
    expect(extractedFiles.find((f) => f.name === 'main.go')?.type).toBe('text/x-go');
    expect(extractedFiles.find((f) => f.name === 'lib.rs')?.type).toBe('text/x-rust');
    expect(extractedFiles.find((f) => f.name === 'Main.java')?.type).toBe('text/x-java');
    expect(extractedFiles.find((f) => f.name === 'source.c')?.type).toBe('text/x-c');
    expect(extractedFiles.find((f) => f.name === 'source.cpp')?.type).toBe('text/x-c++');
    expect(extractedFiles.find((f) => f.name === 'App.cs')?.type).toBe('text/x-csharp');
    expect(extractedFiles.find((f) => f.name === 'index.php')?.type).toBe(
      'application/x-httpd-php',
    );
    expect(extractedFiles.find((f) => f.name === 'script.sh')?.type).toBe('application/x-sh');
  });

  it('should handle various document file types with correct MIME types', async () => {
    const testFiles = {
      'data.csv': new TextEncoder().encode('CSV'),
      'data.json': new TextEncoder().encode('JSON'),
      'config.xml': new TextEncoder().encode('XML'),
      'styles.css': new TextEncoder().encode('CSS'),
      'page.html': new TextEncoder().encode('HTML'),
      'readme.md': new TextEncoder().encode('Markdown'),
      'note.txt': new TextEncoder().encode('Text'),
      'old.doc': new TextEncoder().encode('Word'),
      'new.docx': new TextEncoder().encode('Word New'),
      'sheet.xls': new TextEncoder().encode('Excel'),
      'sheet.xlsx': new TextEncoder().encode('Excel New'),
      'slides.ppt': new TextEncoder().encode('PowerPoint'),
      'slides.pptx': new TextEncoder().encode('PowerPoint New'),
      'rich.rtf': new TextEncoder().encode('RTF'),
    };

    const zipped = await new Promise<Uint8Array>((resolve, reject) => {
      zip(testFiles, (error, data) => {
        if (error) reject(error);
        else resolve(data);
      });
    });

    const zipFile = new File([new Uint8Array(zipped)], 'docs.zip', { type: 'application/zip' });
    const extractedFiles = await unzipFile(zipFile);

    expect(extractedFiles).toHaveLength(14);
    expect(extractedFiles.find((f) => f.name === 'data.csv')?.type).toBe('text/csv');
    expect(extractedFiles.find((f) => f.name === 'data.json')?.type).toBe('application/json');
    expect(extractedFiles.find((f) => f.name === 'config.xml')?.type).toBe('application/xml');
    expect(extractedFiles.find((f) => f.name === 'styles.css')?.type).toBe('text/css');
    expect(extractedFiles.find((f) => f.name === 'page.html')?.type).toBe('text/html');
    expect(extractedFiles.find((f) => f.name === 'readme.md')?.type).toBe('text/markdown');
    expect(extractedFiles.find((f) => f.name === 'note.txt')?.type).toBe('text/plain');
    expect(extractedFiles.find((f) => f.name === 'old.doc')?.type).toBe('application/msword');
    expect(extractedFiles.find((f) => f.name === 'new.docx')?.type).toBe(
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    );
    expect(extractedFiles.find((f) => f.name === 'sheet.xls')?.type).toBe(
      'application/vnd.ms-excel',
    );
    expect(extractedFiles.find((f) => f.name === 'sheet.xlsx')?.type).toBe(
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    expect(extractedFiles.find((f) => f.name === 'slides.ppt')?.type).toBe(
      'application/vnd.ms-powerpoint',
    );
    expect(extractedFiles.find((f) => f.name === 'slides.pptx')?.type).toBe(
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    );
    expect(extractedFiles.find((f) => f.name === 'rich.rtf')?.type).toBe('application/rtf');
  });

  it('should use octet-stream for unknown file extensions', async () => {
    const testFiles = {
      'file.unknown': new TextEncoder().encode('Unknown'),
      'data.xyz': new TextEncoder().encode('XYZ'),
      'binary.bin': new TextEncoder().encode('Binary'),
    };

    const zipped = await new Promise<Uint8Array>((resolve, reject) => {
      zip(testFiles, (error, data) => {
        if (error) reject(error);
        else resolve(data);
      });
    });

    const zipFile = new File([new Uint8Array(zipped)], 'unknown.zip', {
      type: 'application/zip',
    });
    const extractedFiles = await unzipFile(zipFile);

    expect(extractedFiles).toHaveLength(3);
    extractedFiles.forEach((file) => {
      expect(file.type).toBe('application/octet-stream');
    });
  });

  it('should handle files without extensions', async () => {
    const testFiles = {
      LICENSE: new TextEncoder().encode('License text'),
      Makefile: new TextEncoder().encode('Make commands'),
      README: new TextEncoder().encode('Readme'),
    };

    const zipped = await new Promise<Uint8Array>((resolve, reject) => {
      zip(testFiles, (error, data) => {
        if (error) reject(error);
        else resolve(data);
      });
    });

    const zipFile = new File([new Uint8Array(zipped)], 'noext.zip', { type: 'application/zip' });
    const extractedFiles = await unzipFile(zipFile);

    expect(extractedFiles).toHaveLength(3);
    extractedFiles.forEach((file) => {
      expect(file.type).toBe('application/octet-stream');
    });
  });

  it('should handle case-insensitive file extensions', async () => {
    const testFiles = {
      'FILE.PNG': new TextEncoder().encode('PNG'),
      'Script.JS': new TextEncoder().encode('JS'),
      'Document.PDF': new TextEncoder().encode('PDF'),
      'DATA.JSON': new TextEncoder().encode('JSON'),
    };

    const zipped = await new Promise<Uint8Array>((resolve, reject) => {
      zip(testFiles, (error, data) => {
        if (error) reject(error);
        else resolve(data);
      });
    });

    const zipFile = new File([new Uint8Array(zipped)], 'mixed.zip', { type: 'application/zip' });
    const extractedFiles = await unzipFile(zipFile);

    expect(extractedFiles).toHaveLength(4);
    expect(extractedFiles.find((f) => f.name === 'FILE.PNG')?.type).toBe('image/png');
    expect(extractedFiles.find((f) => f.name === 'Script.JS')?.type).toBe('text/javascript');
    expect(extractedFiles.find((f) => f.name === 'Document.PDF')?.type).toBe('application/pdf');
    expect(extractedFiles.find((f) => f.name === 'DATA.JSON')?.type).toBe('application/json');
  });

  it('should handle files with multiple dots in filename', async () => {
    const testFiles = {
      'my.file.name.txt': new TextEncoder().encode('Text'),
      'archive.tar.gz': new TextEncoder().encode('Archive'),
      'config.test.js': new TextEncoder().encode('Test config'),
    };

    const zipped = await new Promise<Uint8Array>((resolve, reject) => {
      zip(testFiles, (error, data) => {
        if (error) reject(error);
        else resolve(data);
      });
    });

    const zipFile = new File([new Uint8Array(zipped)], 'dots.zip', { type: 'application/zip' });
    const extractedFiles = await unzipFile(zipFile);

    expect(extractedFiles).toHaveLength(3);
    expect(extractedFiles.find((f) => f.name === 'my.file.name.txt')?.type).toBe('text/plain');
    expect(extractedFiles.find((f) => f.name === 'config.test.js')?.type).toBe('text/javascript');
    // .gz extension defaults to octet-stream
    expect(extractedFiles.find((f) => f.name === 'archive.tar.gz')?.type).toBe(
      'application/octet-stream',
    );
  });

  it('should handle special characters in filenames', async () => {
    const testFiles = {
      'file with spaces.txt': new TextEncoder().encode('Spaces'),
      'file-with-dashes.js': new TextEncoder().encode('Dashes'),
      'file_with_underscores.py': new TextEncoder().encode('Underscores'),
      'file(with)parens.md': new TextEncoder().encode('Parens'),
    };

    const zipped = await new Promise<Uint8Array>((resolve, reject) => {
      zip(testFiles, (error, data) => {
        if (error) reject(error);
        else resolve(data);
      });
    });

    const zipFile = new File([new Uint8Array(zipped)], 'special.zip', {
      type: 'application/zip',
    });
    const extractedFiles = await unzipFile(zipFile);

    expect(extractedFiles).toHaveLength(4);
    expect(extractedFiles.find((f) => f.name === 'file with spaces.txt')?.type).toBe('text/plain');
    expect(extractedFiles.find((f) => f.name === 'file-with-dashes.js')?.type).toBe(
      'text/javascript',
    );
    expect(extractedFiles.find((f) => f.name === 'file_with_underscores.py')?.type).toBe(
      'text/x-python',
    );
    expect(extractedFiles.find((f) => f.name === 'file(with)parens.md')?.type).toBe(
      'text/markdown',
    );
  });

  it('should handle deeply nested file paths', async () => {
    const testFiles = {
      'a/b/c/d/e/deep.txt': new TextEncoder().encode('Deep file'),
      'folder/subfolder/file.js': new TextEncoder().encode('Nested'),
    };

    const zipped = await new Promise<Uint8Array>((resolve, reject) => {
      zip(testFiles, (error, data) => {
        if (error) reject(error);
        else resolve(data);
      });
    });

    const zipFile = new File([new Uint8Array(zipped)], 'nested.zip', { type: 'application/zip' });
    const extractedFiles = await unzipFile(zipFile);

    expect(extractedFiles).toHaveLength(2);
    expect(extractedFiles.find((f) => f.name === 'deep.txt')).toBeDefined();
    expect(extractedFiles.find((f) => f.name === 'file.js')).toBeDefined();
  });

  it('should filter out only __MACOSX files while keeping similar named files', async () => {
    const testFiles = {
      '__MACOSX/._file.txt': new TextEncoder().encode('Mac metadata'),
      '__MACOSX/folder/._image.png': new TextEncoder().encode('Mac metadata 2'),
      'regular_file.txt': new TextEncoder().encode('Regular file'),
      'macosx_related.txt': new TextEncoder().encode('Not a __MACOSX directory'),
    };

    const zipped = await new Promise<Uint8Array>((resolve, reject) => {
      zip(testFiles, (error, data) => {
        if (error) reject(error);
        else resolve(data);
      });
    });

    const zipFile = new File([new Uint8Array(zipped)], 'macos.zip', { type: 'application/zip' });
    const extractedFiles = await unzipFile(zipFile);

    expect(extractedFiles).toHaveLength(2);
    expect(extractedFiles.map((f) => f.name).sort()).toEqual([
      'macosx_related.txt',
      'regular_file.txt',
    ]);
  });

  it('should handle ZIP with only filtered content', async () => {
    const testFiles = {
      '.hidden1': new TextEncoder().encode('Hidden'),
      '.hidden2': new TextEncoder().encode('Hidden'),
      '__MACOSX/._file': new TextEncoder().encode('Mac'),
      'folder/': new Uint8Array(0),
    };

    const zipped = await new Promise<Uint8Array>((resolve, reject) => {
      zip(testFiles, (error, data) => {
        if (error) reject(error);
        else resolve(data);
      });
    });

    const zipFile = new File([new Uint8Array(zipped)], 'filtered.zip', {
      type: 'application/zip',
    });
    const extractedFiles = await unzipFile(zipFile);

    expect(extractedFiles).toHaveLength(0);
  });

  it('should preserve file content integrity through extraction', async () => {
    const originalContent = 'This is a test file with some content! 123 @#$%';
    const testFiles = {
      'test.txt': new TextEncoder().encode(originalContent),
    };

    const zipped = await new Promise<Uint8Array>((resolve, reject) => {
      zip(testFiles, (error, data) => {
        if (error) reject(error);
        else resolve(data);
      });
    });

    const zipFile = new File([new Uint8Array(zipped)], 'content.zip', {
      type: 'application/zip',
    });
    const extractedFiles = await unzipFile(zipFile);

    expect(extractedFiles).toHaveLength(1);
    const extractedContent = await extractedFiles[0].text();
    expect(extractedContent).toBe(originalContent);
  });
});
