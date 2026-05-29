// =============================================================
// CDN-loaded dictionaries (loaded on demand)
// =============================================================
let cmudict = null;
let toJyutping = null;
let pinyinLib = null;
let confusablesInverted = null;  // canonical char → array of confusable chars

async function loadCmudict() {
  if (cmudict) return cmudict;
  const mod = await import('https://esm.sh/cmu-pronouncing-dictionary@3.0.0');
  cmudict = mod.dictionary;
  return cmudict;
}

async function loadJyutping() {
  if (toJyutping) return toJyutping;
  toJyutping = await import('https://esm.sh/to-jyutping@3.1.1');
  return toJyutping;
}

async function loadPinyin() {
  if (pinyinLib) return pinyinLib;
  const mod = await import('https://esm.sh/pinyin@4.0.0-alpha.2');
  // The module may export `pinyin` as a named export, default export, or both.
  // Normalize so we always call `pinyinLib(text, opts)`.
  if (typeof mod.pinyin === 'function') pinyinLib = mod.pinyin;
  else if (typeof mod.default === 'function') pinyinLib = mod.default;
  else if (typeof mod.default?.pinyin === 'function') pinyinLib = mod.default.pinyin;
  else throw new Error('Could not find pinyin function in the loaded module');
  return pinyinLib;
}

async function loadConfusables() {
  if (confusablesInverted) return confusablesInverted;
  // Unicode confusables data — wrong → canonical map. We invert it so we can
  // pick a random confusable that LOOKS like a given canonical character.
  const res = await fetch('https://cdn.jsdelivr.net/npm/unicode-confusables-data@10.0.0-20170721/confusables.json');
  const data = await res.json();
  const inverted = Object.create(null);
  for (const wrong in data) {
    const right = data[wrong];
    if (!inverted[right]) inverted[right] = [];
    inverted[right].push(wrong);
  }
  confusablesInverted = inverted;
  return confusablesInverted;
}

// =============================================================
// ARPAbet → IPA mapping
// =============================================================
const arpaToIpa = {
  'AA':'ɑ','AE':'æ','AH':'ʌ','AO':'ɔ','AW':'aʊ','AY':'aɪ',
  'B':'b','CH':'ʧ','D':'d','DH':'ð',
  'EH':'ɛ','ER':'ɜr','EY':'eɪ',
  'F':'f','G':'ɡ','HH':'h',
  'IH':'ɪ','IY':'i',
  'JH':'ʤ','K':'k','L':'l','M':'m','N':'n','NG':'ŋ',
  'OW':'oʊ','OY':'ɔɪ',
  'P':'p','R':'r','S':'s','SH':'ʃ',
  'T':'t','TH':'θ',
  'UH':'ʊ','UW':'u',
  'V':'v','W':'w','Y':'j','Z':'z','ZH':'ʒ'
};

function arpaWordToIpa(arpaStr) {
  const phones = arpaStr.split(/\s+/);
  let out = '';
  let primaryUsed = false;
  const items = [];
  for (const p of phones) {
    const stress = p.match(/(\d)$/);
    const sym = p.replace(/\d+$/, '');
    let ipa = arpaToIpa[sym] || '';
    if (sym === 'AH' && stress && stress[1] === '0') ipa = 'ə';
    if (sym === 'ER' && stress && stress[1] === '0') ipa = 'ər';
    items.push({ ipa, stress: stress ? stress[1] : null });
  }
  for (let i = 0; i < items.length; i++) {
    const { ipa, stress } = items[i];
    if (stress === '1' && !primaryUsed) { out += 'ˈ' + ipa; primaryUsed = true; }
    else if (stress === '2') out += 'ˌ' + ipa;
    else out += ipa;
  }
  return out;
}

async function eng2ipa(text) {
  const dict = await loadCmudict();
  const tokens = text.split(/(\s+|[^\w']+)/);
  return tokens.map(tok => {
    if (!tok) return '';
    if (/^\s+$/.test(tok)) return tok;
    if (!/[a-zA-Z]/.test(tok)) return tok;
    const key = tok.toLowerCase();
    const arpa = dict[key];
    if (arpa) return arpaWordToIpa(arpa);
    return '*' + tok + '*';
  }).join('');
}

// =============================================================
// 1. MOCKING TEXT
// =============================================================
function mock(s) {
  s = s.normalize('NFD');
  let fin = '';
  let up = false;
  for (const ch of s) {
    if (ch.toUpperCase() !== ch.toLowerCase()) {
      if (ch.toLowerCase() === 'i') { fin += 'i'; up = true; }
      else if (ch.toLowerCase() === 'l') { fin += 'L'; up = false; }
      else { fin += up ? ch.toUpperCase() : ch.toLowerCase(); up = !up; }
    } else {
      fin += ch;
      if (/\s/.test(ch)) up = false;
    }
  }
  return fin.normalize('NFC');
}

// =============================================================
// 2. MR CHIA
// =============================================================
function mrchia(text) {
  const pick = arr => arr[Math.floor(Math.random() * arr.length)];
  text = text.replace(/\b(\w{6,})\b(?![.!?,;:])/gi, (m) =>
    m + pick(['-tsa', '', '-tsa, okya,', '', ', okya,']));
  text = text.replace(/,(?!\s*(ya|okya|ok)\b)/gi, () =>
    pick(['-tsa, okya,', ', okya,', '-tsa, ok,', ', ok,', ',']));
  text = text.replace(/;(?!\s*(ya|okya|ok)\b)/gi, () =>
    pick(['-tsa, okya;', ', okya;', '-tsa, ok;', ', ok;', ';']));
  text = text.replace(/:(?!\s*(ya|okya|ok)\b)/gi, () =>
    pick(['-tsa, okya:', ', okya:', '-tsa, ok:', ', ok:', ':']));
  text = text.replace(/\.(?!\s*(ya|okya|ok)\b)/gi, () =>
    pick(['-tsa, okya.', '-tsa, ok, ya.', '-tsa, ok.', '-tsa-okya.', ', ok.', ', okya.', ', ok. Ya.', '.']));
  text = text.replace(/!(?!\s*(ya|okya|ok)\b)/gi, () =>
    pick(['. Ya!', '-tsa. Ya!', ', ok, ya!', '-tsa, ok, ya!', ', ok. Ya!', '-tsa, ok. Ya!', '! Okya.', '!']));
  text = text.replace(/\?(?!\s*(ya|okya|ok)\b)/gi, () =>
    pick(['? Mm, okya.', '-tsa?', '-tsa? Okya.', '? Okya.', '?']));
  return text;
}

// =============================================================
// 3. FILL IN THE BLANKS
// =============================================================
const shortwordlist = "at and the that of it is for to by this in an are were am was".split(' ');
function fill(para, level = 'h') {
  const wordlist = para.split(/\s+/).filter(Boolean);
  if (wordlist.length === 0) return '';
  let rpnum;
  if (level === 'e') rpnum = Math.floor(wordlist.length / 4);
  else if (level === 'm') rpnum = Math.floor(wordlist.length / 2);
  else if (level === 'h') rpnum = Math.floor((wordlist.length / 4) * 3);
  else if (level === 'a' || level === 'l') rpnum = wordlist.length;
  else if (level === 'r') rpnum = Math.floor(Math.random() * wordlist.length) + 1;
  const blankify = (word) => {
    if (word.indexOf('_') !== -1) return word;
    let res = word[0];
    for (let x = 1; x < word.length; x++) {
      if (/[A-Za-z]/.test(word[x])) res += '_';
      else res += word[x];
    }
    return res;
  };
  if (level !== 'a') {
    for (let i = 0; i < rpnum; i++) {
      const ran = Math.floor(Math.random() * wordlist.length);
      const blank = wordlist[ran];
      if (blank.length >= 3 && !shortwordlist.includes(blank.toLowerCase())) {
        wordlist[ran] = blankify(blank);
      }
    }
  } else {
    for (let i = 0; i < rpnum; i++) wordlist[i] = blankify(wordlist[i]);
  }
  return wordlist.join(' ');
}

// =============================================================
// 4. EMOJI ALPHABET
// =============================================================
const emojiAlphabet = {
  'A':['🅰️','🇦'],'B':['🇧'],'C':['©️','☪️','🇨'],'D':['↩️','🇩'],
  'E':['📧','🇪'],'F':['🎏','🇫'],'G':['⛽️','🇬'],'H':['♓️','🇭'],
  'I':['ℹ️','🇮'],'J':['☔','🗾','🇯'],'K':['🎋','🇰'],'L':['🕒','👢','🇱'],
  'M':['Ⓜ️','♏️','♍️','〽','🇲'],'N':['📈','♑','🇳'],'O':['🅾️','⭕️','🇴'],
  'P':['🅿️','🇵'],'Q':['♌','🇶'],'R':['®️','🇷'],'S':['💰','⚡️','🇸'],
  'T':['✝️','🌴','🇹'],'U':['⛎','🇺'],'V':['♈️','🇻'],'W':['〰️','🇼'],
  'X':['❎','❌','✖️','🇽'],'Y':['🌱','✌','🇾'],'Z':['Ⓩ','🇿'],
  '!':['❗️','❕'],'?':['❓','❔'],'#':['#️⃣'],'*':['*️⃣'],'+':['➕'],
  '0':['0️⃣'],'1':['1️⃣'],'2':['2️⃣'],'3':['3️⃣'],'4':['4️⃣'],
  '5':['5️⃣'],'6':['6️⃣'],'7':['7️⃣'],'8':['8️⃣'],'9':['9️⃣']
};
function emojify(s) {
  let t = '';
  for (const ch of s) {
    const up = ch.toUpperCase();
    if (emojiAlphabet[up]) {
      const arr = emojiAlphabet[up];
      t += arr[Math.floor(Math.random() * arr.length)];
    } else t += ch;
  }
  return t;
}

// =============================================================
// 5. GREEK CONVERTERS
// =============================================================
function greekToEng(s) {
  const greek = ":ΕΡΤΥΘΙΟΠΑΣΔΦΓΗΞΚΛΖΧΨΩΒΝΜ;ςερτυθιοπασδφγηξκλζχψωβνμ";
  const eng =   "QERTYUIOPASDFGHJKLZXCVBNMqwertyuiopasdfghjklzxcvbnm";
  let fin = '';
  for (const c of s.normalize('NFD')) {
    const i = greek.indexOf(c);
    fin += i !== -1 ? eng[i] : c;
  }
  return fin;
}
function engToGreek(s) {
  const eng =   "QWERTYUIOPASDFGHJKLZXCVBNMqwertyuiopasdfghjklzxcvbnm";
  const greek = ":ΣΕΡΤΥΘΙΟΠΑΣΔΦΓΗΞΚΛΖΧΨΩΒΝΜ;ςερτυθιοπασδφγηξκλζχψωβνμ";
  let fin = '';
  for (const c of s.normalize('NFD')) {
    const i = eng.indexOf(c);
    fin += i !== -1 ? greek[i] : c;
  }
  return fin;
}
function greekLL(s) {
  const greek = "ΕΡΤΥΘΙΟΠΑΣΔΦΓΗΞΚΛΖΧΨΩΒΝΜςερτυθιοπασδφγηξκλζχψωβνμ";
  const eng =   "EPTYOIOHAEAG7HEKAZZWOBNMceptu0ionaodgynEkAZxwwBvu";
  let fin = '';
  for (const c of s.normalize('NFD')) {
    const i = greek.indexOf(c);
    fin += i !== -1 ? eng[i] : c;
  }
  return fin;
}

// English → Greek Lookalike: reverse the greekLL mapping. Each English char
// may have several Greek lookalikes (e.g. A can be Α, Λ, Δ), so we pick a
// random one each call. Non-letter characters pass through unchanged.
function engToGreekLL(s) {
  const greek = "ΕΡΤΥΘΙΟΠΑΣΔΦΓΗΞΚΛΖΧΨΩΒΝΜςερτυθιοπασδφγηξκλζχψωβνμ";
  const eng =   "EPTYOIOHAEAG7HEKAZZWOBNMceptu0ionaodgynEkAZxwwBvu";
  // Build reverse lookup: english char → array of greek lookalikes
  const rev = {};
  for (let i = 0; i < eng.length; i++) {
    if (!rev[eng[i]]) rev[eng[i]] = [];
    rev[eng[i]].push(greek[i]);
  }
  let fin = '';
  for (const c of s.normalize('NFD')) {
    if (rev[c]) {
      const opts = rev[c];
      fin += opts[Math.floor(Math.random() * opts.length)];
    } else {
      fin += c;
    }
  }
  return fin;
}

// =============================================================
// 6. TOKI PONA ↔ ASCII
// =============================================================
function tokiSplit(s) {
  s = s + ' ';
  const out = [];
  const cons = 'MNPTKSWLJmnptkswlj';
  const vowe = 'IUEOAiueoa';
  let syl = '';
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (vowe.includes(ch)) syl += ch;
    else if (cons.includes(ch)) {
      if (ch === 'n') {
        if (syl.length === 2) {
          if (vowe.includes(s[i+1])) { out.push(syl); syl = ch; }
          else { out.push(syl + ch); syl = ''; }
        } else if (syl.length === 1) {
          out.push(syl);
          if (vowe.includes(s[i+1])) syl = ch;
        }
      } else {
        if (syl !== '') out.push(syl);
        syl = ch;
      }
    } else {
      if (syl !== '') { out.push(syl); syl = ''; }
      out.push(ch);
    }
  }
  if (out.length && out[out.length-1].trim() === '') out.pop();
  return out;
}
const tokiAsc = ['!','#','$','%','&','*','/','0','1','2','3','4','5','6','?','@','A','B','C','E','F','G','H','I','J','K','L','M','N','O','P','Q','R','S','T','U','V','W','X','Y','Z','^','a','b','c','e','f','g','h','i','j','k','l','m','n','o','p','q','r','s','t','u','v','w','x','y','z','~',',','8','(','|',')','+','d','{',';','<','9','-','[','"','7','_','=','D','\\','>','`','}',']',"'"];
const tokiSyl = ['in','nan','len','pin','en','no','nu','u','wan','tu','mun','sun','lu','pan','me','mon','an','pe','sin','te','pen','ke','ko','lin','jo','ka','la','ma','ni','mo','pi','kin','lon','so','ta','un','we','wi','tan','ja','se','ne','a','pa','sa','e','pu','ken','kon','i','jan','ki','li','mi','na','o','po','ku','le','si','to','mu','wen','wa','ten','je','su','lo','ju','min','nin','win','nun','pun','tun','kun','lun','jun','men','nen','sen','jen','on','non','pon','ton','son','jon','man','kan','san','lan'];

function syl2asc(s) {
  const parts = tokiSplit(s);
  let fs = '';
  for (const p of parts) {
    const idx = tokiSyl.indexOf(p);
    fs += idx !== -1 ? tokiAsc[idx] : p;
  }
  return fs;
}
function asc2syl(s) {
  let fs = '';
  for (const ch of s) {
    const idx = tokiAsc.indexOf(ch);
    fs += idx !== -1 ? tokiSyl[idx] : ch;
  }
  return fs;
}

// =============================================================
// 7. NRIC CHECKER
// =============================================================
function nricCheck(letter, numbers, checksum) {
  let sum = 0;
  const weights = [2,7,6,5,4,3,2];
  for (let i = 0; i < 7; i++) sum += parseInt(numbers[i]) * weights[i];
  if (letter === 'T' || letter === 'G') sum += 4;
  const rem = sum % 11;
  if (letter === 'S' || letter === 'T') return "JZIHGFEDCBA"[rem] === checksum;
  if (letter === 'F' || letter === 'G') return "XWUTRQPNMLK"[rem] === checksum;
  return false;
}
function checkAllNric(s) {
  if (!s) return '';
  s = s.trim();
  if (s.length !== 9) return 'Invalid format. Must be 9 characters.';
  let letters, numbers, checksum;
  try {
    letters = s[0].toUpperCase();
    numbers = s.substring(1, 8);
    checksum = s[8].toUpperCase();
  } catch { return 'Invalid format.'; }
  const lol = [];
  lol.push(letters === '_' ? [...'STFG'] : [letters]);
  for (const c of numbers) lol.push(c === '_' ? [...'0123456789'] : [c]);
  lol.push(checksum === '_' ? [...'JZIHGFEDCBAXWUTRQPNMLK'] : [checksum]);
  const results = [];
  for (const a of lol[0])
   for (const b of lol[1]) for (const c of lol[2]) for (const d of lol[3])
    for (const e of lol[4]) for (const f of lol[5]) for (const g of lol[6])
     for (const h of lol[7]) for (const i of lol[8])
      if (nricCheck(a, b+c+d+e+f+g+h, i))
        results.push(a+b+c+d+e+f+g+h+i);
  return results.length ? results.join('\n') : 'No valid NRIC numbers found.';
}

// =============================================================
// 8. CAR PLATE CHECKER
// =============================================================
function carCheck(letters, numbers, checksum) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const checkalph = "AZYXUTSRPMLKJHGEDCB";
  let a, b;
  if (letters.length === 1) { a = 0; b = alphabet.indexOf(letters) + 1; }
  else {
    a = alphabet.indexOf(letters[letters.length-2]) + 1;
    b = alphabet.indexOf(letters[letters.length-1]) + 1;
  }
  const nums = '0'.repeat(4 - numbers.length) + numbers;
  const c = +nums[0], d = +nums[1], e = +nums[2], f = +nums[3];
  const rem = (a*9 + b*4 + c*5 + d*4 + e*3 + f*2) % 19;
  return checksum === checkalph[rem];
}
function cartesian(arrays) {
  return arrays.reduce((acc, curr) =>
    acc.flatMap(a => curr.map(c => [...a, c])), [[]]);
}
function checkCarPlate(s) {
  if (!s) return '';
  let letters, numbers, checksum;
  try {
    const ss = s.split(' ');
    letters = ss[0].toUpperCase().slice(-3);
    numbers = ss[1].substring(0, 4);
    checksum = ss[2].toUpperCase()[0];
  } catch { return 'Invalid format. Use: LETTERS NUMBERS CHECKSUM'; }
  if (letters.includes('I') || letters.includes('O'))
    return 'I and O are not used in license plates.';
  if ('FINOQVW'.includes(checksum))
    return checksum + ' is not used for checksums.';
  const alphabet = [..."ABCDEFGHIJKLMNOPQRSTUVWXYZ"];
  const digit = [..."0123456789"];
  const lol = [];
  for (const c of letters) lol.push(c === '_' ? alphabet : [c]);
  for (const c of numbers) lol.push(c === '_' ? digit : [c]);
  lol.push(checksum === '_' ? alphabet : [checksum]);
  const total = lol.reduce((a, arr) => a * arr.length, 1);
  if (total > 500000) return 'Too many possibilities — please specify more digits.';
  const results = [];
  const combos = cartesian(lol);
  for (const combo of combos) {
    const st = combo.join('');
    const nl = st.substring(0, letters.length);
    const nn = st.substring(letters.length, letters.length + numbers.length);
    const nc = st.substring(letters.length + numbers.length, letters.length + numbers.length + 1);
    if (carCheck(nl, nn, nc) && !nl.includes('I') && !nl.includes('O'))
      results.push(`${nl} ${nn} ${nc}`);
  }
  return results.length ? results.join('\n') : 'No valid plates found.';
}

// =============================================================
// 9. IPA → POLIESPELLINGLISH
// =============================================================
function ipa2pol(pron) {
  const ipalist = ['m','n','ŋ','p','b','t','d','k','ɡ','f','v','θ','ð','s','z','ʃ','ʒ','x','h','l','r','j','w','a','æ','ɑ','ɒ','ɔ','i','ɪ','e','ɛ','ɜ','ə','o','u','ʌ','ʊ','ʤ','ʧ','ˌ','ˈ','*','ʔ'];
  const pollist = ['m','n','ng','p','b','t','d','k','ɡ','f','v','t̂','ψ','s','z','ŝ','ĵ','ĥ','h','l','r','j','w','a','ⱥ','a','w','w','i','ĭ','e','ⱥ','q','x','o','u','q','u','ĝ','ĉ','','','',''];
  let fs = '';
  for (const ch of pron) {
    const i = ipalist.indexOf(ch);
    fs += i !== -1 ? pollist[i] : ch;
  }
  fs = fs.replace(/kts/g, 'ẑ');
  fs = fs.replace(/gdz/g, 'z̆');
  fs = fs.replace(/ts/g, 'c');
  fs = fs.replace(/h([mnbk])/g, '$1̆');
  fs = fs.replace(/pŭ/g, 'φ');
  fs = fs.replace(/([aeiouⱥĭwqxː])[iĭ]/g, '$1j');
  fs = fs.replace(/([aeioⱥĭwqxː])uŭ/g, '$1ŭ');
  fs = fs.replace(/([aeioⱥĭwqxː])u/g, '$1ŭ');
  fs = fs.replace(/ŭj([mnpbtdkgfvt̂ψszŝĵĥhlrjcφ])/g, 'ŭi$1');
  fs = fs.replace(/ː/g, ':');
  return fs;
}

// =============================================================
// 10. IPA → LONG
// =============================================================
function ipa2long(pron) {
  const ipalist = ['m','n','ŋ','p','b','t','d','k','ɡ','f','v','θ','ð','s','z','ʃ','ʒ','x','h','l','r','j','w','a','æ','ɑ','ɒ','ɔ','i','ɪ','e','ɛ','ɜ','ə','o','u','ʌ','ʊ','ʤ','ʧ','ˌ','ˈ','*'];
  const longlist = ['chm','gne','ngue','ppe','pb','ght','ld','cque','ckg','pph','lve','phth','the','tsw','sth','chsi','zhe','gh','ch','lle','ruar','ll','ou','aille','ei','aahe','ach','uoye','eye','oe','eighe','ieu','eure','ough','oughe','ueue','uddi','oul','ldzhe','ghtchsi','','','',''];
  let fs = '';
  for (const ch of pron) {
    const i = ipalist.indexOf(ch);
    fs += i !== -1 ? longlist[i] : ch;
  }
  return fs;
}

// =============================================================
// English → Poliespellinglish / Long (chained via IPA)
// =============================================================
async function eng2pol(text) {
  const ipa = await eng2ipa(text);
  return ipa2pol(ipa);
}
async function eng2long(text) {
  const ipa = await eng2ipa(text);
  return ipa2long(ipa);
}

// =============================================================
// Cantonese converters
// =============================================================
async function can2jyu(text) {
  const tj = await loadJyutping();
  if (tj.getJyutpingText) return tj.getJyutpingText(text);
  // Fallback: build from getJyutpingList
  const list = tj.getJyutpingList(text);
  return list.map(([ch, jp]) => jp !== null ? jp : ch).join(' ');
}
async function can2ipa(text) {
  const tj = await loadJyutping();
  const list = tj.getIPAList(text);
  return list.map(([ch, ipa]) => ipa !== null ? ipa : ch).join(' ');
}
async function jyu2ipa(text) {
  const tj = await loadJyutping();
  const out = [];
  for (const syll of text.split(/\s+/)) {
    if (!syll) continue;
    try { out.push(tj.jyutpingToIPA(syll)); }
    catch { out.push(syll); }
  }
  return out.join(' ');
}

// =============================================================
// Mandarin: Cyrillization (Palladius) and Gwoyeu Romatzyh
// -------------------------------------------------------------
// Both dictionaries map numbered pinyin syllables to their target
// romanization. They are embedded directly (about 30KB total) so
// they don't need a CDN fetch.
// =============================================================

// pinyin syllable (no tone) → cyrillic syllable (no tone marker)
const cyrDict = {"a":"а","ai":"ай","an":"ань","ang":"ан","ao":"ао","ba":"ба","bai":"бай","ban":"бань","bang":"бан","bao":"бао","bei":"бэй","ben":"бэнь","beng":"бэн","bi":"би","bian":"бянь","biao":"бяо","bie":"бе","bin":"бинь","bing":"бин","bo":"бо","bu":"бу","ca":"ца","cai":"цай","can":"цань","cang":"цан","cao":"цао","ce":"цэ","cen":"цэнь","ceng":"цэн","cha":"ча","chai":"чай","chan":"чань","chang":"чан","chao":"чао","che":"чэ","chen":"чэнь","cheng":"чэн","chi":"чи","chong":"чун","chou":"чоу","chu":"чу","chua":"чуа","chuai":"чуай","chuan":"чуань","chuang":"чуан","chui":"чуй","chun":"чунь","chuo":"чо","ci":"цы","cong":"цун","cou":"цоу","cu":"цу","cuan":"цуань","cui":"цуй","cun":"цунь","cuo":"цо","da":"да","dai":"дай","dan":"дань","dang":"дан","dao":"дао","de":"дэ","dei":"дэй","den":"дэнь","deng":"дэн","di":"ди","dia":"дя","dian":"дянь","diao":"дяо","die":"де","ding":"дин","diu":"дю","dong":"дун","dou":"доу","du":"ду","duan":"дуань","dui":"дуй","dun":"дунь","duo":"до","e":"э","ei":"эй","en":"энь","er":"эр","fa":"фа","fan":"фань","fang":"фан","fei":"фэй","fen":"фэнь","feng":"фэн","fo":"фо","fou":"фоу","fu":"фу","ga":"га","gai":"гай","gan":"гань","gang":"ган","gao":"гао","ge":"гэ","gei":"гэй","gen":"гэнь","geng":"гэн","gong":"гун","gou":"гоу","gu":"гу","gua":"гуа","guai":"гуай","guan":"гуань","guang":"гуан","gui":"гуй","gun":"гунь","guo":"го","ha":"ха","hai":"хай","han":"хань","hang":"хан","hao":"хао","he":"хэ","hei":"хэй","hen":"хэнь","heng":"хэн","hong":"хун","hou":"хоу","hu":"ху","hua":"хуа","huai":"хуай","huan":"хуань","huang":"хуан","hui":"хуэй","hun":"хунь","huo":"хо","ji":"цзи","jia":"цзя","jian":"цзянь","jiang":"цзян","jiao":"цзяо","jie":"цзе","jin":"цзинь","jing":"цзин","jiong":"цзюн","jiu":"цзю","ju":"цзюй","juan":"цзюань","jue":"цзюэ","jun":"цзюнь","ka":"ка","kai":"кай","kan":"кань","kang":"кан","kao":"као","ke":"кэ","ken":"кэнь","keng":"кэн","kong":"кун","kou":"коу","ku":"ку","kua":"куа","kuai":"куай","kuan":"куань","kuang":"куан","kui":"куй","kun":"кунь","kuo":"ко","la":"ла","lai":"лай","lan":"лань","lang":"лан","lao":"лао","le":"лэ","lei":"лэй","leng":"лэн","li":"ли","lia":"ля","lian":"лянь","liang":"лян","liao":"ляо","lie":"ле","lin":"линь","ling":"лин","liu":"лю","long":"лун","lou":"лоу","lu":"лу","lü":"люй","luan":"луань","lüe":"люэ","lun":"лунь","luo":"ло","ma":"ма","mai":"май","man":"мань","mang":"ман","mao":"мао","me":"мэ","mei":"мэй","men":"мэнь","meng":"мэн","mi":"ми","mian":"мянь","miao":"мяо","mie":"ме","min":"минь","ming":"мин","miu":"мю","mo":"мо","mou":"моу","mu":"му","na":"на","nai":"най","nan":"нань","nang":"нан","nao":"нао","ne":"нэ","nei":"нэй","nen":"нэнь","neng":"нэн","ni":"ни","nian":"нянь","niang":"нян","niao":"няо","nie":"не","nin":"нинь","ning":"нин","niu":"ню","nong":"нун","nou":"ноу","nu":"ну","nü":"нюй","nuan":"нуань","nüe":"нюэ","nuo":"но","o":"о","ou":"оу","pa":"па","pai":"пай","pan":"пань","pang":"пан","pao":"пао","pei":"пэй","pen":"пэнь","peng":"пэн","pi":"пи","pian":"пянь","piao":"пяо","pie":"пе","pin":"пинь","ping":"пин","po":"по","pou":"поу","pu":"пу","qi":"ци","qia":"ця","qian":"цянь","qiang":"цян","qiao":"цяо","qie":"це","qin":"цинь","qing":"цин","qiong":"цюн","qiu":"цю","qu":"цюй","quan":"цюань","que":"цюэ","qun":"цюнь","ran":"жань","rang":"жан","rao":"жао","re":"жэ","ren":"жэнь","reng":"жэн","ri":"жи","rong":"жун","rou":"жоу","ru":"жу","rua":"жуа","ruan":"жуань","rui":"жуй","run":"жунь","ruo":"жо","sa":"са","sai":"сай","san":"сань","sang":"сан","sao":"сао","se":"сэ","sen":"сэнь","seng":"сэн","sha":"ша","shai":"шай","shan":"шань","shang":"шан","shao":"шао","she":"шэ","shei":"шэй","shen":"шэнь","sheng":"шэн","shi":"ши","shou":"шоу","shu":"шу","shua":"шуа","shuai":"шуай","shuan":"шуань","shuang":"шуан","shui":"шуй","shun":"шунь","shuo":"шо","si":"сы","song":"сун","sou":"соу","su":"су","suan":"суань","sui":"суй","sun":"сунь","suo":"со","ta":"та","tai":"тай","tan":"тань","tang":"тан","tao":"тао","te":"тэ","tei":"тэй","teng":"тэн","ti":"ти","tian":"тянь","tiao":"тяо","tie":"те","ting":"тин","tong":"тун","tou":"тоу","tu":"ту","tuan":"туань","tui":"туй","tun":"тунь","tuo":"то","wa":"ва","wai":"вай","wan":"вань","wang":"ван","wei":"вэй","wen":"вэнь","weng":"вэн","wo":"во","wu":"у","xi":"си","xia":"ся","xian":"сянь","xiang":"сян","xiao":"сяо","xie":"се","xin":"синь","xing":"син","xiong":"сюн","xiu":"сю","xu":"сюй","xuan":"сюань","xue":"сюэ","xun":"сюнь","ya":"я","yai":"яй","yan":"янь","yang":"ян","yao":"яо","ye":"е","yi":"и","yin":"инь","ying":"ин","yo":"ё","yong":"юн","you":"ю","yu":"юй","yuan":"юань","yue":"юэ","yun":"юнь","za":"цза","zai":"цзай","zan":"цзань","zang":"цзан","zao":"цзао","ze":"цзэ","zei":"цзэй","zen":"цзэнь","zeng":"цзэн","zha":"чжа","zhai":"чжай","zhan":"чжань","zhang":"чжан","zhao":"чжао","zhe":"чжэ","zhei":"чжэй","zhen":"чжэнь","zheng":"чжэн","zhi":"чжи","zhong":"чжун","zhou":"чжоу","zhu":"чжу","zhua":"чжуа","zhuai":"чжуай","zhuan":"чжуань","zhuang":"чжуан","zhui":"чжуй","zhun":"чжунь","zhuo":"чжо","zi":"цзы","zong":"цзун","zou":"цзоу","zu":"цзу","zuan":"цзуань","zui":"цзуй","zun":"цзунь","zuo":"цзо"};

// numbered pinyin syllable (e.g. "ren2") → Gwoyeu Romatzyh
const gwoyeuDict = {"a1":"a","a2":"ar","a3":"aa","a4":"ah","ai1":"ai","ai2":"air","ai3":"ae","ai4":"ay","an1":"an","an2":"arn","an3":"aan","an4":"ann","ang1":"ang","ang2":"arng","ang3":"aang","ang4":"anq","ao1":"au","ao2":"aur","ao3":"ao","ao4":"aw","ba1":"ba","ba2":"bar","ba3":"baa","ba4":"bah","bai1":"bai","bai2":"bair","bai3":"bae","bai4":"bay","ban1":"ban","ban2":"barn","ban3":"baan","ban4":"bann","bang1":"bang","bang2":"barng","bang3":"baang","bang4":"banq","bao1":"bau","bao2":"baur","bao3":"bao","bao4":"baw","bei1":"bei","bei2":"beir","bei3":"beei","bei4":"bey","ben1":"ben","ben2":"bern","ben3":"been","ben4":"benn","beng1":"beng","beng2":"berng","beng3":"beeng","beng4":"benq","bi1":"bi","bi2":"byi","bi3":"bii","bi4":"bih","bian1":"bian","bian2":"byan","bian3":"bean","bian4":"biann","biao1":"biau","biao2":"byau","biao3":"beau","biao4":"biaw","bie1":"bie","bie2":"bye","bie3":"biee","bie4":"bieh","bin1":"bin","bin2":"byn","bin3":"biin","bin4":"binn","bing1":"bing","bing2":"byng","bing3":"biing","bing4":"binq","bo1":"bo","bo2":"bor","bo3":"boo","bo4":"boh","bu1":"bu","bu2":"bwu","bu3":"buu","bu4":"buh","ca1":"tsa","ca2":"tsar","ca3":"tsaa","ca4":"tsah","cai1":"tsai","cai2":"tsair","cai3":"tsae","cai4":"tsay","can1":"tsan","can2":"tsarn","can3":"tsaan","can4":"tsann","cang1":"tsang","cang2":"tsarng","cang3":"tsaang","cang4":"tsanq","cao1":"tsau","cao2":"tsaur","cao3":"tsao","cao4":"tsaw","ce1":"tse","ce2":"tser","ce3":"tsee","ce4":"tseh","cen1":"tsen","cen2":"tsern","cen3":"tseen","cen4":"tsenn","ceng1":"tseng","ceng2":"tserng","ceng3":"tseeng","ceng4":"tsenq","cha1":"cha","cha2":"char","cha3":"chaa","cha4":"chah","chai1":"chai","chai2":"chair","chai3":"chae","chai4":"chay","chan1":"chan","chan2":"charn","chan3":"chaan","chan4":"chann","chang1":"chang","chang2":"charng","chang3":"chaang","chang4":"chanq","chao1":"chau","chao2":"chaur","chao3":"chao","chao4":"chaw","che1":"che","che2":"cher","che3":"chee","che4":"cheh","chen1":"chen","chen2":"chern","chen3":"cheen","chen4":"chenn","cheng1":"cheng","cheng2":"cherng","cheng3":"cheeng","cheng4":"chenq","chi1":"chy","chi2":"chyr","chi3":"chyy","chi4":"chyh","chong1":"chong","chong2":"chorng","chong3":"choong","chong4":"chonq","chou1":"chou","chou2":"chour","chou3":"choou","chou4":"chow","chu1":"chu","chu2":"chwu","chu3":"chuu","chu4":"chuh","chua1":"chua","chuai1":"chuai","chuai2":"chwai","chuai3":"choai","chuai4":"chuay","chuan1":"chuan","chuan2":"chwan","chuan3":"choan","chuan4":"chuann","chuang1":"chuang","chuang2":"chwang","chuang3":"choang","chuang4":"chuanq","chui1":"chuei","chui2":"chwei","chui3":"choei","chui4":"chuey","chun1":"chuen","chun2":"chwen","chun3":"choen","chun4":"chuenn","chuo1":"chuo","chuo2":"chwo","chuo4":"chuoh","ci1":"tsy","ci2":"tsyr","ci3":"tsyy","ci4":"tsyh","cong1":"tsong","cong2":"tsorng","cong3":"tsoong","cong4":"tsonq","cou1":"tsou","cou2":"tsour","cou3":"tsoou","cou4":"tsow","cu1":"tsu","cu2":"tswu","cu3":"tsuu","cu4":"tsuh","cuan1":"tsuan","cuan2":"tswan","cuan3":"tsoan","cuan4":"tsuann","cui1":"tsuei","cui2":"tswei","cui3":"tsoei","cui4":"tsuey","cun1":"tsuen","cun2":"tswen","cun3":"tsoen","cun4":"tsuenn","cuo1":"tsuo","cuo2":"tswo","cuo3":"tsuoo","cuo4":"tsuoh","da1":"da","da2":"dar","da3":"daa","da4":"dah","dai1":"dai","dai2":"dair","dai3":"dae","dai4":"day","dan1":"dan","dan2":"darn","dan3":"daan","dan4":"dann","dang1":"dang","dang2":"darng","dang3":"daang","dang4":"danq","dao1":"dau","dao2":"daur","dao3":"dao","dao4":"daw","de1":"de","de2":"der","de3":"dee","de4":"deh","dei1":"dei","dei2":"deir","dei3":"deei","dei4":"dey","deng1":"deng","deng2":"derng","deng3":"deeng","deng4":"denq","di1":"di","di2":"dyi","di3":"dii","di4":"dih","dia3":"dea","dian1":"dian","dian2":"dyan","dian3":"dean","dian4":"diann","diao1":"diau","diao2":"dyau","diao3":"deau","diao4":"diaw","die1":"die","die2":"dye","die3":"diee","die4":"dieh","ding1":"ding","ding2":"dyng","ding3":"diing","ding4":"dinq","diu1":"diou","dong1":"dong","dong2":"dorng","dong3":"doong","dong4":"donq","dou1":"dou","dou2":"dour","dou3":"doou","dou4":"dow","du1":"du","du2":"dwu","du3":"duu","du4":"duh","duan1":"duan","duan2":"dwan","duan3":"doan","duan4":"duann","dui1":"duei","dui2":"dwei","dui3":"doei","dui4":"duey","dun1":"duen","dun2":"dwen","dun3":"doen","dun4":"duenn","duo1":"duo","duo2":"dwo","duo3":"duoo","duo4":"duoh","e1":"e","e2":"er","e3":"ee","e4":"eh","ei1":"ei","ei2":"eir","ei3":"eei","ei4":"ey","en1":"en","en2":"ern","en3":"een","en4":"enn","er1":"el","er2":"erl","er3":"eel","er4":"ell","fa1":"fa","fa2":"far","fa3":"faa","fa4":"fah","fan1":"fan","fan2":"farn","fan3":"faan","fan4":"fann","fang1":"fang","fang2":"farng","fang3":"faang","fang4":"fanq","fei1":"fei","fei2":"feir","fei3":"feei","fei4":"fey","fen1":"fen","fen2":"fern","fen3":"feen","fen4":"fenn","feng1":"feng","feng2":"ferng","feng3":"feeng","feng4":"fenq","fo1":"fo","fo2":"for","fo3":"foo","fo4":"foh","fou1":"fou","fou2":"four","fou3":"foou","fou4":"fow","fu1":"fu","fu2":"fwu","fu3":"fuu","fu4":"fuh","ga1":"ga","ga2":"gar","ga3":"gaa","ga4":"gah","gai1":"gai","gai2":"gair","gai3":"gae","gai4":"gay","gan1":"gan","gan2":"garn","gan3":"gaan","gan4":"gann","gang1":"gang","gang2":"garng","gang3":"gaang","gang4":"ganq","gao1":"gau","gao2":"gaur","gao3":"gao","gao4":"gaw","ge1":"ge","ge2":"ger","ge3":"gee","ge4":"geh","gei1":"gei","gei3":"geei","gen1":"gen","gen2":"gern","gen3":"geen","gen4":"genn","geng1":"geng","geng2":"gerng","geng3":"geeng","geng4":"genq","gong1":"gong","gong2":"gorng","gong3":"goong","gong4":"gonq","gou1":"gou","gou2":"gour","gou3":"goou","gou4":"gow","gu1":"gu","gu2":"gwu","gu3":"guu","gu4":"guh","gua1":"gua","gua2":"gwa","gua3":"goa","gua4":"guah","guai1":"guai","guai2":"gwai","guai3":"goai","guai4":"guay","guan1":"guan","guan2":"gwan","guan3":"goan","guan4":"guann","guang1":"guang","guang2":"gwang","guang3":"goang","guang4":"guanq","gui1":"guei","gui2":"gwei","gui3":"goei","gui4":"guey","gun1":"guen","gun2":"gwen","gun3":"goen","gun4":"guenn","guo1":"guo","guo2":"gwo","guo3":"guoo","guo4":"guoh","ha1":"ha","ha2":"har","ha3":"haa","ha4":"hah","hai1":"hai","hai2":"hair","hai3":"hae","hai4":"hay","han1":"han","han2":"harn","han3":"haan","han4":"hann","hang1":"hang","hang2":"harng","hang3":"haang","hang4":"hanq","hao1":"hau","hao2":"haur","hao3":"hao","hao4":"haw","he1":"he","he2":"her","he3":"hee","he4":"heh","hei1":"hei","hen1":"hen","hen2":"hern","hen3":"heen","hen4":"henn","heng1":"heng","heng2":"herng","heng3":"heeng","heng4":"henq","hong1":"hong","hong2":"horng","hong3":"hoong","hong4":"honq","hou1":"hou","hou2":"hour","hou3":"hoou","hou4":"how","hu1":"hu","hu2":"hwu","hu3":"huu","hu4":"huh","hua1":"hua","hua2":"hwa","hua3":"hoa","hua4":"huah","huai1":"huai","huai2":"hwai","huai3":"hoai","huai4":"huay","huan1":"huan","huan2":"hwan","huan3":"hoan","huan4":"huann","huang1":"huang","huang2":"hwang","huang3":"hoang","huang4":"huanq","hui1":"huei","hui2":"hwei","hui3":"hoei","hui4":"huey","hun1":"huen","hun2":"hwen","hun3":"hoen","hun4":"huenn","huo1":"huo","huo2":"hwo","huo3":"huoo","huo4":"huoh","ji1":"ji","ji2":"jyi","ji3":"jii","ji4":"jih","jia1":"jia","jia2":"jya","jia3":"jea","jia4":"jiah","jian1":"jian","jian2":"jyan","jian3":"jean","jian4":"jiann","jiang1":"jiang","jiang2":"jyang","jiang3":"jeang","jiang4":"jianq","jiao1":"jiau","jiao2":"jyau","jiao3":"jeau","jiao4":"jiaw","jie1":"jie","jie2":"jye","jie3":"jiee","jie4":"jieh","jin1":"jin","jin2":"jyn","jin3":"jiin","jin4":"jinn","jing1":"jing","jing2":"jyng","jing3":"jiing","jing4":"jinq","jiong1":"jiong","jiong2":"jyong","jiong3":"jeong","jiong4":"jionq","jiu1":"jiou","jiu2":"jyou","jiu3":"jeou","jiu4":"jiow","ju1":"jiu","ju2":"jyu","ju3":"jeu","ju4":"jiuh","juan1":"juan","juan2":"jyuan","juan3":"jeuan","juan4":"jiuann","jue1":"jiue","jue2":"jyue","jue3":"jeue","jue4":"jiueh","jun1":"jiun","jun2":"jyun","jun3":"jeun","jun4":"jiunn","ka1":"ka","ka2":"kar","ka3":"kaa","ka4":"kah","kai1":"kai","kai2":"kair","kai3":"kae","kai4":"kay","kan1":"kan","kan2":"karn","kan3":"kaan","kan4":"kann","kang1":"kang","kang2":"karng","kang3":"kaang","kang4":"kanq","kao1":"kau","kao2":"kaur","kao3":"kao","kao4":"kaw","ke1":"ke","ke2":"ker","ke3":"kee","ke4":"keh","ken1":"ken","ken2":"kern","ken3":"keen","ken4":"kenn","keng1":"keng","keng2":"kerng","keng3":"keeng","keng4":"kenq","kong1":"kong","kong2":"korng","kong3":"koong","kong4":"konq","kou1":"kou","kou2":"kour","kou3":"koou","kou4":"kow","ku1":"ku","ku2":"kwu","ku3":"kuu","ku4":"kuh","kua1":"kua","kua2":"kwa","kua3":"koa","kua4":"kuah","kuai1":"kuai","kuai2":"kwai","kuai3":"koai","kuai4":"kuay","kuan1":"kuan","kuan2":"kwan","kuan3":"koan","kuan4":"kuann","kuang1":"kuang","kuang2":"kwang","kuang3":"koang","kuang4":"kuanq","kui1":"kuei","kui2":"kwei","kui3":"koei","kui4":"kuey","kun1":"kuen","kun2":"kwen","kun3":"koen","kun4":"kuenn","kuo1":"kuo","kuo2":"kwo","kuo3":"kuoo","kuo4":"kuoh","la1":"la","la2":"lar","la3":"laa","la4":"lah","lai1":"lai","lai2":"lai","lai3":"lae","lai4":"lay","lan1":"lan","lan2":"lan","lan3":"laan","lan4":"lann","lang1":"lang","lang2":"lang","lang3":"laang","lang4":"lanq","lao1":"lau","lao2":"lau","lao3":"lao","lao4":"law","le1":"le","le2":"le","le3":"lee","le4":"leh","lei1":"lei","lei2":"lei","lei3":"leei","lei4":"ley","leng1":"leng","leng2":"leng","leng3":"leeng","leng4":"lenq","li1":"li","li2":"li","li3":"lii","li4":"lih","lia3":"lea","lian1":"lian","lian2":"lian","lian3":"lean","lian4":"liann","liang1":"liang","liang2":"liang","liang3":"leang","liang4":"lianq","liao1":"liau","liao2":"liau","liao3":"leau","liao4":"liaw","lie1":"lie","lie2":"lie","lie3":"liee","lie4":"lieh","lin1":"lin","lin2":"lin","lin3":"liin","lin4":"linn","ling1":"ling","ling2":"ling","ling3":"liing","ling4":"linq","liu1":"liou","liu2":"liou","liu3":"leou","liu4":"liow","long1":"long","long2":"long","long3":"loong","long4":"lonq","lou1":"lou","lou2":"lou","lou3":"loou","lou4":"low","lu1":"lu","lu2":"lu","lu3":"luu","lu4":"luh","lü1":"liu","lü2":"liu","lü3":"leu","lü4":"liuh","luan1":"luan","luan2":"luan","luan3":"loan","luan4":"luann","lüe2":"lyue","lüe4":"liueh","lun1":"luen","lun2":"luen","lun3":"loen","lun4":"luenn","luo1":"luo","luo2":"luo","luo3":"luoo","luo4":"luoh","ma1":"ma","ma2":"ma","ma3":"maa","ma4":"mah","mai1":"mai","mai2":"mai","mai3":"mae","mai4":"may","man1":"man","man2":"man","man3":"maan","man4":"mann","mang1":"mang","mang2":"mang","mang3":"maang","mang4":"manq","mao1":"mau","mao2":"mau","mao3":"mao","mao4":"maw","me1":"me","mei2":"mei","mei3":"meei","mei4":"mey","men1":"men","men2":"men","men3":"meen","men4":"menn","meng1":"meng","meng2":"meng","meng3":"meeng","meng4":"menq","mi1":"mi","mi2":"mi","mi3":"mii","mi4":"mih","mian1":"mian","mian2":"mian","mian3":"mean","mian4":"miann","miao1":"miau","miao2":"miau","miao3":"meau","miao4":"miaw","mie1":"mie","mie2":"mie","mie4":"mieh","min1":"min","min2":"min","min3":"miin","min4":"minn","ming1":"ming","ming2":"ming","ming3":"miing","ming4":"minq","miu4":"miow","mo1":"mo","mo2":"mo","mo3":"moo","mo4":"moh","mou1":"mou","mou2":"mou","mou3":"moou","mou4":"mow","mu2":"mu","mu3":"muu","mu4":"muh","na1":"na","na2":"na","na3":"naa","na4":"nah","nai2":"nai","nai3":"nae","nai4":"nay","nan1":"nan","nan2":"nan","nan3":"naan","nan4":"nann","nang1":"nang","nang2":"nang","nang3":"naang","nang4":"nanq","nao1":"nau","nao2":"nau","nao3":"nao","nao4":"naw","ne4":"neh","nei3":"neei","nei4":"ney","nen4":"nenn","neng2":"neng","ni1":"ni","ni2":"ni","ni3":"nii","ni4":"nih","nian1":"nian","nian2":"nian","nian3":"nean","nian4":"niann","niang2":"niang","niang4":"nianq","niao3":"neau","niao4":"niaw","nie1":"nie","nie2":"nie","nie4":"nieh","nin2":"nin","ning2":"ning","ning3":"niing","ning4":"ninq","niu1":"niou","niu2":"niou","niu3":"neou","niu4":"niow","nong2":"nong","nong3":"noong","nong4":"nonq","nou2":"nou","nou4":"now","nu2":"nu","nu3":"nuu","nu4":"nuh","nü3":"neu","nü4":"niuh","nuan3":"noan","nüe4":"niueh","nuo2":"nuo","nuo3":"nuoo","nuo4":"nuoh","o1":"o","o2":"o","ou1":"ou","ou2":"ou","ou3":"oou","ou4":"ow","pa1":"pa","pa2":"par","pa3":"paa","pa4":"pah","pai1":"pai","pai2":"pair","pai3":"pae","pai4":"pay","pan1":"pan","pan2":"parn","pan3":"paan","pan4":"pann","pang1":"pang","pang2":"parng","pang3":"paang","pang4":"panq","pao1":"pau","pao2":"paur","pao3":"pao","pao4":"paw","pei1":"pei","pei2":"peir","pei3":"peei","pei4":"pey","pen1":"pen","pen2":"pern","pen3":"peen","pen4":"penn","peng1":"peng","peng2":"perng","peng3":"peeng","peng4":"penq","pi1":"pi","pi2":"pyi","pi3":"pii","pi4":"pih","pian1":"pian","pian2":"pyan","pian3":"pean","pian4":"piann","piao1":"piau","piao2":"pyau","piao3":"peau","piao4":"piaw","pie1":"pie","pie2":"pye","pie3":"piee","pie4":"pieh","pin1":"pin","pin2":"pyn","pin3":"piin","pin4":"pinn","ping1":"ping","ping2":"pyng","ping3":"piing","ping4":"pinq","po1":"po","po2":"por","po3":"poo","po4":"poh","pou1":"pou","pou2":"pour","pou3":"poou","pou4":"pow","pu1":"pu","pu2":"pwu","pu3":"puu","pu4":"puh","qi1":"chi","qi2":"chyi","qi3":"chii","qi4":"chih","qia1":"chia","qia2":"chya","qia3":"chea","qia4":"chiah","qian1":"chian","qian2":"chyan","qian3":"chean","qian4":"chiann","qiang1":"chiang","qiang2":"chyang","qiang3":"cheang","qiang4":"chianq","qiao1":"chiau","qiao2":"chyau","qiao3":"cheau","qiao4":"chiaw","qie1":"chie","qie2":"chye","qie3":"chiee","qie4":"chieh","qin1":"chin","qin2":"chyn","qin3":"chiin","qin4":"chinn","qing1":"ching","qing2":"chyng","qing3":"chiing","qing4":"chinq","qiong1":"chiong","qiong2":"chyong","qiong3":"cheong","qiong4":"chionq","qiu1":"chiou","qiu2":"chyou","qiu3":"cheou","qiu4":"chiow","qu1":"chiu","qu2":"chyu","qu3":"cheu","qu4":"chiuh","quan1":"chiuan","quan2":"chyuan","quan3":"cheuan","quan4":"chiuann","que1":"chiue","que2":"chyue","que3":"cheue","que4":"chiueh","qun1":"chiun","qun2":"chyun","qun3":"cheun","qun4":"chiunn","ran2":"ran","ran3":"raan","ran4":"rann","rang1":"rang","rang2":"rang","rang3":"raang","rang4":"ranq","rao2":"rau","rao3":"rao","rao4":"raw","re3":"ree","re4":"reh","ren2":"ren","ren3":"reen","ren4":"renn","reng1":"reng","reng2":"reng","reng4":"renq","ri4":"ryh","rong2":"rong","rong3":"roong","rong4":"ronq","rou2":"rou","rou3":"roou","rou4":"row","ru2":"ru","ru3":"ruu","ru4":"ruh","ruan2":"ruan","ruan3":"roan","ruan4":"ruann","rui2":"ruei","rui3":"roei","rui4":"ruey","run4":"ruenn","ruo4":"ruoh","sa1":"sa","sa2":"sar","sa3":"saa","sa4":"sah","sai1":"sai","sai2":"sair","sai3":"sae","sai4":"say","san1":"san","san2":"sarn","san3":"saan","san4":"sann","sang1":"sang","sang2":"sarng","sang3":"saang","sang4":"sanq","sao1":"sau","sao2":"saur","sao3":"sao","sao4":"saw","se4":"seh","sen1":"sen","seng1":"seng","sha1":"sha","sha2":"shar","sha3":"shaa","sha4":"shah","shai1":"shai","shai2":"shair","shai3":"shae","shai4":"shay","shan1":"shan","shan2":"sharn","shan3":"shaan","shan4":"shann","shang1":"shang","shang2":"sharng","shang3":"shaang","shang4":"shanq","shao1":"shau","shao2":"shaur","shao3":"shao","shao4":"shaw","she1":"she","she2":"sher","she3":"shee","she4":"sheh","shei2":"sheir","shen1":"shen","shen2":"shern","shen3":"sheen","shen4":"shenn","sheng1":"sheng","sheng2":"sherng","sheng3":"sheeng","sheng4":"shenq","shi1":"shy","shi2":"shyr","shi3":"shyy","shi4":"shyh","shou1":"shou","shou2":"shour","shou3":"shoou","shou4":"show","shu1":"shu","shu2":"shwu","shu3":"shuu","shu4":"shuh","shua1":"shua","shua3":"shoa","shuai1":"shuai","shuai2":"shwai","shuai3":"shoai","shuai4":"shuay","shuan1":"shuan","shuan4":"shuann","shuang1":"shuang","shuang3":"shoang","shui2":"shwei","shui3":"shoei","shui4":"shuey","shun3":"shoen","shun4":"shuenn","shuo1":"shuo","shuo4":"shuoh","si1":"sy","si2":"syr","si3":"syy","si4":"syh","song1":"song","song2":"sorng","song3":"soong","song4":"sonq","sou1":"sou","sou2":"sour","sou3":"soou","sou4":"sow","su1":"su","su2":"swu","su3":"suu","su4":"suh","suan1":"suan","suan3":"soan","suan4":"suann","sui1":"suei","sui2":"swei","sui3":"soei","sui4":"suey","sun1":"suen","sun3":"soen","suo1":"suo","suo2":"swo","suo3":"suoo","suo4":"suoh","ta1":"ta","ta2":"tar","ta3":"taa","ta4":"tah","tai1":"tai","tai2":"tair","tai3":"tae","tai4":"tay","tan1":"tan","tan2":"tarn","tan3":"taan","tan4":"tann","tang1":"tang","tang2":"tarng","tang3":"taang","tang4":"tanq","tao1":"tau","tao2":"taur","tao3":"tao","tao4":"taw","te4":"teh","teng2":"terng","ti1":"ti","ti2":"tyi","ti3":"tii","ti4":"tih","tian1":"tian","tian2":"tyan","tian3":"tean","tian4":"tiann","tiao1":"tiau","tiao2":"tyau","tiao3":"teau","tiao4":"tiaw","tie1":"tie","tie2":"tye","tie3":"tiee","tie4":"tieh","ting1":"ting","ting2":"tyng","ting3":"tiing","ting4":"tinq","tong1":"tong","tong2":"torng","tong3":"toong","tong4":"tonq","tou1":"tou","tou2":"tour","tou3":"toou","tou4":"tow","tu1":"tu","tu2":"twu","tu3":"tuu","tu4":"tuh","tuan1":"tuan","tuan2":"twan","tuan3":"toan","tuan4":"tuann","tui1":"tuei","tui2":"twei","tui3":"toei","tui4":"tuey","tun1":"tuen","tun2":"twen","tun3":"toen","tun4":"tuenn","tuo1":"tuo","tuo2":"twou","tuo3":"tuoo","tuo4":"tuoh","wa1":"ua","wa2":"wa","wa3":"oa","wa4":"wah","wai1":"uai","wai2":"wai","wai3":"oai","wai4":"way","wan1":"uan","wan2":"wan","wan3":"oan","wan4":"wann","wang1":"uang","wang2":"wang","wang3":"oang","wang4":"wanq","wei1":"uei","wei2":"wei","wei3":"oei","wei4":"wey","wen1":"uen","wen2":"wen","wen3":"oen","wen4":"wenn","weng1":"ueng","weng3":"oeng","weng4":"wenq","wo1":"uo","wo2":"wo","wo3":"woo","wo4":"woh","wu1":"u","wu2":"wu","wu3":"wuu","wu4":"wuh","xi1":"shi","xi2":"shyi","xi3":"shii","xi4":"shih","xia1":"shia","xia2":"shya","xia3":"shea","xia4":"shiah","xian1":"shian","xian2":"shyan","xian3":"shean","xian4":"shiann","xiang1":"shiang","xiang2":"shyang","xiang3":"sheang","xiang4":"shianq","xiao1":"shiau","xiao2":"shyau","xiao3":"sheau","xiao4":"shiaw","xie1":"shie","xie2":"shye","xie3":"shiee","xie4":"shieh","xin1":"shin","xin2":"shyn","xin3":"shiin","xin4":"shinn","xing1":"shing","xing2":"shyng","xing3":"shiing","xing4":"shinq","xiong1":"shiong","xiong2":"shyong","xiong3":"sheong","xiong4":"shionq","xiu1":"shiou","xiu2":"shyou","xiu3":"sheou","xiu4":"shiow","xu1":"shiu","xu2":"shyu","xu3":"sheu","xu4":"shiuh","xuan1":"shiuan","xuan2":"shyuan","xuan3":"sheuan","xuan4":"shiuann","xue1":"shiue","xue2":"shyue","xue3":"sheue","xue4":"shiueh","xun1":"shiun","xun2":"shyun","xun3":"sheun","xun4":"shiunn","ya1":"ia","ya2":"ya","ya3":"ea","ya4":"yah","yan1":"ian","yan2":"yan","yan3":"ean","yan4":"yann","yang1":"iang","yang2":"yang","yang3":"eang","yang4":"yanq","yao1":"iau","yao2":"yau","yao3":"eau","yao4":"yaw","ye1":"ie","ye2":"ye","ye3":"yee","ye4":"yeh","yi1":"i","yi2":"yi","yi3":"yii","yi4":"yih","yin1":"in","yin2":"yn","yin3":"yiin","yin4":"yinn","ying1":"ing","ying2":"yng","ying3":"yiing","ying4":"yinq","yong1":"iong","yong2":"yong","yong3":"yeong","yong4":"yonq","you1":"iou","you2":"you","you3":"yeou","you4":"yow","yu1":"iu","yu2":"yu","yu3":"yeu","yu4":"yuh","yuan1":"iuan","yuan2":"yuan","yuan3":"yeuan","yuan4":"yuann","yue1":"iue","yue2":"yue","yue3":"yeue","yue4":"yueh","yun1":"iun","yun2":"yun","yun3":"yeun","yun4":"yunn","za1":"tza","za2":"tzar","za3":"tzaa","za4":"tzah","zai1":"tzai","zai3":"tzae","zai4":"tzay","zan1":"tzan","zan2":"tzarn","zan3":"tzaan","zan4":"tzann","zang1":"tzang","zang3":"tzaang","zang4":"tzanq","zao1":"tzau","zao2":"tzaur","zao3":"tzao","zao4":"tzaw","ze2":"tzer","ze3":"tzee","ze4":"tzeh","zei2":"tzeir","zen3":"tzeen","zen4":"tzenn","zeng1":"tzeng","zeng4":"tzenq","zha1":"ja","zha2":"jar","zha3":"jaa","zha4":"jah","zhai1":"jai","zhai2":"jair","zhai3":"jae","zhai4":"jay","zhan1":"jan","zhan2":"jarn","zhan3":"jaan","zhan4":"jann","zhang1":"jang","zhang2":"jarng","zhang3":"jaang","zhang4":"janq","zhao1":"jau","zhao2":"jaur","zhao3":"jao","zhao4":"jaw","zhe2":"jer","zhe3":"jee","zhe4":"jeh","zhen1":"jen","zhen2":"jern","zhen3":"jeen","zhen4":"jenn","zheng1":"jeng","zheng2":"jerng","zheng3":"jeeng","zheng4":"jenq","zhi1":"jy","zhi2":"jyr","zhi3":"jyy","zhi4":"jyh","zhong1":"jong","zhong3":"joong","zhong4":"jonq","zhou1":"jou","zhou2":"jour","zhou3":"joou","zhou4":"jow","zhu1":"ju","zhu2":"jwu","zhu3":"juu","zhu4":"juh","zhua1":"jua","zhua3":"joa","zhuai1":"juai","zhuai3":"joai","zhuai4":"juay","zhuan1":"juan","zhuan2":"jwan","zhuan3":"joan","zhuan4":"juann","zhuang1":"juang","zhuang3":"joang","zhuang4":"juanq","zhui1":"juei","zhui4":"juey","zhun1":"juen","zhun3":"joen","zhuo1":"juo","zhuo2":"jwo","zi1":"tzy","zi2":"tzyr","zi3":"tzyy","zi4":"tzyh","zong1":"tzong","zong3":"tzoong","zong4":"tzonq","zou1":"tzou","zou3":"tzoou","zou4":"tzow","zu1":"tzu","zu2":"tzwu","zu3":"tzuu","zu4":"tzuh","zuan1":"tzuan","zuan3":"tzoan","zuan4":"tzuann","zui3":"tzoei","zui4":"tzuey","zun1":"tzuen","zuo1":"tzuo","zuo2":"tzwo","zuo3":"tzuoo","zuo4":"tzuoh"};

// --- Helpers ---

// Convert pinyin text input (numbered or marked) into an array of numbered
// syllables. Accepts space-separated syllables. Marked tones are converted
// to trailing numbers. Used by pin2cyr / pin2gwoyeu.
const toneMarkMap = {
  'ā':['a','1'], 'á':['a','2'], 'ǎ':['a','3'], 'à':['a','4'],
  'ē':['e','1'], 'é':['e','2'], 'ě':['e','3'], 'è':['e','4'],
  'ī':['i','1'], 'í':['i','2'], 'ǐ':['i','3'], 'ì':['i','4'],
  'ō':['o','1'], 'ó':['o','2'], 'ǒ':['o','3'], 'ò':['o','4'],
  'ū':['u','1'], 'ú':['u','2'], 'ǔ':['u','3'], 'ù':['u','4'],
  'ǖ':['ü','1'], 'ǘ':['ü','2'], 'ǚ':['ü','3'], 'ǜ':['ü','4'],
};

// Strip leading/trailing punctuation from a syllable. Returns
// {lead, core, trail} so we can re-attach the punctuation around the
// converted core.
function splitPunctuation(syl) {
  const m = syl.match(/^([^\p{L}\p{M}0-9ü]*)([\p{L}\p{M}0-9ü]*)([^\p{L}\p{M}0-9ü]*)$/u);
  return m ? { lead: m[1], core: m[2], trail: m[3] } : { lead: '', core: syl, trail: '' };
}

function pinyinSyllableToNumbered(core) {
  let tone = '';
  let out = '';
  for (const ch of core.normalize('NFC')) {
    if (toneMarkMap[ch]) {
      out += toneMarkMap[ch][0];
      tone = toneMarkMap[ch][1];
    } else {
      out += ch;
    }
  }
  // If user already had a trailing digit, respect it
  const last = out[out.length - 1];
  if (last && '12345'.includes(last)) return out.replace(/v/g, 'ü').toLowerCase();
  return (out + (tone || '5')).replace(/v/g, 'ü').toLowerCase();
}

// Apply a cyrillic tone diacritic to the cyrillic syllable: combining mark
// goes after the first vowel encountered. Tones 1-4 use macron, acute, caron,
// grave respectively; tone 5 (neutral) has no mark.
const cyrToneMarks = ['\u0304', '\u0301', '\u030c', '\u0300']; // 1 2 3 4
function applyCyrTone(cyrSyl, tone) {
  const vowels = 'аэыуояеёюи';
  let out = '';
  let added = false;
  for (const ch of cyrSyl) {
    out += ch;
    if (!added && vowels.includes(ch) && tone >= 1 && tone <= 4) {
      out += cyrToneMarks[tone - 1];
      added = true;
    }
  }
  return out;
}

// pinyin (numbered or marked) → cyrillization
function pin2cyr(text) {
  const syllables = text.split(/\s+/).filter(Boolean);
  const out = syllables.map(s => {
    const { lead, core, trail } = splitPunctuation(s);
    if (!core) return s;
    const numbered = pinyinSyllableToNumbered(core);
    const tone = numbered[numbered.length - 1];
    const stem = numbered.slice(0, -1);
    if (cyrDict[stem]) {
      return lead + applyCyrTone(cyrDict[stem], parseInt(tone, 10)) + trail;
    }
    return s;
  });
  return out.join(' ').normalize('NFC');
}

// pinyin (numbered or marked) → Gwoyeu Romatzyh
function pin2gwoyeu(text) {
  const syllables = text.split(/\s+/).filter(Boolean);
  return syllables.map(s => {
    const { lead, core, trail } = splitPunctuation(s);
    if (!core) return s;
    let numbered = pinyinSyllableToNumbered(core);
    // Gwoyeu treats neutral (5) the same as 1
    if (numbered.endsWith('5')) numbered = numbered.slice(0, -1) + '1';
    return lead + (gwoyeuDict[numbered] || core) + trail;
  }).join(' ');
}

// Hanzi → numbered pinyin (helper using the pinyin library)
async function hanziToNumberedPinyin(text) {
  const py = await loadPinyin();
  // Use TONE2 style: tone marks become trailing numbers (e.g. "ren2")
  const result = py(text, { style: 'tone2' });
  // result is Array<Array<string>>. Flatten by taking first option of each char.
  return result.map(arr => arr[0]).join(' ');
}

async function han2cyr(text) {
  const pinyin = await hanziToNumberedPinyin(text);
  return pin2cyr(pinyin);
}

async function han2gwoyeu(text) {
  const pinyin = await hanziToNumberedPinyin(text);
  return pin2gwoyeu(pinyin);
}

// Hanzi → Pinyin with tone marks (e.g. 你好 → nǐ hǎo)
async function han2pin(text) {
  const py = await loadPinyin();
  const result = py(text, { style: 'tone' });
  return result.map(arr => arr[0]).join(' ');
}

// =============================================================
// Unicode Confusables: swap each character with a visually similar
// confusable from the Unicode Security UTS#39 confusables data.
// =============================================================
async function confuse(text) {
  const inv = await loadConfusables();
  let out = '';
  for (const ch of text) {
    const opts = inv[ch];
    if (opts && opts.length) {
      out += opts[Math.floor(Math.random() * opts.length)];
    } else {
      out += ch;
    }
  }
  return out;
}

// =============================================================
// TOOL CONFIG
// -------------------------------------------------------------
// To remove a tool from the dropdown: comment out its line below
// (prefix with // ). Each entry is fully self-contained, so a
// single line is the only thing you need to touch.
// To re-add it: just uncomment the line.
// To change a tool's label or group: edit it in-place.
// To reorder tools: drag the line up or down.
//
// Sample text:
// 1. Each group has a default sample (groupSamples below).
// 2. A tool can override that with its own `sample` in its config object
//    when its input isn't plain UDHR text — e.g. tools that consume IPA,
//    Pinyin, Jyutping, or other intermediate formats expect input in
//    *that* format, not the original UDHR sentence.
// =============================================================

// Base UDHR Article 1 samples by language
const sampleTexts = {
  english: "All human beings are born free and equal in dignity and rights. They are endowed with reason and conscience and should act towards one another in a spirit of brotherhood.",
  cantonese: "人人生出嚟就係自由嘅，喺尊嚴同權利上一律平等。佢哋具有理性同良心，而且應該用兄弟間嘅關係嚟互相對待。",
  mandarin: "人人生而自由，在尊嚴和權利上一律平等。他們賦有理性和良心，並應以兄弟關係的精神互相對待。",
  tokipona: "jan ali li kama lon nasin ni: ona li ken tawa li ken pali. jan ali li kama lon sama. jan ali li jo e ken pi pilin suli. jan ali li ken pali e wile pona ona. jan ali li wile pali kepeken nasin ni: ona li jan pona tawa jan ante.",
};

// Derived samples — text in a non-plain format that some tools consume.
// These represent the English UDHR sample after going through an upstream
// conversion (e.g. English → IPA gives you the input for IPA → Pol).
// Replace these strings if you have better-quality versions.
const derivedSamples = {
  // QWERTY-position Greek (deterministically computed from the English sample
  // via engToGreek). Hardcoded so we don't need to recompute on every load.
  greekQwerty: "Αλλ ηθμαν βεινγσ αρε βορν φρεε ανδ ε;θαλ ιν διγνιτυ ανδ ριγητσ. Τηευ αρε ενδοςεδ ςιτη ρεασον ανδ ψονσψιενψε ανδ σηοθλδ αψτ τοςαρδσ ονε ανοτηερ ιν α σπιριτ οφ βροτηερηοοδ.",
  // Greek-letter spoofing of the English sample, where each Greek glyph
  // visually resembles its English counterpart. One possible result of
  // engToGreekLL on the English UDHR sample.
  greekLL: "Αλl hυmαη bειηφs αrε bοrη frεε αηδ εqυαl ιη διφηιtγ αηδ rιφhts. Τhεγ αrε εηδοwεδ wιth rεαsοη αηδ cοηscιεηcε αηδ shουlδ αct tοwαrδs οηε αηοthεr ιη α spιrιt οf brοthεrhοοδ.",
  // IPA pronunciation of the English UDHR sample (derived from the
  // CMU Pronouncing Dictionary; you can replace this with a hand-edited
  // version if you have one).
  englishIPA: "ɔl ˈhjumən ˈbiɪŋz ɑr bɔrn fri ənd ˈikwəl ɪn ˈdɪɡnəti ənd raɪts. ðeɪ ɑr ɛnˈdaʊd wɪð ˈrizən ənd ˈkɑnʃəns ənd ʃʊd ækt təˈwɔrdz wʌn əˈnʌðər ɪn ə ˈspɪrət ʌv ˈbrʌðərˌhʊd.",
  // Pinyin (numbered) for the Mandarin UDHR sample.
  mandarinPinyin: "ren2 ren2 sheng1 er2 zi4 you2, zai4 zun1 yan2 he2 quan2 li4 shang4 yi1 lü4 ping2 deng3. ta1 men5 fu4 you3 li3 xing4 he2 liang2 xin1, bing4 ying1 yi3 xiong1 di4 guan1 xi5 de5 jing1 shen2 hu4 xiang1 dui4 dai4.",
  // Jyutping for the Cantonese UDHR sample.
  cantoneseJyutping: "jan4 jan4 saang1 ceot1 lai4 zau6 hai6 zi6 jau4 ge3, hai2 zyun1 jim4 tung4 kyun4 lei6 soeng6 jat1 leot6 ping4 dang2. keoi5 dei6 geoi6 jau5 lei5 sing3 tung4 loeng4 sam1, ji4 ce2 jing1 goi1 jung6 hing1 dai6 gaan1 ge3 gwaan1 hai6 lai4 wu6 soeng1 deoi3 doi6.",
  // Toki Pona ASCII (deterministically computed via syl2asc on the toki
  // pona sample). Decoded by asc2syl back to the toki pona text.
  tokiPonaAscii: "j al l KM R aC i: on l g Tw l g bl. j al l KM R cM. j al l J e g P PI zl. j al l g bl e Wr pn on. j al l Wr bl GBg aC i: on l j pn Tw j aaE.",
};

// Default sample per group (used when a tool doesn't specify its own)
const groupSamples = {
  'Text style':          sampleTexts.english,
  'Visual substitution': sampleTexts.english,
  'Phonetic':            sampleTexts.english,
  'Cantonese':           sampleTexts.cantonese,
  'Mandarin':            sampleTexts.mandarin,
  'Spoofing':            sampleTexts.english,
  'Toki Pona':           sampleTexts.tokipona,
  'Singapore':           '',
};

const toolList = [
  // group               id              label                                   options
  ['Text style',         'mock',         'Mocking Text (aLtErNaTiNg)',           { desc: "Alternates lower/upper case — classic SpongeBob mocking style.", live: true, fn: mock }],
  //['Text style',         'chia',         'Mr Chia Okya',                         { desc: "Sprinkles '-tsa', 'ok', and 'ya' through your sentences. Re-run for variations.", live: false, fn: mrchia }],
  ['Text style',         'fill',         'Fill in the Blanks',                   { desc: "Replaces letters in longer words with underscores.", live: false, fn: (s) => fill(s, document.getElementById('fill-level')?.value || 'h'), hasLevel: true }],
  ['Text style',         'emoji',        'Emoji Alphabet',                       { desc: "Converts letters and digits to emoji.", live: false, fn: emojify }],

  ['Visual substitution','greek-en2gr',  'English → Greek (QWERTY position)',    { desc: "Maps English letters to Greek letters by QWERTY keyboard position.", live: true, fn: engToGreek }],
  ['Visual substitution','greek-gr2en',  'Greek → English (QWERTY position)',    { desc: "Maps Greek letters back to English by QWERTY position.", live: true, fn: greekToEng, sample: derivedSamples.greekQwerty }],
  ['Visual substitution','eng2greekll',  'English → Greek Lookalike',            { desc: "Replaces English letters with visually-similar Greek letters. Multiple Greek letters can look like one English letter, so output varies — press Enter to re-roll.", live: false, fn: engToGreekLL }],
  ['Visual substitution','greekll',      'Greek Lookalike → English',            { desc: "Maps Greek letters to visually-similar English letters.", live: true, fn: greekLL, sample: derivedSamples.greekLL }],

  ['Phonetic',           'eng2ipa',      'English → IPA',                        { desc: "Converts English to IPA pronunciation using the CMU Pronouncing Dictionary. Unknown words shown as *word*.", live: false, fn: eng2ipa, async: true }],
  ['Phonetic',           'eng2pol',      'English → Poliespellinglish',          { desc: "Converts English to Poliespellinglish via IPA.", live: false, fn: eng2pol, async: true }],
  ['Phonetic',           'eng2long',     'English → Long Spelling',              { desc: "Converts English to absurdly long spelling via IPA.", live: false, fn: eng2long, async: true }],
  ['Phonetic',           'ipa2pol',      'IPA → Poliespellinglish',              { desc: "Converts IPA pronunciation directly to Poliespellinglish.", live: true, fn: ipa2pol, sample: derivedSamples.englishIPA }],
  ['Phonetic',           'ipa2long',     'IPA → Long Spelling',                  { desc: "Converts IPA pronunciation directly to long spelling.", live: true, fn: ipa2long, sample: derivedSamples.englishIPA }],

  ['Cantonese',          'can2jyu',      'Hanzi → Jyutping',                     { desc: "Converts Chinese characters to Jyutping (Cantonese romanization).", live: false, fn: can2jyu, async: true }],
  ['Cantonese',          'can2ipa',      'Hanzi → IPA',                          { desc: "Converts Chinese characters to Cantonese IPA pronunciation.", live: false, fn: can2ipa, async: true }],
  ['Cantonese',          'jyu2ipa',      'Jyutping → IPA',                       { desc: "Converts Jyutping (space-separated syllables) to IPA.", live: false, fn: jyu2ipa, async: true, sample: derivedSamples.cantoneseJyutping }],

  ['Mandarin',           'han2pin',      'Hanzi → Pinyin',                       { desc: "Converts Chinese characters to Pinyin with tone marks (e.g. 你好 → nǐ hǎo).", live: false, fn: han2pin, async: true }],
  ['Mandarin',           'han2cyr',      'Hanzi → Cyrillization',                { desc: "Converts Chinese characters to Russian (Palladius) cyrillization with tone marks.", live: false, fn: han2cyr, async: true }],
  ['Mandarin',           'han2gwoyeu',   'Hanzi → Gwoyeu Romatzyh',              { desc: "Converts Chinese characters to Gwoyeu Romatzyh, the tonal-spelling romanization.", live: false, fn: han2gwoyeu, async: true }],
  ['Mandarin',           'pin2cyr',      'Pinyin → Cyrillization',               { desc: "Converts numbered or marked Pinyin (space-separated) to Russian cyrillization. e.g. 'ren2 min2' or 'rén mín'.", live: false, fn: pin2cyr, sample: derivedSamples.mandarinPinyin }],
  ['Mandarin',           'pin2gwoyeu',   'Pinyin → Gwoyeu Romatzyh',             { desc: "Converts numbered or marked Pinyin (space-separated) to Gwoyeu Romatzyh.", live: false, fn: pin2gwoyeu, sample: derivedSamples.mandarinPinyin }],

  ['Spoofing',           'confuse',      'Unicode Confusables',                  { desc: "Replaces each character with a visually similar Unicode lookalike (homoglyph). Loads the official UTS#39 confusables data on first use.", live: false, fn: confuse, async: true }],

  ['Toki Pona',          'tokisyl2asc',  'Syllables → ASCII',                    { desc: "Encodes Toki Pona syllables as single ASCII characters.", live: true, fn: syl2asc }],
  ['Toki Pona',          'tokiasc2syl',  'ASCII → Syllables',                    { desc: "Decodes ASCII characters back into Toki Pona syllables.", live: true, fn: asc2syl, sample: derivedSamples.tokiPonaAscii }],

  ['Singapore',          'nric',         'NRIC Checker',                         { desc: "Validates Singapore NRIC numbers. Format: \\w\\d{7}\\w. Use _ for unknowns.", live: false, fn: checkAllNric }],
  ['Singapore',          'car',          'Car Plate Checker',                    { desc: "Validates Singapore car license plates. Format: \\w{1,3} \\d{1,4} \\w. Use _ for unknowns.", live: false, fn: checkCarPlate }],
];

// Build lookups: id → config, and id → sample text.
// A tool's own `sample` overrides its group default.
const tools = {};
const toolSamples = {};
for (const [group, id, , config] of toolList) {
  tools[id] = config;
  toolSamples[id] = config.sample !== undefined ? config.sample : (groupSamples[group] ?? '');
}

// =============================================================
// UI
// =============================================================
const inputEl = document.getElementById('input');
const outputEl = document.getElementById('output');
const toolEl = document.getElementById('tool');
const descEl = document.getElementById('description');
const optionsEl = document.getElementById('options');
const noticeEl = document.getElementById('notice');
const countEl = document.getElementById('count');
const enterBtn = document.getElementById('enter-btn');

// Populate dropdown from toolList, grouping into <optgroup>s by the first column
(function buildDropdown() {
  let currentGroup = null;
  let groupEl = null;
  for (const [group, id, label] of toolList) {
    if (group !== currentGroup) {
      groupEl = document.createElement('optgroup');
      groupEl.label = group;
      toolEl.appendChild(groupEl);
      currentGroup = group;
    }
    const opt = document.createElement('option');
    opt.value = id;
    opt.textContent = label;
    groupEl.appendChild(opt);
  }
})();

let runToken = 0;

async function runTool() {
  const tool = toolEl.value;
  const t = tools[tool];
  const src = inputEl.value;
  const myToken = ++runToken;

  if (!src) {
    outputEl.textContent = '';
    outputEl.classList.remove('loading');
    return;
  }

  if (t.async) {
    outputEl.classList.add('loading');
    outputEl.textContent = '';
  }

  try {
    const result = t.async ? await t.fn(src) : t.fn(src);
    if (myToken !== runToken) return;
    outputEl.classList.remove('loading');
    outputEl.textContent = result;
  } catch (err) {
    if (myToken !== runToken) return;
    outputEl.classList.remove('loading');
    outputEl.textContent = 'Error: ' + err.message;
  }
}

// The most recent sample text we filled into the input on behalf of the user.
// If the input still matches this when the user switches tools, we replace
// it with the new tool's sample. If it differs, the user has typed something
// custom and we don't overwrite.
let lastSample = '';

function fillSampleIfUntouched() {
  const tool = toolEl.value;
  const sample = toolSamples[tool] ?? '';
  // Only replace if the box is empty or still contains the previous sample
  if (inputEl.value === '' || inputEl.value === lastSample) {
    inputEl.value = sample;
    lastSample = sample;
    countEl.textContent = sample.length;
  }
}

function updateToolUI() {
  const tool = toolEl.value;
  const t = tools[tool];
  descEl.textContent = t.desc;

  optionsEl.innerHTML = '';
  if (t.hasLevel) {
    optionsEl.innerHTML = `
      <label for="fill-level">Difficulty:</label>
      <select id="fill-level">
        <option value="e">Easy</option>
        <option value="m">Medium</option>
        <option value="h" selected>Hard</option>
        <option value="a">All words</option>
        <option value="r">Random</option>
      </select>
    `;
    document.getElementById('fill-level').addEventListener('change', runTool);
  }

  if (tool === 'nric' || tool === 'car') {
    noticeEl.textContent = "Use _ to indicate unknown characters.";
    noticeEl.classList.add('show');
  } else if (tool === 'eng2ipa' || tool === 'eng2pol' || tool === 'eng2long') {
    noticeEl.textContent = "First use loads the CMU Pronouncing Dictionary (~3MB) from a CDN. Subsequent conversions are instant.";
    noticeEl.classList.add('show');
  } else if (tool === 'can2jyu' || tool === 'can2ipa' || tool === 'jyu2ipa') {
    noticeEl.textContent = "First use loads a Chinese→Jyutping dictionary (~1MB) from a CDN.";
    noticeEl.classList.add('show');
  } else if (tool === 'han2pin' || tool === 'han2cyr' || tool === 'han2gwoyeu') {
    noticeEl.textContent = "First use loads a Hanzi→Pinyin library from a CDN.";
    noticeEl.classList.add('show');
  } else if (tool === 'confuse') {
    noticeEl.textContent = "First use loads the Unicode confusables data (~250KB) from a CDN. Output is non-deterministic — press Enter again to re-roll.";
    noticeEl.classList.add('show');
  } else if (tool === 'pin2cyr' || tool === 'pin2gwoyeu') {
    noticeEl.textContent = "Enter space-separated Pinyin. Tones may be numbered (ren2) or marked (rén).";
    noticeEl.classList.add('show');
  } else {
    noticeEl.classList.remove('show');
  }

  fillSampleIfUntouched();
  runTool();
}

toolEl.addEventListener('change', updateToolUI);
inputEl.addEventListener('input', () => {
  countEl.textContent = inputEl.value.length;
  // Once the user types, stop auto-replacing on tool switch
  if (inputEl.value !== lastSample) lastSample = '\u0000'; // sentinel: won't match anything
  const t = tools[toolEl.value];
  if (t.live) runTool();
});
document.getElementById('clear-btn').addEventListener('click', () => {
  inputEl.value = '';
  outputEl.textContent = '';
  countEl.textContent = '0';
  lastSample = '';  // allow the next tool switch to insert its sample again
  inputEl.focus();
});
document.getElementById('copy-btn').addEventListener('click', async (e) => {
  const btn = e.currentTarget;
  const original = btn.textContent;
  try {
    await navigator.clipboard.writeText(outputEl.textContent);
    btn.textContent = 'Copied';
  } catch { btn.textContent = 'Failed'; }
  setTimeout(() => btn.textContent = original, 1200);
});
document.getElementById('swap-btn').addEventListener('click', () => {
  inputEl.value = outputEl.textContent;
  countEl.textContent = inputEl.value.length;
  lastSample = '\u0000'; // user has effectively typed something custom now
  runTool();
});

enterBtn.addEventListener('click', runTool);

// Ctrl/Cmd+Enter as a keyboard shortcut for the Enter button
inputEl.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
    e.preventDefault();
    runTool();
  }
});

// Pick a random tool as the default selection
toolEl.value = toolList[Math.floor(Math.random() * toolList.length)][1];

updateToolUI();
