// Design tokens: three styles (how a site feels — type, rhythm, shapes) × four palettes each (its colours).
// A theme ships its own tokens too (the look it was designed with); a brief may override style and palette.
// Only values from here reach the CSS, so a site cannot be made ugly by a typo or an AI's "creative" colour.
export const FONTS = {
  sans: '-apple-system, BlinkMacSystemFont, "Segoe UI", Inter, Roboto, "Helvetica Neue", Arial, sans-serif',
  serif: '"Iowan Old Style", "Palatino Linotype", Palatino, "Book Antiqua", Georgia, serif',
  rounded: 'ui-rounded, "SF Pro Rounded", -apple-system, system-ui, "Segoe UI", sans-serif',
  grotesk: '"Avenir Next", "Segoe UI Variable", "Helvetica Neue", Inter, Arial, sans-serif',
  mono: 'ui-monospace, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace',
};

const dark = (bg, bg2, surface, accent, accent2, extra = {}) => ({ dark: true, bg, bg2, surface, text: '#eef0f7', muted: '#a3abc2', line: 'rgba(255,255,255,.09)', accent, accent2, ...extra });
const light = (bg, bg2, surface, text, muted, accent, accent2, extra = {}) => ({ dark: false, bg, bg2, surface, text, muted, line: 'rgba(15,23,42,.10)', accent, accent2, ...extra });

/** Style = typography, radius, weights; `palettes` = the four colour sets that suit it. Keys are what a brief names. */
export const STYLES = {
  calm: {
    head: 'serif',
    font: 'sans',
    radius: 18,
    headWeight: 600,
    tilt: 1.5,
    palettes: {
      sand: light('#fbfaf6', '#f3f0e8', '#ffffff', '#1f1d1a', '#5f5a52', '#2f6f5e', '#c58f3b'),
      forest: light('#f6f9f6', '#e9f1ea', '#ffffff', '#15231b', '#4f615a', '#1f6b45', '#8fbf6a'),
      terracotta: light('#fbf7f3', '#f4ebe3', '#fffdfb', '#2a1d16', '#6a5a50', '#b4532a', '#d98a1f'),
      sea: light('#f5f8fb', '#e8eff6', '#ffffff', '#15202b', '#52606f', '#1f5f8b', '#59a7c9'),
    },
  },
  bold: {
    head: 'grotesk',
    font: 'sans',
    radius: 10,
    headWeight: 800,
    tilt: -2,
    palettes: {
      lemon: dark('#0b0b0f', '#121218', '#17171f', '#e9e24a', '#8bd3a7'),
      indigo: dark('#0b0f1a', '#10172a', '#131b2f', '#5b8cff', '#a26bff'),
      coral: light('#fffaf7', '#fff0ea', '#ffffff', '#1c1412', '#6b5650', '#ff5a36', '#ffb347'),
      electric: dark('#070b14', '#0d1322', '#111a2c', '#2bd4ff', '#7c5cff'),
    },
  },
  elegant: {
    head: 'serif',
    font: 'sans',
    radius: 4,
    headWeight: 500,
    tilt: 0,
    palettes: {
      ivory: light('#fcfbf7', '#f4f1ea', '#ffffff', '#151412', '#5d584f', '#111111', '#9a7b4f'),
      bordeaux: light('#fbf7f6', '#f3e9e8', '#fffdfd', '#2a1518', '#6d5257', '#6b1f2b', '#c99a5b'),
      olive: light('#f9f9f4', '#eeeee3', '#ffffff', '#1d1f16', '#5c5f4c', '#4f5a2d', '#b7a66a'),
      champagne: dark('#14110e', '#1c1813', '#221d17', '#d9b26a', '#f0dcb0'),
    },
  },
};

export const STYLE_IDS = Object.keys(STYLES);
export const paletteIds = (style) => Object.keys(STYLES[style]?.palettes || {});
/** How the site follows the visitor's system: `auto` (light palette by day, its dark twin at night), `light`, `dark`. */
export const SCHEMES = ['auto', 'light', 'dark'];

// ---------------------------------------------------------------- colour maths (S5: dark twins, readable text on the accent)

const COLOR = /^(#[0-9a-f]{3,8}|rgba?\([\d .,%]+\)|hsla?\([\d .,%]+\))$/i;
export function hexToRgb(hex) {
  const m = /^#([0-9a-f]{3,8})$/i.exec(String(hex || '').trim());
  if (!m) return null;
  let h = m[1];
  if (h.length === 3 || h.length === 4) h = [...h].map((c) => c + c).join('');
  if (h.length < 6) return null;
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}
const clamp = (v) => Math.max(0, Math.min(255, Math.round(v)));
export const rgbToHex = ([r, g, b]) => '#' + [r, g, b].map((v) => clamp(v).toString(16).padStart(2, '0')).join('');
/** Relative luminance (WCAG), 0 = black, 1 = white; 0.5 for anything that is not a hex colour. */
export function luminance(hex) {
  const rgb = hexToRgb(hex);
  if (!rgb) return 0.5;
  const [r, g, b] = rgb.map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
/** `t` of the way from colour a to colour b (hex in, hex out). */
export function mix(a, b, t) {
  const x = hexToRgb(a);
  const y = hexToRgb(b);
  if (!x || !y) return a;
  return rgbToHex(x.map((v, i) => v + (y[i] - v) * t));
}
/** The accent lifted until it reads on a dark background (keeps the hue; black becomes a light grey). */
function liftForDark(hex) {
  let c = hex;
  for (let i = 0; i < 8 && luminance(c) < 0.18; i++) c = mix(c, '#ffffff', 0.22);
  return c;
}

/** Text colour on the accent: white on a deep accent, near-black on a light one (lemon, cyan, champagne). */
export const onAccentFor = (accent) => (luminance(accent) > 0.4 ? '#0b0b0f' : '#ffffff');

/**
 * The dark twin of a light palette: a near-black tinted with the accent, lifted surfaces, light text, the
 * accents raised until they read. A palette that is dark already is returned unchanged.
 */
export function darkOf(th) {
  if (th.dark) return th;
  const accent = liftForDark(th.accent);
  const accent2 = liftForDark(th.accent2);
  const bg = mix('#0d0f14', th.accent, 0.08);
  return {
    ...th,
    dark: true,
    bg,
    bg2: mix(bg, '#ffffff', 0.045),
    surface: mix(bg, '#ffffff', 0.07),
    text: '#eef0f7',
    muted: '#a3abc2',
    line: 'rgba(255,255,255,.10)',
    accent,
    accent2,
    onAccent: onAccentFor(accent),
  };
}

/**
 * The tokens for a site: the theme's own look, then an explicit style (type + shapes) and palette (colours)
 * from the brief. Unknown names are ignored, never passed through.
 */
export function resolveTokens(themeTokens = {}, { style = null, palette = null, scheme = null } = {}) {
  let out = { ...themeTokens };
  const st = STYLES[style];
  if (st) {
    out = { ...out, head: st.head, font: st.font, radius: st.radius, headWeight: st.headWeight, tilt: st.tilt };
    const pal = st.palettes[palette] || (themeTokens.accent ? null : st.palettes[paletteIds(style)[0]]);
    if (pal) out = { ...out, ...pal };
  }
  const safe = (v, re, d) => (typeof v === 'string' && re.test(v) ? v : d);
  const accent = safe(out.accent, COLOR, '#5b8cff');
  let tokens = {
    dark: !!out.dark,
    bg: safe(out.bg, COLOR, '#ffffff'),
    bg2: safe(out.bg2, COLOR, '#f4f4f5'),
    surface: safe(out.surface, COLOR, '#ffffff'),
    text: safe(out.text, COLOR, '#111111'),
    muted: safe(out.muted, COLOR, '#555555'),
    line: safe(out.line, COLOR, 'rgba(15,23,42,.10)'),
    accent,
    accent2: safe(out.accent2, COLOR, '#a26bff'),
    onAccent: safe(out.onAccent, COLOR, onAccentFor(accent)),
    head: FONTS[out.head] ? out.head : FONTS[out.font] ? out.font : 'sans',
    font: FONTS[out.font] ? out.font : 'sans',
    radius: Number.isFinite(+out.radius) ? Math.max(0, Math.min(32, +out.radius)) : 18,
    headWeight: Number.isFinite(+out.headWeight) ? +out.headWeight : out.head === 'serif' ? 600 : 750,
    tilt: Number.isFinite(+out.tilt) ? +out.tilt : 1.5,
    scheme: SCHEMES.includes(scheme) ? scheme : SCHEMES.includes(out.scheme) ? out.scheme : 'auto',
  };
  // "dark" = the dark twin all the time; "auto" keeps the light look and lets the stylesheet add the twin at night
  if (tokens.scheme === 'dark' && !tokens.dark) tokens = { ...darkOf(tokens), scheme: 'dark' };
  return tokens;
}
