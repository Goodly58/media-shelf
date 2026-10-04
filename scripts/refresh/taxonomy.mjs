/* The genre taxonomy: every subgenre and theme the site offers, the group it
   is shown under, and how it is recognised in each source.

   Films and series:  Wikipedia categories ("2010s satirical films", "Films
                      about revenge") and Wikidata genre labels, lowercased.
   Games:             Steam's player tags, by exact name.
   Books:             Goodreads genre shelves, by name; a few high-precision
                      Open Library subjects when a book has no shelves yet.

   One list per medium keeps the picker, the data and the tests in step. */

/* ------------------------------------------------------------ films, series */

export const SCREEN_GROUPS = ['Horror', 'Comedy', 'Sci-Fi', 'Fantasy', 'Action & Adventure', 'Crime & Thriller',
  'Drama', 'Romance', 'Animation & Family', 'Society & Ideas', 'Based on', 'Style'];

// [tag, group, pattern tested against each lowercased category or genre label]
export const SCREEN_TAGS = [
  ['Slasher', 'Horror', /\bslasher/],
  ['Supernatural Horror', 'Horror', /supernatural horror/],
  ['Psychological Horror', 'Horror', /psychological horror/],
  ['Folk Horror', 'Horror', /folk horror/],
  ['Body Horror', 'Horror', /body horror/],
  ['Found Footage', 'Horror', /found footage/],
  ['Zombies', 'Horror', /\bzombie|living dead/],
  ['Vampires', 'Horror', /\bvampire/],
  ['Werewolves', 'Horror', /werewol/],
  ['Monsters', 'Horror', /monster (movies|films)|creature feature|films about monsters/],
  ['Ghosts', 'Horror', /\bghost (films|stories|television)|films about ghosts|haunted house/],
  ['Demons & Possession', 'Horror', /demonic|exorcis|spirit possession|films about demons|the devil in|satanism/],
  ['Witches', 'Horror', /\bwitch(es|craft)?\b/],
  ['Splatter', 'Horror', /splatter|gore films/],
  ['Cosmic Horror', 'Horror', /lovecraft|cosmic horror/],
  ['Teen Horror', 'Horror', /teen horror/],
  ['Horror Comedy', 'Horror', /comedy horror|horror comed/],
  ['Sci-Fi Horror', 'Horror', /science fiction horror/],
  ['Animal Attack', 'Horror', /\bnatural horror|animal attack|killer animal|shark films|films about sharks|eco-horror/],
  ['Home Invasion', 'Horror', /home invasion/],
  ['Giallo', 'Horror', /giallo/],

  ['Satire', 'Comedy', /satir/],
  ['Parody', 'Comedy', /parod|spoof/],
  ['Dark Comedy', 'Comedy', /black comed|dark comed/],
  ['Buddy Comedy', 'Comedy', /buddy (comedy|film)/],
  ['Mockumentary', 'Comedy', /mockumentar/],
  ['Slapstick', 'Comedy', /slapstick/],
  ['Screwball', 'Comedy', /screwball/],
  ['Stoner', 'Comedy', /stoner/],
  ['Teen Comedy', 'Comedy', /teen comedy|teen sex comedy/],
  ['Sex Comedy', 'Comedy', /sex comedy/],
  ['Sitcom', 'Comedy', /\bsitcom/],
  ['Sketch Comedy', 'Comedy', /sketch comedy/],
  ['Stand-Up', 'Comedy', /stand-up comedy/],
  ['Workplace Comedy', 'Comedy', /workplace comedy/],

  ['Space', 'Sci-Fi', /space opera|space adventure|films set in outer space|set in outer space|films about astronauts|space exploration/],
  ['Space Opera', 'Sci-Fi', /space opera/],
  ['Cyberpunk', 'Sci-Fi', /cyberpunk/],
  ['Steampunk', 'Sci-Fi', /steampunk/],
  ['Dystopian', 'Sci-Fi', /dystopi/],
  ['Apocalyptic', 'Sci-Fi', /apocalyptic|end of the world/],
  ['Time Travel', 'Sci-Fi', /time travel/],
  ['Time Loop', 'Sci-Fi', /time loop/],
  ['Aliens', 'Sci-Fi', /extraterrestrial|alien invasion|about aliens/],
  ['AI & Robots', 'Sci-Fi', /artificial intelligence|\brobot|android \(robot|cyborg/],
  ['Virtual Reality', 'Sci-Fi', /virtual reality|simulated reality/],
  ['Mad Scientist', 'Sci-Fi', /mad scientist/],
  ['Kaiju', 'Sci-Fi', /kaiju|giant monster|godzilla/],
  ['Pandemic', 'Sci-Fi', /viral outbreak|about (the covid-19 )?pandemics?\b|about epidemics/],
  ['Dinosaurs', 'Sci-Fi', /dinosaur/],

  ['Fairy Tale', 'Fantasy', /fairy tale|fairytale/],
  ['Dark Fantasy', 'Fantasy', /dark fantasy/],
  ['Epic Fantasy', 'Fantasy', /high fantasy|epic fantasy|sword and sorcery/],
  ['Urban Fantasy', 'Fantasy', /urban fantasy/],
  ['Science Fantasy', 'Fantasy', /science fantasy/],
  ['Magic', 'Fantasy', /magic \(supernatural\)|\bwizards?\b|sorcer|magical girl/],
  ['Dragons', 'Fantasy', /about dragons|\bdragon (films|movies)/],
  ['Mythology', 'Fantasy', /mytholog|deities|greek gods|norse gods/],
  ['Supernatural', 'Fantasy', /supernatural (fantasy|drama|thriller|comedy|films|television)/],
  ['Superheroes', 'Action & Adventure', /superhero/],

  ['Martial Arts', 'Action & Adventure', /martial arts|kung fu|wuxia|karate|samurai/],
  ['Spy', 'Action & Adventure', /\bspy\b|espionage|spies/],
  ['Disaster', 'Action & Adventure', /disaster (films|movies|television)/],
  ['Survival', 'Action & Adventure', /\bsurvival (films|drama|thriller|television)|films about survival/],
  ['Pirates', 'Action & Adventure', /swashbuckler|pirate (films|television)|about pirates\b|pirates of the caribbean/],
  ['Treasure Hunt', 'Action & Adventure', /treasure hunt/],
  ['Road Movie', 'Action & Adventure', /road (movies|films)/],
  ['Cars & Racing', 'Action & Adventure', /auto racing|motor racing|street racing|car chase|films about automobiles/],
  ['World War II', 'Action & Adventure', /world war ii\b/],
  ['World War I', 'Action & Adventure', /world war i\b/],
  ['Vietnam War', 'Action & Adventure', /vietnam war/],
  ['Military', 'Action & Adventure', /military (drama|films|television)|films about the united states (army|navy|marine)/],
  ['Epic', 'Action & Adventure', /\bepic (films|television)/],
  ['Jungle & Wilderness', 'Action & Adventure', /jungle|wilderness/],

  ['Heist', 'Crime & Thriller', /heist|caper (films|television)/],
  ['Gangsters', 'Crime & Thriller', /gangster|mafia|organized crime|yakuza|triad|mobster/],
  ['Neo-Noir', 'Crime & Thriller', /neo-noir/],
  ['Serial Killers', 'Crime & Thriller', /serial killer/],
  ['Detectives', 'Crime & Thriller', /detective/],
  ['Murder Mystery', 'Crime & Thriller', /whodunit|murder myster/],
  ['Police', 'Crime & Thriller', /police (films|drama|procedural|television)|films about police|police officers/],
  ['Courtroom', 'Crime & Thriller', /courtroom|legal (drama|thriller|films|television)|trial films/],
  ['Prison', 'Crime & Thriller', /\bprison/],
  ['Drug Trade', 'Crime & Thriller', /drug trade|drug cartel|drug traffick/],
  ['Conspiracy', 'Crime & Thriller', /conspiracy/],
  ['Political Thriller', 'Crime & Thriller', /political thriller/],
  ['Psychological Thriller', 'Crime & Thriller', /psychological thriller/],
  ['Erotic Thriller', 'Crime & Thriller', /erotic thriller/],
  ['Hackers', 'Crime & Thriller', /\bhack(er|ers|ing)\b|cyberwarfare/],
  ['Revenge', 'Crime & Thriller', /about revenge|revenge (films|thriller|drama)|vigilante/],
  ['Kidnapping', 'Crime & Thriller', /kidnap|child abduction/],
  ['True Crime', 'Crime & Thriller', /true crime/],
  ['Neo-Western', 'Crime & Thriller', /neo-western|contemporary western/],
  ['Spaghetti Western', 'Crime & Thriller', /spaghetti western/],

  ['Coming of Age', 'Drama', /coming-of-age|coming of age/],
  ['Teen', 'Drama', /\bteen (drama|films|television)|high school (films|television|drama)|teenage/],
  ['Family Drama', 'Drama', /dysfunctional famil|family drama|family saga/],
  ['Period Drama', 'Drama', /period (drama|piece)|costume drama|historical drama/],
  ['Political', 'Drama', /political (drama|films|television)|films about politicians|elections/],
  ['Medical', 'Drama', /medical (drama|television)|hospital|films about physicians/],
  ['Addiction', 'Drama', /addiction|alcoholism|drug abuse|substance abuse/],
  ['Mental Health', 'Drama', /mental (illness|health)|schizophrenia|psychiatr|films about depression|clinical depression/],
  ['Grief', 'Drama', /\bgrief|bereavement|mourning/],
  ['Slice of Life', 'Drama', /slice of life/],
  ['Melodrama', 'Drama', /melodrama/],
  ['Boxing', 'Drama', /\bboxing/],
  ['Football', 'Drama', /american football|association football|soccer/],
  ['Baseball', 'Drama', /baseball/],
  ['Basketball', 'Drama', /basketball/],
  ['Music & Musicians', 'Drama', /films about musicians|films about music|music industry|rock music films|hip hop films/],
  ['Dance', 'Drama', /\bdance (films|drama)/],

  ['Romantic Comedy', 'Romance', /romantic comedy/],
  ['Romantic Drama', 'Romance', /romantic drama/],
  ['LGBTQ', 'Romance', /lgbt|gay |lesbian|transgender|queer/],
  ['Weddings', 'Romance', /wedding/],
  ['Erotic', 'Romance', /\berotic (films|drama)|sexploitation/],

  ['Anime', 'Animation & Family', /\banime\b(?!-influenced)/],
  ['Stop-Motion', 'Animation & Family', /stop-motion/],
  ['Adult Animation', 'Animation & Family', /adult animat/],
  ['Christmas', 'Animation & Family', /christmas/],
  ['Halloween', 'Animation & Family', /halloween/],
  ['Kids', 'Animation & Family', /children's (films|television|comedy|fantasy|animated)/],
  ['Animals', 'Animation & Family', /films about animals|talking animals|animated films about animals|films about dogs|films about cats|films about horses/],

  ['Race & Racism', 'Society & Ideas', /racism|race and ethnicity|racial/],
  ['Feminism', 'Society & Ideas', /feminis/],
  ['Religion', 'Society & Ideas', /films about (religion|christianity|catholicism|islam(?!ic)|buddhism|hinduism|nuns|priests|the catholic church)|religious (horror|drama|epic|satire|comedy) films|portrayals of jesus|biblical|christian (films|media)|critical of religion/],
  ['Class', 'Society & Ideas', /social class|upper class|working class|poverty/],
  ['Immigration', 'Society & Ideas', /immigra|refugee/],
  ['Holocaust', 'Society & Ideas', /holocaust|concentration camps|nazi hunters/],
  ['Cold War', 'Society & Ideas', /cold war/],
  ['Cults', 'Society & Ideas', /\bcults\b(?! of personality)/],
  ['Journalism', 'Society & Ideas', /journalis|newspaper/],
  ['Environment', 'Society & Ideas', /climate change|environmental|ecolog/],

  ['True Story', 'Based on', /based on actual events|based on real events|docudrama|films based on true/],
  ['Based on a Book', 'Based on', /based on (\w+ )?(novels?|books?|short stories|short fiction|novellas?|memoirs?)|based on works by/],
  ['Based on Comics', 'Based on', /based on (\w+ )?comics|based on (dc|marvel) comics|based on manga/],
  ['Based on a Video Game', 'Based on', /based on video games/],
  ['Based on a Play', 'Based on', /based on (\w+ )?plays/],
  ['Remake', 'Based on', /remake/],

  ['Indie', 'Style', /independent (films|television)/],
  ['Silent', 'Style', /(?<!(remakes of|about) )silent (films|feature films|comedy films|drama films|horror films)/],
  ['Black and White', 'Style', /black-and-white/],
  ['Cult Classic', 'Style', /cult films/],
  ['Experimental', 'Style', /experimental (films|film)|avant-garde/],
  ['Nonlinear', 'Style', /nonlinear narrative/],
  ['Anthology', 'Style', /anthology/],
  ['Exploitation', 'Style', /exploitation (films|film)|grindhouse|b movies/],
];

/* Broad genres, in IMDb's names, for titles IMDb files under just one. Only
   phrasings that name a genre outright ("2005 action films") count. */
export const SCREEN_BROAD = [
  ['Action', /\baction (films|television|thriller films|comedy films|drama films)\b|superhero/],
  ['Adventure', /\badventure (films|television)/],
  ['Animation', /\banimated (films|television)|animation/],
  ['Biography', /biographical/],
  ['Comedy', /\bcomedy(-drama)? (films|television)|sitcom/],
  ['Crime', /\bcrime (films|drama|thriller|comedy|television)|gangster|heist/],
  ['Documentary', /documentar/],
  ['Drama', /\bdrama (films|television)|drama series/],
  ['Family', /\bfamily (films|television)|children's films/],
  ['Fantasy', /\bfantasy (films|television|adventure)/],
  ['History', /historical (films|drama|television)/],
  ['Horror', /\bhorror (films|television)|slasher|zombie films/],
  ['Music', /\bmusic (films|television)|musicians/],
  ['Musical', /\bmusical (films|television)/],
  ['Mystery', /\bmystery (films|television)/],
  ['Romance', /\bromance (films|television)|romantic (drama|comedy) (films|television)/],
  ['Sci-Fi', /science fiction (films|television|action|drama|thriller|comedy)/],
  ['Sport', /\bsports (films|television)/],
  ['Thriller', /\bthriller (films|television)/],
  ['War', /\bwar (films|drama|television)/],
  ['Western', /\bwestern (\(genre\) )?(films|television)/],
];

/* Country of origin from categories that open with a nationality:
   "2017 American films", "South Korean thriller television series". */
const NATIONS = {
  american: 'United States', british: 'United Kingdom', english: 'United Kingdom', scottish: 'United Kingdom', welsh: 'United Kingdom',
  irish: 'Ireland', canadian: 'Canada', australian: 'Australia', 'new zealand': 'New Zealand', french: 'France', german: 'Germany',
  'west german': 'Germany', 'east german': 'Germany', italian: 'Italy', spanish: 'Spain', portuguese: 'Portugal', mexican: 'Mexico',
  brazilian: 'Brazil', argentine: 'Argentina', chilean: 'Chile', colombian: 'Colombia', cuban: 'Cuba', peruvian: 'Peru',
  japanese: 'Japan', 'south korean': 'South Korea', 'north korean': 'North Korea', chinese: 'China', 'hong kong': 'Hong Kong',
  taiwanese: 'Taiwan', indian: 'India', pakistani: 'Pakistan', iranian: 'Iran', israeli: 'Israel', lebanese: 'Lebanon',
  egyptian: 'Egypt', turkish: 'Turkey', russian: 'Russia', soviet: 'Soviet Union', ukrainian: 'Ukraine', polish: 'Poland',
  czech: 'Czechia', czechoslovak: 'Czechoslovakia', hungarian: 'Hungary', romanian: 'Romania', serbian: 'Serbia', croatian: 'Croatia',
  yugoslav: 'Yugoslavia', greek: 'Greece', danish: 'Denmark', swedish: 'Sweden', norwegian: 'Norway', finnish: 'Finland',
  icelandic: 'Iceland', dutch: 'Netherlands', belgian: 'Belgium', swiss: 'Switzerland', austrian: 'Austria', thai: 'Thailand',
  indonesian: 'Indonesia', filipino: 'Philippines', philippine: 'Philippines', vietnamese: 'Vietnam', malaysian: 'Malaysia',
  singaporean: 'Singapore', nigerian: 'Nigeria', 'south african': 'South Africa', moroccan: 'Morocco', tunisian: 'Tunisia',
  algerian: 'Algeria', venezuelan: 'Venezuela', uruguayan: 'Uruguay', 'saudi arabian': 'Saudi Arabia', emirati: 'United Arab Emirates',
  georgian: 'Georgia', armenian: 'Armenia', kazakhstani: 'Kazakhstan', bulgarian: 'Bulgaria', slovak: 'Slovakia', slovenian: 'Slovenia',
  bosnian: 'Bosnia and Herzegovina', estonian: 'Estonia', latvian: 'Latvia', lithuanian: 'Lithuania', luxembourgish: 'Luxembourg',
};
const NATION_RE = new RegExp(`^(?:\\d{4}s? )?(${Object.keys(NATIONS).sort((a, b) => b.length - a.length).join('|')}) (?:[\\w'()-]+ ){0,4}?(films|movies|television|animated|documentary|miniseries|web series)\\b`);

export function screenCountries(cats) {
  const out = [];
  for (const raw of cats || []) {
    const m = String(raw).toLowerCase().match(NATION_RE);
    if (m && !out.includes(NATIONS[m[1]])) out.push(NATIONS[m[1]]);
  }
  return out;
}

// Prizes, studios, people and release logistics say nothing about genre and only invite false matches.
const NOISE = /award|prize|winner|nominee|directed by|produced by|scored by|screenplays by|created by|films by|(pictures|studios|productions|entertainment|films|animation) films$|due to the covid|impacted by the covid/;

/** Subgenre and theme tags for one film or series. */
export function screenTags(cats, wikidataGenres) {
  const texts = [...(cats || []), ...(wikidataGenres || [])].map((s) => String(s).toLowerCase()).filter((s) => !NOISE.test(s));
  const out = [];
  for (const [tag, , re] of SCREEN_TAGS) if (texts.some((s) => re.test(s))) out.push(tag);
  return out;
}

/** Up to `max` broad genres the categories name outright, most-named first. */
export function screenBroad(cats, max = 2) {
  const counts = new Map();
  for (const raw of cats || []) {
    const s = String(raw).toLowerCase();
    if (NOISE.test(s)) continue;
    for (const [g, re] of SCREEN_BROAD) if (re.test(s)) counts.set(g, (counts.get(g) || 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, max).map(([g]) => g);
}

/* ----------------------------------------------------------------- games */

export const GAME_GROUPS = ['Action', 'Shooter', 'RPG', 'Strategy', 'Simulation & Sports', 'Survival & Sandbox', 'Horror',
  'Puzzle & Platform', 'Story', 'Setting', 'Style', 'Players'];

// [Steam tag, name shown, group]
export const GAME_TAGS = [
  ['Souls-like', 'Souls-like', 'Action'], ['Hack and Slash', 'Hack and Slash', 'Action'],
  ['Character Action Game', 'Character Action', 'Action'], ["Beat 'em up", "Beat 'em up", 'Action'],
  ['Fighting', 'Fighting', 'Action'], ['Stealth', 'Stealth', 'Action'], ['Immersive Sim', 'Immersive Sim', 'Action'],
  ['Open World', 'Open World', 'Action'], ['Action-Adventure', 'Action-Adventure', 'Action'],
  ['FPS', 'FPS', 'Shooter'], ['Third-Person Shooter', 'Third-Person Shooter', 'Shooter'], ['Looter Shooter', 'Looter Shooter', 'Shooter'],
  ['Hero Shooter', 'Hero Shooter', 'Shooter'], ['Arena Shooter', 'Arena Shooter', 'Shooter'], ['Tactical', 'Tactical', 'Shooter'],
  ['Twin Stick Shooter', 'Twin Stick', 'Shooter'], ['Bullet Hell', 'Bullet Hell', 'Shooter'], ["Shoot 'Em Up", 'Shmup', 'Shooter'],
  ['Battle Royale', 'Battle Royale', 'Shooter'], ['Extraction Shooter', 'Extraction Shooter', 'Shooter'],
  ['Action RPG', 'Action RPG', 'RPG'], ['JRPG', 'JRPG', 'RPG'], ['CRPG', 'CRPG', 'RPG'], ['Party-Based RPG', 'Party-Based', 'RPG'],
  ['Tactical RPG', 'Tactical RPG', 'RPG'], ['Turn-Based Combat', 'Turn-Based Combat', 'RPG'], ['Dungeon Crawler', 'Dungeon Crawler', 'RPG'],
  ['MMORPG', 'MMORPG', 'RPG'], ['Character Customization', 'Character Customization', 'RPG'],
  ['RTS', 'RTS', 'Strategy'], ['4X', '4X', 'Strategy'], ['Grand Strategy', 'Grand Strategy', 'Strategy'],
  ['Turn-Based Strategy', 'Turn-Based Strategy', 'Strategy'], ['Turn-Based Tactics', 'Turn-Based Tactics', 'Strategy'],
  ['Tower Defense', 'Tower Defense', 'Strategy'], ['Auto Battler', 'Auto Battler', 'Strategy'], ['Wargame', 'Wargame', 'Strategy'],
  ['MOBA', 'MOBA', 'Strategy'], ['Deckbuilding', 'Deckbuilding', 'Strategy'], ['Card Battler', 'Card Battler', 'Strategy'],
  ['Roguelike Deckbuilder', 'Roguelike Deckbuilder', 'Strategy'], ['Real Time Tactics', 'Real-Time Tactics', 'Strategy'],
  ['City Builder', 'City Builder', 'Simulation & Sports'], ['Colony Sim', 'Colony Sim', 'Simulation & Sports'],
  ['Farming Sim', 'Farming Sim', 'Simulation & Sports'], ['Life Sim', 'Life Sim', 'Simulation & Sports'],
  ['Management', 'Management', 'Simulation & Sports'], ['Automation', 'Automation', 'Simulation & Sports'],
  ['Space Sim', 'Space Sim', 'Simulation & Sports'], ['Flight', 'Flight', 'Simulation & Sports'],
  ['Driving', 'Driving', 'Simulation & Sports'], ['Racing', 'Racing', 'Simulation & Sports'],
  ['Sports', 'Sports', 'Simulation & Sports'], ['Football (Soccer)', 'Football', 'Simulation & Sports'],
  ['Survival', 'Survival', 'Survival & Sandbox'], ['Open World Survival Craft', 'Survival Craft', 'Survival & Sandbox'],
  ['Crafting', 'Crafting', 'Survival & Sandbox'], ['Base Building', 'Base Building', 'Survival & Sandbox'],
  ['Sandbox', 'Sandbox', 'Survival & Sandbox'], ['Exploration', 'Exploration', 'Survival & Sandbox'],
  ['Survival Horror', 'Survival Horror', 'Horror'], ['Psychological Horror', 'Psychological Horror', 'Horror'],
  ['Horror', 'Horror', 'Horror'], ['Lovecraftian', 'Lovecraftian', 'Horror'], ['Zombies', 'Zombies', 'Horror'],
  ['Gore', 'Gore', 'Horror'],
  ['Puzzle', 'Puzzle', 'Puzzle & Platform'], ['Platformer', 'Platformer', 'Puzzle & Platform'],
  ['Precision Platformer', 'Precision Platformer', 'Puzzle & Platform'], ['Puzzle Platformer', 'Puzzle Platformer', 'Puzzle & Platform'],
  ['Metroidvania', 'Metroidvania', 'Puzzle & Platform'], ['Roguelike', 'Roguelike', 'Puzzle & Platform'],
  ['Roguelite', 'Roguelite', 'Puzzle & Platform'], ['Action Roguelike', 'Action Roguelike', 'Puzzle & Platform'],
  ['Hidden Object', 'Hidden Object', 'Puzzle & Platform'], ['Rhythm', 'Rhythm', 'Puzzle & Platform'],
  ['Story Rich', 'Story Rich', 'Story'], ['Choices Matter', 'Choices Matter', 'Story'], ['Multiple Endings', 'Multiple Endings', 'Story'],
  ['Visual Novel', 'Visual Novel', 'Story'], ['Interactive Fiction', 'Interactive Fiction', 'Story'],
  ['Walking Simulator', 'Walking Simulator', 'Story'], ['Point & Click', 'Point & Click', 'Story'], ['Detective', 'Detective', 'Story'],
  ['Mystery', 'Mystery', 'Story'], ['Dating Sim', 'Dating Sim', 'Story'], ['Comedy', 'Comedy', 'Story'], ['Emotional', 'Emotional', 'Story'],
  ['Sci-fi', 'Sci-Fi', 'Setting'], ['Fantasy', 'Fantasy', 'Setting'], ['Dark Fantasy', 'Dark Fantasy', 'Setting'],
  ['Cyberpunk', 'Cyberpunk', 'Setting'], ['Steampunk', 'Steampunk', 'Setting'], ['Post-apocalyptic', 'Post-Apocalyptic', 'Setting'],
  ['Medieval', 'Medieval', 'Setting'], ['Western', 'Western', 'Setting'], ['Space', 'Space', 'Setting'], ['Pirates', 'Pirates', 'Setting'],
  ['Mythology', 'Mythology', 'Setting'], ['Historical', 'Historical', 'Setting'], ['War', 'War', 'Setting'],
  ['World War II', 'World War II', 'Setting'], ['Military', 'Military', 'Setting'], ['Superhero', 'Superhero', 'Setting'],
  ['Anime', 'Anime', 'Style'], ['Pixel Graphics', 'Pixel Art', 'Style'], ['Cute', 'Cute', 'Style'], ['Relaxing', 'Relaxing', 'Style'],
  ['Cozy', 'Cozy', 'Style'], ['Difficult', 'Difficult', 'Style'], ['Atmospheric', 'Atmospheric', 'Style'], ['Indie', 'Indie', 'Style'],
  ['Retro', 'Retro', 'Style'], ['Hand-drawn', 'Hand-Drawn', 'Style'], ['Short', 'Short', 'Style'],
  ['Online Co-Op', 'Co-op', 'Players'], ['Co-op', 'Co-op', 'Players'], ['Local Co-Op', 'Couch Co-op', 'Players'],
  ['PvP', 'PvP', 'Players'], ['Multiplayer', 'Multiplayer', 'Players'], ['Massively Multiplayer', 'MMO', 'Players'],
  ['Free to Play', 'Free to Play', 'Players'], ['VR', 'VR', 'Players'], ['Early Access', 'Early Access', 'Players'],
];
const GAME_BY_STEAM = new Map(GAME_TAGS.map(([steam, name]) => [steam, name]));

/** Steam's tags (most-voted first) -> the ones the site offers, up to `max`. */
export function gameTags(steamTags, max = 14) {
  const out = [];
  for (const t of (steamTags || []).slice(0, 24)) {
    const name = GAME_BY_STEAM.get(t);
    if (name && !out.includes(name)) out.push(name);
    if (out.length >= max) break;
  }
  return out;
}

/* ----------------------------------------------------------------- books */

export const BOOK_GROUPS = ['Fantasy', 'Science Fiction', 'Mystery & Crime', 'Horror', 'Romance', 'Literary & Classics',
  'Young Readers', 'Nonfiction', 'Style & Form'];

// Shelf genres (the coarse list books are filed under) from Goodreads shelves.
export const BOOK_GENRES = [
  ['Graphic Novels', /^(graphic novels|comics|comic book)$/i],
  ['Manga & Comics', /^manga$/i],
  ['Children & Middle Grade', /^(childrens|middle grade|picture books|kids)$/i],
  ['Young Adult', /^young adult$/i],
  ['Horror', /^horror$/i],
  ['Science Fiction', /^science fiction$/i],
  ['Fantasy', /^fantasy$/i],
  ['Romance', /^romance$/i],
  ['Crime & Detective', /^(crime|detective|true crime)$/i],
  ['Mystery & Thriller', /^(mystery|thriller|suspense|mystery thriller)$/i],
  ['Historical Fiction', /^historical fiction$/i],
  ['Poetry & Essays', /^(poetry|essays)$/i],
  ['Memoir & Biography', /^(memoir|biography|autobiography|biography memoir)$/i],
  ['History & Politics', /^(history|politics|world history|american history)$/i],
  ['Science & Nature', /^(science|nature|biology|physics|popular science|astronomy)$/i],
  ['Philosophy & Psychology', /^(philosophy|psychology)$/i],
  ['Business & Self-Help', /^(self help|business|personal development|productivity|leadership|economics)$/i],
  ['Health & Wellbeing', /^(health|nutrition|mental health|fitness)$/i],
  ['Travel & Food', /^(travel|food|cooking|cookbooks)$/i],
  ['Art, Music & Film', /^(art|music|film|photography)$/i],
  ['Classics', /^classics$/i],
  ['Literary Fiction', /^(literary fiction|contemporary)$/i],
];

// [tag, group, Goodreads shelf pattern, Open Library subject pattern or null]
export const BOOK_TAGS = [
  ['Epic Fantasy', 'Fantasy', /^(epic fantasy|high fantasy)$/i, /high fantasy|epic fantasy/i],
  ['Urban Fantasy', 'Fantasy', /^urban fantasy$/i, /urban fantasy/i],
  ['Dark Fantasy', 'Fantasy', /^dark fantasy$/i, null],
  ['Romantasy', 'Fantasy', /^romantasy$/i, null],
  ['Magic', 'Fantasy', /^magic$/i, null],
  ['Dragons', 'Fantasy', /^dragons$/i, null],
  ['Fairy Tales & Retellings', 'Fantasy', /^(fairy tales|retellings)$/i, /fairy tales/i],
  ['Mythology', 'Fantasy', /^mythology$/i, /mythology/i],
  ['Paranormal', 'Fantasy', /^(paranormal|supernatural)$/i, null],
  ['Vampires', 'Fantasy', /^vampires$/i, null],
  ['Witches', 'Fantasy', /^witches$/i, null],
  ['Dystopian', 'Science Fiction', /^dystopia$/i, /dystopias?$/i],
  ['Post-Apocalyptic', 'Science Fiction', /^post apocalyptic$/i, /post-apocalyptic|end of the world/i],
  ['Space Opera', 'Science Fiction', /^space opera$/i, /space opera/i],
  ['Cyberpunk', 'Science Fiction', /^cyberpunk$/i, /cyberpunk/i],
  ['Time Travel', 'Science Fiction', /^time travel$/i, /time travel/i],
  ['Aliens', 'Science Fiction', /^aliens$/i, null],
  ['Hard Sci-Fi', 'Science Fiction', /^hard science fiction$/i, null],
  ['Military Sci-Fi', 'Science Fiction', /^military science fiction$/i, null],
  ['Steampunk', 'Science Fiction', /^steampunk$/i, /steampunk/i],
  ['Psychological Thriller', 'Mystery & Crime', /^psychological thriller$/i, null],
  ['Detective', 'Mystery & Crime', /^(detective|police)$/i, /detective and mystery/i],
  ['Cozy Mystery', 'Mystery & Crime', /^cozy mystery$/i, null],
  ['Spy', 'Mystery & Crime', /^(spy thriller|espionage)$/i, /spy stories|espionage/i],
  ['Legal Thriller', 'Mystery & Crime', /^legal thriller$/i, null],
  ['True Crime', 'Mystery & Crime', /^true crime$/i, null],
  ['Noir', 'Mystery & Crime', /^noir$/i, null],
  ['Gothic', 'Horror', /^gothic$/i, /gothic/i],
  ['Ghosts', 'Horror', /^ghosts$/i, /ghost stories/i],
  ['Zombies', 'Horror', /^zombies$/i, null],
  ['Historical Romance', 'Romance', /^historical romance$/i, null],
  ['Contemporary Romance', 'Romance', /^contemporary romance$/i, null],
  ['Paranormal Romance', 'Romance', /^paranormal romance$/i, null],
  ['Romantic Comedy', 'Romance', /^romantic comedy$/i, null],
  ['Erotica', 'Romance', /^erotica$/i, null],
  ['LGBTQ', 'Romance', /^(lgbt|queer|gay|lesbian)$/i, null],
  ['Coming of Age', 'Literary & Classics', /^coming of age$/i, /coming of age/i],
  ['Magical Realism', 'Literary & Classics', /^magical realism$/i, /magic realism|magical realism/i],
  ['Family Saga', 'Literary & Classics', /^family$/i, null],
  ['War', 'Literary & Classics', /^(war|world war ii|military fiction)$/i, /world war, 1939-1945/i],
  ['Holocaust', 'Literary & Classics', /^holocaust$/i, /holocaust/i],
  ['Humor & Satire', 'Literary & Classics', /^(humor|satire|comedy)$/i, /humorous|satire/i],
  ['Literary Fiction', 'Literary & Classics', /^literary fiction$/i, null],
  ['Picture Books', 'Young Readers', /^picture books$/i, null],
  ['Middle Grade', 'Young Readers', /^middle grade$/i, null],
  ['Teen', 'Young Readers', /^(young adult|teen)$/i, null],
  ['Self-Help', 'Nonfiction', /^(self help|personal development)$/i, null],
  ['Psychology', 'Nonfiction', /^psychology$/i, null],
  ['Philosophy', 'Nonfiction', /^philosophy$/i, null],
  ['Economics', 'Nonfiction', /^economics$/i, null],
  ['Politics', 'Nonfiction', /^politics$/i, null],
  ['Spirituality', 'Nonfiction', /^(spirituality|religion|christian|faith)$/i, null],
  ['Feminism', 'Nonfiction', /^feminism$/i, null],
  ['Race', 'Nonfiction', /^race$/i, null],
  ['Science', 'Nonfiction', /^(science|popular science|physics|biology)$/i, null],
  ['Food Writing', 'Nonfiction', /^(food|food writing)$/i, null],
  ['Short Stories', 'Style & Form', /^short stories$/i, /short stories/i],
  ['Essays', 'Style & Form', /^essays$/i, null],
  ['Poetry', 'Style & Form', /^poetry$/i, null],
].filter(([, , gr, ol]) => gr || ol);

/** Shelf genres for a book: from Goodreads shelves when there are any. */
export function bookGenres(goodreadsShelves, fallback, max = 3) {
  const out = [];
  for (const s of goodreadsShelves || []) {
    for (const [g, re] of BOOK_GENRES) if (re.test(s) && !out.includes(g)) out.push(g);
    if (out.length >= max) break;
  }
  return out.length ? out : fallback;
}

/** Subgenre tags for a book: Goodreads shelves first, high-precision subjects otherwise. */
export function bookTags(goodreadsShelves, olSubjects) {
  const out = [];
  const shelves = goodreadsShelves || [];
  for (const [tag, , gr, ol] of BOOK_TAGS) {
    if (shelves.length ? gr && shelves.some((s) => gr.test(s)) : ol && (olSubjects || []).some((s) => ol.test(s))) out.push(tag);
  }
  return out;
}

/* ------------------------------------------------------------- the picker */

/** What the page needs to group tags: { kind: [[group, [tags...]], ...] }. */
export function clientTaxonomy() {
  const group = (groups, rows) => groups.map((g) => [g, [...new Set(rows.filter((r) => r[1] === g).map((r) => r[0]))]]);
  return {
    movies: group(SCREEN_GROUPS, SCREEN_TAGS),
    shows: group(SCREEN_GROUPS, SCREEN_TAGS),
    games: group(GAME_GROUPS, GAME_TAGS.map(([, name, g]) => [name, g])),
    books: group(BOOK_GROUPS, BOOK_TAGS),
  };
}
