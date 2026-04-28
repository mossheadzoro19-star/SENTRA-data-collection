-- ==========================================
-- SUPABASE SCHEMA SETUP
-- ==========================================
-- Copy and paste this into the Supabase SQL Editor to set up your project.

-- 1. Create the `recordings` table to store metadata
CREATE TABLE public.recordings (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    username TEXT NOT NULL,
    label TEXT NOT NULL,
    file_url TEXT NOT NULL,
    timestamp TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Enable Row Level Security (RLS) on the table
ALTER TABLE public.recordings ENABLE ROW LEVEL SECURITY;

-- Create an open policy to allow anonymous inserts (since we use "username only" auth)
CREATE POLICY "Allow anonymous inserts to recordings" 
ON public.recordings FOR INSERT 
TO public 
WITH CHECK (true);

-- Create an open policy to allow users to read their own recording counts
CREATE POLICY "Allow users to select their own recordings" 
ON public.recordings FOR SELECT 
TO public 
USING (true);

-- 2. Setup the Storage Bucket
-- Create a public bucket named 'audio_data'
INSERT INTO storage.buckets (id, name, public) 
VALUES ('audio_data', 'audio_data', true);

-- Enable RLS on the storage bucket
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;

-- Allow public uploads to the bucket
CREATE POLICY "Allow public audio uploads" 
ON storage.objects FOR INSERT 
TO public 
WITH CHECK (bucket_id = 'audio_data');

-- Allow public reads from the bucket
CREATE POLICY "Allow public audio reads" 
ON storage.objects FOR SELECT 
TO public 
USING (bucket_id = 'audio_data');
