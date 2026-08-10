// Please do not modify the name of this note.

// Default language used before a user chooses a language from the plugin menu.
var lang = 'en';

/**
 * Blur strength (in pixels).
 * The larger the value, the stronger the blur effect:
 *   - 2px   → very slight blur
 *   - 5px  → medium blur
 *   - 10px+ → heavy blur
 */
var blurStrength = 10;
var autoLockTimeout = 300; // Default auto-lock timeout in seconds (5 minutes)

// Config: which elements blur in toggle mode and lock mode
const blurTargetsToggle = [
    ".note-title-widget .note-title",
    ".tree-wrapper",
    ".tab-row-widget-container",
    ".note-icon-widget",
    ".title-enhancements", //patch for color picker plugin
    ".color-picker-button",
    "#right-pane",
    ".status-bar-main-row",
    ".note-list",
    ".recent-changes-dialog",
    ".protected-session-password-dialog",
    ".about-dialog",
    ".ck-balloon-panel",
    ".color-picker-popup",
    // trilium next
    ".classic-toolbar-widget",
    ".tab-row-container",
    ".title-details",
    ".note-title",
    ".note-badges",
    "#launcher-pane",
];
const blurTargetsLock = [
    ".note-title-widget .note-title",
    ".tree-wrapper",
    // ".note-tab-wrapper",
    ".tab-row-widget-container",
    ".note-detail",
    ".note-list-widget", // Child note preview
    ".quick-search", // Quick search
    ".ribbon-container",
    ".icon-action",
    ".launcher-button",
    ".note-icon-widget",
    ".floating-buttons",
    ".title-enhancements", //patch for color picker plugin
    "#right-pane",
    ".status-bar-main-row",
    ".note-list",
    ".recent-changes-dialog",
    ".protected-session-password-dialog",
    ".about-dialog",
    ".ck-balloon-panel",
    // trilium next
    ".classic-toolbar-widget",
    ".tab-row-container",
    ".title-details",
    ".note-title",
    ".note-badges",
    ".ribbon-button-container",
    "#launcher-pane",
    ".find-widget-box", // trilium 0.63.7
    ".find-replace-widget", // triluim next
    ".note-type-switcher",
];

// Don't forget to expose configs to the main js file
module.exports = {
    lang,
    blurStrength,
    autoLockTimeout,
    blurTargetsToggle,
    blurTargetsLock
}