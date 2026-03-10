import { describe, expect, it } from 'vitest';

import { getMimeType } from './mimeType';

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
