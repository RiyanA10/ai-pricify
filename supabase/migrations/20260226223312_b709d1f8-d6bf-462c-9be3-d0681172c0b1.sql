
-- Add RLS policy for anon users to view processing_status for guest baselines
CREATE POLICY "Allow anon to view guest processing status"
ON public.processing_status FOR SELECT
TO anon
USING (
  EXISTS (
    SELECT 1
    FROM public.product_baselines
    WHERE product_baselines.id = processing_status.baseline_id
      AND product_baselines.merchant_id IS NULL
  )
);

-- Also allow anon to view guest product_baselines
CREATE POLICY "Allow anon to view guest baselines"
ON public.product_baselines FOR SELECT
TO anon
USING (merchant_id IS NULL);

-- Allow anon to view guest pricing_results
CREATE POLICY "Allow anon to view guest pricing results"
ON public.pricing_results FOR SELECT
TO anon
USING (merchant_id IS NULL);

-- Allow anon to view guest competitor_prices
CREATE POLICY "Allow anon to view guest competitor prices"
ON public.competitor_prices FOR SELECT
TO anon
USING (merchant_id IS NULL);

-- Allow anon to view guest competitor_products
CREATE POLICY "Allow anon to view guest competitor products"
ON public.competitor_products FOR SELECT
TO anon
USING (merchant_id IS NULL);
