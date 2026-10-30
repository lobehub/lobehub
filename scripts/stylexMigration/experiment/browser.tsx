import '@lobehub/ui/theme.css';
import '@lobehub/ui/global.css';
import '@lobehub/ui/style.css';
import '@/styles/stylex.css';

import { ConfigProvider } from '@lobehub/ui';
import CollapsibleContent from 'experiment-component:CollapsibleContent';
import CommandLine from 'experiment-component:CommandLine';
import DotsLoading from 'experiment-component:DotsLoading';
import { FilePathDisplay } from 'experiment-component:FilePathDisplay';
import GalleyGrid from 'experiment-component:GalleyGrid';
import GeneratingBorder from 'experiment-component:GeneratingBorder';
import InlineTable from 'experiment-component:InlineTable';
import LiteTable from 'experiment-component:LiteTable';
import OptionCard from 'experiment-component:OptionCard';
import OptionRow from 'experiment-component:OptionRow';
import StatusBar from 'experiment-component:StatusBar';
import TailMarquee from 'experiment-component:TailMarquee';
import UnreadDot from 'experiment-component:UnreadDot';
import VersionTag from 'experiment-component:VersionTag';
import * as motion from 'motion/react-m';
import type { ReactNode } from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';

const noop = () => {};
const tableRows = [
  { id: 'one', name: 'A deterministic first row', status: 'Ready' },
  { id: 'two', name: 'A second row with a longer title', status: 'Pending' },
];
const columns = [
  {
    key: 'name',
    listSlot: 'title',
    render: (row: (typeof tableRows)[number]) => row.name,
    title: 'Name',
  },
  { key: 'status', render: (row: (typeof tableRows)[number]) => row.status, title: 'Status' },
  {
    key: 'actions',
    listSlot: 'actions',
    render: () => <button type="button">Open</button>,
    title: 'Actions',
  },
];

const fixture = (id: string): ReactNode => {
  switch (id) {
    case 'commandLine': {
      return (
        <CommandLine command="bun run stylex:migration --codemod --path src/components/CommandLine" />
      );
    }
    case 'versionTag': {
      return <VersionTag range={['2.0.0', '2.5.1']} />;
    }
    case 'dotsLoading': {
      return <DotsLoading gap={3} size={5} />;
    }
    case 'unreadDot': {
      return <UnreadDot label="Unread" />;
    }
    case 'generatingBorder':
    case 'restingBorder': {
      return (
        <GeneratingBorder generating={id === 'generatingBorder'}>
          <div style={{ height: 80, padding: 12 }}>Writing a deterministic answer</div>
        </GeneratingBorder>
      );
    }
    case 'tailMarquee': {
      return (
        <button style={{ display: 'flex', width: 180 }} type="button">
          <TailMarquee>
            /Users/example/project/a-very-long-directory/components/ExampleComponent.tsx
          </TailMarquee>
        </button>
      );
    }
    case 'liteTable':
    case 'wideLiteTable': {
      return (
        <LiteTable
          columns={columns}
          dataSource={tableRows}
          listBreakpoint={id === 'wideLiteTable' ? 800 : 600}
          rowKey={(row: (typeof tableRows)[number]) => row.id}
          onRowClick={noop}
        />
      );
    }
    case 'inlineTable': {
      return (
        <InlineTable
          hoverToActive
          dataSource={tableRows}
          rowKey="id"
          columns={[
            { dataIndex: 'name', key: 'name', title: 'Name' },
            { dataIndex: 'status', key: 'status', title: 'Status' },
          ]}
        />
      );
    }
    case 'galleyGrid': {
      return (
        <GalleyGrid col={3} gap={6} max={420}>
          {Array.from({ length: 6 }, (_, index) => (
            <div key={index} style={{ background: '#8cb4ff', height: 80 }}>
              Item {index + 1}
            </div>
          ))}
        </GalleyGrid>
      );
    }
    case 'optionRow': {
      return (
        <div>
          {[{}, { active: true }, { active: true, disabled: true }].map((variant, index) => (
            <OptionRow
              {...variant}
              desc="A deterministic description"
              extra={<button type="button">Details</button>}
              icon={<span>◎</span>}
              key={index}
              label={`Option ${index + 1}`}
              tag="Local"
              onClick={noop}
            />
          ))}
        </div>
      );
    }
    case 'optionCard': {
      return (
        <div>
          {[false, true].map((selected, index) => (
            <OptionCard
              description="Deterministic description"
              highlighted={index === 1}
              index={index + 1}
              key={index}
              label={`Choice ${index + 1}`}
              recommendedText="Suggested"
              selected={selected}
              onToggle={noop}
            />
          ))}
        </div>
      );
    }
    case 'filePathDisplay': {
      return (
        <div style={{ alignItems: 'center', display: 'flex' }}>
          <FilePathDisplay filePath="/project/images/example.png" />
        </div>
      );
    }
    case 'statusBar': {
      return (
        <StatusBar
          readOnly
          cursor={{ column: 4, line: 12, selectionLength: 8 }}
          indent={{ size: 2, useTabs: false }}
          languageLabel="TypeScript"
          lineWrapping={false}
          onLineWrappingChange={noop}
        />
      );
    }
    case 'collapsibleContent': {
      return (
        <CollapsibleContent maxHeight={100}>
          {Array.from({ length: 20 }, (_, index) => (
            <p key={index}>Line {index + 1}: deterministic component content.</p>
          ))}
        </CollapsibleContent>
      );
    }
    default: {
      throw new Error(`Unknown experiment fixture: ${id}`);
    }
  }
};

const root = createRoot(document.getElementById('app')!);
const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

const mount = async (id: string, theme = 'light', width = 920, direction = 'ltr') => {
  document.documentElement.dataset.theme = theme;
  document.documentElement.dir = direction;
  // A fixture must finish its synchronous mount before the external sampler can inspect it.
  // eslint-disable-next-line @eslint-react/dom/no-flush-sync
  flushSync(() =>
    root.render(
      <ConfigProvider
        direction={direction as 'ltr' | 'rtl'}
        enableCustomFonts={false}
        motion={motion}
      >
        <div
          data-case-root
          key={id}
          style={{ fontFamily: 'Arial, sans-serif', fontSize: 14, width }}
        >
          {fixture(id)}
        </div>
      </ConfigProvider>,
    ),
  );
  await document.fonts.ready;
  await frame();
  await frame();
  await frame();
  return document.querySelector('[data-case-root]')!.children.length;
};

export const startExperiment = () => {
  Object.assign(window, { __stylexExperiment: { mount } });
  document.documentElement.dataset.experimentReady = 'true';
};
