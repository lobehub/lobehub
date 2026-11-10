import type { VerifyCodingScope } from '@lobechat/types';

import type { AcceptanceBundle } from '@/services/verify';

export const acceptanceCodingScope = (rounds: AcceptanceBundle['rounds']) =>
  [...rounds]
    .reverse()
    .find((round) => (round.run.scenario ?? 'coding') === 'coding' && round.run.context)?.run
    .context as VerifyCodingScope | null | undefined;
