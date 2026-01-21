const { defineConfig } = require('@lobehub/i18n-cli');

module.exports = defineConfig({
  entry: 'resources/locales/en',
  entryLocale: 'en',
  output: 'resources/locales',
  outputLocales: [
    'ar',
    'bg-BG',
    'zh-TW',
    'zh-CN',
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
  saveImmediately: true,
  temperature: 0,
  modelName: 'gpt-4.1-mini',
  experimental: {
    jsonMode: true,
  },
});
