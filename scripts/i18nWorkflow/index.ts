import { genDefaultLocale } from './genDefaultLocale';
import { genDiff } from './genDiff';
import { split } from './utils';

split('DIFF ANALYSIS');
genDiff();

split('GENERATE DEFAULT LOCALE');
genDefaultLocale();

split('GENERATE I18N FILES');
