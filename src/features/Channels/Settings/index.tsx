import { ActionIcon, Flexbox, Text } from '@lobehub/ui';
import * as stylex from '@stylexjs/stylex';
import { ArrowLeft } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Navigate, useNavigate, useParams } from 'react-router';

import NotFound from '@/components/404';
import AsyncBoundary from '@/components/AsyncBoundary';
import { RouteLoading } from '@/components/Skeleton/RouteSegment';
import NavHeader from '@/features/NavHeader';
import { channelActions, channelSelectors, useChannelStore } from '@/store/channel';
import { serverConfigSelectors, useServerConfigStore } from '@/store/serverConfig';

import { visibleChannelDetail } from '../channelAccess';
import { styles } from '../styles';
import { DangerSection } from './DangerSection';
import { GeneralSection } from './GeneralSection';
import { MembersSection } from './MembersSection';
import { ReplySection } from './ReplySection';
import { settingsStyles } from './styles';

/** Everything an admin manages about a group Channel: its conversation stays uncluttered. */
function EnabledChannelSettings() {
  const { t } = useTranslation('channel');
  const { channelId } = useParams<{ channelId: string }>();
  const navigate = useNavigate();
  const view = { channelId: channelId ?? '', threadId: null };
  const sync = channelActions.useFetchDetail(channelId ? view : null);
  const detail = visibleChannelDetail(useChannelStore(channelSelectors.detail(view)), sync.error);
  if (!channelId) return null;

  // A direct conversation is titled by its Agent and has no roster to manage.
  if (detail && (detail.channel.agentId || !detail.channel.canDelete))
    return <Navigate replace relative="path" to=".." />;

  const channel = detail?.channel;

  return (
    <Flexbox {...stylex.props(styles.layout)}>
      <NavHeader
        {...stylex.props(styles.threadHeader)}
        left={
          <Flexbox horizontal align="center" gap={8}>
            <ActionIcon
              aria-label={t('settings.back')}
              icon={ArrowLeft}
              size="small"
              title={t('settings.back')}
              onClick={() => navigate('..', { relative: 'path' })}
            />
            <Text ellipsis weight={500}>
              {t('settings.title')}
            </Text>
          </Flexbox>
        }
      />
      <div {...stylex.props(settingsStyles.scroll)}>
        <AsyncBoundary
          data={detail}
          error={sync.error}
          isLoading={!detail && !sync.error}
          onRetry={() => {
            void sync.revalidate();
          }}
        >
          {detail && channel && (
            <Flexbox gap={32} {...stylex.props(settingsStyles.content)}>
              <GeneralSection channel={channel} key={`general:${channel.id}`} />
              <MembersSection detail={detail} />
              {/* An archived Channel takes no writes until it is reopened. */}
              {channel.status !== 'archived' && (
                <ReplySection channelId={channel.id} key={`reply:${channel.id}`} />
              )}
              <DangerSection channel={channel} />
            </Flexbox>
          )}
        </AsyncBoundary>
      </div>
    </Flexbox>
  );
}

export default function ChannelSettingsPage() {
  const ready = useServerConfigStore((s) => s.serverConfigInit);
  const enabled = useServerConfigStore(serverConfigSelectors.enableChannels);
  if (!ready) return <RouteLoading />;
  return enabled ? <EnabledChannelSettings /> : <NotFound />;
}
