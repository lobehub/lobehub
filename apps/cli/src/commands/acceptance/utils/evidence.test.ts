import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { log } from '../../../utils/logger';
import {
  evidenceDescriptionForFile,
  evidenceTypeForFile,
  inlineTextEvidenceForFile,
  reportEvidence,
} from '.';

describe('reportEvidence — comparison normalization', () => {
  it('accepts plain string paths', () => {
    expect(reportEvidence('assets/a.png')).toEqual([{ path: 'assets/a.png' }]);
    expect(reportEvidence(['a.png', 'b.png']).map((e) => e.path)).toEqual(['a.png', 'b.png']);
  });

  it('keeps a comparison that carries both an id and a before/after role', () => {
    const [before, after] = reportEvidence([
      { comparison: { id: 'row', role: 'before' }, path: 'before.png' },
      { comparison: { id: 'row', label: '改后', role: 'after' }, path: 'after.png' },
    ]);

    expect(before.comparison).toEqual({
      id: 'row',
      label: undefined,
      layout: undefined,
      role: 'before',
    });
    expect(after.comparison).toEqual({
      id: 'row',
      label: '改后',
      layout: undefined,
      role: 'after',
    });
  });

  it('passes a vertical layout through and ignores any other value', () => {
    const forLayout = (layout: unknown) =>
      reportEvidence([{ comparison: { id: 'row', layout, role: 'before' }, path: 'a.png' }])[0]
        .comparison?.layout;

    expect(forLayout('vertical')).toBe('vertical');
    // Side by side is the default, so anything unrecognized simply falls back to it.
    expect(forLayout('horizontal')).toBeUndefined();
    expect(forLayout('diagonal')).toBeUndefined();
    expect(forLayout(undefined)).toBeUndefined();
  });

  // The report viewer pairs on `id`, so an id-less comparison could never render
  // side by side — dropping it here keeps the upload honest instead of shipping
  // metadata the UI silently ignores.
  it('drops a comparison missing an id, keeping the image as ordinary evidence', () => {
    const [item] = reportEvidence([{ comparison: { role: 'before' }, path: 'before.png' }]);

    expect(item).toEqual({ comparison: undefined, description: undefined, path: 'before.png' });
  });

  it('drops a comparison whose role is absent or unrecognized', () => {
    expect(
      reportEvidence([{ comparison: { id: 'x', role: 'middle' }, path: 'a.png' }])[0].comparison,
    ).toBeUndefined();
    expect(
      reportEvidence([{ comparison: { id: 'x' }, path: 'a.png' }])[0].comparison,
    ).toBeUndefined();
  });

  // The flat shape (`comparison: "row", role: "before"`) is the easiest one to
  // write from memory, and it used to be the ONLY malformed shape that produced
  // no warning: the guard parsed the field into an object first, so a string
  // read as "no comparison at all" and the ingest exited clean while the page
  // rendered two unpaired images.
  it('warns and drops a comparison that is not an object', () => {
    vi.mocked(log.warn).mockClear();

    const [item] = reportEvidence([
      { comparison: 'row', path: 'before.png', role: 'before' } as unknown,
    ]);

    expect(item).toEqual({ comparison: undefined, description: undefined, path: 'before.png' });
    expect(log.warn).toHaveBeenCalledWith(expect.stringContaining('before.png'));
  });

  it('warns for every malformed comparison shape, and stays quiet for a valid or absent one', () => {
    const warnsFor = (comparison: unknown) => {
      vi.mocked(log.warn).mockClear();
      reportEvidence([{ comparison, path: 'a.png' } as unknown]);
      return vi.mocked(log.warn).mock.calls.length > 0;
    };

    expect(warnsFor('row')).toBe(true);
    expect(warnsFor(['row'])).toBe(true);
    expect(warnsFor({ id: 'row' })).toBe(true);
    expect(warnsFor({ id: 'row', role: 'middle' })).toBe(true);

    // Falsy but present: someone wrote the field, so it is malformed rather
    // than absent. A truthiness guard would drop these without a word.
    expect(warnsFor('')).toBe(true);
    expect(warnsFor(0)).toBe(true);
    expect(warnsFor(false)).toBe(true);
    expect(warnsFor(Number.NaN)).toBe(true);

    // Absent is null/undefined only — an evidence item without a pair.
    expect(warnsFor({ id: 'row', role: 'before' })).toBe(false);
    expect(warnsFor(undefined)).toBe(false);
    expect(warnsFor(null)).toBe(false);
  });

  it('supports the `file` / `desc` aliases and skips entries with no path', () => {
    expect(
      reportEvidence([{ desc: 'a shot', file: 'a.png' }, { comparison: { id: 'x' } }]),
    ).toEqual([{ comparison: undefined, description: 'a shot', path: 'a.png' }]);
  });
});

describe('reportEvidence — video chapters', () => {
  beforeEach(() => {
    vi.mocked(log.warn).mockClear();
  });

  it('carries well-formed chapters on a video, sorted by time', () => {
    const [item] = reportEvidence([
      {
        chapters: [
          { kind: 'check', note: 'no skeleton', t: 7.9 },
          { kind: 'step', label: 'Scroll #1', t: 2 },
        ],
        path: 'proof/scroll.mp4',
      },
    ]);

    expect(item.chapters).toEqual([
      { kind: 'step', label: 'Scroll #1', t: 2 },
      { kind: 'check', note: 'no skeleton', t: 7.9 },
    ]);
    expect(log.warn).not.toHaveBeenCalled();
  });

  // A dropped marker is a claim the agent believes the reviewer will see.
  it('names how many markers it dropped and why', () => {
    const [item] = reportEvidence([
      {
        chapters: [
          { kind: 'step', label: 'Open', t: 0 },
          { kind: 'check', t: 3 },
        ],
        path: 'clip.webm',
      },
    ]);

    expect(item.chapters).toEqual([{ kind: 'step', label: 'Open', t: 0 }]);
    expect(log.warn).toHaveBeenCalledWith(expect.stringContaining('dropped 1 of 2 chapters'));
  });

  it('ignores chapters on a still image, and a chapters field that is not a list', () => {
    expect(
      reportEvidence([{ chapters: [{ kind: 'step', label: 'x', t: 0 }], path: 'a.png' }])[0]
        .chapters,
    ).toBeUndefined();
    expect(reportEvidence([{ chapters: 'intro', path: 'a.mp4' }])[0].chapters).toBeUndefined();
    expect(log.warn).toHaveBeenCalledTimes(2);
  });
});

describe('evidenceTypeForFile — markdown evidence', () => {
  it('maps .md / .markdown to the markdown medium, keeping .txt as text', () => {
    expect(evidenceTypeForFile('assets/root-cause.md')).toBe('markdown');
    expect(evidenceTypeForFile('assets/root-cause.markdown')).toBe('markdown');
    expect(evidenceTypeForFile('assets/root-cause.txt')).toBe('text');
  });

  it('types an audio clip as audio, not the binary-blob-as-text fallback', () => {
    // Before `audio` existed these fell through to `text`, so a TTS deliverable
    // published as an unreadable, unplayable artifact.
    expect(evidenceTypeForFile('assets/tts-zh.mp3')).toBe('audio');
    expect(evidenceTypeForFile('assets/reply.WAV')).toBe('audio');
    expect(evidenceTypeForFile('assets/voice.m4a')).toBe('audio');
    expect(evidenceTypeForFile('assets/tone.opus')).toBe('audio');
    // .webm stays video — the container is overwhelmingly used for screen clips.
    expect(evidenceTypeForFile('assets/flow.webm')).toBe('video');
  });

  it('inlines a small markdown file as content instead of uploading it', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'lh-evidence-'));
    const file = path.join(dir, 'root-cause.md');
    writeFileSync(file, '### 根因证据\n\n- `heteroSessionId` 未透传');

    try {
      expect(inlineTextEvidenceForFile(file, evidenceTypeForFile(file))).toBe(
        '### 根因证据\n\n- `heteroSessionId` 未透传',
      );
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });
});

describe('file evidence descriptions', () => {
  it('preserves an explicit description', () => {
    expect(evidenceDescriptionForFile('Goal final state', '/tmp/state.json')).toBe(
      'Goal final state',
    );
  });

  it('retains the basename when a file is inlined without a description', () => {
    expect(evidenceDescriptionForFile(undefined, '/tmp/goal-final-state.json')).toBe(
      'goal-final-state.json',
    );
    expect(evidenceDescriptionForFile('  ', '/tmp/events.json')).toBe('events.json');
  });

  it('does not invent a description for inline content', () => {
    expect(evidenceDescriptionForFile(undefined)).toBeUndefined();
  });
});
