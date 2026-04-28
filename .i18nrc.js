const { defineConfig } = require('@lobehub/i18n-cli');
const fs = require('node:fs');
const path = require('node:path');

module.exports = defineConfig({
  entry: 'locales/en-US',
  entryLocale: 'en-US',
  output: 'locales',
  outputLocales: [
    'ar',
    'bg-BG',
    'zh-CN',
    'zh-TW',
    'ru-RU',
    'ja-JP',
    'ko-KR',
    'fr-FR',
    'tr-TR',
    'es-ES',
    'pt-BR',
    'de-DE',
    'it-IT',
    'nl-NL',
    'pl-PL',
    'vi-VN',
    'fa-IR',
  ],
  temperature: 0,
  saveImmediately: true,
  modelName: 'gpt-5.1-chat-latest',
  experimental: {
    jsonMode: true,
  },
  markdown: {
    reference:
      'You need to maintain the component format of the mdx file; the output text does not need to be wrapped in any code block syntax on the outermost layer.\n' +
      fs.readFileSync(path.join(__dirname, 'docs/glossary.md'), 'utf8'),
    entry: ['./README.md', './docs/**/*.md', './docs/**/*.mdx'],
    entryLocale: 'en-US',
    outputLocales: ['zh-CN'],
    includeMatter: true,
    exclude: ['./README.zh-CN.md', './docs/**/*.zh-CN.md', './docs/**/*.zh-CN.mdx'],
    outputExtensions: (locale, { filePath }) => {
      if (filePath.includes('.mdx')) {
        if (locale === 'en-US') return '.mdx';
        return `.${locale}.mdx`;
      } else {
        if (locale === 'en-US') return '.md';
        return `.${locale}.md`;
      }
    },
  },
});
