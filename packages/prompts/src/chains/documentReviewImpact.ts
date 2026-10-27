import { DOCUMENT_REVIEW_IMPACT_CATEGORIES, DOCUMENT_REVIEW_IMPACT_KINDS } from '@lobechat/types';

/**
 * Change-impact analysis (Definely Cascade direction): given a baseline and the
 * current revision, name the definitions / references / clauses / obligations
 * the change may reach, and separate wording that actually changed from text
 * whose meaning changed underneath it.
 *
 * The contract lives here (prompt + JSON schema + version) so the server
 * service owns only model selection, validation and persistence.
 */
export const DOCUMENT_REVIEW_IMPACT_PROMPT_VERSION = 'v1';

/** Stable provider-facing schema name; also the tracing `schemaName`. */
export const DOCUMENT_REVIEW_IMPACT_SCHEMA_NAME = 'document_review_impacts';

export const DOCUMENT_REVIEW_IMPACT_JSON_SCHEMA = {
  name: DOCUMENT_REVIEW_IMPACT_SCHEMA_NAME,
  schema: {
    additionalProperties: false,
    properties: {
      items: {
        items: {
          additionalProperties: false,
          properties: {
            category: {
              description:
                'textual = the quoted text itself changed; semantic = unchanged text whose meaning or operation the change affects',
              enum: DOCUMENT_REVIEW_IMPACT_CATEGORIES,
              type: 'string',
            },
            confidence: {
              description: '0..1 confidence that this element is actually affected',
              maximum: 1,
              minimum: 0,
              type: 'number',
            },
            kind: {
              description:
                'definition = defined term; reference = cross-reference/clause number; related_clause = clause that repeats or depends on the term; obligation = duty such as payment, warranty, delivery or termination',
              enum: DOCUMENT_REVIEW_IMPACT_KINDS,
              type: 'string',
            },
            reason: {
              description:
                'Judgement basis: why the change reaches this element. Name the changed wording and the dependency.',
              maxLength: 600,
              type: 'string',
            },
            relatedLabel: {
              description: 'Optional clause label of the affected passage, e.g. "第 5 条 付款"',
              maxLength: 80,
              type: 'string',
            },
            relatedQuote: {
              description:
                'Verbatim contiguous quote of the affected passage in the CURRENT document. Required for semantic items; omit when the affected text is gone.',
              maxLength: 400,
              type: 'string',
            },
            severity: {
              enum: ['high', 'medium', 'low'],
              type: 'string',
            },
            sourceLabel: {
              description: 'Optional clause label of the changed wording',
              maxLength: 80,
              type: 'string',
            },
            sourceQuote: {
              description:
                'Verbatim contiguous quote of the changed wording in the CURRENT document (the trigger of this item).',
              maxLength: 400,
              type: 'string',
            },
            title: {
              description: 'Short reviewer-facing title, e.g. "付款触发条件" / "质保起算时间"',
              maxLength: 80,
              type: 'string',
            },
            trigger: {
              description:
                'What changed, in one sentence, quoting the old and new wording where useful.',
              maxLength: 400,
              type: 'string',
            },
          },
          required: ['category', 'kind', 'title', 'trigger', 'reason', 'confidence', 'sourceQuote'],
          type: 'object',
        },
        maxItems: 40,
        type: 'array',
      },
    },
    required: ['items'],
    type: 'object',
  },
} as const;

export interface DocumentImpactPromptInput {
  /** The baseline document body (plain text). */
  baselineText: string;
  /** The current document body (plain text). */
  currentText: string;
  /** Direct textual differences, preformatted as `- old` / `+ new` lines. */
  diff: string;
  documentTitle?: string;
}

export const DOCUMENT_REVIEW_IMPACT_SYSTEM_PROMPT = [
  'You are a contract change-impact analyst. You receive the baseline and the current revision of one contract, plus the direct textual differences between them.',
  'Your job is to find what the revision reaches beyond the edited words: defined terms, cross-references, clauses that repeat or depend on the changed wording, and obligations (payment, warranty, delivery, termination, liability).',
  'Rules for every item:',
  '- sourceQuote MUST be an exact, contiguous substring of the CURRENT document (no ellipsis, no paraphrase, no markdown markers). It is the changed wording that triggers the item.',
  '- relatedQuote MUST be an exact, contiguous substring of the CURRENT document as well, taken from the affected passage. It must be a different passage from sourceQuote. Omit it only when the affected text no longer exists.',
  '- category "textual" means the affected text is itself part of the direct difference. category "semantic" means the affected text did NOT change but its meaning, precondition, timing or operation is altered by the change.',
  '- kind: "definition" for a defined term, "reference" for a cross-reference or clause number, "related_clause" for a clause that repeats or depends on the changed wording, "obligation" for a duty or right such as payment, warranty start, delivery or termination.',
  '- trigger: one sentence describing the change (old wording -> new wording). reason: the judgement basis — why this element depends on the changed wording. Both must be specific enough for a lawyer to check.',
  '- confidence: your calibrated probability (0..1) that the element is actually affected. Use <0.5 when the dependency is speculative.',
  '- Never invent text. If you cannot ground an item in an exact quote from the current document, do not emit it.',
  'Coverage checklist — work through it before answering:',
  '1. Every defined term used by the changed wording, and the definition clause itself.',
  '2. Every cross-reference and clause number that points at the changed clause.',
  '3. Every other clause that repeats the changed term or conditions itself on it.',
  '4. Every obligation whose trigger, deadline or start date depends on the changed wording (payment trigger, warranty start, delivery on termination).',
  'Output contract — return one JSON object and nothing else:',
  '{"items":[{"title":"...","category":"textual|semantic","kind":"definition|reference|related_clause|obligation","severity":"high|medium|low","confidence":0.0,"trigger":"...","reason":"...","sourceQuote":"...","sourceLabel":"...","relatedQuote":"...","relatedLabel":"..."}]}',
  'title is required and short (<= 80 chars). sourceQuote is required. relatedQuote/sourceLabel/relatedLabel/severity may be omitted only when they do not apply.',
  'Return JSON only: {"items":[...]}.',
].join('\n');

const quoteBlock = (label: string, text: string) => `### ${label}\n${text}`;

export const chainDocumentReviewImpact = ({
  baselineText,
  currentText,
  diff,
  documentTitle,
}: DocumentImpactPromptInput) => {
  const user = [
    documentTitle ? `## 文档标题\n${documentTitle}` : '',
    quoteBlock('直接文字差异（基线 → 当前）', diff),
    quoteBlock('基线全文', baselineText),
    quoteBlock('当前全文', currentText),
  ]
    .filter(Boolean)
    .join('\n\n');

  return {
    messages: [
      { content: DOCUMENT_REVIEW_IMPACT_SYSTEM_PROMPT, role: 'system' as const },
      { content: user, role: 'user' as const },
    ],
  };
};

export interface DocumentImpactFollowUpInput {
  documentTitle?: string;
  impact: {
    category: string;
    confidence?: number | null;
    kind: string;
    reason: string;
    title: string;
    trigger?: string | null;
  };
  question?: string;
  related?: { context: string; label?: string; quote: string; status: string } | null;
  source: { context: string; label?: string; quote: string; status: string };
}

export const DOCUMENT_REVIEW_IMPACT_FOLLOW_UP_PROMPT_VERSION = 'v1';

export const DOCUMENT_REVIEW_IMPACT_FOLLOW_UP_SYSTEM_PROMPT = [
  'You are a contract change-impact analyst answering a follow-up about one flagged impact.',
  'Use only the supplied impact item and the quoted original text. Quote the contract verbatim when you refer to it.',
  'If the excerpts do not settle the question, say what additional text or clause is needed instead of guessing.',
  'Answer in the language of the contract.',
].join('\n');

/**
 * Assembles the context a follow-up needs: the impact item plus the quoted
 * original text on both sides (changed wording and affected passage), already
 * localized with surrounding text. The caller may answer with the returned
 * messages directly.
 */
export const chainDocumentReviewImpactFollowUp = ({
  impact,
  source,
  related,
  question,
  documentTitle,
}: DocumentImpactFollowUpInput) => {
  const describe = (label: string, block: DocumentImpactFollowUpInput['source']) =>
    [
      `### ${label}`,
      `- 状态: ${block.status}`,
      block.label ? `- 位置: ${block.label}` : '',
      `- 原文: "${block.quote}"`,
      `- 上下文: …${block.context}…`,
    ]
      .filter(Boolean)
      .join('\n');

  const user = [
    documentTitle ? `## 文档标题\n${documentTitle}` : '',
    '## 影响项',
    `- 标题: ${impact.title}`,
    `- 类型: ${impact.kind} / ${impact.category}`,
    impact.trigger ? `- 触发修改: ${impact.trigger}` : '',
    `- 判断依据: ${impact.reason}`,
    typeof impact.confidence === 'number' ? `- 置信度: ${impact.confidence.toFixed(2)}` : '',
    '',
    describe('触发修改原文', source),
    related ? describe('关联原文', related) : '',
    '',
    `## 追问\n${question?.trim() || '请解释这项影响，并说明需要同步修改哪些条款。'}`,
  ]
    .filter(Boolean)
    .join('\n');

  return {
    messages: [
      { content: DOCUMENT_REVIEW_IMPACT_FOLLOW_UP_SYSTEM_PROMPT, role: 'system' as const },
      { content: user, role: 'user' as const },
    ],
  };
};
