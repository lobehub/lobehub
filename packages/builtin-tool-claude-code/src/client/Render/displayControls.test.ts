import { describe, expect, it } from 'vitest';

import { ClaudeCodeApiName } from '../../types';
import { resolveClaudeCodeRenderDisplayControl } from './displayControls';

const uploaded = { images: [{ mediaType: 'image/png', url: 'https://cdn/a.png' }] };

describe('resolveClaudeCodeRenderDisplayControl', () => {
  describe('Read', () => {
    it('expands once the result carries an uploaded image', () => {
      expect(resolveClaudeCodeRenderDisplayControl(ClaudeCodeApiName.Read, uploaded)).toBe(
        'expand',
      );
    });

    it('stays collapsed for source text, so a Read never dumps a file into the transcript', () => {
      expect(resolveClaudeCodeRenderDisplayControl(ClaudeCodeApiName.Read)).toBeUndefined();
      expect(resolveClaudeCodeRenderDisplayControl(ClaudeCodeApiName.Read, {})).toBeUndefined();
      expect(
        resolveClaudeCodeRenderDisplayControl(ClaudeCodeApiName.Read, { images: [] }),
      ).toBeUndefined();
    });

    it('stays collapsed when the image failed to upload (no url to render)', () => {
      // The pipeline drops a failed entry, but an entry with no `url` must not
      // expand an empty card — the `[Image: …]` placeholder is the fallback.
      expect(
        resolveClaudeCodeRenderDisplayControl(ClaudeCodeApiName.Read, {
          images: [{ mediaType: 'image/png' }],
        }),
      ).toBeUndefined();
    });

    it('is still collapsed while the call is in flight (no result yet)', () => {
      expect(
        resolveClaudeCodeRenderDisplayControl(ClaudeCodeApiName.Read, undefined),
      ).toBeUndefined();
    });
  });

  describe('in-app browser screenshot', () => {
    const screenshot = 'mcp__lobe_cc__browser_screenshot';

    it('expands once the capture has been uploaded, so the page is visible without unfolding', () => {
      expect(resolveClaudeCodeRenderDisplayControl(screenshot, uploaded)).toBe('expand');
    });

    it('stays collapsed while in flight or when the upload failed', () => {
      expect(resolveClaudeCodeRenderDisplayControl(screenshot)).toBeUndefined();
      expect(
        resolveClaudeCodeRenderDisplayControl(screenshot, { images: [{ mediaType: 'image/png' }] }),
      ).toBeUndefined();
    });

    it('leaves the other browser tools collapsed', () => {
      expect(
        resolveClaudeCodeRenderDisplayControl('mcp__lobe_cc__browser_navigate'),
      ).toBeUndefined();
      expect(
        resolveClaudeCodeRenderDisplayControl('mcp__lobe_cc__browser_snapshot', uploaded),
      ).toBeUndefined();
    });
  });

  it('keeps the static map for every other api, regardless of pluginState', () => {
    expect(resolveClaudeCodeRenderDisplayControl(ClaudeCodeApiName.Edit)).toBe('expand');
    expect(resolveClaudeCodeRenderDisplayControl(ClaudeCodeApiName.TodoWrite)).toBe('expand');
    // An unrelated api with images on its result must not be force-expanded.
    expect(resolveClaudeCodeRenderDisplayControl(ClaudeCodeApiName.Grep, uploaded)).toBeUndefined();
  });
});
