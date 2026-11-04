import ts from 'typescript';

import { objectSlotProperties } from '../properties';
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
  propertiesOf: (symbol, factory) =>
    ts.isPropertyAccessExpression(factory.expression) && factory.expression.name.text === 'create'
      ? objectSlotProperties(symbol, factory)
      : {},
  recognizeFactory: (call) =>
    ts.isPropertyAccessExpression(call.expression) &&
    ts.isIdentifier(call.expression.expression) &&
    call.expression.expression.text === 'stylex' &&
    FACTORIES.has(call.expression.name.text),
};
