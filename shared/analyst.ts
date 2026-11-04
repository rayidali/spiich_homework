/** Public analyst workspace contract. Provider credentials and remote runtime IDs stay server-side. */
export type AnalystProvider = 'querio' | 'daybook';
export type AnalystChart = {
  kind: 'bar' | 'line' | 'area' | 'pie' | 'scatter';
  title: string;
  xLabel: string;
  xScale?: 'category' | 'number' | 'date';
  yLabel: string;
  labels: string[];
  series: { name: string; values: (string | null)[] }[];
  format?: 'number' | 'currency' | 'percent';
  currency?: string;
};
export type AnalystOutput =
  | { type: 'markdown'; text: string }
  | {
      type: 'table';
      columns: string[];
      rows: (string | null)[][];
      totalRows: number;
      totalRowsKnown?: boolean;
      truncated: boolean;
    }
  | { type: 'chart'; chart: AnalystChart }
  | { type: 'notice'; text: string };
export type AnalystCell = { id: string; title: string; code: string; outputs: AnalystOutput[] };
export type AnalystMessage = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: string;
};
export type AnalystConversation = {
  id: string;
  provider: AnalystProvider;
  title: string;
  sourceLabel: string;
  status: 'idle' | 'starting' | 'running' | 'completed' | 'failed' | 'closed';
  phase: string | null;
  messages: AnalystMessage[];
  notebook: { cells: AnalystCell[]; updatedAt: string | null; externalUrl?: string };
  error: { code: string; message: string; requestId?: string; retryable: boolean } | null;
  createdAt: string;
  updatedAt: string;
};
export type AnalystAvailability = {
  available: boolean;
  provider: AnalystProvider;
  sourceLabel: string;
  modelLabel: string | null;
};
