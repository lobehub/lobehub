import { createEnv } from '@t3-oss/env-core';
import { z } from 'zod';

import { MAX_DEFAULT_IMAGE_NUM, MIN_DEFAULT_IMAGE_NUM } from '@/const/settings';

export const getImageConfig = () => {
  return createEnv({
    runtimeEnv: {
      AI_IMAGE_DEFAULT_IMAGE_NUM: process.env.AI_IMAGE_DEFAULT_IMAGE_NUM,
    },
    server: {
      AI_IMAGE_DEFAULT_IMAGE_NUM: z.coerce
        .number()
        .min(
          MIN_DEFAULT_IMAGE_NUM,
          `AI_IMAGE_DEFAULT_IMAGE_NUM must be at least ${MIN_DEFAULT_IMAGE_NUM}`,
        )
        .max(
          MAX_DEFAULT_IMAGE_NUM,
          `AI_IMAGE_DEFAULT_IMAGE_NUM must be at most ${MAX_DEFAULT_IMAGE_NUM}`,
        )
        .optional(),
    },
  });
};

export const imageEnv = getImageConfig();
