// Fixture: drizzle's InferSelectModel over a concrete table.
import type { InferInsertModel, InferSelectModel } from 'drizzle-orm';

import type { topics } from '@/database/schemas';

// alint-expect
export type TopicRow = InferSelectModel<typeof topics>;

// alint-expect
export const buildTopic = (input: Partial<InferInsertModel<typeof topics>>) => ({ ...input });
