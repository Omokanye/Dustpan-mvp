// Dustcoin theme — light / dark (persisted)

const KEY = 'dc_theme';

export function getTheme() {
  try {
    const saved = localStorage.getItem(KEY);
    if (saved === 'dark' || saved === 'light') return saved;
  } catch {}
  if (typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches) {
    return 'dark';
  }
  return 'light';
}

export function applyTheme(theme) {
  const t = theme === 'dark' ? 'dark' : 'light';
  document.documentElement.setAttribute('data-theme', t);
  document.documentElement.classList.toggle('dark', t === 'dark');
  try { localStorage.setItem(KEY, t); } catch {}
  document.querySelectorAll('[data-theme-toggle]').forEach((btn) => {
    btn.setAttribute('aria-pressed', String(t === 'dark'));
    btn.title = t === 'dark' ? 'Switch to light mode' : 'Switch to dark mode';
  });
}

export function toggleTheme() {
  applyTheme(getTheme() === 'dark' ? 'light' : 'dark');
}

export function initTheme() {
  applyTheme(getTheme());
}

if (typeof document !== 'undefined') {
  initTheme();
}
