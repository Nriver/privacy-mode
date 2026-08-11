/*
 * Privacy Mode Plugin
 * Author: Nriver
 * Version: 3.0
 *
 * Overview:
 * Adds a "Privacy Mode" to the note editor that blurs or locks sensitive UI elements
 * to protect note content during editing or presentation.
 *
 * Features:
 * 1. Blur Mode (Toggle)
 *    - Toggle with the "eye" button in the note title bar
 *    - Blurs note titles, tree view, and other UI elements
 *    - Hides the browser tab <title> (listens for note-switch updates)
 *    - Click again to disable blur
 *
 * 2. Lock Mode
 *    - Enable with the "lock" button (requires password)
 *    - First-time use prompts password setup
 *    - When locked:
 *        • Editor is read-only and blurred (no editing or copying)
 *        • Internal link tooltips are hidden
 *        • UI elements remain blurred
 *        • Browser tab <title> stays hidden
 *    - Unlock with the correct password
 *    - Supports password change and "force lock on startup"
 *
 * 3. Auto Lock Mode
 *    - Automatically locks Privacy Mode after a period of inactivity
 *    - Inactivity is detected by mouse movement, keyboard input, clicks, and scrolling
 *    - The timeout duration can be configured by the user (default: 5 minutes)
 *    - Can be enabled or disabled in the unlock dialog settings
 *    - Automatically resets the inactivity timer after unlocking
 *
 * 4. UI Integration
 *    - Automatically injects "eye" and "lock" buttons into the note title bar
 *    - When no note is open (title widget missing or hidden via hidden-int/hidden-ext),
 *      shows fixed floating buttons
 *    - Icons update dynamically to reflect current state
 *
 * 5. State Persistence
 *    - Blur and lock states are saved in localStorage
 *    - Optionally restores lock state on startup
 *    - Auto-lock settings (enabled state and timeout) are also persisted
 *
 * 6. Security
 *    - Passwords are stored as SHA-256 hashes (no plain text)
 *    - Includes secure dialogs for setting, entering, and changing password
 *    - Locked mode prevents editing, copying, and displays sensitive content protection
 */

const LANGUAGE_STORAGE_KEY = "privacyMode_language";
const languageNames = {
    cn: "中文",
    en: "English"
};

function getDefaultLanguage() {
    return translations.trans[config.lang] ? config.lang : Object.keys(translations.trans)[0];
}

function getSelectedLanguage() {
    const savedLanguage = localStorage.getItem(LANGUAGE_STORAGE_KEY);
    return translations.trans[savedLanguage] ? savedLanguage : getDefaultLanguage();
}

let currentLanguage = getSelectedLanguage();

const i18n = key =>
    translations.trans[currentLanguage][key] ??
    translations.trans[getDefaultLanguage()][key] ??
    key;

var privacyMode = {
    enabled: false,
    locked: false
};

let inactivityTimer = null;

// Document <title> privacy: hide tab title while blur/lock is active.
// Trilium updates document.title when switching notes, so we must keep
// intercepting changes and remember the latest real title for restore.
const HIDDEN_DOCUMENT_TITLE = "";
let documentTitlePrivacyActive = false;
let lastRealDocumentTitle = "";
let documentTitleObserver = null;

// Config: which elements blur in toggle mode and lock mode
const blurTargetsToggle = config.blurTargetsToggle;
const blurTargetsLock = config.blurTargetsLock;

// Load and save state from localStorage
function loadPrivacyModeState() {
    try {
        return localStorage.getItem("privacyMode_enabled") === "true";
    } catch {
        return false;
    }
}

function loadPrivacyLockState() {
    try {
        return localStorage.getItem("privacyMode_locked") === "true";
    } catch {
        return false;
    }
}

function savePrivacyModeState(state) {
    try {
        localStorage.setItem("privacyMode_enabled", state ? "true" : "false");
    } catch {}
}

function savePrivacyLockState(state) {
    try {
        localStorage.setItem("privacyMode_locked", state ? "true" : "false");
    } catch {}
}

function resetInactivityTimer() {
    if (privacyMode.locked) return;
    if (localStorage.getItem("privacyMode_autoLockEnabled") !== "true") return;

    if (inactivityTimer) {
        clearTimeout(inactivityTimer);
    }

    const timeout = parseInt(localStorage.getItem("privacyMode_autoLockTimeout")) || config.autoLockTimeout;
    inactivityTimer = setTimeout(() => {
        console.log("Auto-locking due to inactivity...");
        setPrivacyLock(true);
    }, timeout * 1000);
}

function setupInactivityListeners() {
    const events = ['mousemove', 'keydown', 'click', 'scroll'];
    events.forEach(event => {
        window.addEventListener(event, resetInactivityTimer);
    });
}

// Toggle blur if not locked
function togglePrivacyMode() {
    //console.log("privacy.js togglePrivacyMode()");
    if (privacyMode.locked) {
        showAlertDialog(i18n("pleaseUnlockFirst"));
        return;
    }
    privacyMode.enabled = !privacyMode.enabled;
    savePrivacyModeState(privacyMode.enabled);
    applyPrivacyModeState();
}

async function hashPassword(password) {
    const encoder = new TextEncoder();
    const data = encoder.encode(password);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    return hashHex;
}

function hideNoteTooltip(hide) {
    let styleTag = document.getElementById("privacy-tooltip-style");

    if (hide) {
        if (!styleTag) {
            styleTag = document.createElement("style");
            styleTag.id = "privacy-tooltip-style";
            styleTag.innerHTML = `
                .note-tooltip-content {
                    display: none !important;
                }
            `;
            document.head.appendChild(styleTag);
        }
    } else {
        if (styleTag) {
            styleTag.remove();
        }
    }
}

function startDocumentTitleObserver() {
    if (documentTitleObserver) return;

    documentTitleObserver = new MutationObserver(() => {
        if (!documentTitlePrivacyActive) return;

        // Note switch (or app update) changed the title — capture the real
        // value, then re-apply the hidden placeholder so the tab stays private.
        if (document.title !== HIDDEN_DOCUMENT_TITLE) {
            lastRealDocumentTitle = document.title;
            document.title = HIDDEN_DOCUMENT_TITLE;
        }
    });

    // Observe <head> so we catch both text updates and <title> node replacement.
    const head = document.head || document.documentElement;
    documentTitleObserver.observe(head, {
        childList: true,
        subtree: true,
        characterData: true
    });
}

function stopDocumentTitleObserver() {
    if (!documentTitleObserver) return;
    documentTitleObserver.disconnect();
    documentTitleObserver = null;
}

// Hide or restore document.title while privacy (blur or lock) is enabled.
function applyDocumentTitlePrivacy(enabled) {
    if (enabled) {
        if (!documentTitlePrivacyActive) {
            lastRealDocumentTitle = document.title;
            documentTitlePrivacyActive = true;
            document.title = HIDDEN_DOCUMENT_TITLE;
            startDocumentTitleObserver();
        } else if (document.title !== HIDDEN_DOCUMENT_TITLE) {
            // Already active but title leaked (e.g. race with note switch)
            lastRealDocumentTitle = document.title;
            document.title = HIDDEN_DOCUMENT_TITLE;
        }
    } else if (documentTitlePrivacyActive) {
        stopDocumentTitleObserver();
        documentTitlePrivacyActive = false;
        document.title = lastRealDocumentTitle;
        lastRealDocumentTitle = "";
    }
}

// Prevent keyboard interactions when locked, unless focus is in a privacy modal
function blockKeyboardInteraction(e) {
    if (!privacyMode.locked) return;
    if (document.activeElement?.closest('#privacy-password-modal, #privacy-alert-modal')) {
        return;
    }
    e.preventDefault();
    e.stopPropagation();
}

async function applyLockEffects(locking) {
    let editor = null;
    try {
        editor = await api.getActiveContextTextEditor();
    } catch {
        // No active context yet (e.g. during early widget doRender), fix for trilium next
    }
    
    if (locking) {
        if (editor) {
            editor.enableReadOnlyMode('privacyLock');
            editor.editing.view.change(writer => {
                writer.setStyle('user-select', 'none', editor.editing.view.document.getRoot());
            });
        }
        hideNoteTooltip(true);
        
                if (!document.getElementById("privacy-lock-overlay")) {
            const overlay = document.createElement("div");
            overlay.id = "privacy-lock-overlay";
            overlay.style.cssText = `
                position: fixed;
                inset: 0;
                z-index: 9000;
                background: transparent;
                pointer-events: all;
                cursor: url('data:image/svg+xml;utf8,<svg xmlns=%27http://www.w3.org/2000/svg%27 width=%2724%27 height=%2724%27 viewBox=%270 0 24 24%27 fill=%27none%27 stroke=%27%23ff4444%27 stroke-width=%272.5%27 stroke-linecap=%27round%27 stroke-linejoin=%27round%27><rect x=%273%27 y=%2711%27 width=%2718%27 height=%2711%27 rx=%272%27 ry=%272%27></rect><path d=%27M7 11V7a5 5 0 0 1 10 0v4%27></path></svg>') 12 12, not-allowed;
            `;
                        overlay.addEventListener("click", (e) => {
                overlay.style.pointerEvents = "none";
                const under = document.elementFromPoint(e.clientX, e.clientY);
                overlay.style.pointerEvents = "all";
                const btn = under && under.closest && under.closest(".privacy-mode-toggle, .privacy-lock-toggle");
                if (btn) {
                    e.preventDefault();
                    e.stopPropagation();
                    btn.click();
                }
            }, true);
            overlay.addEventListener("mousemove", (e) => {
                overlay.style.pointerEvents = "none";
                const under = document.elementFromPoint(e.clientX, e.clientY);
                overlay.style.pointerEvents = "all";
                const btn = under && under.closest && under.closest(".privacy-mode-toggle, .privacy-lock-toggle");
                overlay.style.cursor = btn
                    ? "pointer"
                    : "url('data:image/svg+xml;utf8,<svg xmlns=%27http://www.w3.org/2000/svg%27 width=%2724%27 height=%2724%27 viewBox=%270 0 24 24%27 fill=%27none%27 stroke=%27%23ff4444%27 stroke-width=%272.5%27 stroke-linecap=%27round%27 stroke-linejoin=%27round%27><rect x=%273%27 y=%2711%27 width=%2718%27 height=%2711%27 rx=%272%27 ry=%272%27></rect><path d=%27M7 11V7a5 5 0 0 1 10 0v4%27></path></svg>') 12 12, not-allowed";
            });
            document.body.appendChild(overlay);
        }

        if (!document.getElementById("privacy-lock-global-style")) {
            const style = document.createElement("style");
            style.id = "privacy-lock-global-style";
                        style.innerHTML = `
                .title-bar-buttons {
                    z-index: 9002 !important;
                    position: relative !important;
                }
                .note-title-widget {
                    z-index: 9002 !important;
                    position: relative !important;
                    user-select: none !important;
                    -webkit-user-select: none !important;
                    cursor: url('data:image/svg+xml;utf8,<svg xmlns=%27http://www.w3.org/2000/svg%27 width=%2724%27 height=%2724%27 viewBox=%270 0 24 24%27 fill=%27none%27 stroke=%27%23ff4444%27 stroke-width=%272.5%27 stroke-linecap=%27round%27 stroke-linejoin=%27round%27><rect x=%273%27 y=%2711%27 width=%2718%27 height=%2711%27 rx=%272%27></rect><path d=%27M7 11V7a5 5 0 0 1 10 0v4%27></path></svg>') 12 12, not-allowed !important;
                }
                .note-title-widget .note-title,
                .note-title-widget .note-title input,
                .note-title-widget .note-title textarea {
                    user-select: none !important;
                    -webkit-user-select: none !important;
                    pointer-events: none !important;
                    cursor: inherit !important;
                }
                .privacy-mode-toggle,
                .privacy-lock-toggle {
                    z-index: 9003 !important;
                    pointer-events: auto !important;
                }
                #privacy-mode-floating-buttons {
                    z-index: 10001 !important;
                    pointer-events: auto !important;
                }
            `;
            document.head.appendChild(style);
        }
        window.addEventListener("keydown", blockKeyboardInteraction, true);
        injectPrivacyButtonsIntoTitle();
    } else {
        if (editor) {
            editor.disableReadOnlyMode('privacyLock');
            editor.editing.view.change(writer => {
                writer.removeStyle('user-select', editor.editing.view.document.getRoot());
            });
        }
        hideNoteTooltip(false);
        
        const overlay = document.getElementById("privacy-lock-overlay");
        if (overlay) overlay.remove();

        const style = document.getElementById("privacy-lock-global-style");
        if (style) style.remove();

        window.removeEventListener("keydown", blockKeyboardInteraction, true);
    }
}


// Lock or unlock privacy mode with password
async function setPrivacyLock(locking) {
    if (locking) {
        if (!localStorage.getItem("privacyMode_password")) {
            const pwd1 = await showPasswordDialog("setPasswordToLock");
            if (!pwd1) return;
            const pwd2 = await showPasswordDialog("confirmPassword");
            if (pwd1 !== pwd2) {
                showAlertDialog(i18n("passwordsDoNotMatch"));
                return;
            }
            const pwdHash = await hashPassword(pwd1);
            localStorage.setItem("privacyMode_password", pwdHash);
            localStorage.setItem("privacyMode_forceLock", "true");
        }
        privacyMode.locked = true;
        privacyMode.enabled = true;
        savePrivacyModeState(true);
        
        await applyLockEffects(true);
    } else {
        const input = await showPasswordDialog("enterPasswordToUnlock", { allowChange: true });
        if (input === null) return;

        const storedHash = localStorage.getItem("privacyMode_password");
        const inputHash = await hashPassword(input);
        if (inputHash !== storedHash) {
            showAlertDialog(i18n("incorrectPassword"));
            return;
        }

        privacyMode.locked = false;
        privacyMode.enabled = false;
        savePrivacyModeState(false);
        
        await applyLockEffects(false);
        resetInactivityTimer();
    }

    savePrivacyLockState(privacyMode.locked);
    applyPrivacyModeState();
    updateLockButtonIcon();
}

async function changePrivacyPassword() {
    const storedHash = localStorage.getItem("privacyMode_password");
    if (!storedHash) {
        showAlertDialog(i18n("noPasswordSet"));
        return;
    }

    const current = await showPasswordDialog("enterCurrentPassword");
    if (current === null) return;

    const currentHash = await hashPassword(current);
    if (currentHash !== storedHash) {
        showAlertDialog(i18n("incorrectPassword"));
        return;
    }

    const newPwd1 = await showPasswordDialog("enterNewPassword");
    if (!newPwd1) return;
    const newPwd2 = await showPasswordDialog("confirmNewPassword");
    if (newPwd1 !== newPwd2) {
        showAlertDialog(i18n("passwordsDoNotMatch"));
        return;
    }

    const newPwdHash = await hashPassword(newPwd1);
    localStorage.setItem("privacyMode_password", newPwdHash);
    showAlertDialog(i18n("passwordChanged"));
}

// Apply blur to specified UI elements
function applyPrivacyModeState() {
    //console.log("privacy.js applyPrivacyModeState()");
    //console.log("privacyMode.enabled", privacyMode.enabled);
    const blurValue = privacyMode.enabled ? `blur(${config.blurStrength}px)` : "none";

    // Clear all blur effects
    [...new Set([...blurTargetsToggle, ...blurTargetsLock])].forEach(selector => {
        document.querySelectorAll(selector).forEach(el => {
            el.style.filter = "none";
        });
    });

    // Apply new blur if enabled
    if (privacyMode.enabled) {
        //console.log("================================")
        const targets = privacyMode.locked ? blurTargetsLock : blurTargetsToggle;
        targets.forEach(selector => {
            document.querySelectorAll(selector).forEach(el => {
                //console.log(el);
                el.style.filter = blurValue;
            });
        });
        //console.log("================================")
    }

    // Hide browser tab title while blur or lock is active; restore on disable.
    // Title content follows the active note, so applyDocumentTitlePrivacy also
    // keeps a MutationObserver that re-hides after note switches.
    applyDocumentTitlePrivacy(privacyMode.enabled);

    // Update all toggle icons
    document.querySelectorAll(".privacy-mode-toggle").forEach(toggleBtn => {
        toggleBtn.classList.remove("bx-low-vision", "bx-show");
        toggleBtn.classList.add(privacyMode.enabled ? "bx-low-vision" : "bx-show");
        toggleBtn.title = privacyMode.enabled ? i18n("clickToDisableBlur") : i18n("clickToEnableBlur");
    });

    updateLockButtonIcon();
}

// Update lock icon status
function updateLockButtonIcon() {
    document.querySelectorAll('.privacy-lock-toggle').forEach(lockBtn => {
        if (!lockBtn) return;
        lockBtn.classList.remove("bx-lock", "bx-lock-open");
        lockBtn.classList.add(privacyMode.locked ? "bx-lock" : "bx-lock-open");
        lockBtn.title = privacyMode.locked ? i18n("clickToUnlock") : i18n("clickToLock");
    });
}

function refreshLanguageUi() {
    document.querySelectorAll(".privacy-language-selector").forEach(selector => {
        selector.value = currentLanguage;
        selector.title = i18n("language");
    });

    const passwordModal = document.querySelector("#privacy-password-modal");
    if (passwordModal) {
        passwordModal.querySelectorAll("[data-i18n]").forEach(element => {
            element.textContent = i18n(element.dataset.i18n);
        });
        passwordModal.querySelectorAll("[data-i18n-placeholder]").forEach(element => {
            element.placeholder = i18n(element.dataset.i18nPlaceholder);
        });
    }

    applyPrivacyModeState();
}

function setLanguage(language) {
    if (!translations.trans[language]) return;

    currentLanguage = language;
    localStorage.setItem(LANGUAGE_STORAGE_KEY, language);
    refreshLanguageUi();
}

window.setLanguage = setLanguage;

function createPrivacyToggleButton(extraStyle = "") {
    const toggleBtn = document.createElement("span");
    toggleBtn.className = "privacy-mode-toggle bx";
    toggleBtn.style.cssText = `
        cursor: pointer;
        font-size: 22px;
        color: var(--text-muted);
        z-index: 9001;
        ${extraStyle}
    `;
    toggleBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        togglePrivacyMode();
    });
    return toggleBtn;
}

function createPrivacyLockButton(extraStyle = "") {
    const lockBtn = document.createElement("span");
    lockBtn.className = "privacy-lock-toggle bx";
    lockBtn.style.cssText = `
        cursor: pointer;
        font-size: 22px;
        color: var(--text-muted);
        z-index: 9001;
        ${extraStyle}
    `;
    lockBtn.addEventListener("click", async (e) => {
        e.stopPropagation();
        await setPrivacyLock(!privacyMode.locked);
    });
    return lockBtn;
}

function removeFloatingPrivacyButtons() {
    const floating = document.getElementById("privacy-mode-floating-buttons");
    if (floating) floating.remove();
}

// Trilium hides widgets with hidden-int / hidden-ext instead of always removing them.
// A closed note may still leave .note-title-widget in the DOM with those classes.
function isTriliumHidden(el) {
    if (!el || !(el instanceof Element)) return true;
    return !!el.closest(".hidden-int, .hidden-ext");
}

function getVisibleNoteTitleWidgets() {
    return Array.from(document.querySelectorAll(".note-title-widget"))
        .filter(el => !isTriliumHidden(el));
}

// When no note is visibly open, show fixed floating controls.
function ensureFloatingPrivacyButtons() {
    let floating = document.getElementById("privacy-mode-floating-buttons");
    if (floating) return;

    floating = document.createElement("div");
    floating.id = "privacy-mode-floating-buttons";
    floating.style.cssText = `
        position: fixed;
        top: 54px;
        right: 57px;
        display: flex;
        align-items: center;
        gap: 18px;
        background: transparent;
        z-index: 10001;
        pointer-events: auto;
    `;
    floating.title = "Privacy Mode";

    floating.appendChild(createPrivacyToggleButton());
    floating.appendChild(createPrivacyLockButton());
    document.body.appendChild(floating);
}

// Inject into visible title bars; fall back to floating buttons when every
// note-title-widget is missing or hidden (hidden-int / hidden-ext).
function injectPrivacyButtonsIntoTitle() {
    const titleWidgets = getVisibleNoteTitleWidgets();

    if (titleWidgets.length === 0) {
        ensureFloatingPrivacyButtons();
        applyPrivacyModeState();
        return;
    }

    // Prefer title-bar buttons when a note is actually visible
    removeFloatingPrivacyButtons();

    titleWidgets.forEach(titleWidget => {
        if (titleWidget.querySelector(".privacy-mode-toggle")) return;

        titleWidget.style.position = "relative";

        titleWidget.appendChild(createPrivacyToggleButton(`
            position: absolute;
            right: 34px;
            top: 50%;
            transform: translateY(-50%);
        `));
        titleWidget.appendChild(createPrivacyLockButton(`
            position: absolute;
            right: -6px;
            top: 50%;
            transform: translateY(-50%);
        `));
    });

    applyPrivacyModeState(); // important: apply after injection
}

// Watch for DOM changes to re-inject buttons and apply state.
// Must observe class changes: closing a note often only adds hidden-int.
function setupPrivacyModeObserver() {
    //console.log("privacy.js setupPrivacyModeObserver()");
    const container =
        document.querySelector("#root-widget") ||
        document.querySelector(".center-pane") ||
        document.body;

    if (!container) return;

    let scheduled = false;
    const scheduleUpdate = () => {
        if (scheduled) return;
        scheduled = true;
        requestAnimationFrame(() => {
            scheduled = false;
            injectPrivacyButtonsIntoTitle();
            applyPrivacyModeState();
        });
    };

    const observer = new MutationObserver((mutations) => {
        for (const mutation of mutations) {
            // Ignore our floating container mutations
            if (mutation.target?.id === "privacy-mode-floating-buttons" ||
                mutation.target?.closest?.("#privacy-mode-floating-buttons")) {
                continue;
            }
            // childList: note open/close structure changes
            // attributes/class: note-title-widget gets hidden-int without being removed
            scheduleUpdate();
            break;
        }
    });

    observer.observe(container, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ["class"],
    });
}

function showAlertDialog(message, type="info") {
    return new Promise(resolve=>{
        const old = document.querySelector("#privacy-alert-modal");
        if(old) old.remove();
        const iconMap = {
            info:"💡",
            success:"✅",
            warning:"⚠️",
            error:"❌"
        };
        const modal=document.createElement("div");
        modal.id="privacy-alert-modal";
        modal.innerHTML=`
        <div class="privacy-alert-overlay">
            <div class="privacy-alert-box">
                <div class="privacy-alert-icon">
                    ${iconMap[type] || iconMap.info}
                </div>
                <div class="privacy-alert-message">
                    ${message}
                </div>
                <button 
                    class="privacy-alert-btn">
                    ${i18n("ok")}
                </button>
            </div>
        </div>
        <style>
        .privacy-alert-overlay{
            position:fixed;
            inset:0;
            background:
            rgba(0,0,0,.45);
            backdrop-filter:
            blur(8px);
            display:flex;
            justify-content:center;
            align-items:center;
            z-index:10000;
        }
        .privacy-alert-box{
            width:320px;
            padding:28px 25px;
            border-radius:18px;
            text-align:center;
            background:
            var(--main-background-color);
            color:
            var(--main-text-color);
            box-shadow:
            0 20px 60px rgba(0,0,0,.35);
            animation:
            privacyAlertShow .25s ease;
        }
        @keyframes privacyAlertShow{
            from{
                opacity:0;
                transform:
                scale(.9)
                translateY(20px);
            }
            to{
                opacity:1;
                transform:
                scale(1)
                translateY(0);
            }
        }
        .privacy-alert-icon{
            font-size:42px;
            margin-bottom:15px;
        }
        .privacy-alert-message{
            font-size:15px;
            line-height:1.6;
            margin-bottom:25px;
        }
        .privacy-alert-btn{
            width:120px;
            padding:10px 0;
            border:none;
            border-radius:12px;
            cursor:pointer;
            font-weight:600;
            color:white;
            background:
            linear-gradient(
                135deg,
                #4f8cff,
                #2563eb
            );
            transition:.2s;
        }
        .privacy-alert-btn:hover{
            transform:
            translateY(-2px);
        }
        </style>
        `;
        document.body.appendChild(modal);
        const btn =
        modal.querySelector(".privacy-alert-btn");
        btn.onclick=()=>{
            modal.remove();
            resolve();
        };
        modal.querySelector(".privacy-alert-overlay")
        .onclick=e=>{
            if(e.target.classList.contains(
                "privacy-alert-overlay"
            )){
                modal.remove();
                resolve();
            }
        };
        btn.focus();
    });
}

// Prompt for password input
function showPasswordDialog(messageKey, options = {}) {
    const allowChange = options.allowChange || false;

    return new Promise((resolve) => {
        if (document.querySelector("#privacy-password-modal")) {
            document.querySelector("#privacy-password-modal").remove();
        }

        const modal = document.createElement("div");
        modal.id = "privacy-password-modal";
        modal.innerHTML = `
<div class="privacy-overlay">
    <div class="privacy-dialog" role="dialog" aria-modal="true">
        <div class="privacy-header">
            <div class="privacy-icon">
                🔐
            </div>
            <div class="privacy-title" data-i18n="${messageKey}">
                ${i18n(messageKey)}
            </div>
        </div>

        <div class="privacy-input-box">
            <input 
                id="privacy-password-input"
                type="password"
                data-i18n-placeholder="enterPassword"
                placeholder="${i18n("enterPassword")}"
            />
        </div>

        <div class="privacy-buttons">
            <button id="privacy-password-ok" class="privacy-btn primary" data-i18n="ok">
                ${i18n("ok")}
            </button>
            <button id="privacy-password-cancel" class="privacy-btn secondary" data-i18n="cancel">
                ${i18n("cancel")}
            </button>
        </div>

        <div class="privacy-settings">
            ${allowChange ? `
            <button id="privacy-change-password" 
                class="privacy-link">
                🔑 <span data-i18n="changePassword">${i18n("changePassword")}</span>
            </button>

            <label class="privacy-option">
                <input 
                    type="checkbox" 
                    id="privacy-force-lock-checkbox"
                    ${localStorage.getItem("privacyMode_forceLock") === "true" ? "checked" : ""}
                >
                <span data-i18n="forceLockOnStartup">
                ${i18n("forceLockOnStartup")}
                </span>
            </label>

            <div class="privacy-divider"></div>

            <label class="privacy-option">
                <input 
                    type="checkbox"
                    id="privacy-auto-lock-checkbox"
                    ${localStorage.getItem("privacyMode_autoLockEnabled") === "true" ? "checked" : ""}
                >
                <span data-i18n="enableAutoLock">
                ${i18n("enableAutoLock")}
                </span>
            </label>

            <div 
                id="privacy-auto-lock-settings"
                class="privacy-time"
                style="
                display:${localStorage.getItem("privacyMode_autoLockEnabled") === "true" 
                ? "block":"none"};
                "
            >
                <span data-i18n="secondsOfInactivity">${i18n("secondsOfInactivity")}</span>
                <input 
                    type="number"
                    id="privacy-auto-lock-timeout"
                    value="${localStorage.getItem("privacyMode_autoLockTimeout") || config.autoLockTimeout}"
                >
            </div>
            `:""}

            <label class="privacy-option">
                <span data-i18n="language">${i18n("language")}</span>
                <select id="privacy-language-selector" class="privacy-language-selector">
                    ${Object.keys(translations.trans).map(language => `
                        <option value="${language}" ${language === currentLanguage ? "selected" : ""}>
                            ${languageNames[language] || language}
                        </option>
                    `).join("")}
                </select>
            </label>

        </div>
    </div>
</div>

<style>

.privacy-overlay{
    position:fixed;
    inset:0;
    background:
    rgba(0,0,0,.45);
    backdrop-filter:
    blur(8px);
    display:flex;
    align-items:center;
    justify-content:center;
    z-index:2147483647;
}

.privacy-dialog{
    width:360px;
    padding:28px;
    border-radius:20px;
    background: var(--main-background-color);
    color: var(--main-text-color);
    box-shadow:0 20px 60px rgba(0,0,0,.35);
    font-family: var(--font-family,sans-serif);
    animation: privacyShow .25s ease;
}

    @keyframes privacyShow{
    from{
        transform:
        translateY(20px) scale(.95);
        opacity:0;
    }
    to{
        transform:
        translateY(0) scale(1);
        opacity:1;
    }
}

.privacy-header{
    text-align:center;
    margin-bottom:22px;
}

.privacy-icon{
    font-size:42px;
    margin-bottom:8px;
}

.privacy-title{
    font-size:18px;
    font-weight:700;
}

.privacy-input-box input{
    width:100%;
    box-sizing:border-box;
    padding:12px 15px;
    border-radius:12px;
    border:1px solid var(--border-color,#ccc);
    background:var(--main-background-color);
    color:var(--main-text-color);
    font-size:15px;
    outline:none;
    transition:.2s;
}

.privacy-input-box input:focus{
    border-color:
    var(--button-bg,#007bff);
    box-shadow:
    0 0 0 3px rgba(0,123,255,.18);
}


.privacy-buttons{
    display:flex;
    gap:12px;
    margin-top:22px;
}

.privacy-btn{
    flex:1;
    padding:10px;
    border:none;
    border-radius:12px;
    cursor:pointer;
    font-weight:600;
    font-size:14px;
    transition:.2s;
}

.privacy-btn.primary{
    background:
    linear-gradient(
    135deg,
    #4f8cff,
    #2563eb
    );
    color:white;
}

.privacy-btn.secondary{
    background:
    rgba(128,128,128,.15);
    color:
    var(--main-text-color);
}


.privacy-btn:hover{
transform:
translateY(-2px);
}

.privacy-settings{
    margin-top:22px;
    padding-top:18px;
}

.privacy-link{
    background:none;
    border:none;
    color:
    var(--link-color,#007bff);
    cursor:pointer;
    font-size:14px;
}

.privacy-option{
    display:flex;
    align-items:center;
    gap:10px;
    margin-top:14px;
    font-size:13px;
    cursor:pointer;
}

.privacy-divider{
    height:1px;
    background:
    var(--border-color,#ddd);
    margin:16px 0;
}

.privacy-time{
    margin-top:12px;
    padding:10px;
    border-radius:12px;
    background:
    rgba(128,128,128,.1);
    font-size:13px;
}

.privacy-time input{
    width:70px;
    margin-left:8px;
    padding:5px;
    border-radius:8px;
    border:1px solid var(--border-color,#ccc);
    background:
    transparent;
    color:
    inherit;
}

.privacy-language-selector{
    padding:4px 6px;
}

</style>
`;

        document.body.appendChild(modal);

        const input = document.querySelector("#privacy-password-input");
        const okButton = document.querySelector("#privacy-password-ok");
        const cancelButton = document.querySelector("#privacy-password-cancel");
        const preserveModalFocus = (event) => {
            if (event.target instanceof Node && modal.contains(event.target)) {
                // Prevent Trilium's active dialog focus trap from seeing focus
                // changes within the privacy dialog.
                event.stopImmediatePropagation();
                return;
            }

            // An existing Trilium dialog may reclaim focus after the password
            // dialog opens. Restore the password field on the next frame so the
            // user can continue typing.
            requestAnimationFrame(() => {
                if (modal.isConnected && document.activeElement !== input) {
                    input.focus({ preventScroll: true });
                }
            });
        };
        window.addEventListener("focusin", preserveModalFocus, true);
        window.addEventListener("focus", preserveModalFocus, true);

        const closeDialog = (value) => {
            window.removeEventListener("focusin", preserveModalFocus, true);
            window.removeEventListener("focus", preserveModalFocus, true);
            modal.remove();
            resolve(value);
        };

        input.addEventListener("keydown", (e) => {
            if (e.key === "Enter") {
                okButton.click();
            }
        });

        okButton.onclick = () => {
            const value = input.value;

            const forceLockCheckbox = document.querySelector("#privacy-force-lock-checkbox");
            if (forceLockCheckbox) {
                localStorage.setItem("privacyMode_forceLock", forceLockCheckbox.checked ? "true" : "false");
            }

            const autoLockCheckbox = document.querySelector("#privacy-auto-lock-checkbox");
            if (autoLockCheckbox) {
                localStorage.setItem("privacyMode_autoLockEnabled", autoLockCheckbox.checked ? "true" : "false");
            }

            const autoLockTimeoutInput = document.querySelector("#privacy-auto-lock-timeout");
            if (autoLockTimeoutInput) {
                localStorage.setItem("privacyMode_autoLockTimeout", autoLockTimeoutInput.value);
            }

            closeDialog(value);
        };

        cancelButton.onclick = () => {
            console.log("cancelButton.onclick");
            console.log(modal);
            closeDialog(null);
        };

        if (allowChange) {
            const changePwdButton = document.querySelector("#privacy-change-password");
            changePwdButton.onclick = async () => {
                window.removeEventListener("focusin", preserveModalFocus, true);
                window.removeEventListener("focus", preserveModalFocus, true);
                modal.remove();
                await changePrivacyPassword();
            };

            const autoLockCheckbox = document.querySelector("#privacy-auto-lock-checkbox");
            const autoLockSettings = document.querySelector("#privacy-auto-lock-settings");
            if (autoLockCheckbox && autoLockSettings) {
                autoLockCheckbox.onchange = () => {
                    autoLockSettings.style.display = autoLockCheckbox.checked ? "block" : "none";
                };
            }
        }

        const languageSelector = document.querySelector("#privacy-language-selector");
        if (languageSelector) {
            languageSelector.onchange = () => setLanguage(languageSelector.value);
        }

        input.focus();
        requestAnimationFrame(() => input.focus());
    });
}

// Widget entry point
class PrivacyModeWidget extends api.RightPanelWidget {
//class PrivacyModeWidget extends api.NoteContextAwareWidget {
    get position() {
        return 102;
    }

    get parentWidget() {
        return "center-pane";
    }
    
    async doRender() {
        console.log("privacy.js doRender()");
        this.$widget = $("<div></div>");

        // Load saved state from localStorage
        privacyMode.enabled = loadPrivacyModeState();
        privacyMode.locked = loadPrivacyLockState();

        const storedHash = localStorage.getItem("privacyMode_password");

        // Force lock on startup if config is enabled and password is set
        const forceLockOnStartup = localStorage.getItem("privacyMode_forceLock") === "true";
if (storedHash && forceLockOnStartup) {
            privacyMode.locked = true;
            privacyMode.enabled = true;
            savePrivacyLockState(true);
            savePrivacyModeState(true);
        }

        // Prompt user to unlock if a password is set and the mode is locked
        if (storedHash && privacyMode.locked) {
            await applyLockEffects(true);
            while (privacyMode.locked) {
                const input = await showPasswordDialog("enterPasswordToUnlock");
                if (input === null) {
                    showAlertDialog(i18n("passwordRequired"));
                    continue;
                }

                const inputHash = await hashPassword(input);
                if (inputHash === storedHash) {
                    privacyMode.locked = false;
                    privacyMode.enabled = false;
                    savePrivacyLockState(false);
                    savePrivacyModeState(false);
                    await applyLockEffects(false);
                } else {
                    showAlertDialog(i18n("incorrectPassword"));
                }
            }
        }

        applyPrivacyModeState();
        injectPrivacyButtonsIntoTitle();

        setupInactivityListeners();
        resetInactivityTimer();

        // Setup DOM mutation observer for dynamically added elements
        setTimeout(() => {
            setupPrivacyModeObserver();
        }, 500);

        return this.$widget;
    }


    async refreshWithNote(note) {
        //console.log("privacy.js refreshWithNote()");
        privacyMode.enabled = loadPrivacyModeState();
        privacyMode.locked = loadPrivacyLockState();
        
        applyPrivacyModeState();
        injectPrivacyButtonsIntoTitle();
    }
}

module.exports = new PrivacyModeWidget();