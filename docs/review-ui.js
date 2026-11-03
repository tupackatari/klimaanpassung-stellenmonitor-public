(function(){
'use strict';
const cfg=D.review_editor||{};
const originalPublic=D.public_view?JSON.parse(JSON.stringify(D)):null;
const client=cfg.repository&&!D.demo?new ReviewCore.GitHubReviewClient(cfg.repository,cfg.branch||'main'):null;
let pendingAction=null,formJob=null,busy=false,authSequence=0;
const history=new Map((D.reviewed_jobs||[]).map(j=>[j.id,j]));
const status=text=>{$('review-save-status').textContent=text;};
const authState=()=>{$('editor-state').textContent=client?.login?`Angemeldet als ${client.login}. Entscheidungen werden dauerhaft in GitHub gespeichert.`:'Zum dauerhaften Speichern bitte anmelden.';$('editor-connect').textContent=client?.login?'Abmelden':'Bearbeitungsmodus anmelden';};
function updateHistory(){
 $('review-history-list').innerHTML=[...history.values()].sort((a,b)=>(b.review.reviewed_at||'').localeCompare(a.review.reviewed_at||'')).map(j=>`<article class="review-done"><strong>${esc(j.title)}</strong><p>${j.review.status==='relevant'?'Als relevant bestätigt':j.review.status==='ausgeschlossen'?'Ausgeschlossen':'Wieder zur Prüfung geöffnet'}</p><button class="review-button" data-review="Prüfung erforderlich" data-job="${esc(j.id)}" ${j.review.status==='Prüfung erforderlich'?'disabled':''}>Entscheidung zurücknehmen</button></article>`).join('')||'<p>Noch keine manuellen Entscheidungen.</p>';
}
function requireAuth(action){
 if(client?.login){action();return;}
 pendingAction=action;$('editor-auth-error').textContent='';$('editor-auth').showModal();
}
function patchFor(job,decision){
 return {review:{status:decision,reason:decision==='relevant'?'Aufgabenbezug und öffentliche Arbeitgeberzugehörigkeit manuell bestätigt.':decision==='ausgeschlossen'?'Nach fachlicher Prüfung manuell ausgeschlossen.':'Manuelle Entscheidung zurückgenommen; erneute Prüfung erforderlich.',duplicate_candidates:[]},...(decision==='relevant'?{tags:[...job.tags],topic:{role:job.topic.role,summary:job.topic.summary,evidence:[...job.topic.evidence]}}:{})};
}
function openDetails(job){
 formJob=job;
 $('review-tags').innerHTML=ReviewCore.TAGS.map(t=>`<label class="review-tag-choice"><input type="checkbox" value="${esc(t)}" ${job.tags.includes(t)?'checked':''}>${esc(t)}</label>`).join('');
 $('review-role').value=job.topic.role||'';
 $('review-task-summary').value=job.topic.summary||'';
 $('review-evidence').value=job.topic.evidence.join('\n');
 $('review-source-text').textContent=job.full_text;
 $('review-details-error').textContent='';$('review-details').showModal();
}
async function save(job,patch){
 if(busy){status('Bitte warten, die vorherige Entscheidung wird noch gespeichert.');return;}
 busy=true;document.querySelectorAll('[data-review]').forEach(b=>b.disabled=true);
 status('Entscheidung wird in GitHub gespeichert …');
 try{
  const result=await client.save(job,patch);
  job.review={...job.review,...result.patch.review};
  if(result.patch.tags)job.tags=[...result.patch.tags];
  if(result.patch.topic)job.topic={...job.topic,...result.patch.topic,classification_method:'manuell'};
  job.monitoring.last_changed=result.patch.review.reviewed_at;
  if(!D.jobs.some(j=>j.id===job.id))D.jobs.push(job);
  history.set(job.id,job);render();updateHistory();
  if($('review-details').open)$('review-details').close();
  status('In GitHub gespeichert. Deine Ansicht ist aktualisiert; die öffentliche Website folgt automatisch in etwa einer Minute.');
 }catch(error){status(error.message||'Speichern nicht bestätigt. Bitte neu laden und den Status prüfen.');if($('review-details').open)$('review-details-error').textContent=error.message;}
 finally{busy=false;document.querySelectorAll('[data-review]').forEach(b=>b.disabled=false);authState();updateHistory();}
}
function decide(id,decision){
 const job=D.jobs.find(j=>j.id===id)||history.get(id);if(!job||busy)return;
 requireAuth(()=>{
  const patch=patchFor(job,decision);
  if(decision==='relevant'){
   try{ReviewCore.validatePatch(job,patch);}catch{openDetails(job);return;}
  }
  save(job,patch);
 });
}
for(const area of ['reviews','review-history-list'])$(area).addEventListener('click',event=>{const button=event.target.closest('[data-review]');if(button)decide(button.dataset.job,button.dataset.review);});
$('editor-connect').addEventListener('click',()=>{if(busy){status('Bitte das laufende Speichern abwarten.');return;}if(client?.login){client.disconnect();pendingAction=null;if(originalPublic){Object.assign(D,JSON.parse(JSON.stringify(originalPublic)));history.clear();formJob=null;for(const id of ['detail-content','review-source-text'])$(id).textContent='';for(const id of ['review-task-summary','review-evidence'])$(id).value='';for(const id of ['detail','review-details'])if($(id).open)$(id).close();render();updateHistory();}authState();status('Bearbeitungsmodus abgemeldet.');}else requireAuth(()=>{});});
$('editor-auth-cancel').addEventListener('click',()=>{authSequence++;client?.disconnect();$('editor-token').value='';pendingAction=null;$('editor-auth').close();});
$('editor-auth').addEventListener('cancel',()=>{authSequence++;client?.disconnect();$('editor-token').value='';pendingAction=null;});
$('editor-auth-form').addEventListener('submit',async event=>{
 event.preventDefault();const attempt=++authSequence;const field=$('editor-token');const token=field.value;field.value='';
 const button=event.submitter;button.disabled=true;
 try{
  if(!client)throw Error('Die Redaktion ist für diese Vorschau nicht eingerichtet.');
  await client.connect(token);
  if(originalPublic){const archive=await client.loadArchive();if(attempt!==authSequence){client.disconnect();return;}D.jobs=archive;D.public_view=false;history.clear();archive.filter(j=>j.review.reviewed_by).forEach(j=>history.set(j.id,j));render();updateHistory();}
  if(attempt!==authSequence){client.disconnect();return;}$('editor-auth').close();authState();const action=pendingAction;pendingAction=null;if(action)action();
 }catch(error){$('editor-auth-error').textContent=error.message;}finally{button.disabled=false;}
});
$('review-details-cancel').addEventListener('click',()=>{$('review-details').close();formJob=null;});
$('review-details-form').addEventListener('submit',event=>{
 event.preventDefault();if(!formJob)return;
 const patch=patchFor(formJob,'relevant');
 patch.tags=[...$('review-tags').querySelectorAll('input:checked')].map(e=>e.value);
 patch.topic={role:$('review-role').value,summary:$('review-task-summary').value.trim(),evidence:[$('review-evidence').value.trim()]};
 try{ReviewCore.validatePatch(formJob,patch);}catch(error){$('review-details-error').textContent=error.message;return;}
 save(formJob,patch);
});
for(const r of ReviewCore.ROLES){const option=document.createElement('option');option.value=r;option.textContent=r;$('review-role').append(option);}
if(client){
 const link=new URL('https://github.com/settings/personal-access-tokens/new');
 link.search=new URLSearchParams({name:'Stellenmonitor Redaktion',description:'Manuelle Stellenprüfung im Adaptation Dashboard',target_name:client.owner,expires_in:'30',contents:'write'});
 $('editor-token-link').href=link.href;
}else $('editor-connect').disabled=true;
authState();updateHistory();
})();
