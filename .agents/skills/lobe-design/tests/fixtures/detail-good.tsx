// GOOD fixture for check-detail.mjs: must report zero findings (all states + feedback handled).
import { Button, Empty, Input, Popconfirm, Tooltip, toast } from '@lobehub/ui';
import { Form } from '@lobehub/ui/form';
import { useClientDataSWR } from '@/libs/swr';

export const UsageList = ({ canExport }) => {
  const { data, error, isLoading, mutate } = useClientDataSWR('usage', fetchUsage);
  const [exporting, setExporting] = useState(false);
  const handleExport = async () => {
    setExporting(true);
    try { await exportUsage(); toast.success('用量已导出到下载目录'); }
    catch (e) { toast.error(`导出失败：${e.message}，请稍后重试`); }
    finally { setExporting(false); }
  };
  const handleDeleteKey = async (id) => { await deleteKey(id); toast.success('密钥已删除'); };

  if (isLoading) return <Skeleton />;
  if (error) return <Alert type="error" title="用量加载失败" action={<Button onClick={() => mutate()}>重新加载</Button>} />;
  if (!data.items.length) return <Empty description="本月还没有调用记录，先创建一个 API 密钥" />;
  return (
    <>
      <Form.Field label="搜索" name="q"><Input placeholder="例如 gpt-4o" /></Form.Field>
      {data.items.map((i) => (
        <Popconfirm key={i.id} title={`删除后使用「${i.name}」的应用将立即失效`} onConfirm={() => handleDeleteKey(i.id)}>
          <Button danger>删除密钥</Button>
        </Popconfirm>
      ))}
      <Tooltip title={canExport ? '' : '仅管理员可导出'}>
        <Button disabled={!canExport} loading={exporting} onClick={handleExport}>导出用量</Button>
      </Tooltip>
    </>
  );
};
