-- A review is tied to a draft revision. Stale browser tabs cannot silently replace
-- a colleague's changes or post an entry they have never seen.
ALTER TABLE journal_entries ADD COLUMN revision integer NOT NULL DEFAULT 1 CHECK (revision>0);
ALTER TABLE organizations ADD COLUMN demo_seed_date date;
ALTER TABLE organizations ADD COLUMN demo_seed_complete boolean NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION guard_entry() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status='POSTED' THEN
    RAISE EXCEPTION 'Posted entries are immutable; create a reversal' USING ERRCODE='23514';
  END IF;
  IF TG_OP='UPDATE' THEN
    IF NEW.id<>OLD.id OR NEW.organization_id<>OLD.organization_id THEN
      RAISE EXCEPTION 'Entry identity cannot change' USING ERRCODE='23514';
    END IF;
    NEW.revision:=OLD.revision+1;
  END IF;
  RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
END $$;

CREATE FUNCTION touch_draft_revision() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  UPDATE journal_entries SET revision=revision+1
    WHERE id=CASE WHEN TG_OP='DELETE' THEN OLD.entry_id ELSE NEW.entry_id END AND status='DRAFT';
  RETURN NULL;
END $$;
CREATE TRIGGER line_revision AFTER INSERT OR UPDATE OR DELETE ON journal_lines FOR EACH ROW EXECUTE FUNCTION touch_draft_revision();
