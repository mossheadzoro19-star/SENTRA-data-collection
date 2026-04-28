-- ==========================================
-- USERS TABLE SETUP
-- ==========================================
-- 1. Create the `users` table
CREATE TABLE public.users (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    username TEXT UNIQUE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;

-- Allow anonymous inserts (since we use "username only" auth)
CREATE POLICY "Allow anonymous inserts to users" 
ON public.users FOR INSERT 
TO public 
WITH CHECK (true);

-- Allow public read access to verify if username exists
CREATE POLICY "Allow public to read users" 
ON public.users FOR SELECT 
TO public 
USING (true);
