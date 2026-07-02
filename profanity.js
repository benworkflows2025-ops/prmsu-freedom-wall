/* ===========================================================================
   profanity.js - a Filipino + English content filter (first line of defence).
   ---------------------------------------------------------------------------
   This is a client-side courtesy filter, NOT a security control. Anyone can
   bypass a browser check, which is exactly why the wall also has a Report
   button and an admin review queue. Goal: stop casual, obvious slurs and
   swearing before they post.

   Two lists, two matching styles:
     STRONG - clearly profane words / multi-word insults. Matched with
              normalisation (leetspeak folded, repeats collapsed, punctuation
              stripped) and flexible spacing, anchored to word boundaries so it
              never trips on innocent substrings (e.g. "reputation").
     RISKY  - short, ambiguous vulgar words that are also substrings of, or
              equal to, innocent words. Matched ONLY as exact standalone tokens
              to avoid false positives.

   We deliberately do NOT block standalone LGBTQ identity words (bakla, bading,
   gay, tomboy, beki, ...) or innocent homographs (boto = vote, atay = liver,
   leche = milk) - blocking self-expression would be wrong on a freedom wall.
   Targeted attack phrases ("bakla ka") remain in STRONG.

   Exports on window.PRMSU_FILTER:
     contains(text) -> true if the text trips the filter
   =========================================================================== */
(function () {
  var STRONG = [
    // --- Tagalog / Filipino ---
    'putangina', 'putang ina', 'putang ina mo', 'putanginamo', 'putang inang', 'putanginang',
    'potangina', 'potang ina', 'pota', 'puta', 'puta ka', 'putang', 'tangina', 'tang ina',
    'tangina mo', 'tang ina mo', 'tangina niyo', 'tanginamo', 'tngina', 'tnginamo', 'ptngina',
    'tangna', 'tangnamo', 'tarangina', 'anak ng puta', 'anak ng puta ka', 'anak ng puta mo',
    'puta ng ina', 'puta ng ina mo', 'puke ng ina mo', 'puki ng ina mo', 'pukinginamo',
    'kingina', 'kingina mo', 'kinginamo', 'king ina', 'putragis', 'putris', 'pucha', 'putcha',
    'puchang', 'punyeta', 'punyeta ka', 'punyetang', 'letse', 'letseng', 'letche', 'lintik',
    'lintik na', 'lintik ka', 'hinayupak', 'hayop ka', 'hayup ka', 'hudas', 'peste', 'pesteng',
    'pesteng yawa', 'pakshet', 'pakingshet', 'kingshet', 'pakyu', 'pakyu ka', 'pak yu', 'pakyoo',
    'fakyu', 'fak yu', 'gago', 'gaga', 'gagu', 'gagong', 'gaguhan', 'kagaguhan', 'nakakagago',
    'ogag', 'ulol', 'ulol ka', 'ungas', 'gunggong', 'tanga ka', 'bobo', 'boba', 'bobong',
    'bobo ka', 'tarantado', 'tarantada', 'kupal', 'kupal ka', 'kupalista', 'hindot', 'hindot ka',
    'kantot', 'kantutan', 'kantutin', 'iyot', 'iyutin', 'kadyot', 'jakol', 'jakulan', 'salsal',
    'salsalero', 'tsupa', 'chupain', 'chupaan', 'tsupain', 'brotsa', 'betlog', 'bitlog', 'burat',
    'tarugo', 'pekpek', 'libog', 'malibog', 'kalibugan', 'burikat', 'pokpokan', 'walang hiya',
    'walanghiya', 'walang hiya ka', 'gago ka', 'unggoy ka', 'baboy ka', 'supot ka', 'animal ka',
    'demonyo ka', 'binabae', 'bakla ka', 'bading ka', 'badaf', 'faggot ka', 'shet', 'syet',
    'potek', 'bwisit', 'buwisit', 'bwiset', 'buwiset', 'myerda', 'karaho',
    // --- Cebuano / Bisaya ---
    'yawa', 'yawa ka', 'pisti', 'piste', 'pisti yawa', 'piste yawa', 'buang', 'buanga', 'buang ka',
    'yudiputa', 'diputa', 'iho de puta', 'ihodeputa', 'lintian', 'anakputa', 'putana', 'putanaydana',
    'kaonon ka sa yawa', 'giyot', 'agiyot',
    // --- Ilocano ---
    'ukinnam', 'ukininam', 'ukinam', 'okinam', 'ukinnan', 'yot ni inam', 'yot ni nam', 'manulay',
    'panulay ka',
    // --- English ---
    'fuck', 'fuck you', 'fuck off', 'fucker', 'fucking', 'fuckface', 'fuckhead', 'fuckwit',
    'motherfucker', 'motherfucking', 'mother fucker', 'fck', 'fuk', 'fvck', 'phak', 'bullshit',
    'shitty', 'shithead', 'holy shit', 'piece of shit', 'shit', 'bitch', 'bitches', 'biatch',
    'son of a bitch', 'bitchass', 'asshole', 'asshat', 'dumbass', 'jackass', 'dickhead', 'dickface',
    'cocksucker', 'cunt', 'bastard', 'goddamn', 'god damn', 'slut', 'whore', 'skank', 'faggot',
    'faggots', 'retard', 'retarded', 'nigger', 'niggers', 'nigga', 'wanker', 'douchebag', 'blowjob',
    'handjob', 'jerkoff', 'jerk off', 'dildo', 'cumshot', 'cocksuck', 'dumbfuck', 'clusterfuck',
    'pedophile', 'rapist', 'molester',
  ];

  var RISKY = [
    // vulgar anatomy / sexual (Filipino)
    'puke', 'puki', 'pepe', 'pipi', 'kiki', 'titi', 'tite', 'tete', 'titit', 'oten', 'otin',
    'utin', 'uten', 'utong', 'bayag', 'bilat', 'birat', 'buday', 'buray', 'supot', 'pokpok', 'tng',
    // hard slurs
    'chekwa', 'baluga', 'spic', 'dyke', 'fag',
    // English vulgar
    'ass', 'dick', 'cock', 'cum', 'hoe', 'tit', 'tits', 'boob', 'boobs', 'prick', 'wank', 'pussy',
    'twat', 'arse',
  ];

  var LEET = { '0': 'o', '1': 'i', '!': 'i', '3': 'e', '4': 'a', '@': 'a', '5': 's', '$': 's', '7': 't', '8': 'b', '9': 'g' };

  function normalise(text) {
    var s = String(text == null ? '' : text).toLowerCase();
    s = s.replace(/[0134@579$8!]/g, function (c) { return LEET[c] || c; });
    s = s.replace(/[^a-z\s]/g, '');
    s = s.replace(/([a-z])\1{2,}/g, '$1$1').replace(/\s+/g, ' ').trim();
    return s;
  }

  // Flexible, boundary-anchored patterns for the STRONG list.
  var PATTERNS = STRONG.map(function (w) {
    var norm = normalise(w);
    var body = norm.split(' ').map(function (part) {
      return part.split('').join('\\s*');   // allow spacing between a word's letters
    }).join('\\s+');                          // and between phrase words
    return new RegExp('(^|[^a-z])' + body + '([^a-z]|$)', 'i');
  });

  var RISKY_SET = {};
  RISKY.forEach(function (w) { RISKY_SET[normalise(w)] = true; });

  function contains(text) {
    var norm = normalise(text);
    var padded = ' ' + norm + ' ';
    for (var i = 0; i < PATTERNS.length; i++) {
      if (PATTERNS[i].test(padded)) return true;
    }
    var tokens = norm.split(' ');
    for (var j = 0; j < tokens.length; j++) {
      if (tokens[j] && RISKY_SET[tokens[j]]) return true;
    }
    return false;
  }

  window.PRMSU_FILTER = { contains: contains };
})();
