-- 0001: migration bookkeeping. Tables for encrypted backups (US-8.4) come later,
-- expand then contract, one release apart.
CREATE TABLE IF NOT EXISTS schema_migrations (
    version    integer PRIMARY KEY,
    name       text        NOT NULL,
    applied_at timestamptz NOT NULL DEFAULT now()
);
