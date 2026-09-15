import { describe, expect, it } from 'vitest';

import {
  EXTENSION_LANGUAGES_FOR_TEST,
  FILENAME_LANGUAGES_FOR_TEST,
  getEditorLanguage,
  isSupportedEditorMode,
} from './language';

describe('getEditorLanguage', () => {
  it('resolves by extension, ignoring the directory prefix', () => {
    expect(getEditorLanguage('/Users/a/project/src/index.ts')).toEqual({
      label: 'TypeScript',
      mode: 'typescript',
    });
    expect(getEditorLanguage('C:\\repo\\main.rs')).toEqual({ label: 'Rust', mode: 'rust' });
  });

  it('maps every style-sheet flavour onto a grammar the bundle ships', () => {
    // SCSS used to resolve to an id with no grammar behind it, so the file
    // rendered as unhighlighted plain text.
    expect(getEditorLanguage('theme.scss').mode).toBe('sass');
    expect(getEditorLanguage('theme.less').mode).toBe('css');
    expect(getEditorLanguage('theme.css').mode).toBe('css');
  });

  it('keeps a language on its own grammar rather than a near neighbour', () => {
    // Downgrading these to a lookalike grammar visibly weakens highlighting;
    // the bundle registers all three under their own name.
    expect(getEditorLanguage('Cargo.toml').mode).toBe('toml');
    expect(getEditorLanguage('Main.kt').mode).toBe('kotlin');
    expect(getEditorLanguage('Build.scala').mode).toBe('scala');
  });

  it('maps every shell dialect onto the shell grammar', () => {
    expect(getEditorLanguage('deploy.sh').mode).toBe('shell');
    expect(getEditorLanguage('setup.zsh').mode).toBe('shell');
    expect(getEditorLanguage('.bashrc').mode).toBe('shell');
  });

  it('keeps the reported name when a language borrows another grammar', () => {
    expect(getEditorLanguage('App.svelte')).toEqual({ label: 'Svelte', mode: 'html' });
    expect(getEditorLanguage('notes.tex')).toEqual({ label: 'LaTeX', mode: 'stex' });
  });

  it('recognises extensionless files by name', () => {
    expect(getEditorLanguage('Dockerfile').mode).toBe('dockerfile');
    expect(getEditorLanguage('some/dir/Makefile').mode).toBe('makefile');
    expect(getEditorLanguage('.gitignore').mode).toBe('properties');
  });

  it('reads a qualified name from its leading segment', () => {
    expect(getEditorLanguage('.env.production').mode).toBe('properties');
    expect(getEditorLanguage('Dockerfile.dev').mode).toBe('dockerfile');
  });

  it('prefers a real extension over the leading segment', () => {
    expect(getEditorLanguage('Makefile.md')).toEqual({ label: 'Markdown', mode: '' });
  });

  it('falls back to plain text instead of guessing', () => {
    expect(getEditorLanguage('archive.unknownext')).toEqual({ label: 'Plain Text', mode: '' });
    expect(getEditorLanguage('')).toEqual({ label: 'Plain Text', mode: '' });
    expect(getEditorLanguage(undefined)).toEqual({ label: 'Plain Text', mode: '' });
  });

  it('only ever emits a grammar the bundle ships', () => {
    const entries = [
      ...Object.values(FILENAME_LANGUAGES_FOR_TEST),
      ...Object.values(EXTENSION_LANGUAGES_FOR_TEST),
    ];

    const unsupported = entries
      .filter((entry) => entry.mode !== '' && !isSupportedEditorMode(entry.mode))
      .map((entry) => `${entry.label} -> ${entry.mode}`);

    expect(unsupported).toEqual([]);
  });
});
