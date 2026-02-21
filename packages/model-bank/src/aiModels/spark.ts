import type { AIChatModelCard } from '../types/aiModel';

const sparkChatModels: AIChatModelCard[] = [
  {
    abilities: {
      functionCall: true,
      reasoning: true,
      search: true,
    },
    contextWindowTokens: 65_535,
    description:
      'X1.5 updates: (1) adds dynamic thinking mode controlled by the `thinking` field; (2) larger context length with 64K input and 64K output; (3) supports FunctionCall.',
    displayName: 'Spark X1.5',
    enabled: true,
    id: 'spark-x',
    maxOutput: 65_535,
    settings: {
      extendParams: ['thinking'],
      searchImpl: 'params',
    },
    type: 'chat',
  },
  {
    contextWindowTokens: 8192 + 4096,
    description:
      'Spark Lite is a lightweight LLM with ultra-low latency and efficient processing. It is fully free and supports real-time web search. Its fast responses perform well on low-compute devices and for model fine-tuning, delivering strong cost efficiency and an intelligent experience, especially for knowledge Q&A, content generation, and search scenarios.',
    displayName: 'Spark Lite',
    enabled: true,
    id: 'lite',
    maxOutput: 4096,
    type: 'chat',
  },
  {
    abilities: {
      search: true,
    },
    contextWindowTokens: 8192 + 8192,
    description:
      'Spark Pro is a high-performance LLM optimized for professional domains, focusing on math, programming, healthcare, and education, with web search and built-in plugins such as weather and date. It delivers strong performance and efficiency in complex knowledge Q&A, language understanding, and advanced text creation, making it an ideal choice for professional use cases.',
    displayName: 'Spark Pro',
    id: 'generalv3',
    maxOutput: 8192,
    settings: {
      searchImpl: 'params',
    },
    type: 'chat',
  },
  {
    contextWindowTokens: 131_072,
    description:
      'Spark Pro 128K provides a very large context capacity, handling up to 128K context, ideal for long-form documents requiring full-text analysis and long-range coherence, with smooth logic and diverse citation support in complex discussions.',
    displayName: 'Spark Pro 128K',
    id: 'pro-128k',
    maxOutput: 131_072,
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      search: true,
    },
    contextWindowTokens: 8192 + 8192,
    description:
      'Spark Max is the most full-featured version, supporting web search and many built-in plugins. Its fully optimized core capabilities, system roles, and function calling deliver excellent performance across complex application scenarios.',
    displayName: 'Spark Max',
    id: 'generalv3.5',
    maxOutput: 8192,
    settings: {
      searchImpl: 'params',
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      search: true,
    },
    contextWindowTokens: 32_768 + 32_768,
    description:
      'Spark Max 32K offers large-context processing with stronger context understanding and logical reasoning, supporting 32K-token inputs for long document reading and private knowledge Q&A.',
    displayName: 'Spark Max 32K',
    id: 'max-32k',
    maxOutput: 32_768,
    settings: {
      searchImpl: 'internal',
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
      search: true,
    },
    contextWindowTokens: 32_768 + 32_768,
    description:
      'Spark Ultra is the most powerful model in the Spark series, improving text understanding and summarization while upgrading web search. It is a comprehensive solution for boosting workplace productivity and accurate responses, positioning it as a leading intelligent product.',
    displayName: 'Spark 4.0 Ultra',
    id: '4.0Ultra',
    maxOutput: 32_768,
    settings: {
      searchImpl: 'params',
    },
    type: 'chat',
  },
];

export const allModels = [...sparkChatModels];

export default allModels;
