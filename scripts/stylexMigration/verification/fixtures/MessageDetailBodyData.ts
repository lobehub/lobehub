const longLine = 'A wide code line that is longer than the portal column. '.repeat(4);

const content = [
  '## Message detail',
  '',
  'A paragraph of message text that wraps across the portal width to show the body rhythm.',
  '',
  '- First point',
  '- Second point',
  '',
  '> Quoted reply',
  '',
  '| Column | Value |',
  '| ------ | ----- |',
  '| Width  | 920   |',
  '',
  '```text',
  longLine,
  '```',
  '',
  'Closing paragraph after the table.',
].join('\n');

const state = {
  clearPortalStack: () => {},
  message: { content },
};

type FixtureChatState = typeof state;

export const useChatStore = <T>(selector: (s: FixtureChatState) => T): T => selector(state);

export const chatPortalSelectors = {
  messageDetailId: () => 'fixture-message',
};

export const dbMessageSelectors = {
  getDbMessageById: () => (s: FixtureChatState) => s.message,
};
