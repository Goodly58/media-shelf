/* Tests the real matching code, not a copy of it: the folding/scoring block is
   sliced straight out of _fetch_steam_missing.mjs and imported as a module, so
   this cannot drift from what the fetch pass actually ran. Reads only. */
import fs from 'node:fs';

const src = fs.readFileSync('_fetch_steam_missing.mjs', 'utf8');
const from = src.indexOf('const ENTITIES = {');
const to = src.indexOf('/* ------------------------------------------------------------------- cache */');
if (from < 0 || to < 0 || to < from) throw new Error('could not slice the matching block');
const block = src.slice(from, to) + '\nexport { score, strict, loose, numbersAgree, isJunk, nameYear };\n';
const mod = await import('data:text/javascript;base64,' + Buffer.from(block).toString('base64'));
const { score, isJunk, nameYear, loose } = mod;

let fail = 0;
const check = (label, got, want) => {
  const ok = typeof want === 'function' ? want(got) : got === want;
  if (!ok) { fail++; console.log(`  FAIL  ${label}\n        got ${JSON.stringify(got)}`); }
  else console.log(`  ok    ${label}  (${JSON.stringify(got)})`);
};

console.log('\nMUST MATCH — the same game written differently');
check('Mass Effect 3 = ME3 N7 Digital Deluxe Edition (2012)',
  score('Mass Effect 3', 'Mass Effect™ 3 N7 Digital Deluxe Edition (2012)'), (s) => s >= 84);
check("Assassin's Creed II = Assassin's Creed 2",
  score("Assassin's Creed II", "Assassin's Creed 2"), 100);
check('Schrodinger\'s Call = Schrödinger\'s Call',
  score("Schrodinger's Call", 'Schrödinger\'s Call'), 100);
check('Overwatch = Overwatch®', score('Overwatch', 'Overwatch®'), 100);
check('Preludes &amp; Nocturnes = Preludes & Nocturnes (entities decoded)',
  score('Preludes &amp; Nocturnes', 'Preludes & Nocturnes'), 100);
check('FF Tactics: The Ivalice Chronicles = FINAL FANTASY TACTICS - The Ivalice Chronicles',
  score('Final Fantasy Tactics: The Ivalice Chronicles', 'FINAL FANTASY TACTICS - The Ivalice Chronicles'), (s) => s >= 95);
check('Metal Gear Solid Delta = METAL GEAR SOLID Δ (Greek letter as a word)',
  score('Metal Gear Solid Delta: Snake Eater', 'METAL GEAR SOLID Δ: SNAKE EATER'), 100);

console.log('\nMUST NOT MATCH — different games the guards have to keep apart');
check('PGA TOUR 2K23 != PGA TOUR 2K25 (welded digits contradict)',
  score('PGA TOUR 2K23', 'PGA TOUR 2K25'), (s) => s < 78);
check('Tomb Raider != Tomb Raider I-III Remastered',
  score('Tomb Raider', 'Tomb Raider I-III Remastered'), (s) => s < 78);
check('The Room != The Room Two', score('The Room', 'The Room Two'), (s) => s < 78);
check('DOOM != DOOM Eternal', score('DOOM', 'DOOM Eternal'), (s) => s < 78);
check('Half-Life 2 != Half-Life 2: Episode One',
  score('Half-Life 2', 'Half-Life 2: Episode One'), (s) => s < 78);
check('Mass Effect 3 != Mass Effect 2', score('Mass Effect 3', 'Mass Effect 2'), (s) => s < 78);
check('Diablo III != Diablo IV', score('Diablo III', 'Diablo IV'), (s) => s < 78);
check('Overwatch != Overwatch 2', score('Overwatch', 'Overwatch® 2'), (s) => s < 78);

/* Containment scores in the 78-94 band are ambiguous by nature, so the ladder
   separates them on WHERE the extra words sit rather than on the score. These
   assert that rule directly, because it is what decides medium (applied) from
   low (reported for a human). */
console.log('\nCONTAINMENT — leading extras are a different game, trailing ones are branding');
const trailing = (title, name) => loose(name).startsWith(loose(title));
check('Grisaia: Phantom Trigger is a LEADING extra -> capped at low',
  trailing('Phantom Trigger', 'Grisaia: Phantom Trigger'), false);
check('BIT.TRIP Presents... Runner2 is a LEADING extra -> capped at low',
  trailing('Runner2', 'BIT.TRIP Presents... Runner2: Future Legend of Rhythm Alien'), false);
check('ME3 N7 Digital Deluxe is a TRAILING extra -> may reach medium',
  trailing('Mass Effect 3', 'Mass Effect™ 3 N7 Digital Deluxe Edition (2012)'), true);

console.log('\nJUNK — franchise name, not the game');
check('HITMAN 3 - Deluxe Pack is junk for Hitman 3', isJunk('Hitman 3', 'HITMAN 3 - Deluxe Pack'), true);
check('Portal 2 Soundtrack is junk for Portal 2', isJunk('Portal 2', 'Portal 2 Soundtrack'), true);
check('Half-Life 2 Demo is junk for Half-Life 2', isJunk('Half-Life 2', 'Half-Life 2 Demo'), true);
check('Payday 2 is NOT junk for Payday 2', isJunk('Payday 2', 'PAYDAY 2'), false);
check('a title that itself says Collection is not junk',
  isJunk('The Orange Box Collection', 'The Orange Box Collection'), false);

console.log('\nYEAR IN THE SEARCH NAME');
check('nameYear reads (2012)', nameYear('Mass Effect™ 3 N7 Digital Deluxe Edition (2012)'), 2012);
check('nameYear is null when absent', nameYear('Overwatch®'), null);
check('nameYear does not eat a real number', nameYear('Portal 2'), null);

console.log(fail ? `\n${fail} FAILURES` : '\nall assertions passed');
process.exit(fail ? 1 : 0);
