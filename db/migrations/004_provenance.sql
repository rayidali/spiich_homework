-- Provenance cannot be spoofed with an ordinary entry source, including when
-- SQL is used directly rather than the API's reversal service.
ALTER TABLE journal_entries ADD CHECK ((source='REVERSAL') = (reverses_entry_id IS NOT NULL));
ALTER TABLE journal_entries ADD CHECK ((source='RECURRING') = (recurring_template_id IS NOT NULL));

CREATE FUNCTION guard_reversal_date() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.reverses_entry_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM journal_entries WHERE id=NEW.reverses_entry_id AND date>NEW.date
  ) THEN
    RAISE EXCEPTION 'Reversal date cannot precede the original entry' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER reversal_date BEFORE INSERT OR UPDATE ON journal_entries
  FOR EACH ROW EXECUTE FUNCTION guard_reversal_date();

CREATE INDEX recurring_organization_due ON recurring_templates(organization_id,next_date,id) WHERE active;
