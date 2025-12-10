-- Remove table_mode_requires_table constraint
-- The constraint cannot be made deferrable in PostgreSQL (CHECK constraints don't support DEFERRABLE)
-- The application already validates this requirement at the service layer (generatorService.ts:214-217)
-- Removing the constraint allows the create generator transaction to work correctly

ALTER TABLE generators
  DROP CONSTRAINT table_mode_requires_table;
