import { genDefaultLocale } from './genDefaultLocale';
import { genDiff } from './genDiff';
import { root } from './i18nConfig';
import { split } from './utils';

console.log('[i18n] root:', root);

split('DIFF ANALYSIS');
genDiff();

split('GENERATE DEFAULT LOCALE');
genDefaultLocale();

split('GENERATE I18N FILES');
