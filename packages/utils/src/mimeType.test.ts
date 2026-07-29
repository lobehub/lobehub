import { afterEach, describe, expect, it, vi } from 'vitest';

import { getMimeType, resolveMimeType, tryGetMimeType } from './mimeType';

afterEach(() => {
  vi.doUnmock('node:path');
  vi.resetModules();
});

describe('browser compatibility', () => {
  it('detects a pasted image without relying on Node path.extname', async () => {
    vi.doMock('node:path', () => ({ default: {} }));
    vi.resetModules();

    const browserMimeType = await import('./mimeType');

    expect(browserMimeType.getMimeType('pasted-image.png')).toBe('image/png');
  });
});

describe('getMimeType', () => {
  describe('custom code file MIME types', () => {
    it('should return correct MIME type for Python files', () => {
      expect(getMimeType('script.py')).toBe('text/x-python');
      expect(getMimeType('/path/to/script.py')).toBe('text/x-python');
    });

    it('should return correct MIME type for Go files', () => {
      expect(getMimeType('main.go')).toBe('text/x-go');
      expect(getMimeType('/src/main.go')).toBe('text/x-go');
    });

    it('should return correct MIME type for Rust files', () => {
      expect(getMimeType('lib.rs')).toBe('text/x-rust');
      expect(getMimeType('/src/lib.rs')).toBe('text/x-rust');
    });

    it('should return correct MIME type for Ruby files', () => {
      expect(getMimeType('app.rb')).toBe('text/x-ruby');
    });

    it('should return correct MIME type for Kotlin files', () => {
      expect(getMimeType('Main.kt')).toBe('text/x-kotlin');
    });

    it('should return correct MIME type for Scala files', () => {
      expect(getMimeType('App.scala')).toBe('text/x-scala');
    });

    it('should return correct MIME type for Swift files', () => {
      expect(getMimeType('ContentView.swift')).toBe('text/x-swift');
    });

    it('should return correct MIME type for Haskell files', () => {
      expect(getMimeType('Main.hs')).toBe('text/x-haskell');
    });

    it('should return correct MIME type for Lua files', () => {
      expect(getMimeType('script.lua')).toBe('text/x-lua');
    });

    it('should return correct MIME type for Perl files', () => {
      expect(getMimeType('script.pl')).toBe('text/x-perl');
    });

    it('should return correct MIME type for R files', () => {
      expect(getMimeType('analysis.r')).toBe('text/x-r');
    });

    it('should return correct MIME type for Clojure files', () => {
      expect(getMimeType('core.clj')).toBe('text/x-clojure');
    });

    it('should return correct MIME type for Elixir files (.ex)', () => {
      expect(getMimeType('app.ex')).toBe('text/x-elixir');
    });

    it('should return correct MIME type for Elixir script files (.exs)', () => {
      expect(getMimeType('mix.exs')).toBe('text/x-elixir');
    });

    it('should return correct MIME type for Svelte files', () => {
      expect(getMimeType('App.svelte')).toBe('text/x-svelte');
    });

    it('should return correct MIME type for Vue files', () => {
      expect(getMimeType('App.vue')).toBe('text/x-vue');
    });
  });

  describe('case insensitivity for extensions', () => {
    it('should handle uppercase extensions', () => {
      expect(getMimeType('script.PY')).toBe('text/x-python');
      expect(getMimeType('main.GO')).toBe('text/x-go');
      expect(getMimeType('lib.RS')).toBe('text/x-rust');
    });

    it('should handle mixed-case extensions', () => {
      expect(getMimeType('App.Py')).toBe('text/x-python');
      expect(getMimeType('Main.Kt')).toBe('text/x-kotlin');
    });
  });

  describe('standard MIME types via mime package', () => {
    it('should return correct MIME type for JavaScript files', () => {
      expect(getMimeType('app.js')).toBe('text/javascript');
    });

    it('should return video/mp2t for .ts files (MPEG-2 Transport Stream per MIME registry)', () => {
      // Note: .ts is registered as MPEG-2 Transport Stream, not TypeScript
      expect(getMimeType('app.ts')).toBe('video/mp2t');
    });

    it('should return correct MIME type for JSON files', () => {
      expect(getMimeType('config.json')).toBe('application/json');
    });

    it('should return correct MIME type for HTML files', () => {
      expect(getMimeType('index.html')).toBe('text/html');
    });

    it('should return correct MIME type for CSS files', () => {
      expect(getMimeType('styles.css')).toBe('text/css');
    });

    it('should return correct MIME type for PNG images', () => {
      expect(getMimeType('photo.png')).toBe('image/png');
    });

    it('should return correct MIME type for JPEG images', () => {
      expect(getMimeType('photo.jpg')).toBe('image/jpeg');
    });

    it('should return correct MIME type for PDF files', () => {
      expect(getMimeType('document.pdf')).toBe('application/pdf');
    });

    it('should return correct MIME type for XML files', () => {
      expect(getMimeType('data.xml')).toBe('application/xml');
    });

    it('should return correct MIME type for plain text files', () => {
      expect(getMimeType('readme.txt')).toBe('text/plain');
    });

    it('should return correct MIME type for Markdown files', () => {
      expect(getMimeType('README.md')).toBe('text/markdown');
    });
  });

  describe('fallback to application/octet-stream', () => {
    it('should return application/octet-stream for unknown extensions', () => {
      expect(getMimeType('file.unknownext')).toBe('application/octet-stream');
      expect(getMimeType('archive.xyz123')).toBe('application/octet-stream');
    });

    it('should return application/octet-stream for files without extension', () => {
      expect(getMimeType('Makefile')).toBe('application/octet-stream');
      expect(getMimeType('Dockerfile')).toBe('application/octet-stream');
    });
  });

  describe('path handling', () => {
    it('should handle full paths with directories', () => {
      expect(getMimeType('/home/user/project/src/main.py')).toBe('text/x-python');
      expect(getMimeType('C:/Users/user/docs/file.json')).toBe('application/json');
    });

    it('should handle paths with dots in directory names', () => {
      expect(getMimeType('/path/to/v1.0/script.py')).toBe('text/x-python');
      expect(getMimeType('/path.to/files/image.png')).toBe('image/png');
    });

    it('should use the last extension when filename has multiple dots', () => {
      expect(getMimeType('archive.tar.gz')).toBe('application/gzip');
      expect(getMimeType('component.test.js')).toBe('text/javascript');
    });
  });
});

describe('tryGetMimeType', () => {
  it('returns the mime with charset for text responses', () => {
    expect(tryGetMimeType('/abs/path/style.css')).toBe('text/css; charset=utf-8');
    expect(tryGetMimeType('bundle.js')).toBe('text/javascript; charset=utf-8');
  });

  it('returns the mime without charset for binary responses', () => {
    expect(tryGetMimeType('icon.png')).toBe('image/png');
    expect(tryGetMimeType('font.woff2')).toBe('font/woff2');
  });

  it('returns undefined when the extension is unknown', () => {
    expect(tryGetMimeType('foo.unknownext')).toBeUndefined();
    expect(tryGetMimeType('Makefile')).toBeUndefined();
  });
});

describe('resolveMimeType', () => {
  it('resolves common web/data extensions via the extension lookup + charset', async () => {
    await expect(resolveMimeType('/repo/data.json', Buffer.from('{}'))).resolves.toBe(
      'application/json; charset=utf-8',
    );
    await expect(resolveMimeType('/repo/README.md', Buffer.from('# hi'))).resolves.toBe(
      'text/markdown; charset=utf-8',
    );
  });

  it('appends charset to custom code-language mimes', async () => {
    // .py → CUSTOM_MIME_TYPES text/x-python → text/ prefix → gains charset.
    const py = Buffer.from('print("hi")\n');
    await expect(resolveMimeType('/repo/script.py', py)).resolves.toBe(
      'text/x-python; charset=utf-8',
    );
  });

  it('serves preview-only image formats via the extension lookup', async () => {
    // Truly binary buffers so the sniff never asks us to downgrade.
    await expect(
      resolveMimeType('/repo/photo.heic', Buffer.from([0x00, 0xff, 0xd8, 0x00])),
    ).resolves.toBe('image/heic');
    await expect(
      resolveMimeType('/repo/diagram.bmp', Buffer.from([0x42, 0x4d, 0x00, 0x01])),
    ).resolves.toBe('image/bmp');
  });

  it('trusts magic bytes for binary formats even when the extension is unknown', async () => {
    // `.blob` isn't in mime-db, so file-type's magic sniff decides.
    const pngBytes = Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44,
      0x52,
    ]);
    await expect(resolveMimeType('/repo/mystery.blob', pngBytes)).resolves.toBe('image/png');
  });

  it('trusts magic bytes even when mime-db would lie about the extension', async () => {
    // Real MPEG-TS carries the 0x47 sync byte at 188-byte intervals. File-type
    // recognises it and serves video/mp2t regardless of extension.
    const mpegTs = Buffer.alloc(376);
    mpegTs[0] = 0x47;
    mpegTs[188] = 0x47;
    await expect(resolveMimeType('/repo/clip.ts', mpegTs)).resolves.toBe('video/mp2t');
  });

  it('downgrades to text/plain when mime-db claims binary but the buffer is text', async () => {
    // The classic .ts ambiguity: mime-db → video/mp2t, but TypeScript source
    // has no magic bytes and sniffs as text. The downgrade rule catches this
    // without an extension override.
    const tsSource = Buffer.from('export const foo = (x: number): number => x + 1;\n');
    await expect(resolveMimeType('/repo/module.ts', tsSource)).resolves.toBe(
      'text/plain; charset=utf-8',
    );

    // Same rule saves `.cjs` (mime-db → application/node).
    const cjsSource = Buffer.from(`module.exports = { plugins: ['@semantic-release/npm'] };\n`);
    await expect(resolveMimeType('/repo/.releaserc.cjs', cjsSource)).resolves.toBe(
      'text/plain; charset=utf-8',
    );
  });

  it('falls back to text/plain for unknown text extensions via the sniff', async () => {
    await expect(resolveMimeType('/repo/App.tsx', Buffer.from(''))).resolves.toBe(
      'text/plain; charset=utf-8',
    );
    const editorconfig = Buffer.from('root = true\n[*]\nindent_style = space\n');
    await expect(resolveMimeType('/repo/.editorconfig', editorconfig)).resolves.toBe(
      'text/plain; charset=utf-8',
    );
  });

  it('falls back to application/octet-stream when the sniff detects binary data', async () => {
    // No known extension and no recognisable magic bytes — the sniff sees
    // embedded null bytes and classifies as binary.
    const binary = Buffer.from([0x00, 0x01, 0x02, 0x03, 0x00, 0x01, 0x02, 0x03]);
    await expect(resolveMimeType('/repo/strange.blob', binary)).resolves.toBe(
      'application/octet-stream',
    );
  });
});
