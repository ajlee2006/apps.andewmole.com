const FULL = {"1 Chr":"1 Chronicles","1 Cor":"1 Corinthians","1 John":"1 John","1 Kgs":"1 Kings","1 Pet":"1 Peter","1 Sam":"1 Samuel","1 Thes":"1 Thessalonians","1 Tim":"1 Timothy","2 Chr":"2 Chronicles","2 Cor":"2 Corinthians","2 John":"2 John","2 Kgs":"2 Kings","2 Pet":"2 Peter","2 Sam":"2 Samuel","2 Thes":"2 Thessalonians","2 Tim":"2 Timothy","3 John":"3 John","Acts":"Acts","Amos":"Amos","Col":"Colossians","Dan":"Daniel","Deut":"Deuteronomy","Eccl":"Ecclesiastes","Eph":"Ephesians","Est":"Esther","Ex":"Exodus","Ezek":"Ezekiel","Ezra":"Ezra","Gal":"Galatians","Gen":"Genesis","Hab":"Habakkuk","Hag":"Haggai","Heb":"Hebrews","Hos":"Hosea","Isa":"Isaiah","Jas":"James","Jer":"Jeremiah","Job":"Job","Joel":"Joel","John":"John","Jonah":"Jonah","Josh":"Joshua","Jude":"Jude","Judg":"Judges","Lam":"Lamentations","Lev":"Leviticus","Luke":"Luke","Mal":"Malachi","Mark":"Mark","Matt":"Matthew","Mic":"Micah","Nahum":"Nahum","Neh":"Nehemiah","Num":"Numbers","Obad":"Obadiah","Phil":"Philippians","Phlm":"Philemon","Prov":"Proverbs","Ps":"Psalms","Rev":"Revelation","Rom":"Romans","Ruth":"Ruth","Sng":"Song of Solomon","Titus":"Titus","Zech":"Zechariah","Zeph":"Zephaniah"};

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

/* ---- bible-api.com translations ----
   Acronyms are derived from each translation's identifier so they line up with
   what bible-api.com returns. Names match the API's `name` field verbatim. */
const TRANSLATIONS = [
  // English
  {id:'kjv',   acronym:'KJV',     name:'King James Version',                          lang:'English'},
  {id:'asv',   acronym:'ASV',     name:'American Standard Version (1901)',            lang:'English'},
  {id:'bbe',   acronym:'BBE',     name:'Bible in Basic English',                      lang:'English'},
  {id:'darby', acronym:'DARBY',   name:'Darby Bible',                                 lang:'English'},
  {id:'dra',   acronym:'DRA',     name:'Douay-Rheims 1899 American Edition',          lang:'English'},
  {id:'web',   acronym:'WEB',     name:'World English Bible',                         lang:'English'},
  {id:'ylt',   acronym:'YLT',     name:"Young's Literal Translation (NT only)",       lang:'English'},
  // English UK / US
  {id:'oeb-cw',acronym:'OEB-CW',  name:'Open English Bible, Commonwealth Edition',    lang:'English (UK)'},
  {id:'webbe', acronym:'WEBBE',   name:'World English Bible, British Edition',        lang:'English (UK)'},
  {id:'oeb-us',acronym:'OEB-US',  name:'Open English Bible, US Edition',              lang:'English (US)'},
  // Others
  {id:'cherokee',  acronym:'CHEROKEE',   name:'Cherokee New Testament',                              lang:'Cherokee'},
  {id:'cuv',       acronym:'CUV',        name:'Chinese Union Version',                               lang:'Chinese'},
  {id:'bkr',       acronym:'BKR',        name:'Bible kralická',                                      lang:'Czech'},
  {id:'clementine',acronym:'CLEMENTINE', name:'Clementine Latin Vulgate',                            lang:'Latin'},
  {id:'almeida',   acronym:'ALMEIDA',    name:'João Ferreira de Almeida',                            lang:'Portuguese'},
  {id:'rccv',      acronym:'RCCV',       name:'Protestant Romanian Corrected Cornilescu Version',    lang:'Romanian'},
  {id:'synodal',   acronym:'SYNODAL',    name:'Russian Synodal Translation',                         lang:'Russian'},
];
const TR_BY_ID = Object.fromEntries(TRANSLATIONS.map(t => [t.id, t]));
function findTranslation(token){
  if (!token) return null;
  const k = token.toLowerCase();
  return TRANSLATIONS.find(t => t.id.toLowerCase() === k || t.acronym.toLowerCase() === k) || null;
}

let currentVersion = 'kjv';
try {
  const saved = localStorage.getItem('bible_version');
  if (saved && TR_BY_ID[saved]) currentVersion = saved;
} catch(e){}

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
let selectedRecord = null; // place whose marker should be drawn selected

function setSelected(r){
  const prev = selectedRecord;
  selectedRecord = r;
  // Just rebuild the affected markers. Cheap, and avoids tracking individual
  // marker references across cluster/star layers.
  if (prev && prev !== r) rebuildMarker(prev);
  if (r) rebuildMarker(r);
}

const recordMarkers = new Map(); // key -> current Leaflet marker
function rebuildMarker(r){
  const old = recordMarkers.get(r.key);
  if (old){
    starLayer.removeLayer(old);
    cluster.removeLayer(old);
  }
  if (matches(r, query)){
    const m = makeMarker(r);
    // Selected marker bypasses clustering so it always stays visible, with
    // its label and selection highlight intact at any zoom level.
    const isSelected = selectedRecord && selectedRecord.key === r.key;
    if (isSelected || starred.has(r.key)) starLayer.addLayer(m);
    else cluster.addLayer(m);
    recordMarkers.set(r.key, m);
  } else {
    recordMarkers.delete(r.key);
  }
}

const STAR_SVG = '<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path d="M12 2.5l2.9 5.9 6.5.95-4.7 4.58 1.1 6.47L12 17.9l-5.8 3.05 1.1-6.47-4.7-4.58 6.5-.95z"/></svg>';

function circleStyle(selected){
  return selected
    ? {radius:7, color:'#facc15', weight:3, fillColor:'#c0392b', fillOpacity:.95}
    : {radius:6, color:'#7d1f16', weight:1.5, fillColor:'#c0392b', fillOpacity:.9};
}

/* Places mentioned in scripture whose location isn't known. Shown in the
   "Also mentioned" lists with a tooltip rather than a link, and in the
   search suggestions below all located places (greyed and unclickable). */
const UNLOCATED_PLACES = [
  {name: 'Azazel',              verses: 'Lev 16:8, Lev 16:10, Lev 16:26'},
  {name: 'Eden',                verses: 'Gen 2:8, Gen 2:10, Gen 2:15, Gen 3:23, Gen 3:24, Gen 4:16, 2 Kgs 19:12, Isa 37:12, Isa 51:3, Ezek 27:23, Ezek 28:13, Ezek 31:9, Ezek 31:16, Ezek 31:18, Ezek 36:35, Joel 2:3'},
  {name: 'Abel-mizraim',        verses: 'Gen 50:11'},
  {name: 'Addon',               verses: 'Neh 7:61'},
  {name: 'Atad',                verses: 'Gen 50:10, Gen 50:11'},
  {name: 'Athach',              verses: '1 Sam 30:30'},
  {name: 'Beth-ashbea',         verses: '1 Chr 4:21'},
  {name: 'Eglath-shelishiyah',  verses: 'Isa 15:5, Jer 48:34'},
  {name: 'Elkosh',              verses: 'Nahum 1:1'},
  {name: 'Gihon 1',             verses: 'Gen 2:13'},
  {name: 'Goiim',               verses: 'Gen 14:1, Gen 14:9, Josh 12:23'},
  {name: 'Gomer',               verses: 'Ezek 38:6'},
  {name: 'Havilah 1',           verses: 'Gen 2:11'},
  {name: 'Hazor 5',             verses: 'Jer 49:28, Jer 49:30, Jer 49:33'},
  {name: 'Holy Place 1',        verses: 'Ex 26:33, Ex 28:29, Ex 28:35, Ex 28:43, Ex 29:30, Ex 31:11, Ex 35:19, Ex 39:1, Ex 39:41, Lev 6:30, Lev 16:2, Lev 16:3, Lev 16:16, Lev 16:17, Lev 16:20, Lev 16:23, Lev 16:27, Num 28:7'},
  {name: 'Most Holy',           verses: 'Ex 26:33'},
  {name: 'Most Holy Place 1',   verses: 'Ex 26:34'},
  {name: 'Nehelam',             verses: 'Jer 29:24, Jer 29:31, Jer 29:32'},
  {name: 'Nod',                 verses: 'Gen 4:16'},
  {name: 'Parvaim',             verses: '2 Chr 3:6'},
  {name: 'Pishon',              verses: 'Gen 2:11'},
  {name: 'South',               verses: 'Zech 7:7, Matt 12:42, Luke 11:31'},
];

const records = [];
const recordByKey = new Map();
const versesIndex = {}; // "Book Ch:Vs" -> [{key, name, unlocated?}, ...]
const recordBooks = new Map(); // key -> Set<USFM book codes>

function indexVerses(str, key, displayName, unlocated){
  str.split(',').map(t => t.trim()).filter(Boolean).forEach(tok => {
    const m = tok.match(/^(.*?)\s+\d+:\d+$/);
    if (!m) return;
    (versesIndex[tok] = versesIndex[tok] || []).push({
      key, name: displayName, unlocated: !!unlocated
    });
    if (!unlocated){
      const usfm = USFM[m[1]];
      if (usfm){
        let s = recordBooks.get(key);
        if (!s){ s = new Set(); recordBooks.set(key, s); }
        s.add(usfm);
      }
    }
  });
}

function buildRecords(data){
  records.length = 0;
  recordByKey.clear();
  recordBooks.clear();
  for (const k in versesIndex) delete versesIndex[k];
  for (const key in data){
    const m = key.replace(/[()]/g,'').split(',');
    const lat = parseFloat(m[0]), lng = parseFloat(m[1]);
    if (isNaN(lat) || isNaN(lng)) continue;
    const [name, sub, verses, akas] = data[key];
    const rec = {key, lat, lng, name, sub, verses, akas};
    records.push(rec);
    recordByKey.set(key, rec);
    indexVerses(verses, key, name, false);
    if (akas) akas.forEach(a => indexVerses(a[2], key, a[0], false));
  }
  // Index unlocated places last so they appear after located places in the
  // "also mentioned" list (which preserves insertion order).
  UNLOCATED_PLACES.forEach(p => {
    indexVerses(p.verses, 'unloc:' + p.name, p.name, true);
  });
  if (firstLoad){
    const j = records.find(r => r.name === 'Jerusalem');
    if (j){ starred.add(j.key); saveStars(); }
  }
  recomputePlaceCounts();
  refresh();
}

let query = '';
let bookFilter = null; // null = no filter; otherwise Set<USFM>. starred always pass
function matches(r, q){
  // Book filter (starred always shown regardless of filter).
  if (bookFilter && !starred.has(r.key)){
    const books = recordBooks.get(r.key);
    let any = false;
    if (books){
      for (const b of books){ if (bookFilter.has(b)){ any = true; break; } }
    }
    if (!any) return false;
  }
  if (!q) return true;
  if (r.name.toLowerCase().includes(q)) return true;
  return r.akas && r.akas.some(a => a[0].toLowerCase().includes(q));
}

function makeMarker(r){
  const isStar = starred.has(r.key);
  const isSelected = selectedRecord && selectedRecord.key === r.key;
  let m;
  if (isStar){
    const icon = L.divIcon({
      className: 'star-marker' + (isSelected ? ' selected' : ''),
      html: STAR_SVG,
      iconSize: [22, 22],
      iconAnchor: [11, 11]
    });
    m = L.marker([r.lat, r.lng], {icon});
  } else {
    m = L.circleMarker([r.lat, r.lng], circleStyle(isSelected));
  }
  const offsetY = isStar ? -10 : -6;
  m.bindTooltip(r.name, {
    direction:'top',
    offset:[0, offsetY],
    sticky:false,
    permanent: isSelected,
    className: isSelected ? 'persistent-tip' : ''
  });
  m.on('click', () => openPanel(r));
  // When the user hovers any non-selected marker, hide the selected marker's
  // permanent tooltip so the two don't overlap; restore on mouseout.
  if (!isSelected){
    m.on('mouseover', hideSelectedTooltip);
    m.on('mouseout', showSelectedTooltip);
  }
  return m;
}

function hideSelectedTooltip(){
  if (!selectedRecord) return;
  const sm = recordMarkers.get(selectedRecord.key);
  if (sm && sm.getTooltip()) sm.closeTooltip();
}
function showSelectedTooltip(){
  if (!selectedRecord) return;
  const sm = recordMarkers.get(selectedRecord.key);
  if (sm && sm.getTooltip()) sm.openTooltip();
}

function refresh(){
  cluster.clearLayers();
  starLayer.clearLayers();
  recordMarkers.clear();
  let n = 0;
  records.forEach(r => {
    if (!matches(r, query)) return;
    const m = makeMarker(r);
    const isSelected = selectedRecord && selectedRecord.key === r.key;
    if (isSelected || starred.has(r.key)) starLayer.addLayer(m);
    else cluster.addLayer(m);
    recordMarkers.set(r.key, m);
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
  // Append unlocated matches at the end. They're greyed and unclickable.
  for (const p of UNLOCATED_PLACES){
    if (hits.length >= 16) break;
    if (p.name.toLowerCase().includes(query)){
      hits.push({unlocated:true, label:p.name, verses:p.verses});
    }
  }
  if (!hits.length){ sg.classList.remove('show'); sg.innerHTML=''; return; }
  sg.innerHTML = hits.map((h, i) => {
    const verses = combineVerses(h.verses);
    if (h.unlocated){
      return `<div class="sg-item unloc" data-i="${i}">
        <div><span class="sg-name">${h.label}</span><span class="sg-aka">Location unknown</span></div>
        <div class="sg-verses">${verses}</div>
      </div>`;
    }
    return `<div class="sg-item" data-i="${i}">
       <div><span class="sg-name">${h.label}</span>` +
       (h.via ? `<span class="sg-aka">→ ${h.via}</span>` : '') +
       `</div><div class="sg-verses">${verses}</div>
     </div>`;
  }).join('');
  sg.classList.add('show');
  sg._hits = hits;
}
sg.addEventListener('click', e => {
  const it = e.target.closest('.sg-item'); if (!it) return;
  const h = sg._hits[+it.dataset.i];
  if (!h || h.unlocated) return; // unlocated items can't be opened
  map.setView([h.r.lat, h.r.lng], Math.max(map.getZoom(), 10), {animate:true});
  openPanel(h.r);
  sg.classList.remove('show');
});

/* Combine consecutive references from the same book:
   "Josh 19:26, Josh 21:30" -> "Josh 19:26, 21:30".
   Returns plain combined text (no links). */
function combineVerses(str){
  let prev = null;
  return str.split(',').map(t => t.trim()).filter(Boolean).map(tok => {
    const m = tok.match(/^(.*?)\s+(\d+:\d+)$/);
    if (!m) return tok;
    const book = m[1], cv = m[2];
    const label = (book === prev) ? cv : tok;
    prev = book;
    return label;
  }).join(', ');
}

/* ---- verse rendering + combining ---- */
function renderVerses(str, sourceName){
  const srcAttr = sourceName ? ` data-src="${String(sourceName).replace(/"/g,'&quot;')}"` : '';
  const toks = str.split(',').map(t => t.trim()).filter(Boolean);
  let prev = null;
  return toks.map(tok => {
    const m = tok.match(/^(.*?)\s+(\d+:\d+)$/);
    if (!m) return tok;
    const book = m[1], cv = m[2];
    const label = (book === prev) ? cv : tok;
    prev = book;
    return `<a class="verse" data-ref="${tok.replace(/"/g,'')}"${srcAttr}>${label}</a>`;
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
  // Image (from openbible.info). Try the canonical name first, then any AKA.
  let imgEntry = placeImages[r.name];
  if (!imgEntry && r.akas){
    for (const a of r.akas){
      if (placeImages[a[0]]){ imgEntry = placeImages[a[0]]; break; }
    }
  }
  let html = '';
  if (imgEntry){
    const atlas = imgEntry.atlas
      ? `<a class="p-img-link" href="${imgEntry.atlas}" target="_blank" rel="noopener" title="View on OpenBible.info">↗</a>`
      : '';
    html += `<div class="p-img-wrap${imagesHidden ? ' hidden' : ''}">
      <img class="p-img" src="${imgEntry.img}" alt="" loading="lazy">
      <button class="p-img-toggle" type="button" title="${imagesHidden ? 'Show image' : 'Hide image'}">${imagesHidden ? 'Show image' : 'Hide image'}</button>
      ${atlas}
    </div>`;
  }
  html += `<div class="verses">${renderVerses(r.verses, r.name)}</div>`;
  if (r.akas && r.akas.length){
    html += `<div class="aka-label">Also known as</div>`;
    r.akas.forEach(a => {
      const [an, note, av] = a;
      const cleaned = cleanAkaNote(note, r.name);
      html += `<div class="subbox"><div><span class="aka-name">${an}</span>` +
        (cleaned ? `<span class="aka-note">${cleaned}</span>` : '') + `</div>` +
        `<div class="verses">${renderVerses(av, an)}</div></div>`;
    });
  }
  document.getElementById('pBody').innerHTML = html;
  panel.classList.add('show');
  setSelected(r);
  // Centre the marker in the area not covered by the panel/modal. Run after
  // layout settles, and again once the image loads (because the panel grows).
  requestAnimationFrame(() => centerOnVisibleArea(r.lat, r.lng));
  const img = document.querySelector('#pBody .p-img');
  if (img && !img.complete){
    img.addEventListener('load',  () => centerOnVisibleArea(r.lat, r.lng), {once:true});
    img.addEventListener('error', () => centerOnVisibleArea(r.lat, r.lng), {once:true});
  }
  // Only push history if this is actually a new view.
  const cur = history.state;
  if (!cur || cur.loc !== r.name || cur.ref){
    pushState({ loc: r.name });
  }
}

/* Pan so (lat,lng) sits in the centre of the part of the map that isn't
   covered by the place panel, the verse modal, or the search bar. Uses the
   actual on-screen rectangles, so it Just Works whether the panel is on the
   side (desktop) or the bottom (mobile), and whether the modal is open. */
function centerOnVisibleArea(lat, lng){
  const mapEl = document.getElementById('map');
  const mapRect = mapEl.getBoundingClientRect();
  // Visible window starts as the full map and shrinks as overlays clip it.
  let top    = mapRect.top;
  let bottom = mapRect.bottom;
  let left   = mapRect.left;
  let right  = mapRect.right;

  function clip(el){
    if (!el) return;
    // Only clip if the element is actually shown.
    const s = getComputedStyle(el);
    if (s.display === 'none' || s.visibility === 'hidden') return;
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return;
    // Choose the axis along which this overlay clips the map. We treat each
    // overlay as occupying its full horizontal or vertical band on the side
    // closest to the map edge it sits against.
    const verticalSpan   = (r.bottom - r.top);
    const horizontalSpan = (r.right - r.left);
    if (verticalSpan / mapRect.height > horizontalSpan / mapRect.width){
      // Tall overlay — clip horizontally.
      if (r.left - mapRect.left < mapRect.right - r.right){
        left = Math.max(left, r.right);
      } else {
        right = Math.min(right, r.left);
      }
    } else {
      // Wide overlay — clip vertically.
      if (r.top - mapRect.top < mapRect.bottom - r.bottom){
        top = Math.max(top, r.bottom);
      } else {
        bottom = Math.min(bottom, r.top);
      }
    }
  }

  const panelEl = document.getElementById('panel');
  if (panelEl && panelEl.classList.contains('show')) clip(panelEl);
  const modal = document.querySelector('#ov.show .modal');
  if (modal) clip(modal);
  const bar = document.getElementById('bar');
  if (bar) clip(bar);

  // Centre of the remaining (visible) rectangle, in map-container coords.
  const cx = (left + right) / 2 - mapRect.left;
  const cy = (top + bottom) / 2 - mapRect.top;

  // Pixel position of the target point relative to the map container.
  const target = map.latLngToContainerPoint([lat, lng]);
  const dx = target.x - cx;
  const dy = target.y - cy;
  if (Math.abs(dx) < 4 && Math.abs(dy) < 4) return; // already close enough
  map.panBy([dx, dy], {animate:true});
}
document.getElementById('pClose').onclick = () => {
  // Close in place — different from the browser back button, which would
  // return to whatever was open before. The × is a "dismiss" action.
  panel.classList.remove('show');
  panel.classList.remove('with-swatch');
  current = null;
  setSelected(null);
  replaceState({});
};
document.getElementById('pStar').onclick = () => {
  if (!current) return;
  if (starred.has(current.key)) starred.delete(current.key); else starred.add(current.key);
  saveStars();
  document.getElementById('pStar').classList.toggle('on', starred.has(current.key));
  refresh();
  // refresh() rebuilds markers, so reassert the selection ring on top.
  setSelected(current);
};
document.getElementById('pBody').addEventListener('click', e => {
  const tog = e.target.closest('.p-img-toggle');
  if (tog){
    imagesHidden = !imagesHidden;
    try { localStorage.setItem('bible_images_hidden', imagesHidden ? '1' : '0'); } catch(_){}
    const wrap = tog.closest('.p-img-wrap');
    wrap.classList.toggle('hidden', imagesHidden);
    tog.textContent = imagesHidden ? 'Show image' : 'Hide image';
    tog.title = tog.textContent;
    return;
  }
  const a = e.target.closest('a.verse'); if (!a) return;
  showVerse(a.dataset.ref, a.dataset.src || null);
});

/* ---- verse modal ---- */
/* Use bible-api.com's parameterized API: /data/{trans}/{USFM}/{chapter}.
   It accepts language-neutral USFM book codes, so non-English translations
   work (e.g. CUV) where the user-input API would 404 on "2 Kings". We fetch
   chapters and cache them so multiple verses from the same chapter cost one
   network call. */
const USFM = {
  "Gen":"GEN","Ex":"EXO","Lev":"LEV","Num":"NUM","Deut":"DEU","Josh":"JOS",
  "Judg":"JDG","Ruth":"RUT","1 Sam":"1SA","2 Sam":"2SA","1 Kgs":"1KI","2 Kgs":"2KI",
  "1 Chr":"1CH","2 Chr":"2CH","Ezra":"EZR","Neh":"NEH","Est":"EST","Job":"JOB",
  "Ps":"PSA","Prov":"PRO","Eccl":"ECC","Sng":"SNG","Isa":"ISA","Jer":"JER",
  "Lam":"LAM","Ezek":"EZK","Dan":"DAN","Hos":"HOS","Joel":"JOL","Amos":"AMO",
  "Obad":"OBA","Jonah":"JON","Mic":"MIC","Nahum":"NAM","Hab":"HAB","Zeph":"ZEP",
  "Hag":"HAG","Zech":"ZEC","Mal":"MAL","Matt":"MAT","Mark":"MRK","Luke":"LUK",
  "John":"JHN","Acts":"ACT","Rom":"ROM","1 Cor":"1CO","2 Cor":"2CO","Gal":"GAL",
  "Eph":"EPH","Phil":"PHP","Col":"COL","1 Thes":"1TH","2 Thes":"2TH","1 Tim":"1TI",
  "2 Tim":"2TI","Titus":"TIT","Phlm":"PHM","Heb":"HEB","Jas":"JAS","1 Pet":"1PE",
  "2 Pet":"2PE","1 John":"1JN","2 John":"2JN","3 John":"3JN","Jude":"JUD","Rev":"REV"
};

const USFM_TO_ABBR = Object.fromEntries(Object.entries(USFM).map(([k,v]) => [v,k]));
const CANON_ORDER = ['GEN','EXO','LEV','NUM','DEU','JOS','JDG','RUT','1SA','2SA','1KI','2KI','1CH','2CH','EZR','NEH','EST','JOB','PSA','PRO','ECC','SNG','ISA','JER','LAM','EZK','DAN','HOS','JOL','AMO','OBA','JON','MIC','NAM','HAB','ZEP','HAG','ZEC','MAL','MAT','MRK','LUK','JHN','ACT','ROM','1CO','2CO','GAL','EPH','PHP','COL','1TH','2TH','1TI','2TI','TIT','PHM','HEB','JAS','1PE','2PE','1JN','2JN','3JN','JUD','REV'];
const OT_USFM = new Set(CANON_ORDER.slice(0, 39));
const VERSE_COUNTS = {"GEN":[31,25,24,26,32,22,24,22,29,32,32,20,18,24,21,16,27,33,38,18,34,24,20,67,34,35,46,22,35,43,55,32,20,31,29,43,36,30,23,23,57,38,34,34,28,34,31,22,33,26],"EXO":[22,25,22,31,23,30,25,32,35,29,10,51,22,31,27,36,16,27,25,26,36,31,33,18,40,37,21,43,46,38,18,35,23,35,35,38,29,31,43,38],"LEV":[17,16,17,35,19,30,38,36,24,20,47,8,59,57,33,34,16,30,37,27,24,33,44,23,55,46,34],"NUM":[54,34,51,49,31,27,89,26,23,36,35,16,33,45,41,50,13,32,22,29,35,41,30,25,18,65,23,31,40,16,54,42,56,29,34,13],"DEU":[46,37,29,49,33,25,26,20,29,22,32,32,18,29,23,22,20,22,21,20,23,30,25,22,19,19,26,68,29,20,30,52,29,12],"JOS":[18,24,17,24,15,27,26,35,27,43,23,24,33,15,63,10,18,28,51,9,45,34,16,33],"JDG":[36,23,31,24,31,40,25,35,57,18,40,15,25,20,20,31,13,31,30,48,25],"RUT":[22,23,18,22],"1SA":[28,36,21,22,12,21,17,22,27,27,15,25,23,52,35,23,58,30,24,43,15,23,29,22,44,25,12,25,11,31,13],"2SA":[27,32,39,12,25,23,29,18,13,19,27,31,39,33,37,23,29,33,43,26,22,51,39,25],"1KI":[53,46,28,34,18,38,51,66,28,29,43,33,34,31,34,34,24,46,21,43,29,54],"2KI":[18,25,27,44,27,33,20,29,37,36,21,21,25,29,38,20,41,37,37,21,26,20,37,20,30],"1CH":[54,55,24,43,26,81,40,40,44,14,47,40,14,17,29,43,27,17,19,8,30,19,32,31,31,32,34,21,30],"2CH":[17,18,17,22,14,42,22,18,31,19,23,16,22,15,19,14,19,34,11,37,20,12,21,27,28,23,9,27,36,27,21,33,25,33,27,23],"EZR":[11,70,13,24,17,22,28,36,15,44],"NEH":[11,20,32,23,19,19,73,18,38,39,36,47,31],"EST":[22,23,15,17,14,14,10,17,32,3],"JOB":[22,13,26,21,27,30,21,22,35,22,20,25,28,22,35,22,16,21,29,29,34,30,17,25,6,14,23,28,25,31,40,22,33,37,16,33,24,41,30,24,34,17],"PSA":[6,12,8,8,12,10,17,9,20,18,7,8,6,7,5,11,15,50,14,9,13,31,6,10,22,12,14,9,11,12,24,11,22,22,28,12,40,22,13,17,13,11,5,26,17,11,9,14,20,23,19,9,6,7,23,13,11,11,17,12,8,12,11,10,13,20,7,35,36,5,24,20,28,23,10,12,20,72,13,19,16,8,18,12,13,17,7,18,52,17,16,15,5,23,11,13,12,9,9,5,8,28,22,35,45,48,43,13,31,7,10,10,9,8,18,19,2,29,176,7,8,9,4,8,5,6,5,6,8,8,3,18,3,3,21,26,9,8,24,13,10,7,12,15,21,10,20,14,9,6],"PRO":[33,22,35,27,23,35,27,36,18,32,31,28,25,35,33,33,28,24,29,30,31,29,35,34,28,28,27,28,27,33,31],"ECC":[18,26,22,16,20,12,29,17,18,20,10,14],"SNG":[17,17,11,16,16,13,13,14],"ISA":[31,22,26,6,30,13,25,22,21,34,16,6,22,32,9,14,14,7,25,6,17,25,18,23,12,21,13,29,24,33,9,20,24,17,10,22,38,22,8,31,29,25,28,28,25,13,15,22,26,11,23,15,12,17,13,12,21,14,21,22,11,12,19,12,25,24],"JER":[19,37,25,31,31,30,34,22,26,25,23,17,27,22,21,21,27,23,15,18,14,30,40,10,38,24,22,17,32,24,40,44,26,22,19,32,21,28,18,16,18,22,13,30,5,28,7,47,39,46,64,34],"LAM":[22,22,66,22,22],"EZK":[28,10,27,17,17,14,27,18,11,22,25,28,23,23,8,63,24,32,14,49,32,31,49,27,17,21,36,26,21,26,18,32,33,31,15,38,28,23,29,49,26,20,27,31,25,24,23,35],"DAN":[21,49,30,37,31,28,28,27,27,21,45,13],"HOS":[11,23,5,19,15,11,16,14,17,15,12,14,16,9],"JOL":[20,32,21],"AMO":[15,16,15,13,27,14,17,14,15],"OBA":[21],"JON":[17,10,10,11],"MIC":[16,13,12,13,15,16,20],"NAM":[15,13,19],"HAB":[17,20,19],"ZEP":[18,15,20],"HAG":[15,23],"ZEC":[21,13,10,14,11,15,14,23,17,12,17,14,9,21],"MAL":[14,17,18,6],"MAT":[25,22,17,25,48,34,29,34,38,42,30,50,58,36,39,28,27,35,30,34,46,45,39,51,46,74,66,20],"MRK":[45,28,35,40,43,56,36,37,50,52,33,44,37,72,47,20],"LUK":[80,52,38,44,39,49,50,56,62,42,54,59,35,35,32,31,37,43,48,47,38,71,56,53],"JHN":[51,25,36,54,47,71,53,59,41,42,57,50,38,31,27,33,26,40,42,31,25],"ACT":[26,47,26,37,42,15,60,40,43,48,30,25,52,28,41,40,34,28,41,38,40,30,35,27,27,32,44,31],"ROM":[32,29,31,25,21,23,25,39,33,21,36,21,14,23,33,27],"1CO":[31,16,23,21,13,20,40,13,27,33,34,31,13,40,58,24],"2CO":[24,17,18,18,21,18,16,24,15,18,33,21,14],"GAL":[24,21,29,31,26,18],"EPH":[23,22,21,32,33,24],"PHP":[30,30,21,23],"COL":[29,23,25,18],"1TH":[10,20,13,18,28],"2TH":[12,17,18],"1TI":[20,15,16,16,25,21],"2TI":[18,26,17,22],"TIT":[16,15,15],"PHM":[25],"HEB":[14,18,19,16,14,20,28,13,28,39,40,29,25],"JAS":[27,26,18,17,20],"1PE":[25,25,22,19,14],"2PE":[21,22,18],"1JN":[10,29,24,21,21],"2JN":[13],"3JN":[15],"JUD":[25],"REV":[20,29,22,11,14,17,17,13,21,11,19,18,18,20,8,21,18,24,21,15,27,21]};

const LOCALIZED_BOOKS = {"cuv":{"GEN":"\u5275\u4e16\u7d00","EXO":"\u51fa\u57c3\u53ca\u8a18","LEV":"\u5229\u672a\u8a18","NUM":"\u6c11\u6578\u8a18","DEU":"\u7533\u547d\u8a18","JOS":"\u7d04\u66f8\u4e9e\u8a18","JDG":"\u58eb\u5e2b\u8a18","RUT":"\u8def\u5f97\u8a18","1SA":"\u6492\u6bcd\u8033\u8a18\u4e0a","2SA":"\u6492\u6bcd\u8033\u8a18\u4e0b","1KI":"\u5217\u738b\u7d00\u4e0a","2KI":"\u5217\u738b\u7d00\u4e0b","1CH":"\u6b77\u4ee3\u5fd7\u4e0a","2CH":"\u6b77\u4ee3\u5fd7\u4e0b","EZR":"\u4ee5\u65af\u62c9\u8a18","NEH":"\u5c3c\u5e0c\u7c73\u8a18","EST":"\u4ee5\u65af\u5e16\u8a18","JOB":"\u7d04\u4f2f\u8a18","PSA":"\u8a69\u7bc7","PRO":"\u7bb4\u8a00","ECC":"\u50b3\u9053\u66f8","SNG":"\u96c5\u6b4c","ISA":"\u4ee5\u8cfd\u4e9e\u66f8","JER":"\u8036\u5229\u7c73\u66f8","LAM":"\u8036\u5229\u7c73\u54c0\u6b4c","EZK":"\u4ee5\u897f\u7d50\u66f8","DAN":"\u4f46\u4ee5\u7406\u66f8","HOS":"\u4f55\u897f\u963f\u66f8","JOL":"\u7d04\u73e5\u66f8","AMO":"\u963f\u6469\u53f8\u66f8","OBA":"\u4fc4\u5df4\u5e95\u4e9e\u66f8","JON":"\u7d04\u62ff\u66f8","MIC":"\u5f4c\u8fe6\u66f8","NAM":"\u90a3\u9d3b\u66f8","HAB":"\u54c8\u5df4\u8c37\u66f8","ZEP":"\u897f\u756a\u96c5\u66f8","HAG":"\u54c8\u8a72\u66f8","ZEC":"\u6492\u8fe6\u5229\u4e9e\u66f8","MAL":"\u746a\u62c9\u57fa\u66f8","MAT":"\u99ac\u592a\u798f\u97f3","MRK":"\u99ac\u53ef\u798f\u97f3","LUK":"\u8def\u52a0\u798f\u97f3","JHN":"\u7d04\u7ff0\u798f\u97f3","ACT":"\u4f7f\u5f92\u884c\u50b3","ROM":"\u7f85\u99ac\u66f8","1CO":"\u54e5\u6797\u591a\u524d\u66f8","2CO":"\u54e5\u6797\u591a\u5f8c\u66f8","GAL":"\u52a0\u62c9\u592a\u66f8","EPH":"\u4ee5\u5f17\u6240\u66f8","PHP":"\u8153\u5229\u6bd4\u66f8","COL":"\u6b4c\u7f85\u897f\u66f8","1TH":"\u5e16\u6492\u7f85\u5c3c\u8fe6\u524d\u66f8","2TH":"\u5e16\u6492\u7f85\u5c3c\u8fe6\u5f8c\u66f8","1TI":"\u63d0\u6469\u592a\u524d\u66f8","2TI":"\u63d0\u6469\u592a\u5f8c\u66f8","TIT":"\u63d0\u591a\u66f8","PHM":"\u8153\u5229\u9580\u66f8","HEB":"\u5e0c\u4f2f\u4f86\u66f8","JAS":"\u96c5\u5404\u66f8","1PE":"\u5f7c\u5f97\u524d\u66f8","2PE":"\u5f7c\u5f97\u5f8c\u66f8","1JN":"\u7d04\u7ff0\u58f9\u66f8","2JN":"\u7d04\u7ff0\u8cb3\u66f8","3JN":"\u7d04\u7ff0\u53c3\u66f8","JUD":"\u7336\u5927\u66f8","REV":"\u555f\u793a\u9304"},"bkr":{"GEN":"Genesis","EXO":"Exodus","LEV":"Leviticus","NUM":"Numeri","DEU":"Deuteronomium","JOS":"Jozue","JDG":"Soudc\u016f","RUT":"R\u00fat","1SA":"1. Samuel","2SA":"2. Samuel","1KI":"1. Kr\u00e1lovsk\u00e1","2KI":"2. Kr\u00e1lovsk\u00e1","1CH":"1. Paralipomenon","2CH":"2. Paralipomenon","EZR":"Ezdr\u00e1\u0161","NEH":"Nehemi\u00e1\u0161","EST":"Ester","JOB":"Job","PSA":"\u017dalmy","PRO":"P\u0159\u00edslov\u00ed","ECC":"Kazatel","SNG":"P\u00edse\u0148 p\u00edsn\u00ed","ISA":"Izai\u00e1\u0161","JER":"Jeremi\u00e1\u0161","LAM":"Pl\u00e1\u010d","EZK":"Ezechiel","DAN":"Daniel","HOS":"Oze\u00e1\u0161","JOL":"Joel","AMO":"Amos","OBA":"Abdi\u00e1\u0161","JON":"Jon\u00e1\u0161","MIC":"Miche\u00e1\u0161","NAM":"Nahum","HAB":"Abakuk","ZEP":"Sofoni\u00e1\u0161","HAG":"Ageus","ZEC":"Zachari\u00e1\u0161","MAL":"Malachi\u00e1\u0161","MAT":"Matou\u0161","MRK":"Marek","LUK":"Luk\u00e1\u0161","JHN":"Jan","ACT":"Skutky","ROM":"\u0158\u00edman\u016fm","1CO":"1. Korintsk\u00fdm","2CO":"2. Korintsk\u00fdm","GAL":"Galatsk\u00fdm","EPH":"Efesk\u00fdm","PHP":"Filipsk\u00fdm","COL":"Kolosk\u00fdm","1TH":"1. Tesalonick\u00fdm","2TH":"2. Tesalonick\u00fdm","1TI":"1. Timoteovi","2TI":"2. Timoteovi","TIT":"Titovi","PHM":"Filemonovi","HEB":"\u017did\u016fm","JAS":"Jakub","1PE":"1. Petr","2PE":"2. Petr","1JN":"1. Jan","2JN":"2. Jan","3JN":"3. Jan","JUD":"Juda","REV":"Zjeven\u00ed"},"clementine":{"GEN":"Genesis","EXO":"Exodus","LEV":"Leviticus","NUM":"Numeri","DEU":"Deuteronomium","JOS":"Josue","JDG":"Judicum","RUT":"Ruth","1SA":"Regum I","2SA":"Regum II","1KI":"Regum III","2KI":"Regum IV","1CH":"Paralipomenon I","2CH":"Paralipomenon II","EZR":"Esdr\u00e6","NEH":"Nehemi\u00e6","EST":"Tobi\u00e6","JOB":"Job","PSA":"Psalmi","PRO":"Proverbia","ECC":"Ecclesiastes","SNG":"Canticum Canticorum","ISA":"Isaias","JER":"Jeremias","LAM":"Lamentationes","EZK":"Ezechiel","DAN":"Daniel","HOS":"Osee","JOL":"Jo\u00ebl","AMO":"Amos","OBA":"Abdias","JON":"Jonas","MIC":"Mich\u00e6a","NAM":"Nahum","HAB":"Habacuc","ZEP":"Sophonias","HAG":"Agg\u00e6us","ZEC":"Zacharias","MAL":"Malachias","MAT":"Matth\u00e6us","MRK":"Marcus","LUK":"Lucas","JHN":"Joannes","ACT":"Actus Apostolorum","ROM":"ad Romanos","1CO":"ad Corinthios I","2CO":"ad Corinthios II","GAL":"ad Galatas","EPH":"ad Ephesios","PHP":"ad Philippenses","COL":"ad Colossenses","1TH":"ad Thessalonicenses I","2TH":"ad Thessalonicenses II","1TI":"ad Timotheum I","2TI":"ad Timotheum II","TIT":"ad Titum","PHM":"ad Philemonem","HEB":"ad Hebr\u00e6os","JAS":"Jacobi","1PE":"Petri I","2PE":"Petri II","1JN":"Joannis I","2JN":"Joannis II","3JN":"Joannis III","JUD":"Jud\u00e6","REV":"Apocalypsis"},"almeida":{"GEN":"G\u00eanesis","EXO":"\u00caxodo","LEV":"Lev\u00edtico","NUM":"N\u00fameros","DEU":"Deuteron\u00f4mio","JOS":"Josu\u00e9","JDG":"Ju\u00edzes","RUT":"Rute","1SA":"1 Samuel","2SA":"2 Samuel","1KI":"1 Reis","2KI":"2 Reis","1CH":"1 Cr\u00f4nicas","2CH":"2 Cr\u00f4nicas","EZR":"Esdras","NEH":"Neemias","EST":"Ester","JOB":"J\u00f3","PSA":"Salmos","PRO":"Prov\u00e9rbios","ECC":"Eclesiastes","SNG":"C\u00e2nticos","ISA":"Isa\u00edas","JER":"Jeremias","LAM":"Lamenta\u00e7\u00f5es","EZK":"Ezequiel","DAN":"Daniel","HOS":"Os\u00e9ias","JOL":"Joel","AMO":"Am\u00f3s","OBA":"Obadias","JON":"Jonas","MIC":"Miqu\u00e9ias","NAM":"Naum","HAB":"Habacuque","ZEP":"Sofonias","HAG":"Ageu","ZEC":"Zacarias","MAL":"Malaquias","MAT":"Mateus","MRK":"Marcos","LUK":"Lucas","JHN":"Jo\u00e3o","ACT":"Atos","ROM":"Romanos","1CO":"1 Cor\u00edntios","2CO":"2 Cor\u00edntios","GAL":"G\u00e1latas","EPH":"Ef\u00e9sios","PHP":"Filipenses","COL":"Colossenses","1TH":"1 Tessalonicenses","2TH":"2 Tessalonicenses","1TI":"1 Tim\u00f3teo","2TI":"2 Tim\u00f3teo","TIT":"Tito","PHM":"Filemom","HEB":"Hebreus","JAS":"Tiago","1PE":"1 Pedro","2PE":"2 Pedro","1JN":"1 Jo\u00e3o","2JN":"2 Jo\u00e3o","3JN":"3 Jo\u00e3o","JUD":"Judas","REV":"Apocalipse"},"rccv":{"GEN":"Geneza","EXO":"Exodul","LEV":"Leviticul","NUM":"Numeri","DEU":"Deuteronomul","JOS":"Iosua","JDG":"Judec\u0103tori","RUT":"Rut","1SA":"1 Samuel","2SA":"2 Samuel","1KI":"1 \u00cemp\u0103ra\u0163i","2KI":"2 \u00cemp\u0103ra\u0163i","1CH":"1 Cronici","2CH":"2 Cronici","EZR":"Ezra","NEH":"Neemia","EST":"Estera","JOB":"Iov","PSA":"Psalmii","PRO":"Proverbe","ECC":"Eclesiastul","SNG":"C\u00e2ntarea c\u00e2nt\u0103rilor","ISA":"Isaia","JER":"Ieremia","LAM":"Pl\u00e2ngerile lui Ieremia","EZK":"Ezechiel","DAN":"Daniel","HOS":"Osea","JOL":"Ioel","AMO":"Amos","OBA":"Obadia","JON":"Iona","MIC":"Mica","NAM":"Naum","HAB":"Habacuc","ZEP":"\u0162efania","HAG":"Hagai","ZEC":"Zaharia","MAL":"Maleahi","MAT":"Matei","MRK":"Marcu","LUK":"Luca","JHN":"Ioan","ACT":"Faptele apostolilor","ROM":"Romani","1CO":"1 Corinteni","2CO":"2 Corinteni","GAL":"Galateni","EPH":"Efeseni","PHP":"Filipeni","COL":"Coloseni","1TH":"1 Tesaloniceni","2TH":"2 Tesaloniceni","1TI":"1 Timotei","2TI":"2 Timotei","TIT":"Tit","PHM":"Filimon","HEB":"Evrei","JAS":"Iacov","1PE":"1 Petru","2PE":"2 Petru","1JN":"1 Ioan","2JN":"2 Ioan","3JN":"3 Ioan","JUD":"Iuda","REV":"Apocalipsa"},"cherokee":{"MAT":"\u13a3\u13cd\u13db \u13a7\u13c3\u13ae\u13db \u13b9\u13da \u13a4\u13ec\u13ea\u13b3\u13c5\u13af","MRK":"\u13a3\u13cd\u13db \u13a7\u13c3\u13ae\u13db \u13b9\u13a6 \u13a4\u13ec\u13ea\u13b3\u13c5\u13af","LUK":"\u13a3\u13cd\u13db \u13a7\u13c3\u13ae\u13db \u13b7\u13a6 \u13a4\u13ec\u13ea\u13b3\u13c5\u13af","JHN":"\u13a3\u13cd\u13db \u13a7\u13c3\u13ae\u13db \u13e3\u13c2 \u13a4\u13ec\u13ea\u13b3\u13c5\u13af","ACT":"\u13a8\u13e5\u13c5\u13cf\u13db \u13c4\u13be\u13db\u13c1\u13b5\u13d9\u13b8\u13a2","ROM":"\u13c9\u13b3 \u13b6\u13bb \u13a0\u13c1\u13af \u13e7\u13ec\u13ea\u13b3\u13c1\u13b8\u13af","1CO":"\u13aa\u13b5\u13c2\u13d7\u13f1 \u13a0\u13c1\u13af \u13a2\u13ac\u13f1\u13f1 \u13a8\u13aa\u13ea\u13b3\u13c1\u13b8\u13af","2CO":"\u13aa\u13b5\u13c2\u13d7\u13f1 \u13a0\u13c1\u13af \u13d4\u13b5\u13c1 \u13a8\u13aa\u13ea\u13b3\u13c1\u13b8\u13af","GAL":"\u13c9\u13b3 \u13a8\u13b4\u13cf\u13f1 \u13a0\u13c1\u13af \u13e7\u13ec\u13ea\u13b3\u13c1\u13b8\u13af","EPH":"\u13c9\u13b3 \u13a1\u13c8\u13cc \u13a0\u13c1\u13af \u13e7\u13ec\u13ea\u13b3\u13c1\u13b8\u13af","PHP":"\u13c9\u13b3 \u13c8\u13b5\u13a9\u13f1 \u13a0\u13c1\u13af \u13e7\u13ec\u13ea\u13b3\u13c1\u13b8\u13af","COL":"\u13c9\u13b3 \u13aa\u13b6\u13cf \u13a0\u13c1\u13af \u13e7\u13ec\u13ea\u13b3\u13c1\u13b8\u13af","1TH":"\u13c9\u13b3 \u13d5\u13cf\u13b6\u13c2\u13a6 \u13a0\u13c1\u13af \u13a2\u13ac\u13f1\u13f1 \u13e7\u13ec\u13ea\u13b3\u13c1\u13b8\u13af","2TH":"\u13c9\u13b3 \u13d5\u13cf\u13b6\u13c2\u13a6 \u13a0\u13c1\u13af \u13d4\u13b5\u13c1 \u13e7\u13ec\u13ea\u13b3\u13c1\u13b8\u13af","1TI":"\u13c9\u13b3 \u13e7\u13ec\u13ea\u13b3\u13c5\u13af \u13a2\u13ac\u13f1\u13f1 \u13d7\u13b9\u13d7 \u13e7\u13ec\u13ea\u13b3\u13c1\u13b8\u13af","2TI":"\u13c9\u13b3 \u13e7\u13ec\u13ea\u13b3\u13c5\u13af \u13d4\u13b5\u13c1 \u13d7\u13b9\u13d7 \u13e7\u13ec\u13ea\u13b3\u13c1\u13b8\u13af","TIT":"\u13c9\u13b3 \u13d3\u13d3\u13cf \u13a4\u13ec\u13ea\u13b3\u13c1\u13b8\u13af","PHM":"\u13c9\u13b3 \u13c6\u13b5\u13b9\u13c2 \u13a4\u13ec\u13ea\u13b3\u13c1\u13b8\u13af","HEB":"\u13c9\u13b3 \u13a0\u13c2\u13c8\u13b7 \u13e7\u13ec\u13ea\u13b3\u13c1\u13b8\u13af","JAS":"\u13e5\u13bb \u13a4\u13ec\u13ea\u13b3\u13c5\u13af","1PE":"\u13c8\u13d3 \u13a2\u13ac\u13f1\u13f1 \u13a4\u13ec\u13ea\u13b3\u13c5\u13af","2PE":"\u13c8\u13d3 \u13d4\u13b5\u13c1 \u13a4\u13ec\u13ea\u13b3\u13c5\u13af","1JN":"\u13e3\u13c2 \u13a2\u13ac\u13f1\u13f1 \u13a4\u13ec\u13ea\u13b3\u13c5\u13af","2JN":"\u13e3\u13c2 \u13d4\u13b5\u13c1 \u13a4\u13ec\u13ea\u13b3\u13c5\u13af","3JN":"\u13e3\u13c2 \u13e6\u13a2\u13c1 \u13a4\u13ec\u13ea\u13b3\u13c5\u13af","JUD":"\u13e7\u13d3\u13cf \u13a4\u13ec\u13ea\u13b3\u13c5\u13af","REV":"\u13e3\u13c2 \u13c4\u13cd\u13db \u13a0\u13e5\u13be\u13c4\u13aa\u13eb\u13ce\u13b8\u13a2"},"synodal":{"GEN":"\u0411\u044b\u0442\u0438\u0435","EXO":"\u0418\u0441\u0445\u043e\u0434","LEV":"\u041b\u0435\u0432\u0438\u0442","NUM":"\u0427\u0438\u0441\u043b\u0430","DEU":"\u0412\u0442\u043e\u0440\u043e\u0437\u0430\u043a\u043e\u043d\u0438\u0435","JOS":"\u0418\u0438\u0441\u0443\u0441 \u041d\u0430\u0432\u0438\u043d","JDG":"\u0421\u0443\u0434\u044c\u0438","RUT":"\u0420\u0443\u0444\u044c","1SA":"1 \u0426\u0430\u0440\u0441\u0442\u0432","2SA":"2 \u0426\u0430\u0440\u0441\u0442\u0432","1KI":"3 \u0426\u0430\u0440\u0441\u0442\u0432","2KI":"4 \u0426\u0430\u0440\u0441\u0442\u0432","1CH":"1 \u041f\u0430\u0440\u0430\u043b\u0438\u043f\u043e\u043c\u0435\u043d\u043e\u043d","2CH":"2 \u041f\u0430\u0440\u0430\u043b\u0438\u043f\u043e\u043c\u0435\u043d\u043e\u043d","EZR":"\u0415\u0437\u0434\u0440\u0430","NEH":"\u041d\u0435\u0435\u043c\u0438\u044f","EST":"\u0415\u0441\u0444\u0438\u0440\u044c","JOB":"\u0418\u043e\u0432","PSA":"\u041f\u0441\u0430\u043b\u0442\u0438\u0440\u044c","PRO":"\u041f\u0440\u0438\u0442\u0447\u0438","ECC":"\u0415\u043a\u043a\u043b\u0435\u0437\u0438\u0430\u0441\u0442","SNG":"\u041f\u0435\u0441\u043d\u044c \u043f\u0435\u0441\u043d\u0435\u0439","ISA":"\u0418\u0441\u0430\u0438\u044f","JER":"\u0418\u0435\u0440\u0435\u043c\u0438\u044f","LAM":"\u041f\u043b\u0430\u0447 \u0418\u0435\u0440\u0435\u043c\u0438\u0438","EZK":"\u0418\u0435\u0437\u0435\u043a\u0438\u0438\u043b\u044c","DAN":"\u0414\u0430\u043d\u0438\u0438\u043b","HOS":"\u041e\u0441\u0438\u044f","JOL":"\u0418\u043e\u0438\u043b\u044c","AMO":"\u0410\u043c\u043e\u0441","OBA":"\u0410\u0432\u0434\u0438\u0439","JON":"\u0418\u043e\u043d\u0430","MIC":"\u041c\u0438\u0445\u0435\u0439","NAM":"\u041d\u0430\u0443\u043c","HAB":"\u0410\u0432\u0432\u0430\u043a\u0443\u043c","ZEP":"\u0421\u043e\u0444\u043e\u043d\u0438\u044f","HAG":"\u0410\u0433\u0433\u0435\u0439","ZEC":"\u0417\u0430\u0445\u0430\u0440\u0438\u044f","MAL":"\u041c\u0430\u043b\u0430\u0445\u0438\u044f","TOB":"\u0422\u043e\u0432\u0438\u0442","JDT":"\u0418\u0443\u0434\u0438\u0444\u044c","ESG":"\u0415\u0441\u0444\u0438\u0440\u044c (\u0413\u0440\u0435\u0447\u0435\u0441\u043a\u0430\u044f)","WIS":"\u041f\u0440\u0435\u043c\u0443\u0434\u0440\u043e\u0441\u0442\u044c \u0421\u043e\u043b\u043e\u043c\u043e\u043d\u0430","SIR":"\u0421\u0438\u0440\u0430\u0445","BAR":"\u0412\u0430\u0440\u0443\u0445","LJE":"\u041f\u043e\u0441\u043b\u0430\u043d\u0438\u0435 \u0418\u0435\u0440\u0435\u043c\u0438\u0438","S3Y":"\u041f\u0435\u0441\u043d\u044c \u0422\u0440\u0435\u0445 \u041e\u0442\u0440\u043e\u043a\u043e\u0432","SUS":"\u0421\u0443\u0441\u0430\u043d\u043d\u0430","BEL":"\u0411\u0435\u043b \u0438 \u0434\u0440\u0430\u043a\u043e\u043d","1MA":"1 \u041c\u0430\u043a\u043a\u0430\u0432\u0435\u0439\u0441\u043a\u0430\u044f","2MA":"2 \u041c\u0430\u043a\u043a\u0430\u0432\u0435\u0439\u0441\u043a\u0430\u044f","1ES":"1 \u0415\u0437\u0434\u0440\u044b","MAN":"\u041c\u043e\u043b\u0438\u0442\u0432\u0430 \u041c\u0430\u043d\u0430\u0441\u0441\u0438\u0438","PS2":"\u041f\u0441\u0430\u043b\u043e\u043c 151","3MA":"3 \u041c\u0430\u043a\u043a\u0430\u0432\u0435\u0439\u0441\u043a\u0430\u044f","2ES":"2 \u0415\u0437\u0434\u0440\u044b","4MA":"4 \u041c\u0430\u043a\u043a\u0430\u0432\u0435\u0439\u0441\u043a\u0430\u044f","MAT":"\u041c\u0430\u0442\u0444\u0435\u044f","MRK":"\u041c\u0430\u0440\u043a\u0430","LUK":"\u041b\u0443\u043a\u0438","JHN":"\u0418\u043e\u0430\u043d\u043d\u0430","ACT":"\u0414\u0435\u044f\u043d\u0438\u044f","ROM":"\u0420\u0438\u043c\u043b\u044f\u043d\u0430\u043c","1CO":"1 \u041a\u043e\u0440\u0438\u043d\u0444\u044f\u043d\u0430\u043c","2CO":"2 \u041a\u043e\u0440\u0438\u043d\u0444\u044f\u043d\u0430\u043c","GAL":"\u0413\u0430\u043b\u0430\u0442\u0430\u043c","EPH":"\u0415\u0444\u0435\u0441\u044f\u043d\u0430\u043c","PHP":"\u0424\u0438\u043b\u0438\u043f\u043f\u0438\u0439\u0446\u0430\u043c","COL":"\u041a\u043e\u043b\u043e\u0441\u0441\u044f\u043d\u0430\u043c","1TH":"1 \u0424\u0435\u0441\u0441\u0430\u043b\u043e\u043d\u0438\u043a\u0438\u0439\u0446\u0430\u043c","2TH":"2 \u0424\u0435\u0441\u0441\u0430\u043b\u043e\u043d\u0438\u043a\u0438\u0439\u0446\u0430\u043c","1TI":"1 \u0422\u0438\u043c\u043e\u0444\u0435\u044e","2TI":"2 \u0422\u0438\u043c\u043e\u0444\u0435\u044e","TIT":"\u0422\u0438\u0442\u0443","PHM":"\u0424\u0438\u043b\u0438\u043c\u043e\u043d\u0443","HEB":"\u0415\u0432\u0440\u0435\u044f\u043c","JAS":"\u0418\u0430\u043a\u043e\u0432\u0430","1PE":"1 \u041f\u0435\u0442\u0440\u0430","2PE":"2 \u041f\u0435\u0442\u0440\u0430","1JN":"1 \u0418\u043e\u0430\u043d\u043d\u0430","2JN":"2 \u0418\u043e\u0430\u043d\u043d\u0430","3JN":"3 \u0418\u043e\u0430\u043d\u043d\u0430","JUD":"\u0418\u0443\u0434\u044b","REV":"\u041e\u0442\u043a\u0440\u043e\u0432\u0435\u043d\u0438\u0435"}};

const chapterCache = {};         // key = `${version}|${USFM}|${chapter}` -> {name, verses:Map}
let activeRef = null;            // ref currently being shown (null if modal closed)
let activeSourceName = null;     // which name the user clicked the verse from
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

async function showVerse(ref, sourceName){
  const isNewView = !(activeRef === ref && activeSourceName === (sourceName || (current ? current.name : null)));
  activeRef = ref;
  activeSourceName = sourceName || (current ? current.name : null);
  const m = ref.match(/^(.*?)\s+(\d+):(\d+)$/);
  // sync the dropdown label to current version
  const _vt = TR_BY_ID[currentVersion];
  document.getElementById('mVersionLabel').textContent = _vt ? _vt.acronym : currentVersion;
  const body = document.getElementById('mBody');
  body.className = 'm-body'; body.textContent = 'Loading…';
  ov.classList.add('show');
  if (isNewView){
    pushState({ loc: current ? current.name : null, ref: ref, src: activeSourceName });
  }
  // The modal occludes part of the map. If a place is selected, keep it in
  // the visible area.
  if (current){
    requestAnimationFrame(() => centerOnVisibleArea(current.lat, current.lng));
  }

  function renderAlsoMentioned(){
    const all = versesIndex[ref] || [];
    // Determine if the current place is actually mentioned in this verse.
    const currentMentioned = current && all.some(e => e.key === current.key);
    const dropKey = currentMentioned ? current.key : null;
    const dropName = activeSourceName;
    const seen = new Set();
    const others = all.filter(entry => {
      // If the current place is referenced here, drop only the (key, name) the
      // user came from so its sibling AKAs still appear in "Also mentioned".
      if (dropKey && entry.key === dropKey && entry.name === dropName) return false;
      const tag = entry.key + '\u0001' + entry.name;
      if (seen.has(tag)) return false;
      seen.add(tag);
      return true;
    });
    const label = currentMentioned ? 'Also mentioned in this verse' : 'Mentioned in this verse';
    if (!others.length){
      return currentMentioned
        ? '' // "Also mentioned" with nothing to list — show nothing
        : `<div class="also-mentioned">No places mentioned in this verse.</div>`;
    }
    const links = others.map(o => {
      if (o.unlocated){
        return `<span class="place-unloc" title="Location unknown">${o.name}</span>`;
      }
      return `<a class="place-link" data-key="${o.key.replace(/"/g,'&quot;')}">${o.name}</a>`;
    }).join(', ');
    return `<div class="also-mentioned">${label}: ${links}</div>`;
  }

  function setVerseHtml(html){
    if (activeRef !== ref || currentVersion !== requestVersion) return;
    body.className = 'm-body';
    body.innerHTML = `<div class="verse-text">${html}</div>` + renderAlsoMentioned();
  }
  function setError(msg){
    if (activeRef !== ref || currentVersion !== requestVersion) return;
    body.className = 'm-body err';
    body.textContent = msg;
  }

  if (!m){ body.className = 'm-body err'; body.textContent = 'Unrecognised reference.'; return; }
  const bookAbbr = m[1], ch = parseInt(m[2], 10), vs = parseInt(m[3], 10);
  const usfm = USFM[bookAbbr];
  if (!usfm){ body.className = 'm-body err'; body.textContent = 'Unknown book.'; return; }

  const requestVersion = currentVersion;
  const cKey = requestVersion + '|' + usfm + '|' + ch;

  function setRefLabel(apiName){
    const fromTable = (LOCALIZED_BOOKS[requestVersion] || {})[usfm];
    const name = fromTable || apiName || FULL[bookAbbr] || bookAbbr;
    const el = document.getElementById('mRef');
    el.innerHTML = `<span>${name} ${ch}:${vs}</span>`;
  }
  // initial header — uses localized table immediately if available
  setRefLabel(null);

  function pickAndRender(entry){
    setRefLabel(entry.name);
    const text = entry.verses.get(vs);
    if (text == null){
      setError("This verse isn’t available in the selected translation.");
      return;
    }
    setVerseHtml(sanitizeKJV(text.trim()));
  }

  if (chapterCache[cKey]){
    pickAndRender(chapterCache[cKey]);
    return;
  }
  try {
    const url = `https://bible-api.com/data/${encodeURIComponent(requestVersion)}/${usfm}/${ch}`;
    const res = await fetch(url);
    if (res.status === 404){
      setError("This verse isn’t available in the selected translation.");
      return;
    }
    if (!res.ok) throw new Error('http ' + res.status);
    const data = await res.json();
    const verses = (data && data.verses) || (Array.isArray(data) ? data : []);
    const map = new Map();
    let localizedName = null;
    verses.forEach(v => {
      if (!v) return;
      if (v.verse != null) map.set(Number(v.verse), v.text || '');
      if (!localizedName && v.book_name) localizedName = v.book_name;
    });
    const entry = { name: localizedName, verses: map };
    chapterCache[cKey] = entry;
    pickAndRender(entry);
  } catch (err){
    setError("Can’t load this verse — you appear to be offline.");
  }
}
document.getElementById('mBody').addEventListener('click', e => {
  const a = e.target.closest('a.place-link');
  if (!a) return;
  const r = recordByKey.get(a.dataset.key);
  if (!r) return;
  ov.classList.remove('show');
  activeRef = null; activeSourceName = null;
  map.setView([r.lat, r.lng], Math.max(map.getZoom(), 10), {animate:true});
  openPanel(r);
});
function closeVerseModal(){
  // Close in place — distinct from the back button. The × dismisses the verse
  // modal and returns to whatever place panel is open beneath (if any).
  ov.classList.remove('show');
  activeRef = null; activeSourceName = null;
  replaceState(currentState());
}
document.getElementById('mClose').onclick = closeVerseModal;
ov.addEventListener('click', e => { if (e.target === ov) closeVerseModal(); });
document.addEventListener('keydown', e => {
  if (e.key === 'Escape'){
    const navEl = document.getElementById('navOv');
    if (navEl && navEl.classList.contains('show')){ navEl.classList.remove('show'); return; }
    if (ov.classList.contains('show')) closeVerseModal();
    else if (document.getElementById('infoOv').classList.contains('show'))
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
searchEl.addEventListener('input', e => {
  document.getElementById('filterMenu').hidden = true;
  setQuery(e.target.value);
});
searchEl.addEventListener('focus', () => {
  document.getElementById('filterMenu').hidden = true;
  buildSuggestions();
});
clearBtn.onclick = () => {
  searchEl.value = '';
  setQuery('');
  searchEl.focus();
};
setQuery(''); // sync clear-button visibility

document.addEventListener('click', e => {
  if (!e.target.closest('#bar')) document.getElementById('suggest').classList.remove('show');
});

/* ---- version dropdown ---- */
function buildVersionDropdown(){
  const btn = document.getElementById('mVersionBtn');
  const label = document.getElementById('mVersionLabel');
  const menu = document.getElementById('mVersionMenu');

  // Group by language; English variants merge into one "English" group
  const byLang = {};
  TRANSLATIONS.forEach(t => {
    const lang = t.lang.startsWith('English') ? 'English' : t.lang;
    (byLang[lang] = byLang[lang] || []).push(t);
  });
  const langs = Object.keys(byLang).sort((a,b) => {
    if (a === 'English') return -1;
    if (b === 'English') return 1;
    return a.localeCompare(b);
  });

  let html = '';
  langs.forEach(lang => {
    html += `<li class="group">${lang}</li>`;
    byLang[lang]
      .sort((a,b) => {
        if (a.id === 'kjv') return -1;
        if (b.id === 'kjv') return 1;
        return a.acronym.localeCompare(b.acronym);
      })
      .forEach(t => {
        html += `<li class="opt" role="option" data-id="${t.id}">` +
                  `<span class="full">${t.name}</span>` +
                  `<span class="acr">(${t.acronym})</span>` +
                `</li>`;
      });
  });
  menu.innerHTML = html;

  function syncLabel(){
    const t = TR_BY_ID[currentVersion];
    label.textContent = t ? t.acronym : 'KJV';
    menu.querySelectorAll('.opt').forEach(li => {
      li.setAttribute('aria-selected', li.dataset.id === currentVersion ? 'true' : 'false');
    });
  }
  function openMenu(){
    syncLabel();
    // Position the menu under the button (it's position:fixed so it escapes
    // the modal's overflow:hidden clipping).
    const r = btn.getBoundingClientRect();
    menu.hidden = false;
    menu.style.top = (r.bottom + 4) + 'px';
    menu.style.right = (window.innerWidth - r.right) + 'px';
    menu.style.left = 'auto';
    // Cap height to the space left below the button so the menu never runs
    // past the viewport. 12px gives a little breathing room at the bottom.
    const available = window.innerHeight - r.bottom - 4 - 12;
    menu.style.maxHeight = Math.max(120, available) + 'px';
    btn.setAttribute('aria-expanded', 'true');
    const sel = menu.querySelector('.opt[aria-selected="true"]');
    if (sel) sel.scrollIntoView({block:'nearest'});
  }
  function closeMenu(){
    menu.hidden = true;
    btn.setAttribute('aria-expanded', 'false');
  }
  function toggleMenu(){
    if (menu.hidden) openMenu(); else closeMenu();
  }

  btn.addEventListener('click', e => { e.stopPropagation(); toggleMenu(); });
  menu.addEventListener('click', e => {
    const li = e.target.closest('li.opt'); if (!li) return;
    e.stopPropagation();
    const id = li.dataset.id;
    if (!TR_BY_ID[id]) return;
    currentVersion = id;
    try { localStorage.setItem('bible_version', currentVersion); } catch(err){}
    syncLabel();
    closeMenu();
    replaceState(currentState());
    if (activeRef){
      suppressHistory = true;
      try { showVerse(activeRef, activeSourceName); }
      finally { suppressHistory = false; }
    }
  });
  document.addEventListener('click', e => {
    if (menu.hidden) return;
    if (!e.target.closest('#mVersion')) closeMenu();
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && !menu.hidden){ closeMenu(); e.stopPropagation(); }
  });
  window.addEventListener('resize', () => { if (!menu.hidden) closeMenu(); });

  syncLabel();
}
buildVersionDropdown();

/* ---- Verse navigator ----
   Header in the verse modal is a button; clicking it opens this picker over
   the verse modal. Book names are localized to the current translation when a
   table exists; otherwise English. Changing book clamps chapter and verse to
   in-range (set to 1 if out). Clicking Go calls showVerse(); the renderer
   handles the "Mentioned in this verse" footer when there's no source place. */
const navOv = document.getElementById('navOv');
const navBookSel = document.getElementById('navBook');
const navChSel = document.getElementById('navChapter');
const navVsSel = document.getElementById('navVerse');

function localizedBook(usfm){
  const t = (LOCALIZED_BOOKS[currentVersion] || {})[usfm];
  if (t) return t;
  const abbr = USFM_TO_ABBR[usfm];
  return FULL[abbr] || abbr || usfm;
}

function buildNavBookOptions(){
  let html = '';
  html += '<optgroup label="Old Testament">';
  CANON_ORDER.forEach(usfm => {
    if (!OT_USFM.has(usfm)) return;
    if (!VERSE_COUNTS[usfm]) return;
    html += `<option value="${usfm}">${localizedBook(usfm)}</option>`;
  });
  html += '</optgroup><optgroup label="New Testament">';
  CANON_ORDER.forEach(usfm => {
    if (OT_USFM.has(usfm)) return;
    if (!VERSE_COUNTS[usfm]) return;
    html += `<option value="${usfm}">${localizedBook(usfm)}</option>`;
  });
  html += '</optgroup>';
  navBookSel.innerHTML = html;
}

function fillRange(sel, n, value){
  let html = '';
  for (let i = 1; i <= n; i++) html += `<option value="${i}">${i}</option>`;
  sel.innerHTML = html;
  sel.value = String(Math.max(1, Math.min(n, value)));
}

function syncChapterAndVerse(prevCh, prevVs){
  const usfm = navBookSel.value;
  const chapters = VERSE_COUNTS[usfm] || [];
  const newCh = (prevCh && prevCh <= chapters.length) ? prevCh : 1;
  fillRange(navChSel, chapters.length, newCh);
  const verses = chapters[parseInt(navChSel.value, 10) - 1] || 1;
  const newVs = (prevVs && prevVs <= verses) ? prevVs : 1;
  fillRange(navVsSel, verses, newVs);
}

function openNavigator(){
  buildNavBookOptions();
  // Seed from the currently-shown ref, or default to Genesis 1:1.
  let usfm = 'GEN', ch = 1, vs = 1;
  if (activeRef){
    const m = activeRef.match(/^(.*?)\s+(\d+):(\d+)$/);
    if (m){ usfm = USFM[m[1]] || 'GEN'; ch = +m[2]; vs = +m[3]; }
  }
  navBookSel.value = usfm;
  if (!navBookSel.value) navBookSel.value = 'GEN';
  syncChapterAndVerse(ch, vs);
  navOv.classList.add('show');
}

navBookSel.addEventListener('change', () => syncChapterAndVerse(
  parseInt(navChSel.value, 10), parseInt(navVsSel.value, 10)
));
navChSel.addEventListener('change', () => {
  const usfm = navBookSel.value;
  const verses = (VERSE_COUNTS[usfm] || [])[parseInt(navChSel.value, 10) - 1] || 1;
  const prev = parseInt(navVsSel.value, 10);
  fillRange(navVsSel, verses, prev);
});

document.getElementById('navGo').onclick = () => {
  const usfm = navBookSel.value;
  const ch = parseInt(navChSel.value, 10);
  const vs = parseInt(navVsSel.value, 10);
  const abbr = USFM_TO_ABBR[usfm];
  if (!abbr) return;
  navOv.classList.remove('show');
  // sourceName = null so the renderer will compute the "Mentioned in this verse"
  // footer instead of an "also mentioned" footer.
  showVerse(`${abbr} ${ch}:${vs}`, null);
};
document.getElementById('navClose').onclick = () => navOv.classList.remove('show');
navOv.addEventListener('click', e => { if (e.target === navOv) navOv.classList.remove('show'); });

document.getElementById('mRef').addEventListener('click', () => {
  if (ov.classList.contains('show')) openNavigator();
});

/* ---- Book filter (in search bar) ---- */
const filterBtn = document.getElementById('filterBtn');
const filterMenu = document.getElementById('filterMenu');

// The single source of truth for what's checked. Persists across menu rebuilds.
const filterChecked = new Set(CANON_ORDER);

// Whether each testament group is expanded in the filter menu
const fmCollapsed = { ot: false, nt: false };

// Per-book and per-group place counts (recomputed when records load).
const placeCountByBook = new Map(); // USFM -> count
let placeCountOT = 0, placeCountNT = 0, placeCountAll = 0;
function recomputePlaceCounts(){
  placeCountByBook.clear();
  CANON_ORDER.forEach(b => placeCountByBook.set(b, 0));
  let ot = 0, nt = 0, total = 0;
  records.forEach(r => {
    const books = recordBooks.get(r.key);
    if (!books || !books.size) return;
    total++;
    let inOT = false, inNT = false;
    books.forEach(b => {
      placeCountByBook.set(b, (placeCountByBook.get(b) || 0) + 1);
      if (OT_USFM.has(b)) inOT = true; else inNT = true;
    });
    if (inOT) ot++;
    if (inNT) nt++;
  });
  placeCountOT = ot; placeCountNT = nt; placeCountAll = total;
}

function placeCountLabel(n){
  if (!n) return 'No places';
  if (n === 1) return '1 place';
  return n + ' places';
}

function buildFilterMenu(){
  function row(label, state, attrs, count){
    // state: 'on' | 'off' | 'partial'
    const ariaChecked = state === 'on' ? 'true' : state === 'partial' ? 'mixed' : 'false';
    const countHtml = (count != null) ? `<span class="fm-count">${placeCountLabel(count)}</span>` : '';
    return `<div class="fm-row" role="checkbox" tabindex="0" aria-checked="${ariaChecked}" data-state="${state}" ${attrs}>
      <span class="fm-check"></span><span class="fm-label">${label}</span>${countHtml}
    </div>`;
  }
  function groupRow(label, state, action, group, count){
    const collapsed = fmCollapsed[group];
    const ariaChecked = state === 'on' ? 'true' : state === 'partial' ? 'mixed' : 'false';
    const countHtml = `<span class="fm-count">${placeCountLabel(count)}</span>`;
    return `<div class="fm-row fm-group-row" role="checkbox" tabindex="0" aria-checked="${ariaChecked}" data-state="${state}" data-action="${action}">
      <button class="fm-arrow${collapsed ? ' collapsed' : ''}" data-toggle="${group}" aria-label="${collapsed ? 'Expand' : 'Collapse'}" tabindex="-1">▾</button>
      <span class="fm-check"></span><span class="fm-label"><strong>${label}</strong></span>${countHtml}
    </div>`;
  }
  function groupState(predicate){
    let on = 0, total = 0;
    CANON_ORDER.forEach(b => { if (predicate(b)){ total++; if (filterChecked.has(b)) on++; } });
    if (on === 0) return 'off';
    if (on === total) return 'on';
    return 'partial';
  }
  const allState = groupState(() => true);
  const otState = groupState(b => OT_USFM.has(b));
  const ntState = groupState(b => !OT_USFM.has(b));

  let html = '';
  html += row('<strong>Select all</strong>', allState, 'data-action="all"', placeCountAll);
  html += '<div class="fm-divider"></div>';
  html += groupRow('Old Testament', otState, 'ot', 'ot', placeCountOT);
  if (!fmCollapsed.ot){
    CANON_ORDER.forEach(usfm => {
      if (!OT_USFM.has(usfm)) return;
      html += row(localizedBook(usfm), filterChecked.has(usfm) ? 'on' : 'off', `data-book="${usfm}"`, placeCountByBook.get(usfm) || 0);
    });
  }
  html += '<div class="fm-divider"></div>';
  html += groupRow('New Testament', ntState, 'nt', 'nt', placeCountNT);
  if (!fmCollapsed.nt){
    CANON_ORDER.forEach(usfm => {
      if (OT_USFM.has(usfm)) return;
      html += row(localizedBook(usfm), filterChecked.has(usfm) ? 'on' : 'off', `data-book="${usfm}"`, placeCountByBook.get(usfm) || 0);
    });
  }
  filterMenu.innerHTML = html;
}

function applyBookFilterFromUI(){
  bookFilter = (filterChecked.size === CANON_ORDER.length) ? null : new Set(filterChecked);
  filterBtn.classList.toggle('on', !!bookFilter);
  refresh();
  buildSuggestions();
}

filterBtn.onclick = (e) => {
  e.stopPropagation();
  if (!filterMenu.hidden){ filterMenu.hidden = true; return; }
  document.getElementById('suggest').classList.remove('show');
  // Sync filterChecked from current bookFilter so reopening reflects current state
  filterChecked.clear();
  (bookFilter || CANON_ORDER).forEach(b => filterChecked.add(b));
  buildFilterMenu();
  filterMenu.hidden = false;
};

function toggleRow(row){
  if (!row) return;
  const action = row.dataset.action;
  const state = row.dataset.state;
  // "partial" rows toggle to "on" (select all in group). Otherwise flip.
  const turnOn = (state !== 'on');
  if (action === 'all'){
    if (turnOn) CANON_ORDER.forEach(b => filterChecked.add(b));
    else filterChecked.clear();
  } else if (action === 'ot'){
    CANON_ORDER.forEach(b => {
      if (!OT_USFM.has(b)) return;
      if (turnOn) filterChecked.add(b); else filterChecked.delete(b);
    });
  } else if (action === 'nt'){
    CANON_ORDER.forEach(b => {
      if (OT_USFM.has(b)) return;
      if (turnOn) filterChecked.add(b); else filterChecked.delete(b);
    });
  } else {
    const b = row.dataset.book;
    if (!b) return;
    if (turnOn) filterChecked.add(b); else filterChecked.delete(b);
  }
  buildFilterMenu();
  applyBookFilterFromUI();
}

filterMenu.addEventListener('click', e => {
  e.stopPropagation();
  const arrow = e.target.closest('.fm-arrow');
  if (arrow){
    const g = arrow.dataset.toggle;
    fmCollapsed[g] = !fmCollapsed[g];
    buildFilterMenu();
    return;
  }
  const row = e.target.closest('.fm-row');
  if (!row) return;
  toggleRow(row);
});
filterMenu.addEventListener('keydown', e => {
  if (e.key !== ' ' && e.key !== 'Enter') return;
  const row = e.target.closest('.fm-row');
  if (!row) return;
  e.preventDefault();
  toggleRow(row);
});

document.addEventListener('click', e => {
  if (!filterMenu.hidden && !e.target.closest('#filterMenu') && !e.target.closest('#filterBtn')){
    filterMenu.hidden = true;
  }
});

/* ---- URL state + browser history ----
   Each navigable view (closed / place open / verse open) is a history entry.
   - Opening a place pushes ?loc=Name
   - Opening a verse pushes ?loc=Name&ref=Book+Ch:Vs[&src=Name]
   - Closing the modal/panel pops back via history.back(), letting the
     browser handle the back stack.
   Version is a persistent preference; we encode it as a hash so changing it
   doesn't push a new history entry.
*/
let suppressHistory = false; // true while we're applying URL → UI (avoid feedback loops)

function buildUrl(state){
  const params = new URLSearchParams();
  if (state.loc) params.set('loc', state.loc);
  if (state.ref) params.set('ref', state.ref);
  if (state.src) params.set('src', state.src);
  const qs = params.toString();
  let url = location.pathname + (qs ? '?' + qs : '');
  if (currentVersion !== 'kjv'){
    const t = TR_BY_ID[currentVersion];
    if (t) url += '#v=' + t.acronym;
  }
  return url;
}

function pushState(state){
  if (suppressHistory) return;
  try { history.pushState(state, '', buildUrl(state)); } catch(e){}
}
function replaceState(state){
  try { history.replaceState(state, '', buildUrl(state)); } catch(e){}
}

function currentState(){
  return {
    loc: current ? current.name : null,
    ref: activeRef,
    src: activeRef ? activeSourceName : null,
  };
}

/* Apply a state object (from popstate or initial load) to the UI.
   Doesn't push new history — uses suppressHistory + replaceState. */
function applyState(state){
  state = state || {};
  suppressHistory = true;
  try {
    // 1) Close anything not in the target state.
    if (!state.ref && ov.classList.contains('show')){
      ov.classList.remove('show');
      activeRef = null; activeSourceName = null;
    }
    if (!state.loc && current){
      panel.classList.remove('show'); panel.classList.remove('with-swatch');
      current = null;
      setSelected(null);
    }
    // 2) Open place if needed.
    if (state.loc && (!current || current.name !== state.loc)){
      const target = findPlaceByName(state.loc);
      if (target){
        map.setView([target.lat, target.lng], Math.max(map.getZoom(), 9), {animate:false});
        openPanel(target);
      }
    }
    // 3) Open verse modal if needed.
    if (state.ref){
      if (activeRef !== state.ref || activeSourceName !== (state.src || null)){
        showVerse(state.ref, state.src || null);
      }
    }
  } finally {
    suppressHistory = false;
  }
}

function findPlaceByName(name){
  if (!name) return null;
  const q = name.toLowerCase();
  let t = records.find(r => r.name.toLowerCase() === q);
  if (!t){
    for (const r of records){
      if (r.akas && r.akas.some(a => a[0].toLowerCase() === q)){ t = r; break; }
    }
  }
  return t;
}

window.addEventListener('popstate', e => {
  applyState(e.state || readUrlState());
});

function readUrlState(){
  const p = new URLSearchParams(location.search);
  return {
    loc: p.get('loc'),
    ref: p.get('ref'),
    src: p.get('src'),
  };
}

let pendingState = null;
(function readInitial(){
  // version from hash (preferred) or query (legacy)
  const hash = location.hash || '';
  const hashMatch = hash.match(/[#&]v=([^&]+)/);
  const qVer = new URLSearchParams(location.search).get('version');
  const tok = (hashMatch && decodeURIComponent(hashMatch[1])) || qVer;
  const t = findTranslation(tok);
  if (t){
    currentVersion = t.id;
    try { localStorage.setItem('bible_version', currentVersion); } catch(e){}
  }
  pendingState = readUrlState();
})();

function dispatchPendingState(){
  // Replace (don't push) the initial state so the very first entry
  // represents whatever the URL asked for.
  replaceState(pendingState || {});
  if (pendingState && (pendingState.loc || pendingState.ref)){
    applyState(pendingState);
  }
  pendingState = null;
}


const placeImages = {}; // name -> {img, atlas}
let imagesHidden = false;
try { imagesHidden = localStorage.getItem('bible_images_hidden') === '1'; } catch(e){}

fetch('place_images.json')
  .then(r => r.ok ? r.json() : null)
  .then(data => {
    if (!data) return;
    Object.assign(placeImages, data);
    // If a panel is already open, re-render so the image appears.
    if (current) openPanel(current);
  })
  .catch(() => { /* optional file; ignore */ });

fetch('result.json')
  .then(r => {
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return r.json();
  })
  .then(data => { buildRecords(data); dispatchPendingState(); })
  .catch(err => {
    document.getElementById('count').textContent = 'Failed to load result.json';
    console.error('Could not load result.json. If opening via file://, serve over HTTP instead (e.g. `python -m http.server`).', err);
  });
