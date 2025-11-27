-- Create AI validation cache table for storing AI decisions
CREATE TABLE IF NOT EXISTS public.ai_validation_cache (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_pair_hash text UNIQUE NOT NULL,
  your_product_name text NOT NULL,
  competitor_product_name text NOT NULL,
  marketplace text NOT NULL,
  ai_decision text NOT NULL CHECK (ai_decision IN ('match', 'accessory', 'different_product')),
  confidence_score numeric NOT NULL CHECK (confidence_score >= 0 AND confidence_score <= 1),
  reasoning text,
  created_at timestamp with time zone DEFAULT now(),
  expires_at timestamp with time zone DEFAULT (now() + interval '30 days'),
  hit_count integer DEFAULT 0,
  merchant_id uuid NOT NULL
);

-- Create manual review queue for flagged products
CREATE TABLE IF NOT EXISTS public.manual_review_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  baseline_id uuid REFERENCES public.product_baselines(id) ON DELETE CASCADE,
  merchant_id uuid NOT NULL,
  product_name text NOT NULL,
  attempted_marketplaces text[] NOT NULL,
  google_fallback_attempted boolean DEFAULT false,
  status text DEFAULT 'pending' CHECK (status IN ('pending', 'reviewed', 'ignored')),
  admin_notes text,
  created_at timestamp with time zone DEFAULT now(),
  reviewed_at timestamp with time zone,
  reviewed_by uuid
);

-- Create indexes for performance
CREATE INDEX idx_ai_cache_hash ON public.ai_validation_cache(product_pair_hash);
CREATE INDEX idx_ai_cache_expires ON public.ai_validation_cache(expires_at);
CREATE INDEX idx_ai_cache_merchant ON public.ai_validation_cache(merchant_id);
CREATE INDEX idx_manual_review_status ON public.manual_review_queue(status);
CREATE INDEX idx_manual_review_merchant ON public.manual_review_queue(merchant_id);

-- Enable RLS
ALTER TABLE public.ai_validation_cache ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.manual_review_queue ENABLE ROW LEVEL SECURITY;

-- RLS Policies for ai_validation_cache
CREATE POLICY "Users can view their own cache entries"
  ON public.ai_validation_cache
  FOR SELECT
  USING (auth.uid() = merchant_id);

CREATE POLICY "Users can create their own cache entries"
  ON public.ai_validation_cache
  FOR INSERT
  WITH CHECK (auth.uid() = merchant_id);

CREATE POLICY "Users can update their own cache entries"
  ON public.ai_validation_cache
  FOR UPDATE
  USING (auth.uid() = merchant_id);

-- RLS Policies for manual_review_queue
CREATE POLICY "Users can view their own review queue"
  ON public.manual_review_queue
  FOR SELECT
  USING (auth.uid() = merchant_id);

CREATE POLICY "Admins can view all review queues"
  ON public.manual_review_queue
  FOR SELECT
  USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Users can create their own review items"
  ON public.manual_review_queue
  FOR INSERT
  WITH CHECK (auth.uid() = merchant_id);

CREATE POLICY "Admins can update review items"
  ON public.manual_review_queue
  FOR UPDATE
  USING (public.has_role(auth.uid(), 'admin'));

-- Function to clean expired cache entries (can be called via cron)
CREATE OR REPLACE FUNCTION public.clean_expired_cache()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  deleted_count integer;
BEGIN
  DELETE FROM public.ai_validation_cache
  WHERE expires_at < now();
  
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$;