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

// =============================================================
// G2P fallback (spelling → IPA) for words not in the CMU dictionary
// Crude but better than emitting a literal asterisked word.
// =============================================================
function g2p(word) {
  let s = word.toLowerCase();

  // Magic-e detection: V-C-e at end (V = single vowel, C = single consonant, not preceded by another vowel)
  // Examples: make, ride, note, cute, Pete
  let magicE = false;
  if (s.length >= 3 && s.endsWith('e')) {
    const c = s[s.length - 2];
    const v = s[s.length - 3];
    if (/[aeiou]/.test(v) && /[^aeiou]/.test(c) && c !== 'r') {
      // Avoid "...re" → keep as is (e.g. 'are', 'were'); the trailing-r-schwa rule handles it.
      magicE = true;
      s = s.slice(0, -1);
    }
  }

  // Silent word-initial digraphs
  s = s.replace(/^kn/, 'n').replace(/^gn/, 'n').replace(/^wr/, 'r').replace(/^ps/, 's');

  // Process letter-by-letter with digraph lookahead.
  const digraphs = [
    ['tch', 'tʃ'],
    ['dge', 'dʒ'],
    ['ch',  'tʃ'],
    ['sh',  'ʃ'],
    ['th',  'θ'],
    ['ph',  'f'],
    ['gh',  ''],
    ['ng',  'ŋ'],
    ['ck',  'k'],
    ['qu',  'kw'],
    ['wh',  'w'],
    // Vowel digraphs — produce diphthongs / long vowels directly
    // so they don't get split into stray syllables later
    ['ai',  'aɪ'],
    ['ay',  'eɪ'],   // "day", "say"
    ['au',  'ɔ'],    // "Paul", "haul"
    ['aw',  'ɔ'],    // "law", "saw"
    ['ee',  'i'],
    ['ea',  'i'],    // mostly i ("read", "team"); sometimes ɛ — accept i as default
    ['ei',  'eɪ'],
    ['ey',  'eɪ'],
    ['ie',  'i'],
    ['oa',  'oʊ'],
    ['oe',  'oʊ'],
    ['oi',  'ɔɪ'],
    ['oy',  'ɔɪ'],
    ['oo',  'u'],
    ['ou',  'aʊ'],
    ['ow',  'aʊ'],
    ['ue',  'u'],
    ['ui',  'u']
  ];

  const shortVowel = { a: 'æ', e: 'ɛ', i: 'ɪ', o: 'ɔ', u: 'ʌ' };
  const longVowel  = { a: 'eɪ', e: 'i', i: 'aɪ', o: 'oʊ', u: 'ju' };

  let out = '';
  let i = 0;
  const n = s.length;
  while (i < n) {
    // Digraph
    let matched = false;
    for (const [pat, rep] of digraphs) {
      if (s.startsWith(pat, i)) {
        out += rep;
        i += pat.length;
        matched = true;
        break;
      }
    }
    if (matched) continue;

    const c = s[i];
    const next = s[i + 1] || '';

    // Collapse doubled consonants (e.g. "Anna" → ana)
    if (c === s[i - 1] && /[bcdfghjklmnpqrstvwxz]/.test(c)) { i++; continue; }

    if (c === 'c') {
      out += /[eiy]/.test(next) ? 's' : 'k';
    } else if (c === 'g') {
      // g→dʒ before e/i/y? Unreliable (get, gift). Default ɡ.
      out += 'ɡ';
    } else if (c === 'x') {
      out += 'ks';
    } else if (c === 'j') {
      out += 'dʒ';
    } else if (c === 'y') {
      if (i === 0) out += 'j';
      else if (i === n - 1) out += 'i';
      else if (/[aeiou]/.test(next)) out += 'j';
      else out += 'ɪ';
    } else if ('aeiou'.includes(c)) {
      // Magic e: this is the vowel right before the trailing consonant we just dropped 'e' from
      const isMagic = magicE && i === n - 2;
      // Word-final 'e' that wasn't magic-e: often silent (e.g. "the", "be" handled by dict, but "...le")
      const map = isMagic ? longVowel : shortVowel;
      out += map[c];
    } else if (c === "'") {
      // Skip apostrophe
    } else if (/[a-z]/.test(c)) {
      out += c;
    }
    // else skip
    i++;
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
    return g2p(tok);
  }).join('');
}

// =============================================================
// Transcription table
// =============================================================
const COLS = ["-", "b", "p", "d", "t", "ɡ", "k", "v", "w", "f",
              "z", "ts", "s", "ʒ", "ʃ", "dʒ", "tʃ", "h",
              "m", "n", "l", "r", "j", "ɡʷ", "kʷ", "hʷ"];

// Display labels matching the Wikipedia table
const COL_LABELS = ["–", "b", "p", "d", "t", "ɡ", "k", "v", "w", "f",
                    "z, dz", "ts", "s, ð, θ", "ʒ", "ʃ", "dʒ", "tʃ", "h",
                    "m", "n", "l", "r", "j", "ɡʷ", "kʷ", "hʷ"];

const ROW_KEYS = ["-", "ɑ", "ɛ", "ə", "i", "ɔ", "u", "ju",
                  "aɪ", "aʊ",
                  "æn", "ɑn", "ɛn", "ɪn", "ɪŋ", "un", "ʊŋ"];

const ROW_LABELS = {
  "-":  "–",
  "ɑ":  "ɑː, æ, ʌ",
  "ɛ":  "ɛ, eɪ",
  "ə":  "ɜ, ə",
  "i":  "iː, ɪ",
  "ɔ":  "ɒ, ɔː, oʊ",
  "u":  "uː, ʊ",
  "ju": "juː, jʊ",
  "aɪ": "aɪ",
  "aʊ": "aʊ",
  "æn": "æn, ʌn, æŋ",
  "ɑn": "ɑn, aʊn, ʌŋ, ɔn, ɒn, ɒŋ",
  "ɛn": "ɛn, ɛŋ, ɜn, ən, əŋ",
  "ɪn": "ɪn, in, ɪən, jən",
  "ɪŋ": "ɪŋ",
  "un": "un, ʊn, oʊn",
  "ʊŋ": "ʊŋ"
};

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

// Word-initial substitution: 夫 → 弗 at the beginning of a word.
// This belongs to row "-" (the bare-consonant row, where 夫 is the main
// character at v/w/f), NOT row ə — 弗 in row ə is just the standard main
// character there and needs no substitution.
const WORD_INITIAL_FU = new Map(Object.entries({
  "-|v":"弗","-|w":"弗","-|f":"弗"
}));

// =============================================================
// Pinyin map — every single character used in the table.
// Hardcoded from the Wikipedia table to avoid wrong readings
// for chars with multiple pronunciations (e.g. 什 → shí in this context).
// =============================================================
const PINYIN = new Map(Object.entries({
  // "-" row
  "布":"bù","普":"pǔ","德":"dé","特":"tè","格":"gé","克":"kè",
  "夫":"fū","弗":"fú","兹":"zī","茨":"cí","斯":"sī","丝":"sī",
  "日":"rì","什":"shí","奇":"qí","赫":"hè","姆":"mǔ","恩":"ēn",
  "尔":"ěr","伊":"yī","古":"gǔ","库":"kù","胡":"hú",
  // ɑ row
  "阿":"ā","巴":"bā","帕":"pà","达":"dá","塔":"tǎ","加":"jiā","卡":"kǎ",
  "瓦":"wǎ","娃":"wá","法":"fǎ","扎":"zhā","察":"chá","萨":"sà",
  "莎":"shā","沙":"shā","贾":"jiǎ","查":"chá","哈":"hā",
  "马":"mǎ","玛":"mǎ","纳":"nà","娜":"nà","拉":"lā",
  "亚":"yà","娅":"yà","瓜":"guā","夸":"kuā","华":"huá",
  // ɛ row
  "埃":"āi","贝":"bèi","佩":"pèi","泰":"tài","盖":"gài","凯":"kǎi",
  "韦":"wéi","费":"fèi","泽":"zé","策":"cè","塞":"sài","热":"rè",
  "谢":"xiè","杰":"jié","切":"qiè","黑":"hēi","梅":"méi","内":"nèi",
  "莱":"lái","雷":"léi","蕾":"lěi","耶":"yē","圭":"guī","奎":"kuí","惠":"huì",
  // ə row
  "厄":"è","伯":"bó","珀":"pò","沃":"wò","瑟":"sè","舍":"shè",
  "哲":"zhé","彻":"chè","默":"mò","勒":"lè","果":"guǒ","阔":"kuò","霍":"huò",
  // i row
  "比":"bǐ","皮":"pí","迪":"dí","蒂":"dì","吉":"jí","基":"jī",
  "维":"wéi","威":"wēi","菲":"fēi","齐":"qí","西":"xī","希":"xī",
  "米":"mǐ","尼":"ní","妮":"nī","利":"lì","莉":"lì","里":"lǐ","丽":"lì",
  // ɔ row
  "奥":"ào","博":"bó","波":"bō","多":"duō","托":"tuō","戈":"gē","科":"kē",
  "福":"fú","佐":"zuǒ","措":"cuò","索":"suǒ","若":"ruò","肖":"xiāo",
  "乔":"qiáo","莫":"mò","诺":"nuò","洛":"luò","罗":"luó","萝":"luó","约":"yuē",
  // u row
  "乌":"wū","杜":"dù","图":"tú","武":"wǔ","伍":"wǔ","富":"fù",
  "祖":"zǔ","楚":"chǔ","苏":"sū","茹":"rú","舒":"shū","朱":"zhū",
  "穆":"mù","努":"nǔ","卢":"lú","鲁":"lǔ","尤":"yóu",
  // ju row
  "久":"jiǔ","丘":"qiū","休":"xiū","缪":"miù","纽":"niǔ","柳":"liǔ","留":"liú",
  // aɪ row
  "艾":"ài","拜":"bài","派":"pài","代":"dài","黛":"dài","宰":"zǎi","蔡":"cài",
  "赛":"sài","夏":"xià","柴":"chái","海":"hǎi","迈":"mài","奈":"nài","赖":"lài","怀":"huái",
  // aʊ row
  "鲍":"bào","保":"bǎo","道":"dào","陶":"táo","高":"gāo","考":"kǎo",
  "藻":"zǎo","曹":"cáo","绍":"shào","焦":"jiāo","豪":"háo","毛":"máo",
  "瑙":"nǎo","劳":"láo","尧":"yáo",
  // æn row
  "安":"ān","班":"bān","潘":"pān","丹":"dān","坦":"tǎn","甘":"gān","坎":"kǎn",
  "万":"wàn","凡":"fán","赞":"zàn","灿":"càn","桑":"sāng","尚":"shàng",
  "詹":"zhān","钱":"qián","汉":"hàn","曼":"màn","南":"nán","兰":"lán",
  "扬":"yáng","关":"guān","宽":"kuān","环":"huán",
  // ɑn row
  "昂":"áng","邦":"bāng","庞":"páng","当":"dāng","唐":"táng","冈":"gāng","康":"kāng",
  "旺":"wàng","方":"fāng","藏":"zàng","仓":"cāng","让":"ràng","章":"zhāng",
  "昌":"chāng","杭":"háng","芒":"máng","朗":"lǎng","光":"guāng","匡":"kuāng","黄":"huáng",
  // ɛn row
  "本":"běn","彭":"péng","登":"dēng","滕":"téng","根":"gēn","肯":"kěn","文":"wén",
  "芬":"fēn","曾":"zēng","岑":"cén","森":"sēn","任":"rèn","申":"shēn","真":"zhēn",
  "琴":"qín","亨":"hēng","门":"mén","嫩":"nèn","伦":"lún","延":"yán","昆":"kūn",
  // ɪn row
  "因":"yīn","宾":"bīn","平":"píng","丁":"dīng","廷":"tíng","金":"jīn",
  "温":"wēn","津":"jīn","欣":"xīn","辛":"xīn","钦":"qīn",
  "明":"míng","宁":"níng","林":"lín","琳":"lín",
  // ɪŋ row
  "英":"yīng","京":"jīng","青":"qīng","兴":"xìng",
  // un row
  "敦":"dūn","通":"tōng","贡":"gòng","丰":"fēng","尊":"zūn","聪":"cōng",
  "孙":"sūn","顺":"shùn","准":"zhǔn","春":"chūn","洪":"hóng","蒙":"méng","农":"nóng","云":"yún","蓬":"péng",
  // ʊŋ row
  "翁":"wēng","东":"dōng","孔":"kǒng","宗":"zōng","松":"sōng","容":"róng",
  "雄":"xióng","琼":"qióng","隆":"lóng","龙":"lóng","永":"yǒng"
}));

// =============================================================
// IPA normalization
// =============================================================
function normalize_ipa(ipa) {
  for (const ch of ["ˈ", "ˌ", "ː", "ˑ"]) ipa = ipa.split(ch).join("");
  ipa = ipa.split("g").join("ɡ");
  ipa = ipa.split("ɝ").join("ər").split("ɚ").join("ər");
  ipa = ipa.split("n̩").join("ən").split("l̩").join("əl").split("m̩").join("əm");

  // Protect diphthongs from upcoming ɪ→i and ʊ→u substitutions.
  // Note: ɔɪ is intentionally NOT protected — letting it become ɔi → two syllables (Boy → 博伊).
  ipa = ipa.split("eɪ").join("\uE0B0")
           .split("aɪ").join("\uE0B1")
           .split("aʊ").join("\uE0B3")
           .split("oʊ").join("\uE0B4")
           .split("əʊ").join("\uE0B5");

  ipa = ipa.split("kw").join("\uE0A1")
           .split("ɡw").join("\uE0A2")
           .split("hw").join("\uE0A3");

  ipa = ipa.split("æ").join("ɑ").split("ʌ").join("ɑ")
           .split("ɪ").join("i").split("ʊ").join("u")
           .split("ɒ").join("ɔ").split("ɜ").join("ə");

  ipa = ipa.split("ʤ").join("dʒ").split("ʧ").join("tʃ");

  ipa = ipa.split("\uE0A1").join("kʷ").split("\uE0A2").join("ɡʷ").split("\uE0A3").join("hʷ");
  ipa = ipa.split("\uE0B0").join("eɪ")
           .split("\uE0B1").join("aɪ")
           .split("\uE0B3").join("aʊ")
           .split("\uE0B4").join("oʊ")
           .split("\uE0B5").join("əʊ");

  return ipa;
}

// =============================================================
// Tokenizer / syllabifier
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
  const out = [];
  for (const t of tokens) {
    if (t === "dz") out.push("z");
    else if (t === "ð" || t === "θ") out.push("s");
    else out.push(t);
  }
  return out;
}

function isConsonant(tok) { return SIMPLE_C.has(tok) || COMPLEX_C.has(tok); }
function isVowel(tok)     { return SIMPLE_V.has(tok) || DIPHTHONGS.has(tok); }

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

function syllabify(tokens) {
  const sylls = [];
  let i = 0;
  const n = tokens.length;
  while (i < n) {
    const t = tokens[i];
    if (isConsonant(t)) {
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
          if (tokens[i] === "ŋ") { coda = tokens[i]; i += 1; }
          else if (i + 1 >= n || isConsonant(tokens[i + 1])) { coda = tokens[i]; i += 1; }
        }
        sylls.push({ onset, vowel, coda });
      } else {
        sylls.push({ onset, vowel: "", coda: "" });
      }
    } else if (isVowel(t)) {
      const vowel = t; i += 1;
      let coda = "";
      if (i < n && NASALS.has(tokens[i])) {
        if (tokens[i] === "ŋ") { coda = tokens[i]; i += 1; }
        else if (i + 1 >= n || isConsonant(tokens[i + 1])) { coda = tokens[i]; i += 1; }
      }
      sylls.push({ onset: "", vowel, coda });
    } else {
      i += 1;
    }
  }
  return sylls;
}

// =============================================================
// Hints + m-before-bp
// =============================================================
function getSpellingHints(word) {
  const w = word.toLowerCase();
  const first = w[0];
  return {
    initial_vowel_letter: 'aeiou'.includes(first) ? first : null,
    is_initial_a_schwa: first === 'a',           // kept for word-initial 'a' fallback
    is_initial_ai_ay:   w.startsWith("ai") || w.startsWith("ay"),
    is_ia_final:        w.endsWith("ia"),
    is_final_r_schwa:   w.endsWith("r") || w.endsWith("re")
  };
}

function fixMBeforeBP(word, tokens) {
  const w = word.toLowerCase();
  if (!w.includes("mb") && !w.includes("mp")) return tokens;
  if (/mb\b/.test(w)) return tokens;
  return tokens.map((t, i) =>
    (t === "m" && i + 1 < tokens.length && (tokens[i + 1] === "b" || tokens[i + 1] === "p"))
      ? "n" : t
  );
}

// Unstressed-vowel rule: "When vowels ⟨a⟩, ⟨e⟩, ⟨i⟩, ⟨o⟩, ⟨u⟩ are in an
// unstressed syllable, generally transcribe them according to their written
// forms" — meaning a schwa (ə) whose corresponding spelling letter is
// a/e/i/o/u should be mapped to ɑ/ɛ/i/ɔ/u respectively (not the ə row).
// We align in-order: ith vowel syllable ↔ ith vowel letter. Only applied
// when counts match, since misalignment would do more harm than good.
const LETTER_TO_VOWEL = { a: 'ɑ', e: 'ɛ', i: 'i', o: 'ɔ', u: 'u' };
function applyUnstressedVowelRule(sylls, word) {
  // 'y' is counted as a vowel letter for alignment purposes only — it never
  // triggers a replacement. (Words like "happy" → letters [a, y], 2 syllables.)
  const letters = [];
  for (const c of word.toLowerCase()) {
    if ('aeiouy'.includes(c)) letters.push(c);
  }
  const vowelSylls = sylls.filter(s => s.vowel);
  if (letters.length !== vowelSylls.length) return; // unreliable, skip
  for (let i = 0; i < vowelSylls.length; i++) {
    const s = vowelSylls[i];
    const letter = letters[i];
    if (s.vowel === 'ə' && LETTER_TO_VOWEL[letter]) {
      s.vowel = LETTER_TO_VOWEL[letter];
    }
  }
}

// =============================================================
// Syllable lookup
// =============================================================
function lookupSyllable(syll, { wordInitial = false, wordFinal = false, hints = null, female = false } = {}) {
  let { onset, vowel, coda } = syll;

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
    // Word-initial vowel schwa: use the spelling letter's row
    // (handles cases where the unstressed-vowel rule didn't align cleanly)
    if (wordInitial && vowel === "ə" && hints && hints.initial_vowel_letter
        && LETTER_TO_VOWEL[hints.initial_vowel_letter]) {
      vowel = LETTER_TO_VOWEL[hints.initial_vowel_letter];
    }
    if (wordInitial && hints && hints.is_initial_ai_ay) vowel = "aɪ";
    row = vowelRow(vowel, coda);
  }

  const col = onset ? onset : "-";

  if (wordFinal && hints && hints.is_ia_final && onset === "" && (row === "ɑ" || row === "ə")) {
    return "亚";
  }

  if (female && FEMALE_ALT.has(row + "|" + col)) return FEMALE_ALT.get(row + "|" + col);
  if (wordInitial && WORD_INITIAL_FU.has(row + "|" + col)) return WORD_INITIAL_FU.get(row + "|" + col);
  if (TABLE.has(row + "|" + col)) return TABLE.get(row + "|" + col);

  const baseRow = vowel ? vowelRow(vowel, "") : "-";
  if (TABLE.has(baseRow + "|" + col)) {
    let result = TABLE.get(baseRow + "|" + col);
    if (coda === "n" || coda === "ŋ") result += "恩";
    return result;
  }
  if (TABLE.has(baseRow + "|-")) return TABLE.get(baseRow + "|-");
  if (TABLE.has("ə|" + col)) return TABLE.get("ə|" + col);
  if (TABLE.has("-|" + col)) return TABLE.get("-|" + col);
  return "";
}

// =============================================================
// Punctuation map — quotes and apostrophes now pass through
// (they were previously deleted)
// =============================================================
const PUNCT_MAP = {
  ",":"，", ".":"。", "!":"！", "?":"？", ";":"；", ":":"："
};
function mapPunct(s) {
  let out = "";
  for (const c of s) out += (PUNCT_MAP[c] !== undefined ? PUNCT_MAP[c] : c);
  return out;
}

// =============================================================
// Word transliteration
// =============================================================
function transliterateWordSync(englishWord, ipaForWord, female) {
  let ipa = ipaForWord.replace(/\*/g, "").trim();
  if (!ipa) ipa = englishWord.toLowerCase();

  const ipaNorm = normalize_ipa(ipa);
  let tokens = tokenize(ipaNorm);
  tokens = fixMBeforeBP(englishWord, tokens);
  tokens = tokens.filter(t => isConsonant(t) || isVowel(t) || NASALS.has(t));

  const sylls = syllabify(tokens);
  const hints = getSpellingHints(englishWord);
  applyUnstressedVowelRule(sylls, englishWord);

  const pieces = [];
  for (let i = 0; i < sylls.length; i++) {
    pieces.push(lookupSyllable(sylls[i], {
      wordInitial: i === 0,
      wordFinal:   i === sylls.length - 1,
      hints,
      female
    }));
  }
  return pieces.join("");
}

// =============================================================
// Sync transliteration (assumes cmudict is already loaded — used by the
// easter egg, where everything must happen synchronously)
// =============================================================
function transliterateTextSync(text, female) {
  if (!cmudict) return text;
  const parts = text.match(/[A-Za-z']+|[^\sA-Za-z']+|\s+/g) || [];
  return parts.map(p => {
    if (/^\s+$/.test(p)) return p;
    if (/^[A-Za-z']+$/.test(p) && /[A-Za-z]/.test(p)) {
      const arpa = cmudict[p.toLowerCase()];
      const ipa = arpa ? arpaWordToIpa(arpa) : g2p(p);
      return transliterateWordSync(p, ipa, female);
    }
    return mapPunct(p);
  }).join('');
}

// =============================================================
// Tagged segments — each word carries its English source, Chinese, IPA,
// and a stable word index used for cross-panel hover linking.
// =============================================================
async function transliterateTagged(text, female) {
  await loadCmudict();
  const dict = cmudict;
  const parts = text.match(/[A-Za-z']+|[^\sA-Za-z']+|\s+/g) || [];

  const segments = []; // { type, text, en?, zh?, ipa?, source?, widx? }
  let widx = 0;
  let charIdx = 0; // running offset into the original text — used for input overlay click handling
  for (const p of parts) {
    if (/^\s+$/.test(p)) {
      segments.push({ type: 'space', text: p, startIdx: charIdx });
    } else if (/^[A-Za-z']+$/.test(p) && /[A-Za-z]/.test(p)) {
      const arpa = dict[p.toLowerCase()];
      let ipa, source;
      if (arpa) { ipa = arpaWordToIpa(arpa); source = 'dict'; }
      else      { ipa = g2p(p); source = 'g2p'; }
      const zh = transliterateWordSync(p, ipa, female);
      segments.push({
        type: 'word', en: p, zh, ipa, source,
        widx: widx++, startIdx: charIdx, endIdx: charIdx + p.length
      });
    } else {
      segments.push({ type: 'punct', text: p, zhText: mapPunct(p), startIdx: charIdx });
    }
    charIdx += p.length;
  }
  return segments;
}

// =============================================================
// HTML rendering
// =============================================================
function escapeHtml(s) {
  return s.replace(/[&<>"']/g, c => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  }[c]));
}

// Compute the full pinyin string for a sequence of hanzi
function pinyinOf(text) {
  const parts = [];
  for (const ch of text) {
    if (PINYIN.has(ch)) parts.push(PINYIN.get(ch));
  }
  return parts.join(' ');
}

// Render hanzi with ruby+rt. CSS controls whether rt is visible based on a
// .with-pinyin parent. The `titleMode` controls what tooltip each ruby gets:
//   'each'  — each ruby gets its own character pinyin
//   'none'  — no title on rubies (use when parent span owns the tooltip)
//   string  — shared title applied to every ruby
function renderHanzi(text, titleMode = 'each') {
  let out = '';
  for (const ch of text) {
    if (PINYIN.has(ch)) {
      const p = PINYIN.get(ch);
      let title = null;
      if (titleMode === 'each') title = p;
      else if (typeof titleMode === 'string' && titleMode !== 'none') title = titleMode;
      const titleAttr = title ? ` title="${escapeHtml(title)}"` : '';
      out += `<ruby${titleAttr}>${escapeHtml(ch)}<rt>${escapeHtml(p)}</rt></ruby>`;
    } else {
      out += escapeHtml(ch);
    }
  }
  return out;
}

function renderSegmentsHTML(segments) {
  let html = '';
  for (const seg of segments) {
    if (seg.type === 'space') { html += escapeHtml(seg.text); continue; }
    if (seg.type === 'punct') { html += escapeHtml(seg.zhText); continue; }
    // word
    const isG2p = seg.source === 'g2p';
    const classes = ['word'];
    if (isG2p) classes.push('g2p');
    // G2P tooltip takes priority over pinyin tooltip
    const title = isG2p
      ? 'Inferred from spelling (not in CMU dict)'
      : pinyinOf(seg.zh);
    const titleAttr = title ? ` title="${escapeHtml(title)}"` : '';
    const dataAttrs = ` data-widx="${seg.widx}" data-en="${escapeHtml(seg.en)}" data-ipa="${escapeHtml(seg.ipa)}"`;
    // Ruby titles set to the shared word title so hovering any character shows it
    html += `<span class="${classes.join(' ')}"${titleAttr}${dataAttrs}>`;
    html += renderHanzi(seg.zh, title || 'none');
    html += '</span>';
  }
  return html;
}

function renderIpaHTML(segments) {
  let html = '';
  for (const seg of segments) {
    if (seg.type === 'space') { html += escapeHtml(seg.text); continue; }
    if (seg.type === 'punct') { html += escapeHtml(seg.text); continue; }
    const isG2p = seg.source === 'g2p';
    const classes = ['word'];
    if (isG2p) classes.push('g2p');
    const titleAttr = isG2p ? ' title="Inferred from spelling (not in CMU dict)"' : '';
    html += `<span class="${classes.join(' ')}" data-widx="${seg.widx}"${titleAttr}>${escapeHtml(seg.ipa)}</span>`;
  }
  return html;
}

// Mirror the input text in the overlay, wrapping each word in a hoverable span
function renderInputOverlay(segments) {
  let html = '';
  for (const seg of segments) {
    if (seg.type === 'space') { html += escapeHtml(seg.text); continue; }
    if (seg.type === 'punct') { html += escapeHtml(seg.text); continue; }
    html += `<span class="word" data-widx="${seg.widx}" data-start="${seg.startIdx}" data-end="${seg.endIdx}">${escapeHtml(seg.en)}</span>`;
  }
  return html;
}

// =============================================================
// Table modal rendering
// =============================================================
function renderTable(showPinyin) {
  let html = '<table class="translit-table' + (showPinyin ? ' with-pinyin' : '') + '">';
  html += '<thead><tr><th></th>';
  for (let ci = 0; ci < COL_LABELS.length; ci++) {
    html += `<th data-col-start="${ci}" data-col-end="${ci}">${escapeHtml(COL_LABELS[ci])}</th>`;
  }
  html += '</tr></thead><tbody>';

  // Phase 1: per-row horizontal grouping
  const rowGroups = [];
  for (let ri = 0; ri < ROW_KEYS.length; ri++) {
    const row = ROW_KEYS[ri];
    const entries = TABLE_RAW[row];
    const groups = [];
    for (let ci = 0; ci < COLS.length; ci++) {
      const main = entries[ci];
      const altKey = row + "|" + COLS[ci];
      let alt = FEMALE_ALT.get(altKey);
      let fu  = WORD_INITIAL_FU.get(altKey);
      if (alt === main) alt = undefined;
      if (fu  === main) fu  = undefined;
      const key = (main || '') + '|' + (alt || '') + '|' + (fu || '');
      const prev = groups[groups.length - 1];
      if (prev && prev.key === key) prev.colEnd = ci;
      else groups.push({ key, colStart: ci, colEnd: ci, main, alt, fu, rowspan: 1, render: true });
    }
    rowGroups.push(groups);
  }

  // Phase 2: vertical merge via rowspan
  for (let ri = 1; ri < rowGroups.length; ri++) {
    for (const g of rowGroups[ri]) {
      const above = rowGroups[ri - 1].find(p => p.colStart === g.colStart && p.colEnd === g.colEnd);
      if (above && above.key === g.key) {
        const master = above.render ? above : above.master;
        master.rowspan++;
        g.render = false;
        g.master = master;
      }
    }
  }

  // Phase 3: emit
  for (let ri = 0; ri < ROW_KEYS.length; ri++) {
    const row = ROW_KEYS[ri];
    html += `<tr data-row="${ri}"><th>${escapeHtml(ROW_LABELS[row])}</th>`;
    for (const g of rowGroups[ri]) {
      if (!g.render) continue;
      const colspan = g.colEnd - g.colStart + 1;
      const colspanAttr = colspan > 1 ? ` colspan="${colspan}"` : '';
      const rowspanAttr = g.rowspan > 1 ? ` rowspan="${g.rowspan}"` : '';
      const rowEnd = ri + g.rowspan - 1;
      const dataAttrs = ` data-row-start="${ri}" data-row-end="${rowEnd}" data-col-start="${g.colStart}" data-col-end="${g.colEnd}"`;
      if (!g.main && !g.alt && !g.fu) {
        html += `<td class="empty"${colspanAttr}${rowspanAttr}${dataAttrs}></td>`;
        continue;
      }
      let cell = '';
      // When pinyin is shown, suppress per-character pinyin tooltips
      // (they'd be redundant with the visible annotations)
      const mainTitleMode = showPinyin ? 'none' : 'each';
      if (g.main) cell += renderHanzi(g.main, mainTitleMode);
      if (g.alt) {
        // Just the description — no pinyin, no parentheses
        cell += `<span class="alt" title="Used in female names">`;
        cell += renderHanzi(g.alt, 'none');
        cell += '</span>';
      }
      if (g.fu) {
        cell += `<span class="alt" title="Used at the beginning of a word">`;
        cell += renderHanzi(g.fu, 'none');
        cell += '</span>';
      }
      html += `<td${colspanAttr}${rowspanAttr}${dataAttrs}>${cell}</td>`;
    }
    html += '</tr>';
  }
  html += '</tbody></table>';
  return html;
}

// Table hover crosshair (unchanged)
function attachTableHoverHandlers(container) {
  const table = container.querySelector('table.translit-table');
  if (!table) return;
  function clearHighlights() {
    table.querySelectorAll('.row-hover, .col-hover, .cell-hover').forEach(el => {
      el.classList.remove('row-hover', 'col-hover', 'cell-hover');
    });
  }
  table.addEventListener('mouseover', e => {
    const td = e.target.closest('td');
    if (!td || !table.contains(td)) return;
    if (td.classList.contains('empty')) { clearHighlights(); return; }
    if (td.classList.contains('cell-hover')) return;
    clearHighlights();
    const colStart = +td.dataset.colStart;
    const colEnd   = +td.dataset.colEnd;
    const rowStart = +td.dataset.rowStart;
    const rowEnd   = +td.dataset.rowEnd;
    table.querySelectorAll('tbody tr').forEach(tr => {
      const r = +tr.dataset.row;
      if (r >= rowStart && r <= rowEnd) tr.classList.add('row-hover');
    });
    table.querySelectorAll('[data-col-start]').forEach(cell => {
      if (cell.classList.contains('empty')) return;
      const cs = +cell.dataset.colStart;
      const ce = +cell.dataset.colEnd;
      if (!(ce < colStart || cs > colEnd)) cell.classList.add('col-hover');
    });
    td.classList.add('cell-hover');
  });
  table.addEventListener('mouseleave', clearHighlights);
}

function adjustEmptyBorders(container) {
  const table = container.querySelector('table.translit-table');
  if (!table) return;
  const rowCount = ROW_KEYS.length;
  const colCount = COLS.length;
  const grid = Array.from({ length: rowCount }, () => new Array(colCount).fill(null));
  const tds = table.querySelectorAll('tbody td');
  tds.forEach(td => {
    const rs = +td.dataset.rowStart, re = +td.dataset.rowEnd;
    const cs = +td.dataset.colStart, ce = +td.dataset.colEnd;
    for (let r = rs; r <= re; r++)
      for (let c = cs; c <= ce; c++) grid[r][c] = td;
  });
  tds.forEach(td => {
    if (!td.classList.contains('empty')) return;
    const re = +td.dataset.rowEnd;
    const cs = +td.dataset.colStart, ce = +td.dataset.colEnd;
    if (re + 1 >= rowCount) return;
    let all = true;
    for (let c = cs; c <= ce; c++) {
      const below = grid[re + 1][c];
      if (!below || !below.classList.contains('empty')) { all = false; break; }
    }
    if (all) td.classList.add('no-border-bottom');
  });
}

// =============================================================
// UI wiring
// =============================================================
const $input         = document.getElementById("input");
const $inputOverlay  = document.getElementById("input-overlay");
const $output        = document.getElementById("output");
const $status        = document.getElementById("status");
const $female        = document.getElementById("female");
const $pinyin        = document.getElementById("pinyin");
const $pinyinSizeMain = document.getElementById("pinyin-size-main");
const $ipa           = document.getElementById("ipa-line");
const $modal         = document.getElementById("table-modal");
const $modalBtn      = document.getElementById("show-table-btn");
const $closeModal    = document.getElementById("close-modal");
const $tableContainer = document.getElementById("table-container");
const $tablePinyin   = document.getElementById("table-pinyin");
const $title         = document.getElementById("title");
const $bubble        = document.getElementById("word-bubble");

let currentSegments = [];

let pending = null;
async function update() {
  const text = $input.value;
  if (!text.trim()) {
    currentSegments = [];
    $output.textContent = "Output will appear here.";
    $output.classList.add("empty");
    $output.classList.remove("with-pinyin");
    $ipa.textContent = "—";
    $inputOverlay.innerHTML = "";
    return;
  }
  const myToken = Symbol();
  pending = myToken;
  try {
    const segments = await transliterateTagged(text, $female.checked);
    if (pending !== myToken) return;
    currentSegments = segments;
    const showPinyin = $pinyin.checked;
    $output.innerHTML = renderSegmentsHTML(segments);
    $output.classList.remove("empty");
    $output.classList.toggle("with-pinyin", showPinyin);
    $ipa.innerHTML = renderIpaHTML(segments);
    $inputOverlay.innerHTML = renderInputOverlay(segments);
  } catch (err) {
    $output.textContent = "Error: " + err.message;
    $output.classList.remove("empty");
  }
}

// Auto-grow the textarea so the user never has to drag the resize handle.
// CSS min-height takes precedence when content is short.
function autoGrowTextarea() {
  $input.style.height = 'auto';
  $input.style.height = $input.scrollHeight + 'px';
}
$input.addEventListener("input", () => { autoGrowTextarea(); update(); });
$female.addEventListener("change", update);
$pinyin.addEventListener("change", () => {
  $output.classList.toggle("with-pinyin", $pinyin.checked);
  $pinyinSizeMain.hidden = !$pinyin.checked;
});

// =============================================================
// Cross-panel word linking — hovering a .word with data-widx anywhere
// (input overlay, output box, IPA line) highlights every .word with the
// same widx across all three.
// =============================================================
function clearWordLinkHighlights() {
  document.querySelectorAll('.word.word-link-hover').forEach(el => {
    el.classList.remove('word-link-hover');
  });
}
function highlightWordLink(widx) {
  document.querySelectorAll(`.word[data-widx="${widx}"]`).forEach(el => {
    el.classList.add('word-link-hover');
  });
}
// Delegate at document level so we catch all panels with one listener
document.addEventListener('mouseover', e => {
  const w = e.target.closest('.word[data-widx]');
  if (!w) return;
  // Don't trigger from inside the table modal — that uses its own crosshair
  if (w.closest('#table-modal')) return;
  const widx = w.dataset.widx;
  if (!widx) return;
  clearWordLinkHighlights();
  highlightWordLink(widx);
});
document.addEventListener('mouseout', e => {
  const w = e.target.closest('.word[data-widx]');
  if (!w) return;
  const related = e.relatedTarget && e.relatedTarget.closest && e.relatedTarget.closest('.word[data-widx]');
  if (related && related.dataset.widx === w.dataset.widx) return; // still on same word group
  clearWordLinkHighlights();
});

// Input overlay click → focus textarea and place cursor at the word's end
$inputOverlay.addEventListener('mousedown', e => {
  const span = e.target.closest('.word');
  if (!span) return;
  e.preventDefault();
  const end = +span.dataset.end;
  $input.focus();
  try { $input.setSelectionRange(end, end); } catch (_) {}
});

// =============================================================
// Mobile: tap on a Chinese (output) word shows a floating bubble with the
// English word and IPA. Only active when the layout is stacked (narrow).
// =============================================================
function isStackedLayout() { return window.matchMedia('(max-width: 899px)').matches; }
let bubbleTimer = null;
function showBubble(targetEl, en, ipa, showIpa) {
  $bubble.innerHTML = `<div class="bubble-en">${escapeHtml(en)}</div>` +
                      (showIpa && ipa ? `<div class="bubble-ipa">${escapeHtml(ipa)}</div>` : '');
  $bubble.hidden = false;
  const r = targetEl.getBoundingClientRect();
  const x = r.left + r.width / 2 + window.scrollX;
  const y = r.top + window.scrollY;
  $bubble.style.left = x + 'px';
  $bubble.style.top  = y + 'px';
  if (bubbleTimer) clearTimeout(bubbleTimer);
  bubbleTimer = setTimeout(hideBubble, 3000);
}
function hideBubble() {
  $bubble.hidden = true;
  if (bubbleTimer) { clearTimeout(bubbleTimer); bubbleTimer = null; }
}
$output.addEventListener('click', e => {
  if (!isStackedLayout()) return;
  const w = e.target.closest('.word[data-widx]');
  if (!w) return;
  const ipaOpen = !!$ipa.closest('details').open;
  showBubble(w, w.dataset.en, w.dataset.ipa, ipaOpen);
});
document.addEventListener('click', e => {
  // Dismiss bubble on outside click
  if ($bubble.hidden) return;
  if (e.target.closest('#word-bubble') || e.target.closest('.word[data-widx]')) return;
  hideBubble();
});
window.addEventListener('scroll', hideBubble, { passive: true });
window.addEventListener('resize', hideBubble);

// =============================================================
// Pinyin font size (A+/A-) — controls a CSS variable shared across
// both the output and table modal. Persisted in localStorage.
// =============================================================
const PINYIN_MIN = 0.30;
const PINYIN_MAX = 0.95;
const PINYIN_STEP = 0.07;
function getPinyinRatio() {
  const v = parseFloat(localStorage.getItem('pinyinRatio'));
  return isFinite(v) && v >= PINYIN_MIN && v <= PINYIN_MAX ? v : 0.42;
}
function setPinyinRatio(v) {
  v = Math.max(PINYIN_MIN, Math.min(PINYIN_MAX, v));
  document.documentElement.style.setProperty('--pinyin-ratio', v.toFixed(3));
  localStorage.setItem('pinyinRatio', v.toString());
  // Disable buttons at extremes
  for (const idMinus of ['pinyin-smaller', 'pinyin-smaller-table']) {
    const b = document.getElementById(idMinus);
    if (b) b.disabled = v <= PINYIN_MIN + 1e-6;
  }
  for (const idPlus of ['pinyin-larger', 'pinyin-larger-table']) {
    const b = document.getElementById(idPlus);
    if (b) b.disabled = v >= PINYIN_MAX - 1e-6;
  }
}
setPinyinRatio(getPinyinRatio());
function wirePinyinBtns(minusId, plusId) {
  const minus = document.getElementById(minusId);
  const plus  = document.getElementById(plusId);
  if (minus) minus.addEventListener('click', () => setPinyinRatio(getPinyinRatio() - PINYIN_STEP));
  if (plus)  plus.addEventListener('click',  () => setPinyinRatio(getPinyinRatio() + PINYIN_STEP));
}
wirePinyinBtns('pinyin-smaller', 'pinyin-larger');
wirePinyinBtns('pinyin-smaller-table', 'pinyin-larger-table');

// =============================================================
// Modal
// =============================================================
function openTableModal() {
  $tableContainer.innerHTML = renderTable($tablePinyin.checked);
  attachTableHoverHandlers($tableContainer);
  adjustEmptyBorders($tableContainer);
  if (typeof $modal.showModal === 'function') $modal.showModal();
  else $modal.setAttribute('open', '');
}
function closeTableModal() {
  if (typeof $modal.close === 'function') $modal.close();
  else $modal.removeAttribute('open');
}
$modalBtn.addEventListener('click', (e) => { e.preventDefault(); openTableModal(); });
$closeModal.addEventListener('click', closeTableModal);
$modal.addEventListener('click', (e) => {
  if (e.target === $modal) closeTableModal();
});
$tablePinyin.addEventListener('change', () => {
  $tableContainer.innerHTML = renderTable($tablePinyin.checked);
  attachTableHoverHandlers($tableContainer);
  adjustEmptyBorders($tableContainer);
});

// =============================================================
// Easter egg: hovering the page title transliterates all English text
// on the page into Chinese (no pinyin, no underlines). The user's input
// text and the IPA headers in the modal are excluded.
// =============================================================
function transliterateAllText() {
  if (!cmudict) return;
  const root = document.querySelector('.container');
  if (!root) return;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const p = node.parentElement;
      if (!p) return NodeFilter.FILTER_REJECT;
      if (p.closest('textarea, input')) return NodeFilter.FILTER_REJECT;
      if (p.closest('#output, #ipa-line, #input-overlay')) return NodeFilter.FILTER_REJECT;
      if (p.closest('#word-bubble')) return NodeFilter.FILTER_REJECT;
      if (p.closest('rt')) return NodeFilter.FILTER_REJECT;
      const text = node.nodeValue;
      if (!/[A-Za-z]/.test(text)) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    }
  });
  const nodes = [];
  for (let n; (n = walker.nextNode()); ) nodes.push(n);
  for (const n of nodes) {
    if (!n._origText) n._origText = n.nodeValue;
    n.nodeValue = transliterateTextSync(n._origText, false);
  }
  // Placeholder attributes (textarea/input) aren't text nodes — handle separately
  document.querySelectorAll('textarea[placeholder], input[placeholder]').forEach(el => {
    if (el._origPlaceholder === undefined) el._origPlaceholder = el.placeholder;
    el.placeholder = transliterateTextSync(el._origPlaceholder, false);
  });
}
function restoreAllText() {
  const root = document.querySelector('.container');
  if (!root) return;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let n; (n = walker.nextNode()); ) {
    if (n._origText !== undefined) n.nodeValue = n._origText;
  }
  document.querySelectorAll('textarea, input').forEach(el => {
    if (el._origPlaceholder !== undefined) el.placeholder = el._origPlaceholder;
  });
}
$title.addEventListener('mouseenter', transliterateAllText);
$title.addEventListener('mouseleave', restoreAllText);

// Boot
(async () => {
  try {
    await loadCmudict();
    $status.textContent = "Ready.";
    setTimeout(() => { $status.textContent = ""; }, 1500);
    autoGrowTextarea();
    if ($input.value) update();
  } catch (e) {
    $status.textContent = "Failed to load dictionary.";
  }
})();
