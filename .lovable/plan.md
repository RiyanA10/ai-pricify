

# Diagnosis: Two Critical Issues Found

## Issue 1: ScrapingBee API Quota Exhausted
The edge function logs show every single scraping call failing with:
```
❌ HTTP 401: {"message":"Monthly API calls limit reached: 1000"}
```
This affects ALL marketplaces (Amazon, Noon, Extra, Jarir, Google Shopping, Google Dorking). The code is working correctly — the ScrapingBee monthly quota of 1000 calls is used up.

**Fix:** You need to either:
- Upgrade your ScrapingBee plan (more API calls)
- Wait for the monthly quota to reset
- Replace the ScrapingBee API key with a new one that has available credits

I cannot fix this through code — it requires updating your ScrapingBee account or API key.

## Issue 2: Processing Page Stuck (Empty Polling)
The frontend at `/processing/8be04c36-...` keeps polling `processing_status` and getting empty `[]` results, even though the record exists in the database with `status: completed`. 

**Root cause:** RLS policies on `processing_status` only allow `authenticated` users to read rows where `product_baselines.merchant_id = auth.uid()`. This baseline has `merchant_id = null` (guest submission), so no user can read its processing status through the client.

**Fix:** Add an RLS policy allowing anyone to read processing_status for guest baselines (where `merchant_id IS NULL`), or allow the service role insert to also handle reads.

## Implementation Plan

### Step 1: Get ScrapingBee working again
You need to update the `SCRAPINGBEE_API_KEY` secret with a key that has available API credits. I will prompt you to enter the new key.

### Step 2: Fix RLS for guest processing status reads
Add a new RLS policy on `processing_status` that allows `anon` role to SELECT rows where the linked `product_baselines.merchant_id IS NULL`. This fixes the stuck processing page for guest users.

### Step 3: Test end-to-end
Submit a new product and verify:
- Processing page shows progress and redirects to results
- Competitor data is fetched from multiple marketplaces

### Files/Resources Modified
- **Database migration**: Add RLS policy for guest access to `processing_status`
- **Secret**: Update `SCRAPINGBEE_API_KEY` if you have a new key

