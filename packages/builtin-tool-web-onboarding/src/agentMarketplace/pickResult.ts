/**
 * Marketplace pick result helpers — shared between client-side install logic
 * and the custom interaction handler. Lives inside the marketplace package so
 * the tool-result format (what the AI ultimately reads) stays colocated with
 * the rest of the marketplace tool, decoupled from feature-layer plumbing.
 */

export interface InstallMarketplaceAgentSummary {
  category?: string;
  description?: string;
  installedAgentId?: string;
  skipped: boolean;
  templateId: string;
  title?: string;
}

const formatSummaryLine = (summary: InstallMarketplaceAgentSummary): string => {
  const head: string[] = [summary.title ?? summary.templateId];
  if (summary.category) head.push(`[${summary.category}]`);
  let line = `- ${head.join(' ')}`;
  if (summary.description) line += ` — ${summary.description}`;
  if (summary.skipped) line += ' (already in library)';
  return line;
};

export const buildAgentMarketplaceToolResult = (params: {
  installedAgentIds: string[];
  selectedAgentIds: string[];
  skippedAgentIds: string[];
  summaries: InstallMarketplaceAgentSummary[];
}): string => {
  const { selectedAgentIds, installedAgentIds, skippedAgentIds, summaries } = params;
  const lines = [
    `User has finished picking from the marketplace. They selected ${selectedAgentIds.length} agent template(s); the agents are now forked into the user's library and ready to use. The user has already completed this step in the UI — do NOT thank them for opening the picker or claim you "opened the list" again.`,
  ];
  if (summaries.length > 0) {
    lines.push('Selected templates:', ...summaries.map((s) => formatSummaryLine(s)));
  }
  lines.push(
    `selectedTemplateIds: ${JSON.stringify(selectedAgentIds)}`,
    `installedAgentIds: ${JSON.stringify(installedAgentIds)}`,
  );
  if (skippedAgentIds.length > 0) {
    lines.push(
      `skippedAgentIds (already in library, not re-installed): ${JSON.stringify(skippedAgentIds)}`,
    );
  }
  lines.push(
    'THIS TURN — required actions to wrap up onboarding:',
    '1) Briefly acknowledge the picks in 1–2 sentences (you may reference assistants by title/category from the list above).',
    '2) Call updateDocument(type="persona") to append a short note about the assistants the user picked (their categories/use cases) so future sessions remember.',
    '3) Call finishOnboarding to complete onboarding.',
    'Do NOT call showAgentMarketplace again. Do NOT ask the user to pick anything else.',
  );
  return lines.join('\n');
};
