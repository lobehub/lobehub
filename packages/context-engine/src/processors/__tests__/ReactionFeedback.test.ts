import { describe, expect, it } from 'vitest';

import { ReactionFeedbackProcessor } from '../ReactionFeedback';

const createContext = (messages: any[]) => ({
  initialState: {
    messages: [],
    model: 'gpt-4',
    provider: 'openai',
    systemRole: '',
    tools: [],
  },
  isAborted: false,
  messages,
  metadata: {
    maxTokens: 4096,
    model: 'gpt-4',
  },
});

const createMessage = (
  id: string,
  role: string,
  content: string | any[],
  reactions?: { count: number; emoji: string; users: string[] }[],
) => ({
  content,
  createdAt: Date.now(),
  id,
  role,
  updatedAt: Date.now(),
  ...(reactions ? { metadata: { reactions } } : {}),
});

describe('ReactionFeedbackProcessor', () => {
  it('should skip processing when disabled', async () => {
    const processor = new ReactionFeedbackProcessor({ enabled: false });

    const context = createContext([
      createMessage('1', 'assistant', 'Hello', [{ count: 1, emoji: '👍', users: ['user1'] }]),
      createMessage('2', 'user', 'Thanks'),
    ]);

    const result = await processor.process(context);

    expect(result.messages[0].content).toBe('Hello');
    expect(result.messages[1].content).toBe('Thanks');
    expect(result.metadata.reactionFeedbackProcessed).toBeUndefined();
  });

  it('should inject feedback emoji into the next user message', async () => {
    const processor = new ReactionFeedbackProcessor({ enabled: true });

    const context = createContext([
      createMessage('1', 'user', 'Hi'),
      createMessage('2', 'assistant', 'Hello!', [{ count: 1, emoji: '👍', users: ['user1'] }]),
      createMessage('3', 'user', 'Tell me more'),
    ]);

    const result = await processor.process(context);

    expect(result.messages[0].content).toBe('Hi');
    expect(result.messages[1].content).toBe('Hello!');
    expect(result.messages[2].content).toBe('[User Feedback Emoji: 👍]\n\nTell me more');
    expect(result.metadata.reactionFeedbackProcessed).toBe(1);
  });

  it('should handle multiple reactions on one assistant message', async () => {
    const processor = new ReactionFeedbackProcessor({ enabled: true });

    const context = createContext([
      createMessage('1', 'assistant', 'Great answer', [
        { count: 1, emoji: '👍', users: ['user1'] },
        { count: 1, emoji: '🚀', users: ['user1'] },
      ]),
      createMessage('2', 'user', 'Continue'),
    ]);

    const result = await processor.process(context);

    expect(result.messages[1].content).toBe('[User Feedback Emoji: 👍 🚀]\n\nContinue');
    expect(result.metadata.reactionFeedbackProcessed).toBe(2);
  });

  it('should accumulate emojis from multiple assistant messages into one user message', async () => {
    const processor = new ReactionFeedbackProcessor({ enabled: true });

    const context = createContext([
      createMessage('1', 'assistant', 'First response', [
        { count: 1, emoji: '👍', users: ['user1'] },
      ]),
      createMessage('2', 'assistant', 'Second response', [
        { count: 1, emoji: '👎', users: ['user1'] },
      ]),
      createMessage('3', 'user', 'Next question'),
    ]);

    const result = await processor.process(context);

    expect(result.messages[2].content).toBe('[User Feedback Emoji: 👍 👎]\n\nNext question');
    expect(result.metadata.reactionFeedbackProcessed).toBe(2);
  });

  it('should not modify assistant messages', async () => {
    const processor = new ReactionFeedbackProcessor({ enabled: true });

    const context = createContext([
      createMessage('1', 'assistant', 'Response with reaction', [
        { count: 1, emoji: '❤️', users: ['user1'] },
      ]),
      createMessage('2', 'user', 'Follow up'),
    ]);

    const result = await processor.process(context);

    expect(result.messages[0].content).toBe('Response with reaction');
  });

  it('should skip assistant messages without reactions', async () => {
    const processor = new ReactionFeedbackProcessor({ enabled: true });

    const context = createContext([
      createMessage('1', 'assistant', 'No reactions here'),
      createMessage('2', 'user', 'Reply'),
    ]);

    const result = await processor.process(context);

    expect(result.messages[1].content).toBe('Reply');
    expect(result.metadata.reactionFeedbackProcessed).toBe(0);
  });

  it('should discard pending feedback when no following user message exists', async () => {
    const processor = new ReactionFeedbackProcessor({ enabled: true });

    const context = createContext([
      createMessage('1', 'user', 'Question'),
      createMessage('2', 'assistant', 'Answer', [{ count: 1, emoji: '👍', users: ['user1'] }]),
    ]);

    const result = await processor.process(context);

    expect(result.messages[0].content).toBe('Question');
    expect(result.messages[1].content).toBe('Answer');
    expect(result.metadata.reactionFeedbackProcessed).toBe(0);
  });

  it('should skip non-string user message content', async () => {
    const processor = new ReactionFeedbackProcessor({ enabled: true });

    const context = createContext([
      createMessage('1', 'assistant', 'Response', [{ count: 1, emoji: '👍', users: ['user1'] }]),
      createMessage('2', 'user', [{ text: 'array content', type: 'text' }]),
    ]);

    const result = await processor.process(context);

    expect(result.messages[1].content).toEqual([{ text: 'array content', type: 'text' }]);
    expect(result.metadata.reactionFeedbackProcessed).toBe(0);
  });

  it('should reset pending emojis after injection', async () => {
    const processor = new ReactionFeedbackProcessor({ enabled: true });

    const context = createContext([
      createMessage('1', 'assistant', 'First', [{ count: 1, emoji: '👍', users: ['user1'] }]),
      createMessage('2', 'user', 'Second question'),
      createMessage('3', 'assistant', 'Third'),
      createMessage('4', 'user', 'Fourth question'),
    ]);

    const result = await processor.process(context);

    expect(result.messages[1].content).toBe('[User Feedback Emoji: 👍]\n\nSecond question');
    expect(result.messages[3].content).toBe('Fourth question');
  });

  it('should handle mixed conversation with multiple feedback injection points', async () => {
    const processor = new ReactionFeedbackProcessor({ enabled: true });

    const context = createContext([
      createMessage('1', 'user', 'Q1'),
      createMessage('2', 'assistant', 'A1', [{ count: 1, emoji: '👍', users: ['user1'] }]),
      createMessage('3', 'user', 'Q2'),
      createMessage('4', 'assistant', 'A2', [{ count: 1, emoji: '👎', users: ['user1'] }]),
      createMessage('5', 'user', 'Q3'),
    ]);

    const result = await processor.process(context);

    expect(result.messages[0].content).toBe('Q1');
    expect(result.messages[2].content).toBe('[User Feedback Emoji: 👍]\n\nQ2');
    expect(result.messages[4].content).toBe('[User Feedback Emoji: 👎]\n\nQ3');
    expect(result.metadata.reactionFeedbackProcessed).toBe(2);
  });

  it('should not mutate the original context', async () => {
    const processor = new ReactionFeedbackProcessor({ enabled: true });

    const originalMessages = [
      createMessage('1', 'assistant', 'Response', [{ count: 1, emoji: '👍', users: ['user1'] }]),
      createMessage('2', 'user', 'Follow up'),
    ];
    const context = createContext(originalMessages);

    await processor.process(context);

    expect(context.messages[1].content).toBe('Follow up');
  });
});
