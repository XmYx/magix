// Organicity — interface language. t(key) looks up the chosen language and falls back
// to English, then to the key itself; it covers the HUD, dock, menus, panel titles and the
// start screen. Texts built in code without a key are swapped by their English wording
// (phrases.js) as they appear, by watchDom. Arabic lays the page out right to left.
const KEY = 'organicity-lang';
import { PHRASES, PHRASE_LANGS } from './phrases.js';
export const LANGS = { en: 'English', hu: 'Magyar', de: 'Deutsch', fr: 'Français', es: 'Español', ar: 'العربية' };
export const RTL = new Set(['ar']);
const S = {
  en: {
    'hud.funds': 'Funds', 'hud.pop': 'Population', 'hud.jobs': 'Jobs', 'hud.date': 'Date', 'hud.idle': 'idle',
    'menu.undo': 'Undo', 'menu.world': 'World', 'menu.photo': 'Photo', 'menu.share': 'Share', 'menu.save': 'Save', 'menu.new': 'New', 'menu.help': 'Help',
    'cat.inspect': 'Inspect', 'cat.road': 'Roads', 'cat.zone': 'Zones', 'cat.util': 'Utilities', 'cat.svc': 'Services', 'cat.district': 'Districts', 'cat.lines': 'Transit',
    'cat.bulldoze': 'Bulldoze', 'cat.overlays': 'Overlays', 'cat.budget': 'Budget', 'cat.people': 'Society', 'cat.advisors': 'Advisors', 'cat.region': 'Region', 'cat.president': 'President', 'cat.terrain': 'Terrain', 'cat.sandbox': 'Sandbox', 'panel.president': 'Presidents & families',
    'panel.budget': 'Budget & taxes', 'panel.overlays': 'Info overlays', 'panel.people': 'Society & ordinances', 'panel.advisors': 'Advisors & news', 'panel.region': 'Region & trade', 'panel.share': 'Share this city', 'panel.settings': 'Settings', 'panel.sandbox': 'Sandbox', 'panel.lines': 'Transit lines',
    'intro.lede': 'A pixel-art city builder where nothing snaps to a grid. Draw streets any way you like; every wedge, curve, sliver and corner becomes a lot, and buildings shape themselves to fit.',
    'intro.found': 'Found a new city', 'intro.continue': 'Continue saved city', 'intro.import': 'Import city…', 'intro.cancel': 'Cancel',
    'opt.era': 'Starting era', 'opt.pace': 'Technology pace', 'opt.goal': 'Goal', 'opt.map': 'Map', 'opt.seed': 'Map seed', 'opt.lang': 'Language',
    'set.language': 'Language', 'set.performance': 'Performance', 'set.packs': 'Content packs', 'world.title': 'World map',
    'opt.size': 'Map size', 'intro.gallery': 'Browse gallery', 'set.gallery': 'Gallery',
  },
  hu: {
    'hud.funds': 'Pénz', 'hud.pop': 'Népesség', 'hud.jobs': 'Munkahelyek', 'hud.date': 'Dátum', 'hud.idle': 'munkanélküli',
    'menu.undo': 'Vissza', 'menu.world': 'Világ', 'menu.photo': 'Fotó', 'menu.share': 'Megosztás', 'menu.save': 'Mentés', 'menu.new': 'Új', 'menu.help': 'Súgó',
    'cat.inspect': 'Vizsgálat', 'cat.road': 'Utak', 'cat.zone': 'Zónák', 'cat.util': 'Közmű', 'cat.svc': 'Szolgáltatás', 'cat.district': 'Kerületek', 'cat.lines': 'Közlekedés',
    'cat.bulldoze': 'Bontás', 'cat.overlays': 'Térképek', 'cat.budget': 'Költségvetés', 'cat.people': 'Társadalom', 'cat.advisors': 'Tanácsadók', 'cat.region': 'Régió', 'cat.president': 'Elnök', 'cat.terrain': 'Terep', 'cat.sandbox': 'Homokozó', 'panel.president': 'Elnökök és családok',
    'panel.budget': 'Költségvetés és adók', 'panel.overlays': 'Információs térképek', 'panel.people': 'Társadalom és rendeletek', 'panel.advisors': 'Tanácsadók és hírek', 'panel.region': 'Régió és kereskedelem', 'panel.share': 'A város megosztása', 'panel.settings': 'Beállítások', 'panel.sandbox': 'Homokozó', 'panel.lines': 'Közlekedési vonalak',
    'intro.lede': 'Pixelgrafikus városépítő, ahol semmi sem illeszkedik rácshoz. Rajzold az utcákat, ahogy tetszik: minden ék, ív és sarok telekké válik, az épületek pedig hozzá igazodnak.',
    'intro.found': 'Új város alapítása', 'intro.continue': 'Mentett város folytatása', 'intro.import': 'Város importálása…', 'intro.cancel': 'Mégse',
    'opt.era': 'Kezdő korszak', 'opt.pace': 'Technológiai tempó', 'opt.goal': 'Cél', 'opt.map': 'Térkép', 'opt.seed': 'Térkép kódja', 'opt.lang': 'Nyelv',
    'set.language': 'Nyelv', 'set.performance': 'Teljesítmény', 'set.packs': 'Tartalomcsomagok', 'world.title': 'Világtérkép',
    'opt.size': 'Térképméret', 'intro.gallery': 'Galéria böngészése', 'set.gallery': 'Galéria',
  },
  de: {
    'hud.funds': 'Kasse', 'hud.pop': 'Einwohner', 'hud.jobs': 'Arbeitsplätze', 'hud.date': 'Datum', 'hud.idle': 'arbeitslos',
    'menu.undo': 'Rückgängig', 'menu.world': 'Welt', 'menu.photo': 'Foto', 'menu.share': 'Teilen', 'menu.save': 'Speichern', 'menu.new': 'Neu', 'menu.help': 'Hilfe',
    'cat.inspect': 'Ansehen', 'cat.road': 'Straßen', 'cat.zone': 'Zonen', 'cat.util': 'Versorgung', 'cat.svc': 'Dienste', 'cat.district': 'Bezirke', 'cat.lines': 'Nahverkehr',
    'cat.bulldoze': 'Abriss', 'cat.overlays': 'Karten', 'cat.budget': 'Haushalt', 'cat.people': 'Gesellschaft', 'cat.advisors': 'Berater', 'cat.region': 'Region', 'cat.president': 'Präsident', 'cat.terrain': 'Gelände', 'cat.sandbox': 'Sandkasten', 'panel.president': 'Präsidenten & Familien',
    'panel.budget': 'Haushalt & Steuern', 'panel.overlays': 'Infokarten', 'panel.people': 'Gesellschaft & Verordnungen', 'panel.advisors': 'Berater & Nachrichten', 'panel.region': 'Region & Handel', 'panel.share': 'Stadt teilen', 'panel.settings': 'Einstellungen', 'panel.sandbox': 'Sandkasten', 'panel.lines': 'Nahverkehrslinien',
    'intro.lede': 'Ein Pixel-Städtebauspiel ohne Raster. Zeichne Straßen, wie du willst: Jeder Keil, jede Kurve und jede Ecke wird zum Grundstück, und die Gebäude passen sich an.',
    'intro.found': 'Neue Stadt gründen', 'intro.continue': 'Gespeicherte Stadt fortsetzen', 'intro.import': 'Stadt importieren…', 'intro.cancel': 'Abbrechen',
    'opt.era': 'Startepoche', 'opt.pace': 'Technologietempo', 'opt.goal': 'Ziel', 'opt.map': 'Karte', 'opt.seed': 'Karten-Code', 'opt.lang': 'Sprache',
    'set.language': 'Sprache', 'set.performance': 'Leistung', 'set.packs': 'Inhaltspakete', 'world.title': 'Weltkarte',
    'opt.size': 'Kartengröße', 'intro.gallery': 'Galerie ansehen', 'set.gallery': 'Galerie',
  },
  fr: {
    'hud.funds': 'Fonds', 'hud.pop': 'Population', 'hud.jobs': 'Emplois', 'hud.date': 'Date', 'hud.idle': 'sans emploi',
    'menu.undo': 'Annuler', 'menu.world': 'Monde', 'menu.photo': 'Photo', 'menu.share': 'Partager', 'menu.save': 'Enregistrer', 'menu.new': 'Nouveau', 'menu.help': 'Aide',
    'cat.inspect': 'Inspecter', 'cat.road': 'Routes', 'cat.zone': 'Zones', 'cat.util': 'Réseaux', 'cat.svc': 'Services', 'cat.district': 'Quartiers', 'cat.lines': 'Transports',
    'cat.bulldoze': 'Démolir', 'cat.overlays': 'Cartes', 'cat.budget': 'Budget', 'cat.people': 'Société', 'cat.advisors': 'Conseillers', 'cat.region': 'Région', 'cat.president': 'Président', 'cat.terrain': 'Terrain', 'cat.sandbox': 'Bac à sable', 'panel.president': 'Présidents et familles',
    'panel.budget': 'Budget et impôts', 'panel.overlays': "Cartes d'information", 'panel.people': 'Société et arrêtés', 'panel.advisors': 'Conseillers et nouvelles', 'panel.region': 'Région et commerce', 'panel.share': 'Partager cette ville', 'panel.settings': 'Réglages', 'panel.sandbox': 'Bac à sable', 'panel.lines': 'Lignes de transport',
    'intro.lede': "Un jeu de construction de ville en pixel art où rien ne s'aligne sur une grille. Tracez les rues comme vous voulez : chaque coin, courbe et recoin devient une parcelle, et les bâtiments s'y adaptent.",
    'intro.found': 'Fonder une nouvelle ville', 'intro.continue': 'Continuer la ville enregistrée', 'intro.import': 'Importer une ville…', 'intro.cancel': 'Annuler',
    'opt.era': 'Époque de départ', 'opt.pace': 'Rythme technologique', 'opt.goal': 'Objectif', 'opt.map': 'Carte', 'opt.seed': 'Graine de la carte', 'opt.lang': 'Langue',
    'set.language': 'Langue', 'set.performance': 'Performances', 'set.packs': 'Packs de contenu', 'world.title': 'Carte du monde',
    'opt.size': 'Taille de la carte', 'intro.gallery': 'Parcourir la galerie', 'set.gallery': 'Galerie',
  },
  es: {
    'hud.funds': 'Fondos', 'hud.pop': 'Población', 'hud.jobs': 'Empleos', 'hud.date': 'Fecha', 'hud.idle': 'en paro',
    'menu.undo': 'Deshacer', 'menu.world': 'Mundo', 'menu.photo': 'Foto', 'menu.share': 'Compartir', 'menu.save': 'Guardar', 'menu.new': 'Nueva', 'menu.help': 'Ayuda',
    'cat.inspect': 'Inspeccionar', 'cat.road': 'Calles', 'cat.zone': 'Zonas', 'cat.util': 'Suministros', 'cat.svc': 'Servicios', 'cat.district': 'Distritos', 'cat.lines': 'Transporte',
    'cat.bulldoze': 'Demoler', 'cat.overlays': 'Mapas', 'cat.budget': 'Presupuesto', 'cat.people': 'Sociedad', 'cat.advisors': 'Asesores', 'cat.region': 'Región', 'cat.president': 'Presidente', 'cat.terrain': 'Terreno', 'cat.sandbox': 'Modo libre', 'panel.president': 'Presidentes y familias',
    'panel.budget': 'Presupuesto e impuestos', 'panel.overlays': 'Mapas de información', 'panel.people': 'Sociedad y ordenanzas', 'panel.advisors': 'Asesores y noticias', 'panel.region': 'Región y comercio', 'panel.share': 'Compartir esta ciudad', 'panel.settings': 'Ajustes', 'panel.sandbox': 'Modo libre', 'panel.lines': 'Líneas de transporte',
    'intro.lede': 'Un constructor de ciudades en pixel art donde nada se ajusta a una cuadrícula. Traza las calles como quieras: cada cuña, curva y esquina se convierte en un solar, y los edificios se adaptan a él.',
    'intro.found': 'Fundar una ciudad nueva', 'intro.continue': 'Continuar la ciudad guardada', 'intro.import': 'Importar ciudad…', 'intro.cancel': 'Cancelar',
    'opt.era': 'Época inicial', 'opt.pace': 'Ritmo tecnológico', 'opt.goal': 'Objetivo', 'opt.map': 'Mapa', 'opt.seed': 'Semilla del mapa', 'opt.lang': 'Idioma',
    'set.language': 'Idioma', 'set.performance': 'Rendimiento', 'set.packs': 'Paquetes de contenido', 'world.title': 'Mapa del mundo',
    'opt.size': 'Tamaño del mapa', 'intro.gallery': 'Ver la galería', 'set.gallery': 'Galería',
  },
  ar: {
    'hud.funds': 'الأموال', 'hud.pop': 'السكان', 'hud.jobs': 'الوظائف', 'hud.date': 'التاريخ', 'hud.idle': 'عاطلون',
    'menu.undo': 'تراجع', 'menu.world': 'العالم', 'menu.photo': 'صورة', 'menu.share': 'مشاركة', 'menu.save': 'حفظ', 'menu.new': 'جديد', 'menu.help': 'مساعدة',
    'cat.inspect': 'فحص', 'cat.road': 'الطرق', 'cat.zone': 'المناطق', 'cat.util': 'المرافق', 'cat.svc': 'الخدمات', 'cat.district': 'الأحياء', 'cat.lines': 'النقل',
    'cat.bulldoze': 'هدم', 'cat.overlays': 'الخرائط', 'cat.budget': 'الميزانية', 'cat.people': 'المجتمع', 'cat.advisors': 'المستشارون', 'cat.region': 'الإقليم', 'cat.president': 'الرئيس', 'cat.terrain': 'التضاريس', 'cat.sandbox': 'وضع الحرية', 'panel.president': 'الرؤساء والعائلات',
    'panel.budget': 'الميزانية والضرائب', 'panel.overlays': 'خرائط المعلومات', 'panel.people': 'المجتمع والمراسيم', 'panel.advisors': 'المستشارون والأخبار', 'panel.region': 'الإقليم والتجارة', 'panel.share': 'مشاركة هذه المدينة', 'panel.settings': 'الإعدادات', 'panel.sandbox': 'وضع الحرية', 'panel.lines': 'خطوط النقل',
    'intro.lede': 'لعبة بناء مدن بفن البكسل لا يلتزم فيها شيء بشبكة. ارسم الشوارع كما تشاء: كل زاوية ومنحنى وركن يصبح قطعة أرض، وتتشكل المباني لتناسبها.',
    'intro.found': 'تأسيس مدينة جديدة', 'intro.continue': 'متابعة المدينة المحفوظة', 'intro.import': 'استيراد مدينة…', 'intro.cancel': 'إلغاء',
    'opt.era': 'حقبة البداية', 'opt.pace': 'وتيرة التقنية', 'opt.goal': 'الهدف', 'opt.map': 'الخريطة', 'opt.seed': 'رمز الخريطة', 'opt.lang': 'اللغة',
    'set.language': 'اللغة', 'set.performance': 'الأداء', 'set.packs': 'حزم المحتوى', 'world.title': 'خريطة العالم',
    'opt.size': 'حجم الخريطة', 'intro.gallery': 'تصفح المعرض', 'set.gallery': 'المعرض',
  },
};
export function getLang() {
  try { const l = localStorage.getItem(KEY); if (l && S[l]) return l; } catch { /* storage unavailable */ }
  const nav = (typeof navigator !== 'undefined' && navigator.language || 'en').slice(0, 2);
  return S[nav] ? nav : 'en';
}
export function setLang(l) { try { localStorage.setItem(KEY, S[l] ? l : 'en'); } catch { /* ignore */ } }
export function t(key, fallback) { const l = getLang(); return S[l]?.[key] ?? S.en[key] ?? fallback ?? key; }
export const STRINGS = S;

// a phrase in the chosen language (by its English wording), or null
export function phrase(en, l = getLang()) { const i = PHRASE_LANGS.indexOf(l); return i < 0 ? null : PHRASES[en]?.[i] ?? null; }
const ATTRS = ['title', 'placeholder', 'aria-label'], orig = new WeakMap();
function swapText(n, l) {
  const cur = n.nodeValue, key = cur.trim(); if (!key) return;
  const was = orig.get(n); let en = key;
  if (was && was.out === key) en = was.en; else if (!PHRASES[en]) return;
  const out = l === 'en' ? en : phrase(en, l) || en; if (out === key) return;
  orig.set(n, { en, out }); n.nodeValue = cur.replace(key, out);
}
const origAttr = new WeakMap();
function swapAttrs(el, l) {
  for (const a of ATTRS) {
    const v = el.getAttribute?.(a); if (!v) continue;
    const was = origAttr.get(el)?.[a], en = was && was.out === v ? was.en : v;
    if (!PHRASES[en]) continue;
    const out = l === 'en' ? en : phrase(en, l) || en; if (out === v) continue;
    origAttr.set(el, { ...origAttr.get(el), [a]: { en, out } }); el.setAttribute(a, out);
  }
}
// swap every known phrase under a node into the chosen language (or back to English)
export function translateDom(root, l = getLang()) {
  if (!root || typeof document === 'undefined') return;
  if (root.nodeType === 3) return swapText(root, l);
  if (root.nodeType !== 1) return;
  swapAttrs(root, l);
  const tw = document.createTreeWalker(root, 5 /* elements and text */);
  for (let n = tw.nextNode(); n; n = tw.nextNode()) { if (n.nodeType === 3) swapText(n, l); else if (n.tagName !== 'SCRIPT' && n.tagName !== 'STYLE') swapAttrs(n, l); }
}
// the page's direction and language, and the live layer that translates new content as the game draws it
let observer = null;
export function applyDir(doc = typeof document !== 'undefined' ? document : null, l = getLang()) {
  if (!doc) return; doc.documentElement.lang = l; doc.documentElement.dir = RTL.has(l) ? 'rtl' : 'ltr';
}
export function watchDom(root = typeof document !== 'undefined' ? document.body : null) {
  if (!root || typeof MutationObserver === 'undefined') return;
  const l = getLang(); applyDir(document, l); translateDom(root, l);
  observer?.disconnect(); observer = null;
  if (l === 'en') return;
  observer = new MutationObserver((list) => {
    const lang = getLang();
    for (const m of list) {
      if (m.type === 'characterData') swapText(m.target, lang);
      else if (m.type === 'attributes') swapAttrs(m.target, lang);
      else for (const n of m.addedNodes) translateDom(n, lang);
    }
  });
  observer.observe(root, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ATTRS });
}
