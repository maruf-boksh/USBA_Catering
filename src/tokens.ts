export const colors = {
  red:       '#E10101',
  redBright: '#ff2d2d',
  redDeep:   '#a60303',
  ink:       '#1a0204',
  muted:     '#6b6b72',
  line:      '#e6e2e0',
  paper:     '#ffffff',
  paperWarm: '#f7f3f1',
} as const;

export const gradients = {
  button: 'linear-gradient(120deg, #ff2d2d 0%, #E10101 55%, #a60303 100%)',
  heroBg: 'radial-gradient(120% 120% at 8% 95%, #7e0206 0%, #470206 40%, #1d0204 75%, #130103 100%)',
  tile:   'linear-gradient(150deg, #ff2d2d 0%, #E10101 45%, #a60303 100%)',
} as const;

export const fonts = {
  serif: "'Newsreader', Georgia, 'Times New Roman', serif",
  sans:  "'Hanken Grotesk', system-ui, -apple-system, sans-serif",
} as const;

export const shadows = {
  tileGlow: '0 0 0 1px rgba(255,255,255,.10), 0 10px 34px -8px rgba(225,1,1,.75), 0 0 46px -6px rgba(225,1,1,.55)',
  tileLight: '0 1px 2px rgba(0,0,0,.18), 0 0 0 1px rgba(225,1,1,.10)',
} as const;

export const radii = {
  tile:   '26%',
  input:  '11px',
  button: '12px',
  card:   '14px',
} as const;
