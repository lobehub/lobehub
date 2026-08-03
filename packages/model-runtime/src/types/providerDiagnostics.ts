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

export interface ProviderResponseDiagnostics {
  aborted?: boolean;
  apiMode: string;
  completedAt?: number;
  droppedEventCount: number;
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
}

export interface ModelRuntimeDiagnostics {
  providerRequest?: ProviderRequestDiagnostics;
  providerResponse?: ProviderResponseDiagnostics;
}
