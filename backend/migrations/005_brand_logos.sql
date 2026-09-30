-- Brand logos stay in private object storage and are served through a bounded
-- public API route. Existing brands retain their current image fallback.
ALTER TABLE brands ADD COLUMN logo_path text;
