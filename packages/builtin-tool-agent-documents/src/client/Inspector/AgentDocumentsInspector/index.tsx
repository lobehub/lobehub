'use client';

import type { BuiltinInspectorProps } from '@lobechat/types';
import { cx } from 'antd-style';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { highlightTextStyles, inspectorTextStyles, shinyTextStyles } from '@/styles';

import {
  AgentDocumentsApiName,
  type CopyDocumentArgs,
  type CreateDocumentArgs,
  type EditDocumentArgs,
  type ReadDocumentArgs,
  type RemoveDocumentArgs,
  type RenameDocumentArgs,
  type UpdateLoadRuleArgs,
} from '../../../types';

type AgentDocumentsArgs =
  | CopyDocumentArgs
  | CreateDocumentArgs
  | EditDocumentArgs
  | ReadDocumentArgs
  | RemoveDocumentArgs
  | RenameDocumentArgs
  | UpdateLoadRuleArgs;

const getInspectorSummary = (
  apiName: string,
  args?: Partial<AgentDocumentsArgs>,
): string | undefined => {
  switch (apiName) {
    case AgentDocumentsApiName.createDocument: {
      return args && 'title' in args ? args.title : undefined;
    }
    case AgentDocumentsApiName.renameDocument: {
      return args && 'newTitle' in args ? args.newTitle : undefined;
    }
    case AgentDocumentsApiName.copyDocument: {
      if (args && 'newTitle' in args && args.newTitle) return args.newTitle;
      return args && 'id' in args ? args.id : undefined;
    }
    case AgentDocumentsApiName.readDocument:
    case AgentDocumentsApiName.editDocument:
    case AgentDocumentsApiName.removeDocument:
    case AgentDocumentsApiName.updateLoadRule: {
      return args && 'id' in args ? args.id : undefined;
    }
    default: {
      return undefined;
    }
  }
};

const getInspectorLabel = (apiName: string, t: (...args: any[]) => string) => {
  switch (apiName) {
    case AgentDocumentsApiName.createDocument: {
      return t('builtins.lobe-agent-documents.apiName.createDocument');
    }
    case AgentDocumentsApiName.readDocument: {
      return t('builtins.lobe-agent-documents.apiName.readDocument');
    }
    case AgentDocumentsApiName.editDocument: {
      return t('builtins.lobe-agent-documents.apiName.editDocument');
    }
    case AgentDocumentsApiName.removeDocument: {
      return t('builtins.lobe-agent-documents.apiName.removeDocument');
    }
    case AgentDocumentsApiName.renameDocument: {
      return t('builtins.lobe-agent-documents.apiName.renameDocument');
    }
    case AgentDocumentsApiName.copyDocument: {
      return t('builtins.lobe-agent-documents.apiName.copyDocument');
    }
    case AgentDocumentsApiName.updateLoadRule: {
      return t('builtins.lobe-agent-documents.apiName.updateLoadRule');
    }
    default: {
      return apiName;
    }
  }
};

export const AgentDocumentsInspector = memo<BuiltinInspectorProps<AgentDocumentsArgs>>(
  ({ apiName, args, partialArgs, isArgumentsStreaming, isLoading }) => {
    const { t } = useTranslation('plugin');

    const summary = getInspectorSummary(apiName, args || partialArgs);
    const label = getInspectorLabel(apiName, t);

    if (isArgumentsStreaming && !summary) {
      return <div className={cx(inspectorTextStyles.root, shinyTextStyles.shinyText)}>{label}</div>;
    }

    return (
      <div
        className={cx(
          inspectorTextStyles.root,
          (isArgumentsStreaming || isLoading) && shinyTextStyles.shinyText,
        )}
      >
        <span>{label}</span>
        {summary && (
          <>
            <span>: </span>
            <span className={highlightTextStyles.primary}>{summary}</span>
          </>
        )}
      </div>
    );
  },
);

AgentDocumentsInspector.displayName = 'AgentDocumentsInspector';

export default AgentDocumentsInspector;
