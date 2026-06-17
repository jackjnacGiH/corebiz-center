-- =========================================================================
-- 0067_disable_team_line_notify.sql
-- Stop pushing team notifications into LINE (save the push quota).
-- =========================================================================
-- Team notifications (new lead / quote request / account-link / quote response)
-- were pushed to Owner/Admin LINE via the trg_notify_team trigger → notify-team
-- edge function. Each push consumes the LINE OA monthly push quota (300/mo on
-- the free plan), competing with — and starving — customer replies.
--
-- Per Boss's request, disable team LINE notifications entirely. The AI Agent
-- task queue is unaffected: tasks are still created and Owner/Admin still see
-- them in the AI Agent page; they just no longer get a LINE push.
--
-- Reversible — re-enable (e.g. after upgrading the LINE plan) with:
--   alter table public.agent_tasks enable trigger trg_notify_team;
-- =========================================================================

alter table public.agent_tasks disable trigger trg_notify_team;
