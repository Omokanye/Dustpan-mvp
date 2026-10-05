/* DUSTPAN — Vanilla JS for dashboard interactions.
   (Sign-in lives in js/auth.js and index.html.) */

// ----- Sidebar toggle (mobile) -----
const menuBtn = document.getElementById('menuBtn');
const sidebar = document.getElementById('sidebar');
const overlay = document.getElementById('overlay');

function toggleSidebar(show) {
  if (!sidebar) return;
  sidebar.classList.toggle('-translate-x-full', !show);
  overlay.classList.toggle('hidden', !show);
}

if (menuBtn) menuBtn.addEventListener('click', () => toggleSidebar(true));
if (overlay) overlay.addEventListener('click', () => toggleSidebar(false));
