-- PostgreSQL is the final authority for settled allocations.
-- Preserve any development ledger; uniqueness violations require explicit repair.
CREATE TABLE IF NOT EXISTS resource_allocations (
    id UUID PRIMARY KEY,
    pool_id VARCHAR(255) NOT NULL,
    unit_id VARCHAR(255) NOT NULL,
    claimant_id VARCHAR(255) NOT NULL,
    status VARCHAR(255) NOT NULL,
    confirmed_at TIMESTAMPTZ NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_allocation_pool_unit
    ON resource_allocations (pool_id, unit_id);

CREATE UNIQUE INDEX IF NOT EXISTS uq_allocation_pool_claimant
    ON resource_allocations (pool_id, claimant_id);
