-- Financial correctness is enforced here, including for writes that bypass the API.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TABLE currencies (code text PRIMARY KEY, minor_units integer NOT NULL CHECK (minor_units BETWEEN 0 AND 4));
INSERT INTO currencies VALUES ('USD',2),('EUR',2),('GBP',2),('CAD',2),('JPY',0);

CREATE TABLE organizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL,
  base_currency text NOT NULL DEFAULT 'USD' CHECK (base_currency = 'USD'),
  timezone text NOT NULL DEFAULT 'America/New_York', created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id),
  code text NOT NULL CHECK (code ~ '^[0-9]{3,8}$'), name text NOT NULL CHECK (length(name) BETWEEN 1 AND 100),
  type text NOT NULL CHECK (type IN ('ASSET','LIABILITY','EQUITY','REVENUE','EXPENSE')),
  currency text NOT NULL REFERENCES currencies(code), parent_id uuid, is_group boolean NOT NULL DEFAULT false,
  is_cash boolean NOT NULL DEFAULT false CHECK (NOT is_cash OR (type = 'ASSET' AND NOT is_group)),
  archived boolean NOT NULL DEFAULT false, created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id,id), UNIQUE (organization_id,code),
  FOREIGN KEY (organization_id,parent_id) REFERENCES accounts(organization_id,id)
);
CREATE INDEX accounts_tree ON accounts(organization_id,parent_id);

CREATE TABLE recurring_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id),
  name text NOT NULL, description text NOT NULL, counterparty text NOT NULL DEFAULT '',
  frequency text NOT NULL CHECK (frequency IN ('WEEKLY','MONTHLY','YEARLY')),
  anchor_date date NOT NULL, next_date date NOT NULL, end_date date,
  active boolean NOT NULL DEFAULT true, lines jsonb NOT NULL CHECK (jsonb_typeof(lines)='array'),
  created_at timestamptz NOT NULL DEFAULT now(), UNIQUE (organization_id,id)
);
CREATE INDEX recurring_due ON recurring_templates(next_date,id) WHERE active;

CREATE TABLE journal_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id),
  number bigint GENERATED ALWAYS AS IDENTITY,
  date date NOT NULL, description text NOT NULL CHECK (length(description) BETWEEN 1 AND 500),
  counterparty text NOT NULL DEFAULT '', reference text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','POSTED')),
  source text NOT NULL DEFAULT 'MANUAL' CHECK (source IN ('MANUAL','AI','RECURRING','REVERSAL','SEED')),
  posted_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(),
  reverses_entry_id uuid, recurring_template_id uuid, occurrence_date date,
  idempotency_key text, request_hash text,
  UNIQUE (organization_id,id), UNIQUE (organization_id,idempotency_key),
  UNIQUE (organization_id,reverses_entry_id),
  UNIQUE (organization_id,recurring_template_id,occurrence_date),
  FOREIGN KEY (organization_id,reverses_entry_id) REFERENCES journal_entries(organization_id,id),
  FOREIGN KEY (organization_id,recurring_template_id) REFERENCES recurring_templates(organization_id,id),
  CHECK ((status='POSTED') = (posted_at IS NOT NULL)),
  CHECK ((recurring_template_id IS NULL) = (occurrence_date IS NULL)),
  CHECK (id IS DISTINCT FROM reverses_entry_id)
);
CREATE INDEX entries_by_date ON journal_entries(organization_id,date DESC,id DESC);
CREATE INDEX entries_posted ON journal_entries(organization_id,date,id) WHERE status='POSTED';
CREATE INDEX entries_drafts ON journal_entries(organization_id,date DESC,id DESC) WHERE status='DRAFT';
CREATE INDEX entries_search ON journal_entries USING gin ((description || ' ' || counterparty || ' ' || reference) gin_trgm_ops);
CREATE INDEX entries_counterparty ON journal_entries(organization_id,lower(counterparty),date);

CREATE TABLE journal_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL,
  entry_id uuid NOT NULL, account_id uuid NOT NULL, position integer NOT NULL CHECK (position>=0),
  currency text NOT NULL REFERENCES currencies(code),
  debit numeric NOT NULL DEFAULT 0, credit numeric NOT NULL DEFAULT 0,
  exchange_rate numeric NOT NULL DEFAULT 1,
  base_debit numeric GENERATED ALWAYS AS (round(debit*exchange_rate,2)) STORED,
  base_credit numeric GENERATED ALWAYS AS (round(credit*exchange_rate,2)) STORED,
  memo text NOT NULL DEFAULT '',
  FOREIGN KEY (organization_id,entry_id) REFERENCES journal_entries(organization_id,id),
  FOREIGN KEY (organization_id,account_id) REFERENCES accounts(organization_id,id),
  UNIQUE (entry_id,position),
  CHECK ((debit>0 AND credit=0) OR (credit>0 AND debit=0)),
  CHECK (debit<100000000000000 AND credit<100000000000000),
  CHECK (exchange_rate>0 AND exchange_rate<1000000 AND exchange_rate=round(exchange_rate,10)),
  CHECK (base_debit+base_credit>0), CHECK (base_debit+base_credit<100000000000000),
  CHECK (currency <> 'USD' OR exchange_rate=1)
);
CREATE INDEX lines_entry ON journal_lines(organization_id,entry_id);
CREATE INDEX lines_account ON journal_lines(organization_id,account_id,entry_id) INCLUDE (debit,credit,base_debit,base_credit);

CREATE TABLE categorization_feedback (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id),
  description text NOT NULL, counterparty text NOT NULL DEFAULT '',
  proposed_lines jsonb NOT NULL, corrected_lines jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX feedback_merchant ON categorization_feedback(organization_id,lower(counterparty),created_at DESC);

CREATE TABLE alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL, entry_id uuid NOT NULL,
  rule text NOT NULL, severity text NOT NULL CHECK (severity IN ('INFO','WARNING','HIGH')),
  title text NOT NULL, explanation text NOT NULL, evidence jsonb NOT NULL DEFAULT '{}',
  status text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','DISMISSED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (organization_id,entry_id) REFERENCES journal_entries(organization_id,id),
  UNIQUE (entry_id,rule)
);
CREATE INDEX alerts_open ON alerts(organization_id,created_at DESC) WHERE status='OPEN';

-- Transactional outbox: posting and scheduling its analysis commit together.
CREATE TABLE jobs (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES organizations(id), entry_id uuid NOT NULL,
  kind text NOT NULL DEFAULT 'ANALYZE_ENTRY' CHECK (kind='ANALYZE_ENTRY'),
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','RUNNING','DONE','FAILED')),
  attempts integer NOT NULL DEFAULT 0, run_after timestamptz NOT NULL DEFAULT now(),
  locked_at timestamptz, lease_token uuid, last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (organization_id,entry_id) REFERENCES journal_entries(organization_id,id),
  UNIQUE (entry_id,kind)
);
CREATE INDEX jobs_ready ON jobs(run_after,id) WHERE status IN ('PENDING','RUNNING');

CREATE FUNCTION guard_account() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE parent accounts%ROWTYPE;
BEGIN
  -- Serialize hierarchy changes within a single organization, preventing racing cycles.
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.organization_id::text || ':accounts',0));
  IF TG_OP='UPDATE' THEN
    IF NEW.organization_id<>OLD.organization_id OR NEW.id<>OLD.id THEN
      RAISE EXCEPTION 'Account identity cannot change' USING ERRCODE='23514';
    END IF;
    IF (NEW.type,NEW.currency,NEW.is_group,NEW.is_cash) IS DISTINCT FROM (OLD.type,OLD.currency,OLD.is_group,OLD.is_cash)
       AND EXISTS (SELECT 1 FROM journal_lines WHERE account_id=OLD.id) THEN
      RAISE EXCEPTION 'Type, currency, grouping and cash classification cannot change on a used account' USING ERRCODE='23514';
    END IF;
    IF (NEW.type<>OLD.type OR NOT NEW.is_group) AND EXISTS (SELECT 1 FROM accounts WHERE parent_id=OLD.id) THEN
      RAISE EXCEPTION 'An account with children must remain a group of the same type' USING ERRCODE='23514';
    END IF;
  END IF;
  IF NEW.parent_id IS NOT NULL THEN
    SELECT * INTO parent FROM accounts WHERE id=NEW.parent_id AND organization_id=NEW.organization_id;
    IF NOT FOUND OR NOT parent.is_group OR parent.type<>NEW.type OR parent.archived THEN
      RAISE EXCEPTION 'Parent must be an active group of the same account type' USING ERRCODE='23514';
    END IF;
    IF EXISTS (
      WITH RECURSIVE ancestors AS (
        SELECT id,parent_id FROM accounts WHERE id=NEW.parent_id
        UNION SELECT a.id,a.parent_id FROM accounts a JOIN ancestors x ON a.id=x.parent_id
      ) SELECT 1 FROM ancestors WHERE id=NEW.id
    ) THEN RAISE EXCEPTION 'Account hierarchy cannot contain a cycle' USING ERRCODE='23514'; END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER account_guard BEFORE INSERT OR UPDATE ON accounts FOR EACH ROW EXECUTE FUNCTION guard_account();

CREATE FUNCTION guard_entry() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status='POSTED' THEN
    RAISE EXCEPTION 'Posted entries are immutable; create a reversal' USING ERRCODE='23514';
  END IF;
  IF TG_OP='UPDATE' AND (NEW.id<>OLD.id OR NEW.organization_id<>OLD.organization_id) THEN
    RAISE EXCEPTION 'Entry identity cannot change' USING ERRCODE='23514';
  END IF;
  RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
END $$;
CREATE TRIGGER entry_guard BEFORE UPDATE OR DELETE ON journal_entries FOR EACH ROW EXECUTE FUNCTION guard_entry();

CREATE FUNCTION guard_line() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE e journal_entries%ROWTYPE; a accounts%ROWTYPE; minor integer;
BEGIN
  IF TG_OP='UPDATE' AND (NEW.entry_id,NEW.organization_id,NEW.id) IS DISTINCT FROM (OLD.entry_id,OLD.organization_id,OLD.id) THEN
    RAISE EXCEPTION 'Journal lines cannot be moved between entries' USING ERRCODE='23514';
  END IF;
  -- All line edits and posting contend on the same parent row, closing the race window.
  SELECT * INTO e FROM journal_entries WHERE id=CASE WHEN TG_OP='DELETE' THEN OLD.entry_id ELSE NEW.entry_id END FOR UPDATE;
  IF e.status='POSTED' THEN RAISE EXCEPTION 'Posted lines are immutable; create a reversal' USING ERRCODE='23514'; END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  SELECT * INTO a FROM accounts WHERE id=NEW.account_id AND organization_id=NEW.organization_id FOR SHARE;
  IF NOT FOUND OR a.is_group OR a.currency<>NEW.currency THEN
    RAISE EXCEPTION 'Line must use a posting account in its own currency and organization' USING ERRCODE='23514';
  END IF;
  SELECT minor_units INTO minor FROM currencies WHERE code=NEW.currency;
  IF NEW.debit<>round(NEW.debit,minor) OR NEW.credit<>round(NEW.credit,minor) THEN
    RAISE EXCEPTION 'Amount has too many decimal places for its currency' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER line_guard BEFORE INSERT OR UPDATE OR DELETE ON journal_lines FOR EACH ROW EXECUTE FUNCTION guard_line();

CREATE FUNCTION assert_posted_balance() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target uuid; e journal_entries%ROWTYPE; n integer; delta numeric;
BEGIN
  IF TG_TABLE_NAME='journal_entries' THEN target:=NEW.id;
  ELSE target:=CASE WHEN TG_OP='DELETE' THEN OLD.entry_id ELSE NEW.entry_id END; END IF;
  SELECT * INTO e FROM journal_entries WHERE id=target;
  IF NOT FOUND OR e.status<>'POSTED' THEN RETURN NULL; END IF;
  SELECT count(*),coalesce(sum(base_debit-base_credit),0) INTO n,delta FROM journal_lines WHERE entry_id=target;
  IF n<2 OR n>100 OR delta<>0 THEN
    RAISE EXCEPTION 'Posted entry requires 2 to 100 lines with equal base-currency debits and credits' USING ERRCODE='23514';
  END IF;
  -- Lock accounts so archiving cannot race with the posting decision.
  PERFORM a.id FROM accounts a JOIN journal_lines l ON l.account_id=a.id WHERE l.entry_id=target ORDER BY a.id FOR SHARE OF a;
  IF EXISTS (SELECT 1 FROM journal_lines l JOIN accounts a ON a.id=l.account_id WHERE l.entry_id=target AND a.archived) AND e.source<>'REVERSAL' THEN
    RAISE EXCEPTION 'Archived accounts cannot receive new postings' USING ERRCODE='23514';
  END IF;
  IF e.reverses_entry_id IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM journal_entries WHERE id=e.reverses_entry_id AND status='POSTED') THEN
      RAISE EXCEPTION 'Only a posted entry can be reversed' USING ERRCODE='23514';
    END IF;
    IF EXISTS (
      (SELECT account_id,currency,debit,credit,exchange_rate FROM journal_lines WHERE entry_id=target
       EXCEPT ALL SELECT account_id,currency,credit,debit,exchange_rate FROM journal_lines WHERE entry_id=e.reverses_entry_id)
      UNION ALL
      (SELECT account_id,currency,credit,debit,exchange_rate FROM journal_lines WHERE entry_id=e.reverses_entry_id
       EXCEPT ALL SELECT account_id,currency,debit,credit,exchange_rate FROM journal_lines WHERE entry_id=target)
    ) THEN RAISE EXCEPTION 'A reversal must exactly negate the original lines and exchange rates' USING ERRCODE='23514'; END IF;
  ELSIF e.source='REVERSAL' THEN
    RAISE EXCEPTION 'A reversal must reference its original entry' USING ERRCODE='23514';
  END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER entry_balance AFTER INSERT OR UPDATE ON journal_entries DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION assert_posted_balance();
CREATE CONSTRAINT TRIGGER line_balance AFTER INSERT OR UPDATE OR DELETE ON journal_lines DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION assert_posted_balance();

CREATE FUNCTION queue_entry_analysis() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status='POSTED' THEN
    INSERT INTO jobs(organization_id,entry_id) VALUES(NEW.organization_id,NEW.id) ON CONFLICT DO NOTHING;
  END IF;
  RETURN NULL;
END $$;
CREATE TRIGGER entry_analysis AFTER INSERT OR UPDATE ON journal_entries FOR EACH ROW EXECUTE FUNCTION queue_entry_analysis();

-- Runtime role cannot alter tables, disable triggers or truncate the journal.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='spiich_app') THEN
    CREATE ROLE spiich_app LOGIN PASSWORD 'spiich_app_local';
  END IF;
END $$;
GRANT USAGE ON SCHEMA public TO spiich_app;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO spiich_app;
GRANT INSERT,UPDATE,DELETE ON accounts,journal_entries,journal_lines,recurring_templates,categorization_feedback,alerts,jobs TO spiich_app;
GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA public TO spiich_app;
