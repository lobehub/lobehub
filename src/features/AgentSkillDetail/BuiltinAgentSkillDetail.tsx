'use client';

import { type BuiltinSkill, type SkillItem } from '@lobechat/types';
import { Avatar, Flexbox } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import { memo, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import ContentViewer from './ContentViewer';
import FileTree from './FileTree';

const styles = createStaticStyles(({ css, cssVar }) => ({
  description: css`
    overflow: hidden;

    margin: 0;

    font-size: 13px;
    line-height: 1.5;
    color: ${cssVar.colorTextSecondary};
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
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
  meta: css`
    flex-shrink: 0;
    padding: 16px;
    border-block-end: 1px solid ${cssVar.colorBorderSecondary};
  `,
  name: css`
    font-size: 16px;
    font-weight: 500;
    line-height: 1.4;
    color: ${cssVar.colorText};
  `,
  right: css`
    container-type: size;
    overflow: auto;
    flex: 1;
  `,
}));

interface BuiltinAgentSkillDetailProps {
  skill: BuiltinSkill;
}

const BuiltinAgentSkillDetail = memo<BuiltinAgentSkillDetailProps>(({ skill }) => {
  const { t } = useTranslation('setting');
  const [selectedFile, setSelectedFile] = useState('SKILL.md');

  const localizedTitle = t(`tools.builtins.${skill.identifier}.title`, {
    defaultValue: skill.name,
  });
  const localizedDescription = t(`tools.builtins.${skill.identifier}.description`, {
    defaultValue: skill.description,
  });

  // Construct a minimal SkillItem for ContentViewer compatibility
  const skillDetail = useMemo<Pick<SkillItem, 'content' | 'name'>>(
    () => ({
      content: skill.content,
      name: localizedTitle,
    }),
    [skill.content, localizedTitle],
  );

  return (
    <Flexbox style={{ height: '100%', overflow: 'hidden' }}>
      <div className={styles.meta}>
        <Flexbox horizontal align={'center'} gap={12}>
          <Avatar avatar={skill.avatar} shape={'square'} size={40} />
          <Flexbox flex={1} gap={4} style={{ overflow: 'hidden' }}>
            <Flexbox horizontal align={'center'} className={styles.description} gap={4}>
              <span className={styles.name}>{localizedTitle}</span>
            </Flexbox>
            {localizedDescription && <p className={styles.description}>{localizedDescription}</p>}
          </Flexbox>
        </Flexbox>
      </div>
      <Flexbox horizontal style={{ flex: 1, overflow: 'hidden' }}>
        <div className={styles.left}>
          <FileTree resourceTree={[]} selectedFile={selectedFile} onSelectFile={setSelectedFile} />
        </div>
        <div className={styles.divider} />
        <div className={styles.right} key={selectedFile}>
          <ContentViewer
            contentMap={{}}
            selectedFile={selectedFile}
            skillDetail={skillDetail as SkillItem}
          />
        </div>
      </Flexbox>
    </Flexbox>
  );
});

BuiltinAgentSkillDetail.displayName = 'BuiltinAgentSkillDetail';

export default BuiltinAgentSkillDetail;
