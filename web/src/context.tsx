import { createContext, useContext } from 'react';
import type { Account, Entry, RecurringTemplate } from '../../shared/schema';
export type Meta = {
  organization: { id: string; name: string; base_currency: string; timezone: string };
  today: string;
  ai: { available: boolean; model: string | null };
  category?: { available: boolean; provider: 'gemini' | 'jev' | 'reference'; model: string };
  demo: boolean;
  alertCount: number;
};
export type ComposerState = {
  mode: 'simple' | 'manual' | 'ai' | 'recurring';
  entry?: Entry;
  text?: string;
  template?: RecurringTemplate;
};
export type Workspace = {
  meta: Meta | null;
  accounts: Account[];
  revision: number;
  refresh: () => void;
  notify: (text: string) => void;
  openEntry: (id: string) => void;
  openComposer: (state: ComposerState) => void;
  openChat: (text?: string) => void;
  openAlerts: () => void;
};
export const WorkspaceContext = createContext<Workspace | null>(null);
export function useWorkspace() {
  const context = useContext(WorkspaceContext);
  if (!context) throw new Error('Workspace context is missing');
  return context;
}
