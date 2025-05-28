// js/terminal.js

// Text blocks: About, Poem, Kindness Generator
const aboutText = `( hit any key or press any key to skip this typing… )
Hi, I’m Miklós—a multidisciplinary creative who sees no borders between code, camera, and consciousness.

For the past decade I’ve drifted (and sprinted) across film sets, city streets, neural nets, and late‑night coffee counters—always learning, always looking for that spark where technology and soul light each other up.

Current orbit

LTX Video – an ever‑evolving,
community‑driven model kit where human intuition and machine intelligence co‑manifest moving images. I tinker, test, and tune because I feel its approach is the closest we’ve come to an optimal AI‑video symbiosis.

Street & set photography – a camera that captures moments…
or conjures them,
that engages,
disturbs,
and (I hope) ultimately heals.

Guiding threads

Oneness & unity – Every pixel is part of the same canvas; every line of code, a lyric in the same song. I create to remember—and remind—that separation is the great illusion.
Awareness – Art is a tuning fork. What we give our attention to, we amplify.
Intention shapes perception – perception shapes reality. I aim to code and compose with clarity so reality has something clear to echo back.
Open knowledge – Ideas want to breathe. I share what I learn because progress accelerates in community—and because good coffee tastes better in company.

When I’m not pushing pixels
You’ll find me hanging with friends,
running with my doggos,
wrench‑deep in a project car,
or simply being—so
that the next burst of
creative energy arrives
on a welcome breeze.

Gratitude

To everyone who has nudged, questioned, mentored, and laughed with me: you make this dream lucid. To those I’ve yet to meet: can’t wait to co‑create.
May we keep weaving awareness, tuning reality with kindness, and scripting a universe where coexistence isn’t a fairy tale but the default scene.
Thank you for your attention—and for sharing the journey.

If you have read this long, allow me to share that there is a set intention for a large, scalable impact driven project, first in Budapest, well outlined, thought out, looking for benefactors/investors to achieve it, in case you are it, or you know him or her, please do contact me at magix@magixworld.com`.trim();



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
