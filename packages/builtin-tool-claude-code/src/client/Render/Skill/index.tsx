'use client';

import type { BuiltinRenderProps } from '@lobechat/types';
import { Flexbox, Icon, Markdown, Text } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import { Sparkles } from 'lucide-react';
import { memo } from 'react';

import type { SkillArgs } from '../../../types';

const styles = createStaticStyles(({ css, cssVar }) => ({
  container: css`
    padding: 8px;
    border-radius: ${cssVar.borderRadiusLG};
    background: ${cssVar.colorFillQuaternary};
  `,
  header: css`
    padding-inline: 4px;
    color: ${cssVar.colorTextSecondary};
  `,
  previewBox: css`
    overflow: hidden;

    padding-block: 4px;
    padding-inline: 8px;
    border-radius: 8px;

    background: ${cssVar.colorBgContainer};
  `,
}));

const Skill = memo<BuiltinRenderProps<SkillArgs>>(({ args, content }) => {
  const skillName = args?.skill;

  return (
    <Flexbox className={styles.container} gap={8}>
      <Flexbox horizontal align={'center'} className={styles.header} gap={8}>
        <Icon icon={Sparkles} size={'small'} />
        <Text strong>{skillName || 'Skill'}</Text>
      </Flexbox>

      {content && (
        <Flexbox className={styles.previewBox}>
          <Markdown style={{ maxHeight: 240, overflow: 'auto' }} variant={'chat'}>
            {content}
          </Markdown>
        </Flexbox>
      )}
    </Flexbox>
  );
});

Skill.displayName = 'ClaudeCodeSkill';

export default Skill;
