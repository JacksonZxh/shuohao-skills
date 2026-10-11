import { validateLibraryDocument } from "./validate";
import type { Cell, EntityKind, EntityWrite, ImportIssue, ImportPlanner, JsonObject, JsonValue, Skill } from "../contracts/import";

const object = (v: JsonValue | undefined): JsonObject => v !== null && typeof v === "object" && !Array.isArray(v) ? v : {};
const list = (v: JsonValue | undefined): JsonValue[] => Array.isArray(v) ? v : [];
const text = (v: JsonValue | undefined): string => typeof v === "string" ? v : "";
const encoded = (v: JsonValue | undefined): string | null => v === undefined ? null : JSON.stringify(v);
const kinds = ["character", "scene", "prop", "beat", "episode"] as const;

/** 纯规划：只读取项目快照，不读写数据库，也不按照数组下标分配身份。 */
export const planLibraryImport: ImportPlanner = ({ documents, snapshot, allocateId }) => {
  const issues: ImportIssue[] = documents.flatMap(validateLibraryDocument).slice(0,100), warnings: ImportIssue[] = [];
  const writes = new Map<string, EntityWrite>();
  const identities = [...snapshot.identities];
  const removals: { kind: "alias" | "carrier" | "prop_scene" | "episode_link"; id: string }[] = [];
  const rows = Object.fromEntries(kinds.map(kind => [kind, snapshot.entities[kind].map(row => ({ ...row }))])) as Record<typeof kinds[number], Record<string, Cell>[]>;
  const fail = (skill: Skill, path: string, message: string, code = "invalid_document") => {
    if (issues.length < 100) issues.push({ skill, path, message, code });
  };
  const put = (kind: EntityKind, id: string, values: Record<string, Cell>) => {
    const key = `${kind}:${id}`, old = writes.get(key);
    writes.set(key, { kind, id, values: { ...old?.values, ...values } });
    if (kinds.some(k => k === kind)) {
      const group = rows[kind as typeof kinds[number]], row = group.find(r => r.id === id);
      if (row) Object.assign(row, values); else group.push({ id, ...values });
    }
  };
  const identify = (skill: Skill, kind: typeof kinds[number], item: JsonObject, index: number, path: string) => {
    const code = kind === "episode" ? String(item.ep) : text(item.id);
    const name = text(item.name);
    const key = code || `name:${name}`;
    const mapped = identities.find(i => i.skill === skill && i.entityKind === kind && i.sourceKey === key);
    const coded = rows[kind].find(r => (kind === "episode" ? String(r.ep_number) : r.display_code) === code && !!code);
    const named = kind === "episode" ? undefined : rows[kind].find(r => r.name === name);
    const candidates = [mapped?.entityId, coded?.id, named?.id].filter((v): v is string => typeof v === "string");
    if (new Set(candidates).size > 1 || (named && code && named.display_code && named.display_code !== code) ||
        (coded && kind !== "episode" && coded.name !== name)) fail(skill, path, "显示码与姓名指向不同身份，不能自动合并。", "identity_conflict");
    const id = candidates[0] ?? allocateId();
    if (!identities.some(i => i.skill === skill && i.entityKind === kind && i.sourceKey === key)) identities.push({ skill, entityKind: kind, sourceKey: key, entityId: id });
    put(kind, id, { ...(kind === "episode" ? { ep_number: Number(item.ep) } : { name, ...(code ? { display_code: code } : {}) }), sort_order: index });
    return id;
  };
  const documentsBySkill = [...documents].sort((a,b) => ["novel-outline", "novel-characters", "novel-art"].indexOf(a.skill) - ["novel-outline", "novel-characters", "novel-art"].indexOf(b.skill));
  for (const doc of documentsBySkill) {
    const { skill, value } = doc;
    if (!text(value.source)) fail(skill, "source", "文稿需要 source。");
    const groups = skill === "novel-characters" ? [["characters", "character"]] : skill === "novel-art" ? [["scenes", "scene"], ["props", "prop"]] : [["characters", "character"], ["scenes", "scene"], ["props", "prop"], ["beats", "beat"], ["episodes", "episode"]];
    for (const [field, kindValue] of groups) {
      const kind = kindValue as typeof kinds[number];
      if (!Array.isArray(value[field!]) && field !== "props") fail(skill, field!, "字段需要数组。");
      const codes = new Set<string>(), names = new Set<string>();
      list(value[field!]).forEach((entry,index) => {
        const item = object(entry), path = `${field}[${index}]`, code = kind === "episode" ? String(item.ep) : text(item.id), name = text(item.name);
        if (kind !== "episode" && kind !== "beat" && !name.trim()) fail(skill, `${path}.name`, "名称不能为空。");
        if (kind === "episode" && (!Number.isSafeInteger(item.ep) || Number(item.ep) < 1)) fail(skill, `${path}.ep`, "集数需要正整数。");
        if (skill !== "novel-characters" && kind !== "episode" && !new RegExp(`^${({character:"C",scene:"S",prop:"P",beat:"B"} as Record<string,string>)[kind]}\\d{2,}$`).test(code)) fail(skill, `${path}.id`, "显示码格式无效。");
        if (code && codes.has(code)) fail(skill, `${path}.id`, "同一文稿显示码重复。", "duplicate_code");
        if (name && names.has(name)) fail(skill, `${path}.name`, "同一文稿名称重复。", "duplicate_name");
        if (code) codes.add(code); if (name) names.add(name);
        // beats 没有 name 列，只按照明确显示码识别。
        const id = kind === "beat" ? (() => {
          const old = rows.beat.find(r => r.display_code === code), id = String(old?.id ?? allocateId());
          if (!identities.some(i => i.skill === skill && i.entityKind === kind && i.sourceKey === code)) identities.push({ skill, entityKind: kind, sourceKey: code, entityId: id });
          put(kind,id,{ display_code: code, sort_order:index }); return id;
        })() : identify(skill,kind,item,index,path);
        const row = rows[kind].find(r => r.id === id)!;
        const extensions = row.raw_extensions_json ? JSON.parse(String(row.raw_extensions_json)) as JsonObject : {};
        if (kind !== "episode") put(kind,id,{raw_extensions_json: JSON.stringify({...extensions,[skill]:item})});
        if (kind === "character") {
          if (skill === "novel-outline") {
            if (!["lead","support","functional"].includes(text(item.tier))) fail(skill,`${path}.tier`,"角色层级无效。");
            put(kind,id,{outline_tier:text(item.tier),outline_arc:text(item.arc)});
          } else {
            if (!["protagonist","major","supporting","minor"].includes(text(item.importance))) fail(skill,`${path}.importance`,"角色重要性无效。");
            if (!Array.isArray(item.aliases) || list(item.aliases).some(a => typeof a !== "string" || !a.trim())) fail(skill,`${path}.aliases`,"别名需要非空字符串数组。");
            for (const block of ["persona","image","voice"]) if (!item[block] || Array.isArray(item[block]) || typeof item[block] !== "object") fail(skill,`${path}.${block}`,"角色设定需要对象。");
            put(kind,id,{cast_importance:text(item.importance),one_liner:text(item.oneLiner),cast_persona_json:encoded(item.persona),cast_image_json:encoded(item.image),cast_voice_json:encoded(item.voice)});
          }
        } else if (kind === "scene") {
          if (typeof item.primary !== "boolean") fail(skill,`${path}.primary`,"场景 primary 需要布尔值。");
          put(kind,id,{is_primary:item.primary ? 1:0});
          if (skill === "novel-art") put(kind,id,{summary:text(item.summary),anchors_json:encoded(item.anchors),lighting_json:encoded(item.lighting),image_json:encoded(item.image),changes:item.changes === undefined ? null:text(item.changes)});
          else put(kind,id,{reuse_plan:item.reusePlan === undefined ? null:text(item.reusePlan)});
        } else if (kind === "prop") {
          if (skill === "novel-art") put(kind,id,{scale:text(item.scale),summary:text(item.summary),anchors_json:encoded(item.anchors),states_json:encoded(item.states),image_json:encoded(item.image)});
          else put(kind,id,{function_text:text(item.function)});
        } else if (kind === "beat") {
          if (item.weight !== undefined && !["major","minor"].includes(text(item.weight))) fail(skill,`${path}.weight`,"节拍权重无效。");
          put(kind,id,{type:text(item.type),weight:item.weight === undefined ? null:text(item.weight),episode_number:typeof item.episode === "number" ? item.episode:null,setup:text(item.setup),payoff:text(item.payoff)});
        } else put(kind,id,{synopsis:text(item.synopsis),hook:text(item.hook),suspense:text(item.suspense),crowd_plan:text(item.crowdPlan),warnings_json:encoded(item.warnings ?? [])});
      });
    }
  }
  // 在整包角色全部识别后解析别名，避免文件顺序影响 carriedBy。
  const aliases = snapshot.entities.alias.filter(a => !writes.has(`character:${a.character_id}`) || !documents.some(d => d.skill === "novel-characters"));
  const cast = documents.find(d => d.skill === "novel-characters");
  if (cast) {
    const touched = list(cast.value.characters).map(c => rows.character.find(r => r.name === object(c).name)?.id);
    snapshot.entities.alias.filter(a => touched.includes(a.character_id)).forEach(a => removals.push({kind:"alias",id:String(a.id)}));
    list(cast.value.characters).forEach((v,index) => {
      const item = object(v), character = rows.character.find(r => r.name === item.name);
      for (const alias of list(item.aliases)) {
        const collision = aliases.find(a => a.alias === alias), named = rows.character.find(r => r.name === alias);
        if (collision || named) { fail(cast.skill,`characters[${index}].aliases`,"别名重复或与角色姓名冲突。","ambiguous_alias"); continue; }
        const id = allocateId(), values = {character_id:String(character?.id),alias:String(alias)};
        aliases.push({id,...values}); put("alias",id,values);
      }
    });
  }
  const resolve = (skill: Skill, kind: typeof kinds[number], code: JsonValue | undefined, path: string) => {
    const row = rows[kind].find(r => kind === "episode" ? r.ep_number === code : r.display_code === code);
    if (!row) fail(skill,path,"引用没有对应的项目实体。","dangling_reference");
    return row;
  };
  for (const doc of documentsBySkill) {
    if (doc.skill === "novel-art") {
      list(doc.value.scenes).forEach((v,index) => {
        const item = object(v), row = resolve(doc.skill,"scene",item.id,`scenes[${index}].id`);
        const parent = item.variantOf ? resolve(doc.skill,"scene",item.variantOf,`scenes[${index}].variantOf`):undefined;
        if (row) put("scene",String(row.id),{variant_of_id:parent ? String(parent.id):null});
      });
      list(doc.value.props).forEach((v,index) => {
        const item = object(v), prop = resolve(doc.skill,"prop",item.id,`props[${index}].id`);
        if (!prop) return;
        for (const kind of ["carrier","prop_scene"] as const) snapshot.entities[kind].filter(r => r.prop_id === prop.id).forEach(r => removals.push({kind,id:String(r.id)}));
        for (const code of list(item.relatedScenes)) {
          const scene = resolve(doc.skill,"scene",code,`props[${index}].relatedScenes`);
          if (scene) put("prop_scene",allocateId(),{prop_id:String(prop.id),scene_id:String(scene.id)});
        }
        for (const value of list(item.carriedBy)) {
          const name = text(value), alias = aliases.find(a => a.alias === name);
          if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(name)) fail(doc.skill,`props[${index}].carriedBy`,"文稿引用需要显示码或姓名，不能提交内部 UUID。","project_scope");
          const character = rows.character.find(r => r.name === name || r.display_code === name || r.id === alias?.character_id);
          if (!name) fail(doc.skill,`props[${index}].carriedBy`,"携带者需要非空字符串。");
          if (!character) warnings.push({skill:doc.skill,code:"unresolved_carrier",path:`props[${index}].carriedBy`,message:"携带者尚未解析，原字符串保留。"});
          put("carrier",allocateId(),{prop_id:String(prop.id),character_id:character ? String(character.id):null,name_unresolved:character ? null:name,source_code:name});
        }
      });
    }
    if (doc.skill === "novel-outline") {
      list(doc.value.episodes).forEach((v,index) => {
        const item=object(v), episode=resolve(doc.skill,"episode",item.ep,`episodes[${index}].ep`);
        if (!episode) return;
        snapshot.entities.episode_link.filter(r => r.episode_id === episode.id).forEach(r => removals.push({kind:"episode_link",id:String(r.id)}));
        for (const [field,kind] of [["characterIds","character"],["sceneIds","scene"],["propIds","prop"]] as const) list(item[field]).forEach((code,order) => {
          const row=resolve(doc.skill,kind,code,`episodes[${index}].${field}`);
          if (row) put("episode_link",allocateId(),{episode_id:String(episode.id),entity_type:kind,entity_id:String(row.id),sort_order:order});
        });
      });
      list(doc.value.props).forEach((v,index) => list(object(v).beatIds).forEach(code => resolve(doc.skill,"beat",code,`props[${index}].beatIds`)));
    }
  }
  // 不静默删除核心实体。完整文稿缩减列表需要单独的删除与依赖确认流程。
  for (const doc of documents) {
    const previous=snapshot.documents.find(d => d.skill === doc.skill);
    if (!previous) continue;
    for (const field of ["characters","scenes","props","beats","episodes"]) for (const v of list(previous.value[field])) {
      const item=object(v), key=item.id ?? item.name ?? item.ep;
      if (!list(doc.value[field]).some(v => {const next=object(v);return (next.id ?? next.name ?? next.ep) === key || (!item.id && !!item.name && next.name === item.name);})) fail(doc.skill,field,"移除实体需要单独确认其依赖，当前导入拒绝隐式删除。","entity_removal_requires_review");
    }
  }
  if (issues.length) return {status:"rejected",issues};
  return {status:"planned",plan:{expectedRevision:snapshot.revision,writes:[...writes.values()],removals,identities:identities.filter(i => !snapshot.identities.some(old => old.skill===i.skill && old.entityKind===i.entityKind && old.sourceKey===i.sourceKey)),warnings}};
};
