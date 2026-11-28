/**
 * QQ's own error codes, read off the failed request.
 *
 * The API client throws `QQ API <method> <path> failed: <status> <body>`, so the numeric code is
 * in the message — see the error table on
 * https://bot.q.qq.com/wiki/develop/api-v2/autogen/api/v2_groups_group_openid_messages.post.html
 */
const errorText = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const hasCode = (error: unknown, codes: readonly string[]): boolean => {
  const text = errorText(error);

  return codes.some((code) => text.includes(code));
};

/**
 * The passive reply was refused because its window closed or its five replies are spent.
 * 40034128 = 被动回复时间或次数超限, 40034005 / 304103 = the msg_id has expired.
 */
export const isQQPassiveExpired = (error: unknown): boolean =>
  hasCode(error, ['40034128', '40034005', '304103', '40034026']);

/**
 * The active message was refused by the frequency cap.
 * 40034100 = 主动消息发送超过频控限制, 40034105 = 主动消息发送失败，无权限.
 */
export const isQQActiveRateLimited = (error: unknown): boolean =>
  hasCode(error, ['40034100', '40034105']);

/**
 * A duplicate `msg_id` + `msg_seq` pair. Retrying the same slot is useless, so the caller should
 * treat it as "this reply will not go out" rather than retrying.
 */
export const isQQDuplicateReply = (error: unknown): boolean => hasCode(error, ['40054005']);
