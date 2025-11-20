-- Create competitor_products table to store individual scraped products
CREATE TABLE IF NOT EXISTS public.competitor_products (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  baseline_id UUID NOT NULL,
  merchant_id UUID NOT NULL,
  marketplace TEXT NOT NULL,
  product_name TEXT NOT NULL,
  price NUMERIC NOT NULL,
  similarity_score NUMERIC NOT NULL,
  price_ratio NUMERIC NOT NULL,
  product_url TEXT,
  currency TEXT NOT NULL,
  rank INTEGER NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.competitor_products ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Users can view competitor products for their or shared baselines"
ON public.competitor_products
FOR SELECT
USING (
  auth.uid() = merchant_id 
  OR EXISTS (
    SELECT 1 FROM baseline_shares
    WHERE baseline_shares.baseline_id = competitor_products.baseline_id
    AND baseline_shares.shared_with_user_id = auth.uid()
  )
);

CREATE POLICY "Users can create competitor products for their baselines"
ON public.competitor_products
FOR INSERT
WITH CHECK (auth.uid() = merchant_id);

CREATE POLICY "Users can update competitor products for their baselines"
ON public.competitor_products
FOR UPDATE
USING (auth.uid() = merchant_id);

CREATE POLICY "Users can delete competitor products for their baselines"
ON public.competitor_products
FOR DELETE
USING (auth.uid() = merchant_id);

-- Create indexes for better query performance
CREATE INDEX idx_competitor_products_baseline_id ON public.competitor_products(baseline_id);
CREATE INDEX idx_competitor_products_merchant_id ON public.competitor_products(merchant_id);
CREATE INDEX idx_competitor_products_marketplace ON public.competitor_products(marketplace);
CREATE INDEX idx_competitor_products_similarity_score ON public.competitor_products(similarity_score DESC);