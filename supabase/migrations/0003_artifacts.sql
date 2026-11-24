-- Milestone 3: three goals, one saved artifact per session. Apply by pasting the WHOLE file into the Supabase SQL editor.
-- Plain statements only (no DO blocks: they failed to paste for 0002). Safe to run twice.
--
-- BEFORE running, confirm the inline constraint names (the drops below depend on them):
--   select conrelid::regclass as tbl, conname, pg_get_constraintdef(oid) as def
--   from pg_constraint
--   where conrelid in ('sessions'::regclass, 'artifacts'::regclass) and contype = 'c';
-- Expect sessions_goal_type_check and artifacts_type_check. If a name differs, edit the drop lines below.

-- Old four-goal rows are M2 test data: reset them so the new constraints hold.
update business_profiles set suggested_goals = null where suggested_goals is not null;
update sessions
  set goal_type = null, goal_label = null, goal_custom_text = null,
      status = case when status in ('building', 'live') then 'goal' else status end
  where goal_type is not null or goal_label is not null;

-- The three goals.
alter table sessions drop constraint if exists sessions_goal_type_check;
alter table sessions add constraint sessions_goal_type_check
  check (goal_type is null or goal_type in ('launch_product', 'get_leads', 'plan_campaign'));

-- A playbook is a new artifact type.
alter table artifacts drop constraint if exists artifacts_type_check;
alter table artifacts add constraint artifacts_type_check
  check (type in ('page', 'inquiry_form', 'ad_creative', 'playbook'));

-- A draft becomes a saved artifact when the user clicks Save. One artifact per session.
alter table artifacts add column if not exists saved_at timestamptz;
create unique index if not exists artifacts_session_unique on artifacts (session_id);
