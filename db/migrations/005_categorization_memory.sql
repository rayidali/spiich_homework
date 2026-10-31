-- Legacy categorization_feedback is preserved as unverified history. New memory
-- is derived only from a server-issued proposal and its reviewed, posted entry.
CREATE TABLE ai_entry_proposals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  proposal jsonb NOT NULL CHECK (jsonb_typeof(proposal)='object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT now()+interval '7 days',
  bound_entry_id uuid,
  bound_revision integer CHECK (bound_revision>0),
  bound_snapshot_hash text CHECK (bound_snapshot_hash ~ '^[a-f0-9]{64}$'),
  bound_at timestamptz,
  UNIQUE (organization_id,id),
  UNIQUE (organization_id,bound_entry_id),
  UNIQUE (organization_id,id,bound_entry_id),
  FOREIGN KEY (organization_id,bound_entry_id) REFERENCES journal_entries(organization_id,id),
  CHECK ((bound_entry_id IS NULL AND bound_revision IS NULL AND bound_snapshot_hash IS NULL AND bound_at IS NULL)
    OR (bound_entry_id IS NOT NULL AND bound_revision IS NOT NULL AND bound_snapshot_hash IS NOT NULL AND bound_at IS NOT NULL))
);
CREATE INDEX ai_proposal_expiry ON ai_entry_proposals(organization_id,expires_at);

CREATE TABLE categorization_memories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  proposal_id uuid NOT NULL,
  entry_id uuid NOT NULL,
  entry_revision integer NOT NULL CHECK (entry_revision>0),
  description text NOT NULL CHECK (length(description) BETWEEN 1 AND 500),
  counterparty text NOT NULL DEFAULT '',
  context_key text NOT NULL CHECK (context_key ~ '^[a-f0-9]{64}$'),
  corrected_lines jsonb NOT NULL CHECK (jsonb_typeof(corrected_lines)='array' AND jsonb_array_length(corrected_lines)>=2),
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','SUPERSEDED','REVOKED')),
  reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  retired_at timestamptz,
  UNIQUE (organization_id,proposal_id),
  UNIQUE (organization_id,entry_id),
  FOREIGN KEY (organization_id,proposal_id,entry_id)
    REFERENCES ai_entry_proposals(organization_id,id,bound_entry_id),
  FOREIGN KEY (organization_id,entry_id) REFERENCES journal_entries(organization_id,id),
  CHECK ((status='ACTIVE' AND retired_at IS NULL AND reason IS NULL)
    OR (status<>'ACTIVE' AND retired_at IS NOT NULL AND reason IS NOT NULL))
);
CREATE UNIQUE INDEX one_active_categorization_context ON categorization_memories(organization_id,context_key)
  WHERE status='ACTIVE';
CREATE INDEX categorization_memory_context ON categorization_memories(organization_id,created_at DESC)
  WHERE status='ACTIVE';

GRANT SELECT,INSERT,UPDATE ON ai_entry_proposals,categorization_memories TO spiich_app;
GRANT DELETE ON ai_entry_proposals TO spiich_app;
