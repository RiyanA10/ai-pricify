-- Make merchant_id nullable in product_baselines
ALTER TABLE product_baselines ALTER COLUMN merchant_id DROP NOT NULL;

-- Make merchant_id nullable in competitor_prices
ALTER TABLE competitor_prices ALTER COLUMN merchant_id DROP NOT NULL;

-- Make merchant_id nullable in competitor_products
ALTER TABLE competitor_products ALTER COLUMN merchant_id DROP NOT NULL;

-- Make merchant_id nullable in pricing_results
ALTER TABLE pricing_results ALTER COLUMN merchant_id DROP NOT NULL;

-- Make merchant_id nullable in pricing_performance
ALTER TABLE pricing_performance ALTER COLUMN merchant_id DROP NOT NULL;

-- Update RLS policies to allow null merchant_id inserts via service role
-- The edge function will use service role key to bypass RLS for guest inserts