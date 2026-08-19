import { Typography } from '@lobehub/ui';
import { Image } from '@lobehub/ui/mdx';
import { Divider } from 'antd';
import { Fragment, Suspense } from 'react';
import { useTranslation } from 'react-i18next';
import { type Components } from 'react-markdown';
import useSWR from 'swr';
import urlJoin from 'url-join';

import { CustomMDX } from '@/components/mdx';
import CollapsibleSection from '@/components/mdx/CollapsibleSection';
import remarkCollapsibleSections from '@/components/mdx/remarkCollapsibleSections';
import { CHANGELOG_PATH } from '@/const/url';
import WorkspaceLink from '@/features/Workspace/WorkspaceLink';
import { changelogKeys } from '@/libs/swr/keys';
import { lambdaClient } from '@/libs/trpc/client';
import { type Locales } from '@/locales/resources';
import { type ChangelogIndexItem } from '@/types/changelog';

import VersionTag from './VersionTag';

interface ChangelogContentProps {
  data: ChangelogIndexItem[];
  linkTitles?: boolean;
}

interface PostItemProps extends ChangelogIndexItem {
  linkTitle?: boolean;
  locale: Locales;
  showDivider?: boolean;
}

const PostItem = ({ id, versionRange, locale, showDivider = true, linkTitle }: PostItemProps) => {
  const { data } = useSWR(changelogKeys.post(id, locale), async () => {
    return await lambdaClient.changelog.getPostById.query({ id, locale });
  });

  if (!data || !data.title) return null;

  const heading = <h2 id={id}>{data.rawTitle || data.title}</h2>;

  return (
    <>
      {showDivider && <Divider />}
      <Typography headerMultiple={0.2}>
        {linkTitle ? (
          <WorkspaceLink escape style={{ color: 'inherit' }} to={urlJoin(CHANGELOG_PATH, id)}>
            {heading}
          </WorkspaceLink>
        ) : (
          heading
        )}
        {data.image && (
          <Image
            alt={data.title}
            src={
              data.image.startsWith('/blog')
                ? urlJoin('https://hub-apac-1.lobeobjects.space/', data.image)
                : data.image
            }
          />
        )}
        <Suspense fallback={<div>Loading...</div>}>
          <CustomMDX
            components={{ 'collapsible-section': CollapsibleSection } as Components}
            remarkPlugins={[remarkCollapsibleSections]}
            source={data.content}
          />
        </Suspense>
        <VersionTag range={versionRange} />
      </Typography>
    </>
  );
};

const ChangelogContent = ({ data, linkTitles = false }: ChangelogContentProps) => {
  const { i18n } = useTranslation();
  const locale = i18n.language as Locales;

  return (
    <>
      {data.map((item, index) => (
        <Fragment key={item.id}>
          <PostItem linkTitle={linkTitles} locale={locale} showDivider={index !== 0} {...item} />
        </Fragment>
      ))}
    </>
  );
};

export default ChangelogContent;
