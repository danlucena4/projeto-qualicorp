-- Schema do banco local.
--
-- Duas camadas:
--
-- 1) CAMADA RAW QUALICORP (qc_*): espelho direto do que a API do QualiVendas
--    retorna — operadoras, profissões, entidades, e o card "tabela" (que na
--    verdade é um PDF por tupla UF × operadora × entidade). É o que o scraper
--    popula.
--
-- 2) CAMADA KOTER: operators → plans → product_tables → products + cidades e
--    redes, espelhando o domínio que o agente Koter cadastra. É preenchida na
--    etapa seguinte (parsing dos PDFs) e é o que vai alimentar a integração.

PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;

-- ============================================================================
-- Camada raw Qualicorp
-- ============================================================================

CREATE TABLE IF NOT EXISTS qc_states (
    uf TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    last_synced_at TEXT
);

CREATE TABLE IF NOT EXISTS qc_operators (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    logo_url TEXT,
    first_seen_at TEXT DEFAULT CURRENT_TIMESTAMP,
    last_seen_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- Operadoras por UF (many-to-many derivado do endpoint /operadoras/{UF}).
CREATE TABLE IF NOT EXISTS qc_operators_by_state (
    uf TEXT NOT NULL REFERENCES qc_states(uf) ON DELETE CASCADE,
    operator_id INTEGER NOT NULL REFERENCES qc_operators(id) ON DELETE CASCADE,
    PRIMARY KEY (uf, operator_id)
);

CREATE TABLE IF NOT EXISTS qc_professions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS qc_professions_by_state (
    uf TEXT NOT NULL REFERENCES qc_states(uf) ON DELETE CASCADE,
    profession_id INTEGER NOT NULL REFERENCES qc_professions(id) ON DELETE CASCADE,
    PRIMARY KEY (uf, profession_id)
);

CREATE TABLE IF NOT EXISTS qc_entities (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    link_filiacao TEXT
);

CREATE TABLE IF NOT EXISTS qc_entities_by_state (
    uf TEXT NOT NULL REFERENCES qc_states(uf) ON DELETE CASCADE,
    entity_id INTEGER NOT NULL REFERENCES qc_entities(id) ON DELETE CASCADE,
    PRIMARY KEY (uf, entity_id)
);

-- "Tabela de venda" da Qualicorp: uma linha por tupla (UF × operadora × entidade),
-- com os links dos PDFs que o Koter consome como material.
CREATE TABLE IF NOT EXISTS qc_tables (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    uf TEXT NOT NULL REFERENCES qc_states(uf) ON DELETE CASCADE,
    operator_id INTEGER NOT NULL REFERENCES qc_operators(id) ON DELETE CASCADE,
    entity_id INTEGER NOT NULL REFERENCES qc_entities(id) ON DELETE CASCADE,
    link_tabela TEXT,
    link_adesao TEXT,
    link_filiacao TEXT,
    link_aditivo TEXT,
    link_outros_documentos TEXT,
    publico INTEGER,
    raw_json TEXT,
    pdf_local_path TEXT,
    pdf_sha256 TEXT,
    pdf_downloaded_at TEXT,
    pdf_extracted_at TEXT,
    pdf_extraction_json TEXT,
    pdf_extraction_error TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (uf, operator_id, entity_id)
);

CREATE INDEX IF NOT EXISTS idx_qc_tables_uf ON qc_tables(uf);
CREATE INDEX IF NOT EXISTS idx_qc_tables_operator ON qc_tables(operator_id);
CREATE INDEX IF NOT EXISTS idx_qc_tables_entity ON qc_tables(entity_id);

-- ============================================================================
-- Camada Koter (alvo da integração)
-- ============================================================================
-- Populada numa segunda fase a partir do parsing dos PDFs em qc_tables. Por
-- enquanto as tabelas ficam vazias — o scraper raw já resolve o MVP.

CREATE TABLE IF NOT EXISTS operators (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    qualicorp_id TEXT UNIQUE,
    qc_operator_id INTEGER REFERENCES qc_operators(id),
    name TEXT NOT NULL,
    ans_code TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS plans (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    operator_id INTEGER NOT NULL REFERENCES operators(id) ON DELETE CASCADE,
    qc_table_id INTEGER REFERENCES qc_tables(id),
    name TEXT NOT NULL,
    category TEXT CHECK (category IN ('PF','PME','ADHESION')),
    raw_metadata TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS product_tables (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    plan_id INTEGER NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    includes_coparticipation TEXT CHECK (includes_coparticipation IN ('WITH','WITHOUT','PARTIAL')),
    contract_type TEXT CHECK (contract_type IN ('COMPULSORY','VOLUNTARY','NOT_APPLICABLE')),
    min_covered_lives INTEGER,
    max_covered_lives INTEGER,
    includes_iof INTEGER,
    is_refundable INTEGER,
    associations TEXT,
    lpts TEXT,
    external_api_table_id TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS products (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    product_table_id INTEGER NOT NULL REFERENCES product_tables(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    accommodation TEXT,
    coverage TEXT,
    segment TEXT,
    ans_code TEXT,
    external_api_product_id TEXT,
    price_age_0_18 REAL DEFAULT 0,
    price_age_19_23 REAL DEFAULT 0,
    price_age_24_28 REAL DEFAULT 0,
    price_age_29_33 REAL DEFAULT 0,
    price_age_34_38 REAL DEFAULT 0,
    price_age_39_43 REAL DEFAULT 0,
    price_age_44_48 REAL DEFAULT 0,
    price_age_49_53 REAL DEFAULT 0,
    price_age_54_58 REAL DEFAULT 0,
    price_age_59_upper REAL DEFAULT 0,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS product_cities (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    state TEXT NOT NULL,
    city TEXT NOT NULL,
    UNIQUE (product_id, state, city)
);

CREATE TABLE IF NOT EXISTS refnets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE NOT NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS product_refnets (
    product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    refnet_id INTEGER NOT NULL REFERENCES refnets(id) ON DELETE CASCADE,
    specialties TEXT,
    PRIMARY KEY (product_id, refnet_id)
);

-- ============================================================================
-- Sync runs + eventos
-- ============================================================================

CREATE TABLE IF NOT EXISTS sync_runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    status TEXT NOT NULL CHECK (status IN ('RUNNING','WAITING_MFA','SUCCESS','FAILED','CANCELLED')),
    started_at TEXT DEFAULT CURRENT_TIMESTAMP,
    finished_at TEXT,
    error TEXT,
    stats TEXT
);

CREATE TABLE IF NOT EXISTS sync_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id INTEGER NOT NULL REFERENCES sync_runs(id) ON DELETE CASCADE,
    type TEXT NOT NULL,
    message TEXT,
    payload TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_plans_operator ON plans(operator_id);
CREATE INDEX IF NOT EXISTS idx_tables_plan ON product_tables(plan_id);
CREATE INDEX IF NOT EXISTS idx_products_table ON products(product_table_id);
CREATE INDEX IF NOT EXISTS idx_product_cities_product ON product_cities(product_id);
CREATE INDEX IF NOT EXISTS idx_sync_events_run ON sync_events(run_id);

-- ============================================================================
-- Seed: 27 UFs do Brasil
-- ============================================================================

INSERT OR IGNORE INTO qc_states (uf, name) VALUES
    ('AC','Acre'),
    ('AL','Alagoas'),
    ('AP','Amapá'),
    ('AM','Amazonas'),
    ('BA','Bahia'),
    ('CE','Ceará'),
    ('DF','Distrito Federal'),
    ('ES','Espírito Santo'),
    ('GO','Goiás'),
    ('MA','Maranhão'),
    ('MT','Mato Grosso'),
    ('MS','Mato Grosso do Sul'),
    ('MG','Minas Gerais'),
    ('PA','Pará'),
    ('PB','Paraíba'),
    ('PR','Paraná'),
    ('PE','Pernambuco'),
    ('PI','Piauí'),
    ('RJ','Rio de Janeiro'),
    ('RN','Rio Grande do Norte'),
    ('RS','Rio Grande do Sul'),
    ('RO','Rondônia'),
    ('RR','Roraima'),
    ('SC','Santa Catarina'),
    ('SP','São Paulo'),
    ('SE','Sergipe'),
    ('TO','Tocantins');
