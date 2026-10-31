import type { LobeRuntimeAI } from '../../core/BaseAI';
import type { OpenAICompatibleFactoryOptions } from '../../core/openaiCompatibleFactory';
import { createOpenAICompatibleRuntime } from '../../core/openaiCompatibleFactory';

export const params = {
  baseURL: 'https://api.typesafe.ai/v1',
  /** @see https://docs.typesafe.ai/api */
  decide: { includeUser: false, path: '/systemone', protocol: 'systemone' },
  provider: 'typesafe',
} satisfies OpenAICompatibleFactoryOptions;

const TypeSafeCompatibleAI = createOpenAICompatibleRuntime(params);

type TypeSafeClientOptions = ConstructorParameters<typeof TypeSafeCompatibleAI>[0];

/** TypeSafe exposes System One decisions, not the broader OpenAI-compatible capability set. */
export class LobeTypeSafeAI implements LobeRuntimeAI {
  baseURL: string;
  decide: NonNullable<LobeRuntimeAI['decide']>;
  private runtime: InstanceType<typeof TypeSafeCompatibleAI>;

  constructor(options?: TypeSafeClientOptions) {
    this.runtime = new TypeSafeCompatibleAI(options);
    this.baseURL = this.runtime.baseURL;
    this.decide = this.runtime.decide!.bind(this.runtime);
  }
}
