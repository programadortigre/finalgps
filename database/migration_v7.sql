-- Migration v7: Add phone and metadata to customers
ALTER TABLE customers ADD COLUMN IF NOT EXISTS phone TEXT;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}';

-- Index for faster metadata queries
CREATE INDEX IF NOT EXISTS idx_customers_metadata ON customers USING GIN (metadata);
