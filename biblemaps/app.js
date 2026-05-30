const FULL = {"1 Chr":"1 Chronicles","1 Cor":"1 Corinthians","1 Kgs":"1 Kings","1 Pet":"1 Peter","1 Sam":"1 Samuel","1 Thes":"1 Thessalonians","1 Tim":"1 Timothy","2 Chr":"2 Chronicles","2 Cor":"2 Corinthians","2 Kgs":"2 Kings","2 Pet":"2 Peter","2 Sam":"2 Samuel","2 Tim":"2 Timothy","Acts":"Acts","Amos":"Amos","Col":"Colossians","Dan":"Daniel","Deut":"Deuteronomy","Eccl":"Ecclesiastes","Eph":"Ephesians","Est":"Esther","Ex":"Exodus","Ezek":"Ezekiel","Ezra":"Ezra","Gal":"Galatians","Gen":"Genesis","Hab":"Habakkuk","Hag":"Haggai","Heb":"Hebrews","Hos":"Hosea","Isa":"Isaiah","Jer":"Jeremiah","Job":"Job","Joel":"Joel","John":"John","Jonah":"Jonah","Josh":"Joshua","Jude":"Jude","Judg":"Judges","Lam":"Lamentations","Lev":"Leviticus","Luke":"Luke","Mal":"Malachi","Mark":"Mark","Matt":"Matthew","Mic":"Micah","Nahum":"Nahum","Neh":"Nehemiah","Num":"Numbers","Obad":"Obadiah","Phil":"Philippians","Ps":"Psalms","Rev":"Revelation","Rom":"Romans","Ruth":"Ruth","Sng":"Song of Solomon","Titus":"Titus","Zech":"Zechariah","Zeph":"Zephaniah"};

// Book numbers for bolls.life KJV (1=Genesis ... 66=Revelation)
const BNUM = {"Gen":1,"Ex":2,"Lev":3,"Num":4,"Deut":5,"Josh":6,"Judg":7,"Ruth":8,
"1 Sam":9,"2 Sam":10,"1 Kgs":11,"2 Kgs":12,"1 Chr":13,"2 Chr":14,"Ezra":15,"Neh":16,
"Est":17,"Job":18,"Ps":19,"Prov":20,"Eccl":21,"Sng":22,"Isa":23,"Jer":24,"Lam":25,
"Ezek":26,"Dan":27,"Hos":28,"Joel":29,"Amos":30,"Obad":31,"Jonah":32,"Mic":33,
"Nahum":34,"Hab":35,"Zeph":36,"Hag":37,"Zech":38,"Mal":39,"Matt":40,"Mark":41,
"Luke":42,"John":43,"Acts":44,"Rom":45,"1 Cor":46,"2 Cor":47,"Gal":48,"Eph":49,
"Phil":50,"Col":51,"1 Thes":52,"2 Thes":53,"1 Tim":54,"2 Tim":55,"Titus":56,
"Phlm":57,"Heb":58,"Jas":59,"1 Pet":60,"2 Pet":61,"1 John":62,"2 John":63,
"3 John":64,"Jude":65,"Rev":66};

/* ---- star persistence ---- */
let starred = new Set();
let firstLoad = false;
try {
  const s = localStorage.getItem('bible_stars');
  if (s) starred = new Set(JSON.parse(s));
  else firstLoad = true;
} catch (e) { firstLoad = true; }
function saveStars(){ try{ localStorage.setItem('bible_stars',JSON.stringify([...starred])); }catch(e){} }

/* ---- map + cycling basemap swatch ---- */
const MAX_ZOOM = 18; // one below tile max so we never request unavailable tiles
const map = L.map('map', {zoomControl:true, maxZoom: MAX_ZOOM}).setView([31.6, 35.2], 7);

const esriImagery = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
  {maxZoom:MAX_ZOOM, attribution:'Tiles © Esri'});
const esriLabels = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}',
  {maxZoom:MAX_ZOOM, pane:'overlayPane', opacity:0.95});
const esriTransport = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Transportation/MapServer/tile/{z}/{y}/{x}',
  {maxZoom:MAX_ZOOM, pane:'overlayPane', opacity:0.9});

const layers = [
  {
    name: 'Satellite',
    layer: L.layerGroup([esriImagery, esriTransport, esriLabels]),
    preview: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/3/3/4'
  },
  {
    name: 'Map',
    layer: L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
      {maxZoom:MAX_ZOOM, attribution:'© OpenStreetMap'}),
    preview: 'https://a.tile.openstreetmap.org/3/4/3.png'
  },
];
let layerIdx = 0;
layers[0].layer.addTo(map);
const swatch = document.getElementById('layerSwatch');
const layerLbl = document.getElementById('layerLbl');
function applySwatch(){
  const next = (layerIdx + 1) % layers.length;
  swatch.style.backgroundImage = `url("${layers[next].preview}")`;
  layerLbl.textContent = layers[next].name;
}
applySwatch();
swatch.onclick = () => {
  map.removeLayer(layers[layerIdx].layer);
  layerIdx = (layerIdx + 1) % layers.length;
  layers[layerIdx].layer.addTo(map);
  applySwatch();
};

/* ---- markers ---- */
const cluster = L.markerClusterGroup({maxClusterRadius:45});
map.addLayer(cluster);
const starLayer = L.layerGroup().addTo(map); // unclustered, always-on

const STAR_SVG = '<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path d="M12 2.5l2.9 5.9 6.5.95-4.7 4.58 1.1 6.47L12 17.9l-5.8 3.05 1.1-6.47-4.7-4.58 6.5-.95z"/></svg>';
const starIcon = L.divIcon({
  className: 'star-marker',
  html: STAR_SVG,
  iconSize: [22, 22],
  iconAnchor: [11, 11]
});

function circleStyle(){
  return {radius:6, color:'#7d1f16', weight:1.5, fillColor:'#c0392b', fillOpacity:.9};
}

const records = [];
const recordByKey = new Map();
const versesIndex = {}; // "Book Ch:Vs" -> [recordKey, ...]

function indexVerses(str, key){
  str.split(',').map(t => t.trim()).filter(Boolean).forEach(tok => {
    if (!/^.*?\s+\d+:\d+$/.test(tok)) return;
    (versesIndex[tok] = versesIndex[tok] || []).push(key);
  });
}

function buildRecords(data){
  records.length = 0;
  recordByKey.clear();
  for (const k in versesIndex) delete versesIndex[k];
  for (const key in data){
    const m = key.replace(/[()]/g,'').split(',');
    const lat = parseFloat(m[0]), lng = parseFloat(m[1]);
    if (isNaN(lat) || isNaN(lng)) continue;
    const [name, sub, verses, akas] = data[key];
    const rec = {key, lat, lng, name, sub, verses, akas};
    records.push(rec);
    recordByKey.set(key, rec);
    indexVerses(verses, key);
    if (akas) akas.forEach(a => indexVerses(a[2], key));
  }
  if (firstLoad){
    const j = records.find(r => r.name === 'Jerusalem');
    if (j){ starred.add(j.key); saveStars(); }
  }
  refresh();
}

let query = '';
function matches(r, q){
  if (!q) return true;
  if (r.name.toLowerCase().includes(q)) return true;
  return r.akas && r.akas.some(a => a[0].toLowerCase().includes(q));
}

function makeMarker(r){
  const isStar = starred.has(r.key);
  const m = isStar
    ? L.marker([r.lat, r.lng], {icon: starIcon})
    : L.circleMarker([r.lat, r.lng], circleStyle());
  m.bindTooltip(r.name, {direction:'top', offset:[0, isStar ? -10 : -6], sticky:false});
  m.on('click', () => openPanel(r));
  return m;
}

function refresh(){
  cluster.clearLayers();
  starLayer.clearLayers();
  let n = 0;
  records.forEach(r => {
    if (!matches(r, query)) return;
    const m = makeMarker(r);
    if (starred.has(r.key)) starLayer.addLayer(m);
    else cluster.addLayer(m);
    n++;
  });
  document.getElementById('count').textContent = n + ' / ' + records.length;
}

/* ---- live suggestions ---- */
const sg = document.getElementById('suggest');
function buildSuggestions(){
  if (!query){ sg.classList.remove('show'); sg.innerHTML=''; return; }
  const hits = [];
  for (const r of records){
    if (r.name.toLowerCase().includes(query)){
      hits.push({r, label:r.name, via:null, verses:r.verses});
    } else if (r.akas){
      for (const a of r.akas){
        if (a[0].toLowerCase().includes(query)){
          hits.push({r, label:a[0], via:r.name, verses:a[2]});
          break;
        }
      }
    }
    if (hits.length >= 12) break;
  }
  if (!hits.length){ sg.classList.remove('show'); sg.innerHTML=''; return; }
  sg.innerHTML = hits.map((h, i) =>
    `<div class="sg-item" data-i="${i}">
       <div><span class="sg-name">${h.label}</span>` +
       (h.via ? `<span class="sg-aka">→ ${h.via}</span>` : '') +
       `</div><div class="sg-verses">${h.verses}</div>
     </div>`).join('');
  sg.classList.add('show');
  sg._hits = hits;
}
sg.addEventListener('click', e => {
  const it = e.target.closest('.sg-item'); if (!it) return;
  const h = sg._hits[+it.dataset.i];
  map.setView([h.r.lat, h.r.lng], Math.max(map.getZoom(), 10), {animate:true});
  openPanel(h.r);
  sg.classList.remove('show');
});

/* ---- verse rendering + combining ---- */
function renderVerses(str){
  const toks = str.split(',').map(t => t.trim()).filter(Boolean);
  let prev = null;
  return toks.map(tok => {
    const m = tok.match(/^(.*?)\s+(\d+:\d+)$/);
    if (!m) return tok;
    const book = m[1], cv = m[2];
    const label = (book === prev) ? cv : tok;
    prev = book;
    return `<a class="verse" data-ref="${tok.replace(/"/g,'')}">${label}</a>`;
  }).join(', ');
}

/* ---- aka subtitle cleanup ---- */
function cleanAkaNote(note, mainName){
  if (!note) return '';
  // Remove " based on <mainName>" wherever it appears.
  const esc = mainName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  let s = note.replace(new RegExp('\\s*based on\\s+' + esc + '\\.?', 'i'), '').trim();
  // tidy any dangling punctuation/whitespace
  s = s.replace(/\s+/g, ' ').replace(/^[,;:.\s]+|[,;:\s]+$/g, '');
  return s;
}

/* ---- panel ---- */
let current = null;
const panel = document.getElementById('panel');
function openPanel(r){
  current = r;
  document.getElementById('pTitle').textContent = r.name;
  const subEl = document.getElementById('pSub');
  if (r.sub){ subEl.textContent = '(' + r.sub + ')'; subEl.style.display = 'inline'; }
  else { subEl.textContent = ''; subEl.style.display = 'none'; }
  panel.classList.add('with-swatch');
  document.getElementById('pStar').classList.toggle('on', starred.has(r.key));
  let html = `<div class="verses">${renderVerses(r.verses)}</div>`;
  if (r.akas && r.akas.length){
    html += `<div class="aka-label">Also known as</div>`;
    r.akas.forEach(a => {
      const [an, note, av] = a;
      const cleaned = cleanAkaNote(note, r.name);
      html += `<div class="subbox"><div><span class="aka-name">${an}</span>` +
        (cleaned ? `<span class="aka-note">${cleaned}</span>` : '') + `</div>` +
        `<div class="verses">${renderVerses(av)}</div></div>`;
    });
  }
  document.getElementById('pBody').innerHTML = html;
  panel.classList.add('show');
}
document.getElementById('pClose').onclick = () => {
  panel.classList.remove('show');
  panel.classList.remove('with-swatch');
};
document.getElementById('pStar').onclick = () => {
  if (!current) return;
  if (starred.has(current.key)) starred.delete(current.key); else starred.add(current.key);
  saveStars();
  document.getElementById('pStar').classList.toggle('on', starred.has(current.key));
  refresh();
};
document.getElementById('pBody').addEventListener('click', e => {
  const a = e.target.closest('a.verse'); if (!a) return;
  showVerse(a.dataset.ref);
});

/* ---- verse modal ---- */
const cache = {};
const ov = document.getElementById('ov');

/* If we ever get markup-bearing text (e.g. <i> for italics, <J> for Jesus
   words), we'll style it. bible-api.com returns plain text so this is a no-op,
   but it keeps the renderer ready for a markup-rich source later. */
function sanitizeKJV(rawHtml){
  const tpl = document.createElement('template');
  tpl.innerHTML = rawHtml;
  const out = [];
  function escText(t){ return t.replace(/[<>&]/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;'}[c])); }
  function walk(node){
    node.childNodes.forEach(n => {
      if (n.nodeType === 3){ out.push(escText(n.textContent)); return; }
      if (n.nodeType !== 1) return;
      const tag = n.tagName.toLowerCase();
      const cls = (n.getAttribute && n.getAttribute('class')) || '';
      const isJesus = tag === 'j' || /jesus|red|wj/i.test(cls)
        || (tag === 'font' && /red/i.test(n.getAttribute('color') || ''));
      if (tag === 'i' || tag === 'em'){
        out.push('<i>'); walk(n); out.push('</i>');
      } else if (isJesus){
        out.push('<span class="jesus">'); walk(n); out.push('</span>');
      } else if (tag === 's' || tag === 'sup' || /strong/i.test(cls)){
        // skip
      } else if (tag === 'br'){
        out.push('<br>');
      } else {
        walk(n);
      }
    });
  }
  walk(tpl.content);
  return out.join('').replace(/\s+/g, ' ').trim();
}

async function showVerse(ref){
  const m = ref.match(/^(.*?)\s+(\d+):(\d+)$/);
  const fullLabel = m ? (FULL[m[1]] || m[1]) + ' ' + m[2] + ':' + m[3] : ref;
  document.getElementById('mRef').textContent = fullLabel;
  const body = document.getElementById('mBody');
  body.className = 'm-body'; body.textContent = 'Loading…';
  ov.classList.add('show');

  function renderAlsoMentioned(){
    const sourceKey = current ? current.key : null;
    const seen = new Set();
    const others = (versesIndex[ref] || []).filter(k => {
      if (k === sourceKey || seen.has(k)) return false;
      seen.add(k); return true;
    });
    if (!others.length) return '';
    const links = others.map(k => {
      const rr = recordByKey.get(k);
      return `<a class="place-link" data-key="${k.replace(/"/g,'&quot;')}">${rr.name}</a>`;
    }).join(', ');
    return `<div class="also-mentioned">Also mentioned in this verse: ${links}</div>`;
  }

  if (cache[ref]){
    body.innerHTML = `<div class="verse-text">${cache[ref]}</div>` + renderAlsoMentioned();
    return;
  }
  if (!m){ body.className = 'm-body err'; body.textContent = 'Unrecognised reference.'; return; }
  const full = (FULL[m[1]] || m[1]) + ' ' + m[2] + ':' + m[3];
  try {
    const res = await fetch('https://bible-api.com/' + encodeURIComponent(full) + '?translation=kjv');
    if (!res.ok) throw new Error();
    const j = await res.json();
    const t = (j.text || '').trim();
    if (!t) throw new Error();
    // bible-api returns plain text; pass it through sanitizer for safety
    const html = sanitizeKJV(t);
    cache[ref] = html;
    body.innerHTML = `<div class="verse-text">${html}</div>` + renderAlsoMentioned();
  } catch (err){
    body.className = 'm-body err';
    body.textContent = "Can’t load this verse — you appear to be offline.";
  }
}
document.getElementById('mBody').addEventListener('click', e => {
  const a = e.target.closest('a.place-link');
  if (!a) return;
  const r = recordByKey.get(a.dataset.key);
  if (!r) return;
  ov.classList.remove('show');
  map.setView([r.lat, r.lng], Math.max(map.getZoom(), 10), {animate:true});
  openPanel(r);
});
document.getElementById('mClose').onclick = () => ov.classList.remove('show');
ov.addEventListener('click', e => { if (e.target === ov) ov.classList.remove('show'); });
document.addEventListener('keydown', e => {
  if (e.key === 'Escape'){
    ov.classList.remove('show');
    document.getElementById('infoOv').classList.remove('show');
  }
});

/* ---- info modal ---- */
const infoOv = document.getElementById('infoOv');
document.getElementById('infoBtn').onclick = () => infoOv.classList.add('show');
document.getElementById('infoClose').onclick = () => infoOv.classList.remove('show');
infoOv.addEventListener('click', e => { if (e.target === infoOv) infoOv.classList.remove('show'); });

/* ---- search controls ---- */
const searchEl = document.getElementById('search');
const clearBtn = document.getElementById('searchClear');
function setQuery(v){
  query = v.trim().toLowerCase();
  clearBtn.style.visibility = v ? 'visible' : 'hidden';
  refresh();
  buildSuggestions();
}
searchEl.addEventListener('input', e => setQuery(e.target.value));
searchEl.addEventListener('focus', buildSuggestions);
clearBtn.onclick = () => {
  searchEl.value = '';
  setQuery('');
  searchEl.focus();
};
setQuery(''); // sync clear-button visibility

document.addEventListener('click', e => {
  if (!e.target.closest('#bar')) document.getElementById('suggest').classList.remove('show');
});

/* ---- load data ---- */
fetch('result.json')
  .then(r => {
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return r.json();
  })
  .then(buildRecords)
  .catch(err => {
    document.getElementById('count').textContent = 'Failed to load result.json';
    console.error('Could not load result.json. If opening via file://, serve over HTTP instead (e.g. `python -m http.server`).', err);
  });
