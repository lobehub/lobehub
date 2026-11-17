'use client';

import { AGENT_CHAT_TOPIC_URL } from '@lobechat/const';
import type { BuiltinRenderProps } from '@lobechat/types';
import { Button, Flexbox, Icon, Text } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import { GitBranch, SquareArrowOutUpRight } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';

import type { StartSessionParams, StartSessionState } from '../../types';

/** The opened sub-session, with a way into it. Its replies come back as their own messages. */
const StartSessionRender = memo<BuiltinRenderProps<StartSessionParams, StartSessionState>>(
  ({ args, pluginState }) => {
    const { t } = useTranslation('plugin');
    const navigate = useWorkspaceAwareNavigate();
    if (!pluginState?.topicId) return null;

    const { agentId, branch, topicId } = pluginState;

    return (
      <Flexbox
        horizontal
        align={'center'}
        gap={8}
        justify={'space-between'}
        paddingBlock={8}
        paddingInline={12}
        style={{
          border: `1px solid ${cssVar.colorBorderSecondary}`,
          borderRadius: 8,
        }}
      >
        <Flexbox gap={2} style={{ minWidth: 0 }}>
          <Text ellipsis weight={500}>
            {args?.title || t('builtins.lobe-session.render.untitled')}
          </Text>
          {branch && (
            <Flexbox horizontal align={'center'} gap={4}>
              <Icon icon={GitBranch} size={12} style={{ color: cssVar.colorTextTertiary }} />
              <Text code ellipsis fontSize={12} type={'secondary'}>
                {branch}
              </Text>
            </Flexbox>
          )}
        </Flexbox>
        {agentId && (
          <Button
            icon={<Icon icon={SquareArrowOutUpRight} />}
            size={'small'}
            onClick={() => navigate(AGENT_CHAT_TOPIC_URL(agentId, topicId))}
          >
            {t('builtins.lobe-session.render.open')}
          </Button>
        )}
      </Flexbox>
    );
  },
);

StartSessionRender.displayName = 'StartSessionRender';

export default StartSessionRender;
