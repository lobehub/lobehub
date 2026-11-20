import i18next from 'i18next';
import { initReactI18next } from 'react-i18next';

import zhCN from '../../../locales/zh-CN/project.json';
import enUS from '../../locales/src/default/project';

const artboardKeys = (resource: Record<string, string>) =>
  Object.fromEntries(Object.entries(resource).filter(([key]) => key.startsWith('artboard.')));

export const viewerLanguage = (language: string) =>
  language.toLowerCase().startsWith('zh') ? 'zh-CN' : 'en-US';

export const initViewerI18n = (language: string) =>
  i18next.use(initReactI18next).init({
    defaultNS: 'project',
    fallbackLng: 'en-US',
    interpolation: { escapeValue: false },
    keySeparator: false,
    lng: viewerLanguage(language),
    ns: ['project'],
    resources: {
      'en-US': { project: artboardKeys(enUS) },
      'zh-CN': { project: artboardKeys(zhCN) },
    },
  });
