// 75-copy 反例：看起来像，但合规（或不在检查范围内），不应报
import { Button, Text, toast } from '@lobehub/ui';

const CJK_RE = /[\u4e00-\u9fff]/; // 正则字面量不是界面文案
const docs = 'https://lobehub.com/docs/模型';

export const CopyGood = ({ n, model }: { n: number; model: string }) => {
  const onSave = () => toast.success('已保存 API 密钥');
  const onFail = () => toast.error('保存失败，请检查网络后重试');
  return (
    <>
      <Text>共 3 条记录，单次上传上限 10 GB，增长 50%</Text>
      <Text>{`已选${n}项`}</Text>
      <Text>当前模型：{model}</Text>
      <Text>{'Hello, world: ready?'}</Text>
      <Button onClick={onSave}>保存 API 密钥</Button>
      <Button onClick={onFail}>重试保存</Button>
      <Text>{CJK_RE.test(docs) ? '使用 OpenAI 兼容接口' : '--'}</Text>
    </>
  );
};
