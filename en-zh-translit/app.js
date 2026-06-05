// =============================================================
// English → IPA (CMU dictionary)
// =============================================================
let cmudict = null;
async function loadCmudict() {
  if (cmudict) return cmudict;
  const mod = await import('https://esm.sh/cmu-pronouncing-dictionary@3.0.0');
  cmudict = mod.dictionary;
  return cmudict;
}

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
// Transcription table
// =============================================================
const COLS = ["-", "b", "p", "d", "t", "ɡ", "k", "v", "w", "f",
              "z", "ts", "s", "ʒ", "ʃ", "dʒ", "tʃ", "h",
              "m", "n", "l", "r", "j", "ɡʷ", "kʷ", "hʷ"];

const TABLE_RAW = {
  "-":  ["",   "布", "普", "德", "特", "格", "克", "夫", "夫", "夫",
         "兹", "茨", "斯", "日", "什", "奇", "奇", "赫",
         "姆", "恩", "尔", "尔", "伊", "古", "库", "胡"],
  "ɑ":  ["阿", "巴", "帕", "达", "塔", "加", "卡", "瓦", "瓦", "法",
         "扎", "察", "萨", "扎", "沙", "贾", "查", "哈",
         "马", "纳", "拉", "拉", "亚", "瓜", "夸", "华"],
  "ɛ":  ["埃", "贝", "佩", "德", "特", "盖", "凯", "韦", "韦", "费",
         "泽", "策", "塞", "热", "谢", "杰", "切", "赫",
         "梅", "内", "莱", "雷", "耶", "圭", "奎", "惠"],
  "ə":  ["厄", "伯", "珀", "德", "特", "格", "克", "弗", "沃", "弗",
         "泽", "策", "瑟", "热", "舍", "哲", "彻", "赫",
         "默", "纳", "勒", "勒", "耶", "果", "阔", "霍"],
  "i":  ["伊", "比", "皮", "迪", "蒂", "吉", "基", "维", "威", "菲",
         "齐", "齐", "西", "日", "希", "吉", "奇", "希",
         "米", "尼", "利", "里", "伊", "圭", "奎", "惠"],
  "ɔ":  ["奥", "博", "波", "多", "托", "戈", "科", "沃", "沃", "福",
         "佐", "措", "索", "若", "肖", "乔", "乔", "霍",
         "莫", "诺", "洛", "罗", "约", "果", "阔", "霍"],
  "u":  ["乌", "布", "普", "杜", "图", "古", "库", "武", "伍", "富",
         "祖", "楚", "苏", "茹", "舒", "朱", "楚", "胡",
         "穆", "努", "卢", "鲁", "尤", "",   "库", ""],
  "ju": ["尤", "比尤","皮尤","迪尤","蒂尤","久", "丘", "维尤","威尤","菲尤",
         "久", "丘", "休", "",   "休", "久", "丘", "休",
         "缪", "纽", "柳", "留", "",   "",   "",   ""],
  "aɪ": ["艾", "拜", "派", "代", "泰", "盖", "凯", "韦", "怀", "法",
         "宰", "蔡", "赛", "",   "夏", "贾", "柴", "海",
         "迈", "奈", "莱", "赖", "耶", "瓜伊","夸", "怀"],
  "aʊ": ["奥", "鲍", "保", "道", "陶", "高", "考", "沃", "沃", "福",
         "藻", "曹", "绍", "",   "绍", "焦", "乔", "豪",
         "毛", "瑙", "劳", "劳", "尧", "",   "阔", ""],
  "æn": ["安", "班", "潘", "丹", "坦", "甘", "坎", "万", "万", "凡",
         "赞", "灿", "桑", "",   "尚", "詹", "钱", "汉",
         "曼", "南", "兰", "兰", "扬", "关", "宽", "环"],
  "ɑn": ["昂", "邦", "庞", "当", "唐", "冈", "康", "旺", "旺", "方",
         "藏", "仓", "桑", "让", "尚", "章", "昌", "杭",
         "芒", "南", "朗", "朗", "扬", "光", "匡", "黄"],
  "ɛn": ["恩", "本", "彭", "登", "滕", "根", "肯", "文", "文", "芬",
         "曾", "岑", "森", "任", "申", "真", "琴", "亨",
         "门", "嫩", "伦", "伦", "延", "古恩","昆", ""],
  "ɪn": ["因", "宾", "平", "丁", "廷", "金", "金", "温", "温", "芬",
         "津", "欣", "辛", "",   "欣", "金", "钦", "欣",
         "明", "宁", "林", "林", "因", "古因","昆", ""],
  "ɪŋ": ["英", "宾", "平", "丁", "廷", "京", "金", "温", "温", "芬",
         "京", "青", "辛", "",   "兴", "京", "青", "兴",
         "明", "宁", "林", "林", "英", "古英","",   ""],
  "un": ["温", "本", "蓬", "敦", "通", "贡", "昆", "文", "文", "丰",
         "尊", "聪", "孙", "",   "顺", "准", "春", "洪",
         "蒙", "农", "伦", "伦", "云", "",   "",   ""],
  "ʊŋ": ["翁", "邦", "蓬", "东", "通", "贡", "孔", "翁", "翁", "丰",
         "宗", "聪", "松", "容", "雄", "琼", "琼", "洪",
         "蒙", "农", "隆", "龙", "永", "",   "",   "洪"]
};

const TABLE = new Map();
for (const [row, entries] of Object.entries(TABLE_RAW)) {
  for (let i = 0; i < COLS.length; i++) {
    if (entries[i]) TABLE.set(row + "|" + COLS[i], entries[i]);
  }
}

const FEMALE_ALT = new Map(Object.entries({
  "ɑ|v":"娃","ɑ|w":"娃","ɑ|f":"娃",
  "ɑ|s":"莎","ɑ|ʃ":"莎",
  "ɑ|m":"玛","ɑ|n":"娜","ɑ|j":"娅",
  "ɛ|r":"蕾",
  "ə|n":"娜",
  "i|n":"妮","i|l":"莉","i|r":"丽",
  "ɔ|r":"萝",
  "aɪ|d":"黛",
  "ɪn|l":"琳","ɪn|r":"琳",
  "ɪŋ|l":"琳","ɪŋ|r":"琳",
  "-|s":"丝"
}));

const WORD_INITIAL_FU = new Map(Object.entries({
  "ə|v":"弗","ə|f":"弗","ə|w":"弗"
}));

// =============================================================
// IPA normalization
// =============================================================
function normalize_ipa(ipa) {
  // Strip stress and length
  for (const ch of ["ˈ", "ˌ", "ː", "ˑ"]) ipa = ipa.split(ch).join("");
  ipa = ipa.split("g").join("ɡ");
  ipa = ipa.split("ɝ").join("ər").split("ɚ").join("ər");
  ipa = ipa.split("n̩").join("ən").split("l̩").join("əl").split("m̩").join("əm");

  // Protect diphthongs from the upcoming ɪ→i and ʊ→u substitutions
  // Note: do NOT protect ɔɪ — let ɪ→i fire so it tokenizes as ɔ + i (two syllables, e.g. Boy → 博伊).
  ipa = ipa.split("eɪ").join("\uE0B0")
           .split("aɪ").join("\uE0B1")
           .split("aʊ").join("\uE0B3")
           .split("oʊ").join("\uE0B4")
           .split("əʊ").join("\uE0B5");

  // Protect labialized consonants
  ipa = ipa.split("kw").join("\uE0A1")
           .split("ɡw").join("\uE0A2")
           .split("hw").join("\uE0A3");

  // Single-vowel collapses
  ipa = ipa.split("æ").join("ɑ").split("ʌ").join("ɑ")
           .split("ɪ").join("i").split("ʊ").join("u")
           .split("ɒ").join("ɔ").split("ɜ").join("ə");

  // Ligature consonants
  ipa = ipa.split("ʤ").join("dʒ").split("ʧ").join("tʃ");

  // Restore
  ipa = ipa.split("\uE0A1").join("kʷ").split("\uE0A2").join("ɡʷ").split("\uE0A3").join("hʷ");
  ipa = ipa.split("\uE0B0").join("eɪ")
           .split("\uE0B1").join("aɪ")
           .split("\uE0B3").join("aʊ")
           .split("\uE0B4").join("oʊ")
           .split("\uE0B5").join("əʊ");

  return ipa;
}

// =============================================================
// Tokenizer
// =============================================================
const MULTI = ["dʒ", "tʃ", "ts", "dz", "ɡʷ", "kʷ", "hʷ",
               "eɪ", "aɪ", "aʊ", "oʊ", "əʊ", "ju", "jʊ"];

const SIMPLE_C = new Set(["b","p","d","t","ɡ","k","v","w","f","z","s","ʃ","ʒ","h","m","n","l","r","j","ð","θ"]);
const SIMPLE_V = new Set(["ɑ","ɛ","ə","i","ɔ","u"]);
const DIPHTHONGS = new Set(["eɪ", "aɪ", "aʊ", "oʊ", "əʊ", "ju", "jʊ"]);
const NASALS = new Set(["n", "ŋ"]);
const COMPLEX_C = new Set(["dʒ", "tʃ", "ts", "ɡʷ", "kʷ", "hʷ"]);

function tokenize(ipa) {
  const tokens = [];
  let i = 0;
  const n = ipa.length;
  while (i < n) {
    let matched = false;
    for (const m of MULTI) {
      if (ipa.startsWith(m, i)) {
        tokens.push(m);
        i += m.length;
        matched = true;
        break;
      }
    }
    if (!matched) {
      tokens.push(ipa[i]);
      i += 1;
    }
  }
  // Column merges
  const out = [];
  for (const t of tokens) {
    if (t === "dz") out.push("z");
    else if (t === "ð" || t === "θ") out.push("s");
    else out.push(t);
  }
  return out;
}

function isConsonant(tok) {
  return SIMPLE_C.has(tok) || COMPLEX_C.has(tok);
}
function isVowel(tok) {
  return SIMPLE_V.has(tok) || DIPHTHONGS.has(tok);
}

// =============================================================
// Vowel + coda → row
// =============================================================
function vowelRow(vowel, coda) {
  if (vowel === "oʊ" || vowel === "əʊ") vowel = "ɔ";
  else if (vowel === "eɪ") vowel = "ɛ";
  else if (vowel === "jʊ") vowel = "ju";

  if (coda === "n") {
    const m = {"ɑ":"æn","ɛ":"ɛn","ə":"ɛn","i":"ɪn","ɔ":"ɑn","u":"un","aʊ":"ɑn"};
    return m[vowel] || vowel;
  }
  if (coda === "ŋ") {
    const m = {"ɑ":"ɑn","ɛ":"ɛn","ə":"ɛn","i":"ɪŋ","ɔ":"ɑn","u":"ʊŋ","aʊ":"ɑn"};
    return m[vowel] || vowel;
  }
  return vowel;
}

// =============================================================
// Syllabifier
// =============================================================
function syllabify(tokens) {
  const sylls = [];
  let i = 0;
  const n = tokens.length;
  while (i < n) {
    const t = tokens[i];
    if (isConsonant(t)) {
      // tr/dr split
      if ((t === "t" || t === "d") && i + 1 < n && tokens[i + 1] === "r") {
        sylls.push({ onset: t, vowel: "", coda: "" });
        i += 1;
        continue;
      }
      const onset = t;
      i += 1;
      if (i < n && isVowel(tokens[i])) {
        const vowel = tokens[i]; i += 1;
        let coda = "";
        if (i < n && NASALS.has(tokens[i])) {
          // ŋ can NEVER be onset of a following syllable in English
          // n becomes coda only when followed by a consonant or word-end
          if (tokens[i] === "ŋ") {
            coda = tokens[i]; i += 1;
          } else if (i + 1 >= n || isConsonant(tokens[i + 1])) {
            coda = tokens[i]; i += 1;
          }
        }
        sylls.push({ onset, vowel, coda });
      } else {
        sylls.push({ onset, vowel: "", coda: "" });
      }
    } else if (isVowel(t)) {
      const vowel = t; i += 1;
      let coda = "";
      if (i < n && NASALS.has(tokens[i])) {
        if (tokens[i] === "ŋ") {
          coda = tokens[i]; i += 1;
        } else if (i + 1 >= n || isConsonant(tokens[i + 1])) {
          coda = tokens[i]; i += 1;
        }
      }
      sylls.push({ onset: "", vowel, coda });
    } else {
      // Unknown token — skip silently rather than emit as literal
      i += 1;
    }
  }
  return sylls;
}

// =============================================================
// Spelling hints & m-before-bp rule
// =============================================================
function getSpellingHints(word) {
  const w = word.toLowerCase();
  return {
    is_initial_a_schwa: w.startsWith("a"),
    is_initial_ai_ay:   w.startsWith("ai") || w.startsWith("ay"),
    is_ia_final:        w.endsWith("ia"),
    is_final_r_schwa:   w.endsWith("r") || w.endsWith("re")
  };
}

function fixMBeforeBP(word, tokens) {
  const w = word.toLowerCase();
  if (!w.includes("mb") && !w.includes("mp")) return tokens;
  // Silent b at end of word (lamb, comb, climb, thumb, tomb)
  if (/mb\b/.test(w)) return tokens;
  return tokens.map((t, i) =>
    (t === "m" && i + 1 < tokens.length && (tokens[i + 1] === "b" || tokens[i + 1] === "p"))
      ? "n" : t
  );
}

// =============================================================
// Syllable lookup
// =============================================================
function lookupSyllable(syll, { wordInitial = false, wordFinal = false, hints = null, female = false } = {}) {
  let { onset, vowel, coda } = syll;

  // Final 'r'/'re' with [ə] → 尔
  if (wordFinal && hints && hints.is_final_r_schwa) {
    if ((onset === "r" && (vowel === "ə" || vowel === "")) ||
        (vowel === "ə" && coda === "" && onset === "")) {
      return "尔";
    }
  }

  let row;
  if (vowel === "") {
    row = "-";
  } else {
    if (wordInitial && hints && hints.is_initial_a_schwa && vowel === "ə") {
      vowel = "ɑ";
    }
    if (wordInitial && hints && hints.is_initial_ai_ay) {
      vowel = "aɪ";
    }
    row = vowelRow(vowel, coda);
  }

  const col = onset ? onset : "-";

  // Final 'ia' → 亚
  if (wordFinal && hints && hints.is_ia_final && onset === "" && (row === "ɑ" || row === "ə")) {
    return "亚";
  }

  // Female alternates
  if (female && FEMALE_ALT.has(row + "|" + col)) {
    return FEMALE_ALT.get(row + "|" + col);
  }

  // Word-initial 弗
  if (wordInitial && WORD_INITIAL_FU.has(row + "|" + col)) {
    return WORD_INITIAL_FU.get(row + "|" + col);
  }

  // Standard lookup
  if (TABLE.has(row + "|" + col)) return TABLE.get(row + "|" + col);

  // Fallback 1: drop coda
  const baseRow = vowel ? vowelRow(vowel, "") : "-";
  if (TABLE.has(baseRow + "|" + col)) {
    let result = TABLE.get(baseRow + "|" + col);
    if (coda === "n" || coda === "ŋ") result += "恩";
    return result;
  }
  // Fallback 2: vowel only
  if (TABLE.has(baseRow + "|-")) return TABLE.get(baseRow + "|-");
  // Fallback 3: schwa row
  if (TABLE.has("ə|" + col)) return TABLE.get("ə|" + col);
  // Fallback 4: bare consonant
  if (TABLE.has("-|" + col)) return TABLE.get("-|" + col);
  return "";
}

// =============================================================
// Punctuation map
// =============================================================
const PUNCT_MAP = { ",":"，", ".":"。", "!":"！", "?":"？",
                    ";":"；", ":":"：", "'":"", '"':"" };

function mapPunct(s) {
  let out = "";
  for (const c of s) out += (PUNCT_MAP[c] !== undefined ? PUNCT_MAP[c] : c);
  return out;
}

// =============================================================
// Word & sentence transliteration
// =============================================================
const cache = new Map();
function transliterateCore(core, female) {
  const key = core + "\x00" + (female ? "1" : "0");
  if (cache.has(key)) return cache.get(key);

  // Build IPA for this single word using the synchronous part:
  // we'll have the IPA already produced upstream; here `core` is the *English* word
  // and we need its IPA. Done via the closure below.
  throw new Error("transliterateCore should not be called directly");
}

async function transliterateWord(englishWord, ipaForWord, female) {
  // Strip the *...* unknown-word markers
  let ipa = ipaForWord.replace(/\*/g, "").trim();
  if (!ipa) ipa = englishWord.toLowerCase(); // crude fallback

  const ipaNorm = normalize_ipa(ipa);
  let tokens = tokenize(ipaNorm);
  tokens = fixMBeforeBP(englishWord, tokens);
  // Drop unrecognized tokens
  tokens = tokens.filter(t => isConsonant(t) || isVowel(t) || NASALS.has(t));

  const sylls = syllabify(tokens);
  const hints = getSpellingHints(englishWord);

  const pieces = [];
  for (let idx = 0; idx < sylls.length; idx++) {
    pieces.push(lookupSyllable(sylls[idx], {
      wordInitial: idx === 0,
      wordFinal:   idx === sylls.length - 1,
      hints,
      female
    }));
  }
  return pieces.join("");
}

async function transliterate(text, female) {
  // Tokenize the input into words / non-word runs (matching the Python regex)
  const parts = text.match(/[A-Za-z']+|[^\sA-Za-z']+|\s+/g) || [];

  // Pre-build IPA for each English word using eng2ipa
  // To avoid loading cmudict per word, do a bulk pass:
  await loadCmudict();
  const dict = cmudict;

  const out = [];
  for (const p of parts) {
    if (/^\s+$/.test(p)) {
      out.push(" ");
    } else if (/[A-Za-z']/.test(p) && /^[A-Za-z']+$/.test(p)) {
      // English word: build IPA
      const arpa = dict[p.toLowerCase()];
      const ipa = arpa ? arpaWordToIpa(arpa) : ("*" + p + "*");
      if (ipa.startsWith("*")) {
        out.push(ipa); // unknown word, keep as *word*
      } else {
        out.push(await transliterateWord(p, ipa, female));
      }
    } else {
      out.push(mapPunct(p));
    }
  }
  return out.join("");
}

// Also produce the full IPA string for the "Show IPA" panel
async function buildIpa(text) {
  return await eng2ipa(text);
}

// =============================================================
// UI
// =============================================================
const $input  = document.getElementById("input");
const $output = document.getElementById("output");
const $status = document.getElementById("status");
const $female = document.getElementById("female");
const $ipa    = document.getElementById("ipa-line");

let pending = null;
async function update() {
  const text = $input.value;
  if (!text.trim()) {
    $output.textContent = "Output will appear here.";
    $output.classList.add("empty");
    $ipa.textContent = "—";
    return;
  }
  const myToken = Symbol();
  pending = myToken;
  try {
    const [zh, ipa] = await Promise.all([
      transliterate(text, $female.checked),
      buildIpa(text)
    ]);
    if (pending !== myToken) return; // superseded
    $output.textContent = zh;
    $output.classList.remove("empty");
    $ipa.textContent = ipa;
  } catch (err) {
    $output.textContent = "Error: " + err.message;
    $output.classList.remove("empty");
  }
}

$input.addEventListener("input", update);
$female.addEventListener("change", update);

(async () => {
  try {
    await loadCmudict();
    $status.textContent = "Ready.";
    setTimeout(() => { $status.textContent = ""; }, 1500);
    if ($input.value) update();
  } catch (e) {
    $status.textContent = "Failed to load dictionary.";
  }
})();
