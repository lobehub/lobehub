import type { AIChatModelCard } from '../types/aiModel';

// DotHoosh models, limits and USD prices are fetched live from
// https://gateway.dothoosh.com/v1/models (and /anthropic/v1/models for Claude) by the
// model-runtime provider, so this list is intentionally empty.
const dothooshChatModels: AIChatModelCard[] = [];

export const allModels = [...dothooshChatModels];

export default allModels;
