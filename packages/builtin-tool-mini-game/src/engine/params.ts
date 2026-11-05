import type { GameActionRequest, MiniGameApiNameType, MiniGameError } from '../types';
import { MiniGameApiName } from '../types';

export type ParseResult =
  { error: MiniGameError; ok: false } | { ok: true; request: GameActionRequest };

const invalid = (message: string): ParseResult => ({
  error: { message, type: 'invalid_params' },
  ok: false,
});

const readTargetId = (raw: Record<string, unknown>): string | undefined => {
  const value = raw.targetId;
  if (typeof value !== 'string') return;
  const trimmed = value.trim();
  return trimmed || undefined;
};

/** Accepts integers and integer-valued strings ("3"), which some models emit. */
const readInteger = (value: unknown): number | undefined => {
  const number = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  return typeof number === 'number' && Number.isInteger(number) ? number : undefined;
};

/**
 * Validates the raw arguments of an action API before anything moves.
 * Only shape is checked here; whether the target exists and supports the
 * action is decided by `planAction` against the live scene.
 */
export const parseActionParams = (apiName: MiniGameApiNameType, args: unknown): ParseResult => {
  const raw = (args && typeof args === 'object' ? args : {}) as Record<string, unknown>;
  const targetId = readTargetId(raw);

  switch (apiName) {
    case MiniGameApiName.moveTo: {
      if (targetId) return { ok: true, request: { action: 'moveTo', targetId } };

      const x = readInteger(raw.x);
      const y = readInteger(raw.y);
      if (x === undefined || y === undefined)
        return invalid('moveTo needs either `targetId` or both integer `x` and `y`.');
      return { ok: true, request: { action: 'moveTo', point: { x, y } } };
    }

    case MiniGameApiName.sitOn:
    case MiniGameApiName.watch: {
      if (!targetId) return invalid(`${apiName} needs a \`targetId\` from the game state.`);
      return { ok: true, request: { action: apiName, targetId } };
    }

    default: {
      return invalid(`${apiName} does not take an action request.`);
    }
  }
};
