import { describe, expect, it } from 'vitest';

import enUS from '@/../locales/en-US/editor.json';
import zhCN from '@/../locales/zh-CN/editor.json';
import zhTW from '@/../locales/zh-TW/editor.json';
import defaultEditor from '@/../packages/locales/src/default/editor';

const slashMenuKeys = [
  'slash.collapsible',
  'slash.section.headings',
  'slash.section.insert',
  'slash.section.lists',
] as const;

const pageEditorKeys = [
  'annotation.add',
  'annotation.close',
  'annotation.empty',
  'annotation.invalidPayload',
  'annotation.noQuote',
  'annotation.placeholder',
  'annotation.submit',
  'annotation.title',
  'annotation.toolbar',
  'copilot.tabs.annotations',
  'copilot.tabs.topic',
  'link.convertToBlockCard',
  'link.convertToCard',
  'link.convertToIframe',
  'link.convertToLink',
  'link.convertToSchema',
  'link.iframeTitle',
  'link.loadingPreview',
  'toc.collapse',
  'toc.expand',
  'toc.heading',
  'toc.label',
  'toc.pin',
  'toc.preview',
] as const;

describe('PageEditor slash menu translations', () => {
  it('registers every custom menu key in the typed default resource', () => {
    for (const key of slashMenuKeys) {
      expect(defaultEditor[key]).toBeTruthy();
    }
  });

  it.each([
    ['en-US', enUS],
    ['zh-CN', zhCN],
    ['zh-TW', zhTW],
  ])('ships visible labels for every custom menu key in %s', (_, translations) => {
    for (const key of slashMenuKeys) {
      expect(translations[key]).toBeTruthy();
      expect(translations[key]).not.toBe(key);
    }
  });

  it('ships every Page editor UI key in the editor namespace', () => {
    for (const translations of [defaultEditor, enUS, zhCN, zhTW]) {
      for (const key of pageEditorKeys) {
        expect(translations[key]).toBeTruthy();
        expect(translations[key]).not.toBe(key);
      }
    }
  });
});
