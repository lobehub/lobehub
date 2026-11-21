import type { AIEmbeddingModelCard } from '../types/aiModel';

// https://docs.voyageai.com/docs/embeddings
// https://docs.voyageai.com/docs/contextualized-chunk-embeddings
// https://docs.voyageai.com/docs/pricing
//
// Output dimension is 1024 unless a smaller or larger one is requested. The Matryoshka models
// accept 256, 512, 1024 and 2048; voyage-finance-2 and voyage-law-2 are fixed at 1024.

const voyageEmbeddingModels: AIEmbeddingModelCard[] = [
  {
    contextWindowTokens: 32_000,
    description:
      'Voyage 4 Large: the best general-purpose and multilingual retrieval quality in the Voyage 4 series. Output dimensions 256, 512, 1024 (default) and 2048.',
    displayName: 'Voyage 4 Large',
    id: 'voyage-4-large',
    maxDimension: 2048,
    pricing: {
      currency: 'USD',
      units: [{ name: 'textInput', rate: 0.12, strategy: 'fixed', unit: 'millionTokens' }],
    },
    type: 'embedding',
  },
  {
    contextWindowTokens: 32_000,
    description:
      'Voyage 4: balances retrieval quality, cost and latency for general-purpose and multilingual retrieval. Output dimensions 256, 512, 1024 (default) and 2048.',
    displayName: 'Voyage 4',
    id: 'voyage-4',
    maxDimension: 2048,
    pricing: {
      currency: 'USD',
      units: [{ name: 'textInput', rate: 0.06, strategy: 'fixed', unit: 'millionTokens' }],
    },
    type: 'embedding',
  },
  {
    contextWindowTokens: 32_000,
    description:
      'Voyage 4 Lite: optimized for latency and cost in the Voyage 4 series. Output dimensions 256, 512, 1024 (default) and 2048.',
    displayName: 'Voyage 4 Lite',
    id: 'voyage-4-lite',
    maxDimension: 2048,
    pricing: {
      currency: 'USD',
      units: [{ name: 'textInput', rate: 0.02, strategy: 'fixed', unit: 'millionTokens' }],
    },
    type: 'embedding',
  },
  {
    contextWindowTokens: 32_000,
    description:
      'Voyage Code 4: embeddings for code retrieval across programming languages. Output dimensions 256, 512, 1024 (default) and 2048.',
    displayName: 'Voyage Code 4',
    id: 'voyage-code-4',
    maxDimension: 2048,
    pricing: {
      currency: 'USD',
      units: [{ name: 'textInput', rate: 0.12, strategy: 'fixed', unit: 'millionTokens' }],
    },
    type: 'embedding',
  },
  {
    contextWindowTokens: 32_000,
    description:
      'Voyage 3 Large: previous-generation flagship for general-purpose and multilingual retrieval. Output dimensions 256, 512, 1024 (default) and 2048.',
    displayName: 'Voyage 3 Large',
    id: 'voyage-3-large',
    maxDimension: 2048,
    pricing: {
      currency: 'USD',
      units: [{ name: 'textInput', rate: 0.18, strategy: 'fixed', unit: 'millionTokens' }],
    },
    type: 'embedding',
  },
  {
    contextWindowTokens: 32_000,
    description:
      'Voyage 3.5: general-purpose and multilingual retrieval at a balanced price. Output dimensions 256, 512, 1024 (default) and 2048.',
    displayName: 'Voyage 3.5',
    id: 'voyage-3.5',
    maxDimension: 2048,
    pricing: {
      currency: 'USD',
      units: [{ name: 'textInput', rate: 0.06, strategy: 'fixed', unit: 'millionTokens' }],
    },
    type: 'embedding',
  },
  {
    contextWindowTokens: 32_000,
    description:
      'Voyage 3.5 Lite: low-latency, low-cost general-purpose retrieval. Output dimensions 256, 512, 1024 (default) and 2048.',
    displayName: 'Voyage 3.5 Lite',
    id: 'voyage-3.5-lite',
    maxDimension: 2048,
    pricing: {
      currency: 'USD',
      units: [{ name: 'textInput', rate: 0.02, strategy: 'fixed', unit: 'millionTokens' }],
    },
    type: 'embedding',
  },
  {
    contextWindowTokens: 32_000,
    description:
      'Voyage Code 3: embeddings for code retrieval. Output dimensions 256, 512, 1024 (default) and 2048.',
    displayName: 'Voyage Code 3',
    id: 'voyage-code-3',
    maxDimension: 2048,
    pricing: {
      currency: 'USD',
      units: [{ name: 'textInput', rate: 0.18, strategy: 'fixed', unit: 'millionTokens' }],
    },
    type: 'embedding',
  },
  {
    contextWindowTokens: 32_000,
    description:
      'Voyage Finance 2: embeddings tuned for finance retrieval. Fixed 1024-dimension output.',
    displayName: 'Voyage Finance 2',
    id: 'voyage-finance-2',
    maxDimension: 1024,
    pricing: {
      currency: 'USD',
      units: [{ name: 'textInput', rate: 0.12, strategy: 'fixed', unit: 'millionTokens' }],
    },
    type: 'embedding',
  },
  {
    contextWindowTokens: 16_000,
    description:
      'Voyage Law 2: embeddings tuned for legal retrieval and long legal documents. Fixed 1024-dimension output.',
    displayName: 'Voyage Law 2',
    id: 'voyage-law-2',
    maxDimension: 1024,
    pricing: {
      currency: 'USD',
      units: [{ name: 'textInput', rate: 0.12, strategy: 'fixed', unit: 'millionTokens' }],
    },
    type: 'embedding',
  },
  {
    contextWindowTokens: 32_000,
    description:
      'Voyage Context 4: contextualized chunk embeddings. Every input is one whole document, split into chunks of up to 32,000 tokens whose vectors reflect the document context; the result holds one vector per chunk, so it can be longer than the input list. Output dimensions 256, 512, 1024 (default) and 2048.',
    displayName: 'Voyage Context 4',
    id: 'voyage-context-4',
    maxDimension: 2048,
    pricing: {
      currency: 'USD',
      units: [{ name: 'textInput', rate: 0.12, strategy: 'fixed', unit: 'millionTokens' }],
    },
    type: 'embedding',
  },
  {
    contextWindowTokens: 32_000,
    description:
      'Voyage Context 3: contextualized chunk embeddings. Every input is one whole document, split into chunks of up to 32,000 tokens whose vectors reflect the document context; the result holds one vector per chunk, so it can be longer than the input list. Output dimensions 256, 512, 1024 (default) and 2048.',
    displayName: 'Voyage Context 3',
    id: 'voyage-context-3',
    maxDimension: 2048,
    pricing: {
      currency: 'USD',
      units: [{ name: 'textInput', rate: 0.18, strategy: 'fixed', unit: 'millionTokens' }],
    },
    type: 'embedding',
  },
];

export const allModels = [...voyageEmbeddingModels];

export default allModels;
