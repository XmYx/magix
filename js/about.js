// js/terminal.js

// Text blocks: About, Poem, Kindness Generator
const aboutText = `( hit any key or press any key to skip this typing… )
Hi, I’m Miklós, a multidisciplinary creative who loves fusing art and code.

Playing and developing LTX Video whenever I can,
as I feel like the approach is what's closest to the most optimal ai video related model kit
thus far, and there is a tremendous amount of potential in both the company and community.

Over the past decade I’ve hopped between
film sets, street photography,
development and ai art, always learning.

I believe in open knowledge, good coffee, and the power of a well-timed
somewhat witty but PC joke. When I’m not pushing pixels
you’ll find me with my friends, shooting with a camera
that captures moments or creates them,
engages or disturbs anyone,
aims to effect in a way,
playing with my doggos,
working on a car,
thinking,
being.

Thank you,

for your attention,

Last but not least, I'd like to Thank All the people
that have already helped me along this journey,
and the ones remain to be met, without you all,
existence is merely a bad dream to be awaken from,
while co-existence in peace is a fairy tale coming true.`.trim();

const poemText = `a void pulses in my skull, a silent signal
broadcast only to phantom receivers—
the ones whose nodes have gone dark,
their comm-links severed by time’s cold firewall.
Even if I injected my data-stream,
no code would decrypt the tremor I’d send.

I drift in neon fog, wires buzzing beneath slick asphalt,
a lone avatar straining against gravity’s grip—
voice suppressed by corporate drones overhead,
heart stubbornly thrumming like a rogue generator.
I’m both ghost and glitch: bold in the breach,
yet shivering behind my own circuitry.

Still, I’m flesh among metal husks,
grounded in concrete and rust,
just another human anomaly
in the endless city grid.`.trim();

const helpText = `✨ magixal console spells ✨

about   — summon the chronicles of Miklós
poems   — invoke verses from the neon grid
kind    — generate a spark of kindness
sparkle — let the console shine bright
cls     — clear the terminal
help    — display this arcane guide
`;

// Kindness generator fragments (expanded with deeper wisdom and positivity)
const kindnessIntros = [
  "✨ Here's a thought:",
  "💡 Gentle reminder:",
  "🌱 Seed of kindness:",
  "🤖 Friendly glitch:",
  "🎈 Tiny miracle:",
  "🔮 Quantum kindness:",
  "🌌 Cosmic insight:",
  "🌿 Whisper of warmth:",
];

const kindnessBodies = [
  "Kindness is a language the deaf can hear and the blind can see. — Mark Twain",
  "In a world where you can be anything, be kind.",
  "Carry out a random act of kindness, with no expectation of reward.",
  "No act of kindness, no matter how small, is ever wasted. — Aesop",
  "Be the reason someone believes in the goodness of people.",
  "The quieter you become, the more you can hear. — Rumi",
  "Life is the dancer and you are the dance. — Eckhart Tolle",
  "Peace begins with a smile. — Mother Teresa",
  "The wound is the place where the light enters you. — Rumi",
  "Act as if what you do makes a difference. — William James",
  "Clarity fuels intention—see your goal as if it’s already real.",
  "Define what you truly want; ambiguity dims the path.",
  "A clear mind is the compass to your desired destination.",
  "Belief charges the vision—trust that the unseen is on its way.",
  "Your conviction today scripts tomorrow’s reality.",
  "Doubt dilutes power; faith magnifies it.",
  "Feel the joy of arrival now; emotions magnetize experience.",
  "Emotion is the engine; fuel it with gratitude and reverence.",
  "Align your vibration with the outcome you seek.",
  "Inspired action bridges thought and manifestation.",
  "Each small step is a gesture to the universe—move with purpose.",
  "Commit to doing, even when the path feels uncertain.",
];

const kindnessExtras = [
  "P.S. A smile is the best code comment you can leave today.",
  "P.P.S. Coffee + kindness = unstoppable combo.",
  "Tip: Debug negativity with a dose of compassion.",
  "Fun fact: Kindness is contagious—spread it around.",
  "Bonus: Your next kind act could reboot someone’s day.",
  "P.P.P.S. You are exactly where you need to be.",
  "Remember: every breath is a fresh start.",
  "Embrace the impermanence of all things.",
  "Let go of expecting things and find peace.",
  "Your presence is a present to the world.",
];

const sparkleArt = `
    ✨ ✨ ✨
  ✨   ✨   ✨
✨  Keep  ✨  Shining ✨
  ✨   ✨   ✨
    ✨ ✨ ✨
`.trim();

// Only aboutText is typed on load; poem appears only when 'poems' is invoked
const texts = [aboutText];

/**
 * Initialize the terminal typing effect and interactive prompt.
 */
export function initTerminal() {
  const term = document.getElementById('terminal');
  if (!term) return;
  term.style.whiteSpace = 'pre-wrap';

  const speed = 22;
  let charIndex = 0;
  let isTyping = true;
  let timeoutId = null;

  const addCursor = () => term.classList.add('cursor');
  const removeCursor = () => term.classList.remove('cursor');

  function printNext() {
    if (!isTyping) return;
    const slice = texts[0].slice(0, charIndex + 1);
    term.innerHTML = slice.replace(/\n/g, '<br>');
    charIndex++;
    if (charIndex < texts[0].length) {
      timeoutId = setTimeout(printNext, speed);
    } else {
      finishTyping();
    }
  }

  function finishTyping() {
    removeCursor();
    isTyping = false;
    createPrompt();
  }

  function skipTyping() {
    clearTimeout(timeoutId);
    term.innerHTML = texts[0].replace(/\n/g, '<br>');
    finishTyping();
  }

  addCursor();
  printNext();
  window.addEventListener('keydown', skipTyping, { once: true });
  window.addEventListener('click', skipTyping, { once: true });

  // Builds a fresh prompt line at the bottom of the terminal
  function createPrompt() {
    // Remove any existing prompt wrappers
    const old = term.querySelector('.prompt');
    if (old) old.remove();

    const promptWrapper = document.createElement('div');
    promptWrapper.className = 'prompt';
    promptWrapper.innerHTML =
      `<span>(base) mix@magix:~/$</span> ` +
      `<span id="input" contenteditable="true" class="cursor" ` +
      `style="background:transparent;border:none;outline:none;padding:0;margin:0;"></span>`;
    term.appendChild(document.createElement('br'));
    term.appendChild(promptWrapper);

    const input = document.getElementById('input');
    input.focus();
    input.addEventListener('keydown', function(e) {
      if (e.key === 'Enter') {
        e.preventDefault();
        const cmd = e.target.textContent.trim().toLowerCase();
        e.target.textContent = '';
        runCommand(cmd);
      }
    });

    // Always scroll to bottom whenever the prompt is (re)created
    term.scrollTop = term.scrollHeight;
  }

  function runCommand(cmd) {
    const output = document.createElement('div');
    output.className = 'output';

    switch(cmd) {
      case 'about':
        output.innerHTML = aboutText.replace(/\n/g, '<br>');
        break;
      case 'poems':
        output.innerHTML = poemText.replace(/\n/g, '<br>');
        break;
      case 'help':
        output.innerHTML = helpText.replace(/\n/g, '<br>');
        break;
      case 'cls':
        term.innerHTML = '';
        isTyping = false;  // prevent retyping
        return createPrompt();
      case 'kind':
        output.innerHTML = generateKindness().replace(/\n/g, '<br>');
        break;
      case 'sparkle':
        output.textContent = sparkleArt;
        break;
      default:
        output.textContent = `command not found: ${cmd}`;
    }

    term.appendChild(document.createElement('br'));
    term.appendChild(output);
    // After adding output, rebuild the prompt at the new bottom
    createPrompt();
  }

  function generateKindness() {
    const intro = kindnessIntros[Math.floor(Math.random() * kindnessIntros.length)];
    const body = kindnessBodies[Math.floor(Math.random() * kindnessBodies.length)];
    const extra = Math.random() < 0.5
      ? `\n${kindnessExtras[Math.floor(Math.random() * kindnessExtras.length)]}`
      : '';
    return `${intro}\n${body}${extra}`;
  }
}
