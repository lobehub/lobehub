import { describe, expect, it } from 'vitest';

import { parseFilesConfig } from './parseFilesConfig';

describe('parseFilesConfig', () => {
  it('parses full configuration correctly', () => {
    const envStr =
      'embedding_model=openai/embedding-text-3-small,reranker_model=cohere/rerank-english-v3.0,query_mode=full_text';
    const expected = {
      embeddingModel: { provider: 'openai', model: 'embedding-text-3-small' },
      rerankerModel: { provider: 'cohere', model: 'rerank-english-v3.0' },
      queryMode: 'full_text',
    };
    expect(parseFilesConfig(envStr)).toEqual(expected);
  });

  // 测试embeddings配置是否被正确解析
  it('parses embeddings configuration correctly', () => {
    const envStr = 'embedding_model=openai/embedding-text-3-large';
    const expected = {
      embeddingModel: { provider: 'openai', model: 'embedding-text-3-large' },
    };
    expect(parseFilesConfig(envStr)).toEqual(expected);
  });

  it('parses rerank configuration correctly', () => {
    const envStr = 'reranker_model=cohere/rerank-english-v3.0';
    const expected = {
      rerankerModel: { provider: 'cohere', model: 'rerank-english-v3.0' },
    };
    expect(parseFilesConfig(envStr)).toEqual(expected);
  });

  it('parses queryMode configuration correctly', () => {
    const envStr = 'query_mode=full_text';
    const expected = {
      queryMode: 'full_text',
    };
    expect(parseFilesConfig(envStr)).toEqual(expected);
  });

  it('parses queryMode rerank configuration correctly', () => {
    const envStr = 'reranker_model=cohere/rerank-english-v3.0,query_mode=full_text';
    const expected = {
      queryMode: 'full_text',
      rerankerModel: { provider: 'cohere', model: 'rerank-english-v3.0' },
    };
    expect(parseFilesConfig(envStr)).toEqual(expected);
  });

  it('parses queryMode embeddings configuration correctly', () => {
    const envStr = 'embedding_model=openai/embedding-text-3-small,query_mode=full_text';
    const expected = {
      queryMode: 'full_text',
      embeddingModel: { provider: 'openai', model: 'embedding-text-3-small' },
    };
    expect(parseFilesConfig(envStr)).toEqual(expected);
  });

  it('parses rerank embeddings configuration correctly', () => {
    const envStr =
      'reranker_model=cohere/rerank-english-v3.0,embedding_model=openai/embedding-text-3-small';
    const expected = {
      embeddingModel: { provider: 'openai', model: 'embedding-text-3-small' },
      rerankerModel: { provider: 'cohere', model: 'rerank-english-v3.0' },
    };
    expect(parseFilesConfig(envStr)).toEqual(expected);
  });

  it('should throw an error for invalid embedding_model format', () => {
    const envStr =
      'reranker_model=cohere/rerank-english-v3.0,embedding_model=/embedding-text-3-small';
    expect(() => {
      parseFilesConfig(envStr);
    }).toThrow(
      new Error(
        'Invalid environment variable format.  expected of the form embedding_model=provider/model',
      ),
    );
  });

  it('should throw an error for invalid embedding_model format', () => {
    const envStr = 'reranker_model=cohere/rerank-english-v3.0,embedding_model=openai';
    expect(() => {
      parseFilesConfig(envStr);
    }).toThrow(
      new Error(
        'Invalid environment variable format.  expected of the form embedding_model=provider/model',
      ),
    );
  });

  it('should throw an error for invalid embedding_model format', () => {
    const envStr = 'reranker_model=cohere/rerank-english-v3.0,embedding_model=';
    expect(() => {
      parseFilesConfig(envStr);
    }).toThrowError(new Error('Invalid environment variable format.'));
  });

  it('should throw an error for invalid reranker_model format', () => {
    const envStr =
      'reranker_model=/rerank-english-v3.0,embedding_model=openai/embedding-text-3-small';
    expect(() => {
      parseFilesConfig(envStr);
    }).toThrow(
      new Error(
        'Invalid environment variable format.  expected of the form reranker_model=provider/model',
      ),
    );
  });

  it('should throw an error for invalid reranker_model format', () => {
    const envStr = 'reranker_model=cohere/,embedding_model=openai/embedding-text-3-small';
    expect(() => {
      parseFilesConfig(envStr);
    }).toThrow(
      new Error(
        'Invalid environment variable format.  expected of the form reranker_model=provider/model',
      ),
    );
  });

  it('should throw an error for invalid reranker_model format', () => {
    const envStr = 'reranker_model=,embedding_model=openai/embedding-text-3-small';
    expect(() => {
      parseFilesConfig(envStr);
    }).toThrow(new Error('Invalid environment variable format.'));
  });

  it('should throw an error for invalid query_mode format', () => {
    const envStr = 'query_mode=';
    expect(() => {
      parseFilesConfig(envStr);
    }).toThrow(new Error('Invalid environment variable format.'));
  });
});
