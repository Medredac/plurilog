-- Migration: 20260920_discussion_visual_context.sql
-- Description: Creates the discussion_visual_context table for persistent visual task and focus state tracking.

BEGIN;

CREATE TABLE IF NOT EXISTS public.discussion_visual_context (
  discussion_id UUID PRIMARY KEY REFERENCES public.discussions(id) ON DELETE CASCADE,
  active_session_source_ids UUID[] NOT NULL DEFAULT '{}',
  focus_source_ids UUID[] NOT NULL DEFAULT '{}',
  user_id UUID,
  display_name TEXT,
  email TEXT,
  version INT NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Enable Row Level Security
ALTER TABLE public.discussion_visual_context ENABLE ROW LEVEL SECURITY;

-- User isolation policy matching repository conventions
CREATE POLICY discussion_visual_context_user_isolation
ON public.discussion_visual_context
FOR ALL
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.discussions d
    WHERE d.id = discussion_visual_context.discussion_id
    AND d.user_id = auth.uid()
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.discussions d
    WHERE d.id = discussion_visual_context.discussion_id
    AND d.user_id = auth.uid()
  )
);

-- Attach standard identity trigger to populate user_id, display_name, email from discussion
CREATE TRIGGER trg_discussion_visual_context_identity
BEFORE INSERT ON public.discussion_visual_context
FOR EACH ROW
EXECUTE FUNCTION public.trg_populate_discussion_child_identity();

COMMIT;
