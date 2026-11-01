/**
 * The "no boundary was given" sentence earlier prompt versions were told to write into `limits`.
 * An empty field says the same thing, and a sentence there reads as a boundary to everything
 * downstream, so it is dropped on the way in. Kept as a set for the other languages a model
 * sometimes answers the instruction in.
 */
const UNSTATED_LIMITS = new Set(['边界未由评审者说明']);

/** Whitespace and quote marks differ freely between what was written and what a model copies. */
const comparable = (text: string) => text.replaceAll(/[\s"'“”‘’「」『』]/g, '').toLowerCase();

export interface RejectionReason {
  /** What the reviewer typed for one rejection: their comment and every note on a circled region. */
  said: string[];
}

export interface RefinedRejectionFields {
  limits: string | null;
  reasoning: string;
  reasonSource: 'inferred' | 'reviewer';
}

/**
 * Settles the fields of a rejection observation the model cannot be trusted to self-report.
 *
 * `reasonSource` is decided by whether the claimed quote is really in what the reviewer wrote on
 * the rejections the observation cites — not by the model's own label, which over-claims. When it
 * is, the reason leads with those words and the model's mechanism follows, so the reader sees
 * their own sentence first.
 */
export const refineRejectionFields = (
  observation: { limits: string; reasoning: string; reviewerWords: string },
  cited: RejectionReason[],
): RefinedRejectionFields => {
  const limits = observation.limits.trim();
  const words = observation.reviewerWords.trim();
  const reasoning = observation.reasoning.trim();

  const quoted =
    comparable(words).length > 0 &&
    cited.some((rejection) =>
      rejection.said.some((text) => comparable(text).includes(comparable(words))),
    );

  return {
    limits: limits && !UNSTATED_LIMITS.has(limits.replace(/[。.]$/, '')) ? limits : null,
    reasoning: quoted ? [`“${words}”`, reasoning].filter(Boolean).join('\n\n') : reasoning,
    reasonSource: quoted ? 'reviewer' : 'inferred',
  };
};

const CJK = /\p{Script=Han}/u;

/**
 * Name, gate and exclusions of the group a reviewer's first rejections open, in the language they
 * rejected in. The group is created before any model sees the round, so its wording is fixed
 * here; an English name on a page where every rule is Chinese reads as someone else's group.
 */
export const deliveryStandardsDomainCopy = (projectName: string | null, rejectionText: string) => {
  if (CJK.test(rejectionText)) {
    const scope = projectName ?? '我的工作';
    return {
      brief: `从「${scope}」被打回的验收检查项里沉淀出的交付规矩。`,
      domainFilter: `去掉页面名、组件名和这次任务的名字之后，这条要求对「${scope}」的任何一次交付是否仍然成立？成立才收进来。`,
      outOfScope: '只关于某一个页面的一次性事实，以及任务一变就不再成立的内容。',
      title: projectName ? `${projectName} 交付规矩` : '我的交付规矩',
    };
  }
  const scope = projectName ?? 'my work';
  return {
    brief: `Delivery standards distilled from rejected acceptance checks on ${scope}.`,
    domainFilter: `Strip the screen names, component names and this task's name out of the requirement — does it still hold for any delivery on ${scope}? Only then is it mine.`,
    outOfScope:
      'One-off facts about a single screen, and anything that stops being true once the task changes.',
    title: projectName ? `${projectName} delivery standards` : 'My delivery standards',
  };
};

/**
 * The message a verbatim excerpt was copied from, newest first: when the same words recur, the
 * turn under review is the latest one. Undefined when the excerpt is empty or appears nowhere —
 * a hit then keeps only its topic rather than pointing at a message that did not say it.
 */
export const findQuotedMessage = (
  messages: { content: string | null; id: string }[],
  quote: string,
) => {
  const needle = comparable(quote);
  if (!needle) return;
  return messages.find((message) => comparable(message.content ?? '').includes(needle))?.id;
};
