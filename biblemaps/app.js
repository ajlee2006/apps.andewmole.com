const FULL = {"1 Chr":"1 Chronicles","1 Cor":"1 Corinthians","1 Kgs":"1 Kings","1 Pet":"1 Peter","1 Sam":"1 Samuel","1 Thes":"1 Thessalonians","1 Tim":"1 Timothy","2 Chr":"2 Chronicles","2 Cor":"2 Corinthians","2 Kgs":"2 Kings","2 Pet":"2 Peter","2 Sam":"2 Samuel","2 Tim":"2 Timothy","Acts":"Acts","Amos":"Amos","Col":"Colossians","Dan":"Daniel","Deut":"Deuteronomy","Eccl":"Ecclesiastes","Eph":"Ephesians","Est":"Esther","Ex":"Exodus","Ezek":"Ezekiel","Ezra":"Ezra","Gal":"Galatians","Gen":"Genesis","Hab":"Habakkuk","Hag":"Haggai","Heb":"Hebrews","Hos":"Hosea","Isa":"Isaiah","Jer":"Jeremiah","Job":"Job","Joel":"Joel","John":"John","Jonah":"Jonah","Josh":"Joshua","Jude":"Jude","Judg":"Judges","Lam":"Lamentations","Lev":"Leviticus","Luke":"Luke","Mal":"Malachi","Mark":"Mark","Matt":"Matthew","Mic":"Micah","Nahum":"Nahum","Neh":"Nehemiah","Num":"Numbers","Obad":"Obadiah","Phil":"Philippians","Ps":"Psalms","Rev":"Revelation","Rom":"Romans","Ruth":"Ruth","Sng":"Song of Solomon","Titus":"Titus","Zech":"Zechariah","Zeph":"Zephaniah"};

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
const map = L.map('map', {zoomControl:true}).setView([31.6, 35.2], 7);

// Preview tile at z=3, x=4, y=3 covers Mediterranean + Middle East — matches the
// visible area when the map first loads.
const layers = [
  {
    name: 'Map',
    layer: L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
      {maxZoom:19, attribution:'© OpenStreetMap'}),
    preview: 'https://a.tile.openstreetmap.org/3/4/3.png'
  },
  {
    name: 'Satellite',
    layer: L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
      {maxZoom:19, attribution:'Tiles © Esri'}),
    preview: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/3/3/4'
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
const records = [];

function mkStyle(isStar){
  return {radius:6, color:isStar?'#c79a2b':'#7d1f16', weight:isStar?3:1.5,
    fillColor:'#c0392b', fillOpacity:.9};
}

function buildRecords(data){
  records.length = 0;
  for (const key in data){
    const m = key.replace(/[()]/g,'').split(',');
    const lat = parseFloat(m[0]), lng = parseFloat(m[1]);
    if (isNaN(lat) || isNaN(lng)) continue;
    const [name, sub, verses, akas] = data[key];
    records.push({key, lat, lng, name, sub, verses, akas, marker:null});
  }
  if (firstLoad){
    const j = records.find(r => r.name === 'Jerusalem');
    if (j){ starred.add(j.key); saveStars(); }
  }
  records.forEach(r => {
    const cm = L.circleMarker([r.lat, r.lng], mkStyle(starred.has(r.key)));
    cm.on('click', () => openPanel(r));
    r.marker = cm;
  });
  refresh();
}

let starOnly = false, query = '';
function matches(r, q){
  if (!q) return true;
  if (r.name.toLowerCase().includes(q)) return true;
  return r.akas && r.akas.some(a => a[0].toLowerCase().includes(q));
}
function refresh(){
  cluster.clearLayers();
  let n = 0;
  records.forEach(r => {
    if (starOnly && !starred.has(r.key)) return;
    if (!matches(r, query)) return;
    r.marker.setStyle(mkStyle(starred.has(r.key)));
    cluster.addLayer(r.marker);
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
    if (starOnly && !starred.has(r.key)) continue;
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
      html += `<div class="subbox"><div><span class="aka-name">${an}</span>` +
        (note ? `<span class="aka-note">${note}</span>` : '') + `</div>` +
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
  current.marker.setStyle(mkStyle(starred.has(current.key)));
  if (starOnly) refresh();
};
document.getElementById('pBody').addEventListener('click', e => {
  const a = e.target.closest('a.verse'); if (!a) return;
  showVerse(a.dataset.ref);
});

/* ---- verse modal ---- */
const cache = {};
const ov = document.getElementById('ov');
async function showVerse(ref){
  const m = ref.match(/^(.*?)\s+(\d+):(\d+)$/);
  const fullLabel = m ? (FULL[m[1]] || m[1]) + ' ' + m[2] + ':' + m[3] : ref;
  document.getElementById('mRef').textContent = fullLabel;
  const body = document.getElementById('mBody');
  body.className = 'm-body'; body.textContent = 'Loading…';
  ov.classList.add('show');
  if (cache[ref]){ body.textContent = cache[ref]; return; }
  if (!m){ body.className = 'm-body err'; body.textContent = 'Unrecognised reference.'; return; }
  const full = (FULL[m[1]] || m[1]) + ' ' + m[2] + ':' + m[3];
  try {
    const res = await fetch('https://bible-api.com/' + encodeURIComponent(full) + '?translation=kjv');
    if (!res.ok) throw new Error();
    const j = await res.json();
    const t = (j.text || '').trim();
    if (!t) throw new Error();
    cache[ref] = t; body.textContent = t;
  } catch (err){
    body.className = 'm-body err';
    body.textContent = "Can’t load this verse — you appear to be offline.";
  }
}
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

/* ---- controls ---- */
document.getElementById('starFilter').onclick = function(){
  starOnly = !starOnly; this.classList.toggle('on', starOnly); refresh(); buildSuggestions();
};
document.getElementById('search').addEventListener('input', e => {
  query = e.target.value.trim().toLowerCase(); refresh(); buildSuggestions();
});
document.getElementById('search').addEventListener('focus', buildSuggestions);
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
