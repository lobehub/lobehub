import type { ReactNode } from 'react';

/** Native textarea placeholders only accept text; rich editor placeholders render after hydration. */
export const getFallbackPlaceholder = (placeholder: ReactNode): string | undefined =>
  typeof placeholder === 'string' ? placeholder : undefined;
