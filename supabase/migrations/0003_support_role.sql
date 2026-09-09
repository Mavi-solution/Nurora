-- =====================================================================
-- Migration 0003 — add the support role.
--
-- Kept in its own file on purpose: Postgres will not let a new enum
-- value be USED in the same transaction that adds it, and the Supabase
-- CLI runs each migration file in one transaction. 0004 uses it.
-- =====================================================================

alter type user_role add value if not exists 'support';
