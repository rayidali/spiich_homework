-- Durable analyst conversations are operational data, separate from immutable journals.
CREATE TABLE analyst_conversations (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES organizations(id),
  provider text NOT NULL CHECK (provider IN ('querio','daybook')),
  state jsonb NOT NULL CHECK (jsonb_typeof(state)='object'),
  runtime jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(runtime)='object'),
  last_message_id uuid,
  last_message_text text,
  close_requested boolean NOT NULL DEFAULT false,
  lease_token uuid,
  lease_until timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((lease_token IS NULL) = (lease_until IS NULL))
);
CREATE INDEX analyst_conversations_workspace_updated
  ON analyst_conversations(organization_id,provider,updated_at DESC);
GRANT SELECT,INSERT,UPDATE,DELETE ON analyst_conversations TO spiich_app;
