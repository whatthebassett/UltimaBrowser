// The password generator and strength meter, like Bitwarden's. Loaded by the UI (<script>) for the generator and the
// vault, and by the main process (require) for the vault's weak-password filter, so both score passwords the same way.
//   generate(options) -> a password or passphrase from crypto-random numbers
//   strength(password) -> { score: 0–4, label, bits }, from the password's patterns (words, years, runs, repeats)
//   generatedBits(options) -> how strong the generator's choices make every password it gives
(function passwordGeneratorModule(root) {
  const cryptoApi = root.crypto || require('crypto').webcrypto;

  const SETS = {
    upper: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
    lower: 'abcdefghijklmnopqrstuvwxyz',
    digits: '0123456789',
    symbols: '!@#$%^&*',
  };
  const AMBIGUOUS = /[IlO01]/g;

  const DEFAULTS = {
    type: 'password', // or passphrase
    length: 16, upper: true, lower: true, digits: true, symbols: true, minDigits: 1, minSymbols: 1, avoidAmbiguous: false,
    words: 5, separator: '-', capitalize: true, number: true,
  };

  // A list of short, common, easy-to-type English words for passphrases.
  const WORDS = [...new Set(`
    able acid acorn actor adapt admit adobe adult agent agree ahead aisle alarm album alert algae alley allow almond alpha
    amber amble amuse angle ankle apart apple april apron arena argue armor army aroma arrow ashes aside atlas atom attic
    audio august aunt autumn avid award awake axis bacon badge bagel baker balmy bamboo banjo barn baron basil basin batch
    beach beacon beam bean beard beast beaver bench berry bike birch bison blade blank blaze blend bliss block bloom blue
    blunt blush board boast bonus booth boots bowl brain brass brave bread brick bride brief brisk broom brush bubble bucket
    buddy budget buffalo bugle build bulb bunch bundle bunny burst bushel butter button cabin cable cactus camel camera camp
    canal candle candy canoe canvas canyon cargo carol carpet carrot carton castle cattle cedar cello cereal chalk chant chapel
    charm chart cheek cheer cherry chess chest chili chimney chip chirp chorus cider cinema circle citrus civic claim clam
    clap clay clerk cliff climb clock cloth cloud clover coach coast cobalt cocoa coconut comet comic coral corner cosmic
    cotton couch cougar count cousin cover coyote crab craft crane crate crayon cream creek crest cricket crisp crow crown
    crumb crust cubic cupid curly curve cycle daisy dance dandy dawn decal decoy delta denim depot derby desert desk dial
    diary dice dinner disco dish ditto diver dizzy dock dodge dolphin donut doodle dove dozen draft dragon drama dream dress
    drift drill drink drum dryer duck dune dusk dust eager eagle early earth easel echo eclipse edge eight elbow elder elect
    elegy elk elm ember emblem empty enjoy entry envoy epic equal erase errand essay ethic evade even event exact exile exit
    extra fable fabric facet fairy faith falcon fancy fargo farm fault feast feather fence fern ferry fever fiber fiddle
    field fifty final finch flag flame flash flask fleet flint float flock flood flora flour flute focus foggy folk forest
    forge fork fossil fox frame fresh frost fruit fudge fuel furry future gadget galaxy gamer garage garden garlic gauge
    gecko gem genie geyser ghost giant ginger glad glass glide globe glove glow goat gold golf goose gopher gorge gospel
    grace grain grape graph grass gravy great green grid grill grin grove guard guess guide guitar gull gummy gust habit
    halo hammer hamster handy happy harbor harp harvest hatch haven hawk hazel heart hedge helmet hero heron hiker hill hippo
    hobby hockey holly honey hood hope horizon horn horse hotel hound house humor hunter husky hydra igloo image inch index
    indigo ink inlet input iris iron island ivory ivy jacket jade jaguar jam jasmine jazz jeans jelly jewel jigsaw jockey
    jolly journal judge juice jumbo jungle juniper jury karma kayak kebab kettle key kid kilt kind king kiosk kite kitten
    kiwi knack knee knight knot koala label ladder lagoon lake lamb lamp lance lantern laser latch lava lawn layer leaf
    lemon lens level lilac lily lime linen lion liquid lizard llama lobby lobster local locket lodge lofty logic lotus lucky
    lunar lunch lyric macro magic magnet maple marble march margin marina market marsh mason meadow medal melon memo mentor
    merit metal meteor metro midst mild mint mirror mocha model mango monkey moose morning mosaic moss motel motor mouse
    movie muffin mural museum music mustard myth nacho napkin narrow nation navy nectar needle neon nest nickel night ninja
    noble noodle north notch novel nugget nutmeg oasis oath ocean octave olive omega onion onyx opal opera orbit orchid organ
    otter outer oval owl oxygen oyster paddle pagoda palace palm panda panel panther paper parade parcel parrot pasta pastel
    patch path pearl pebble pecan pedal pelican penny pepper perch piano picnic pilot pinball pine pixel pizza plaid planet
    plank plaza plum plume poem poet polar pond pony poodle poppy porch potato powder prairie prism prize proud prune puffin
    pulse pumpkin puppet puppy purple puzzle pyramid quail quartz queen quest quick quiet quill quilt quiz rabbit raccoon
    radar radio raft rain raisin rally ranch range raven razor reef relay remedy rhino rhyme ribbon rice ridge rifle ring
    ripple river road robin robot rocket rodeo roost rose rotor round rover royal ruby rugby ruler rumba rustic saddle safari
    saga sail salad salmon salt salute sandal sauce savor scale scarf scenic scone scout seal season sector seed shadow
    shark shell sherpa shield shiny shore shrub sierra signal silk silver siren sketch skate skiing sky slate sled slope
    smile smoky snack snail snake sneeze snow soap soccer socket sofa solar solid sonic soup south spark sparrow spice
    spider spiral splash spoon sport spring sprout spruce squad squid stable stage stamp star statue steam steel stem stereo
    stone stool storm story stove straw stream street stripe studio sugar suit summit sunny sunset super surf swamp swan
    sweet swift swing sword symbol syrup table tablet taco talent tango tank tapir target tavern taxi teapot temple tennis
    tent thicket thistle thunder tiger timber toast toffee tomato topaz torch tower toy track tractor trail train tree
    trend tribe trophy trout truck trumpet tulip tundra tunnel turkey turtle tuxedo twig twin ultra umbrella uncle unicorn
    union unity urban valley vapor vase velvet venom venue vessel violet violin visor vista vivid vocal volcano voyage
    wafer wagon walnut walrus wander warmth wasabi water wave wealth weasel wheat whale wheel whisk willow window winter
    wisdom wizard wolf wombat wonder woods wool world yacht yard yarn yellow yeti yodel yogurt zebra zenith zero zesty zinc
    zipper zone zoom acre adore aerial agile alien alloy aloe amigo anchor animal anthem antler apex arcade arch arctic
    armada artist aspen aster astro avocado bakery ballad banana bandit banner barrel basket beetle bellow beret bingo
    biscuit blazer blimp blossom bobcat bonfire bongo bouquet boxer breeze bridge brook brownie bucket buffet bugle bumble
    burrow cabbage cadet cake calico calm camper candid capsule caramel cardinal caribou carnival cascade cashew catalog
    cavern celery cement census chamber channel chapter cheetah chef chestnut chime chipmunk chowder cinder citadel clarinet
    classic cobra cockpit coffee collar compass condor cookie copper cosmos costume cozy cradle crater credit crimson cruise
    crystal cubicle cupcake curtain cushion custom cymbal dagger dairy dazzle debut decade deluxe dentist depth dessert detail
    diamond diesel dingo dinosaur diploma divot domino doorway double dragonfly drawer dreamer duet dugout dynamo easy
    eclair eggplant elephant elevator elixir emerald empire enamel engine ermine escape espresso estate evening exhibit
    explorer express fajita fashion fiesta figure filter firefly flamingo flannel flicker florist flower fluffy flurry
    folio fondue footer fortune fountain fragrant freckle freeway frigate frisbee frosty gallop garnet gazebo gazelle
    gentle giraffe glacier gladiator glimmer glitter goblet goggles gondola gorilla gourmet granite grapefruit gravel
    griddle grizzly guppy gymnast hacienda halibut hallway hammock harmony hatchet hazelnut headband heater hedgehog
    helium herbal hermit hickory highway hilltop holiday homeland honeybee horizon hotdog hummus hurdle hyacinth iceberg
    icicle iguana impala inkwell insect instant ironing jackal jamboree javelin jellybean jetty jogger journey jubilee
    juggler jukebox kangaroo keeper kernel ketchup keyboard kindle kingdom kitchen knapsack ladybug lambda landmark
    lasagna lattice laundry lavender legend lemonade leopard library lighthouse limerick limousine lobster locomotive
    lollipop lullaby luggage lumber magenta magnolia mailbox mammoth mandolin mango manor mantis marathon marigold marmot
    mascot meadow meerkat melody mermaid midnight milkshake mindful minnow mitten moccasin modern monarch monsoon moonbeam
    mountain mustang napkin narwhal nautical nebula needle network newt nightowl nomad nutshell oatmeal observer ocelot
    octopus omelet orange orchard origami ostrich outback overall paisley pajamas pancake papaya paprika parade parsley
    passport peacock peanut pegasus penguin peppermint pharaoh pheasant phoenix piccolo pigeon pillow pinecone pinwheel
    pistachio planter platypus plaza polka popcorn porcupine postcard potion pretzel primrose propeller pudding pumice
    quarry quokka radish rainbow rattle recipe reindeer riddle roadster rooster rosemary rowboat runway saffron sailboat
    sandbox sapphire sardine satchel saturn sawmill scallop scarlet scooter seashell sequoia sherbet shipyard shortcake
    sitcom skyline snowball snowman soapbox sonnet souvenir spaniel speedboat spinach sprinkle squash starfish starlight
    stingray strudel sundae sunflower sunrise surfboard sweater tadpole tambourine tangerine tapestry teacup telescope
    terrace thimble thunder toboggan toucan treasure triangle trolley tugboat tumble turquoise twilight typhoon ukulele
    unicycle upbeat vanilla velcro veranda vintage voyager waffle walkway warbler waterfall weekend whistle wildcat
    windmill wishbone woodland workshop yearbook zeppelin zucchini
  `.split(/\s+/).filter((w) => /^[a-z]{3,10}$/.test(w)))];

  // the passwords people pick most, which are guessed first
  const COMMON = new Set(`password passw0rd qwerty qwertz azerty letmein welcome admin login master hello monkey dragon
    football baseball soccer hockey sunshine shadow superman batman iloveyou princess trustno1 abc123 starwars whatever
    freedom secret michael jordan charlie donald ashley jessica pokemon minecraft flower summer winter spring autumn
    computer internet google facebook cheese chocolate cookie banana orange purple master changeme default access pass
    test guest user root love lovely angel baby family friend forever money passport mustang killer ninja matrix`.split(/\s+/).filter(Boolean));

  const randomInt = (n) => {
    // without the bias of a plain modulo
    const limit = Math.floor(2 ** 32 / n) * n;
    const buf = new Uint32Array(1);
    do cryptoApi.getRandomValues(buf); while (buf[0] >= limit);
    return buf[0] % n;
  };
  const pick = (s) => s[randomInt(s.length)];
  const shuffle = (a) => { for (let i = a.length - 1; i > 0; i -= 1) { const j = randomInt(i + 1); [a[i], a[j]] = [a[j], a[i]]; } return a; };

  function options(o) {
    const x = { ...DEFAULTS, ...o };
    x.length = Math.max(5, Math.min(128, Math.round(Number(x.length)) || DEFAULTS.length));
    x.words = Math.max(3, Math.min(20, Math.round(Number(x.words)) || DEFAULTS.words));
    x.minDigits = Math.max(0, Math.min(9, Math.round(Number(x.minDigits)) || 0));
    x.minSymbols = Math.max(0, Math.min(9, Math.round(Number(x.minSymbols)) || 0));
    x.separator = String(x.separator ?? '-').slice(0, 3);
    if (!x.upper && !x.lower && !x.digits && !x.symbols) x.lower = true;
    return x;
  }

  const setOf = (name, o) => (o.avoidAmbiguous ? SETS[name].replace(AMBIGUOUS, '') : SETS[name]);

  function generate(opts) {
    const o = options(opts);
    if (o.type === 'passphrase') {
      const words = Array.from({ length: o.words }, () => pick(WORDS)).map((w) => (o.capitalize ? w[0].toUpperCase() + w.slice(1) : w));
      if (o.number) { const i = randomInt(words.length); words[i] += String(randomInt(10)); }
      return words.join(o.separator);
    }
    // at least one of each kind picked (and the minimum digits and symbols), the rest from all of them
    const on = ['upper', 'lower', 'digits', 'symbols'].filter((k) => o[k]);
    const chars = [];
    for (const k of on) {
      const at = k === 'digits' ? Math.max(1, o.minDigits) : k === 'symbols' ? Math.max(1, o.minSymbols) : 1;
      for (let i = 0; i < at && chars.length < o.length; i += 1) chars.push(pick(setOf(k, o)));
    }
    const all = on.map((k) => setOf(k, o)).join('');
    while (chars.length < o.length) chars.push(pick(all));
    return shuffle(chars).join('');
  }

  function generatedBits(opts) {
    const o = options(opts);
    if (o.type === 'passphrase') return o.words * Math.log2(WORDS.length) + (o.number ? Math.log2(10 * o.words) : 0);
    const pool = ['upper', 'lower', 'digits', 'symbols'].filter((k) => o[k]).reduce((n, k) => n + setOf(k, o).length, 0);
    return o.length * Math.log2(pool);
  }

  const LABELS = ['Very weak', 'Very weak', 'Weak', 'Good', 'Strong'];
  const scoreOf = (bits) => (bits < 28 ? 0 : bits < 36 ? 1 : bits < 50 ? 2 : bits < 64 ? 3 : 4);
  const rated = (bits) => ({ bits: Math.round(bits), score: scoreOf(bits), label: LABELS[scoreOf(bits)] });

  const KEYBOARD = 'qwertyuiopasdfghjklzxcvbnm1234567890';
  const ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';
  const LEET = { '@': 'a', 4: 'a', 3: 'e', 1: 'i', '!': 'i', 0: 'o', $: 's', 5: 's', 7: 't' };
  // a run of letters: a known word costs little, a keyboard or alphabet run or a repeat costs almost nothing
  function runBits(run) {
    const low = run.toLowerCase();
    const caps = run === low ? 0 : run[0] !== low[0] && run.slice(1) === low.slice(1) ? 1 : run.length;
    if (COMMON.has(low)) return 2 + caps;
    if (WORDS.includes(low) || /^(.)\1+$/.test(low) || (low.length >= 3 && (KEYBOARD.includes(low) || ALPHABET.includes(low)))) return Math.log2(WORDS.length) + caps;
    return low.length * Math.log2(caps ? 52 : 26);
  }

  function strength(password) {
    const pw = String(password || '');
    if (!pw) return { bits: 0, score: 0, label: '' };
    // the same password, with look-alike digits and symbols read as letters (P@ssw0rd)
    const plain = pw.replace(/[@4310!$57]/g, (c) => LEET[c]);
    if (COMMON.has(plain.toLowerCase().replace(/[^a-z]/g, ''))) return rated(Math.min(pw.length * 2, 16));
    let bits = 0;
    const symbols = new Set(); // the same symbol again (a passphrase's separator) adds next to nothing
    for (const part of pw.match(/[a-zA-Z]+|\d+|[^a-zA-Z\d]+/g)) {
      if (/^[a-zA-Z]/.test(part)) bits += runBits(part);
      else if (/^\d/.test(part)) {
        // years, repeats and counting (2024, 1111, 123) are among the first guesses
        if (/^(19|20)\d\d$/.test(part) || /^(\d)\1+$/.test(part) || '01234567890'.includes(part) || '9876543210'.includes(part)) bits += 6;
        else bits += part.length * Math.log2(10);
      } else if (symbols.has(part)) bits += 1;
      else { symbols.add(part); bits += /^(.)\1+$/.test(part) ? 5 : part.length * 5; }
    }
    // a password that's a known word or two with bits added on is only as strong as the words
    return rated(Math.min(bits, pw.length * Math.log2(95)));
  }

  const api = { DEFAULTS, WORDS, generate, generatedBits, strength, rated, options };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.PWGEN = api;
}(typeof window !== 'undefined' ? window : globalThis));
