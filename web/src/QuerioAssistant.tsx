import { AnalystChat } from './AnalystChat';

export function QuerioAssistant({ active }: { active: boolean }) {
  return <AnalystChat provider="querio" active={active} />;
}
