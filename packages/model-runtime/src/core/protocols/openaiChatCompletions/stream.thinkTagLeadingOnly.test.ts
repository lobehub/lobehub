import { describe, expect, it } from 'vitest';

import { createReadableStream, readStreamChunk } from '../../streams/utils';
import { OpenAIStream } from './stream';

const ZWSP = String.fromCharCode(0x200b);

describe('OpenAIStream leading-only think tags', () => {
  it('should keep a literal <think> mid-answer as text', async () => {
    const data = [
      {
        id: '1',
        object: 'chat.completion.chunk',
        created: 1737563070,
        model: 'deepseek-reasoner',
        choices: [
          { index: 0, delta: { content: 'Let me explain ' }, finish_reason: null, logprobs: null },
        ],
      },
      {
        id: '1',
        object: 'chat.completion.chunk',
        created: 1737563071,
        model: 'deepseek-reasoner',
        choices: [
          {
            index: 0,
            delta: { content: '<think>literal</think>' },
            finish_reason: null,
            logprobs: null,
          },
        ],
      },
      {
        id: '1',
        object: 'chat.completion.chunk',
        created: 1737563072,
        model: 'deepseek-reasoner',
        choices: [{ index: 0, delta: { content: ' now.' }, finish_reason: null, logprobs: null }],
      },
    ];

    const protocolStream = OpenAIStream(createReadableStream(data));
    const chunks = await readStreamChunk(protocolStream);

    expect(chunks).toEqual(
      [
        'id: 1',
        'event: text',
        `data: "Let me explain "\n`,
        'id: 1',
        'event: text',
        `data: "<think>literal</think>"\n`,
        'id: 1',
        'event: text',
        `data: " now."\n`,
      ].map((i) => `${i}\n`),
    );
  });

  it('should keep a literal </think> as text when no thinking block is open', async () => {
    const data = [
      {
        id: '1',
        object: 'chat.completion.chunk',
        created: 1737563070,
        model: 'deepseek-reasoner',
        choices: [
          {
            index: 0,
            delta: { content: 'The closing tag ' },
            finish_reason: null,
            logprobs: null,
          },
        ],
      },
      {
        id: '1',
        object: 'chat.completion.chunk',
        created: 1737563071,
        model: 'deepseek-reasoner',
        choices: [
          { index: 0, delta: { content: '</think>' }, finish_reason: null, logprobs: null },
        ],
      },
      {
        id: '1',
        object: 'chat.completion.chunk',
        created: 1737563072,
        model: 'deepseek-reasoner',
        choices: [
          { index: 0, delta: { content: ' is literal' }, finish_reason: null, logprobs: null },
        ],
      },
    ];

    const protocolStream = OpenAIStream(createReadableStream(data));
    const chunks = await readStreamChunk(protocolStream);

    expect(chunks).toEqual(
      [
        'id: 1',
        'event: text',
        `data: "The closing tag "\n`,
        'id: 1',
        'event: text',
        `data: "</think>"\n`,
        'id: 1',
        'event: text',
        `data: " is literal"\n`,
      ].map((i) => `${i}\n`),
    );
  });

  it('should still parse a leading <think> block after an empty reasoning placeholder', async () => {
    const data = [
      {
        id: '1',
        object: 'chat.completion.chunk',
        created: 1737563070,
        model: 'deepseek-reasoner',
        choices: [
          {
            index: 0,
            delta: { content: null, reasoning_content: '', role: 'assistant' },
            finish_reason: null,
            logprobs: null,
          },
        ],
      },
      {
        id: '1',
        object: 'chat.completion.chunk',
        created: 1737563071,
        model: 'deepseek-reasoner',
        choices: [
          {
            index: 0,
            delta: { content: '<think>r</think>answer' },
            finish_reason: null,
            logprobs: null,
          },
        ],
      },
    ];

    const protocolStream = OpenAIStream(createReadableStream(data));
    const chunks = await readStreamChunk(protocolStream);

    expect(chunks).toEqual(
      [
        'id: 1',
        'event: reasoning',
        `data: ""\n`,
        'id: 1',
        'event: reasoning',
        `data: "r"\n`,
        'id: 1',
        'event: text',
        `data: "answer"\n`,
      ].map((i) => `${i}\n`),
    );
  });

  it('should ignore zero-width characters before a leading <think> tag', async () => {
    const data = [
      {
        id: '1',
        object: 'chat.completion.chunk',
        created: 1737563070,
        model: 'deepseek-reasoner',
        choices: [
          {
            index: 0,
            delta: { content: ZWSP + '<think>r</think>answer' },
            finish_reason: null,
            logprobs: null,
          },
        ],
      },
    ];

    const protocolStream = OpenAIStream(createReadableStream(data));
    const chunks = await readStreamChunk(protocolStream);

    expect(chunks).toEqual(
      [
        'id: 1',
        'event: reasoning',
        `data: ${JSON.stringify(ZWSP + 'r')}\n`,
        'id: 1',
        'event: text',
        `data: "answer"\n`,
      ].map((i) => `${i}\n`),
    );
  });

  it('should let native reasoning close an already open fallback block', async () => {
    const data = [
      {
        id: '1',
        object: 'chat.completion.chunk',
        created: 1737563070,
        model: 'deepseek-reasoner',
        choices: [
          {
            index: 0,
            delta: { content: '<think>fallback' },
            finish_reason: null,
            logprobs: null,
          },
        ],
      },
      {
        id: '1',
        object: 'chat.completion.chunk',
        created: 1737563071,
        model: 'deepseek-reasoner',
        choices: [
          {
            index: 0,
            delta: { content: null, reasoning_content: 'native' },
            finish_reason: null,
            logprobs: null,
          },
        ],
      },
      {
        id: '1',
        object: 'chat.completion.chunk',
        created: 1737563072,
        model: 'deepseek-reasoner',
        choices: [{ index: 0, delta: { content: 'answer' }, finish_reason: null, logprobs: null }],
      },
    ];

    const protocolStream = OpenAIStream(createReadableStream(data));
    const chunks = await readStreamChunk(protocolStream);

    expect(chunks).toEqual(
      [
        'id: 1',
        'event: reasoning',
        `data: "fallback"\n`,
        'id: 1',
        'event: reasoning',
        `data: "native"\n`,
        'id: 1',
        'event: text',
        `data: "answer"\n`,
      ].map((i) => `${i}\n`),
    );
  });

  it('should not enter thinking mode after native reasoning_content', async () => {
    const data = [
      {
        id: '1',
        object: 'chat.completion.chunk',
        created: 1737563070,
        model: 'deepseek-reasoner',
        choices: [
          {
            index: 0,
            delta: { content: null, reasoning_content: 'native thinking' },
            finish_reason: null,
            logprobs: null,
          },
        ],
      },
      {
        id: '1',
        object: 'chat.completion.chunk',
        created: 1737563071,
        model: 'deepseek-reasoner',
        choices: [
          {
            index: 0,
            delta: { content: '<think>literal</think>' },
            finish_reason: null,
            logprobs: null,
          },
        ],
      },
    ];

    const protocolStream = OpenAIStream(createReadableStream(data));
    const chunks = await readStreamChunk(protocolStream);

    expect(chunks).toEqual(
      [
        'id: 1',
        'event: reasoning',
        `data: "native thinking"\n`,
        'id: 1',
        'event: text',
        `data: "<think>literal</think>"\n`,
      ].map((i) => `${i}\n`),
    );
  });
});
