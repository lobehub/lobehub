import { MemoryRouter } from 'react-router';
import { AcceptanceEvidenceList } from 'verification:component';

import { evidenceFor } from './AcceptanceEvidenceData';

export const Fixture = ({ variant }: { variant: string }) => (
  <MemoryRouter>
    <AcceptanceEvidenceList evidence={evidenceFor(variant)} />
  </MemoryRouter>
);
