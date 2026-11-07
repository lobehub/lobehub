import ts from 'typescript';

import { templateSlotRules } from '../css';
import { templateSlotProperties } from '../properties';
import type { StyleAdapter } from '../types';

const FACTORIES = new Set(['createStaticStyles', 'createStyles']);

export const emotionStaticAdapter: StyleAdapter = {
  markerIdentifiers: [],
  name: 'emotionStatic',
  propertiesOf: templateSlotProperties,
  recognizeFactory: (call) =>
    ts.isIdentifier(call.expression) && FACTORIES.has(call.expression.text),
  rulesOf: templateSlotRules,
};
