// GOOD fixture: lint-lobe.mjs must report zero findings here.
import { Button, Empty, Table, toast } from '@lobehub/ui';
import { Form } from '@lobehub/ui/form';
import { Icon } from '@lobehub/ui';
import { createStaticStyles } from '@lobehub/ui';
import { Trash2 } from 'lucide-react';

export const styles = createStaticStyles(({ css, cssVar }) => ({
  root: css`
    /* block comments are fine */
    color: ${cssVar.colorTextSecondary};
    border-block-end: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: ${cssVar.borderRadiusLG};
    transition: opacity 150ms ease-out, transform 200ms ease-out;
    font-family: ${cssVar.fontFamilyCode};
  `,
  // lobe-design-ignore LOBE-RAW-COLOR: brand asset color required by legal, tracked as D-11 gap
  logo: css`color: #ff6a00;`,
}));

export const KeyList = ({ data, onDelete }) => (
  <>
    <Table dataSource={data} locale={{ emptyText: <Empty description="还没有 API 密钥，先创建一个" /> }} />
    <Button icon={<Icon icon={Trash2} />} title="删除所选密钥" onClick={onDelete}>
      删除 3 个密钥
    </Button>
    <img alt="模型用量趋势" src="/trend.png" />
    <span>{data?.length ?? '--'}</span>
    <button type="button" onClick={() => toast.success('已复制')}>复制密钥</button>
  </>
);
