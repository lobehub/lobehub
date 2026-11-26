'use client';

import { MemoryManifest } from '@lobechat/builtin-tool-memory';
import { WebBrowsingManifest } from '@lobechat/builtin-tool-web-browsing';
import { ActionIcon, Center, Popover } from '@lobehub/ui';
import * as stylex from '@stylexjs/stylex';
import { Settings2Icon } from 'lucide-react';
import { memo, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { MemoryEffortControl } from '@/features/ChatInput/ActionBar/Memory/Controls';
import {
  SearchAdvancedControls,
  useSearchAdvancedVisibility,
} from '@/features/ChatInput/ActionBar/Search/Controls';

const styles = stylex.create({
  panel: {
    display: 'flex',
    flexDirection: 'column',
    width: '280px',
    padding: '4px',
  },
});

const SettingsSlot = ({ content, title }: { content: ReactNode; title: string }) => (
  <Center flex={'none'} width={24} onClick={(event) => event.stopPropagation()}>
    <Popover
      arrow={false}
      content={<div {...stylex.props(styles.panel)}>{content}</div>}
      placement={'bottomRight'}
      styles={{ content: { padding: 0 } }}
      trigger={'click'}
    >
      <ActionIcon aria-label={title} icon={Settings2Icon} size={'small'} title={title} />
    </Popover>
  </Center>
);

const SearchSettingsSlot = ({ enabled }: { enabled: boolean }) => {
  const { t } = useTranslation('setting');
  const { hasControls } = useSearchAdvancedVisibility();

  if (!enabled || !hasControls) return <Center flex={'none'} width={24} />;

  return (
    <SettingsSlot
      content={<SearchAdvancedControls showDivider={false} />}
      title={t('tools.builtins.configure')}
    />
  );
};

const MemorySettingsSlot = ({ enabled }: { enabled: boolean }) => {
  const { t } = useTranslation('setting');

  if (!enabled) return <Center flex={'none'} width={24} />;

  return (
    <SettingsSlot
      content={<MemoryEffortControl showDivider={false} />}
      title={t('tools.builtins.configure')}
    />
  );
};

export const isConfigurableCapability = (pluginId: string) =>
  pluginId === WebBrowsingManifest.identifier || pluginId === MemoryManifest.identifier;

/**
 * Advanced capability settings button for the agent Tools profile page:
 * keeps model-native search / FC search model and memory effort reachable
 * now that the right-side WorkingSidebar Tools tab is display-only.
 */
const CapabilitySettingsButton = memo<{ enabled: boolean; pluginId: string }>(
  ({ enabled, pluginId }) => {
    if (pluginId === WebBrowsingManifest.identifier) {
      return <SearchSettingsSlot enabled={enabled} />;
    }
    if (pluginId === MemoryManifest.identifier) {
      return <MemorySettingsSlot enabled={enabled} />;
    }
    return <Center flex={'none'} width={24} />;
  },
);

CapabilitySettingsButton.displayName = 'CapabilitySettingsButton';

export default CapabilitySettingsButton;
