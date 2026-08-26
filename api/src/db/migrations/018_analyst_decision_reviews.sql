-- Durable analyst agreement and correction layer for AI-assisted decisions.
-- Reviews are append-only and never overwrite the underlying AI provenance.

CREATE TABLE IF NOT EXISTS analyst_decision_reviews (
  id BIGSERIAL PRIMARY KEY,
  entity_type TEXT NOT NULL CHECK (entity_type IN ('alert','incident')),
  entity_id TEXT NOT NULL,
  decision TEXT NOT NULL CHECK (decision IN (
    'confirmed','challenged','needs_more_evidence'
  )),
  reason TEXT NOT NULL CHECK (char_length(reason) BETWEEN 10 AND 1000),
  actor TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_analyst_decision_reviews_entity
  ON analyst_decision_reviews(entity_type,entity_id,created_at DESC,id DESC);
