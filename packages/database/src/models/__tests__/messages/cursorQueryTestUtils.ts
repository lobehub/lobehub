import { messages, topics } from '../../../schemas';
import type { LobeChatDatabase } from '../../../type';

/**
 * Seed `rounds` rounds of (1 user + `stepsPerRound` assistant) as one contiguous
 * mainline parentId chain. Returns the ordered ids (oldest→newest) plus the
 * round-start user ids.
 */
export const seedCursorRounds = async (
  serverDB: LobeChatDatabase,
  userId: string,
  topicId: string,
  rounds: number,
  stepsPerRound: number,
) => {
  await serverDB.insert(topics).values([{ id: topicId, userId }]);
  const rows: any[] = [];
  const ids: string[] = [];
  const roundStarts: string[] = [];
  let seq = 0;
  let prevId: string | null = null;
  for (let r = 1; r <= rounds; r += 1) {
    const uid = `${topicId}-u${r}`;
    rows.push({
      id: uid,
      userId,
      topicId,
      role: 'user',
      parentId: prevId,
      content: `q${r}`,
      createdAt: new Date(2023, 0, 1, 0, seq),
    });
    seq += 1;
    ids.push(uid);
    roundStarts.push(uid);
    prevId = uid;
    for (let step = 1; step <= stepsPerRound; step += 1) {
      const sid = `${topicId}-a${r}-${step}`;
      rows.push({
        id: sid,
        userId,
        topicId,
        role: 'assistant',
        parentId: prevId,
        content: `a${r}.${step}`,
        createdAt: new Date(2023, 0, 1, 0, seq),
      });
      seq += 1;
      ids.push(sid);
      prevId = sid;
    }
  }
  await serverDB.insert(messages).values(rows);
  return { ids, lastId: prevId as string, roundStarts };
};
