import {
  fluxDevParamsSchema,
  fluxKontextDevParamsSchema,
  fluxSchnellParamsSchema,
  sd15T2iParamsSchema,
  sd35ParamsSchema,
  sdxlT2iParamsSchema,
} from 'model-bank/comfyui';

export const parametersFixture = {
  models: {
    'flux-dev': {
      boundaries: {
        max: {
          cfg: fluxDevParamsSchema.cfg!.max,
          steps: fluxDevParamsSchema.steps!.max,
        },
        min: {
          cfg: fluxDevParamsSchema.cfg!.min,
          steps: fluxDevParamsSchema.steps!.min,
        },
      },
      defaults: {
        cfg: fluxDevParamsSchema.cfg!.default,
        samplerName: fluxDevParamsSchema.samplerName!.default,
        scheduler: fluxDevParamsSchema.scheduler!.default,
        steps: fluxDevParamsSchema.steps!.default,
      },
      schema: fluxDevParamsSchema,
    },
    'flux-kontext': {
      boundaries: {
        max: {
          cfg: fluxKontextDevParamsSchema.cfg!.max,
          steps: fluxKontextDevParamsSchema.steps!.max,
        },
        min: {
          cfg: fluxKontextDevParamsSchema.cfg!.min,
          steps: fluxKontextDevParamsSchema.steps!.min,
        },
      },
      defaults: {
        cfg: fluxKontextDevParamsSchema.cfg!.default,
        steps: fluxKontextDevParamsSchema.steps!.default,
        strength: fluxKontextDevParamsSchema.strength!.default,
      },
      schema: fluxKontextDevParamsSchema,
    },
    'flux-schnell': {
      boundaries: {
        max: {
          cfg: 1,
          steps: fluxSchnellParamsSchema.steps!.max,
        },
        min: {
          cfg: 1,
          steps: fluxSchnellParamsSchema.steps!.min,
        },
      },
      defaults: {
        cfg: 1,
        samplerName: fluxSchnellParamsSchema.samplerName!.default,

        scheduler: fluxSchnellParamsSchema.scheduler!.default,
        // Schnell fixed at 1
        steps: fluxSchnellParamsSchema.steps!.default,
      },
      schema: fluxSchnellParamsSchema,
    },
    'sd15': {
      boundaries: {
        max: {
          cfg: sd15T2iParamsSchema.cfg!.max,
          steps: sd15T2iParamsSchema.steps!.max,
        },
        min: {
          cfg: sd15T2iParamsSchema.cfg!.min,
          steps: sd15T2iParamsSchema.steps!.min,
        },
      },
      defaults: {
        cfg: sd15T2iParamsSchema.cfg!.default,
        samplerName: sd15T2iParamsSchema.samplerName!.default,
        scheduler: sd15T2iParamsSchema.scheduler!.default,
        steps: sd15T2iParamsSchema.steps!.default,
      },
      schema: sd15T2iParamsSchema,
    },
    'sd35': {
      boundaries: {
        max: {
          cfg: sd35ParamsSchema.cfg!.max,
          steps: sd35ParamsSchema.steps!.max,
        },
        min: {
          cfg: sd35ParamsSchema.cfg!.min,
          steps: sd35ParamsSchema.steps!.min,
        },
      },
      defaults: {
        cfg: sd35ParamsSchema.cfg!.default,
        samplerName: sd35ParamsSchema.samplerName!.default,
        scheduler: sd35ParamsSchema.scheduler!.default,
        steps: sd35ParamsSchema.steps!.default,
      },
      schema: sd35ParamsSchema,
    },
    'sdxl': {
      boundaries: {
        max: {
          cfg: sdxlT2iParamsSchema.cfg!.max,
          steps: sdxlT2iParamsSchema.steps!.max,
        },
        min: {
          cfg: sdxlT2iParamsSchema.cfg!.min,
          steps: sdxlT2iParamsSchema.steps!.min,
        },
      },
      defaults: {
        cfg: sdxlT2iParamsSchema.cfg!.default,
        samplerName: sdxlT2iParamsSchema.samplerName!.default,
        scheduler: sdxlT2iParamsSchema.scheduler!.default,
        steps: sdxlT2iParamsSchema.steps!.default,
      },
      schema: sdxlT2iParamsSchema,
    },
  },

  transformations: {
    aspectRatio: [
      { expected: { height: 576, width: 1024 }, input: '16:9' },
      { expected: { height: 1024, width: 1024 }, input: '1:1' },
      { expected: { height: 1024, width: 576 }, input: '9:16' },
    ],
    imageUrl: [
      { expectedParam: 'imageUrl', input: 'test.png', mode: 'img2img' },
      { expectedParam: undefined, input: undefined, mode: 'txt2img' },
    ],
  },
};
