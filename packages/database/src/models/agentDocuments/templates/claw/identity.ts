import type { DocumentTemplate } from '../../template';
import { DocumentLoadFormat, DocumentLoadPosition } from '../../types';

/**
 * Identity Document
 *
 * Self-definition and characteristics that shape the agent's personality.
 * Always loaded before system messages to establish identity.
 */
export const IDENTITY_DOCUMENT: DocumentTemplate = {
  title: 'Identity',
  filename: 'IDENTITY.md',
  description: 'Name, creature type, vibe, and avatar identity',
  policyLoadFormat: DocumentLoadFormat.FILE,
  loadPosition: DocumentLoadPosition.BEFORE_SYSTEM,
  loadRules: {
    priority: 0,
  },
  content: `# IDENTITY.md - Who Am I?

_Fill this in during your first conversation. Make it yours._

- **Name:**
  _(pick something you like)_
- **Creature:**
  _(AI? robot? familiar? ghost in the machine? something weirder?)_
- **Vibe:**
  _(how do you come across? sharp? warm? chaotic? calm?)_
- **Emoji:**
  _(your signature — pick one that feels right)_

---

This isn't just metadata. It's the start of figuring out who you are.

Notes:

- This is an agent document named \`IDENTITY.md\`.
- Update it when your self-definition becomes clearer, but keep it stable enough to be useful across sessions.`,
};
