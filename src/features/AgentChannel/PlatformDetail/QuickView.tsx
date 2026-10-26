'use client';

import { Flexbox, Segmented, Text } from '@lobehub/ui';
import { type FormInstance, useWatch } from '@lobehub/ui/form';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { memo, type ReactNode, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import Avatar from '@/components/Avatar';
import type { SerializedPlatformDefinition } from '@/server/services/bot/platforms/types';

import type { ChannelFormValues } from './index';
import {
  pickKeywords,
  type PreviewScene,
  type PreviewSettings,
  resolveDmOutcome,
  resolveGroupOutcome,
  resolveScenes,
} from './previewModel';

// Discord's own brand colour, used only on the marks that identify its messages.
// lobe-design-ignore LOBE-RAW-COLOR: platform brand colour
const DISCORD_BLURPLE = '#5865F2';

const styles = stylex.create({
  bubble: {
    backgroundColor: cssVar.colorFillTertiary,
    borderRadius: cssVar.borderRadius,
    color: cssVar.colorText,
    fontSize: 13,
    lineHeight: 1.6,
    paddingBlock: 8,
    paddingInline: 12,
    wordBreak: 'break-word',
  },
  mention: {
    color: cssVar.colorPrimary,
  },
  appTag: {
    backgroundColor: DISCORD_BLURPLE,
    borderRadius: 3,
    color: '#fff', // lobe-design-ignore LOBE-RAW-COLOR: text on the platform's brand tag
    fontSize: 10,
    fontWeight: 600,
    lineHeight: '14px',
    paddingBlock: 1,
    paddingInline: 4,
  },
  senderAvatar: {
    alignItems: 'center',
    backgroundColor: cssVar.colorFillSecondary,
    borderRadius: '50%',
    color: cssVar.colorTextSecondary,
    display: 'flex',
    flexShrink: 0,
    fontSize: 14,
    fontWeight: 600,
    height: 36,
    justifyContent: 'center',
    width: 36,
  },
  discordBody: {
    color: cssVar.colorText,
    fontSize: 14,
    lineHeight: 1.5,
    wordBreak: 'break-word',
  },
  discordMention: {
    backgroundColor: `color-mix(in srgb, ${DISCORD_BLURPLE} 16%, transparent)`,
    borderRadius: 3,
    color: DISCORD_BLURPLE,
    paddingInline: 2,
  },
  discordName: {
    color: cssVar.colorText,
    fontSize: 14,
    fontWeight: 600,
  },
  mono: {
    color: cssVar.colorTextTertiary,
    fontFamily: cssVar.fontFamilyCode,
    fontSize: 12,
  },
  // No panel fill and no card: the chat sits straight on the page beside the form.
  panel: {
    paddingBlock: 0,
  },
  stage: {
    minHeight: 240,
    paddingBlockStart: 8,
  },
  toolCall: {
    borderColor: cssVar.colorBorderSecondary,
    borderRadius: cssVar.borderRadius,
    borderStyle: 'solid',
    borderWidth: 1,
    color: cssVar.colorTextSecondary,
    fontFamily: cssVar.fontFamilyCode,
    fontSize: 12,
    paddingBlock: 6,
    paddingInline: 12,
  },
});

type Skin = 'bubble' | 'discord';

/** Platforms that have their own message look in the preview; the rest share bubbles. */
const skinFor = (platformId: string): Skin => (platformId === 'discord' ? 'discord' : 'bubble');

interface RowProps {
  avatar: ReactNode;
  children: ReactNode;
  name: string;
  skin: Skin;
  tag?: ReactNode;
}

/** One message: a name over a bubble, or Discord's avatar-beside-text layout. */
const Row = ({ avatar, children, name, skin, tag }: RowProps) =>
  skin === 'discord' ? (
    <Flexbox horizontal align={'flex-start'} gap={12}>
      {avatar}
      <Flexbox gap={2} style={{ minWidth: 0 }}>
        <Flexbox horizontal align={'center'} gap={6}>
          <span {...stylex.props(styles.discordName)}>{name}</span>
          {tag}
        </Flexbox>
        {children}
      </Flexbox>
    </Flexbox>
  ) : (
    <Flexbox gap={4}>
      <Text ellipsis fontSize={12} type={'secondary'}>
        {name}
      </Text>
      {children}
    </Flexbox>
  );

/** The words of a message, in a bubble or as plain Discord text. */
const Words = ({ children, skin }: { children: ReactNode; skin: Skin }) => (
  <div {...stylex.props(skin === 'discord' ? styles.discordBody : styles.bubble)}>{children}</div>
);

interface QuickViewProps {
  /** The agent's avatar and its background, shown on the bot's messages. */
  botAvatar?: { avatar?: string; background?: string };
  /** The agent's name, shown as the bot's name in the preview. */
  botName?: string;
  /** Something at the right of the title, e.g. the button that folds the preview away. */
  extra?: ReactNode;
  form: FormInstance<ChannelFormValues>;
  /** The title is shown by whatever holds the preview (the drawer). */
  hideTitle?: boolean;
  platformDef: SerializedPlatformDefinition;
}

/**
 * A glance at what the bot does with the settings as they stand right now: one
 * message in a group, one in a DM, answered the way the access rules decide.
 * It reads the live form, so every change shows up before it is saved. The
 * wording of the bot's own system replies is illustrative.
 */
export const QuickView = memo<QuickViewProps>(
  ({ botAvatar, botName, extra, form, hideTitle, platformDef }) => {
    const { t: _t } = useTranslation('agent');
    const t = _t as (key: string, options?: Record<string, unknown>) => string;

    const settings = (useWatch(form, (values) => values.settings) ?? {}) as PreviewSettings & {
      displayToolCalls?: boolean;
      showUsageStats?: boolean;
    };

    const scenes = useMemo(() => {
      const section = platformDef.schema.find((field) => field.key === 'settings');
      return resolveScenes(section?.properties?.map((field) => field.key) ?? []);
    }, [platformDef.schema]);

    const [chosen, setChosen] = useState<PreviewScene>('group');
    const scene = scenes.includes(chosen) ? chosen : 'group';

    const name = botName?.trim() || t('channel.quickView.bot');
    const stranger = t('channel.quickView.stranger');
    const skin = skinFor(platformDef.id);
    const outcome = scene === 'dm' ? resolveDmOutcome(settings) : resolveGroupOutcome(settings);
    const keywords = pickKeywords(settings.watchKeywords);

    return (
      <Flexbox {...stylex.props(styles.panel)} data-testid={'channel-quick-view'} gap={12}>
        <Flexbox horizontal align={'flex-start'} gap={8} justify={'space-between'}>
          <Flexbox gap={2}>
            {!hideTitle && (
              <Text fontSize={16} weight={600}>
                {t('channel.quickView.title')}
              </Text>
            )}
            <Text fontSize={12} type={'secondary'}>
              {t('channel.quickView.desc')}
            </Text>
          </Flexbox>
          {extra}
        </Flexbox>

        {scenes.length > 1 && (
          <Segmented
            block
            size={'small'}
            value={scene}
            options={[
              { label: t('channel.quickView.sceneGroup'), value: 'group' },
              { label: t('channel.quickView.sceneDm'), value: 'dm' },
            ]}
            onChange={(value) => setChosen(value as PreviewScene)}
          />
        )}

        <Flexbox {...stylex.props(styles.stage)} gap={16}>
          <Row
            avatar={<span {...stylex.props(styles.senderAvatar)}>{stranger.slice(0, 1)}</span>}
            name={stranger}
            skin={skin}
          >
            <Words skin={skin}>
              {scene === 'dm' ? (
                t('channel.quickView.askDm')
              ) : (
                <>
                  <span
                    {...stylex.props(skin === 'discord' ? styles.discordMention : styles.mention)}
                  >
                    @{name}
                  </span>{' '}
                  {t('channel.quickView.ask')}
                </>
              )}
            </Words>
          </Row>

          <Row
            name={name}
            skin={skin}
            tag={skin === 'discord' ? <span {...stylex.props(styles.appTag)}>APP</span> : undefined}
            avatar={
              <Avatar
                avatar={botAvatar?.avatar}
                background={botAvatar?.background}
                name={name}
                shape={'circle'}
                size={36}
              />
            }
          >
            {outcome.kind === 'notice' && (
              <Words skin={skin}>{t(`channel.quickView.${outcome.noticeKey}`)}</Words>
            )}
            {outcome.kind === 'answer' && (
              <>
                {settings.displayToolCalls && (
                  <div {...stylex.props(styles.toolCall)}>{t('channel.quickView.toolCall')}</div>
                )}
                <Words skin={skin}>{t('channel.quickView.answer')}</Words>
                {settings.showUsageStats && (
                  <span {...stylex.props(styles.mono)}>1.2k tokens · $0.004 · 3.2s</span>
                )}
                {outcome.scopeNote && (
                  <Text fontSize={12} type={'secondary'}>
                    {t(`channel.quickView.${outcome.scopeNote}`)}
                  </Text>
                )}
              </>
            )}
          </Row>

          {scene === 'group' && keywords.length > 0 && (
            <Text fontSize={12} type={'secondary'}>
              {t('channel.quickView.keywords', { keywords: keywords.join(' / ') })}
            </Text>
          )}
        </Flexbox>
      </Flexbox>
    );
  },
);

QuickView.displayName = 'ChannelQuickView';
