import { type ChatMessageError } from '@lobechat/types';

// Ollama has quoted the model name both ways: `model "x" not found` and `model 'x' not found`.
const UNRESOLVED_MODEL_REGEXP = /model ["']([^"']+)["'] not found/;

/**
 * The provider's own message. `body.error.message` is the `/webapi/chat` and
 * server-runtime shape; `body.message` / the error message are the fallbacks
 * for a body that was flattened on the way.
 */
export const getOllamaErrorMessage = (error?: ChatMessageError | null): string | undefined => {
  const body = error?.body as { error?: unknown; message?: unknown } | undefined;
  const nested = body?.error;
  const candidates = [
    nested && typeof nested === 'object' ? (nested as { message?: unknown }).message : nested,
    body?.message,
    error?.message,
  ];
  return candidates.find((value): value is string => typeof value === 'string' && !!value);
};

/** The model Ollama has not pulled yet, when that is what the error says. */
export const getUnresolvedOllamaModel = (error?: ChatMessageError | null): string | undefined =>
  getOllamaErrorMessage(error)?.match(UNRESOLVED_MODEL_REGEXP)?.[1];
