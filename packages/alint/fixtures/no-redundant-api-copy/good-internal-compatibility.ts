import { z } from 'zod';

// Released clients send T by default. Strip that obsolete input so server-owned
// project identifiers stay authoritative while legacy requests still succeed.
export const CreateTaskRequestSchema = z.object({ instruction: z.string() });
