'use client';

import type { BuiltinRenderProps } from '@lobechat/types';
import { Avatar, Button, Flexbox, Tag } from '@lobehub/ui';
import { CheckCircle, Download, Package, Search } from 'lucide-react';
import { memo, useState } from 'react';

import { useMarketAuth } from '@/layout/AuthProvider/MarketAuth';
import { useAgentStore } from '@/store/agent';
import { useToolStore } from '@/store/tool';
import { mcpStoreSelectors, pluginSelectors } from '@/store/tool/selectors';

import type { MarketToolItem, SearchMarketToolsParams, SearchMarketToolsState } from '../../types';

interface ToolItemProps {
  tool: MarketToolItem;
}

const ToolItem = memo<ToolItemProps>(({ tool }) => {
  const { isAuthenticated, signIn } = useMarketAuth();
  const [localInstalling, setLocalInstalling] = useState(false);

  const [installed, installing, installMCPPlugin, cancelInstallMCPPlugin] = useToolStore((s) => [
    pluginSelectors.isPluginInstalled(tool.identifier)(s),
    mcpStoreSelectors.isMCPInstalling(tool.identifier)(s),
    s.installMCPPlugin,
    s.cancelInstallMCPPlugin,
  ]);

  const togglePlugin = useAgentStore((s) => s.togglePlugin);

  const isCloudMcp = !!(tool.cloudEndPoint || tool.haveCloudEndpoint);
  const isInstalling = installing || localInstalling;

  const handleInstall = async () => {
    // If this is a cloud MCP and user is not authenticated, request authorization first
    if (isCloudMcp && !isAuthenticated) {
      try {
        await signIn();
      } catch {
        return;
      }
    }

    setLocalInstalling(true);
    try {
      const isSuccess = await installMCPPlugin(tool.identifier);
      if (isSuccess) {
        await togglePlugin(tool.identifier);
      }
    } finally {
      setLocalInstalling(false);
    }
  };

  const handleCancel = async () => {
    await cancelInstallMCPPlugin(tool.identifier);
  };

  return (
    <Flexbox
      horizontal
      gap={12}
      style={{
        background: 'var(--lobe-fill-tertiary)',
        borderRadius: 8,
        padding: 12,
      }}
    >
      <Avatar avatar={tool.icon || '🔧'} size={40} style={{ borderRadius: 8, flexShrink: 0 }} />
      <Flexbox flex={1} gap={4} style={{ overflow: 'hidden' }}>
        <Flexbox horizontal align="center" gap={8}>
          <span style={{ fontWeight: 600 }}>{tool.name}</span>
          {tool.author && (
            <span style={{ color: 'var(--lobe-text-tertiary)', fontSize: 12 }}>
              by {tool.author}
            </span>
          )}
        </Flexbox>
        {tool.description && (
          <div
            style={{
              color: 'var(--lobe-text-secondary)',
              fontSize: 12,
              lineHeight: 1.5,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {tool.description}
          </div>
        )}
        {tool.tags && tool.tags.length > 0 && (
          <Flexbox horizontal gap={4} style={{ flexWrap: 'wrap', marginTop: 4 }}>
            {tool.tags.slice(0, 3).map((tag) => (
              <Tag key={tag} style={{ fontSize: 10 }}>
                {tag}
              </Tag>
            ))}
          </Flexbox>
        )}
      </Flexbox>
      <Flexbox align="center" justify="center" style={{ flexShrink: 0 }}>
        {installed || tool.installed ? (
          <Flexbox horizontal align="center" gap={4} style={{ color: 'var(--lobe-success-6)' }}>
            <CheckCircle size={14} />
            <span style={{ fontSize: 12 }}>Installed</span>
          </Flexbox>
        ) : isInstalling ? (
          <Button size="small" variant="filled" onClick={handleCancel}>
            Cancel
          </Button>
        ) : (
          <Button icon={<Download size={14} />} size="small" type="primary" onClick={handleInstall}>
            Install
          </Button>
        )}
      </Flexbox>
    </Flexbox>
  );
});

const SearchMarketTools = memo<BuiltinRenderProps<SearchMarketToolsParams, SearchMarketToolsState>>(
  ({ pluginState }) => {
    const { tools, totalCount, query } = pluginState || { tools: [], totalCount: 0 };

    if (!tools || tools.length === 0) {
      return (
        <Flexbox align="center" gap={8} style={{ color: 'var(--lobe-text-tertiary)', padding: 16 }}>
          <Search size={24} />
          <span>No tools found{query ? ` for "${query}"` : ''}.</span>
        </Flexbox>
      );
    }

    const installedCount = tools.filter((t) => t.installed).length;

    return (
      <Flexbox gap={12}>
        <Flexbox horizontal align="center" gap={8}>
          <Package size={16} style={{ color: 'var(--lobe-primary-6)' }} />
          <span style={{ fontWeight: 500 }}>
            {query ? `Search results for "${query}"` : 'Available Tools'}
          </span>
          <span style={{ color: 'var(--lobe-text-tertiary)', fontSize: 12 }}>
            ({totalCount} total, {installedCount} installed)
          </span>
        </Flexbox>
        <Flexbox gap={8}>
          {tools.map((tool) => (
            <ToolItem key={tool.identifier} tool={tool} />
          ))}
        </Flexbox>
      </Flexbox>
    );
  },
);

export default SearchMarketTools;
