-- A broken schedule must not stop other templates' due entries.
ALTER TABLE recurring_templates ADD COLUMN last_error text;
ALTER TABLE recurring_templates ADD COLUMN revision integer NOT NULL DEFAULT 1 CHECK (revision>0);
ALTER TABLE recurring_templates ADD COLUMN request_key text;
ALTER TABLE recurring_templates ADD COLUMN request_hash text;
ALTER TABLE recurring_templates ADD UNIQUE (organization_id,request_key);
ALTER TABLE recurring_templates ADD CHECK (end_date IS NULL OR end_date>=anchor_date);
ALTER TABLE recurring_templates ADD CHECK (next_date>=anchor_date);
ALTER TABLE recurring_templates ADD CHECK (jsonb_array_length(lines) BETWEEN 2 AND 100);

CREATE FUNCTION guard_template_revision() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW.id,NEW.organization_id) IS DISTINCT FROM (OLD.id,OLD.organization_id) THEN
    RAISE EXCEPTION 'Template identity cannot change' USING ERRCODE='23514';
  END IF;
  NEW.revision:=OLD.revision+1;
  RETURN NEW;
END $$;
CREATE TRIGGER template_revision BEFORE UPDATE ON recurring_templates
  FOR EACH ROW EXECUTE FUNCTION guard_template_revision();
