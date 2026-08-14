export const RAW_TEXT_DOCUMENT_FILE_TYPE = 'text/plain';

interface AgentDocumentContentFormatFields {
  fileType?: string | null;
}

export const isRawTextAgentDocument = ({ fileType }: AgentDocumentContentFormatFields): boolean =>
  fileType === RAW_TEXT_DOCUMENT_FILE_TYPE;

export const getAgentDocumentContentType = (fields: AgentDocumentContentFormatFields): string =>
  isRawTextAgentDocument(fields) ? RAW_TEXT_DOCUMENT_FILE_TYPE : 'text/markdown';
