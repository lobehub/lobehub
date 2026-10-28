// Fixture: a prop typed as an array of a response ELEMENT type is the caller's array, not a field.
// Reduced from Acceptance/Viewer/History/LedgerPanel (`rounds: AcceptanceRound[]`).
import { memo } from 'react';

import type { AcceptanceBundle } from '@/services/verify';

export type AcceptanceRound = AcceptanceBundle['rounds'][number];

interface LedgerPanelProps {
  onOpenReport: (round: AcceptanceRound) => void;
  rounds: AcceptanceRound[];
}

const LedgerPanel = memo<LedgerPanelProps>(({ onOpenReport, rounds }) => (
  <section>
    <span>{rounds.length}</span>
    <ol>
      {[...rounds].reverse().map((round) => (
        <li key={round.id} onClick={() => onOpenReport(round)}>
          {round.summary}
        </li>
      ))}
    </ol>
  </section>
));

export default LedgerPanel;
