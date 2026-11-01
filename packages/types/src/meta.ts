import { z } from 'zod';

export const LobeMetaDataSchema = z.object({
  /**
   * Character avatar
   */
  avatar: z.string().optional(),
  /**
   *  Background color
   */
  backgroundColor: z.string().optional(),
  description: z.string().optional(),
  /**
   * Market agent identifier for published agents
   */
  marketIdentifier: z.string().optional(),
  /**
   * Personal name of an agent (e.g. "Alice", "小艾") — the identity it is
   * addressed by, as opposed to `title`, which names the role it plays.
   * Only agents carry it; other metadata holders leave it empty.
   */
  name: z.string().optional(),

  tags: z.array(z.string()).optional(),
  /**
   * Display label — for agents this is the role ("Health Assistant"), see `name`
   */
  title: z.string().optional(),
});

export type MetaData = z.infer<typeof LobeMetaDataSchema>;

export interface BaseDataModel {
  createdAt: number;

  id: string;
  meta: MetaData;

  updatedAt: number;
}
