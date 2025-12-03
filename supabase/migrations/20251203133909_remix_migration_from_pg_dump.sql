CREATE EXTENSION IF NOT EXISTS "pg_graphql";
CREATE EXTENSION IF NOT EXISTS "pg_stat_statements";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "plpgsql";
CREATE EXTENSION IF NOT EXISTS "supabase_vault";
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
--
-- PostgreSQL database dump
--


-- Dumped from database version 17.6
-- Dumped by pg_dump version 17.7

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: public; Type: SCHEMA; Schema: -; Owner: -
--



--
-- Name: app_role; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.app_role AS ENUM (
    'admin',
    'user'
);


--
-- Name: clean_expired_cache(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.clean_expired_cache() RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
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


--
-- Name: handle_new_user(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.handle_new_user() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
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


--
-- Name: has_role(uuid, public.app_role); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.has_role(_user_id uuid, _role public.app_role) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles
    WHERE user_id = _user_id
      AND role = _role
  )
$$;


--
-- Name: is_admin(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.is_admin(_user_id uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT public.has_role(_user_id, 'admin')
$$;


SET default_table_access_method = heap;

--
-- Name: ai_validation_cache; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ai_validation_cache (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    product_pair_hash text NOT NULL,
    your_product_name text NOT NULL,
    competitor_product_name text NOT NULL,
    marketplace text NOT NULL,
    ai_decision text NOT NULL,
    confidence_score numeric NOT NULL,
    reasoning text,
    created_at timestamp with time zone DEFAULT now(),
    expires_at timestamp with time zone DEFAULT (now() + '30 days'::interval),
    hit_count integer DEFAULT 0,
    merchant_id uuid NOT NULL,
    CONSTRAINT ai_validation_cache_ai_decision_check CHECK ((ai_decision = ANY (ARRAY['match'::text, 'accessory'::text, 'different_product'::text]))),
    CONSTRAINT ai_validation_cache_confidence_score_check CHECK (((confidence_score >= (0)::numeric) AND (confidence_score <= (1)::numeric)))
);


--
-- Name: baseline_shares; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.baseline_shares (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    baseline_id uuid NOT NULL,
    shared_with_user_id uuid NOT NULL,
    shared_by_user_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: competitor_prices; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.competitor_prices (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    baseline_id uuid,
    merchant_id uuid NOT NULL,
    marketplace text NOT NULL,
    lowest_price numeric(10,2),
    average_price numeric(10,2),
    highest_price numeric(10,2),
    currency text NOT NULL,
    products_found integer DEFAULT 0,
    last_updated timestamp without time zone DEFAULT now(),
    fetch_status text DEFAULT 'pending'::text,
    CONSTRAINT competitor_prices_fetch_status_check CHECK ((fetch_status = ANY (ARRAY['pending'::text, 'success'::text, 'failed'::text, 'no_data'::text])))
);


--
-- Name: competitor_products; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.competitor_products (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    baseline_id uuid NOT NULL,
    merchant_id uuid NOT NULL,
    marketplace text NOT NULL,
    product_name text NOT NULL,
    price numeric NOT NULL,
    similarity_score numeric NOT NULL,
    price_ratio numeric NOT NULL,
    product_url text,
    currency text NOT NULL,
    rank integer NOT NULL,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: email_verifications; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.email_verifications (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    email text NOT NULL,
    verification_code character varying(6) NOT NULL,
    code_hash text NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    verified boolean DEFAULT false,
    attempts integer DEFAULT 0,
    created_at timestamp with time zone DEFAULT now(),
    verified_at timestamp with time zone
);


--
-- Name: inflation_snapshots; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.inflation_snapshots (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    inflation_rate numeric(10,6) NOT NULL,
    source text,
    fetched_at timestamp without time zone DEFAULT now()
);


--
-- Name: manual_review_queue; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.manual_review_queue (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    baseline_id uuid,
    merchant_id uuid NOT NULL,
    product_name text NOT NULL,
    attempted_marketplaces text[] NOT NULL,
    google_fallback_attempted boolean DEFAULT false,
    status text DEFAULT 'pending'::text,
    admin_notes text,
    created_at timestamp with time zone DEFAULT now(),
    reviewed_at timestamp with time zone,
    reviewed_by uuid,
    CONSTRAINT manual_review_queue_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'reviewed'::text, 'ignored'::text])))
);


--
-- Name: pricing_performance; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pricing_performance (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    baseline_id uuid,
    merchant_id uuid NOT NULL,
    suggested_price numeric NOT NULL,
    applied_price numeric,
    applied_at timestamp with time zone,
    predicted_sales integer NOT NULL,
    actual_sales integer,
    actual_profit numeric,
    sales_accuracy_score numeric,
    profit_accuracy_score numeric,
    market_average numeric,
    market_lowest numeric,
    market_highest numeric,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: pricing_results; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pricing_results (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    baseline_id uuid,
    merchant_id uuid NOT NULL,
    base_elasticity numeric(10,4) NOT NULL,
    inflation_rate numeric(10,6) NOT NULL,
    inflation_adjustment numeric(10,6) NOT NULL,
    competitor_factor numeric(10,4) NOT NULL,
    calibrated_elasticity numeric(10,4) NOT NULL,
    optimal_price numeric(10,2) NOT NULL,
    suggested_price numeric(10,2) NOT NULL,
    expected_monthly_profit numeric(10,2),
    profit_increase_amount numeric(10,2),
    profit_increase_percent numeric(10,4),
    market_average numeric(10,2),
    market_lowest numeric(10,2),
    market_highest numeric(10,2),
    position_vs_market numeric(10,4),
    has_warning boolean DEFAULT false,
    warning_message text,
    currency text NOT NULL,
    created_at timestamp without time zone DEFAULT now()
);


--
-- Name: processing_status; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.processing_status (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    baseline_id uuid,
    status text DEFAULT 'pending'::text,
    current_step text,
    error_message text,
    updated_at timestamp without time zone DEFAULT now(),
    CONSTRAINT processing_status_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'processing'::text, 'completed'::text, 'failed'::text])))
);


--
-- Name: product_baselines; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.product_baselines (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    merchant_id uuid NOT NULL,
    product_name text NOT NULL,
    category text NOT NULL,
    current_price numeric(10,2) NOT NULL,
    current_quantity integer NOT NULL,
    cost_per_unit numeric(10,2) NOT NULL,
    currency text NOT NULL,
    base_elasticity numeric(10,4) NOT NULL,
    created_at timestamp without time zone DEFAULT now(),
    deleted_at timestamp with time zone,
    CONSTRAINT product_baselines_category_check CHECK ((category = ANY (ARRAY['Electronics & Technology'::text, 'Fashion & Apparel'::text, 'Luxury Goods'::text, 'Food & Beverages'::text, 'Health & Beauty'::text, 'Home & Furniture'::text, 'Sports & Outdoors'::text, 'Toys & Games'::text, 'Books & Media'::text, 'Automotive Parts'::text, 'Pharmaceuticals'::text, 'Groceries (Staples)'::text, 'Office Supplies'::text, 'Pet Supplies'::text]))),
    CONSTRAINT product_baselines_cost_per_unit_check CHECK ((cost_per_unit > (0)::numeric)),
    CONSTRAINT product_baselines_currency_check CHECK ((currency = ANY (ARRAY['SAR'::text, 'USD'::text]))),
    CONSTRAINT product_baselines_current_price_check CHECK ((current_price > (0)::numeric)),
    CONSTRAINT product_baselines_current_quantity_check CHECK ((current_quantity > 0))
);


--
-- Name: profiles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.profiles (
    id uuid NOT NULL,
    email_verified boolean DEFAULT false,
    email_verified_at timestamp with time zone,
    business_name text,
    phone text,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: user_roles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_roles (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    role public.app_role DEFAULT 'user'::public.app_role NOT NULL,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: ai_validation_cache ai_validation_cache_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_validation_cache
    ADD CONSTRAINT ai_validation_cache_pkey PRIMARY KEY (id);


--
-- Name: ai_validation_cache ai_validation_cache_product_pair_hash_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_validation_cache
    ADD CONSTRAINT ai_validation_cache_product_pair_hash_key UNIQUE (product_pair_hash);


--
-- Name: baseline_shares baseline_shares_baseline_id_shared_with_user_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.baseline_shares
    ADD CONSTRAINT baseline_shares_baseline_id_shared_with_user_id_key UNIQUE (baseline_id, shared_with_user_id);


--
-- Name: baseline_shares baseline_shares_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.baseline_shares
    ADD CONSTRAINT baseline_shares_pkey PRIMARY KEY (id);


--
-- Name: competitor_prices competitor_prices_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.competitor_prices
    ADD CONSTRAINT competitor_prices_pkey PRIMARY KEY (id);


--
-- Name: competitor_products competitor_products_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.competitor_products
    ADD CONSTRAINT competitor_products_pkey PRIMARY KEY (id);


--
-- Name: email_verifications email_verifications_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_verifications
    ADD CONSTRAINT email_verifications_pkey PRIMARY KEY (id);


--
-- Name: inflation_snapshots inflation_snapshots_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inflation_snapshots
    ADD CONSTRAINT inflation_snapshots_pkey PRIMARY KEY (id);


--
-- Name: manual_review_queue manual_review_queue_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.manual_review_queue
    ADD CONSTRAINT manual_review_queue_pkey PRIMARY KEY (id);


--
-- Name: pricing_performance pricing_performance_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pricing_performance
    ADD CONSTRAINT pricing_performance_pkey PRIMARY KEY (id);


--
-- Name: pricing_results pricing_results_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pricing_results
    ADD CONSTRAINT pricing_results_pkey PRIMARY KEY (id);


--
-- Name: processing_status processing_status_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.processing_status
    ADD CONSTRAINT processing_status_pkey PRIMARY KEY (id);


--
-- Name: product_baselines product_baselines_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_baselines
    ADD CONSTRAINT product_baselines_pkey PRIMARY KEY (id);


--
-- Name: profiles profiles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.profiles
    ADD CONSTRAINT profiles_pkey PRIMARY KEY (id);


--
-- Name: user_roles user_roles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_roles
    ADD CONSTRAINT user_roles_pkey PRIMARY KEY (id);


--
-- Name: user_roles user_roles_user_id_role_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_roles
    ADD CONSTRAINT user_roles_user_id_role_key UNIQUE (user_id, role);


--
-- Name: idx_ai_cache_expires; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ai_cache_expires ON public.ai_validation_cache USING btree (expires_at);


--
-- Name: idx_ai_cache_hash; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ai_cache_hash ON public.ai_validation_cache USING btree (product_pair_hash);


--
-- Name: idx_ai_cache_merchant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ai_cache_merchant ON public.ai_validation_cache USING btree (merchant_id);


--
-- Name: idx_competitor_prices_baseline; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_competitor_prices_baseline ON public.competitor_prices USING btree (baseline_id);


--
-- Name: idx_competitor_products_baseline_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_competitor_products_baseline_id ON public.competitor_products USING btree (baseline_id);


--
-- Name: idx_competitor_products_marketplace; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_competitor_products_marketplace ON public.competitor_products USING btree (marketplace);


--
-- Name: idx_competitor_products_merchant_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_competitor_products_merchant_id ON public.competitor_products USING btree (merchant_id);


--
-- Name: idx_competitor_products_similarity_score; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_competitor_products_similarity_score ON public.competitor_products USING btree (similarity_score DESC);


--
-- Name: idx_email_verifications_code; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_email_verifications_code ON public.email_verifications USING btree (code_hash);


--
-- Name: idx_email_verifications_expires; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_email_verifications_expires ON public.email_verifications USING btree (expires_at);


--
-- Name: idx_email_verifications_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_email_verifications_user ON public.email_verifications USING btree (user_id);


--
-- Name: idx_manual_review_merchant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_manual_review_merchant ON public.manual_review_queue USING btree (merchant_id);


--
-- Name: idx_manual_review_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_manual_review_status ON public.manual_review_queue USING btree (status);


--
-- Name: idx_pricing_performance_baseline; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pricing_performance_baseline ON public.pricing_performance USING btree (baseline_id);


--
-- Name: idx_pricing_performance_merchant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pricing_performance_merchant ON public.pricing_performance USING btree (merchant_id);


--
-- Name: idx_pricing_results_baseline; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pricing_results_baseline ON public.pricing_results USING btree (baseline_id);


--
-- Name: idx_processing_status_baseline; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_processing_status_baseline ON public.processing_status USING btree (baseline_id);


--
-- Name: idx_product_baselines_deleted_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_product_baselines_deleted_at ON public.product_baselines USING btree (deleted_at);


--
-- Name: idx_product_baselines_merchant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_product_baselines_merchant ON public.product_baselines USING btree (merchant_id);


--
-- Name: idx_user_roles_role; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_roles_role ON public.user_roles USING btree (role);


--
-- Name: idx_user_roles_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_roles_user_id ON public.user_roles USING btree (user_id);


--
-- Name: baseline_shares baseline_shares_baseline_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.baseline_shares
    ADD CONSTRAINT baseline_shares_baseline_id_fkey FOREIGN KEY (baseline_id) REFERENCES public.product_baselines(id) ON DELETE CASCADE;


--
-- Name: competitor_prices competitor_prices_baseline_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.competitor_prices
    ADD CONSTRAINT competitor_prices_baseline_id_fkey FOREIGN KEY (baseline_id) REFERENCES public.product_baselines(id) ON DELETE CASCADE;


--
-- Name: email_verifications email_verifications_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_verifications
    ADD CONSTRAINT email_verifications_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: manual_review_queue manual_review_queue_baseline_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.manual_review_queue
    ADD CONSTRAINT manual_review_queue_baseline_id_fkey FOREIGN KEY (baseline_id) REFERENCES public.product_baselines(id) ON DELETE CASCADE;


--
-- Name: pricing_performance pricing_performance_baseline_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pricing_performance
    ADD CONSTRAINT pricing_performance_baseline_id_fkey FOREIGN KEY (baseline_id) REFERENCES public.product_baselines(id) ON DELETE CASCADE;


--
-- Name: pricing_results pricing_results_baseline_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pricing_results
    ADD CONSTRAINT pricing_results_baseline_id_fkey FOREIGN KEY (baseline_id) REFERENCES public.product_baselines(id) ON DELETE CASCADE;


--
-- Name: processing_status processing_status_baseline_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.processing_status
    ADD CONSTRAINT processing_status_baseline_id_fkey FOREIGN KEY (baseline_id) REFERENCES public.product_baselines(id) ON DELETE CASCADE;


--
-- Name: profiles profiles_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.profiles
    ADD CONSTRAINT profiles_id_fkey FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: user_roles user_roles_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_roles
    ADD CONSTRAINT user_roles_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: user_roles Admins can delete roles; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can delete roles" ON public.user_roles FOR DELETE USING (public.has_role(auth.uid(), 'admin'::public.app_role));


--
-- Name: user_roles Admins can insert roles; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can insert roles" ON public.user_roles FOR INSERT WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));


--
-- Name: manual_review_queue Admins can update review items; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can update review items" ON public.manual_review_queue FOR UPDATE USING (public.has_role(auth.uid(), 'admin'::public.app_role));


--
-- Name: user_roles Admins can update roles; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can update roles" ON public.user_roles FOR UPDATE USING (public.has_role(auth.uid(), 'admin'::public.app_role));


--
-- Name: manual_review_queue Admins can view all review queues; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can view all review queues" ON public.manual_review_queue FOR SELECT USING (public.has_role(auth.uid(), 'admin'::public.app_role));


--
-- Name: user_roles Admins can view all roles; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can view all roles" ON public.user_roles FOR SELECT USING (public.has_role(auth.uid(), 'admin'::public.app_role));


--
-- Name: inflation_snapshots Authenticated users can create inflation snapshots; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Authenticated users can create inflation snapshots" ON public.inflation_snapshots FOR INSERT TO authenticated WITH CHECK (true);


--
-- Name: inflation_snapshots Authenticated users can view inflation snapshots; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Authenticated users can view inflation snapshots" ON public.inflation_snapshots FOR SELECT TO authenticated USING (true);


--
-- Name: baseline_shares Baseline owners can share their baselines; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Baseline owners can share their baselines" ON public.baseline_shares FOR INSERT TO authenticated WITH CHECK ((EXISTS ( SELECT 1
   FROM public.product_baselines
  WHERE ((product_baselines.id = baseline_shares.baseline_id) AND (product_baselines.merchant_id = auth.uid())))));


--
-- Name: competitor_prices Users can create competitor prices for their baselines; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can create competitor prices for their baselines" ON public.competitor_prices FOR INSERT TO authenticated WITH CHECK ((auth.uid() = merchant_id));


--
-- Name: competitor_products Users can create competitor products for their baselines; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can create competitor products for their baselines" ON public.competitor_products FOR INSERT WITH CHECK ((auth.uid() = merchant_id));


--
-- Name: processing_status Users can create processing status for their baselines; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can create processing status for their baselines" ON public.processing_status FOR INSERT TO authenticated WITH CHECK ((EXISTS ( SELECT 1
   FROM public.product_baselines
  WHERE ((product_baselines.id = processing_status.baseline_id) AND (product_baselines.merchant_id = auth.uid())))));


--
-- Name: ai_validation_cache Users can create their own cache entries; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can create their own cache entries" ON public.ai_validation_cache FOR INSERT WITH CHECK ((auth.uid() = merchant_id));


--
-- Name: pricing_results Users can create their own pricing results; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can create their own pricing results" ON public.pricing_results FOR INSERT TO authenticated WITH CHECK ((auth.uid() = merchant_id));


--
-- Name: product_baselines Users can create their own product baselines; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can create their own product baselines" ON public.product_baselines FOR INSERT TO authenticated WITH CHECK ((auth.uid() = merchant_id));


--
-- Name: manual_review_queue Users can create their own review items; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can create their own review items" ON public.manual_review_queue FOR INSERT WITH CHECK ((auth.uid() = merchant_id));


--
-- Name: competitor_prices Users can delete competitor prices for their baselines; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can delete competitor prices for their baselines" ON public.competitor_prices FOR DELETE TO authenticated USING ((auth.uid() = merchant_id));


--
-- Name: competitor_products Users can delete competitor products for their baselines; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can delete competitor products for their baselines" ON public.competitor_products FOR DELETE USING ((auth.uid() = merchant_id));


--
-- Name: baseline_shares Users can delete shares they created; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can delete shares they created" ON public.baseline_shares FOR DELETE TO authenticated USING ((auth.uid() = shared_by_user_id));


--
-- Name: pricing_results Users can delete their own pricing results; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can delete their own pricing results" ON public.pricing_results FOR DELETE TO authenticated USING ((auth.uid() = merchant_id));


--
-- Name: product_baselines Users can delete their own product baselines; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can delete their own product baselines" ON public.product_baselines FOR DELETE TO authenticated USING ((auth.uid() = merchant_id));


--
-- Name: pricing_performance Users can insert their own performance data; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can insert their own performance data" ON public.pricing_performance FOR INSERT WITH CHECK ((auth.uid() = merchant_id));


--
-- Name: profiles Users can insert their own profile; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can insert their own profile" ON public.profiles FOR INSERT WITH CHECK ((auth.uid() = id));


--
-- Name: email_verifications Users can insert their own verifications; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can insert their own verifications" ON public.email_verifications FOR INSERT WITH CHECK ((auth.uid() = user_id));


--
-- Name: competitor_prices Users can update competitor prices for their baselines; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can update competitor prices for their baselines" ON public.competitor_prices FOR UPDATE TO authenticated USING ((auth.uid() = merchant_id));


--
-- Name: competitor_products Users can update competitor products for their baselines; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can update competitor products for their baselines" ON public.competitor_products FOR UPDATE USING ((auth.uid() = merchant_id));


--
-- Name: processing_status Users can update processing status for their baselines; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can update processing status for their baselines" ON public.processing_status FOR UPDATE TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.product_baselines
  WHERE ((product_baselines.id = processing_status.baseline_id) AND (product_baselines.merchant_id = auth.uid())))));


--
-- Name: ai_validation_cache Users can update their own cache entries; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can update their own cache entries" ON public.ai_validation_cache FOR UPDATE USING ((auth.uid() = merchant_id));


--
-- Name: pricing_performance Users can update their own performance data; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can update their own performance data" ON public.pricing_performance FOR UPDATE USING ((auth.uid() = merchant_id));


--
-- Name: pricing_results Users can update their own pricing results; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can update their own pricing results" ON public.pricing_results FOR UPDATE TO authenticated USING ((auth.uid() = merchant_id));


--
-- Name: product_baselines Users can update their own product baselines; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can update their own product baselines" ON public.product_baselines FOR UPDATE TO authenticated USING ((auth.uid() = merchant_id));


--
-- Name: profiles Users can update their own profile; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can update their own profile" ON public.profiles FOR UPDATE USING ((auth.uid() = id));


--
-- Name: email_verifications Users can update their own verifications; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can update their own verifications" ON public.email_verifications FOR UPDATE USING ((auth.uid() = user_id));


--
-- Name: competitor_prices Users can view competitor prices for their or shared baselines; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can view competitor prices for their or shared baselines" ON public.competitor_prices FOR SELECT TO authenticated USING (((auth.uid() = merchant_id) OR (EXISTS ( SELECT 1
   FROM public.baseline_shares
  WHERE ((baseline_shares.baseline_id = competitor_prices.baseline_id) AND (baseline_shares.shared_with_user_id = auth.uid()))))));


--
-- Name: competitor_products Users can view competitor products for their or shared baseline; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can view competitor products for their or shared baseline" ON public.competitor_products FOR SELECT USING (((auth.uid() = merchant_id) OR (EXISTS ( SELECT 1
   FROM public.baseline_shares
  WHERE ((baseline_shares.baseline_id = competitor_products.baseline_id) AND (baseline_shares.shared_with_user_id = auth.uid()))))));


--
-- Name: baseline_shares Users can view their baseline shares; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can view their baseline shares" ON public.baseline_shares FOR SELECT TO authenticated USING (((auth.uid() = shared_with_user_id) OR (auth.uid() = shared_by_user_id)));


--
-- Name: ai_validation_cache Users can view their own cache entries; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can view their own cache entries" ON public.ai_validation_cache FOR SELECT USING ((auth.uid() = merchant_id));


--
-- Name: pricing_results Users can view their own or shared pricing results; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can view their own or shared pricing results" ON public.pricing_results FOR SELECT TO authenticated USING (((auth.uid() = merchant_id) OR (EXISTS ( SELECT 1
   FROM public.baseline_shares
  WHERE ((baseline_shares.baseline_id = pricing_results.baseline_id) AND (baseline_shares.shared_with_user_id = auth.uid()))))));


--
-- Name: processing_status Users can view their own or shared processing status; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can view their own or shared processing status" ON public.processing_status FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.product_baselines pb
  WHERE ((pb.id = processing_status.baseline_id) AND ((pb.merchant_id = auth.uid()) OR (EXISTS ( SELECT 1
           FROM public.baseline_shares
          WHERE ((baseline_shares.baseline_id = pb.id) AND (baseline_shares.shared_with_user_id = auth.uid())))))))));


--
-- Name: product_baselines Users can view their own or shared product baselines; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can view their own or shared product baselines" ON public.product_baselines FOR SELECT TO authenticated USING (((auth.uid() = merchant_id) OR (EXISTS ( SELECT 1
   FROM public.baseline_shares
  WHERE ((baseline_shares.baseline_id = product_baselines.id) AND (baseline_shares.shared_with_user_id = auth.uid()))))));


--
-- Name: pricing_performance Users can view their own performance data; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can view their own performance data" ON public.pricing_performance FOR SELECT USING ((auth.uid() = merchant_id));


--
-- Name: profiles Users can view their own profile; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can view their own profile" ON public.profiles FOR SELECT USING ((auth.uid() = id));


--
-- Name: manual_review_queue Users can view their own review queue; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can view their own review queue" ON public.manual_review_queue FOR SELECT USING ((auth.uid() = merchant_id));


--
-- Name: user_roles Users can view their own roles; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can view their own roles" ON public.user_roles FOR SELECT USING ((auth.uid() = user_id));


--
-- Name: email_verifications Users can view their own verifications; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can view their own verifications" ON public.email_verifications FOR SELECT USING ((auth.uid() = user_id));


--
-- Name: ai_validation_cache; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.ai_validation_cache ENABLE ROW LEVEL SECURITY;

--
-- Name: baseline_shares; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.baseline_shares ENABLE ROW LEVEL SECURITY;

--
-- Name: competitor_prices; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.competitor_prices ENABLE ROW LEVEL SECURITY;

--
-- Name: competitor_products; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.competitor_products ENABLE ROW LEVEL SECURITY;

--
-- Name: email_verifications; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.email_verifications ENABLE ROW LEVEL SECURITY;

--
-- Name: inflation_snapshots; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.inflation_snapshots ENABLE ROW LEVEL SECURITY;

--
-- Name: manual_review_queue; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.manual_review_queue ENABLE ROW LEVEL SECURITY;

--
-- Name: pricing_performance; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.pricing_performance ENABLE ROW LEVEL SECURITY;

--
-- Name: pricing_results; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.pricing_results ENABLE ROW LEVEL SECURITY;

--
-- Name: processing_status; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.processing_status ENABLE ROW LEVEL SECURITY;

--
-- Name: product_baselines; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.product_baselines ENABLE ROW LEVEL SECURITY;

--
-- Name: profiles; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

--
-- Name: user_roles; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

--
-- PostgreSQL database dump complete
--


