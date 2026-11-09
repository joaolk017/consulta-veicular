-- Esquema mínimo de testes: somente dados fictícios; NÃO aplicar na produção.
BEGIN;
CREATE TABLE IF NOT EXISTS credit_accounts (
 id UUID PRIMARY KEY,
 balance INTEGER NOT NULL DEFAULT 0 CHECK (balance >= 0),
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS credit_transactions (
 id BIGSERIAL PRIMARY KEY,
 account_id UUID NOT NULL REFERENCES credit_accounts(id) ON DELETE CASCADE,
 type TEXT NOT NULL CHECK (type IN ('purchase','consume','refund')),
 quantity INTEGER NOT NULL,
 reference TEXT NOT NULL,
 plate TEXT,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 UNIQUE(type, reference)
);
CREATE TABLE IF NOT EXISTS payments (
 correlation_id TEXT PRIMARY KEY,
 account_id UUID NOT NULL REFERENCES credit_accounts(id) ON DELETE CASCADE,
 product TEXT NOT NULL,
 cents INTEGER NOT NULL,
 credits INTEGER NOT NULL,
 status TEXT NOT NULL DEFAULT 'pending',
 credited_at TIMESTAMPTZ,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
COMMIT;
