// Fixture for check-detail.mjs: every id in the `expect-file:` header must be reported for this file.
// expect-file: DETAIL-NO-LOADING DETAIL-NO-ERROR DETAIL-NO-RETRY DETAIL-NO-EMPTY DETAIL-NO-PENDING DETAIL-NO-RESULT-FEEDBACK DETAIL-DANGER-NO-CONFIRM DETAIL-DISABLED-NO-REASON DETAIL-INPUT-NO-LABEL
import { useClientDataSWR } from '@/libs/swr';

export const UsageList = ({ canExport }) => {
  const { data } = useClientDataSWR('usage', fetchUsage);
  const handleExport = async () => { await exportUsage(); };
  const handleDeleteKey = async (id) => { await deleteKey(id); };
  return (
    <ul>
      <input placeholder="搜索用量" />
      {data.items.map((i) => (
        <li key={i.id}>
          {i.name}
          <button type="button" onClick={() => handleDeleteKey(i.id)}>删除密钥</button>
        </li>
      ))}
      <button type="button" disabled={!canExport} onClick={handleExport}>导出用量</button>
    </ul>
  );
};
