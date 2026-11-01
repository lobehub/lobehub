import { describe, expect, it } from 'vitest';

import { systemPrompt } from '../systemRole';

describe('systemRole template', () => {
  it('pairs {{defaultShell}} with {{shellSyntaxGuidance}}', () => {
    expect(systemPrompt).toContain('{{defaultShell}}');
    expect(systemPrompt).toContain('{{shellSyntaxGuidance}}');
  });

  it('teaches image reads and the localFile response format', () => {
    expect(systemPrompt).toContain('Image files are uploaded as visual tool results');
    expect(systemPrompt).toContain('base64');
    expect(systemPrompt).toContain('<localFile');
  });

  /**
   * `{{hostname}}` has no generator in the desktop placeholder map, so a
   * template that references it renders the raw token on the desktop client.
   */
  it('only references placeholders every host can render', () => {
    expect(systemPrompt).not.toContain('{{hostname}}');
  });
});
