import type { SetCommandOptions } from '@upstash/redis';

import { type RedisKey, type RedisMSetArgument, type RedisValue, type SetOptions } from './types';

export const normalizeRedisKey = (key: RedisKey) =>
  typeof key === 'string' ? key : key.toString();

export const normalizeRedisKeys = (keys: RedisKey[]) => keys.map(normalizeRedisKey);

export const normalizeMsetValues = (values: RedisMSetArgument): Record<string, RedisValue> => {
  if (values instanceof Map) {
    return Array.from(values.entries()).reduce<Record<string, RedisValue>>((acc, [key, value]) => {
      acc[normalizeRedisKey(key)] = value;
      return acc;
    }, {});
  }

  return values;
};

export const buildIORedisSetArgs = (options?: SetOptions): Array<string | number> => {
  if (!options) return [];

  const args: Array<string | number> = [];

  if (options.ex !== undefined) args.push('EX', options.ex);
  if (options.px !== undefined) args.push('PX', options.px);
  if (options.exat !== undefined) args.push('EXAT', options.exat);
  if (options.pxat !== undefined) args.push('PXAT', options.pxat);
  if (options.keepTtl) args.push('KEEPTTL');
  if (options.nx) args.push('NX');
  if (options.xx) args.push('XX');
  if (options.get) args.push('GET');

  return args;
};

export const buildUpstashSetOptions = (options?: SetOptions): SetCommandOptions | undefined => {
  if (!options) return undefined;

  const mapped: Partial<SetCommandOptions> = {};

  if (options.ex !== undefined) mapped.ex = options.ex;
  if (options.px !== undefined) mapped.px = options.px;
  if (options.exat !== undefined) mapped.exat = options.exat;
  if (options.pxat !== undefined) mapped.pxat = options.pxat;
  if (options.keepTtl) mapped.keepTtl = true;
  if (options.nx) mapped.nx = true;
  if (options.xx) mapped.xx = true;
  if (options.get) mapped.get = true;

  return Object.keys(mapped).length ? (mapped as SetCommandOptions) : undefined;
};
