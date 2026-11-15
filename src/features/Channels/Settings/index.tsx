import { ActionIcon, Flexbox, Tabs, Text } from '@lobehub/ui';
import * as stylex from '@stylexjs/stylex';
import { ArrowLeft } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Navigate, useNavigate, useParams, useSearchParams } from 'react-router';

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
import { channelSettingsTabs, resolveChannelSettingsTab } from './tabs';

/** Everything an admin manages about a group Channel: its conversation stays uncluttered. */
function EnabledChannelSettings() {
  const { t } = useTranslation('channel');
  const { channelId } = useParams<{ channelId: string }>();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const view = { channelId: channelId ?? '', threadId: null };
  const sync = channelActions.useFetchDetail(channelId ? view : null);
  const detail = visibleChannelDetail(useChannelStore(channelSelectors.detail(view)), sync.error);
  if (!channelId) return null;

  // A direct conversation is titled by its Agent and has no roster to manage.
  if (detail && (detail.channel.agentId || !detail.channel.canDelete))
    return <Navigate replace relative="path" to=".." />;

  const channel = detail?.channel;
  const tabs = channelSettingsTabs(channel?.status === 'archived');
  const tab = resolveChannelSettingsTab(searchParams.get('tab'), tabs);

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
            <Flexbox gap={24} {...stylex.props(settingsStyles.content)}>
              <Tabs
                activeKey={tab}
                items={tabs.map((key) => ({ key, label: t(`settings.tab.${key}`) }))}
                variant="square"
                onChange={(key) => setSearchParams({ tab: key }, { replace: true })}
              />
              {/* Kept mounted so switching tabs does not discard a draft. */}
              <div hidden={tab !== 'general'} key={`general:${channel.id}`}>
                <GeneralSection channel={channel} />
              </div>
              <div hidden={tab !== 'members'}>
                <MembersSection detail={detail} />
              </div>
              {tabs.includes('reply') && (
                <div hidden={tab !== 'reply'} key={`reply:${channel.id}`}>
                  <ReplySection channelId={channel.id} />
                </div>
              )}
              <div hidden={tab !== 'advanced'}>
                <Flexbox gap={24}>
                  <DangerSection channel={channel} />
                </Flexbox>
              </div>
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
