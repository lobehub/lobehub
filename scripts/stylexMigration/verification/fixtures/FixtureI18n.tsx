import { createInstance } from 'i18next';
import type { ReactNode } from 'react';
import { I18nextProvider } from 'react-i18next';
import chat from 'verification:locale/chat';
import components from 'verification:locale/components';

const instance = createInstance();
void instance
  .init({
    fallbackLng: 'en-US',
    initImmediate: false,
    interpolation: { escapeValue: false },
    keySeparator: false,
    lng: 'en-US',
    react: { useSuspense: false },
    resources: { 'en-US': { chat, components } },
  })
  .catch((error) => {
    console.error(error);
    throw error;
  });

/** Actual locale modules from each source snapshot; no mocked translation hook. */
export const FixtureI18n = ({ children }: { children: ReactNode }) => (
  <I18nextProvider i18n={instance}>{children}</I18nextProvider>
);
