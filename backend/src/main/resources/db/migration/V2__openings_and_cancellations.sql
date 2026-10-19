CREATE TABLE openings (
    id VARCHAR(80) PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    description VARCHAR(2000) NOT NULL,
    resource_prefix VARCHAR(80) NOT NULL,
    capacity INTEGER NOT NULL CHECK (capacity BETWEEN 1 AND 1000),
    opens_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL
);

ALTER TABLE resource_allocations ADD COLUMN cancelled_at TIMESTAMPTZ;
DROP INDEX uq_allocation_pool_unit;
DROP INDEX uq_allocation_pool_claimant;
-- Keep cancellation history while allowing a released place to be booked again.
CREATE UNIQUE INDEX uq_allocation_pool_unit ON resource_allocations (pool_id, unit_id)
    WHERE status = 'CONFIRMED';
CREATE UNIQUE INDEX uq_allocation_pool_claimant ON resource_allocations (pool_id, claimant_id)
    WHERE status = 'CONFIRMED';
CREATE INDEX ix_allocation_participant_history ON resource_allocations (pool_id, claimant_id, confirmed_at DESC);
