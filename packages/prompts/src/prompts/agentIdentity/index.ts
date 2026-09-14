import { escapeXmlContent } from '../search/xmlEscape';

export interface AgentIdentityContext {
  /** Personal name the user addresses the agent by ("Alice", "小艾"). */
  name?: string | null;
  /** The role the agent plays ("Health Assistant"). */
  title?: string | null;
}

/**
 * The agent's own identity, injected into the system message so the model can
 * answer "who are you?" with the name the user actually gave it — instead of
 * falling back to the product or model name. `name` is the personal name and
 * wins as the primary label; `title` is the role (mirrors `agentDisplayName`).
 *
 * Deliberately does NOT constrain persona beyond the label: a custom
 * `systemRole` still owns tone and behavior, this only pins the identity facts
 * that live outside the prompt text.
 */
export const agentIdentityPrompt = ({ name, title }: AgentIdentityContext): string => {
  const personalName = name?.trim();
  const role = title?.trim();
  if (!personalName && !role) return '';

  const label = personalName ?? role!;

  const fields = [
    personalName && `  <name>${escapeXmlContent(personalName)}</name>`,
    role && `  <title>${escapeXmlContent(role)}</title>`,
  ].filter(Boolean);

  return [
    '<agent_identity>',
    ...fields,
    `  <instruction>The user knows you as "${escapeXmlContent(label)}". When asked who you are, identify yourself by this identity rather than a platform or model name.</instruction>`,
    '</agent_identity>',
  ].join('\n');
};
