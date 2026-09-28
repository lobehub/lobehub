import type { VerifyCheckItem, VerifyEvidenceType } from '@lobechat/types';

export interface VerifierPromptEvidence {
  content?: string | null;
  description?: string | null;
  type: VerifyEvidenceType;
}

export interface VerifierTaskDocument {
  /** Agent-scoped row id accepted by lobe-agent-documents.readDocument. */
  agentDocumentId: string;
  /** Backing documents-table id, included only to disambiguate the two identities. */
  documentId: string;
}

export interface VerifierPromptInput {
  checkItem: VerifyCheckItem;
  deliverable: string;
  evidence?: VerifierPromptEvidence[];
  goal: string;
  instruction?: string;
  taskDocuments?: VerifierTaskDocument[];
}

const describeEvidence = (evidence: VerifierPromptEvidence[] | undefined): string => {
  if (!evidence?.length) return '';

  let items = '';
  for (const item of evidence) {
    const caption = item.description ? ` — ${item.description}` : '';
    const payload = item.content ? `: ${item.content}` : ' [artifact captured]';
    items += `\n  - (${item.type})${caption}${payload}`;
  }

  return `\nEvidence captured during the run:${items}`;
};

const describeTaskDocuments = (documents: VerifierTaskDocument[] | undefined): string => {
  if (!documents?.length) return '';

  let items = '';
  for (const { agentDocumentId, documentId } of documents) {
    items += `\n- agentDocumentId: ${agentDocumentId} (backing documentId: ${documentId})`;
  }

  return `
## Task documents
Use \`lobe-agent-documents.readDocument\` with the \`agentDocumentId\` below. Do not pass the backing \`documentId\` as \`id\`.${items}`;
};

export const buildVerifierPrompt = ({
  checkItem,
  deliverable,
  evidence,
  goal,
  instruction,
  taskDocuments,
}: VerifierPromptInput): string => `## Check to verify
checkItemId: ${checkItem.id}
Title: ${checkItem.title}${checkItem.description ? `\nSummary: ${checkItem.description}` : ''}${
  instruction
    ? `

## Judging instruction
${instruction}`
    : ''
}

## Run goal
${goal}${
  deliverable
    ? `

## Deliverable / final output
${deliverable}`
    : ''
}${describeTaskDocuments(taskDocuments)}${
  evidence?.length
    ? `

## Captured evidence (builder self-evidence — primary Data, weight above prose)${describeEvidence(evidence)}`
    : ''
}

## Your task
Investigate whether the deliverable satisfies this check, judging against the run goal and the judging instruction. Weight the captured evidence above as primary Data; gather more yourself only where it's missing or insufficient. When done, call \`submitVerifyResult\` exactly once with checkItemId="${checkItem.id}" and your verdict (passed / failed / uncertain) plus evidence and reasoning.`;

/**
 * The send-back prompt for a rejected delivery. It points the agent at the CLI
 * as the source of truth, so neither the reviewer nor the dispatcher has to
 * hand-summarize evidence and feedback.
 *
 * `rejectComment` is the whole-round reason from a reject. It lives on the
 * round's decision, which `feedback --actionable` does not print, so it has to
 * travel in the prompt itself.
 */
export const buildAcceptanceRepairPrompt = (acceptanceId: string, rejectComment?: string) =>
  `${rejectComment ? `The reviewer sent this delivery back with this reason:\n\n${rejectComment}\n\n` : ''}Use the LobeHub CLI to read the latest review feedback for acceptance ${acceptanceId}:

lh acceptance feedback ${acceptanceId} --actionable

Every entry it prints (per-check comments, circled-region annotations on the evidence screenshots, and attachments) is the full set of feedback to handle this round. Fix the code item by item; then re-run verification and ingest the new result back into the SAME acceptance (reuse the existing check ids, and use supersedes for any check whose meaning changed). Keep the final report in the same language the previous rounds used.`;
