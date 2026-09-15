try {
  const prefs = JSON.parse(localStorage.getItem('prime-studio.preferences') || '{}');
  const theme = prefs.theme || 'dark';
  document.documentElement.dataset.theme =
    theme === 'system' ? (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark') : theme;
  const density = prefs.density || 'compact';
  document.documentElement.dataset.density = ['comfortable', 'compact', 'dense'].includes(density)
    ? density
    : 'compact';
} catch {}
