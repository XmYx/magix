/* ----------------------------------------------------------------------------
 * docbrowser.js — self-populating Documentation explorer
 *
 * ✨ 2025-05-27  —  Magic-flavoured revision
 *     • Properly distinguishes between “load a new document” and
 *       “jump to an in-page anchor”, so #heading links work again.
 *     • Supports deep-linking to headings in other docs using either
 *       “#path/to/file.md::anchor”  or  “#path/to/file.md#anchor” syntax.
 *     • Adds smooth scrolling, robust ID escaping and tiny quality-of-life
 *       touches sprinkled all around ✨.
 *
 * ---------------------------------------------------------------------------*/

const DEFAULT_BRANCH = 'main';
const API_BASE       = 'https://api.github.com';
const RAW_BASE       = 'https://raw.githubusercontent.com';

export async function initDocsBrowser (opts = {}) {
  const { owner, repo } = opts.owner && opts.repo
    ? opts
    : deriveRepoFromLocation();

  const branch = opts.branch || DEFAULT_BRANCH;

  /* ------------------------------------------------------------------ */
  /*  1.  Discover every *.md file under /docs using the GitHub API     */
  /* ------------------------------------------------------------------ */
  const mdPaths = await fetchDocsList(owner, repo, branch);
  if (!mdPaths.length) {
    document.getElementById('docContent').innerHTML =
      `<p class="text-red-600">Unable to locate any documentation under <code>/docs/</code>.</p>`;
    return;
  }

  /* ------------------------------------------------------------------ */
  /*  2.  Build a nested (category / sub-category) tree                 */
  /* ------------------------------------------------------------------ */
  const tree = buildTree(mdPaths);               // → plain object
  document.getElementById('docSidebar').innerHTML = renderTree(tree); // → HTML

  /* ------------------------------------------------------------------ */
  /*  3.  Wire-up navigation & deep-linking (#path/to/file.md)          */
  /* ------------------------------------------------------------------ */
  const sidebar      = document.getElementById('docSidebar');
  const content      = document.getElementById('docContent');
  let   currentDoc   = '';

  /* -- Utilities ------------------------------------------------------ */
  const scrollToAnchor = anchor => {
    if (!anchor) return;
    // wait for next tick so Prism/DOM have finished
    requestAnimationFrame(() => {
      const el = content.querySelector(`#${CSS.escape(anchor)}`);
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  };

  /**
   * Split the raw hash (no leading ‘#’) into { path?, anchor? }.
   * Supports:
   *   #onlyHeading               →  { anchor:"onlyHeading" }
   *   #file.md                   →  { path:"file.md" }
   *   #folder/file.md#heading    →  { path:"folder/file.md", anchor:"heading" }
   *   #folder/file.md::heading   →  { path:"folder/file.md", anchor:"heading" }
   */
  const parseHash = raw => {
    if (!raw) return { };
    const decoded = decodeURIComponent(raw);
    // new double-colon syntax takes precedence
    const dbl = decoded.indexOf('::');
    if (dbl !== -1) return { path: decoded.slice(0, dbl), anchor: decoded.slice(dbl + 2) };
    // classic file.md#anchor syntax
    const hash = decoded.indexOf('#');
    if (hash !== -1 && /\.md/i.test(decoded.slice(0, hash)))
      return { path: decoded.slice(0, hash), anchor: decoded.slice(hash + 1) };
    // plain file or plain anchor
    return /\.md$/i.test(decoded) || decoded.includes('/')
      ? { path: decoded }
      : { anchor: decoded };
  };

  const highlightActiveLink = path => {
    sidebar.querySelectorAll('a.doc-link')
      .forEach(a => a.classList.toggle('font-semibold', a.hash.slice(1) === path));
  };

  /* Open <details> ancestors so the active file is visible */
  const openParents = path => {
    if (!path) return;
    const parts = path.split('/');
    let acc = '';
    for (let i = 0; i < parts.length - 1; i++) {
      acc += (i ? '/' : '') + parts[i];
      const dt = sidebar.querySelector(`details[data-path="${acc}"]`);
      if (dt) dt.open = true;
    }
  };

  /* --------------------------------------------------------------- */
  /*  Event wires                                                    */
  /* --------------------------------------------------------------- */
  sidebar.addEventListener('click', e => {
    const a = e.target.closest('a.doc-link');
    if (!a) return;
    e.preventDefault();
    const path = a.getAttribute('href').slice(1);   // strip leading '#'
    if (location.hash.slice(1) !== path) location.hash = path; // triggers hashchange
    else handleHash();                              // same hash → manual handle
  });

  window.addEventListener('hashchange', handleHash);
  handleHash(); // initial load ✨

  /* --------------------------------------------------------------- */
  /*  Core hash-handling logic                                       */
  /* --------------------------------------------------------------- */
  async function handleHash () {
    const { path, anchor } = parseHash(location.hash.slice(1));

    // Scenario 1: anchor-only change inside the *current* doc
    if (!path && anchor) {
      scrollToAnchor(anchor);
      return;
    }

    // Scenario 2: path change (new doc) — load it, *then* jump to anchor
    const targetPath = path || pickDefaultDoc(mdPaths);
    if (!targetPath) return;

    if (targetPath !== currentDoc) {
      await loadDoc(targetPath);
    }
    if (anchor) scrollToAnchor(anchor);

    highlightActiveLink(targetPath);
    openParents(targetPath);
  }

  /* --------------------------------------------------------------- */
  /*  Fetch + render a single Markdown file                          */
  /* --------------------------------------------------------------- */
  async function loadDoc (relPath) {
    currentDoc          = relPath; // remember current doc
    content.innerHTML   = '<p class="italic text-gray-500">Loading…</p>';
    try {
      const url  = `${RAW_BASE}/${owner}/${repo}/${branch}/docs/${relPath}`;
      const resp = await fetch(url, { cache: 'no-cache' });
      if (!resp.ok) throw new Error(`${resp.status} ${resp.statusText}`);
      const md   = await resp.text();
      content.innerHTML = marked.parse(md, { mangle:false, headerIds:false });
      if (window.Prism) Prism.highlightAll();
      content.scrollTo({ top: 0 });
    } catch (err) {
      content.innerHTML = `<p class="text-red-600">Error loading <code>${relPath}</code>: ${err.message}</p>`;
    }
  }
}

/* ---------------------------------------------------------------------- */
/*  Derive owner/repo from https://user.github.io/repo/…                  */
/* ---------------------------------------------------------------------- */
function deriveRepoFromLocation () {
  const hostUser = location.hostname.replace('.github.io', '');
  const segs     = location.pathname.split('/').filter(Boolean);
  return { owner: hostUser, repo: segs[0] || hostUser }; // root pages repo → user repo
}

/* ---------------------------------------------------------------------- */
/*  Call the git trees API (recursive=1) to fetch the full file list      */
/* ---------------------------------------------------------------------- */
async function fetchDocsList (owner, repo, branch) {
  try {
    const api   = `${API_BASE}/repos/${owner}/${repo}/git/trees/${branch}?recursive=1`;
    const resp  = await fetch(api, { headers: { Accept: 'application/vnd.github+json' } });
    if (!resp.ok) throw new Error('GitHub API error');
    const json  = await resp.json();
    return json.tree
      .filter(i => i.type === 'blob' && i.path.startsWith('docs/') && /\.md$/i.test(i.path))
      .map(i => i.path.slice(5));                     // strip leading "docs/"
  } catch (_) {
    /* Fallback: crawl the deployed /docs/ folder via a plain directory
       listing (works in local dev / Netlify…)                                   */
    try {
      const res  = await fetch('docs/', { method:'GET' });
      if (!res.ok) return [];
      const html = await res.text();
      return [...html.matchAll(/href="([^\"]+\.md)"/gi)].map(m => m[1]);
    } catch { return []; }
  }
}

/* ---------------------------------------------------------------------- */
/*  Convert a flat list of paths → nested object                          */
/* ---------------------------------------------------------------------- */
function buildTree (paths) {
  const root = {};
  for (const p of paths) {
    const parts = p.split('/');
    let node = root;
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      if (i === parts.length - 1) {
        (node.files ||= []).push({ name: part, path: p });
      } else {
        node.dirs ||= {};
        node = node.dirs[part] ||= {};
      }
    }
  }
  return root;
}

/* ---------------------------------------------------------------------- */
/*  Render nested <ul> / <li> / <details> structure                       */
/* ---------------------------------------------------------------------- */
function renderTree (node, accPath = '') {
  let html = '<ul class="pl-4">';
  if (node.dirs) {
    for (const dir of Object.keys(node.dirs).sort()) {
      const path   = accPath ? `${accPath}/${dir}` : dir;
      html += `<li>
        <details data-path="${path}">
          <summary class="cursor-pointer select-none">${dir}</summary>
          ${renderTree(node.dirs[dir], path)}
        </details>
      </li>`;
    }
  }
  if (node.files) {
    for (const f of node.files.sort((a, b) => a.name.localeCompare(b.name))) {
      const label = f.name.replace(/\.md$/i, '').replace(/[_-]/g, ' ');
      html += `<li>
        <a href="#${f.path}" class="doc-link block py-0.5 hover:text-indigo-600">${label}</a>
      </li>`;
    }
  }
  return html + '</ul>';
}

/* ---------------------------------------------------------------------- */
/*  Pick sensible default (README.md > first file)                        */
/* ---------------------------------------------------------------------- */
function pickDefaultDoc (paths) {
  const readme = paths.find(p => /\/??readme\.md$/i.test(p));
  return readme || paths[0];
}
