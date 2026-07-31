import type { EntitySource } from '@lobechat/types';

export const isObject = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

export const isTimestamp = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

export const isEntitySource = (value: unknown): value is EntitySource =>
  value === 'mutation' || value === 'network' || value === 'realtime';

export const hasObservation = (value: Record<string, unknown>): boolean =>
  isTimestamp(value.observedAt) && isEntitySource(value.source);

export const isEntityFragment = (value: unknown): boolean =>
  isObject(value) && hasObservation(value) && isObject(value.data);

export const isEntityRef = (value: unknown, kind: string): boolean =>
  isObject(value) && value.kind === kind && typeof value.id === 'string';
