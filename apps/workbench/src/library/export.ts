import type { Cell, EntityKind, JsonObject, JsonValue, ProjectSnapshot, Skill } from "../contracts/import";
import { PlatformError } from "../platform/errors";

/** 从当前规范化字段重建，未知字段来自不可变文稿；内部 UUID 不进入 skill 文稿。 */
export function exportLibraryDocument(snapshot: ProjectSnapshot, skill: Skill): JsonObject {
  const source = snapshot.documents.find(d => d.skill === skill);
  if (!source) throw new PlatformError(404,"document_not_found","当前项目没有该种文稿。");
  const result = structuredClone(source.value);
  const table = (kind: EntityKind) => [...snapshot.entities[kind]].sort((a,b) => Number(a.sort_order ?? 0)-Number(b.sort_order ?? 0));
  const json = (value: Cell | undefined): JsonValue => value == null ? null : JSON.parse(String(value)) as JsonValue;
  const copy = (item: JsonObject, row: Record<string,Cell>, fields: Record<string,string>, jsonFields: Record<string,string> = {}) => {
    for (const [key,column] of Object.entries(fields)) if (row[column] !== undefined && row[column] !== null) item[key] = row[column]!;
    for (const [key,column] of Object.entries(jsonFields)) if (row[column] !== undefined && row[column] !== null) item[key] = json(row[column]);
    return item;
  };
  const base = (row: Record<string,Cell>): JsonObject | undefined => {
    const extensions = json(row.raw_extensions_json) as JsonObject | null;
    const item = extensions?.[skill];
    return item && typeof item === "object" && !Array.isArray(item) ? structuredClone(item) : undefined;
  };
  const exportGroup = (kind: EntityKind, fields: Record<string,string>, jsonFields: Record<string,string> = {}) => table(kind).flatMap(row => {
    const item=base(row); if (!item) return [];
    if (row.display_code) item.id=String(row.display_code);
    if (typeof row.name === "string") item.name=row.name;
    return [copy(item,row,fields,jsonFields)];
  });
  if (skill === "novel-characters") {
    result.characters=table("character").flatMap(row => {
      const item=base(row); if (!item) return [];
      if (row.display_code) item.id=String(row.display_code);
      item.name=String(row.name);
      item.aliases=snapshot.entities.alias.filter(a => a.character_id === row.id).map(a => String(a.alias)).sort((a,b) => {
        const original=Array.isArray(item.aliases) ? item.aliases:[]; return original.indexOf(a)-original.indexOf(b);
      });
      return [copy(item,row,{importance:"cast_importance",oneLiner:"one_liner"},{persona:"cast_persona_json",image:"cast_image_json",voice:"cast_voice_json"})];
    });
  } else if (skill === "novel-art") {
    result.scenes=table("scene").flatMap(row => {
      const item=base(row); if (!item) return [];
      item.id=String(row.display_code); item.name=String(row.name); item.primary=!!row.is_primary;
      if (row.variant_of_id) item.variantOf=String(snapshot.entities.scene.find(s => s.id === row.variant_of_id)?.display_code);
      else delete item.variantOf;
      return [copy(item,row,{summary:"summary",changes:"changes"},{anchors:"anchors_json",lighting:"lighting_json",image:"image_json"})];
    });
    result.props=table("prop").flatMap(row => {
      const item=base(row); if (!item) return [];
      item.id=String(row.display_code); item.name=String(row.name);
      const original=Array.isArray(item.relatedScenes) ? item.relatedScenes:[];
      item.relatedScenes=snapshot.entities.prop_scene.filter(link => link.prop_id===row.id).map(link => String(snapshot.entities.scene.find(s => s.id===link.scene_id)?.display_code)).sort((a,b)=>original.indexOf(a)-original.indexOf(b));
      const names=Array.isArray(item.carriedBy)?item.carriedBy:[];
      item.carriedBy=snapshot.entities.carrier.filter(c => c.prop_id===row.id).map(c => String(c.source_code ?? c.name_unresolved ?? snapshot.entities.character.find(r=>r.id===c.character_id)?.name)).sort((a,b)=>names.indexOf(a)-names.indexOf(b));
      return [copy(item,row,{scale:"scale",summary:"summary"},{anchors:"anchors_json",states:"states_json",image:"image_json"})];
    });
  } else {
    result.characters=exportGroup("character",{tier:"outline_tier",arc:"outline_arc"});
    result.scenes=exportGroup("scene",{reusePlan:"reuse_plan"}).map(item=>({...item,primary:!!snapshot.entities.scene.find(r=>r.display_code===item.id)?.is_primary}));
    if (Array.isArray(result.props)) result.props=exportGroup("prop",{function:"function_text"});
    result.beats=exportGroup("beat",{type:"type",weight:"weight",episode:"episode_number",setup:"setup",payoff:"payoff"});
    result.episodes=table("episode").map(row => {
      const old=Array.isArray(source.value.episodes)?source.value.episodes.find(v=>v && typeof v==="object"&&!Array.isArray(v)&&v.ep===row.ep_number):undefined;
      const item=old && typeof old==="object"&&!Array.isArray(old)?structuredClone(old):{};
      copy(item,row,{ep:"ep_number",synopsis:"synopsis",hook:"hook",suspense:"suspense"},{warnings:"warnings_json"});
      for (const [field,kind] of [["characterIds","character"],["sceneIds","scene"],["propIds","prop"]] as const) item[field]=snapshot.entities.episode_link.filter(l=>l.episode_id===row.id&&l.entity_type===kind).sort((a,b)=>Number(a.sort_order)-Number(b.sort_order)).map(l=>String(snapshot.entities[kind].find(r=>r.id===l.entity_id)?.display_code));
      return item;
    });
  }
  return result;
}
