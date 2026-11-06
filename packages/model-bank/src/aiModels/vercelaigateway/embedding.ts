import type { AIEmbeddingModelCard } from '../../types/aiModel';

export const vercelAIGatewayEmbeddingModels: AIEmbeddingModelCard[] = [
  {
    description:
      'Amazon Titan Text Embeddings V2 is a lightweight, efficient multilingual embedding model supporting 1024, 512, and 256 dimensions.',
    displayName: 'Titan Text Embeddings V2',
    id: 'amazon/titan-embed-text-v2',
    maxDimension: 1024,
    pricing: {
      units: [{ name: 'textInput', rate: 0.02, strategy: 'fixed', unit: 'millionTokens' }],
    },
    type: 'embedding',
  },
  {
    description:
      'A state-of-the-art embedding model with strong performance in English, multilingual, and code tasks.',
    displayName: 'Gemini Embedding 001',
    id: 'google/gemini-embedding-001',
    maxDimension: 768,
    pricing: {
      units: [{ name: 'textInput', rate: 0.15, strategy: 'fixed', unit: 'millionTokens' }],
    },
    type: 'embedding',
  },
  {
    description:
      'An English-focused text embedding model optimized for code and English language tasks.',
    displayName: 'Text Embedding 005',
    id: 'google/text-embedding-005',
    maxDimension: 768,
    pricing: {
      units: [{ name: 'textInput', rate: 0.025, strategy: 'fixed', unit: 'millionTokens' }],
    },
    type: 'embedding',
  },
  {
    description:
      'A multilingual text embedding model optimized for cross-lingual tasks across many languages.',
    displayName: 'Text Multilingual Embedding 002',
    id: 'google/text-multilingual-embedding-002',
    maxDimension: 768,
    pricing: {
      units: [{ name: 'textInput', rate: 0.025, strategy: 'fixed', unit: 'millionTokens' }],
    },
    type: 'embedding',
  },
  {
    description:
      'A model that classifies or converts text, images, or mixed content into embeddings.',
    displayName: 'Embed v4.0',
    id: 'cohere/embed-v4.0',
    maxDimension: 1024,
    pricing: {
      units: [{ name: 'textInput', rate: 0.12, strategy: 'fixed', unit: 'millionTokens' }],
    },
    type: 'embedding',
  },
  {
    description:
      'A code embedding model for embedding codebases and repositories to support coding assistants.',
    displayName: 'Codestral Embed',
    id: 'mistral/codestral-embed',
    maxDimension: 1024,
    pricing: {
      units: [{ name: 'textInput', rate: 0.15, strategy: 'fixed', unit: 'millionTokens' }],
    },
    type: 'embedding',
  },
  {
    description:
      'A general text embedding model for semantic search, similarity, clustering, and RAG workflows.',
    displayName: 'Mistral Embed',
    id: 'mistral/mistral-embed',
    maxDimension: 1024,
    pricing: {
      units: [{ name: 'textInput', rate: 0.1, strategy: 'fixed', unit: 'millionTokens' }],
    },
    type: 'embedding',
  },
  {
    description: 'OpenAI’s most capable embedding model for English and non-English tasks.',
    displayName: 'text-embedding-3-large',
    id: 'openai/text-embedding-3-large',
    maxDimension: 3072,
    pricing: {
      units: [{ name: 'textInput', rate: 0.13, strategy: 'fixed', unit: 'millionTokens' }],
    },
    type: 'embedding',
  },
  {
    description: 'OpenAI’s improved, higher-performance ada embedding model variant.',
    displayName: 'text-embedding-3-small',
    id: 'openai/text-embedding-3-small',
    maxDimension: 1536,
    pricing: {
      units: [{ name: 'textInput', rate: 0.02, strategy: 'fixed', unit: 'millionTokens' }],
    },
    type: 'embedding',
  },
  {
    description: 'OpenAI’s legacy text embedding model.',
    displayName: 'text-embedding-ada-002',
    id: 'openai/text-embedding-ada-002',
    maxDimension: 1536,
    pricing: {
      units: [{ name: 'textInput', rate: 0.1, strategy: 'fixed', unit: 'millionTokens' }],
    },
    type: 'embedding',
  },
];
