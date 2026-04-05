// config.js — copy from config.example.js, rename to config.js, and edit.
// Loaded by embed.html before the component script. Gitignored.
//
// Only the API base URL is needed. Seed nodes are optional extras.

// The base URL of any live Blueprints node on your tailnet/LAN.
// The component will discover all peers automatically from this single entry point.
window.BLUEPRINTS_API_BASE = 'http://<node-ip-or-hostname>:8080';

// Optional: static seed nodes merged with API-discovered ones.
// Useful as an offline fallback or to pin nodes not yet in the DB.
window.BLUEPRINTS_SEED_NODES = [
  // { id: '<node-id>', name: '<display-name>', url: 'http://<ip>:8080' },
];

// Optional: selector action buttons rendered next to the dropdown.
// Valid button keys:
// - 'synthesis'
// - 'probes'
// - 'settings'
// - 'api-key'
// - 'api-key-test'  (force-opens the embedded API key modal in its auth-failed state)
// - 'cache-mode'   (toggles node-local fallback UI dev cache mode via the API)
// - 'fallback-ui'
// - 'ui'
// - 'database-tables'
// - 'database-diagram'
// - 'paging-button'  (cycles button pages in a round-robin)
window.BLUEPRINTS_SELECTOR_BUTTONS = {
  // Preferred: explicit page mapping (each nested array is one page).
  pages: [
    ['ui', 'synthesis', 'probes', 'settings'],
    ['database-tables', 'database-diagram'],
    ['api-key', 'api-key-test', 'cache-mode'],
  ],
  showPagingButton: true,

  // Optional touch ribbon mode for mobile form factors.
  // 'auto' (default): use draggable ribbon on coarse-pointer mobile; keep page/scarab on desktop.
  // 'on': always use ribbon; 'off': always use page/scarab model.
  touchRibbonMode: 'auto',

  // Optional short-edge threshold (px) used by auto mode.
  // Portrait + landscape mobile both qualify while short-edge is <= this value.
  touchRibbonMaxShortEdge: 920,

  // Back-compat alternative (auto-chunked pages):
  // enabledButtons: ['ui', 'synthesis', 'probes', 'settings', 'api-key', 'cache-mode', 'database-tables', 'database-diagram', 'paging-button'],
  // pageSize: 2,

  side: 'left',          // 'left' | 'right' of the dropdown
  nodeSwitchPath: '/ui/' // '/ui/' or 'current' to keep same page when changing node
};
