import { toRecord } from '@lobechat/utils/object';
import { safeParseJSON } from '@lobechat/utils/safeParseJSON';

import type { UpdateAgentConfigParams } from './types';

const parseRecord = (value: unknown) =>
  toRecord(typeof value === 'string' ? safeParseJSON<unknown>(value) : value);

/**
 * Normalize model-generated updateConfig arguments at the tool boundary.
 *
 * Some models mirror the injected agent context and emit metadata as
 * `{ config: { meta: ... } }`, while the tool contract expects top-level
 * `{ meta: ... }`. Keep accepting that legacy shape, but never forward the
 * unknown `config.meta` field as an agent config update.
 */
export const normalizeUpdateConfigParams = (
  params: UpdateAgentConfigParams,
): UpdateAgentConfigParams => {
  const rawConfig = parseRecord(params.config);
  const nestedMeta = parseRecord(rawConfig?.meta);
  const explicitMeta = parseRecord(params.meta);

  const config = { ...rawConfig };
  delete config.meta;

  const meta = { ...nestedMeta, ...explicitMeta };

  return {
    ...params,
    config:
      Object.keys(config).length > 0
        ? (config as NonNullable<UpdateAgentConfigParams['config']>)
        : undefined,
    meta:
      Object.keys(meta).length > 0
        ? (meta as NonNullable<UpdateAgentConfigParams['meta']>)
        : undefined,
  };
};
