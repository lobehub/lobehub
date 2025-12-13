/**
 * 将 HeadersInit 转换为 Record<string, string>
 * @param headersInit - Headers 初始化对象
 * @returns 转换后的记录对象
 */
// eslint-disable-next-line no-undef
export const headersToRecord = (headersInit?: HeadersInit): Record<string, string> => {
  const record: Record<string, string> = {};
  if (!headersInit) {
    return record;
  }
  if (headersInit instanceof Headers) {
    headersInit.forEach((value, key) => {
      record[key] = value;
    });
  } else if (Array.isArray(headersInit)) {
    headersInit.forEach(([key, value]) => {
      record[key] = value;
    });
  } else {
    Object.assign(record, headersInit);
  }
  delete record['host'];
  delete record['connection'];
  delete record['content-length'];
  return record;
};
