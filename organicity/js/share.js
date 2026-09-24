// Organicity — sharing cities: a save compressed into a link fragment or a file.
// Links carry the whole city after '#city=', so nothing is uploaded anywhere.
const b64url = (bytes) => { let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000)); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); };
const unb64url = (str) => { const s = atob(str.replace(/-/g, '+').replace(/_/g, '/')); const out = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i); return out; };

async function pipe(bytes, stream) { return new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(stream)).arrayBuffer()); }

export async function encodeSave(save) {
  const raw = new TextEncoder().encode(JSON.stringify(save));
  return b64url(await pipe(raw, new CompressionStream('gzip')));
}
export async function decodeSave(text) {
  const bytes = await pipe(unb64url(text.trim()), new DecompressionStream('gzip'));
  return JSON.parse(new TextDecoder().decode(bytes));
}
// accepts a full link, a bare '#city=…' fragment, the encoded text itself, or a plain JSON save
export async function readShared(input) {
  const t = String(input).trim();
  if (t.startsWith('{')) return JSON.parse(t);
  const m = t.match(/#city=([A-Za-z0-9_-]+)/);
  return decodeSave(m ? m[1] : t);
}
export function shareLink(code) { return `${location.origin}${location.pathname}#city=${code}`; }
export function download(name, data, type = 'text/plain') {
  const url = typeof data === 'string' && data.startsWith('data:') ? data : URL.createObjectURL(new Blob([data], { type }));
  const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  if (!url.startsWith('data:')) setTimeout(() => URL.revokeObjectURL(url), 2000);
}
