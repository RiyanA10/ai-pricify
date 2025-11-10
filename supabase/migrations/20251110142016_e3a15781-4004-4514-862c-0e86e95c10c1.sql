-- Create profiles table
CREATE TABLE IF NOT EXISTS public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email_verified BOOLEAN DEFAULT FALSE,
  email_verified_at TIMESTAMP WITH TIME ZONE,
  business_name TEXT,
  phone TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Enable RLS on profiles
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- Profiles policies
CREATE POLICY "Users can view their own profile"
  ON public.profiles FOR SELECT
  USING (auth.uid() = id);

CREATE POLICY "Users can update their own profile"
  ON public.profiles FOR UPDATE
  USING (auth.uid() = id);

CREATE POLICY "Users can insert their own profile"
  ON public.profiles FOR INSERT
  WITH CHECK (auth.uid() = id);

-- Create email_verifications table
CREATE TABLE IF NOT EXISTS public.email_verifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  email TEXT NOT NULL,
  verification_code VARCHAR(6) NOT NULL,
  code_hash TEXT NOT NULL,
  expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
  verified BOOLEAN DEFAULT FALSE,
  attempts INTEGER DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  verified_at TIMESTAMP WITH TIME ZONE
);

CREATE INDEX idx_email_verifications_user ON public.email_verifications(user_id);
CREATE INDEX idx_email_verifications_code ON public.email_verifications(code_hash);
CREATE INDEX idx_email_verifications_expires ON public.email_verifications(expires_at);

-- Enable RLS on email_verifications
ALTER TABLE public.email_verifications ENABLE ROW LEVEL SECURITY;

-- Email verifications policies
CREATE POLICY "Users can view their own verifications"
  ON public.email_verifications FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own verifications"
  ON public.email_verifications FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own verifications"
  ON public.email_verifications FOR UPDATE
  USING (auth.uid() = user_id);

-- Function to auto-create profile on user signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, business_name, email_verified)
  VALUES (
    NEW.id,
    NEW.raw_user_meta_data->>'business_name',
    FALSE
  );
  RETURN NEW;
END;
$$;

-- Trigger to create profile on signup
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();