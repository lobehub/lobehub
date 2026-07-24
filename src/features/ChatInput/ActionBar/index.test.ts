import { describe, expect, it } from 'vitest';

import { filterChatOnlyActions } from './filterChatOnlyActions';

describe('filterChatOnlyActions', () => {
  it('keeps runtime mode, attachments, formatting, and chat operations while hiding configuration actions', () => {
    expect(
      filterChatOnlyActions([
        'agentMode',
        'model',
        'search',
        'memory',
        'fileUpload',
        'tools',
        '---',
        ['typo', 'params', 'clear'],
      ]),
    ).toEqual(['agentMode', 'model', 'fileUpload', '---', ['typo', 'clear']]);
  });

  it('keeps the icon model trigger for chat-only members instead of degrading to the text label', () => {
    expect(filterChatOnlyActions(['model', 'plus'])).toEqual(['model', 'plus']);
    expect(filterChatOnlyActions(['modelLabel', 'plus'])).toEqual(['modelLabel', 'plus']);
  });
});
