import { workspaceHtmlArtifactIdentifierForFile } from '@lobechat/html-artifact';
import { Flexbox } from '@lobehub/ui';
import {
  Accordion,
  Button,
  Checkbox,
  createModal,
  ScrollArea,
  Text,
  useModalContext,
} from '@lobehub/ui/base-ui';
import { cssVar } from 'antd-style';
import { t } from 'i18next';
import { useTranslation } from 'react-i18next';

import {
  type BlockedWorkspaceHtmlPublishInput,
  useBlockedWorkspaceHtmlPublish,
} from './useBlockedWorkspaceHtmlPublish';

const BODY_MAX_HEIGHT = 'min(52vh, 360px)';

export type OpenWorkspaceHtmlPublishBlockedConfirmInput = Omit<
  BlockedWorkspaceHtmlPublishInput,
  'close'
>;

const BlockedConfirmContent = (input: OpenWorkspaceHtmlPublishBlockedConfirmInput) => {
  const { t } = useTranslation(['chat', 'common']);
  const { close } = useModalContext();
  const { busy, cancel, failed, force, handleContinue, handleForceChange, resources } =
    useBlockedWorkspaceHtmlPublish({
      ...input,
      close,
    });
  const { filePath, plan, workingDirectory } = input;
  const identifier = workspaceHtmlArtifactIdentifierForFile(filePath, workingDirectory);
  const relativeTargetDirectory = `.lobe-artifacts/${identifier}`;
  const failedPaths = new Set(failed.map((item) => item.absolutePath));
  return (
    <>
      <ScrollArea
        disableContentFit
        scrollFade
        style={{ maxHeight: BODY_MAX_HEIGHT, overflow: 'hidden' }}
        viewportProps={{ style: { height: 'auto', maxHeight: BODY_MAX_HEIGHT } }}
      >
        <Flexbox gap={12} style={{ paddingBlock: 12, paddingInline: 16 }}>
          <Text>
            {t('workingPanel.localFile.publish.outsideWorkspace.description', {
              count: plan.escaped.length,
              ns: 'chat',
            })}
          </Text>
          <Text type={'secondary'}>
            {t('workingPanel.localFile.publish.outsideWorkspace.workspace', {
              ns: 'chat',
              path: workingDirectory,
            })}
          </Text>
          {resources.some((item) => item.source) && (
            <Text type={'secondary'}>
              {t('workingPanel.localFile.publish.outsideWorkspace.closureDescription', {
                ns: 'chat',
              })}
            </Text>
          )}
          <Accordion
            indicatorPlacement={'start'}
            variant={'borderless'}
            items={[
              {
                children: (
                  <Flexbox gap={8} paddingBlock={'4px 0'}>
                    {resources.map((item) => (
                      <Flexbox gap={2} key={item.absolutePath}>
                        <Text>{item.hrefs.join(', ')}</Text>
                        {item.source && (
                          <Text fontSize={12} type={'secondary'}>
                            {t(
                              `workingPanel.localFile.publish.outsideWorkspace.source.${item.source}`,
                              { ns: 'chat' },
                            )}
                          </Text>
                        )}
                        <Text
                          type={'secondary'}
                          style={{
                            color: failedPaths.has(item.absolutePath)
                              ? cssVar.colorError
                              : undefined,
                            fontFamily: cssVar.fontFamilyCode,
                            wordBreak: 'break-all',
                          }}
                        >
                          {item.absolutePath}
                        </Text>
                      </Flexbox>
                    ))}
                  </Flexbox>
                ),
                key: 'paths',
                title: (
                  <Text fontSize={12} type={'secondary'} weight={500}>
                    {t('workingPanel.localFile.publish.details', { ns: 'chat' })}
                  </Text>
                ),
              },
            ]}
          />
          <Text type={'secondary'}>
            {t('workingPanel.localFile.publish.outsideWorkspace.copyHint', {
              count: resources.length,
              dir: relativeTargetDirectory,
              ns: 'chat',
            })}
          </Text>
          {failed.length > 0 && (
            <Text style={{ color: cssVar.colorError }}>
              {t('workingPanel.localFile.publish.outsideWorkspace.copyFailed', {
                list: failed.map((item) => item.absolutePath).join(', '),
                ns: 'chat',
              })}
            </Text>
          )}
        </Flexbox>
      </ScrollArea>
      <Flexbox style={{ paddingBlock: '8px 4px', paddingInline: 16 }}>
        <Checkbox checked={force} onChange={handleForceChange}>
          <Text fontSize={12}>
            {t('workingPanel.localFile.publish.outsideWorkspace.forceLabel', { ns: 'chat' })}
          </Text>
        </Checkbox>
      </Flexbox>
      <Flexbox
        horizontal
        gap={8}
        justify={'flex-end'}
        style={{ paddingBlock: 12, paddingInline: 16 }}
      >
        <Button onClick={cancel}>{t('cancel', { ns: 'common' })}</Button>
        <Button loading={busy} type={'primary'} onClick={() => void handleContinue()}>
          {busy && !force
            ? t('workingPanel.localFile.publish.outsideWorkspace.copying', { ns: 'chat' })
            : t(
                force
                  ? 'workingPanel.localFile.publish.outsideWorkspace.forceAction'
                  : 'workingPanel.localFile.publish.outsideWorkspace.copyAction',
                { ns: 'chat' },
              )}
        </Button>
      </Flexbox>
    </>
  );
};

export const openWorkspaceHtmlPublishBlockedConfirm = (
  input: OpenWorkspaceHtmlPublishBlockedConfirmInput,
) =>
  createModal({
    content: <BlockedConfirmContent {...input} />,
    footer: null,
    styles: { content: { minHeight: 0, overflow: 'hidden', padding: 0 } },
    title: t('workingPanel.localFile.publish.outsideWorkspace.title', { ns: 'chat' }),
    width: 420,
  });
