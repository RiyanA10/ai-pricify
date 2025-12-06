-- Fix inflation_snapshots overly permissive RLS policies
-- Drop the existing permissive INSERT policy
DROP POLICY IF EXISTS "Authenticated users can create inflation snapshots" ON public.inflation_snapshots;

-- Create new restrictive INSERT policy - only admins can insert inflation data
CREATE POLICY "Admins can create inflation snapshots" 
ON public.inflation_snapshots 
FOR INSERT 
WITH CHECK (public.has_role(auth.uid(), 'admin'));