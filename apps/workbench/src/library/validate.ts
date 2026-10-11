import type { ImportIssue, JsonObject, JsonValue, PreparedDocument } from "../contracts/import";
const obj=(v:JsonValue|undefined):JsonObject=>v && typeof v==="object"&&!Array.isArray(v)?v:{};
/** 当前 skill 文稿的结构约束。原著证据与创作质量仍由 skill CLI 单独验收。 */
export function validateLibraryDocument(document:PreparedDocument):ImportIssue[] {
  const {skill,value}=document, issues:ImportIssue[]=[];
  const fail=(path:string,message:string)=>{if(issues.length<100) issues.push({skill,code:"invalid_structure",path,message});};
  const strings=(v:JsonObject,path:string,fields:string[])=>fields.forEach(key=>{if(typeof v[key]!=="string" || !(v[key] as string).trim()) fail(`${path}.${key}`,"字段需要非空字符串。");});
  const array=(v:JsonObject,path:string,key:string,required=true):JsonValue[]=>{
    if (!Array.isArray(v[key])) {if(required || v[key]!==undefined) fail(`${path}.${key}`,"字段需要数组。");return [];}
    return v[key] as JsonValue[];
  };
  const image=(v:JsonObject,path:string)=>{const image=obj(v.image);strings(image,`${path}.image`,["prompt","negativePrompt","sheet"]);array(image,`${path}.image`,"tags");};
  strings(value,"",["source"]);
  if(value.lang!==undefined && !["zh","en","ja"].includes(String(value.lang))) fail("lang","语言无效。");
  if(skill==="novel-characters") {
    const characters=array(value,"","characters");if(!characters.length) fail("characters","角色卡不能为空。");
    characters.forEach((v,i)=>{
      const c=obj(v),path=`characters[${i}]`;strings(c,path,["name","oneLiner"]);
      const persona=obj(c.persona);strings(persona,`${path}.persona`,["gender","ageRange","identity","appearance","temperament","motivation","arc"]);
      for(const key of ["personality","relationships","evidence"]) array(persona,`${path}.persona`,key);
      image(c,path);strings(obj(c.voice),`${path}.voice`,["timbre","pitch","pace","accent","emotion","referenceHint","prompt"]);
      if(c.id!==undefined && (typeof c.id!=="string" || !/^C\d{2,}$/.test(c.id))) fail(`${path}.id`,"显示码格式无效。");
    });
  } else if(skill==="novel-art") {
    const scenes=array(value,"","scenes");if(!scenes.length) fail("scenes","场景不能为空。");
    for(const [field,entries] of [["scenes",scenes],["props",array(value,"","props",false)]] as const) entries.forEach((v,i)=>{
      const c=obj(v),path=`${field}[${i}]`;strings(c,path,["name","summary"]);image(c,path);
      array(c,path,"anchors",false).forEach((a,index)=>strings(obj(a),`${path}.anchors[${index}]`,["name","desc"]));
      const states=field==="scenes"?"lighting":"states";array(c,path,states,false).forEach((a,index)=>strings(obj(a),`${path}.${states}[${index}]`,["state","prompt"]));
      if(c.usage!==undefined) {array(obj(c.usage),`${path}.usage`,"episodes");array(obj(c.usage),`${path}.usage`,"beats");}
      if(field==="props") for(const key of ["relatedScenes","carriedBy"]) {
        const references=array(c,path,key,false);if(references.some(r=>typeof r!=="string"||!r.trim()) || new Set(references).size!==references.length) fail(`${path}.${key}`,"引用需要互不重复的非空字符串。");
      }
    });
  } else {
    const params=obj(value.params);strings(params,"params",["genre"]);
    if(!Number.isSafeInteger(params.episodes)||Number(params.episodes)<1) fail("params.episodes","集数需要正整数。");
    if(typeof params.minutesPerEpisode!=="number"||params.minutesPerEpisode<=0) fail("params.minutesPerEpisode","时长需要正数。");
    if(!["忠实","抽核","借壳"].includes(String(params.adaptMode))) fail("params.adaptMode","改编幅度无效。");
    const adaptation=obj(value.adaptation);strings(adaptation,"adaptation",["core"]);
    for(const key of ["keep","cut","merge","risks"]) array(adaptation,"adaptation",key).forEach((v,index)=>strings(obj(v),`adaptation.${key}[${index}]`,key==="risks"?["what","plan"]:["what","why"]));
    if(!Array.isArray(adaptation.keep)||!adaptation.keep.length) fail("adaptation.keep","至少需要一条保留说明。");
    for(const key of ["characters","scenes","beats"]) if(!Array.isArray(value[key]) || !(value[key] as JsonValue[]).length) fail(key,"列表不能为空。");
    array(value,"","characters").forEach((v,i)=>{const c=obj(v);strings(c,`characters[${i}]`,c.tier==="functional"?["name","role"]:["name","role","arc"]);if(!array(c,`characters[${i}]`,"from").length) fail(`characters[${i}].from`,"需要原著对应说明。");});
    array(value,"","beats").forEach((v,i)=>{const c=obj(v);strings(c,`beats[${i}]`,["type","setup","payoff"]);if(!Number.isSafeInteger(c.episode)||Number(c.episode)<1||Number(c.episode)>Number(params.episodes)) fail(`beats[${i}].episode`,"节拍集数越界。");});
    const episodes=array(value,"","episodes");if(episodes.length!==params.episodes) fail("episodes","分集数量与参数不一致。");
    episodes.forEach((v,i)=>{const c=obj(v),path=`episodes[${i}]`;if(c.ep!==i+1) fail(`${path}.ep`,"集数需要从一连续编号。");strings(c,path,["synopsis","hook","suspense"]);for(const key of ["sceneIds","characterIds","propIds"]) {const refs=array(c,path,key,key!=="propIds");if(new Set(refs).size!==refs.length||refs.some(v=>typeof v!=="string")) fail(`${path}.${key}`,"引用需要互不重复的字符串。");}});
  }
  return issues;
}
