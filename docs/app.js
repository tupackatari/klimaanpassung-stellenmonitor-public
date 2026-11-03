"use strict";
const D = JSON.parse(document.getElementById("dashboard-data").textContent);
const $ = id => document.getElementById(id);
const esc = value => String(value ?? "nicht angegeben").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const date = value => value ? new Intl.DateTimeFormat("de-DE",{timeZone:"Europe/Berlin",day:"2-digit",month:"2-digit",year:"numeric"}).format(new Date(value.length===10 ? `${value}T12:00:00+01:00` : value)) : "nicht angegeben";
const classes = {Klimaanpassung:"climate",Hitzeschutz:"heat",Hochwasser:"flood"};
const colors = {Klimaanpassung:"#26755b",Hitzeschutz:"#c16c3e",Hochwasser:"#367ea5"};
const tagHTML = tags => `<div class="tags">${tags.map(t=>`<span class="tag ${classes[t] || ""}">${esc(t)}</span>`).join("")}</div>`;
const locText = j => j.locations.length ? j.locations.map(l=>`${l.postcode ? l.postcode+" " : ""}${l.city}${l.state ? " · "+l.state : " · Bundesland nicht angegeben"}`).join("; ") : "Arbeitsort nicht angegeben";
const asText = value => Array.isArray(value) ? value.length ? value.join(", ") : "nicht angegeben" : value ?? "nicht angegeben";
function safeLink(url) {try {const u=new URL(url);return ["https:","http:"].includes(u.protocol) ? esc(u.href) : "#";} catch {return "#";}}
function row(name,value){return `<dt>${esc(name)}</dt><dd>${esc(asText(value))}</dd>`;}
function jobCard(j, review=false){return `<article class="job-card" data-job-id="${esc(j.id)}"><div class="card-date"><span>${j.publication_date ? "Veröffentlicht " : "Erstmals gesehen "}${date(j.monitoring.new_date)}</span><span>${j.monitoring.status === "abgelaufen" ? "Frist abgelaufen" : ""}</span></div><h3><a href="#${esc(j.id)}">${esc(j.title)}</a></h3><p class="employer">${esc(j.employer.name)}</p><p class="place">${esc(locText(j))}</p>${tagHTML(j.tags)}<div class="card-meta"><span>Frist: ${date(j.deadline)}</span><span class="role">${esc(review ? "Prüfung erforderlich" : j.topic.role)}</span></div>${review ? `<p class="subtle">${esc(j.review.reason)}</p><div class="review-actions"><button class="review-button yes" data-review="relevant" data-job="${esc(j.id)}">Ja, relevant</button><button class="review-button no" data-review="ausgeschlossen" data-job="${esc(j.id)}">Nein, ausschließen</button></div>` : ""}</article>`;}
function matching(j){return (!$('tag').value||j.tags.includes($('tag').value))&&(!$('state').value||j.locations.some(l=>l.state===$('state').value)||($('state').value==='unknown'&&!j.locations.some(l=>l.state)))&&(!$('role').value||j.topic.role===$('role').value);}
function setup(){
  document.title=D.title;
  $('collection-scope').textContent=D.demo ? '' : `Aktive Erhebung: ${(D.collection_scope || []).join(', ') || 'keine Quelle'}. ${(D.disabled_sources || []).map(s=>`${s.portal}: derzeit deaktiviert.`).join(' ')} Die Zahlen beziehen sich auf den erfassten Portalbestand.`;
  $('download-data').href=URL.createObjectURL(new Blob([JSON.stringify(D,null,2)],{type:'application/json'}));
  $('download-data').download='stellenmonitor-daten.json';
  if(D.demo){$('demo-banner').classList.remove('hidden');$('demo-banner').textContent="DEMO · Alle Anzeigen, Arbeitgeber und Zahlen in dieser Vorschau sind fiktive Testdaten. Sie werden nicht in den produktiven Bestand übernommen.";}
  for(const w of D.weeks){const opt=document.createElement('option');opt.value=w.key;opt.textContent=`KW ${w.key.split('W')[1]} · ${w.key.slice(0,4)}`;$('week').append(opt);}
  $('week').value=D.default_week;
  for(const [id,values] of [['tag',D.tags],['state',D.states],['role',D.roles]]){for(const value of values){const opt=document.createElement('option');opt.value=value;opt.textContent=value;$(id).append(opt);}}
  const unknown=document.createElement('option');unknown.value='unknown';unknown.textContent='Bundesland unbekannt';$('state').append(unknown);
  for(const id of ['week','tag','state','role'])$(id).addEventListener('change',render);
  $('reset').addEventListener('click',()=>{for(const id of ['tag','state','role'])$(id).value='';render();});
  $('close-detail').addEventListener('click',()=>{$('detail').close();history.replaceState(null,'',location.pathname+location.search);});
  $('detail').addEventListener('cancel',()=>history.replaceState(null,'',location.pathname+location.search));
  window.addEventListener('hashchange',showHash);
  const statuses=D.source_statuses || D.latest_run?.sources || [];
  $('source-status').innerHTML=statuses.map(s=>`<div class="source-row"><strong>${esc(s.portal)}</strong><span>${esc(s.status==='ok'?'Abruf vollständig':s.status==='disabled'?'deaktiviert':'Abruf unvollständig')} · ${s.details_ok} Detailseiten · ${date(s.observed_at)}</span></div>`).join('');
  $('data-time').textContent=`Website erstellt: ${date(D.generated_at)}. Letzter Erhebungslauf: ${date(D.latest_run?.started_at)}. Beginn des Bestands: ${date(D.first_run)}.`;
  $('operator').textContent=D.operator || '';
  if(D.contact){const a=document.createElement('a');a.href=safeLink(D.contact).replace(/&amp;/g,'&');a.textContent='Kontakt / Impressum';$('operator').append(' · ',a);}
  render();showHash();
}
function render(){
  const w=D.weeks.find(x=>x.key===$('week').value);if(!w)return;
  const weekly=D.jobs.filter(j=>j.review.status==='relevant' && j.monitoring.new_date>=w.monday && j.monitoring.new_date<=w.sunday);
  const selected=weekly.filter(matching).sort((a,b)=>b.monitoring.new_date.localeCompare(a.monitoring.new_date)||a.title.localeCompare(b.title,'de'));
  const stat={total:weekly.length,tags:Object.fromEntries(D.tags.map(t=>[t,weekly.filter(j=>j.tags.includes(t)).length])),known_positions:weekly.reduce((n,j)=>n+(j.scope.positions||0),0),unknown_positions_ads:weekly.filter(j=>j.scope.positions==null).length};
  $('week-dates').textContent=`Montag ${date(w.monday)} – Sonntag ${date(w.sunday)} · Europe/Berlin`;
  $('total').textContent=stat.total;
  const known=`${stat.known_positions} ausdrücklich bezifferte Positionen`;
  $('position-count').textContent=stat.unknown_positions_ads ? `${known}; Anzahl bei ${stat.unknown_positions_ads} Anzeigen unbekannt` : known;
  for(const [id,t] of [['tag-climate','Klimaanpassung'],['tag-heat','Hitzeschutz'],['tag-flood','Hochwasser']])$(id).textContent=stat.tags[t];
  const complete=w.coverage==='vollständiger Abruf' && D.latest_run?.complete;
  $('total-label').textContent=complete||D.demo?'NEUE STELLENAUSSCHREIBUNGEN':'ERFASSTE NEUE AUSSCHREIBUNGEN';
  $('coverage').classList.toggle('warning',!complete&&!D.demo);
  $('coverage').textContent=D.demo ? 'Funktionsvorschau mit fiktiven Beispielen. Filter, Liste, Detailansichten und Karte sind bedienbar.' : complete ? `Bestätigter Abruf der aktiven Quellen für diese Berichtswoche. Datenstand: ${date(D.latest_run.started_at)}.` : D.latest_run ? 'Unvollständige Quellenabdeckung oder kein bestätigter Abruf für diese Berichtswoche. Die Zahlen zeigen nur die bisher erfassten und als relevant eingestuften Anzeigen.' : 'Die Datenerhebung wurde noch nicht ausgeführt. Die angezeigte Null ist kein bestätigtes Suchergebnis.';
  $('list-count').textContent=`${selected.length} von ${weekly.length} Anzeigen`;
  $('list').innerHTML=selected.length ? selected.map(j=>jobCard(j)).join('') : `<div class="empty">${weekly.length ? 'Keine Anzeige passt zu diesen Filtern.' : 'Keine relevanten Anzeigen im bisherigen Wochenbestand.'}<span>${complete?'Für diese Woche liegen bestätigte Suchabrufe vor.':'Die Quellenabdeckung ist unvollständig oder noch nicht bestätigt.'}</span></div>`;
  const review=D.jobs.filter(j=>j.review.status==='Prüfung erforderlich'&&j.monitoring.new_date>=w.monday&&j.monitoring.new_date<=w.sunday);
  $('review-note').textContent=review.length ? `${review.length} weitere Treffer dieser Woche sind fachlich zu prüfen und noch nicht in den Zahlen enthalten.` : '';
  $('review-summary').textContent=`Prüfung erforderlich · ${review.length} Treffer dieser Woche`;
  $('reviews').className='reviews-grid';$('reviews').innerHTML=review.length ? review.map(j=>jobCard(j,true)).join('') : '<p class="subtle">Keine offenen Prüffälle in dieser Woche.</p>';
  $('review-summary').textContent=D.public_view?'Redaktion · geschützter Prüfbereich':`Prüfung erforderlich · ${review.length} Treffer dieser Woche`;
  if(D.public_view)$('reviews').innerHTML='<p>Offene Fälle und archivierte Volltexte sind nur nach Anmeldung zugänglich.</p>';
  renderMap(selected);
}
function project(lon,lat){return [35+(lon-5.7)*39.4,450-(lat-47.15)*56];}
function renderMap(jobs){
  const geometry=D.germany?.geometry;
  const polygons=geometry?.type==='Polygon'?[geometry.coordinates]:(geometry?.type==='MultiPolygon'?geometry.coordinates:[]);
  $('boundary').innerHTML=polygons.map(poly=>`<path class="boundary" d="${poly.map(ring=>ring.map((p,i)=>`${i?'L':'M'}${project(p[0],p[1]).map(v=>v.toFixed(2)).join(' ')}`).join(' ')+' Z').join(' ')}"/>`).join('');
  const grouped=new Map(), mapped=new Set();
  for(const j of jobs){for(const l of j.locations){if(!l.city||l.latitude==null||l.longitude==null||!l.coordinate_basis)continue;const key=`${l.latitude.toFixed(4)},${l.longitude.toFixed(4)}`;if(!grouped.has(key))grouped.set(key,{city:l.city,lat:l.latitude,lon:l.longitude,jobs:new Map(),tags:new Set()});const point=grouped.get(key);point.jobs.set(j.id,j);j.tags.forEach(t=>point.tags.add(t));mapped.add(j.id);}}
  const svgNS='http://www.w3.org/2000/svg';$('markers').replaceChildren();
  for(const point of grouped.values()){
    const [x,y]=project(point.lon,point.lat);const g=document.createElementNS(svgNS,'g');g.setAttribute('transform',`translate(${x} ${y})`);g.setAttribute('tabindex','0');g.setAttribute('role','button');g.setAttribute('aria-label',`${point.city}: ${point.jobs.size} Ausschreibungen, ${[...point.tags].join(', ')}`);g.classList.add('marker');
    const tags=[...point.tags].sort();const arcs=tags.map((t,i)=>{const start=i*360/tags.length-90,end=(i+1)*360/tags.length-90;const a=start*Math.PI/180,b=end*Math.PI/180;return tags.length===1?`<circle r="12" fill="none" stroke="${colors[t]}" stroke-width="4"/>`:`<path d="M ${12*Math.cos(a)} ${12*Math.sin(a)} A 12 12 0 ${end-start>180?1:0} 1 ${12*Math.cos(b)} ${12*Math.sin(b)}" fill="none" stroke="${colors[t]}" stroke-width="4"/>`;}).join('');
    g.innerHTML=`<circle r="15" class="marker-bg"/>${arcs}<text class="marker-count" y="1">${point.jobs.size}</text>`;
    const open=()=>{$('map-popup').innerHTML=`<strong>${esc(point.city)}</strong><ul>${[...point.jobs.values()].map(j=>`<li><a href="#${esc(j.id)}">${esc(j.title)}</a><br>${esc(j.employer.name)}</li>`).join('')}</ul>`;};g.addEventListener('click',open);g.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();open();}});$('markers').append(g);
  }
  $('map-popup').innerHTML='<p>Wähle einen Kartenpunkt, um die Ausschreibungen am Ort zu sehen.</p>';
  $('map-note').textContent=`${mapped.size} von ${jobs.length} Anzeigen verortet. ${jobs.length-mapped.size} ohne zuverlässige Koordinaten. Mehrere Arbeitsorte können mehrere Punkte ergeben; Anzeigen werden einmal gezählt.`;
}
function showHash(){
  let id;try{id=decodeURIComponent(location.hash.slice(1));}catch{return;}const j=D.jobs.find(x=>x.id===id);if(!j)return;
  const t=j.topic, f=j.funding, c=j.contract, m=j.monitoring;
  $('detail-content').innerHTML=`<h2>${esc(j.title)}</h2><p>${esc(j.employer.name)} · ${esc(locText(j))}</p>${tagHTML(j.tags)}${j.review.status==='Prüfung erforderlich'?`<p class="notice">Prüfung erforderlich: ${esc(j.review.reason)}</p>`:''}<h3>Thema und Aufgabenbezug</h3><p>${esc(t.summary)}</p><p>Einordnung: <strong>${esc(t.role)}</strong> · ${esc(t.classification_method)}</p>${t.evidence.map(s=>`<blockquote>${esc(s)}</blockquote>`).join('')}<dl>${row('Arbeitgebertyp',j.employer.type)}${row('Anzahl Stellen',j.scope.positions)}${row('Arbeitszeit',j.scope.work_time)}${row('Wochenstunden',j.scope.hours_per_week)}${j.scope.hours_options?.length?row('Wochenstunden nach Dienstverhältnis',j.scope.hours_options.map(o=>`${o.type==='BEAMTENVERHAELTNIS'?'Beamtenverhältnis':o.type==='ANGESTELLTENVERHAELTNIS'?'Angestelltenverhältnis':o.type}: ${o.hours_per_week} h`)):''}${row('Vertragsdauer',c.duration)}${row('Befristungsende',date(c.end_date))}${row('Arbeitsbeginn',c.start_date ? date(c.start_date) : c.start_text)}${row('Tarifvertrag',j.pay.agreements)}${row('Entgelt/Besoldung',j.pay.grades)}${row('Veröffentlicht',date(j.publication_date))}${row('Bewerbungsfrist',date(j.deadline))}${row('Anlass',j.reason.category)}${row('Anlass: Beleg',j.reason.evidence)}</dl><h3>Finanzierung</h3><dl>${row('Förderprogramm',f.program)}${row('Fördergeber',f.funder)}${row('Projektname',f.project)}${row('Andere Finanzierung',f.other)}</dl>${f.evidence.map(s=>`<blockquote>${esc(s)}</blockquote>`).join('')}<h3>Quellen</h3><ul class="source-list">${j.sources.map(s=>`<li><a href="${safeLink(s.url)}" target="_blank" rel="noopener">${esc(s.portal)} · Anzeigen-ID ${esc(s.ad_id)}</a>${s.reference?` · Kennziffer ${esc(s.reference)}`:''}<br>${s.retrieved_at?`Abgerufen ${date(s.retrieved_at)}`:esc(s.discovery || 'Quelle verlinkt')} · veröffentlicht ${date(s.publication_date)}</li>`).join('')}</ul>${j.full_text?`<h3>Volltext der erfassten Portalbeschreibung</h3><p class="subtle">Der bereinigte Text bleibt auch nach Ablauf der Anzeige erhalten. Enthält die Portalbeschreibung nur einen Auszug oder verweist sie auf ein externes Dokument, muss der vollständige Aufgabenbezug gegebenenfalls geprüft werden.</p><div class="fulltext">${esc(j.full_text)}</div>`:`<p class="subtle">Der vollständige Ausschreibungstext ist im privaten Archiv gespeichert. Die Originalanzeige ist unter Quellen verlinkt.</p>`}<h3>Monitoring</h3><dl>${row('Interne ID',j.id)}${row('Erstmals gesehen',m.first_seen)}${row('Zuletzt gesehen',m.last_seen)}${row('Aktueller Status',m.status)}${row('Letzte Änderung',m.last_changed)}${row('Grundlage für „neu“',m.new_basis==='publication_date'?'Veröffentlichungsdatum':'erste Sichtung')}${row('Datum für Wochenzuordnung',date(m.new_date))}${row('Prüfstatus',j.review.status)}${row('Einstufungsgrundlage',j.review.reason)}${row('Mögliche Dubletten',j.review.duplicate_candidates)}</dl>${j.text_history?.length?`<details><summary>${j.text_history.length} frühere Textfassungen</summary>${j.text_history.map(h=>`<h3>${esc(h.changed)}</h3><div class="fulltext">${esc(h.text)}</div>`).join('')}</details>`:''}${j.sources.filter(s=>s.full_text&&s.full_text!==j.full_text).map(s=>`<details><summary>Abweichender Volltext: ${esc(s.portal)}</summary><div class="fulltext">${esc(s.full_text)}</div></details>`).join('')}`;
  if(!$('detail').open)$('detail').showModal();
}
setup();
