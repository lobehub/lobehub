'use client';

import type { ArtifactBoardView } from '@lobechat/types';
import { artifactBoardToFrameInput } from '@lobechat/types';
import { Button, Flexbox, Input, Modal, Tag, Text, toast } from '@lobehub/ui';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { artifactBoardService } from '@/services/artifactBoard';

const UUID = /[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}/i;

interface PublishToAcceptanceProps {
  board: ArtifactBoardView;
  onClose: () => void;
  open: boolean;
}

/**
 * Send the board's picks to an acceptance as one frame's candidates. Takes the
 * acceptance id or its page URL, and shows the versions it is about to publish.
 */
const PublishToAcceptance = ({ board, onClose, open }: PublishToAcceptanceProps) => {
  const { t } = useTranslation('portal');
  const [target, setTarget] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [published, setPublished] = useState<{ acceptanceId: string; frameKey: string }>();
  const acceptanceId = target.match(UUID)?.[0];
  const frame = useMemo(
    () => artifactBoardToFrameInput(board.boardId, board.manifest, board.choices),
    [board],
  );

  const submit = async () => {
    if (!acceptanceId) return;
    setSubmitting(true);
    try {
      const result = await artifactBoardService.publishToAcceptance(board.boardId, acceptanceId);
      setPublished({ acceptanceId, frameKey: result.frameKey });
      toast.success(t('board.publish.success'));
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      centered
      destroyOnHidden
      footer={null}
      open={open}
      title={t('board.publish.title')}
      width={520}
      onCancel={() => {
        setPublished(undefined);
        onClose();
      }}
    >
      <Flexbox gap={12}>
        <Text type="secondary">{t('board.publish.description')}</Text>
        {frame && (
          <Flexbox data-testid="board-publish-preview" gap={6}>
            <Text fontSize={12} type="secondary">
              {t('board.publish.preview', { key: frame.key })}
            </Text>
            <Flexbox horizontal gap={6} wrap="wrap">
              {frame.versions.map((version, index) => (
                <Tag color={index === 0 ? 'processing' : undefined} key={version.label}>
                  {index === 0
                    ? t('board.publish.baseline', { label: version.label })
                    : version.label}
                </Tag>
              ))}
            </Flexbox>
          </Flexbox>
        )}
        <Input
          placeholder={t('board.publish.placeholder')}
          value={target}
          onChange={(event) => setTarget(event.target.value)}
          onPressEnter={() => void submit()}
        />
        {published ? (
          <Flexbox horizontal align="center" gap={8} justify="space-between">
            <Text type="success">{t('board.publish.done', { key: published.frameKey })}</Text>
            <Button
              href={`/acceptance/${published.acceptanceId}?tab=frames`}
              target="_blank"
              type="link"
            >
              {t('board.publish.open')}
            </Button>
          </Flexbox>
        ) : (
          <Button
            block
            disabled={!acceptanceId || !frame}
            loading={submitting}
            type="primary"
            onClick={() => void submit()}
          >
            {t('board.publish.submit')}
          </Button>
        )}
      </Flexbox>
    </Modal>
  );
};

export default PublishToAcceptance;
