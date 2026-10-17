import { z } from 'zod';

export const CreateTaskRequestSchema = z
  .object({ instruction: z.string() })
  // alint-expect
  .describe('Create task request schema');
