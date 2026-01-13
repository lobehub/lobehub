const { defineConfig } = require('@lobehub/i18n-cli');
const fs = require('fs');
const path = require('path');

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
  modelName: 'chatgpt-4o-latest',
  experimental: {
    jsonMode: true,
  },
  markdown: {
    reference:
      '你需要保持 mdx 的组件格式，输出文本不需要在最外层包裹任何代码块语法。\n' +
      fs.readFileSync(path.join(__dirname, 'docs/glossary.md'), 'utf-8'),
    entry: ['./README.zh-CN.md', './contributing/**/*.zh-CN.md', './docs/**/*.zh-CN.mdx'],
    entryLocale: 'zh-CN',
    outputLocales: ['en-US'],
    includeMatter: true,
    exclude: [
      './src/**/*',
      './contributing/_Sidebar.md',
      './contributing/_Footer.md',
      './contributing/Home.md',
    ],
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
