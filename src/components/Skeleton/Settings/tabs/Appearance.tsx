'use client';

import { isDesktop } from '@lobechat/const';
import { Flexbox } from '@lobehub/ui';
import { Form } from '@lobehub/ui/form';

import SkeletonBar from '../../Bar';
import { SettingsFormSkeleton, SWITCH_CONTROL } from '../Section';
import { useSkeletonText } from '../useSkeletonText';
import type { SettingsTabSkeleton } from './types';

/** The idle auto-save hint ("loaded the latest version") on the right of a group head. */
const SAVE_HINT = <SkeletonBar height={20} width={102} />;

/** A `Select` at 50% of the 335px control column, right-aligned as the loaded one. */
const HALF_SELECT = (
  <Flexbox horizontal justify={'flex-end'} width={'100%'}>
    <SkeletonBar height={32} width={'50%'} />
  </Flexbox>
);

/** General: theme picker, language, motion, context menu and reply language. */
export const CommonSectionSkeleton = () => {
  const text = useSkeletonText('setting');

  return (
    <SettingsFormSkeleton
      groups={[
        {
          extra: SAVE_HINT,
          items: [
            {
              control: { height: 86, radius: 8, width: 332 },
              label: text('settingCommon.themeMode.title', 32, 14),
              minWidth: undefined,
            },
            { control: HALF_SELECT, label: text('settingCommon.lang.title', 32, 14) },
            {
              control: { height: 38, radius: 8, width: 230 },
              label: text('settingAppearance.animationMode.title', 64, 14),
              minWidth: undefined,
            },
            {
              control: { height: 38, radius: 8, width: 165 },
              label: text('settingAppearance.contextMenuMode.title', 84, 14),
              minWidth: undefined,
            },
            {
              control: HALF_SELECT,
              label: text('settingCommon.responseLanguage.title', 64, 14),
            },
          ],
          title: text('settingCommon.title', 72),
        },
      ]}
    />
  );
};

/** Theme: the 332x200 preview, then the primary and neutral swatch rows. */
export const AppearanceSectionSkeleton = () => {
  const text = useSkeletonText('setting');

  return (
    <SettingsFormSkeleton
      groups={[
        {
          extra: SAVE_HINT,
          items: [
            {
              control: { height: 200, radius: 8, width: 332 },
              label: text('settingAppearance.preview.title', 48, 14),
              minWidth: undefined,
            },
            {
              control: { height: 24, radius: 12, width: 425 },
              label: text('settingAppearance.primaryColor.title', 48, 14),
              minWidth: undefined,
            },
            {
              control: { height: 24, radius: 12, width: 174 },
              label: text('settingAppearance.neutralColor.title', 48, 14),
              minWidth: undefined,
            },
          ],
          title: text('settingAppearance.title', 72),
        },
      ]}
    />
  );
};

/** Electron only: the tray-icon switch. */
const DesktopSectionSkeleton = () => {
  const text = useSkeletonText('setting');
  if (!isDesktop) return null;

  return (
    <SettingsFormSkeleton
      groups={[
        {
          items: [
            {
              control: SWITCH_CONTROL,
              label: text('settingAppearance.appTray.title', 96, 14),
              minWidth: undefined,
            },
          ],
          title: text('settingAppearance.desktop.title', 48),
        },
      ]}
    />
  );
};

/**
 * Fonts: the four font-stack rows (Electron only), antialiasing, and the
 * vertical font-size slider with its preview line.
 */
export const FontSectionSkeleton = () => {
  const text = useSkeletonText('setting');
  const fontRow = (key: string) => ({
    control: { height: 32, width: 320 },
    desc: text(`settingAppearance.font.${key}.desc`, 240, 12),
    label: text(`settingAppearance.font.${key}.title`, 96, 14),
    minWidth: undefined,
  });

  return (
    <SettingsFormSkeleton
      groups={[
        {
          extra: SAVE_HINT,
          items: [
            ...(isDesktop
              ? ['fontFamily', 'fallback', 'monospace', 'monospaceFallback'].map(fontRow)
              : []),
            {
              control: SWITCH_CONTROL,
              desc: text('settingAppearance.font.antialiasing.desc', 360, 12),
              label: text('settingAppearance.font.antialiasing.title', 72, 14),
              minWidth: undefined,
            },
            {
              control: (
                <Flexbox gap={16} width={'100%'}>
                  <Flexbox gap={24}>
                    <SkeletonBar height={4} />
                    <Flexbox horizontal align={'center'} justify={'space-between'}>
                      <SkeletonBar height={14} width={12} />
                      <SkeletonBar height={14} width={40} />
                      <SkeletonBar height={14} width={12} />
                    </Flexbox>
                  </Flexbox>
                  <Flexbox justify={'center'} style={{ height: 30 }}>
                    <SkeletonBar height={16} width={340} />
                  </Flexbox>
                </Flexbox>
              ),
              desc: text('settingChatAppearance.fontSize.desc', 72, 12),
              label: text('settingChatAppearance.fontSize.title', 56, 14),
              layout: 'vertical',
              minWidth: '100%',
            },
          ],
          title: text('settingAppearance.font.title', 32),
        },
      ]}
    />
  );
};

/**
 * Chat appearance: four separate blocks (36px apart in the settings container):
 * transition preview, chat-behaviour switches, code and Mermaid theme previews.
 */
export const ChatAppearanceSectionSkeleton = () => {
  const text = useSkeletonText('setting');

  return (
    <>
      <Form.Group
        collapsible={false}
        extra={<SkeletonBar height={38} radius={8} width={151} />}
        title={text('settingChatAppearance.transitionMode.title', 64)}
        variant={'filled'}
      >
        <SkeletonBar height={182} radius={8} />
      </Form.Group>
      <SettingsFormSkeleton
        groups={[
          {
            items: [
              {
                control: SWITCH_CONTROL,
                label: text('settingChatAppearance.autoScrollOnStreaming.title', 120, 14),
                minWidth: undefined,
              },
              {
                control: SWITCH_CONTROL,
                label: text('settingChatAppearance.workflowStreamingExpand.title', 120, 14),
                minWidth: undefined,
              },
              {
                control: SWITCH_CONTROL,
                // The loaded description is a two-line link preview.
                desc: (
                  <Flexbox gap={6} paddingBlock={4}>
                    <SkeletonBar height={14} width={160} />
                    <SkeletonBar height={14} width={200} />
                  </Flexbox>
                ),
                label: text('settingChatAppearance.linkIcon.title', 120, 14),
                minWidth: undefined,
              },
              {
                control: SWITCH_CONTROL,
                desc: text('settingChatAppearance.pasteAutoConvert.desc', 360, 12),
                label: text('settingChatAppearance.pasteAutoConvert.title', 120, 14),
                minWidth: undefined,
              },
            ],
            title: text('settingChatAppearance.chatBehavior.title', 64),
          },
        ]}
      />
      <Form.Group
        collapsible={false}
        extra={<SkeletonBar height={32} width={240} />}
        title={text('settingChatAppearance.highlighterTheme.title', 96)}
        variant={'filled'}
      >
        <SkeletonBar height={167} radius={8} />
      </Form.Group>
      <Form.Group
        extra={<SkeletonBar height={32} width={240} />}
        title={text('settingChatAppearance.mermaidTheme.title', 96)}
        variant={'filled'}
      >
        <SkeletonBar height={295} radius={8} />
      </Form.Group>
    </>
  );
};

/** The five appearance sections, as direct children of the 36px-gap settings container. */
const Body = () => (
  <>
    <CommonSectionSkeleton />
    <AppearanceSectionSkeleton />
    <DesktopSectionSkeleton />
    <FontSectionSkeleton />
    <ChatAppearanceSectionSkeleton />
  </>
);

const AppearanceSkeleton: SettingsTabSkeleton = { Body };

export default AppearanceSkeleton;
