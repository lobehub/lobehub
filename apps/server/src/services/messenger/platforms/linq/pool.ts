import { createHash } from 'node:crypto';

/**
 * Pick the pool number a given key (a LobeHub user id, or a sender handle) is
 * pointed at. Stable for a fixed pool so the same person keeps seeing the same
 * number in their Messages thread; any number would work, because inbound is
 * routed by the sender and never by which pool number received it.
 */
export const pickLinqPoolNumber = (numbers: readonly string[], key: string): string => {
  if (numbers.length === 0) throw new Error('Linq number pool is empty');
  const digest = createHash('sha256').update(key).digest();
  return numbers[digest.readUInt32BE(0) % numbers.length];
};
