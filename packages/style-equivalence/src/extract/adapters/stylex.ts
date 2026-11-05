import ts from 'typescript';

import type { StyleAdapter } from '../types';

const FACTORIES = new Set([
  'create',
  'createTheme',
  'defineConsts',
  'defineMarker',
  'defineVars',
  'keyframes',
  'positionTry',
  'viewTransitionClass',
]);

export const stylexAdapter: StyleAdapter = {
  markerIdentifiers: ['stylex'],
  name: 'stylex',
  recognizeFactory: (call) =>
    ts.isPropertyAccessExpression(call.expression) &&
    ts.isIdentifier(call.expression.expression) &&
    call.expression.expression.text === 'stylex' &&
    FACTORIES.has(call.expression.name.text),
};
