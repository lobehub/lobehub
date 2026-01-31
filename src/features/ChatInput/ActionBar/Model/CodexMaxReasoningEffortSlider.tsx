import { type CreatedLevelSliderProps, createLevelSliderComponent } from './createLevelSlider';

const CODEX_MAX_REASONING_EFFORT_LEVELS = ['low', 'medium', 'high', 'xhigh'] as const;
type CodexMaxReasoningEffort = (typeof CODEX_MAX_REASONING_EFFORT_LEVELS)[number];

export type CodexMaxReasoningEffortSliderProps = CreatedLevelSliderProps<CodexMaxReasoningEffort>;

const CodexMaxReasoningEffortSlider = createLevelSliderComponent<CodexMaxReasoningEffort>({
  configKey: 'codexMaxReasoningEffort',
  defaultValue: 'medium',
  levels: CODEX_MAX_REASONING_EFFORT_LEVELS,
  style: { minWidth: 200 },
});

export default CodexMaxReasoningEffortSlider;
