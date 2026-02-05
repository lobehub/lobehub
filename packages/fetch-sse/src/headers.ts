/**
 * Convert HeadersInit to Record<string, string>
 * @param headersInit - Headers initialization object
 * @returns The converted record object
 */

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
