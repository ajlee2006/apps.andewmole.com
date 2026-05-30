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

/* ---- bible-api.com translations ---- */
/* KJV is the default; in the dropdown KJV appears at the very top, then groups by language. */
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
  {id:'cherokee',  acronym:'CHEROKEE', name:'Cherokee New Testament',                 lang:'Cherokee'},
  {id:'cuv',       acronym:'CUV',      name:'Chinese Union Version',                  lang:'Chinese'},
  {id:'bkr',       acronym:'BKR',      name:'Bible kralická',                         lang:'Czech'},
  {id:'clementine',acronym:'VULGATE',  name:'Clementine Latin Vulgate',               lang:'Latin'},
  {id:'almeida',   acronym:'ALMEIDA',  name:'João Ferreira de Almeida',               lang:'Portuguese'},
  {id:'rccv',      acronym:'RCCV',     name:'Romanian Corrected Cornilescu Version',  lang:'Romanian'},
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
const versesIndex = {}; // "Book Ch:Vs" -> [{key, name}, ...]

function indexVerses(str, key, displayName){
  str.split(',').map(t => t.trim()).filter(Boolean).forEach(tok => {
    if (!/^.*?\s+\d+:\d+$/.test(tok)) return;
    (versesIndex[tok] = versesIndex[tok] || []).push({key, name: displayName});
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
    indexVerses(verses, key, name);
    if (akas) akas.forEach(a => indexVerses(a[2], key, a[0]));
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
  let html = `<div class="verses">${renderVerses(r.verses, r.name)}</div>`;
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
  // Only push history if this is actually a new view.
  const cur = history.state;
  if (!cur || cur.loc !== r.name || cur.ref){
    pushState({ loc: r.name });
  }
}
document.getElementById('pClose').onclick = () => {
  // Use back so a fresh load with ?loc=X doesn't leave us on a non-existent
  // history entry. If there's nothing to go back to, just close in place.
  if (history.state && (history.state.loc || history.state.ref)){
    history.back();
  } else {
    panel.classList.remove('show');
    panel.classList.remove('with-swatch');
    current = null;
    replaceState({});
  }
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

const LOCALIZED_BOOKS = {"cuv":{"GEN":"創世紀","EXO":"出埃及記","LEV":"利未記","NUM":"民數記","DEU":"申命記","JOS":"約書亞記","JDG":"士師記","RUT":"路得記","1SA":"撒母耳記上","2SA":"撒母耳記下","1KI":"列王紀上","2KI":"列王紀下","1CH":"歷代志上","2CH":"歷代志下","EZR":"以斯拉記","NEH":"尼希米記","EST":"以斯帖記","JOB":"約伯記","PSA":"詩篇","PRO":"箴言","ECC":"傳道書","SNG":"雅歌","ISA":"以賽亞書","JER":"耶利米書","LAM":"耶利米哀歌","EZK":"以西結書","DAN":"但以理書","HOS":"何西阿書","JOL":"約珥書","AMO":"阿摩司書","OBA":"俄巴底亞書","JON":"約拿書","MIC":"彌迦書","NAM":"那鴻書","HAB":"哈巴谷書","ZEP":"西番雅書","HAG":"哈該書","ZEC":"撒迦利亞書","MAL":"瑪拉基書","MAT":"馬太福音","MRK":"馬可福音","LUK":"路加福音","JHN":"約翰福音","ACT":"使徒行傳","ROM":"羅馬書","1CO":"哥林多前書","2CO":"哥林多後書","GAL":"加拉太書","EPH":"以弗所書","PHP":"腓利比書","COL":"歌羅西書","1TH":"帖撒羅尼迦前書","2TH":"帖撒羅尼迦後書","1TI":"提摩太前書","2TI":"提摩太後書","TIT":"提多書","PHM":"腓利門書","HEB":"希伯來書","JAS":"雅各書","1PE":"彼得前書","2PE":"彼得後書","1JN":"約翰壹書","2JN":"約翰貳書","3JN":"約翰參書","JUD":"猶大書","REV":"啟示錄"},"bkr":{"GEN":"Genesis","EXO":"Exodus","LEV":"Leviticus","NUM":"Numeri","DEU":"Deuteronomium","JOS":"Jozue","JDG":"Soudců","RUT":"Rút","1SA":"1. Samuel","2SA":"2. Samuel","1KI":"1. Královská","2KI":"2. Královská","1CH":"1. Paralipomenon","2CH":"2. Paralipomenon","EZR":"Ezdráš","NEH":"Nehemiáš","EST":"Ester","JOB":"Job","PSA":"Žalmy","PRO":"Přísloví","ECC":"Kazatel","SNG":"Píseň písní","ISA":"Izaiáš","JER":"Jeremiáš","LAM":"Pláč","EZK":"Ezechiel","DAN":"Daniel","HOS":"Ozeáš","JOL":"Joel","AMO":"Amos","OBA":"Abdiáš","JON":"Jonáš","MIC":"Micheáš","NAM":"Nahum","HAB":"Abakuk","ZEP":"Sofoniáš","HAG":"Ageus","ZEC":"Zachariáš","MAL":"Malachiáš","MAT":"Matouš","MRK":"Marek","LUK":"Lukáš","JHN":"Jan","ACT":"Skutky","ROM":"Římanům","1CO":"1. Korintským","2CO":"2. Korintským","GAL":"Galatským","EPH":"Efeským","PHP":"Filipským","COL":"Koloským","1TH":"1. Tesalonickým","2TH":"2. Tesalonickým","1TI":"1. Timoteovi","2TI":"2. Timoteovi","TIT":"Titovi","PHM":"Filemonovi","HEB":"Židům","JAS":"Jakub","1PE":"1. Petr","2PE":"2. Petr","1JN":"1. Jan","2JN":"2. Jan","3JN":"3. Jan","JUD":"Juda","REV":"Zjevení"},"clementine":{"GEN":"Genesis","EXO":"Exodus","LEV":"Leviticus","NUM":"Numeri","DEU":"Deuteronomium","JOS":"Josue","JDG":"Judicum","RUT":"Ruth","1SA":"Regum I","2SA":"Regum II","1KI":"Regum III","2KI":"Regum IV","1CH":"Paralipomenon I","2CH":"Paralipomenon II","EZR":"Esdræ","NEH":"Nehemiæ","EST":"Tobiæ","JOB":"Job","PSA":"Psalmi","PRO":"Proverbia","ECC":"Ecclesiastes","SNG":"Canticum Canticorum","ISA":"Isaias","JER":"Jeremias","LAM":"Lamentationes","EZK":"Ezechiel","DAN":"Daniel","HOS":"Osee","JOL":"Joël","AMO":"Amos","OBA":"Abdias","JON":"Jonas","MIC":"Michæa","NAM":"Nahum","HAB":"Habacuc","ZEP":"Sophonias","HAG":"Aggæus","ZEC":"Zacharias","MAL":"Malachias","MAT":"Matthæus","MRK":"Marcus","LUK":"Lucas","JHN":"Joannes","ACT":"Actus Apostolorum","ROM":"ad Romanos","1CO":"ad Corinthios I","2CO":"ad Corinthios II","GAL":"ad Galatas","EPH":"ad Ephesios","PHP":"ad Philippenses","COL":"ad Colossenses","1TH":"ad Thessalonicenses I","2TH":"ad Thessalonicenses II","1TI":"ad Timotheum I","2TI":"ad Timotheum II","TIT":"ad Titum","PHM":"ad Philemonem","HEB":"ad Hebræos","JAS":"Jacobi","1PE":"Petri I","2PE":"Petri II","1JN":"Joannis I","2JN":"Joannis II","3JN":"Joannis III","JUD":"Judæ","REV":"Apocalypsis"},"almeida":{"GEN":"Gênesis","EXO":"Êxodo","LEV":"Levítico","NUM":"Números","DEU":"Deuteronômio","JOS":"Josué","JDG":"Juízes","RUT":"Rute","1SA":"1 Samuel","2SA":"2 Samuel","1KI":"1 Reis","2KI":"2 Reis","1CH":"1 Crônicas","2CH":"2 Crônicas","EZR":"Esdras","NEH":"Neemias","EST":"Ester","JOB":"Jó","PSA":"Salmos","PRO":"Provérbios","ECC":"Eclesiastes","SNG":"Cânticos","ISA":"Isaías","JER":"Jeremias","LAM":"Lamentações","EZK":"Ezequiel","DAN":"Daniel","HOS":"Oséias","JOL":"Joel","AMO":"Amós","OBA":"Obadias","JON":"Jonas","MIC":"Miquéias","NAM":"Naum","HAB":"Habacuque","ZEP":"Sofonias","HAG":"Ageu","ZEC":"Zacarias","MAL":"Malaquias","MAT":"Mateus","MRK":"Marcos","LUK":"Lucas","JHN":"João","ACT":"Atos","ROM":"Romanos","1CO":"1 Coríntios","2CO":"2 Coríntios","GAL":"Gálatas","EPH":"Efésios","PHP":"Filipenses","COL":"Colossenses","1TH":"1 Tessalonicenses","2TH":"2 Tessalonicenses","1TI":"1 Timóteo","2TI":"2 Timóteo","TIT":"Tito","PHM":"Filemom","HEB":"Hebreus","JAS":"Tiago","1PE":"1 Pedro","2PE":"2 Pedro","1JN":"1 João","2JN":"2 João","3JN":"3 João","JUD":"Judas","REV":"Apocalipse"},"rccv":{"GEN":"Geneza","EXO":"Exodul","LEV":"Leviticul","NUM":"Numeri","DEU":"Deuteronomul","JOS":"Iosua","JDG":"Judecători","RUT":"Rut","1SA":"1 Samuel","2SA":"2 Samuel","1KI":"1 Împăraţi","2KI":"2 Împăraţi","1CH":"1 Cronici","2CH":"2 Cronici","EZR":"Ezra","NEH":"Neemia","EST":"Estera","JOB":"Iov","PSA":"Psalmii","PRO":"Proverbe","ECC":"Eclesiastul","SNG":"Cântarea cântărilor","ISA":"Isaia","JER":"Ieremia","LAM":"Plângerile lui Ieremia","EZK":"Ezechiel","DAN":"Daniel","HOS":"Osea","JOL":"Ioel","AMO":"Amos","OBA":"Obadia","JON":"Iona","MIC":"Mica","NAM":"Naum","HAB":"Habacuc","ZEP":"Ţefania","HAG":"Hagai","ZEC":"Zaharia","MAL":"Maleahi","MAT":"Matei","MRK":"Marcu","LUK":"Luca","JHN":"Ioan","ACT":"Faptele apostolilor","ROM":"Romani","1CO":"1 Corinteni","2CO":"2 Corinteni","GAL":"Galateni","EPH":"Efeseni","PHP":"Filipeni","COL":"Coloseni","1TH":"1 Tesaloniceni","2TH":"2 Tesaloniceni","1TI":"1 Timotei","2TI":"2 Timotei","TIT":"Tit","PHM":"Filimon","HEB":"Evrei","JAS":"Iacov","1PE":"1 Petru","2PE":"2 Petru","1JN":"1 Ioan","2JN":"2 Ioan","3JN":"3 Ioan","JUD":"Iuda","REV":"Apocalipsa"},"cherokee":{"MAT":"ᎣᏍᏛ ᎧᏃᎮᏛ ᎹᏚ ᎤᏬᏪᎳᏅᎯ","MRK":"ᎣᏍᏛ ᎧᏃᎮᏛ ᎹᎦ ᎤᏬᏪᎳᏅᎯ","LUK":"ᎣᏍᏛ ᎧᏃᎮᏛ ᎷᎦ ᎤᏬᏪᎳᏅᎯ","JHN":"ᎣᏍᏛ ᎧᏃᎮᏛ ᏣᏂ ᎤᏬᏪᎳᏅᎯ","ACT":"ᎨᏥᏅᏏᏛ ᏄᎾᏛᏁᎵᏙᎸᎢ","ROM":"ᏉᎳ ᎶᎻ ᎠᏁᎯ ᏧᏬᏪᎳᏁᎸᎯ","1CO":"ᎪᎵᏂᏗᏱ ᎠᏁᎯ ᎢᎬᏱᏱ ᎨᎪᏪᎳ
