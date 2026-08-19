import type { OpenAIChatMessage } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import {
  chainSummaryTitle,
  chainSummaryTitleStructured,
  TOPIC_TITLE_JSON_SCHEMA,
  TOPIC_TITLE_PROMPT_VERSION,
} from '../summaryTitle';

const messages: OpenAIChatMessage[] = [
  { content: 'Hello, how can I assist you?', role: 'assistant' },
  { content: 'I need help with my account.', role: 'user' },
];

const SHARED_RULES = [
  '- Maximum 15 words',
  '- Maximum 80 characters',
  '- No punctuation marks',
  '- Use the language specified by the locale code: zh-CN',
  '- The title should accurately reflect the main topic of the conversation',
  '- Keep it short and to the point',
];

const OUTPUT_RULES = [
  '- Output ONLY the title text, no explanations or additional context',
  '- Return one JSON object with a single "title" string matching the supplied schema',
  '- No explanations or additional fields',
];

type TitlePayload = { messages: { content: string }[] };

const systemPrompt = (payload: TitlePayload): string => payload.messages[0].content;
const userPrompt = (payload: TitlePayload): string => payload.messages[1].content;
const withoutOutputRules = (prompt: string): string =>
  prompt
    .split('\n')
    .filter((line) => !OUTPUT_RULES.includes(line))
    .join('\n');

describe('chainSummaryTitle', () => {
  it('should use the default model if the token count is below the GPT-3.5 limit', async () => {
    // Arrange
    const currentLanguage = 'en-US';

    // Act
    const result = chainSummaryTitle(messages, currentLanguage);

    // Assert
    expect(result).toMatchSnapshot();
    expect(TOPIC_TITLE_PROMPT_VERSION).toBe('v1');
    expect(TOPIC_TITLE_JSON_SCHEMA.name).toBe('topic_title');
  });

  it('asks for plain text, because streaming consumers persist the response verbatim', () => {
    const prompt = systemPrompt(chainSummaryTitle(messages, 'en-US'));

    expect(prompt).toContain('- Output ONLY the title text, no explanations or additional context');
    expect(prompt).not.toContain('JSON');
    expect(prompt).not.toContain('schema');
  });
});

describe('chainSummaryTitleStructured', () => {
  it('asks for the object that TOPIC_TITLE_JSON_SCHEMA describes', () => {
    const prompt = systemPrompt(chainSummaryTitleStructured(messages, 'en-US'));

    expect(prompt).toContain(
      '- Return one JSON object with a single "title" string matching the supplied schema',
    );
    expect(prompt).toContain('- No explanations or additional fields');
    expect(prompt).not.toContain('Output ONLY the title text');
  });

  it('differs from the streaming variant only in the output rule', () => {
    const streaming = systemPrompt(chainSummaryTitle(messages, 'zh-CN'));
    const structured = systemPrompt(chainSummaryTitleStructured(messages, 'zh-CN'));

    expect(withoutOutputRules(structured)).toBe(withoutOutputRules(streaming));
    for (const rule of SHARED_RULES) {
      expect(streaming).toContain(rule);
      expect(structured).toContain(rule);
    }
  });

  it('serializes every conversation turn identically for both variants', () => {
    const streaming = userPrompt(chainSummaryTitle(messages, 'en-US'));

    expect(userPrompt(chainSummaryTitleStructured(messages, 'en-US'))).toBe(streaming);
    expect(streaming).toContain('<assistant>\nHello, how can I assist you?\n</assistant>');
    expect(streaming).toContain('<user>\nI need help with my account.\n</user>');
  });
});
