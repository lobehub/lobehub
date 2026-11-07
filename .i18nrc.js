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
  reference: [
    'These are UI strings for LobeHub, an AI agent platform.',
    '',
    'Rules for every locale:',
    '- Use exactly one translation per product concept across the whole locale.',
    '  Never alternate between synonyms for the same English term.',
    '- "Agent" and "Assistant" are two distinct concepts here and must not share',
    '  a translation.',
    '- Keep every interpolation variable ({{like_this}}) and tag exactly as it',
    '  appears in the source: same names, same count. Never add a variable the',
    '  source does not have, and never drop one it does.',
    '- Leave product and brand names untranslated: LobeHub, LobeAI, Claude Code,',
    '  Codex, OpenAI, Azure, GitHub, MCP.',
    '',
    'Turkish (tr-TR) glossary:',
    '- Agent -> Ajan. Not Temsilci, Aracı, Asistan or Ajans. "Ajans" means an',
    '  advertising agency, and "Aracı" is also the accusative of "araç" (tool).',
    '- Assistant -> Asistan',
    '- Skill -> Beceri, Tool -> Araç, Workspace -> çalışma alanı',
    '- Knowledge base -> bilgi tabanı, Quick Composer -> Hızlı Oluşturucu',
    '- Turkish vowel harmony applies to suffixes and to the separate question',
    '  particle. "Ajan" takes back vowels: Ajanı, Ajana, Ajandan, Ajanlar, and',
    '  the particle is "mı", not "mi".',
  ].join('\n'),
  temperature: 0,
  saveImmediately: true,
  modelName: 'gpt-4o',
  experimental: {
    jsonMode: true,
  },
  markdown: {
    reference:
      'You need to maintain the component format of the mdx file; the output text does not need to be wrapped in any code block syntax on the outermost layer.\n' +
      fs.readFileSync(path.join(__dirname, 'docs/glossary.mdx'), 'utf8'),
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
