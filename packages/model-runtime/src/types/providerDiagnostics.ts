export interface ProviderRequestDiagnostics {
  apiMode: string;
  endpoint?: string;
  payload: unknown;
  sentAt: number;
}

export interface ProviderResponseEventDiagnostics {
  blockIndex?: number;
  blockType?: string;
  contentLength?: number;
  deltaType?: string;
  hasNonWhitespaceContent?: boolean;
  index: number;
  signatureLength?: number;
  type: string;
}

export interface ProviderRawResponseDiagnostics {
  body?: string;
  /** Number of raw response bytes retained in body. */
  byteLength?: number;
  captureError?: string;
  status: 'captured' | 'failed' | 'unavailable';
  /** The provider response exceeded the diagnostic capture budget. */
  truncated?: boolean;
}

export interface ProviderResponseDiagnostics {
  aborted?: boolean;
  apiMode: string;
  completedAt?: number;
  droppedEventCount: number;
  /** Provider-native events omitted after reaching the count or byte budget. */
  droppedRawEventCount?: number;
  endpoint?: string;
  error?: {
    message?: string;
    name?: string;
  };
  eventCount: number;
  eventCounts: Record<string, number>;
  events: ProviderResponseEventDiagnostics[];
  firstEventAt?: number;
  firstNonWhitespaceOutputAt?: number;
  hasNonWhitespaceText: boolean;
  hasNonWhitespaceThinking: boolean;
  headers?: Record<string, string>;
  messageId?: string;
  model?: string;
  /** Serialized bytes retained across rawEvents, excluding JSON array delimiters. */
  rawEventByteLength?: number;
  /** Provider-native SDK events captured before LobeHub protocol transformation. */
  rawEvents: unknown[];
  /** Raw HTTP response body captured before the provider SDK consumes the stream. */
  rawResponse?: ProviderRawResponseDiagnostics;
  requestId?: string;
  responseReceivedAt?: number;
  signatureChars: number;
  status?: number;
  stopReason?: string | null;
  stopSequence?: string | null;
  terminalEventReceived: boolean;
  textChars: number;
  thinkingChars: number;
  toolInputChars: number;
  toolUseCount: number;
  usage?: unknown;
}

export interface ModelRuntimeDiagnostics {
  providerRequest?: ProviderRequestDiagnostics;
  providerResponse?: ProviderResponseDiagnostics;
}
