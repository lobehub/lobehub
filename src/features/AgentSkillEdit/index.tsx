'use client';

import { isDesktop } from '@lobechat/const';
import { TITLE_BAR_HEIGHT } from '@lobechat/desktop-bridge';
import type { SkillResourceTreeNode } from '@lobechat/types';
import { Button, Drawer, Flexbox } from '@lobehub/ui';
import { Form as AForm, Alert, App, Popconfirm, Skeleton } from 'antd';
import { createStaticStyles } from 'antd-style';
import { memo, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import ContentViewer from '@/features/AgentSkillDetail/ContentViewer';
import FileTree from '@/features/AgentSkillDetail/FileTree';
import { useToolStore } from '@/store/tool';

import SkillEditForm, { type SkillEditFormValues } from './SkillEditForm';

const styles = createStaticStyles(({ css, cssVar }) => ({
  divider: css`
    flex-shrink: 0;
    width: 1px;
    background: ${cssVar.colorBorderSecondary};
  `,
  left: css`
    overflow-y: auto;
    flex-shrink: 0;
    width: 240px;
    padding: 8px;
  `,
  right: css`
    container-type: size;
    overflow: auto;
    flex: 1;
  `,
}));

const buildContentMap = (nodes: SkillResourceTreeNode[]): Record<string, string> => {
  const map: Record<string, string> = {};
  const walk = (items: SkillResourceTreeNode[]) => {
    for (const node of items) {
      if (node.type === 'file' && node.content !== undefined) {
        map[node.path] = node.content;
      } else if (node.children) {
        walk(node.children);
      }
    }
  };
  walk(nodes);
  return map;
};

interface AgentSkillEditProps {
  onClose: () => void;
  open: boolean;
  skillId: string;
}

const AgentSkillEdit = memo<AgentSkillEditProps>(({ skillId, open, onClose }) => {
  const { t } = useTranslation('setting');
  const { t: tp } = useTranslation('plugin');
  const { t: tc } = useTranslation('common');
  const { message } = App.useApp();

  const [selectedFile, setSelectedFile] = useState('SKILL.md');
  const [saving, setSaving] = useState(false);
  const [form] = AForm.useForm();

  const { data, isLoading } = useToolStore((s) => s.useFetchAgentSkillDetail)(
    open ? skillId : undefined,
  );
  const updateAgentSkill = useToolStore((s) => s.updateAgentSkill);
  const deleteAgentSkill = useToolStore((s) => s.deleteAgentSkill);

  const skillDetail = data?.skillDetail;
  const resourceTree = data?.resourceTree ?? [];
  const contentMap = useMemo(() => buildContentMap(resourceTree), [resourceTree]);

  const initialValues: SkillEditFormValues = useMemo(
    () => ({
      content: skillDetail?.content || '',
      description: skillDetail?.description || skillDetail?.manifest?.description || '',
    }),
    [skillDetail],
  );

  const handleSubmit = async (values: SkillEditFormValues) => {
    setSaving(true);
    try {
      await updateAgentSkill({
        content: values.content,
        id: skillId,
        manifest: { description: values.description },
      });
      message.success(t('agentSkillEdit.saveSuccess'));
      onClose();
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    await deleteAgentSkill(skillId);
    message.success(tp('dev.deleteSuccess'));
    onClose();
  };

  const footer = (
    <Flexbox flex={1} gap={12} horizontal justify={'space-between'}>
      <Popconfirm
        arrow={false}
        cancelText={tc('cancel')}
        okButtonProps={{
          danger: true,
          type: 'primary',
        }}
        okText={tc('ok')}
        onConfirm={handleDelete}
        placement={'topLeft'}
        title={tp('dev.confirmDeleteDevPlugin')}
      >
        <Button danger>{tc('delete')}</Button>
      </Popconfirm>
      <Flexbox gap={12} horizontal>
        <Button onClick={onClose}>{tc('cancel')}</Button>
        <Button
          loading={saving}
          onClick={() => {
            form.submit();
          }}
          type={'primary'}
        >
          {tp('dev.update')}
        </Button>
      </Flexbox>
    </Flexbox>
  );

  return (
    <Drawer
      containerMaxWidth={'auto'}
      destroyOnHidden
      footer={footer}
      height={isDesktop ? `calc(100vh - ${TITLE_BAR_HEIGHT}px)` : '100vh'}
      onClose={(e) => {
        e.stopPropagation();
        onClose();
      }}
      open={open}
      placement={'bottom'}
      push={false}
      styles={{
        body: { padding: 0 },
        bodyContent: { height: '100%' },
      }}
      title={t('agentSkillEdit.title')}
    >
      {isLoading ? (
        <Skeleton active paragraph={{ rows: 8 }} style={{ padding: 16 }} />
      ) : (
        <Flexbox
          height={'100%'}
          horizontal
          onClick={(e) => {
            e.stopPropagation();
          }}
        >
          <div className={styles.left}>
            <FileTree
              onSelectFile={setSelectedFile}
              resourceTree={resourceTree}
              selectedFile={selectedFile}
            />
          </div>
          <div className={styles.divider} />
          <div className={styles.right}>
            <div
              style={{
                display: selectedFile === 'SKILL.md' ? undefined : 'none',
                height: '100%',
                overflow: 'auto',
              }}
            >
              <SkillEditForm
                form={form}
                initialValues={initialValues}
                name={skillDetail?.name}
                onSubmit={handleSubmit}
              />
            </div>
            {selectedFile !== 'SKILL.md' && (
              <>
                <Alert banner message={t('agentSkillEdit.fileReadonly')} showIcon type="info" />
                <ContentViewer
                  contentMap={contentMap}
                  key={selectedFile}
                  selectedFile={selectedFile}
                  skillDetail={skillDetail}
                />
              </>
            )}
          </div>
        </Flexbox>
      )}
    </Drawer>
  );
});

AgentSkillEdit.displayName = 'AgentSkillEdit';

export default AgentSkillEdit;
