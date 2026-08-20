import {defineConfig} from '@eloqnt/cli';

export default defineConfig({
  messages: {
    path: './locales/{locale}/{namespace}',
    locales: 'infer',
    sourceLocale: 'en-US',
    format: {
      codec: '@eloqnt/format-i18next-json',
      extension: '.json'
    }
  },
  lint: {
    rules: {
      // lobe-i18n mirrors en-US's `_one`/`_other` key pairs into every
      // locale, so locales whose plural rules only have `other` (ja-JP,
      // ko-KR, vi-VN, zh-CN, zh-TW) carry `_one` keys i18next never
      // selects. Harmless at runtime, and the daily auto-i18n workflow
      // would re-add them if removed here.
      'unreachable-plural-case': 'off'
    },
    overrides: [
      {
        // en-US has no `zero` plural category, so its `_zero` key acts as
        // the exact `=0` case, while Arabic's `_zero` is its CLDR `zero`
        // category — both render the same text for a count of zero.
        keys: 'chat.heteroAgent.codexQuota.resetCredits',
        rules: {'inconsistent-exact-plurals': 'off'}
      }
    ]
  }
});
