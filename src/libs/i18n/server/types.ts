import type { NS } from '@/locales/resources';

export type ServerNamespace = Extract<
  NS,
  | 'auth'
  | 'chat'
  | 'error'
  | 'heterogeneousError'
  | 'home'
  | 'metadata'
  | 'notification'
  | 'runtimeError'
>;

export type TranslationParams = Record<string, string>;

/** Namespace identity survives aliases, callbacks and workspace package boundaries. */
export type ServerTranslate<N extends ServerNamespace, Result = string> = {
  (key: string, options?: TranslationParams): Result;
  readonly __serverNamespace?: N;
};

export interface ServerTranslator<N extends ServerNamespace> {
  find: ServerTranslate<N, string | undefined>;
  locale: string;
  t: ServerTranslate<N>;
}
