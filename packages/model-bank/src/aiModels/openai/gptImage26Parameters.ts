import { gptImage2Schema } from '../../const/imageParameters';
import type { ModelParamsSchema } from '../../standard-parameters';

/**
 * GPT Image 2.6 Flare / Sunburst. Animated GIF output is generation-only; the frame fields are
 * sent only with `outputFormat: 'gif'`, and a GIF leaves its frame size to the API (see
 * `applyImageOutputParams`).
 *
 * @see https://developers.openai.com/api/docs/guides/image-generation#generate-animated-gif-output
 */
export const gptImage26Schema: ModelParamsSchema = {
  // The API rejects 17 with "Use an integer from 2 to 16".
  frameCount: { default: 9, max: 16, min: 2, step: 1 },
  frameDurationMs: { default: 200, max: 2000, min: 20, step: 10 },
  imageUrls: gptImage2Schema.imageUrls,
  outputFormat: { default: 'png', enum: ['png', 'gif'] },
  prompt: { default: '' },
  quality: {
    default: 'auto',
    enum: ['auto', 'low', 'medium', 'high', 'xhigh', 'max'],
  },
  size: gptImage2Schema.size,
};
