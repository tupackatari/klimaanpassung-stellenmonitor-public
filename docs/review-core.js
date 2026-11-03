/* Pure validation and GitHub transport. Tokens are held only in this closure. */
(function(root){
'use strict';
const TAGS=['Klimaanpassung','Hitzeschutz','Hochwasser'];
const ROLES=['Hauptaufgabe','wesentliche Teilaufgabe','Nebenaufgabe'];
const encode=value=>btoa(Array.from(new TextEncoder().encode(value),b=>String.fromCharCode(b)).join(''));
const decode=value=>new TextDecoder('utf-8',{fatal:true}).decode(Uint8Array.from(atob(value.replace(/\s/g,'')),c=>c.charCodeAt(0)));
function validatePatch(job,patch){
 const status=patch?.review?.status;
 if(!['relevant','ausgeschlossen','Prüfung erforderlich'].includes(status))throw Error('Ungültige Entscheidung.');
 if(status==='relevant'){
  if(!Array.isArray(patch.tags)||!patch.tags.length||patch.tags.some(t=>!TAGS.includes(t))||new Set(patch.tags).size!==patch.tags.length)throw Error('Bitte mindestens ein passendes Thema wählen.');
  if(!ROLES.includes(patch.topic?.role))throw Error('Bitte die Aufgabenrolle wählen.');
  if(!patch.topic?.summary?.trim())throw Error('Bitte die einschlägigen Aufgaben kurz beschreiben.');
  if(!Array.isArray(patch.topic?.evidence)||!patch.topic.evidence.length||patch.topic.evidence.some(e=>typeof e!=='string'||!e.trim()||!job.full_text.includes(e.trim())))throw Error('Bitte eine tatsächliche Belegstelle aus dem Volltext übernehmen.');
 }
 return patch;
}
async function textHash(text){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text))),b=>b.toString(16).padStart(2,'0')).join('');}
class GitHubReviewClient{
 constructor(repository,branch='main',fetcher=fetch){
  if(!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository))throw Error('Redaktion ist noch nicht eingerichtet.');
  this.repository=repository;this.owner=repository.split('/')[0];this.branch=branch;this.fetcher=fetcher.bind(globalThis);this.token=null;this.login=null;this.queue=Promise.resolve();this.expiresAt=0;this.expiryTimer=null;
 }
 async request(path,options={}){
  let response;
  try{response=await this.fetcher('https://api.github.com'+path,{...options,headers:{Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28',...(options.body?{'Content-Type':'application/json'}:{}),...(options.headers||{}),Authorization:'Bearer '+this.token},cache:'no-store',credentials:'omit',redirect:'error',referrerPolicy:'no-referrer',signal:AbortSignal.timeout(25000)});}
  catch{throw Error('GitHub konnte nicht erreicht werden. Die Speicherung ist unbestätigt; bitte neu laden und den Status prüfen.');}
  if(!response.ok){
   if(response.status===401)this.disconnect();
   const error=Error(response.status===401?'Die Anmeldung ist abgelaufen. Bitte erneut anmelden.':response.status===403?'GitHub erlaubt das Speichern nicht. Bitte Repository-Auswahl und Contents-Schreibrecht prüfen.':response.status===409||response.status===422?'Der Datenstand wurde gleichzeitig geändert. Bitte erneut versuchen.':`GitHub ist gerade nicht erreichbar (HTTP ${response.status}). Die Entscheidung wurde nicht bestätigt.`);
   error.status=response.status;throw error;
  }
  return response.json();
 }
 async connect(token){
  this.disconnect();
  if(!token?.trim().startsWith('github_pat_'))throw Error('Bitte einen auf dieses Repository beschränkten Fine-grained Token verwenden.');
  this.token=token.trim();
  try{
   const user=await this.request('/user');
   if(user.login?.toLowerCase()!==this.owner.toLowerCase())throw Error(`Nur ${this.owner} kann diese Redaktion anmelden.`);
   const repository=await this.request('/repos/'+this.repository);
   if(repository.private!==true)throw Error('Das Archiv-Repository ist noch nicht privat. Bearbeitungsmodus vorerst gesperrt.');
   this.login=user.login;this.expiresAt=Date.now()+20*60*1000;
   this.expiryTimer=setTimeout(()=>{this.disconnect();if(typeof window!=='undefined')window.dispatchEvent(new Event('editor-expired'));},20*60*1000);
   this.expiryTimer?.unref?.();return this.login;
  }catch(error){this.disconnect();throw error;}
 }
 async loadArchive(){
  if(!this.token||!this.login)throw Error('Bitte zuerst den Bearbeitungsmodus anmelden.');
  if(this.expiresAt && Date.now()>=this.expiresAt){this.disconnect();throw Error('Die Anmeldung ist abgelaufen. Bitte erneut anmelden.');}
  const data=await this.request('/repos/'+this.repository+'/contents/data/editor.json?ref='+encodeURIComponent(this.branch),{headers:{Accept:'application/vnd.github.raw+json'}});
  if(!Array.isArray(data.parts)||data.parts.some(p=>!/^part-\d{4}\.json$/.test(p)))throw Error('Privates Archiv ungültig.');
  const jobs=[];
  for(const part of data.parts){
   const chunk=await this.request('/repos/'+this.repository+'/contents/data/editor/'+part+'?ref='+encodeURIComponent(this.branch),{headers:{Accept:'application/vnd.github.raw+json'}});
   if(!Array.isArray(chunk.jobs))throw Error('Archivteil ungültig.');jobs.push(...chunk.jobs);
  }
  return jobs;
 }
 disconnect(){clearTimeout(this.expiryTimer);this.expiryTimer=null;this.expiresAt=0;this.token=null;this.login=null;}
 save(job,patch){
  const operation=this.queue.then(()=>this.saveNow(job,patch));this.queue=operation.catch(()=>{});return operation;
 }
 async saveNow(job,patch){
  if(!this.token||!this.login)throw Error('Bitte zuerst den Bearbeitungsmodus anmelden.');
  if(this.expiresAt && Date.now()>=this.expiresAt){this.disconnect();throw Error('Die Anmeldung ist abgelaufen. Bitte erneut anmelden.');}
  validatePatch(job,patch);
  const login=this.login;
  const text_hash=await textHash(job.full_text);
  const durable=JSON.parse(JSON.stringify(patch));
  durable.review={...durable.review,reviewed_by:login,reviewed_at:new Date().toISOString(),text_hash};
  const prefix='/repos/'+this.repository+'/contents/';
  const raw=await this.request(prefix+'data/jobs/'+encodeURIComponent(job.id)+'.json?ref='+encodeURIComponent(this.branch));
  const current=JSON.parse(decode(raw.content));
  if(current.id!==job.id||await textHash(current.full_text)!==text_hash)throw Error('Die Anzeige wurde inzwischen geändert. Bitte die Seite neu laden und erneut prüfen.');
  const path=prefix+'data/overrides.json';let baseline;
  for(let attempt=0;attempt<3;attempt++){
   const file=await this.request(path+'?ref='+encodeURIComponent(this.branch));
   const overrides=JSON.parse(decode(file.content));
   if(!overrides||typeof overrides!=='object'||Array.isArray(overrides))throw Error('Die Korrekturdatei ist ungültig. Es wurde nichts überschrieben.');
   const entry=overrides[job.id]||{};
   if(attempt===0){
    if(entry.review?.reviewed_at && entry.review.reviewed_at!==job.review?.reviewed_at)throw Error('Diese Anzeige wurde bereits in einer anderen Sitzung geprüft. Bitte neu laden.');
    baseline=JSON.stringify(entry);
   }
   else if(JSON.stringify(entry)!==baseline)throw Error('Diese Anzeige wurde gleichzeitig von einer anderen Sitzung geprüft. Bitte neu laden.');
   const merged={...entry,...durable,review:{...(entry.review||{}),...durable.review}};
   if(durable.topic)merged.topic={...(entry.topic||{}),...durable.topic};
   const next={...overrides,[job.id]:merged};
   try{
    const result=await this.request(path,{method:'PUT',body:JSON.stringify({message:`review: ${job.id} ${durable.review.status}`,branch:this.branch,sha:file.sha,content:encode(JSON.stringify(next,null,2)+'\n')})});
    if(!result.commit?.sha)throw Error('GitHub hat das Speichern nicht bestätigt. Bitte neu laden und den Status prüfen.');
    return {patch:merged,commit:result.commit.sha};
   }catch(error){if(![409,422].includes(error.status)||attempt===2)throw error;}
  }
 }
}
root.ReviewCore={GitHubReviewClient,validatePatch,textHash,encode,decode,TAGS,ROLES};
})(typeof window==='undefined'?globalThis:window);

