export interface JinaSearchParameters {
  q: string;
}

interface JinaUsage {
  tokens: number;
}

interface JinaMeta {
  usage: JinaUsage;
}

interface JinaData {
  content?: string;
  description?: string;
  title: string;
  url: string;
  usage?: JinaUsage;
}

export interface JinaResponse {
  code?: number;
  data: JinaData[];
  meta?: JinaMeta;
  status?: number;
}
