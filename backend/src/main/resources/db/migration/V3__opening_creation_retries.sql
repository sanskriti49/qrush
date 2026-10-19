ALTER TABLE openings ADD COLUMN request_id UUID NOT NULL DEFAULT gen_random_uuid();
CREATE UNIQUE INDEX uq_opening_request ON openings (request_id);
