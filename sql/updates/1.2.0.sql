-- LifeLine 1.2.0 - regole del motore salvate per ogni turno (replay) + modelli aggiornati
-- Struttura: le regole (versione, meccaniche attive, linee, idle_scale) passate al motore all'avvio del turno.
-- I turni precedenti restano con rules_json NULL: si rigiocano con le regole di versione 1.
ALTER TABLE lifeline_shifts
    ADD COLUMN rules_json JSON NULL AFTER client_version;
