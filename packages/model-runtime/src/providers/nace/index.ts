import type { LobeRuntimeAI } from '../../core/BaseAI';
import type { OpenAICompatibleFactoryOptions } from '../../core/openaiCompatibleFactory';
import { createOpenAICompatibleRuntime } from '../../core/openaiCompatibleFactory';
import type { DecisionContent, DecisionQuestion, DecisionQuestions } from '../../types';

export const params = {
  baseURL: 'https://console.nace.ai/v1',
  /** @see https://console.nace.ai/docs/drex/api-reference/systemone */
  decide: { includeUser: false, path: '/systemone', protocol: 'systemone' },
  provider: 'nace',
} satisfies OpenAICompatibleFactoryOptions;

const NaceCompatibleAI = createOpenAICompatibleRuntime(params);

type NaceClientOptions = ConstructorParameters<typeof NaceCompatibleAI>[0];

/**
 * Drex takes any JSON as `state`, but rejects a question whose `instructions` or criteria are
 * not strings (422 `must be a string`), so structured guidance is serialized before sending.
 * @see https://console.nace.ai/docs/drex/guides/questions
 */
const toText = (content: DecisionContent): string =>
  typeof content === 'string' ? content : JSON.stringify(content);

const toNaceQuestion = (question: DecisionQuestion): DecisionQuestion => {
  const instructions = toText(question.instructions);

  switch (question.type) {
    case 'boolean': {
      const { criteria } = question;
      return {
        ...question,
        ...(criteria && {
          criteria: { false: toText(criteria.false), true: toText(criteria.true) },
        }),
        instructions,
      };
    }
    case 'choice': {
      return {
        ...question,
        criteria: Object.fromEntries(
          Object.entries(question.criteria).map(([option, guidance]) => [
            option,
            guidance === null ? null : toText(guidance),
          ]),
        ),
        instructions,
      };
    }
    case 'score': {
      return { ...question, criteria: question.criteria.map(toText), instructions };
    }
  }
};

const toNaceQuestions = <Q extends DecisionQuestions>(questions: Q): Q =>
  Object.fromEntries(
    Object.entries(questions).map(([name, question]) => [name, toNaceQuestion(question)]),
  ) as Q;

/** Nace exposes System One decisions (Drex), not the broader OpenAI-compatible capability set. */
export class LobeNaceAI implements LobeRuntimeAI {
  baseURL: string;
  decide: NonNullable<LobeRuntimeAI['decide']>;
  private runtime: InstanceType<typeof NaceCompatibleAI>;

  constructor(options?: NaceClientOptions) {
    this.runtime = new NaceCompatibleAI(options);
    this.baseURL = this.runtime.baseURL;
    this.decide = (payload, decideOptions) =>
      this.runtime.decide!(
        { ...payload, questions: toNaceQuestions(payload.questions) },
        decideOptions,
      );
  }
}
