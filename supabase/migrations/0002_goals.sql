-- Milestone 2: guards for the "Your goal" step. No new tables; 0001 already has every column.
-- Apply by pasting the WHOLE file into the Supabase SQL editor (or `supabase db push`).
-- Idempotent: drop-then-add, so it is safe to run twice, and safe on top of existing data
-- (existing rows have every goal_* column null, which satisfies both checks).

-- A saved goal must have a label. A custom goal may have no goal_type (goal_custom_text carries the words).
alter table sessions drop constraint if exists sessions_goal_consistent;
alter table sessions
  add constraint sessions_goal_consistent check (
    (goal_label is null and goal_type is null and goal_custom_text is null)
    or goal_label is not null
  );

-- suggested_goals is either null or a JSON array of goals.
alter table business_profiles drop constraint if exists business_profiles_suggested_goals_array;
alter table business_profiles
  add constraint business_profiles_suggested_goals_array check (
    suggested_goals is null or jsonb_typeof(suggested_goals) = 'array'
  );
