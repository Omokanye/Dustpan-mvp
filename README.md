# DUSTPAN — Waste Management Operations Platform

Plain HTML + Tailwind CSS (CDN) + Vanilla JavaScript.

## Folder structure

```
dustpan/
├── index.html       # Login page
├── dashboard.html   # Dashboard overview
├── style.css        # Custom styles
├── script.js        # Vanilla JS interactions
└── README.md
```

## Run locally

Just open `index.html` in your browser, or use the VS Code **Live Server** extension.

No build step required — Tailwind is loaded via CDN.

## Features

- **Login Page** — Two-column layout, email/password, Google sign-in, remember me.
- **Dashboard** — Sidebar nav, topbar search/notifications, 4 stats cards, collection trend chart (SVG), pending waivers table, quick actions, staff activity feed.
- **Responsive** — Mobile sidebar toggle, breakpoints for sm/lg.
- **Theme** — White background with green brand color `#0B7A3B`.
