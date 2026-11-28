// Fixture: spawn/kimiCode/sessionUsage.ts — the Node-only half of an agent.
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { aggregateKimiCodeUsage, parseKimiCodeWireUsage } from '../../adapters/kimiCode/usage';

export const readSessionUsage = async (kimiHome: string, sessionId: string) => {
  const file = path.join(kimiHome, 'sessions', sessionId, 'wire.jsonl');
  const content = await readFile(file, 'utf8').catch(() => undefined);
  return content ? aggregateKimiCodeUsage(parseKimiCodeWireUsage(content)) : undefined;
};
