/* DUSTPAN — Vanilla JS for login + dashboard interactions */

// ----- Login form -----
const loginForm = document.getElementById('loginForm');
if (loginForm) {
  loginForm.addEventListener('submit', (e) => {
    e.preventDefault();
    // Demo: redirect to dashboard
    window.location.href = 'dashboard.html';
  });
}

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
