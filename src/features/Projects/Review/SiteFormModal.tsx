import {
  ActionIcon,
  Button,
  createModal,
  Flexbox,
  Input,
  Text,
  useModalContext,
} from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { t } from 'i18next';
import { PlusIcon, XIcon } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { projectReviewService, type ProjectSiteItem } from '@/services/projectReview';

import { checkOrigins, originErrorFromServer } from './siteSnippet';

const MAX_ORIGINS = 20;

const styles = stylex.create({
  error: {
    color: cssVar.colorError,
    fontSize: 12,
    lineHeight: 1.5,
  },
  origin: {
    fontFamily: cssVar.fontFamilyCode,
    fontSize: 13,
  },
});

interface SiteModalProps {
  onSaved: () => void;
  projectId: string;
  site?: ProjectSiteItem;
}

function SiteForm({ onSaved, projectId, site }: SiteModalProps) {
  const { t } = useTranslation('project');
  const { close } = useModalContext();
  const [name, setName] = useState(site?.name ?? '');
  const [origins, setOrigins] = useState<string[]>(site?.origins ?? ['']);
  const [serverError, setServerError] = useState<{ index?: number; message: string }>();
  const [pending, setPending] = useState(false);
  const errors = checkOrigins(origins);
  const filled = origins.map((origin) => origin.trim()).filter(Boolean);
  const valid = Boolean(name.trim()) && filled.length > 0 && errors.every((error) => !error);

  const setOrigin = (index: number, value: string) => {
    setOrigins((list) => list.map((item, i) => (i === index ? value : item)));
    setServerError(undefined);
  };

  const save = async () => {
    setPending(true);
    setServerError(undefined);
    try {
      const input = { name: name.trim(), origins: filled };
      if (site) await projectReviewService.updateSite(site.id, input);
      else await projectReviewService.createSite(projectId, input);
      onSaved();
      close();
    } catch (error) {
      console.error('Failed to save site', error);
      const origin = originErrorFromServer(error);
      setServerError(
        origin
          ? {
              index: origins.indexOf(filled[origin.index]),
              message: t(`review.origin.${origin.reason}`),
            }
          : { message: t('review.sites.saveError') },
      );
    } finally {
      setPending(false);
    }
  };

  return (
    <Flexbox gap={20}>
      <Flexbox gap={8}>
        <Text weight={600}>{t('review.sites.name')}</Text>
        <Input
          aria-label={t('review.sites.name')}
          disabled={pending}
          placeholder={t('review.sites.namePlaceholder')}
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
      </Flexbox>
      <Flexbox gap={8}>
        <Text weight={600}>{t('review.sites.origins')}</Text>
        {origins.map((origin, index) => {
          const reason = errors[index];
          const message = reason
            ? t(`review.origin.${reason}`)
            : serverError?.index === index
              ? serverError.message
              : undefined;
          return (
            <Flexbox gap={4} key={index}>
              <Flexbox horizontal align="center" gap={6}>
                <Input
                  aria-invalid={Boolean(message)}
                  aria-label={t('review.sites.originLabel', { index: index + 1 })}
                  {...stylex.props(styles.origin)}
                  disabled={pending}
                  placeholder="https://example.com"
                  value={origin}
                  onChange={(event) => setOrigin(index, event.target.value)}
                />
                {origins.length > 1 && (
                  <ActionIcon
                    icon={XIcon}
                    size="small"
                    title={t('review.sites.removeOrigin')}
                    onClick={() => setOrigins((list) => list.filter((_, i) => i !== index))}
                  />
                )}
              </Flexbox>
              {message && <span {...stylex.props(styles.error)}>{message}</span>}
            </Flexbox>
          );
        })}
        {origins.length < MAX_ORIGINS && (
          <Button
            icon={PlusIcon}
            size="small"
            style={{ alignSelf: 'flex-start' }}
            type="text"
            onClick={() => setOrigins((list) => [...list, ''])}
          >
            {t('review.sites.addOrigin')}
          </Button>
        )}
        <Text fontSize={12} type="secondary">
          {t('review.sites.originsHint')}
        </Text>
      </Flexbox>
      {serverError && serverError.index === undefined ? (
        <span {...stylex.props(styles.error)} role="alert">
          {serverError.message}
        </span>
      ) : null}
      <Flexbox horizontal gap={8} justify="flex-end">
        <Button disabled={pending} onClick={close}>
          {t('cancel', { ns: 'common' })}
        </Button>
        <Button disabled={!valid} loading={pending} type="primary" onClick={save}>
          {site ? t('review.sites.save') : t('review.sites.create')}
        </Button>
      </Flexbox>
    </Flexbox>
  );
}

export const openSiteModal = (props: SiteModalProps) =>
  createModal({
    content: <SiteForm {...props} />,
    footer: null,
    title: props.site
      ? t('review.sites.editTitle', { ns: 'project' })
      : t('review.sites.newTitle', { ns: 'project' }),
    width: 480,
  });
