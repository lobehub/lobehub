export interface ProviderImportModel {
  contextWindowTokens?: number;
  displayName?: string;
  id: string;
}

export interface ProviderImportProvider {
  apiKey: string;
  baseURL: string;
  checkModel?: string;
  description?: string;
  enableResponsesApi?: boolean;
  fetchOnClient?: boolean;
  id: string;
  logo?: string;
  name: string;
}

export interface ProviderImportPayload {
  models: ProviderImportModel[];
  provider: ProviderImportProvider;
  version: 1;
}

export interface ProviderImportPreview {
  modelCount: number;
  provider: Omit<ProviderImportProvider, 'apiKey'>;
  requestId: string;
}

export type ProviderImportErrorCode = 'callback_failed' | 'invalid_callback' | 'invalid_payload';

export type ProviderImportRequest =
  | {
      errorCode: ProviderImportErrorCode;
      requestId: string;
      status: 'error';
    }
  | {
      preview: ProviderImportPreview;
      status: 'ready';
    };
