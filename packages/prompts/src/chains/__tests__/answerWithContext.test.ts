import { describe, expect, it } from 'vitest';

import { chainAnswerWithContext } from '../answerWithContext';

describe('chainAnswerWithContext', () => {
  it('should generate correct payload with context and knowledge', () => {
    const result = chainAnswerWithContext({
      context: ['Context passage 1', 'Context passage 2'],
      knowledge: ['AI', 'Machine Learning'],
      question: 'What is artificial intelligence?',
    });

    expect(result).toMatchSnapshot();
  });

  it('should handle single knowledge area', () => {
    const result = chainAnswerWithContext({
      context: ['Single context'],
      knowledge: ['Technology'],
      question: 'How does it work?',
    });

    expect(result).toMatchSnapshot();
  });

  it('should handle multiple knowledge areas', () => {
    const result = chainAnswerWithContext({
      context: ['Context'],
      knowledge: ['AI', 'ML', 'NLP', 'Computer Vision'],
      question: 'Tell me about these fields',
    });

    expect(result).toMatchSnapshot();
  });

  it('should handle empty context array', () => {
    const result = chainAnswerWithContext({
      context: [],
      knowledge: ['AI'],
      question: 'What is AI?',
    });

    expect(result).toMatchSnapshot();
  });

  it('should filter out empty context strings', () => {
    const result = chainAnswerWithContext({
      context: ['Valid context', '', '  ', 'Another valid context'],
      knowledge: ['Test'],
      question: 'Test question',
    });

    expect(result).toMatchSnapshot();
  });
});
