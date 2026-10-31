-- Reversals retain alert evidence while marking signals that no longer apply.
ALTER TABLE alerts DROP CONSTRAINT alerts_status_check;
ALTER TABLE alerts ADD CONSTRAINT alerts_status_check CHECK (status IN ('OPEN','DISMISSED','RESOLVED'));
ALTER TABLE alerts ADD COLUMN resolved_at timestamptz;
ALTER TABLE alerts ADD COLUMN resolution_reason text CHECK (resolution_reason IN ('ENTRY_REVERSED','NO_LONGER_MATCHES'));
ALTER TABLE alerts ADD COLUMN resolution_entry_id uuid;
ALTER TABLE alerts ADD FOREIGN KEY (organization_id,resolution_entry_id) REFERENCES journal_entries(organization_id,id);
ALTER TABLE alerts ADD CHECK ((resolved_at IS NULL) = (resolution_reason IS NULL));
ALTER TABLE alerts ADD CHECK (status <> 'RESOLVED' OR resolved_at IS NOT NULL);

-- A reversal's existing outbox job discovers dependent entries in bounded pages.
-- Cursor advancement and requeueing those entries commit in one transaction.
ALTER TABLE jobs ADD COLUMN anomaly_refresh_cursor uuid;
ALTER TABLE jobs ADD COLUMN anomaly_refresh_complete boolean NOT NULL DEFAULT false;
ALTER TABLE jobs ADD COLUMN refresh_entry_id uuid;
ALTER TABLE jobs ADD FOREIGN KEY (organization_id,refresh_entry_id) REFERENCES journal_entries(organization_id,id);

-- Requeue historical reversal jobs through the bounded worker.
-- This changes only analysis work, never journal records or existing alert evidence.
INSERT INTO jobs(organization_id,entry_id)
SELECT organization_id,id FROM journal_entries WHERE status='POSTED' AND source='REVERSAL'
ORDER BY id
ON CONFLICT(entry_id,kind) DO UPDATE SET status='PENDING',attempts=0,run_after=now(),
  locked_at=NULL,lease_token=NULL,last_error=NULL,anomaly_refresh_cursor=NULL,
  anomaly_refresh_complete=false,refresh_entry_id=NULL;
