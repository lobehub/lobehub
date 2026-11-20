// 75-copy（T-02 / T-03）回归：中文排版
import { Button, Text, toast } from '@lobehub/ui';

export const CopyBad = ({ n }: { n: number }) => {
  const onSave = () => toast.success('已保存API密钥'); // expect: LOBE-CJK-LATIN-SPACE
  const onFail = () => toast.error('保存失败,请检查网络后重试'); // expect: LOBE-HALFWIDTH-PUNCT
  return (
    <>
      <Text>共3条记录</Text> {/* expect: LOBE-CJK-LATIN-SPACE */}
      <Text>{'模型名称:'}</Text> {/* expect: LOBE-HALFWIDTH-PUNCT */}
      <Button onClick={onSave}>保存 API 密钥</Button>
      <Button onClick={onFail}>重试保存</Button>
      <Text>{`单次上传上限10GB`}</Text> {/* expect: LOBE-CJK-LATIN-SPACE */}
      <Text>已选 {n} 项</Text>
    </>
  );
};
