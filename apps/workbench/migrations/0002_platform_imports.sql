-- F1：项目修订、原子导入记录、当前原文指针与跨项目约束。
-- 不修改已经应用的0001；历史原文/媒体/风格只追加。
ALTER TABLE projects ADD COLUMN import_revision INTEGER NOT NULL DEFAULT 0
  CHECK (import_revision >= 0 AND import_revision = CAST(import_revision AS INTEGER));

CREATE TABLE import_commits (
 id TEXT PRIMARY KEY NOT NULL,
 project_id TEXT NOT NULL REFERENCES projects(id),
 fingerprint TEXT NOT NULL,
 expected_revision INTEGER NOT NULL,
 revision INTEGER NOT NULL,
 document_ids_json TEXT NOT NULL,
 warnings_json TEXT NOT NULL,
 created_at INTEGER NOT NULL,
 UNIQUE(project_id, fingerprint),
 CHECK(revision = expected_revision + 1)
);
CREATE TRIGGER import_commit_revision BEFORE INSERT ON import_commits
WHEN NOT EXISTS(SELECT 1 FROM projects WHERE id=NEW.project_id AND import_revision=NEW.expected_revision)
BEGIN SELECT RAISE(ABORT, 'revision_conflict'); END;
CREATE TRIGGER import_commit_activate AFTER INSERT ON import_commits
BEGIN UPDATE projects SET import_revision=NEW.revision, updated_at=NEW.created_at WHERE id=NEW.project_id; END;

CREATE TABLE current_documents (
 project_id TEXT NOT NULL REFERENCES projects(id),
 skill TEXT NOT NULL CHECK(skill IN ('novel-outline','novel-characters','novel-art')),
 blob_id TEXT NOT NULL REFERENCES document_blobs(id),
 PRIMARY KEY(project_id,skill)
);
CREATE UNIQUE INDEX characters_project_name ON characters(project_id,name);

CREATE TRIGGER characters_scope_update BEFORE UPDATE ON characters
WHEN NEW.project_id != OLD.project_id
BEGIN SELECT RAISE(ABORT, 'project_scope'); END;

CREATE TRIGGER character_aliases_scope_update BEFORE UPDATE ON character_aliases
WHEN NEW.project_id != OLD.project_id
BEGIN SELECT RAISE(ABORT, 'project_scope'); END;

CREATE TRIGGER scenes_scope_update BEFORE UPDATE ON scenes
WHEN NEW.project_id != OLD.project_id
BEGIN SELECT RAISE(ABORT, 'project_scope'); END;

CREATE TRIGGER props_scope_update BEFORE UPDATE ON props
WHEN NEW.project_id != OLD.project_id
BEGIN SELECT RAISE(ABORT, 'project_scope'); END;

CREATE TRIGGER prop_carriers_scope_update BEFORE UPDATE ON prop_carriers
WHEN NEW.project_id != OLD.project_id
BEGIN SELECT RAISE(ABORT, 'project_scope'); END;

CREATE TRIGGER prop_scene_links_scope_update BEFORE UPDATE ON prop_scene_links
WHEN NEW.project_id != OLD.project_id
BEGIN SELECT RAISE(ABORT, 'project_scope'); END;

CREATE TRIGGER beats_scope_update BEFORE UPDATE ON beats
WHEN NEW.project_id != OLD.project_id
BEGIN SELECT RAISE(ABORT, 'project_scope'); END;

CREATE TRIGGER episodes_scope_update BEFORE UPDATE ON episodes
WHEN NEW.project_id != OLD.project_id
BEGIN SELECT RAISE(ABORT, 'project_scope'); END;

CREATE TRIGGER source_identities_scope_update BEFORE UPDATE ON source_identities
WHEN NEW.project_id != OLD.project_id
BEGIN SELECT RAISE(ABORT, 'project_scope'); END;

CREATE TRIGGER document_blobs_scope_update BEFORE UPDATE ON document_blobs
WHEN NEW.project_id != OLD.project_id
BEGIN SELECT RAISE(ABORT, 'project_scope'); END;

CREATE TRIGGER object_uploads_scope_update BEFORE UPDATE ON object_uploads
WHEN NEW.project_id != OLD.project_id
BEGIN SELECT RAISE(ABORT, 'project_scope'); END;

CREATE TRIGGER style_versions_scope_update BEFORE UPDATE ON style_versions
WHEN NEW.project_id != OLD.project_id
BEGIN SELECT RAISE(ABORT, 'project_scope'); END;

CREATE TRIGGER media_assets_scope_update BEFORE UPDATE ON media_assets
WHEN NEW.project_id != OLD.project_id
BEGIN SELECT RAISE(ABORT, 'project_scope'); END;

CREATE TRIGGER characters_id_insert BEFORE INSERT ON characters
WHEN NEW.id IS NULL OR NEW.id = ''
BEGIN SELECT RAISE(ABORT, 'missing_id'); END;

CREATE TRIGGER characters_id_update BEFORE UPDATE ON characters
WHEN NEW.id IS NULL OR NEW.id = ''
BEGIN SELECT RAISE(ABORT, 'missing_id'); END;

CREATE TRIGGER character_aliases_id_insert BEFORE INSERT ON character_aliases
WHEN NEW.id IS NULL OR NEW.id = ''
BEGIN SELECT RAISE(ABORT, 'missing_id'); END;

CREATE TRIGGER character_aliases_id_update BEFORE UPDATE ON character_aliases
WHEN NEW.id IS NULL OR NEW.id = ''
BEGIN SELECT RAISE(ABORT, 'missing_id'); END;

CREATE TRIGGER scenes_id_insert BEFORE INSERT ON scenes
WHEN NEW.id IS NULL OR NEW.id = ''
BEGIN SELECT RAISE(ABORT, 'missing_id'); END;

CREATE TRIGGER scenes_id_update BEFORE UPDATE ON scenes
WHEN NEW.id IS NULL OR NEW.id = ''
BEGIN SELECT RAISE(ABORT, 'missing_id'); END;

CREATE TRIGGER props_id_insert BEFORE INSERT ON props
WHEN NEW.id IS NULL OR NEW.id = ''
BEGIN SELECT RAISE(ABORT, 'missing_id'); END;

CREATE TRIGGER props_id_update BEFORE UPDATE ON props
WHEN NEW.id IS NULL OR NEW.id = ''
BEGIN SELECT RAISE(ABORT, 'missing_id'); END;

CREATE TRIGGER prop_carriers_id_insert BEFORE INSERT ON prop_carriers
WHEN NEW.id IS NULL OR NEW.id = ''
BEGIN SELECT RAISE(ABORT, 'missing_id'); END;

CREATE TRIGGER prop_carriers_id_update BEFORE UPDATE ON prop_carriers
WHEN NEW.id IS NULL OR NEW.id = ''
BEGIN SELECT RAISE(ABORT, 'missing_id'); END;

CREATE TRIGGER prop_scene_links_id_insert BEFORE INSERT ON prop_scene_links
WHEN NEW.id IS NULL OR NEW.id = ''
BEGIN SELECT RAISE(ABORT, 'missing_id'); END;

CREATE TRIGGER prop_scene_links_id_update BEFORE UPDATE ON prop_scene_links
WHEN NEW.id IS NULL OR NEW.id = ''
BEGIN SELECT RAISE(ABORT, 'missing_id'); END;

CREATE TRIGGER beats_id_insert BEFORE INSERT ON beats
WHEN NEW.id IS NULL OR NEW.id = ''
BEGIN SELECT RAISE(ABORT, 'missing_id'); END;

CREATE TRIGGER beats_id_update BEFORE UPDATE ON beats
WHEN NEW.id IS NULL OR NEW.id = ''
BEGIN SELECT RAISE(ABORT, 'missing_id'); END;

CREATE TRIGGER episodes_id_insert BEFORE INSERT ON episodes
WHEN NEW.id IS NULL OR NEW.id = ''
BEGIN SELECT RAISE(ABORT, 'missing_id'); END;

CREATE TRIGGER episodes_id_update BEFORE UPDATE ON episodes
WHEN NEW.id IS NULL OR NEW.id = ''
BEGIN SELECT RAISE(ABORT, 'missing_id'); END;

CREATE TRIGGER source_identities_id_insert BEFORE INSERT ON source_identities
WHEN NEW.id IS NULL OR NEW.id = ''
BEGIN SELECT RAISE(ABORT, 'missing_id'); END;

CREATE TRIGGER source_identities_id_update BEFORE UPDATE ON source_identities
WHEN NEW.id IS NULL OR NEW.id = ''
BEGIN SELECT RAISE(ABORT, 'missing_id'); END;

CREATE TRIGGER document_blobs_id_insert BEFORE INSERT ON document_blobs
WHEN NEW.id IS NULL OR NEW.id = ''
BEGIN SELECT RAISE(ABORT, 'missing_id'); END;

CREATE TRIGGER document_blobs_id_update BEFORE UPDATE ON document_blobs
WHEN NEW.id IS NULL OR NEW.id = ''
BEGIN SELECT RAISE(ABORT, 'missing_id'); END;

CREATE TRIGGER object_uploads_id_insert BEFORE INSERT ON object_uploads
WHEN NEW.id IS NULL OR NEW.id = ''
BEGIN SELECT RAISE(ABORT, 'missing_id'); END;

CREATE TRIGGER object_uploads_id_update BEFORE UPDATE ON object_uploads
WHEN NEW.id IS NULL OR NEW.id = ''
BEGIN SELECT RAISE(ABORT, 'missing_id'); END;

CREATE TRIGGER style_versions_id_insert BEFORE INSERT ON style_versions
WHEN NEW.id IS NULL OR NEW.id = ''
BEGIN SELECT RAISE(ABORT, 'missing_id'); END;

CREATE TRIGGER style_versions_id_update BEFORE UPDATE ON style_versions
WHEN NEW.id IS NULL OR NEW.id = ''
BEGIN SELECT RAISE(ABORT, 'missing_id'); END;

CREATE TRIGGER media_assets_id_insert BEFORE INSERT ON media_assets
WHEN NEW.id IS NULL OR NEW.id = ''
BEGIN SELECT RAISE(ABORT, 'missing_id'); END;

CREATE TRIGGER media_assets_id_update BEFORE UPDATE ON media_assets
WHEN NEW.id IS NULL OR NEW.id = ''
BEGIN SELECT RAISE(ABORT, 'missing_id'); END;

CREATE TRIGGER episode_links_id_insert BEFORE INSERT ON episode_links
WHEN NEW.id IS NULL OR NEW.id = ''
BEGIN SELECT RAISE(ABORT, 'missing_id'); END;

CREATE TRIGGER episode_links_id_update BEFORE UPDATE ON episode_links
WHEN NEW.id IS NULL OR NEW.id = ''
BEGIN SELECT RAISE(ABORT, 'missing_id'); END;

CREATE TRIGGER media_versions_id_insert BEFORE INSERT ON media_versions
WHEN NEW.id IS NULL OR NEW.id = ''
BEGIN SELECT RAISE(ABORT, 'missing_id'); END;

CREATE TRIGGER media_versions_id_update BEFORE UPDATE ON media_versions
WHEN NEW.id IS NULL OR NEW.id = ''
BEGIN SELECT RAISE(ABORT, 'missing_id'); END;

CREATE TRIGGER alias_character_scope_insert BEFORE INSERT ON character_aliases
WHEN NOT EXISTS(SELECT 1 FROM characters WHERE id=NEW.character_id AND project_id=NEW.project_id)
BEGIN SELECT RAISE(ABORT, 'project_scope'); END;

CREATE TRIGGER alias_character_scope_update BEFORE UPDATE ON character_aliases
WHEN NOT EXISTS(SELECT 1 FROM characters WHERE id=NEW.character_id AND project_id=NEW.project_id)
BEGIN SELECT RAISE(ABORT, 'project_scope'); END;

CREATE TRIGGER alias_name_identity_insert BEFORE INSERT ON character_aliases
WHEN EXISTS(SELECT 1 FROM characters WHERE project_id=NEW.project_id AND name=NEW.alias AND id!=NEW.character_id)
BEGIN SELECT RAISE(ABORT, 'identity_conflict'); END;

CREATE TRIGGER alias_name_identity_update BEFORE UPDATE ON character_aliases
WHEN EXISTS(SELECT 1 FROM characters WHERE project_id=NEW.project_id AND name=NEW.alias AND id!=NEW.character_id)
BEGIN SELECT RAISE(ABORT, 'identity_conflict'); END;

CREATE TRIGGER character_name_identity_insert BEFORE INSERT ON characters
WHEN EXISTS(SELECT 1 FROM character_aliases WHERE project_id=NEW.project_id AND alias=NEW.name AND character_id!=NEW.id)
BEGIN SELECT RAISE(ABORT, 'identity_conflict'); END;

CREATE TRIGGER character_name_identity_update BEFORE UPDATE ON characters
WHEN EXISTS(SELECT 1 FROM character_aliases WHERE project_id=NEW.project_id AND alias=NEW.name AND character_id!=NEW.id)
BEGIN SELECT RAISE(ABORT, 'identity_conflict'); END;

CREATE TRIGGER scene_variant_scope_insert BEFORE INSERT ON scenes
WHEN NEW.variant_of_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM scenes WHERE id=NEW.variant_of_id AND project_id=NEW.project_id)
BEGIN SELECT RAISE(ABORT, 'project_scope'); END;

CREATE TRIGGER scene_variant_scope_update BEFORE UPDATE ON scenes
WHEN NEW.variant_of_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM scenes WHERE id=NEW.variant_of_id AND project_id=NEW.project_id)
BEGIN SELECT RAISE(ABORT, 'project_scope'); END;

CREATE TRIGGER carrier_scope_insert BEFORE INSERT ON prop_carriers
WHEN NOT EXISTS(SELECT 1 FROM props WHERE id=NEW.prop_id AND project_id=NEW.project_id) OR (NEW.character_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM characters WHERE id=NEW.character_id AND project_id=NEW.project_id))
BEGIN SELECT RAISE(ABORT, 'project_scope'); END;

CREATE TRIGGER carrier_scope_update BEFORE UPDATE ON prop_carriers
WHEN NOT EXISTS(SELECT 1 FROM props WHERE id=NEW.prop_id AND project_id=NEW.project_id) OR (NEW.character_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM characters WHERE id=NEW.character_id AND project_id=NEW.project_id))
BEGIN SELECT RAISE(ABORT, 'project_scope'); END;

CREATE TRIGGER prop_scene_scope_insert BEFORE INSERT ON prop_scene_links
WHEN NOT EXISTS(SELECT 1 FROM props WHERE id=NEW.prop_id AND project_id=NEW.project_id) OR NOT EXISTS(SELECT 1 FROM scenes WHERE id=NEW.scene_id AND project_id=NEW.project_id)
BEGIN SELECT RAISE(ABORT, 'project_scope'); END;

CREATE TRIGGER prop_scene_scope_update BEFORE UPDATE ON prop_scene_links
WHEN NOT EXISTS(SELECT 1 FROM props WHERE id=NEW.prop_id AND project_id=NEW.project_id) OR NOT EXISTS(SELECT 1 FROM scenes WHERE id=NEW.scene_id AND project_id=NEW.project_id)
BEGIN SELECT RAISE(ABORT, 'project_scope'); END;

CREATE TRIGGER episode_link_scope_insert BEFORE INSERT ON episode_links
WHEN NOT ((NEW.entity_type='character' AND EXISTS(SELECT 1 FROM characters t JOIN episodes e ON e.project_id=t.project_id WHERE t.id=NEW.entity_id AND e.id=NEW.episode_id)) OR (NEW.entity_type='scene' AND EXISTS(SELECT 1 FROM scenes t JOIN episodes e ON e.project_id=t.project_id WHERE t.id=NEW.entity_id AND e.id=NEW.episode_id)) OR (NEW.entity_type='prop' AND EXISTS(SELECT 1 FROM props t JOIN episodes e ON e.project_id=t.project_id WHERE t.id=NEW.entity_id AND e.id=NEW.episode_id)))
BEGIN SELECT RAISE(ABORT, 'project_scope'); END;

CREATE TRIGGER episode_link_scope_update BEFORE UPDATE ON episode_links
WHEN NOT ((NEW.entity_type='character' AND EXISTS(SELECT 1 FROM characters t JOIN episodes e ON e.project_id=t.project_id WHERE t.id=NEW.entity_id AND e.id=NEW.episode_id)) OR (NEW.entity_type='scene' AND EXISTS(SELECT 1 FROM scenes t JOIN episodes e ON e.project_id=t.project_id WHERE t.id=NEW.entity_id AND e.id=NEW.episode_id)) OR (NEW.entity_type='prop' AND EXISTS(SELECT 1 FROM props t JOIN episodes e ON e.project_id=t.project_id WHERE t.id=NEW.entity_id AND e.id=NEW.episode_id)))
BEGIN SELECT RAISE(ABORT, 'project_scope'); END;

CREATE TRIGGER episode_link_owner_update BEFORE UPDATE ON episode_links
WHEN (SELECT project_id FROM episodes WHERE id=NEW.episode_id)!=(SELECT project_id FROM episodes WHERE id=OLD.episode_id)
BEGIN SELECT RAISE(ABORT, 'project_scope'); END;

CREATE TRIGGER source_identity_scope_insert BEFORE INSERT ON source_identities
WHEN NOT ((NEW.entity_type='character' AND EXISTS(SELECT 1 FROM characters WHERE id=NEW.entity_id AND project_id=NEW.project_id)) OR (NEW.entity_type='scene' AND EXISTS(SELECT 1 FROM scenes WHERE id=NEW.entity_id AND project_id=NEW.project_id)) OR (NEW.entity_type='prop' AND EXISTS(SELECT 1 FROM props WHERE id=NEW.entity_id AND project_id=NEW.project_id)) OR (NEW.entity_type='beat' AND EXISTS(SELECT 1 FROM beats WHERE id=NEW.entity_id AND project_id=NEW.project_id)) OR (NEW.entity_type='episode' AND EXISTS(SELECT 1 FROM episodes WHERE id=NEW.entity_id AND project_id=NEW.project_id)))
BEGIN SELECT RAISE(ABORT, 'project_scope'); END;

CREATE TRIGGER source_identity_scope_update BEFORE UPDATE ON source_identities
WHEN NOT ((NEW.entity_type='character' AND EXISTS(SELECT 1 FROM characters WHERE id=NEW.entity_id AND project_id=NEW.project_id)) OR (NEW.entity_type='scene' AND EXISTS(SELECT 1 FROM scenes WHERE id=NEW.entity_id AND project_id=NEW.project_id)) OR (NEW.entity_type='prop' AND EXISTS(SELECT 1 FROM props WHERE id=NEW.entity_id AND project_id=NEW.project_id)) OR (NEW.entity_type='beat' AND EXISTS(SELECT 1 FROM beats WHERE id=NEW.entity_id AND project_id=NEW.project_id)) OR (NEW.entity_type='episode' AND EXISTS(SELECT 1 FROM episodes WHERE id=NEW.entity_id AND project_id=NEW.project_id)))
BEGIN SELECT RAISE(ABORT, 'project_scope'); END;

CREATE TRIGGER source_identity_stable_update BEFORE UPDATE ON source_identities
WHEN NEW.entity_id!=OLD.entity_id OR NEW.skill!=OLD.skill OR NEW.source_key!=OLD.source_key OR NEW.entity_type!=OLD.entity_type
BEGIN SELECT RAISE(ABORT, 'identity_remap'); END;

CREATE TRIGGER current_document_scope_insert BEFORE INSERT ON current_documents
WHEN NOT EXISTS(SELECT 1 FROM document_blobs WHERE id=NEW.blob_id AND project_id=NEW.project_id AND skill=NEW.skill)
BEGIN SELECT RAISE(ABORT, 'project_scope'); END;

CREATE TRIGGER current_document_scope_update BEFORE UPDATE ON current_documents
WHEN NOT EXISTS(SELECT 1 FROM document_blobs WHERE id=NEW.blob_id AND project_id=NEW.project_id AND skill=NEW.skill)
BEGIN SELECT RAISE(ABORT, 'project_scope'); END;

CREATE TRIGGER current_style_scope_insert BEFORE INSERT ON projects
WHEN NEW.current_style_version_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM style_versions WHERE id=NEW.current_style_version_id AND project_id=NEW.id)
BEGIN SELECT RAISE(ABORT, 'project_scope'); END;

CREATE TRIGGER current_style_scope_update BEFORE UPDATE ON projects
WHEN NEW.current_style_version_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM style_versions WHERE id=NEW.current_style_version_id AND project_id=NEW.id)
BEGIN SELECT RAISE(ABORT, 'project_scope'); END;

CREATE TRIGGER media_style_scope_insert BEFORE INSERT ON media_versions
WHEN NEW.style_version_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM style_versions s JOIN media_assets a ON a.project_id=s.project_id WHERE s.id=NEW.style_version_id AND a.id=NEW.asset_id)
BEGIN SELECT RAISE(ABORT, 'project_scope'); END;

CREATE TRIGGER document_blobs_immutable_update BEFORE UPDATE ON document_blobs
BEGIN SELECT RAISE(ABORT, 'immutable_version'); END;

CREATE TRIGGER document_blobs_immutable_delete BEFORE DELETE ON document_blobs
BEGIN SELECT RAISE(ABORT, 'immutable_version'); END;

CREATE TRIGGER style_versions_immutable_update BEFORE UPDATE ON style_versions
BEGIN SELECT RAISE(ABORT, 'immutable_version'); END;

CREATE TRIGGER style_versions_immutable_delete BEFORE DELETE ON style_versions
BEGIN SELECT RAISE(ABORT, 'immutable_version'); END;

CREATE TRIGGER media_versions_immutable_update BEFORE UPDATE ON media_versions
BEGIN SELECT RAISE(ABORT, 'immutable_version'); END;

CREATE TRIGGER media_versions_immutable_delete BEFORE DELETE ON media_versions
BEGIN SELECT RAISE(ABORT, 'immutable_version'); END;

CREATE TRIGGER import_commits_immutable_update BEFORE UPDATE ON import_commits
BEGIN SELECT RAISE(ABORT, 'immutable_version'); END;

CREATE TRIGGER import_commits_immutable_delete BEFORE DELETE ON import_commits
BEGIN SELECT RAISE(ABORT, 'immutable_version'); END;

UPDATE schema_meta SET value='0002_platform_imports' WHERE key='migration';
