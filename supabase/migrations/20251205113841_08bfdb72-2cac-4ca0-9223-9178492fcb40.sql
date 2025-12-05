-- First, delete duplicate entries keeping only the most recent one per baseline_id + marketplace
DELETE FROM competitor_prices
WHERE id NOT IN (
  SELECT DISTINCT ON (baseline_id, marketplace) id
  FROM competitor_prices
  ORDER BY baseline_id, marketplace, last_updated DESC NULLS LAST
);

-- Now add the unique constraint
ALTER TABLE competitor_prices 
ADD CONSTRAINT competitor_prices_baseline_marketplace_unique 
UNIQUE (baseline_id, marketplace);