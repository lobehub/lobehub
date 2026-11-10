import ts from 'typescript';

import { objectSlotConditions, objectSlotProperties } from '../properties';
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

const isCreate = (factory: ts.CallExpression) =>
  ts.isPropertyAccessExpression(factory.expression) && factory.expression.name.text === 'create';

export const stylexAdapter: StyleAdapter = {
  conditionsOf: (symbol, factory) =>
    isCreate(factory) ? objectSlotConditions(symbol, factory) : {},
  markerIdentifiers: ['stylex'],
  name: 'stylex',
  propertiesOf: (symbol, factory) =>
    isCreate(factory) ? objectSlotProperties(symbol, factory) : {},
  recognizeFactory: (call) =>
    ts.isPropertyAccessExpression(call.expression) &&
    ts.isIdentifier(call.expression.expression) &&
    call.expression.expression.text === 'stylex' &&
    FACTORIES.has(call.expression.name.text),
};
