import { PersonaDetail } from 'verification:component';

const persona = `## Work style

Prefers **concise** answers with concrete examples and a clear next step.

### Habits

- Reviews pull requests in the **morning**
- Writes design notes before coding
  - Keeps them short
  1. Lists open questions first
- Ships behind feature flags

1. Ordered steps stay on the default list style
2. Second step with **emphasis**

A closing paragraph that wraps across several lines at narrow widths so line height is visible.
`;

export const Fixture = () => <PersonaDetail>{persona}</PersonaDetail>;
