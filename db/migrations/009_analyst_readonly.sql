-- Capability-limited analytical access. The app sets the organization locally,
-- starts READ ONLY, then switches to this role before running checked SELECTs.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='daybook_analyst_reader') THEN
    CREATE ROLE daybook_analyst_reader NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS;
  END IF;
END $$;
-- A role name is not proof of its privileges. Roles are cluster-wide, so allow
-- compatible reuse by isolated databases but fail rather than silently inherit
-- a pre-existing writer/login/owner role or unrelated application-data grants.
DO $$ DECLARE reader oid;
BEGIN
  SELECT oid INTO reader FROM pg_roles WHERE rolname='daybook_analyst_reader';
  IF EXISTS (SELECT 1 FROM pg_roles WHERE oid=reader AND
    (rolcanlogin OR rolsuper OR rolcreatedb OR rolcreaterole OR rolinherit OR rolreplication OR rolbypassrls))
    OR EXISTS (SELECT 1 FROM pg_auth_members WHERE member=reader)
    OR EXISTS (SELECT 1 FROM pg_auth_members m JOIN pg_roles member_role ON member_role.oid=m.member
      WHERE m.roleid=reader AND member_role.rolname NOT IN ('spiich_app',current_user,session_user))
    OR EXISTS (SELECT 1 FROM pg_class WHERE relowner=reader)
    OR EXISTS (SELECT 1 FROM pg_namespace WHERE nspowner=reader)
    OR EXISTS (SELECT 1 FROM pg_proc WHERE proowner=reader)
    OR EXISTS (SELECT 1 FROM pg_database WHERE datdba=reader)
    OR EXISTS (
      SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname NOT IN ('pg_catalog','information_schema','analytics')
        AND n.nspname NOT LIKE 'pg_toast%' AND n.nspname NOT LIKE 'pg_temp_%'
        AND c.relkind IN ('r','p','v','m','f')
        AND has_table_privilege(reader,c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'))
    OR EXISTS (
      SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname NOT IN ('pg_catalog','information_schema','analytics')
        AND n.nspname NOT LIKE 'pg_toast%' AND n.nspname NOT LIKE 'pg_temp_%'
        -- The planner may reorder AND predicates. Guard the type-sensitive
        -- function itself so non-sequence catalog rows cannot make setup fail.
        AND CASE WHEN c.relkind='S' THEN has_sequence_privilege(reader,c.oid,'SELECT,USAGE,UPDATE') ELSE false END)
  THEN RAISE EXCEPTION 'Existing daybook_analyst_reader role has incompatible privileges';
  END IF;
END $$;
CREATE SCHEMA analytics;
REVOKE ALL ON SCHEMA analytics FROM PUBLIC;

CREATE VIEW analytics.organization WITH (security_barrier=true) AS
SELECT id,name,base_currency,timezone,created_at FROM public.organizations
WHERE id=nullif(current_setting('daybook.organization_id',true),'')::uuid;
CREATE VIEW analytics.currencies WITH (security_barrier=true) AS
SELECT code,minor_units FROM public.currencies;
CREATE VIEW analytics.accounts WITH (security_barrier=true) AS
SELECT id,organization_id,code,name,type,currency,parent_id,is_group,is_cash,archived,created_at
FROM public.accounts WHERE organization_id=nullif(current_setting('daybook.organization_id',true),'')::uuid;
CREATE VIEW analytics.entries WITH (security_barrier=true) AS
SELECT id,organization_id,number,date,description,counterparty,reference,status,source,posted_at,created_at,
  reverses_entry_id,recurring_template_id,occurrence_date,revision
FROM public.journal_entries WHERE organization_id=nullif(current_setting('daybook.organization_id',true),'')::uuid;
CREATE VIEW analytics.lines WITH (security_barrier=true) AS
SELECT id,organization_id,entry_id,account_id,position,currency,debit,credit,exchange_rate,base_debit,base_credit,memo
FROM public.journal_lines WHERE organization_id=nullif(current_setting('daybook.organization_id',true),'')::uuid;
CREATE VIEW analytics.ledger WITH (security_barrier=true) AS
SELECT l.organization_id,l.id AS line_id,l.position,l.entry_id,e.number AS entry_number,e.date,e.description,
  e.counterparty,e.reference,e.status,e.source,e.posted_at,e.created_at AS entry_created_at,
  e.reverses_entry_id,e.recurring_template_id,e.occurrence_date,e.revision,
  l.account_id,a.code AS account_code,a.name AS account_name,a.type AS account_type,
  a.parent_id AS parent_account_id,a.is_group,a.is_cash,a.archived,
  l.currency,l.debit,l.credit,l.exchange_rate,l.base_debit,l.base_credit,l.memo,
  l.base_debit-l.base_credit AS base_net_debit,
  CASE WHEN a.type IN ('ASSET','EXPENSE') THEN l.base_debit-l.base_credit
    ELSE l.base_credit-l.base_debit END AS base_normal_balance_change
FROM public.journal_lines l
JOIN public.journal_entries e ON (e.organization_id,e.id)=(l.organization_id,l.entry_id)
JOIN public.accounts a ON (a.organization_id,a.id)=(l.organization_id,l.account_id)
WHERE l.organization_id=nullif(current_setting('daybook.organization_id',true),'')::uuid;
CREATE VIEW analytics.recurring WITH (security_barrier=true) AS
SELECT id,organization_id,name,description,counterparty,frequency,anchor_date,next_date,end_date,active,
  lines,created_at,revision,last_error
FROM public.recurring_templates WHERE organization_id=nullif(current_setting('daybook.organization_id',true),'')::uuid;
CREATE VIEW analytics.alerts WITH (security_barrier=true) AS
SELECT id,organization_id,entry_id,rule,severity,title,explanation,evidence,status,created_at,
  resolved_at,resolution_reason,resolution_entry_id
FROM public.alerts WHERE organization_id=nullif(current_setting('daybook.organization_id',true),'')::uuid;

GRANT USAGE ON SCHEMA analytics TO daybook_analyst_reader;
GRANT SELECT ON ALL TABLES IN SCHEMA analytics TO daybook_analyst_reader;
-- No LOGIN, base-table privileges, object ownership, or writer membership.
GRANT daybook_analyst_reader TO spiich_app WITH INHERIT FALSE, SET TRUE;
-- PostgreSQL's ordinary PUBLIC catalog/function/TEMP privileges are unchanged.
-- The SELECT-only AST policy, relation/function allowlists, and READ ONLY
-- transaction remain mandatory even with this restricted role.

COMMENT ON VIEW analytics.ledger IS 'One row per real journal line, including drafts. Posted financial facts require status=POSTED; drafts are pending, not payments. Exact stored base amounts use organization.base_currency carrying values, not current FX. Positive base_net_debit increases assets/expenses and decreases liability/equity/revenue. Never sum every debit as business spending.';
COMMENT ON VIEW analytics.recurring IS 'Templates and schedules, not actual payments or posted transactions. Join entries.recurring_template_id for generated occurrences.';
COMMENT ON VIEW analytics.alerts IS 'Recorded anomaly alerts, including open, dismissed and resolved history. Flags are warnings, not proof of wrongdoing or an exhaustive anomaly inventory.';
