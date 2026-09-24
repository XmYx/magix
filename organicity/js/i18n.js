// Organicity — interface language. t(key) looks up the chosen language and falls back
// to English, then to the key itself. Covers the HUD, dock, menus, panel titles and the
// start screen; longer help texts stay in English for now.
const KEY = 'organicity-lang';
export const LANGS = { en: 'English', hu: 'Magyar', de: 'Deutsch' };
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
