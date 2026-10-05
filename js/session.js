// DUSTPAN — include on every signed-in page:
//   <script type="module" src="js/session.js"></script>
//
// middleware.js is the real lock. This adds the friendly parts:
//  - sends visitors to sign in if their session ends while a page is open
//  - sends customers who land on staff pages to their account page
//  - shows who is signed in, with a Sign out button
//  - fills in elements marked data-user-name / data-user-initials / data-user-role

import { currentUser, signOut, roleOf, displayName, OPS_ROLES } from './auth.js';

const here = location.pathname.split('/').pop() || 'index.html';

function initials(name) {
  return name.split(/[\s@.]+/).filter(Boolean).slice(0, 2).map((s) => s[0].toUpperCase()).join('') || '?';
}

const user = await currentUser();

if (!user) {
  location.replace(`index.html?next=${encodeURIComponent('/' + here)}`);
} else {
  const role = roleOf(user);
  const isOps = OPS_ROLES.includes(role);

  if (!isOps && here !== 'account.html') {
    location.replace('account.html');
  } else {
    const name = displayName(user);
    const label = role === 'psp_operator' ? 'PSP Operator' : role.charAt(0).toUpperCase() + role.slice(1);

    document.querySelectorAll('[data-user-name]').forEach((el) => (el.textContent = name));
    document.querySelectorAll('[data-user-initials]').forEach((el) => (el.textContent = initials(name)));
    document.querySelectorAll('[data-user-role]').forEach((el) => (el.textContent = label));

    if (document.body.dataset.sessionPill !== 'off') {
      const pill = document.createElement('div');
      pill.className =
        'fixed bottom-4 right-4 z-50 flex items-center gap-3 rounded-full bg-white border border-slate-200 shadow-lg pl-4 pr-2 py-2 text-sm';
      const who = document.createElement('span');
      who.className = 'text-slate-600 max-w-[10rem] truncate';
      who.textContent = name;
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'rounded-full bg-slate-900 text-white px-3 py-1.5 font-medium hover:bg-black';
      btn.textContent = 'Sign out';
      btn.addEventListener('click', async () => {
        await signOut();
        location.href = 'index.html';
      });
      pill.append(who, btn);
      document.body.appendChild(pill);
    }
  }
}
