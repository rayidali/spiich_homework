-- Shared request admission for AI routes. These are operational counters and
-- crash-recovery leases, never accounting records or provider billing totals.
CREATE TABLE ai_admission_state (
  organization_id uuid PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
  minute_start_epoch bigint NOT NULL CHECK (minute_start_epoch >= 0 AND minute_start_epoch % 60 = 0),
  minute_count integer NOT NULL CHECK (minute_count >= 0),
  day_start_epoch bigint NOT NULL CHECK (day_start_epoch >= 0 AND day_start_epoch % 86400 = 0),
  day_count integer NOT NULL CHECK (day_count >= 0),
  updated_at timestamptz NOT NULL
);

CREATE TABLE ai_admission_leases (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  acquired_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  CHECK (expires_at > acquired_at AND expires_at <= acquired_at + interval '5 minutes')
);
CREATE INDEX ai_admission_leases_workspace_expiry ON ai_admission_leases(organization_id,expires_at,id);

GRANT SELECT,INSERT,UPDATE ON ai_admission_state TO spiich_app;
GRANT SELECT,INSERT,DELETE ON ai_admission_leases TO spiich_app;
