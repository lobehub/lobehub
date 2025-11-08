/* eslint-disable sort-keys-fix/sort-keys-fix , typescript-sort-keys/interface */

export interface ModelTokensUsage {
  // Input tokens breakdown
  /**
   * user prompt input
   */
  // Input cache tokens
  inputCachedTokens?: number;
  inputCacheMissTokens?: number;
  inputWriteCacheTokens?: number;

  inputTextTokens?: number;
  /**
   * user prompt image
   */
  inputImageTokens?: number;
  inputAudioTokens?: number;
  /**
   * currently only pplx has citation_tokens
   */
  inputCitationTokens?: number;

  // Output tokens breakdown
  outputTextTokens?: number;
  outputImageTokens?: number;
  outputAudioTokens?: number;
  outputReasoningTokens?: number;

  // Prediction tokens
  acceptedPredictionTokens?: number;
  rejectedPredictionTokens?: number;

  // Total tokens
  // TODO: make all following fields required
  totalInputTokens?: number;
  totalOutputTokens?: number;
  totalTokens?: number;
}

export interface ModelUsage extends ModelTokensUsage {
  /**
   * dollar
   */
  cost?: number;
}

export interface ModelPerformance {
  /**
   * tokens per second
   */
  tps?: number;
  /**
   * time to first token (ms)
   */
  ttft?: number;
  /**
   * from output start to output finish (ms)
   */
  duration?: number;
  /**
   * from input start to output finish (ms)
   */
  latency?: number;
}

export interface MessageMetadata extends ModelUsage, ModelPerformance {}
