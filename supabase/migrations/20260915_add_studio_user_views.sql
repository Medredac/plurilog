-- ==============================================================================
-- Migration: Add Supabase Studio helper views with user identity
-- Purpose: Provide instant visibility of user_id, user_name, and user_email
--          at the front of user-linked tables for Supabase Studio inspection.
-- ==============================================================================

-- 1. discussions_with_user
CREATE OR REPLACE VIEW public.discussions_with_user AS
SELECT
  d.user_id,
  COALESCE(
    u.raw_user_meta_data->>'display_name',
    u.raw_user_meta_data->>'full_name',
    u.raw_user_meta_data->>'name',
    'User'
  ) AS user_name,
  u.email AS user_email,
  d.id AS discussion_id,
  d.title,
  d.summary,
  d.created_at,
  d.updated_at
FROM public.discussions d
LEFT JOIN auth.users u ON u.id = d.user_id;

-- 2. messages_with_user
CREATE OR REPLACE VIEW public.messages_with_user AS
SELECT
  d.user_id,
  COALESCE(
    u.raw_user_meta_data->>'display_name',
    u.raw_user_meta_data->>'full_name',
    u.raw_user_meta_data->>'name',
    'User'
  ) AS user_name,
  u.email AS user_email,
  m.id AS message_id,
  m.discussion_id,
  d.title AS discussion_title,
  m.sender,
  m.content,
  m.image_url,
  m.attachment_urls,
  m.visual_document_id,
  m.created_at
FROM public.messages m
LEFT JOIN public.discussions d ON d.id = m.discussion_id
LEFT JOIN auth.users u ON u.id = d.user_id;

-- 3. discussion_memory_chunks_with_user
CREATE OR REPLACE VIEW public.discussion_memory_chunks_with_user AS
SELECT
  d.user_id,
  COALESCE(
    u.raw_user_meta_data->>'display_name',
    u.raw_user_meta_data->>'full_name',
    u.raw_user_meta_data->>'name',
    'User'
  ) AS user_name,
  u.email AS user_email,
  mc.id AS chunk_id,
  mc.discussion_id,
  d.title AS discussion_title,
  mc.source_user_message_id,
  mc.content,
  mc.created_at
FROM public.discussion_memory_chunks mc
LEFT JOIN public.discussions d ON d.id = mc.discussion_id
LEFT JOIN auth.users u ON u.id = d.user_id;

-- 4. discussion_documents_with_user
CREATE OR REPLACE VIEW public.discussion_documents_with_user AS
SELECT
  d.user_id,
  COALESCE(
    u.raw_user_meta_data->>'display_name',
    u.raw_user_meta_data->>'full_name',
    u.raw_user_meta_data->>'name',
    'User'
  ) AS user_name,
  u.email AS user_email,
  doc.id AS document_id,
  doc.discussion_id,
  d.title AS discussion_title,
  doc.filename,
  doc.storage_path,
  doc.file_hash,
  doc.full_text,
  doc.created_at
FROM public.discussion_documents doc
LEFT JOIN public.discussions d ON d.id = doc.discussion_id
LEFT JOIN auth.users u ON u.id = d.user_id;

-- 5. discussion_document_sources_with_user
CREATE OR REPLACE VIEW public.discussion_document_sources_with_user AS
SELECT
  d.user_id,
  COALESCE(
    u.raw_user_meta_data->>'display_name',
    u.raw_user_meta_data->>'full_name',
    u.raw_user_meta_data->>'name',
    'User'
  ) AS user_name,
  u.email AS user_email,
  ds.id AS source_id,
  ds.discussion_id,
  ds.document_id,
  d.title AS discussion_title,
  ds.filename,
  ds.storage_path,
  ds.created_at
FROM public.discussion_document_sources ds
LEFT JOIN public.discussions d ON d.id = ds.discussion_id
LEFT JOIN auth.users u ON u.id = d.user_id;

-- 6. discussion_document_chunks_with_user
CREATE OR REPLACE VIEW public.discussion_document_chunks_with_user AS
SELECT
  d.user_id,
  COALESCE(
    u.raw_user_meta_data->>'display_name',
    u.raw_user_meta_data->>'full_name',
    u.raw_user_meta_data->>'name',
    'User'
  ) AS user_name,
  u.email AS user_email,
  dc.id AS chunk_id,
  dc.discussion_id,
  dc.document_id,
  d.title AS discussion_title,
  dc.chunk_index,
  dc.content,
  dc.created_at
FROM public.discussion_document_chunks dc
LEFT JOIN public.discussions d ON d.id = dc.discussion_id
LEFT JOIN auth.users u ON u.id = d.user_id;

-- 7. discussion_artifacts_with_user
CREATE OR REPLACE VIEW public.discussion_artifacts_with_user AS
SELECT
  d.user_id,
  COALESCE(
    u.raw_user_meta_data->>'display_name',
    u.raw_user_meta_data->>'full_name',
    u.raw_user_meta_data->>'name',
    'User'
  ) AS user_name,
  u.email AS user_email,
  da.id AS artifact_id,
  da.discussion_id,
  d.title AS discussion_title,
  da.artifact_type,
  da.file_hash,
  da.byte_size,
  da.metadata,
  da.created_at
FROM public.discussion_artifacts da
LEFT JOIN public.discussions d ON d.id = da.discussion_id
LEFT JOIN auth.users u ON u.id = d.user_id;

-- 8. discussion_artifact_sources_with_user
CREATE OR REPLACE VIEW public.discussion_artifact_sources_with_user AS
SELECT
  d.user_id,
  COALESCE(
    u.raw_user_meta_data->>'display_name',
    u.raw_user_meta_data->>'full_name',
    u.raw_user_meta_data->>'name',
    'User'
  ) AS user_name,
  u.email AS user_email,
  das.id AS source_id,
  das.discussion_id,
  das.artifact_id,
  d.title AS discussion_title,
  das.storage_path,
  das.filename,
  das.source_message_id,
  das.attachment_index,
  das.created_at
FROM public.discussion_artifact_sources das
LEFT JOIN public.discussions d ON d.id = das.discussion_id
LEFT JOIN auth.users u ON u.id = d.user_id;

-- 9. discussion_artifact_descriptors_with_user
CREATE OR REPLACE VIEW public.discussion_artifact_descriptors_with_user AS
SELECT
  d.user_id,
  COALESCE(
    u.raw_user_meta_data->>'display_name',
    u.raw_user_meta_data->>'full_name',
    u.raw_user_meta_data->>'name',
    'User'
  ) AS user_name,
  u.email AS user_email,
  dad.id AS descriptor_id,
  da.discussion_id,
  dad.artifact_id,
  d.title AS discussion_title,
  dad.indexing_status,
  dad.descriptor_model,
  dad.descriptor_version,
  dad.image_type,
  dad.people_count,
  dad.descriptor_json,
  dad.descriptor_text,
  dad.visible_text,
  dad.claimed_at,
  dad.created_at,
  dad.updated_at
FROM public.discussion_artifact_descriptors dad
LEFT JOIN public.discussion_artifacts da ON da.id = dad.artifact_id
LEFT JOIN public.discussions d ON d.id = da.discussion_id
LEFT JOIN auth.users u ON u.id = d.user_id;

-- 10. message_visual_evidence_with_user
CREATE OR REPLACE VIEW public.message_visual_evidence_with_user AS
SELECT
  d.user_id,
  COALESCE(
    u.raw_user_meta_data->>'display_name',
    u.raw_user_meta_data->>'full_name',
    u.raw_user_meta_data->>'name',
    'User'
  ) AS user_name,
  u.email AS user_email,
  mve.id AS evidence_id,
  mve.discussion_id,
  mve.message_id,
  d.title AS discussion_title,
  mve.source_id,
  mve.ordinal,
  mve.created_at
FROM public.message_visual_evidence mve
LEFT JOIN public.discussions d ON d.id = mve.discussion_id
LEFT JOIN auth.users u ON u.id = d.user_id;

-- ==============================================================================
-- Permissions
-- Revoke all privileges from anon and authenticated roles to prevent public or
-- regular user querying via client APIs. Access is preserved for admin/studio roles
-- (postgres, service_role).
-- ==============================================================================

REVOKE ALL ON TABLE public.discussions_with_user FROM anon, authenticated;
REVOKE ALL ON TABLE public.messages_with_user FROM anon, authenticated;
REVOKE ALL ON TABLE public.discussion_memory_chunks_with_user FROM anon, authenticated;
REVOKE ALL ON TABLE public.discussion_documents_with_user FROM anon, authenticated;
REVOKE ALL ON TABLE public.discussion_document_sources_with_user FROM anon, authenticated;
REVOKE ALL ON TABLE public.discussion_document_chunks_with_user FROM anon, authenticated;
REVOKE ALL ON TABLE public.discussion_artifacts_with_user FROM anon, authenticated;
REVOKE ALL ON TABLE public.discussion_artifact_sources_with_user FROM anon, authenticated;
REVOKE ALL ON TABLE public.discussion_artifact_descriptors_with_user FROM anon, authenticated;
REVOKE ALL ON TABLE public.message_visual_evidence_with_user FROM anon, authenticated;



