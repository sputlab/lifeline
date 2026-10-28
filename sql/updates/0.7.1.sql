-- LifeLine 0.7.1 - versione applicativa e pulizia dei turni rimasti a metà
UPDATE lifeline_settings SET value = '0.7.1' WHERE key_name = 'app_version';

-- Turni creati sul server ma mai giocati (avvio fallito nelle versioni precedenti):
-- abbandonati o ancora "in corso", senza registro azioni.
DELETE FROM lifeline_shifts
WHERE status IN ('abbandonato', 'in_corso')
  AND id NOT IN (SELECT shift_id FROM lifeline_shift_logs);
