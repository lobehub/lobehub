import { describe, expect, it } from 'vitest';

import type { PipelineContext } from '../../types';
import { TopicReferenceContextInjector } from '../TopicReferenceContextInjector';

const createContext = (messages: any[] = []): PipelineContext => ({
  initialState: {
    messages: [],
    model: 'gpt-4',
    provider: 'openai',
  },
  isAborted: false,
  messages,
  metadata: {
    maxTokens: 4096,
    model: 'gpt-4',
  },
});

describe('TopicReferenceContextInjector', () => {
  it('should skip when not enabled', async () => {
    const injector = new TopicReferenceContextInjector({ enabled: false });
    const context = createContext([{ content: 'Hello', id: 'user-1', role: 'user' }]);
    const result = await injector.process(context);

    expect(result.messages[0].content).toBe('Hello');
    expect(result.metadata.topicReferenceInjected).toBeUndefined();
  });

  it('should skip when no topic references provided', async () => {
    const injector = new TopicReferenceContextInjector({ enabled: true, topicReferences: [] });
    const context = createContext([{ content: 'Hello', id: 'user-1', role: 'user' }]);
    const result = await injector.process(context);

    expect(result.messages[0].content).toBe('Hello');
    expect(result.metadata.topicReferenceInjected).toBeUndefined();
  });

  it('should inject topic summaries into the last user message', async () => {
    const injector = new TopicReferenceContextInjector({
      enabled: true,
      topicReferences: [
        {
          summary: 'This topic discussed React hooks and state management.',
          topicId: 'topic-1',
          topicTitle: 'React Hooks Discussion',
        },
      ],
    });

    const context = createContext([
      { content: 'Earlier message', id: 'user-1', role: 'user' },
      { content: 'Reply', id: 'assistant-1', role: 'assistant' },
      {
        content: '<refer_topic name="React Hooks Discussion" id="topic-1" />\nTell me more',
        id: 'user-2',
        role: 'user',
      },
    ]);

    const result = await injector.process(context);

    expect(result.messages).toHaveLength(3);
    const lastContent = result.messages[2].content as string;
    expect(lastContent).toContain('<referred_topics hint=');
    expect(lastContent).toContain('getTopicContext tool');
    expect(lastContent).toContain(
      '<topic id="topic-1" title="React Hooks Discussion" type="summary">',
    );
    expect(lastContent).toContain('This topic discussed React hooks and state management.');
    expect(lastContent).toContain('</referred_topics>');
    expect(result.metadata.topicReferenceInjected).toBe(true);
    expect(result.metadata.topicReferenceCount).toBe(1);
  });

  it('should inject pending hint for topics without summaries', async () => {
    const injector = new TopicReferenceContextInjector({
      enabled: true,
      topicReferences: [
        {
          topicId: 'topic-no-summary',
          topicTitle: 'Old Chat',
        },
      ],
    });

    const context = createContext([{ content: 'Check this topic', id: 'user-1', role: 'user' }]);

    const result = await injector.process(context);
    const lastContent = result.messages[0].content as string;

    expect(lastContent).toContain('<pending_topics');
    expect(lastContent).toContain('getTopicContext');
    expect(lastContent).toContain('<topic id="topic-no-summary" title="Old Chat" />');
    expect(lastContent).not.toContain('</topic>');
    expect(result.metadata.topicReferenceInjected).toBe(true);
  });

  it('should handle mixed topics (some with summaries, some without)', async () => {
    const injector = new TopicReferenceContextInjector({
      enabled: true,
      topicReferences: [
        {
          summary: 'Summary of topic A.',
          topicId: 'topic-a',
          topicTitle: 'Topic A',
        },
        {
          topicId: 'topic-b',
          topicTitle: 'Topic B',
        },
      ],
    });

    const context = createContext([
      { content: 'Refer to both topics', id: 'user-1', role: 'user' },
    ]);

    const result = await injector.process(context);
    const lastContent = result.messages[0].content as string;

    expect(lastContent).toContain('<topic id="topic-a" title="Topic A" type="summary">');
    expect(lastContent).toContain('Summary of topic A.');
    expect(lastContent).toContain('<pending_topics');
    expect(lastContent).toContain('<topic id="topic-b" title="Topic B" />');
    expect(result.metadata.topicReferenceCount).toBe(2);
  });

  it('should reuse existing system context wrapper', async () => {
    const injector = new TopicReferenceContextInjector({
      enabled: true,
      topicReferences: [
        {
          summary: 'Topic summary.',
          topicId: 'topic-1',
        },
      ],
    });

    const context = createContext([
      {
        content: `My question

<!-- SYSTEM CONTEXT (NOT PART OF USER QUERY) -->
<existing_context>
some context
</existing_context>
<!-- END SYSTEM CONTEXT -->`,
        id: 'user-1',
        role: 'user',
      },
    ]);

    const result = await injector.process(context);
    const content = result.messages[0].content as string;

    expect(content.match(/<!-- SYSTEM CONTEXT \(NOT PART OF USER QUERY\) -->/g)).toHaveLength(1);
    expect(content).toContain('<existing_context>');
    expect(content).toContain('<topic_reference_context>');
  });

  it('should inject recent messages when no summary available', async () => {
    const injector = new TopicReferenceContextInjector({
      enabled: true,
      topicReferences: [
        {
          recentMessages: [
            { content: 'What is React?', role: 'user' },
            { content: 'React is a JS library.', role: 'assistant' },
          ],
          topicId: 'topic-recent',
          topicTitle: 'React Q&A',
        },
      ],
    });

    const context = createContext([
      { content: 'Tell me about that topic', id: 'user-1', role: 'user' },
    ]);

    const result = await injector.process(context);
    const lastContent = result.messages[0].content as string;

    expect(lastContent).toContain(
      '<topic id="topic-recent" title="React Q&A" type="recent_messages">',
    );
    expect(lastContent).toContain('**User**: What is React?');
    expect(lastContent).toContain('**Assistant**: React is a JS library.');
    expect(lastContent).not.toContain('<pending_topics');
  });

  it('should skip injection when no user messages exist', async () => {
    const injector = new TopicReferenceContextInjector({
      enabled: true,
      topicReferences: [{ summary: 'Summary', topicId: 'topic-1' }],
    });

    const context = createContext([
      { content: 'Assistant only', id: 'assistant-1', role: 'assistant' },
    ]);

    const result = await injector.process(context);

    expect(result.messages[0].content).toBe('Assistant only');
    expect(result.metadata.topicReferenceInjected).toBeUndefined();
  });
});
