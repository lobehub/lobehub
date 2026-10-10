import { z } from 'zod';

export const CreateTaskRequestSchema = z.object({
  instruction: z.string().min(1).describe('Work to perform; must contain at least one character'),
  timeout: z.number().default(60).describe('Timeout in seconds; omitted values use 60 seconds'),
});
