-- Activation and funnel queries for the first-time experience. Paste into the Supabase SQL editor (read-only).
-- Activation = time from onboarding start (ftu_started) to the first saved artifact (artifact_saved). Paid conversion is tracked
-- separately as a click on the hand-off link (handoff_clicked). Every event is written by server code, never by the model.

-- 1. Median seconds from start to first saved artifact, and how many sessions activated.
select percentile_cont(0.5) within group (
         order by extract(epoch from (saved.created_at - started.created_at))) as median_seconds,
       count(*) as activated
from events started
join events saved on saved.session_id = started.session_id and saved.name = 'artifact_saved'
where started.name = 'ftu_started';

-- 2. Funnel: how many sessions reached each step.
select name, count(distinct session_id) as sessions
from events
where name in ('ftu_started', 'research_done', 'goals_suggested', 'goal_chosen', 'artifact_generated', 'artifact_saved', 'handoff_clicked')
group by name
order by array_position(array['ftu_started', 'research_done', 'goals_suggested', 'goal_chosen', 'artifact_generated', 'artifact_saved', 'handoff_clicked'], name);

-- 3. Which goal users pick, and how often the model's recommendation was the one they picked.
select props->>'goalType' as goal,
       count(*) as chosen,
       count(*) filter (where (props->>'followed')::boolean) as followed_the_recommendation
from events
where name = 'goal_chosen'
group by 1
order by chosen desc;

-- 4. Artifacts saved per goal, and whether they were model-written, a fallback template, or a branded card / generated ad.
select props->>'goalType' as goal, props->>'source' as source, count(*) as saved
from events
where name = 'artifact_saved'
group by 1, 2
order by 1, 3 desc;

-- 5. Where users get stuck: failures by tool and reason.
select props->>'tool' as tool, props->>'reason' as reason, count(*) as failures
from events
where name = 'tool_failed'
group by 1, 2
order by failures desc;

-- 6. Hand-off clicks per goal (the paid-conversion signal), as a share of saved artifacts.
select s.goal, s.saved, coalesce(h.clicks, 0) as handoff_clicks
from (select props->>'goalType' as goal, count(*) as saved from events where name = 'artifact_saved' group by 1) s
left join (select props->>'goalType' as goal, count(*) as clicks from events where name = 'handoff_clicked' group by 1) h using (goal);
