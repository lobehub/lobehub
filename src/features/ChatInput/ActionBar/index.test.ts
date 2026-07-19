import { describe, expect, it } from 'vitest';

import { filterChatOnlyActions } from './filterChatOnlyActions';

describe('filterChatOnlyActions', () => {
  it('keeps attachments, formatting, and chat operations while hiding configuration actions', () => {
    expect(
      filterChatOnlyActions([
        'model',
        'search',
        'memory',
        'fileUpload',
        'tools',
        '---',
        ['typo', 'params', 'clear'],
      ]),
    ).toEqual(['modelLabel', 'fileUpload', '---', ['typo', 'clear']]);
  });

  it('shows the current model label instead of an icon-only selector for chat-only members', () => {
    expect(filterChatOnlyActions(['model', 'plus'])).toEqual(['modelLabel', 'plus']);
    expect(filterChatOnlyActions(['modelLabel', 'plus'])).toEqual(['modelLabel', 'plus']);
  });
});
