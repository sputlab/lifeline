-- =====================================================================
-- LifeLine - Schema database MVP (Fase 1 - Operatore CUR)
-- Versione schema: 1  |  App: 1.0.0
-- MySQL 8.0+ / MariaDB 10.5+
-- Tutte le date sono salvate in UTC (la connessione PDO imposta time_zone = '+00:00')  -  InnoDB, utf8mb4
-- =====================================================================

SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

-- ---------------------------------------------------------------------
-- Utenti
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS lifeline_users (
    id              INT UNSIGNED NOT NULL AUTO_INCREMENT,
    username        VARCHAR(40)  NOT NULL,
    email           VARCHAR(190) NULL,
    password_hash   VARCHAR(255) NOT NULL,
    lang            CHAR(2)      NOT NULL DEFAULT 'it',
    is_active       TINYINT(1)   NOT NULL DEFAULT 1,
    created_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_login_at   DATETIME     NULL,
    PRIMARY KEY (id),
    UNIQUE KEY uq_username (username),
    UNIQUE KEY uq_email (email)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- Carriera (1:1 con utente, separata per crescere nelle fasi 2 e 3)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS lifeline_careers (
    user_id           INT UNSIGNED      NOT NULL,
    phase             TINYINT UNSIGNED  NOT NULL DEFAULT 1,   -- 1=CUR, 2=PSAP2, 3=Coordinatore
    rank_level        SMALLINT UNSIGNED NOT NULL DEFAULT 1,
    xp                INT UNSIGNED      NOT NULL DEFAULT 0,
    shifts_completed  INT UNSIGNED      NOT NULL DEFAULT 0,
    calls_handled     INT UNSIGNED      NOT NULL DEFAULT 0,
    stats_json        JSON              NULL,                 -- medie per asse, record, ecc.
    updated_at        DATETIME          NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id),
    CONSTRAINT fk_careers_user FOREIGN KEY (user_id)
        REFERENCES lifeline_users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- Modelli di chiamata (contenuti data-driven)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS lifeline_call_templates (
    id               INT UNSIGNED      NOT NULL AUTO_INCREMENT,
    code             VARCHAR(40)       NOT NULL,              -- es. SAN_007
    title            VARCHAR(120)      NOT NULL,              -- titolo interno (debriefing)
    category         ENUM('sanitaria','incendio_tecnico','sicurezza','mista','impropria') NOT NULL,
    phase            TINYINT UNSIGNED  NOT NULL DEFAULT 1,
    difficulty       TINYINT UNSIGNED  NOT NULL,              -- 1..10
    weight           SMALLINT UNSIGNED NOT NULL DEFAULT 100,  -- peso di estrazione del Director
    min_rank         SMALLINT UNSIGNED NOT NULL DEFAULT 1,
    time_bands       SET('mattina','pomeriggio','sera','notte') NOT NULL DEFAULT 'mattina,pomeriggio,sera,notte',
    can_duplicate    TINYINT(1)        NOT NULL DEFAULT 0,    -- può generare chiamate secondarie
    is_story         TINYINT(1)        NOT NULL DEFAULT 0,
    content_json     JSON              NOT NULL,              -- verità, variabili, chiamante, nodi, scoring
    content_version  SMALLINT UNSIGNED NOT NULL DEFAULT 1,
    is_active        TINYINT(1)        NOT NULL DEFAULT 1,
    created_at       DATETIME          NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at       DATETIME          NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_code (code),
    KEY idx_selection (is_active, phase, difficulty)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- Turni
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS lifeline_shifts (
    id               BIGINT UNSIGNED   NOT NULL AUTO_INCREMENT,
    user_id          INT UNSIGNED      NOT NULL,
    seed             INT UNSIGNED      NOT NULL,              -- generato dal server
    mode             ENUM('carriera','libero','giornaliera','addestramento') NOT NULL DEFAULT 'carriera',
    phase            TINYINT UNSIGNED  NOT NULL DEFAULT 1,
    base_difficulty  TINYINT UNSIGNED  NOT NULL DEFAULT 1,
    game_start_time  TIME              NOT NULL,              -- ora di gioco d'inizio, es. 22:00
    status           ENUM('in_corso','completato','abbandonato') NOT NULL DEFAULT 'in_corso',
    score            INT UNSIGNED      NULL,
    grade            CHAR(1)           NULL,                  -- S, A, B, C, D
    xp_gained        INT UNSIGNED      NULL,
    client_version   VARCHAR(20)       NOT NULL,
    started_at       DATETIME          NOT NULL DEFAULT CURRENT_TIMESTAMP,
    ended_at         DATETIME          NULL,
    PRIMARY KEY (id),
    KEY idx_user_started (user_id, started_at),
    CONSTRAINT fk_shifts_user FOREIGN KEY (user_id)
        REFERENCES lifeline_users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- Chiamate gestite in un turno (risultati per il debriefing e le statistiche)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS lifeline_shift_calls (
    id                    BIGINT UNSIGNED   NOT NULL AUTO_INCREMENT,
    shift_id              BIGINT UNSIGNED   NOT NULL,
    seq                   SMALLINT UNSIGNED NOT NULL,         -- ordine di arrivo nel turno
    template_id           INT UNSIGNED      NOT NULL,
    template_version      SMALLINT UNSIGNED NOT NULL,
    variant_seed          INT UNSIGNED      NOT NULL,
    incident_ref          SMALLINT UNSIGNED NULL,             -- evento a cui appartiene (duplicati)
    is_duplicate          TINYINT(1)        NOT NULL DEFAULT 0,
    arrival_game_sec      INT UNSIGNED      NOT NULL,
    answered_game_sec     INT UNSIGNED      NULL,
    closed_game_sec       INT UNSIGNED      NULL,
    final_state           ENUM('trasferita','chiusa','accorpata','abbandonata','caduta') NOT NULL,
    agencies_sent         SET('118','115','PS','CC')          NULL,
    location_error_m      INT UNSIGNED      NULL,
    classification_ok     TINYINT(1)        NULL,
    score_time            TINYINT UNSIGNED  NOT NULL DEFAULT 0,  -- 0..100
    score_location        TINYINT UNSIGNED  NOT NULL DEFAULT 0,
    score_classification  TINYINT UNSIGNED  NOT NULL DEFAULT 0,
    score_agencies        TINYINT UNSIGNED  NOT NULL DEFAULT 0,
    score_protocol        TINYINT UNSIGNED  NOT NULL DEFAULT 0,
    outcome               ENUM('positivo','parziale','negativo','nessuno') NOT NULL DEFAULT 'nessuno',
    details_json          JSON              NULL,             -- fatti raccolti, domande, scheda
    PRIMARY KEY (id),
    UNIQUE KEY uq_shift_seq (shift_id, seq),
    KEY idx_template (template_id),
    CONSTRAINT fk_scalls_shift FOREIGN KEY (shift_id)
        REFERENCES lifeline_shifts (id) ON DELETE CASCADE,
    CONSTRAINT fk_scalls_template FOREIGN KEY (template_id)
        REFERENCES lifeline_call_templates (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- Log azioni del turno (per replay e validazione lato server in fase 2)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS lifeline_shift_logs (
    shift_id      BIGINT UNSIGNED NOT NULL,
    actions_json  LONGTEXT        NOT NULL,                   -- [{t, type, payload}, ...]
    created_at    DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (shift_id),
    CONSTRAINT fk_slogs_shift FOREIGN KEY (shift_id)
        REFERENCES lifeline_shifts (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- Tentativi di accesso e registrazione (protezione da forza bruta)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS lifeline_auth_attempts (
    id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    action        ENUM('login','register') NOT NULL,
    ip            VARBINARY(16)   NOT NULL,
    username      VARCHAR(60)     NOT NULL,
    success       TINYINT(1)      NOT NULL DEFAULT 0,
    attempted_at  DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    KEY idx_ip_time (action, ip, attempted_at),
    KEY idx_time (attempted_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- Impostazioni applicative
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS lifeline_settings (
    key_name    VARCHAR(64) NOT NULL,
    value       TEXT        NOT NULL,
    updated_at  DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (key_name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO lifeline_settings (key_name, value) VALUES
    ('app_version',    '1.0.0'),
    ('schema_version', '1'),
    ('xp_per_rank',    '1000')
ON DUPLICATE KEY UPDATE value = VALUES(value);

SET FOREIGN_KEY_CHECKS = 1;
