-- Deterministic demo state for the review panel UI check.
-- The analysis/check services need a configured model, which this OSS dev
-- database does not have, so the rows a completed run would have produced are
-- seeded here. Everything the UI calls afterwards (apply, re-check, confirm)
-- goes through the real tRPC procedures.

update document_review_sessions
set rule_set_id = 'drrs_demo_contract', status = 'active'
where id = 'drs_demo_session';

update document_review_rule_sets
set status = 'draft', confirmed_at = null, confirmed_by_user_id = null
where id = 'drrs_demo_draft';

delete from document_review_check_results where session_id = 'drs_demo_session';

insert into document_review_check_results
  (session_id, rule_id, workspace_id, status, explanation, evidence, suggestion, checked_at, applied_at)
values
  ('drs_demo_session', '11111111-1111-4111-8111-111111111111', 'ws_review_demo', 'failed',
   'The definitions clause now describes acceptance stage by stage, but clause 2 never says which of the three stages is the final one. Payment and warranty both key off Final Acceptance, so the term still has no single referent.',
   $ev1$[{"quote":"\"Final Acceptance\" means the Customer's written acceptance of the entire Works after completion of all acceptance tests.","label":"§1 Definitions"},{"quote":"The Supplier shall complete the Works in three stages and request Final Acceptance for each stage in writing.","label":"§2 Acceptance"}]$ev1$::jsonb,
   $sg1${"original":"request Final Acceptance for each stage in writing","replacement":"request Final Acceptance for each stage in writing and name which stage is the final one"}$sg1$::jsonb,
   now(), null),

  ('drs_demo_session', '22222222-2222-4222-8222-222222222222', 'ws_review_demo', 'passed',
   'Payment is tied to a named acceptance milestone: the final instalment falls due 30 days after Final Acceptance, and Final Acceptance is named in the definitions.',
   $ev2$[{"quote":"The Customer shall pay the final instalment within thirty (30) days after Final Acceptance.","label":"§3 Payment"}]$ev2$::jsonb,
   null, now(), null),

  ('drs_demo_session', '33333333-3333-4333-8333-333333333333', 'ws_review_demo', 'uncertain',
   'The warranty period starts on the date of Final Acceptance. If acceptance now happens stage by stage, it is unclear which stage starts the twelve month period.',
   $ev3$[{"quote":"The warranty period starts on the date of Final Acceptance and lasts twelve (12) months.","label":"§4 Warranty"}]$ev3$::jsonb,
   null, now(), null),

  ('drs_demo_session', '44444444-4444-4444-8444-444444444444', 'ws_review_demo', 'needs_recheck',
   'The termination clause lists completed and partially completed Works. A fix was applied to name the acceptance stage of each delivered part; the clause has not been checked again.',
   $ev4$[{"quote":"On termination, the Supplier shall deliver all completed and partially completed Works to the Customer.","label":"§5 Termination"}]$ev4$::jsonb,
   null, now() - interval '20 minutes', now() - interval '5 minutes'),

  ('drs_demo_session', '55555555-5555-4555-8555-555555555555', 'ws_review_demo', 'passed',
   'Confidentiality explicitly survives termination for five years, so a staged or terminated delivery does not shorten the obligation.',
   $ev5$[{"quote":"Each party shall keep the other party's confidential information secret for five years after termination.","label":"§6 Confidentiality"}]$ev5$::jsonb,
   null, now(), null);
