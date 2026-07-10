import { LOBE_DEFAULT_MODEL_LIST } from 'model-bank';

const locales: Record<`${string}.description`, string> = {};

LOBE_DEFAULT_MODEL_LIST.forEach((model) => {
  if (!model.description) return;

  locales[`${model.id}.description`] = model.description;
});

// #region LobeHub online model descriptions
const lobeHubOnlineModelLocales = {
  'dreamina-seedance-2-0-260128.description':
    'Seedance 2.0 by ByteDance is the most powerful video generation model, supporting multimodal reference video generation, video editing, video extension, text-to-video, and image-to-video with synchronized audio.',
  'dreamina-seedance-2-0-fast-260128.description':
    'Seedance 2.0 Fast by ByteDance offers the same capabilities as Seedance 2.0 with faster generation speeds at a more competitive price.',
  'fal-ai/bytedance/seedream/v4.5.description':
    'Seedream 4.5, built by ByteDance Seed team, supports multi-image editing and composition. Features enhanced subject consistency, precise instruction following, spatial logic understanding, aesthetic expression, poster layout and logo design with high-precision text-image rendering.',
  'grok-4.20-beta-0309-non-reasoning.description': 'A non-reasoning variant for simple use cases',
  'grok-4.20-beta-0309-reasoning.description':
    'Intelligent, blazing-fast model that reasons before responding',
  'lobehub-glm-5.2-fast.description':
    'Fast variant of GLM-5.2 with substantially lower latency. Same capabilities as GLM-5.2 — costs more, but responds much faster.',
  'seedance-1-5-pro-251215.description':
    'Seedance 1.5 Pro by ByteDance supports text-to-video, image-to-video (first frame, first+last frame), and audio generation synchronized with visuals.',
  'seedream-5-0-260128.description':
    'ByteDance-Seedream-5.0-lite by BytePlus features web-retrieval-augmented generation for real-time information, enhanced complex prompt interpretation, and improved reference consistency for professional visual creation.',
} satisfies Record<`${string}.description`, string>;

Object.assign(locales, lobeHubOnlineModelLocales);
// #endregion

export default locales;
