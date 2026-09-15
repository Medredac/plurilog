-- Migration: 20260915_add_identity_columns_to_tables.sql
-- Description: Additive identity columns (user_id, display_name, email) to physical tables,
-- backfilling existing rows, and adding triggers for automatic population on insert and update.

BEGIN;

-- ============================================================================
-- PHASE 1: ADD COLUMNS (IF NOT EXISTS)
-- ============================================================================

-- 1. discussions (existing user_id stays untouched)
ALTER TABLE public.discussions
  ADD COLUMN IF NOT EXISTS display_name text,
  ADD COLUMN IF NOT EXISTS email text;

-- 2. messages
ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS user_id uuid,
  ADD COLUMN IF NOT EXISTS display_name text,
  ADD COLUMN IF NOT EXISTS email text;

-- 3. discussion_memory_chunks
ALTER TABLE public.discussion_memory_chunks
  ADD COLUMN IF NOT EXISTS user_id uuid,
  ADD COLUMN IF NOT EXISTS display_name text,
  ADD COLUMN IF NOT EXISTS email text;

-- 4. discussion_documents
ALTER TABLE public.discussion_documents
  ADD COLUMN IF NOT EXISTS user_id uuid,
  ADD COLUMN IF NOT EXISTS display_name text,
  ADD COLUMN IF NOT EXISTS email text;

-- 5. discussion_document_sources
ALTER TABLE public.discussion_document_sources
  ADD COLUMN IF NOT EXISTS user_id uuid,
  ADD COLUMN IF NOT EXISTS display_name text,
  ADD COLUMN IF NOT EXISTS email text;

-- 6. discussion_document_chunks
ALTER TABLE public.discussion_document_chunks
  ADD COLUMN IF NOT EXISTS user_id uuid,
  ADD COLUMN IF NOT EXISTS display_name text,
  ADD COLUMN IF NOT EXISTS email text;

-- 7. discussion_artifacts
ALTER TABLE public.discussion_artifacts
  ADD COLUMN IF NOT EXISTS user_id uuid,
  ADD COLUMN IF NOT EXISTS display_name text,
  ADD COLUMN IF NOT EXISTS email text;

-- 8. discussion_artifact_sources
ALTER TABLE public.discussion_artifact_sources
  ADD COLUMN IF NOT EXISTS user_id uuid,
  ADD COLUMN IF NOT EXISTS display_name text,
  ADD COLUMN IF NOT EXISTS email text;

-- 9. discussion_artifact_descriptors
ALTER TABLE public.discussion_artifact_descriptors
  ADD COLUMN IF NOT EXISTS user_id uuid,
  ADD COLUMN IF NOT EXISTS display_name text,
  ADD COLUMN IF NOT EXISTS email text;

-- 10. message_visual_evidence
ALTER TABLE public.message_visual_evidence
  ADD COLUMN IF NOT EXISTS user_id uuid,
  ADD COLUMN IF NOT EXISTS display_name text,
  ADD COLUMN IF NOT EXISTS email text;

-- 11. spend_events (existing user_id stays untouched)
ALTER TABLE public.spend_events
  ADD COLUMN IF NOT EXISTS display_name text,
  ADD COLUMN IF NOT EXISTS email text;


-- ============================================================================
-- PHASE 2: BACKFILL EXISTING ROWS
-- ============================================================================

-- Discussions: backfill display_name and email using existing user_id
UPDATE public.discussions d
SET
  display_name = COALESCE(
    u.raw_user_meta_data->>'display_name',
    u.raw_user_meta_data->>'full_name',
    u.raw_user_meta_data->>'name',
    'User'
  ),
  email = u.email
FROM auth.users u
WHERE d.user_id = u.id;

-- Spend Events: backfill display_name and email using existing user_id
UPDATE public.spend_events s
SET
  display_name = COALESCE(
    u.raw_user_meta_data->>'display_name',
    u.raw_user_meta_data->>'full_name',
    u.raw_user_meta_data->>'name',
    'User'
  ),
  email = u.email
FROM auth.users u
WHERE s.user_id = u.id;

-- Messages: backfill user_id, display_name, email via discussions
UPDATE public.messages m
SET
  user_id = d.user_id,
  display_name = COALESCE(
    u.raw_user_meta_data->>'display_name',
    u.raw_user_meta_data->>'full_name',
    u.raw_user_meta_data->>'name',
    'User'
  ),
  email = u.email
FROM public.discussions d
JOIN auth.users u ON d.user_id = u.id
WHERE m.discussion_id = d.id;

-- Discussion Memory Chunks: backfill user_id, display_name, email via discussions
UPDATE public.discussion_memory_chunks dmc
SET
  user_id = d.user_id,
  display_name = COALESCE(
    u.raw_user_meta_data->>'display_name',
    u.raw_user_meta_data->>'full_name',
    u.raw_user_meta_data->>'name',
    'User'
  ),
  email = u.email
FROM public.discussions d
JOIN auth.users u ON d.user_id = u.id
WHERE dmc.discussion_id = d.id;

-- Discussion Documents: backfill user_id, display_name, email via discussions
UPDATE public.discussion_documents dd
SET
  user_id = d.user_id,
  display_name = COALESCE(
    u.raw_user_meta_data->>'display_name',
    u.raw_user_meta_data->>'full_name',
    u.raw_user_meta_data->>'name',
    'User'
  ),
  email = u.email
FROM public.discussions d
JOIN auth.users u ON d.user_id = u.id
WHERE dd.discussion_id = d.id;

-- Discussion Document Sources: backfill user_id, display_name, email via discussions
UPDATE public.discussion_document_sources dds
SET
  user_id = d.user_id,
  display_name = COALESCE(
    u.raw_user_meta_data->>'display_name',
    u.raw_user_meta_data->>'full_name',
    u.raw_user_meta_data->>'name',
    'User'
  ),
  email = u.email
FROM public.discussions d
JOIN auth.users u ON d.user_id = u.id
WHERE dds.discussion_id = d.id;

-- Discussion Document Chunks: backfill user_id, display_name, email via discussions
UPDATE public.discussion_document_chunks ddc
SET
  user_id = d.user_id,
  display_name = COALESCE(
    u.raw_user_meta_data->>'display_name',
    u.raw_user_meta_data->>'full_name',
    u.raw_user_meta_data->>'name',
    'User'
  ),
  email = u.email
FROM public.discussions d
JOIN auth.users u ON d.user_id = u.id
WHERE ddc.discussion_id = d.id;

-- Discussion Artifacts: backfill user_id, display_name, email via discussions
UPDATE public.discussion_artifacts da
SET
  user_id = d.user_id,
  display_name = COALESCE(
    u.raw_user_meta_data->>'display_name',
    u.raw_user_meta_data->>'full_name',
    u.raw_user_meta_data->>'name',
    'User'
  ),
  email = u.email
FROM public.discussions d
JOIN auth.users u ON d.user_id = u.id
WHERE da.discussion_id = d.id;

-- Discussion Artifact Sources: backfill user_id, display_name, email via discussions
UPDATE public.discussion_artifact_sources das
SET
  user_id = d.user_id,
  display_name = COALESCE(
    u.raw_user_meta_data->>'display_name',
    u.raw_user_meta_data->>'full_name',
    u.raw_user_meta_data->>'name',
    'User'
  ),
  email = u.email
FROM public.discussions d
JOIN auth.users u ON d.user_id = u.id
WHERE das.discussion_id = d.id;

-- Discussion Artifact Descriptors: backfill user_id, display_name, email via discussion_artifacts -> discussions
UPDATE public.discussion_artifact_descriptors dad
SET
  user_id = d.user_id,
  display_name = COALESCE(
    u.raw_user_meta_data->>'display_name',
    u.raw_user_meta_data->>'full_name',
    u.raw_user_meta_data->>'name',
    'User'
  ),
  email = u.email
FROM public.discussion_artifacts da
JOIN public.discussions d ON da.discussion_id = d.id
JOIN auth.users u ON d.user_id = u.id
WHERE dad.artifact_id = da.id;

-- Message Visual Evidence: backfill user_id, display_name, email via discussions
UPDATE public.message_visual_evidence mve
SET
  user_id = d.user_id,
  display_name = COALESCE(
    u.raw_user_meta_data->>'display_name',
    u.raw_user_meta_data->>'full_name',
    u.raw_user_meta_data->>'name',
    'User'
  ),
  email = u.email
FROM public.discussions d
JOIN auth.users u ON d.user_id = u.id
WHERE mve.discussion_id = d.id;


-- ============================================================================
-- PHASE 3: FUTURE INSERTS (BEFORE INSERT TRIGGERS)
-- ============================================================================

-- Function: Populate identity for discussions
CREATE FUNCTION public.trg_populate_discussion_identity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  v_display_name text;
  v_email text;
BEGIN
  IF NEW.user_id IS NOT NULL THEN
    SELECT
      COALESCE(
        raw_user_meta_data->>'display_name',
        raw_user_meta_data->>'full_name',
        raw_user_meta_data->>'name',
        'User'
      ),
      email
    INTO v_display_name, v_email
    FROM auth.users
    WHERE id = NEW.user_id;

    NEW.display_name := v_display_name;
    NEW.email := v_email;
  END IF;
  RETURN NEW;
END;
$$;

-- Function: Populate identity for spend_events
CREATE FUNCTION public.trg_populate_spend_event_identity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  v_display_name text;
  v_email text;
BEGIN
  IF NEW.user_id IS NOT NULL THEN
    SELECT
      COALESCE(
        raw_user_meta_data->>'display_name',
        raw_user_meta_data->>'full_name',
        raw_user_meta_data->>'name',
        'User'
      ),
      email
    INTO v_display_name, v_email
    FROM auth.users
    WHERE id = NEW.user_id;

    NEW.display_name := v_display_name;
    NEW.email := v_email;
  END IF;
  RETURN NEW;
END;
$$;

-- Function: Populate identity for discussion-child tables (derives user_id from discussion_id)
CREATE FUNCTION public.trg_populate_discussion_child_identity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  v_user_id uuid;
  v_display_name text;
  v_email text;
BEGIN
  IF NEW.discussion_id IS NOT NULL THEN
    SELECT d.user_id INTO v_user_id
    FROM public.discussions d
    WHERE d.id = NEW.discussion_id;

    IF v_user_id IS NOT NULL THEN
      NEW.user_id := v_user_id;

      SELECT
        COALESCE(
          raw_user_meta_data->>'display_name',
          raw_user_meta_data->>'full_name',
          raw_user_meta_data->>'name',
          'User'
        ),
        email
      INTO v_display_name, v_email
      FROM auth.users
      WHERE id = v_user_id;

      NEW.display_name := v_display_name;
      NEW.email := v_email;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

-- Function: Populate identity for discussion_artifact_descriptors (derives user_id from artifact_id)
CREATE FUNCTION public.trg_populate_artifact_descriptor_identity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  v_user_id uuid;
  v_display_name text;
  v_email text;
BEGIN
  IF NEW.artifact_id IS NOT NULL THEN
    SELECT d.user_id INTO v_user_id
    FROM public.discussion_artifacts da
    JOIN public.discussions d ON da.discussion_id = d.id
    WHERE da.id = NEW.artifact_id;

    IF v_user_id IS NOT NULL THEN
      NEW.user_id := v_user_id;

      SELECT
        COALESCE(
          raw_user_meta_data->>'display_name',
          raw_user_meta_data->>'full_name',
          raw_user_meta_data->>'name',
          'User'
        ),
        email
      INTO v_display_name, v_email
      FROM auth.users
      WHERE id = v_user_id;

      NEW.display_name := v_display_name;
      NEW.email := v_email;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

-- Attach BEFORE INSERT triggers
CREATE TRIGGER trg_discussions_identity
BEFORE INSERT ON public.discussions
FOR EACH ROW
EXECUTE FUNCTION public.trg_populate_discussion_identity();

CREATE TRIGGER trg_spend_events_identity
BEFORE INSERT ON public.spend_events
FOR EACH ROW
EXECUTE FUNCTION public.trg_populate_spend_event_identity();

CREATE TRIGGER trg_messages_identity
BEFORE INSERT ON public.messages
FOR EACH ROW
EXECUTE FUNCTION public.trg_populate_discussion_child_identity();

CREATE TRIGGER trg_discussion_memory_chunks_identity
BEFORE INSERT ON public.discussion_memory_chunks
FOR EACH ROW
EXECUTE FUNCTION public.trg_populate_discussion_child_identity();

CREATE TRIGGER trg_discussion_documents_identity
BEFORE INSERT ON public.discussion_documents
FOR EACH ROW
EXECUTE FUNCTION public.trg_populate_discussion_child_identity();

CREATE TRIGGER trg_discussion_document_sources_identity
BEFORE INSERT ON public.discussion_document_sources
FOR EACH ROW
EXECUTE FUNCTION public.trg_populate_discussion_child_identity();

CREATE TRIGGER trg_discussion_document_chunks_identity
BEFORE INSERT ON public.discussion_document_chunks
FOR EACH ROW
EXECUTE FUNCTION public.trg_populate_discussion_child_identity();

CREATE TRIGGER trg_discussion_artifacts_identity
BEFORE INSERT ON public.discussion_artifacts
FOR EACH ROW
EXECUTE FUNCTION public.trg_populate_discussion_child_identity();

CREATE TRIGGER trg_discussion_artifact_sources_identity
BEFORE INSERT ON public.discussion_artifact_sources
FOR EACH ROW
EXECUTE FUNCTION public.trg_populate_discussion_child_identity();

CREATE TRIGGER trg_message_visual_evidence_identity
BEFORE INSERT ON public.message_visual_evidence
FOR EACH ROW
EXECUTE FUNCTION public.trg_populate_discussion_child_identity();

CREATE TRIGGER trg_discussion_artifact_descriptors_identity
BEFORE INSERT ON public.discussion_artifact_descriptors
FOR EACH ROW
EXECUTE FUNCTION public.trg_populate_artifact_descriptor_identity();


-- ============================================================================
-- PHASE 4: NAME / EMAIL CHANGES (AFTER UPDATE ON auth.users)
-- ============================================================================

CREATE FUNCTION public.trg_sync_user_identity_changes()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  v_new_display_name text;
  v_new_email text;
BEGIN
  v_new_display_name := COALESCE(
    NEW.raw_user_meta_data->>'display_name',
    NEW.raw_user_meta_data->>'full_name',
    NEW.raw_user_meta_data->>'name',
    'User'
  );
  v_new_email := NEW.email;

  -- Only propagate if display_name or email actually changed
  IF (OLD.email IS DISTINCT FROM NEW.email) OR
     (COALESCE(OLD.raw_user_meta_data->>'display_name', OLD.raw_user_meta_data->>'full_name', OLD.raw_user_meta_data->>'name', 'User') IS DISTINCT FROM v_new_display_name) THEN

    UPDATE public.discussions
    SET display_name = v_new_display_name, email = v_new_email
    WHERE user_id = NEW.id;

    UPDATE public.spend_events
    SET display_name = v_new_display_name, email = v_new_email
    WHERE user_id = NEW.id;

    UPDATE public.messages
    SET display_name = v_new_display_name, email = v_new_email
    WHERE user_id = NEW.id;

    UPDATE public.discussion_memory_chunks
    SET display_name = v_new_display_name, email = v_new_email
    WHERE user_id = NEW.id;

    UPDATE public.discussion_documents
    SET display_name = v_new_display_name, email = v_new_email
    WHERE user_id = NEW.id;

    UPDATE public.discussion_document_sources
    SET display_name = v_new_display_name, email = v_new_email
    WHERE user_id = NEW.id;

    UPDATE public.discussion_document_chunks
    SET display_name = v_new_display_name, email = v_new_email
    WHERE user_id = NEW.id;

    UPDATE public.discussion_artifacts
    SET display_name = v_new_display_name, email = v_new_email
    WHERE user_id = NEW.id;

    UPDATE public.discussion_artifact_sources
    SET display_name = v_new_display_name, email = v_new_email
    WHERE user_id = NEW.id;

    UPDATE public.discussion_artifact_descriptors
    SET display_name = v_new_display_name, email = v_new_email
    WHERE user_id = NEW.id;

    UPDATE public.message_visual_evidence
    SET display_name = v_new_display_name, email = v_new_email
    WHERE user_id = NEW.id;

  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_sync_user_identity_on_auth_user_update
AFTER UPDATE OF email, raw_user_meta_data ON auth.users
FOR EACH ROW
EXECUTE FUNCTION public.trg_sync_user_identity_changes();

COMMIT;
