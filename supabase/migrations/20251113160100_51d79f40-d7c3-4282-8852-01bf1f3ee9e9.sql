-- Create baseline_shares table for sharing baselines between users
CREATE TABLE IF NOT EXISTS public.baseline_shares (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  baseline_id UUID NOT NULL REFERENCES public.product_baselines(id) ON DELETE CASCADE,
  shared_with_user_id UUID NOT NULL,
  shared_by_user_id UUID NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  UNIQUE(baseline_id, shared_with_user_id)
);

-- Enable RLS
ALTER TABLE public.baseline_shares ENABLE ROW LEVEL SECURITY;

-- Policy: Users can view shares where they are the recipient or sharer
CREATE POLICY "Users can view their baseline shares"
ON public.baseline_shares
FOR SELECT
TO authenticated
USING (
  auth.uid() = shared_with_user_id OR 
  auth.uid() = shared_by_user_id
);

-- Policy: Baseline owners can create shares
CREATE POLICY "Baseline owners can share their baselines"
ON public.baseline_shares
FOR INSERT
TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.product_baselines
    WHERE id = baseline_id AND merchant_id = auth.uid()
  )
);

-- Policy: Share creators can delete their shares
CREATE POLICY "Users can delete shares they created"
ON public.baseline_shares
FOR DELETE
TO authenticated
USING (auth.uid() = shared_by_user_id);

-- Update product_baselines RLS policies to include shared access
DROP POLICY IF EXISTS "Users can view their own product baselines" ON public.product_baselines;
CREATE POLICY "Users can view their own or shared product baselines"
ON public.product_baselines
FOR SELECT
TO authenticated
USING (
  auth.uid() = merchant_id OR
  EXISTS (
    SELECT 1 FROM public.baseline_shares
    WHERE baseline_id = product_baselines.id
    AND shared_with_user_id = auth.uid()
  )
);

-- Update competitor_prices RLS to include shared access
DROP POLICY IF EXISTS "Users can view competitor prices for their baselines" ON public.competitor_prices;
CREATE POLICY "Users can view competitor prices for their or shared baselines"
ON public.competitor_prices
FOR SELECT
TO authenticated
USING (
  auth.uid() = merchant_id OR
  EXISTS (
    SELECT 1 FROM public.baseline_shares
    WHERE baseline_id = competitor_prices.baseline_id
    AND shared_with_user_id = auth.uid()
  )
);

-- Update pricing_results RLS to include shared access
DROP POLICY IF EXISTS "Users can view their own pricing results" ON public.pricing_results;
CREATE POLICY "Users can view their own or shared pricing results"
ON public.pricing_results
FOR SELECT
TO authenticated
USING (
  auth.uid() = merchant_id OR
  EXISTS (
    SELECT 1 FROM public.baseline_shares
    WHERE baseline_id = pricing_results.baseline_id
    AND shared_with_user_id = auth.uid()
  )
);

-- Update processing_status RLS to include shared access
DROP POLICY IF EXISTS "Users can view their own processing status" ON public.processing_status;
CREATE POLICY "Users can view their own or shared processing status"
ON public.processing_status
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.product_baselines pb
    WHERE pb.id = processing_status.baseline_id
    AND (
      pb.merchant_id = auth.uid() OR
      EXISTS (
        SELECT 1 FROM public.baseline_shares
        WHERE baseline_id = pb.id
        AND shared_with_user_id = auth.uid()
      )
    )
  )
);

-- Automatically share the existing baseline with the current user
INSERT INTO public.baseline_shares (baseline_id, shared_with_user_id, shared_by_user_id)
VALUES (
  '394e0111-e4d5-4e97-957d-ed682f3e4682',
  '9e84c012-a116-4814-beb9-9a4baa571467',
  '43483c6f-3d02-4cca-a058-9c7ffcce3b55'
)
ON CONFLICT (baseline_id, shared_with_user_id) DO NOTHING;