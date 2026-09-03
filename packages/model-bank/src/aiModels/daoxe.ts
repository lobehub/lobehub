import type { AIChatModelCard } from '../types/aiModel';

// DaoXE exposes the models available to each API key dynamically via /v1/models.
const daoxeModels: AIChatModelCard[] = [];

export const allModels = [...daoxeModels];

export default allModels;
