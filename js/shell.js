// DUSTPAN customer shell: ONE sidebar (desktop) / drawer (mobile) shared by every
// signed-in customer page, so the nav lives in this file only.
//
// Add to a customer page:
//   <link rel="stylesheet" href="Css/shell.css">
//   <body class="dc-app" data-session-pill="off">
//   <script type="module" src="js/shell.js"></script>      (before session.js)
//
// To add or rename a link, edit LINKS below.

const LINKS = [
  ['account.html', 'Dashboard', 'home'],
  ['wallet.html', 'Wallet', 'wallet'],
  ['deposit.html', 'Deposit Waste', 'deposit'],
  ['transactions.html', 'Transactions', 'list'],
  ['trade.html', 'Trade', 'trade'],
  ['redeem.html', 'Redeem', 'gift'],
  ['impact.html', 'Impact', 'leaf'],
  ['profile.html', 'Profile / Settings', 'user'],
];

const ICONS = {
  home: '<path d="M3 11l9-8 9 8v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
  wallet: '<path d="M3 7a2 2 0 0 1 2-2h13v4"/><path d="M3 7v11a2 2 0 0 0 2 2h14a1 1 0 0 0 1-1v-9a1 1 0 0 0-1-1H5a2 2 0 0 1-2-2z"/><circle cx="16.5" cy="14.5" r="1"/>',
  deposit: '<path d="M12 3v12"/><path d="M7 10l5 5 5-5"/><path d="M4 19h16"/>',
  list: '<path d="M8 6h13M8 12h13M8 18h13"/><path d="M3 6h.01M3 12h.01M3 18h.01"/>',
  trade: '<path d="M7 4L3 8l4 4"/><path d="M3 8h14"/><path d="M17 20l4-4-4-4"/><path d="M21 16H7"/>',
  gift: '<path d="M20 12v8H4v-8"/><path d="M2 7h20v5H2z"/><path d="M12 22V7"/><path d="M12 7H7.5a2.5 2.5 0 1 1 0-5C11 2 12 7 12 7z"/><path d="M12 7h4.5a2.5 2.5 0 1 0 0-5C13 2 12 7 12 7z"/>',
  leaf: '<path d="M11 20A7 7 0 0 1 4 13c0-6 7-10 16-10 0 9-4 16-9 17z"/><path d="M4 21c2-5 5-8 9-10"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  out: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="M16 17l5-5-5-5"/><path d="M21 12H9"/>',
};
const svg = (name) => `<svg viewBox="0 0 24 24" aria-hidden="true">${ICONS[name]}</svg>`;

const here = location.pathname.split('/').pop() || 'index.html';

const BRAND = '<img src="assets/logo.png" alt="" /><span>Dustpan</span>';

// Mobile top bar
const topbar = document.createElement('header');
topbar.className = 'dc-topbar';
topbar.innerHTML =
  '<button type="button" class="dc-burger" aria-label="Open menu" aria-expanded="false" aria-controls="dc-sidebar">' +
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h16M4 12h16M4 18h16"/></svg></button>' +
  `<a class="dc-brand" href="account.html">${BRAND}</a>`;

// Sidebar
const sidebar = document.createElement('aside');
sidebar.className = 'dc-sidebar';
sidebar.id = 'dc-sidebar';
sidebar.setAttribute('aria-label', 'Main menu');
sidebar.innerHTML =
  `<a class="dc-brand" href="account.html">${BRAND}</a>` +
  '<nav class="dc-nav">' +
  LINKS.map(([href, label, icon]) =>
    `<a class="dc-link" href="${href}"${href === here ? ' aria-current="page"' : ''}>${svg(icon)}<span>${label}</span></a>`
  ).join('') +
  '</nav>' +
  '<div class="dc-foot">' +
  '<div class="dc-user" data-user-name></div>' +
  `<button type="button" class="dc-link" data-signout>${svg('out')}<span>Sign out</span></button>` +
  '</div>';

const overlay = document.createElement('div');
overlay.className = 'dc-overlay';

document.body.classList.add('has-shell');
document.body.prepend(topbar, overlay, sidebar);

// Mobile drawer
const burger = topbar.querySelector('.dc-burger');
function setOpen(open) {
  sidebar.classList.toggle('is-open', open);
  overlay.classList.toggle('is-open', open);
  burger.setAttribute('aria-expanded', String(open));
  burger.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
}
burger.addEventListener('click', () => setOpen(!sidebar.classList.contains('is-open')));
overlay.addEventListener('click', () => setOpen(false));
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') setOpen(false); });
sidebar.querySelectorAll('a.dc-link').forEach((a) => a.addEventListener('click', () => setOpen(false)));

// Sign out (auth.js is loaded on demand so the menu still shows if it fails to load)
sidebar.querySelector('[data-signout]').addEventListener('click', async () => {
  try {
    const { signOut } = await import('./auth.js');
    await signOut();
  } finally {
    location.href = 'index.html';
  }
});
