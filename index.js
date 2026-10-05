/**
 * Splash Custom 1.0.0 — extension SillyTavern
 * Personnalise l'écran de lancement (logo ST / GIF, fond, texte « Initialisation… »).
 *
 * Le splash disparaît vite : style.css est déclaré dans le manifest (chargé tôt, loading_order: 1),
 * un cache localStorage permet d'appliquer les variables CSS dès le chargement du module,
 * et un MutationObserver rattrape `.splash-logo` / `.splash-message` / `#loader.splash-screen`.
 *
 * Ne touche pas #chat, #form_sheld, #send_textarea, ni les autres extensions.
 * Vanilla ES module, aucune étape de build.
 * Chemin attendu : /scripts/extensions/third-party/splash-custom/index.js
 */

import { extension_settings } from '../../../extensions.js';
import { saveSettingsDebounced } from '../../../../script.js';

const MODULE_NAME = 'splash-custom';
const LOG = '[Splash Custom]';
const CACHE_KEY = 'sc_cache_v1';
const STYLE_ID = 'sc-runtime-style';
const PREVIEW_ID = 'sc-preview-overlay';
const PANEL_ID = 'splash_custom_settings';
const SCHEMA = 1;
const VERSION = '1.0.0';
const MAX_UPLOAD_BYTES = 1_800_000; // ~1.8 Mo (data URL dans extensionSettings)
const DEFAULT_LOGO = '/img/logo.png';
const HEX_RE = /^#[0-9a-f]{6}$/i;

const defaultSettings = Object.freeze({
    schema: SCHEMA,
    enabled: true,
    imageUrl: '',
    imageData: '', // data:image/... depuis upload fichier
    bgColor: '#000000',
    hideText: false,
    textLabel: 'Initialisation...',
    textColor: '#ffffff',
    imageSize: 150,
    imageSizeUnit: 'px', // 'px' | '%'
    hideSpinner: true,
    previewSeconds: 4,
});

// ---------------------------------------------------------------------------
// Utilitaires purs (testables sous Node)
// ---------------------------------------------------------------------------

function clampNumber(value, fallback, min, max) {
    const n = Number(value);
    if (!Number.isFinite(n)) return fallback;
    return Math.max(min, Math.min(max, Math.round(n)));
}

/** Renvoie '#rrggbb' (minuscules) ou fallback. */
function normalizeHex(value, fallback = '#000000') {
    if (typeof value !== 'string') return fallback;
    let h = value.trim().toLowerCase();
    if (h[0] === '#') h = h.slice(1);
    if (/^[0-9a-f]{3}$/.test(h)) h = h.split('').map((c) => c + c).join('');
    if (!/^[0-9a-f]{6}$/.test(h)) return fallback;
    return `#${h}`;
}

function sizeCss(size, unit) {
    const u = unit === '%' ? '%' : 'px';
    const max = u === '%' ? 100 : 800;
    const n = clampNumber(size, u === '%' ? 50 : 150, 16, max);
    return `${n}${u}`;
}

/** Source image effective : data URL uploadée > URL https/http/data > logo ST par défaut. */
function resolveImageSrc(s) {
    const data = typeof s.imageData === 'string' ? s.imageData.trim() : '';
    if (data.startsWith('data:image/')) return data;
    const url = typeof s.imageUrl === 'string' ? s.imageUrl.trim() : '';
    if (/^(https?:|data:image\/)/i.test(url)) return url;
    return DEFAULT_LOGO;
}

function sanitize(src) {
    const d = defaultSettings;
    const o = (src && typeof src === 'object') ? src : {};
    const unit = o.imageSizeUnit === '%' ? '%' : 'px';
    return {
        schema: SCHEMA,
        enabled: o.enabled !== false,
        imageUrl: typeof o.imageUrl === 'string' ? o.imageUrl.trim() : '',
        imageData: typeof o.imageData === 'string' ? o.imageData : '',
        bgColor: normalizeHex(o.bgColor, d.bgColor),
        hideText: !!o.hideText,
        textLabel: typeof o.textLabel === 'string' && o.textLabel.length ? o.textLabel.slice(0, 120) : d.textLabel,
        textColor: normalizeHex(o.textColor, d.textColor),
        imageSize: clampNumber(o.imageSize, unit === '%' ? 50 : 150, 16, unit === '%' ? 100 : 800),
        imageSizeUnit: unit,
        hideSpinner: o.hideSpinner !== false,
        previewSeconds: clampNumber(o.previewSeconds, 4, 3, 5),
    };
}

function settingsForCache(s) {
    // Ne pas dupliquer une énorme data URL dans localStorage si possible — on la garde
    // (nécessaire pour le splash au prochain chargement), mais on tronque si absurde.
    const out = { ...s };
    if (out.imageData && out.imageData.length > MAX_UPLOAD_BYTES * 2) {
        out.imageData = '';
    }
    return out;
}

// ---------------------------------------------------------------------------
// Cache localStorage (application synchrone au boot)
// ---------------------------------------------------------------------------

function readCache() {
    try {
        const raw = localStorage.getItem(CACHE_KEY);
        if (!raw) return null;
        return sanitize(JSON.parse(raw));
    } catch {
        return null;
    }
}

function writeCache(s) {
    try {
        localStorage.setItem(CACHE_KEY, JSON.stringify(settingsForCache(s)));
    } catch (e) {
        console.warn(LOG, 'cache localStorage impossible', e);
    }
}

// ---------------------------------------------------------------------------
// Application DOM / CSS
// ---------------------------------------------------------------------------

function applyCssVars(s) {
    if (typeof document === 'undefined') return;
    const root = document.documentElement;
    if (!root) return;
    if (!s || !s.enabled) {
        root.classList.remove('sc-active', 'sc-hide-text', 'sc-hide-spinner');
        root.style.removeProperty('--sc-bg');
        root.style.removeProperty('--sc-text');
        root.style.removeProperty('--sc-size');
        return;
    }
    root.classList.add('sc-active');
    root.classList.toggle('sc-hide-text', !!s.hideText);
    root.classList.toggle('sc-hide-spinner', !!s.hideSpinner);
    root.style.setProperty('--sc-bg', s.bgColor);
    root.style.setProperty('--sc-text', s.textColor);
    root.style.setProperty('--sc-size', sizeCss(s.imageSize, s.imageSizeUnit));
}

function patchElement(el, s) {
    if (!el || !s || !s.enabled) return;
    if (el.classList && el.classList.contains('splash-logo')) {
        const src = resolveImageSrc(s);
        if (el.getAttribute('src') !== src) el.setAttribute('src', src);
        el.alt = 'Splash';
        el.style.setProperty('width', sizeCss(s.imageSize, s.imageSizeUnit), 'important');
        el.style.setProperty('height', 'auto', 'important');
        el.style.setProperty('object-fit', 'contain', 'important');
    }
    if (el.classList && el.classList.contains('splash-message')) {
        if (s.hideText) {
            el.style.setProperty('display', 'none', 'important');
        } else {
            el.style.removeProperty('display');
            if (el.textContent !== s.textLabel) el.textContent = s.textLabel;
            el.style.setProperty('color', s.textColor, 'important');
        }
    }
    if (el.id === 'load-spinner' && s.hideSpinner) {
        const loader = el.closest('#loader');
        if (loader && loader.classList.contains('splash-screen')) {
            el.style.setProperty('display', 'none', 'important');
        }
    }
    if (el.id === 'preloader' || (el.id === 'loader' && el.classList.contains('splash-screen'))) {
        el.style.setProperty('background-color', s.bgColor, 'important');
    }
}

function patchSplashDom(s) {
    if (!s || !s.enabled) return;
    if (typeof document === 'undefined') return;
    try {
        document.querySelectorAll('.splash-logo, .splash-message, #load-spinner, #preloader, #loader.splash-screen')
            .forEach((el) => patchElement(el, s));
        // Backdrop du popup transparent qui contient le splash
        document.querySelectorAll('.popup').forEach((dlg) => {
            if (dlg.querySelector && dlg.querySelector('#loader.splash-screen')) {
                dlg.style.setProperty('background-color', s.bgColor, 'important');
            }
        });
    } catch (e) {
        console.warn(LOG, 'patchSplashDom', e);
    }
}

function applyAll(s) {
    applyCssVars(s);
    patchSplashDom(s);
}

let observer = null;
let observedSettings = null;

function startObserver(s) {
    observedSettings = s;
    if (observer || typeof MutationObserver === 'undefined' || typeof document === 'undefined') return;
    observer = new MutationObserver((mutations) => {
        const cur = observedSettings || getSettings();
        if (!cur.enabled) return;
        for (const m of mutations) {
            if (m.type === 'childList') {
                for (const node of m.addedNodes) {
                    if (node.nodeType !== 1) continue;
                    patchElement(node, cur);
                    if (node.querySelectorAll) {
                        node.querySelectorAll('.splash-logo, .splash-message, #load-spinner, #loader.splash-screen, #preloader')
                            .forEach((el) => patchElement(el, cur));
                    }
                }
            } else if (m.type === 'attributes' && m.target) {
                patchElement(m.target, cur);
            }
        }
    });
    const root = document.documentElement || document.body;
    if (root) {
        observer.observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ['src', 'class', 'id'] });
    }
}

function stopObserver() {
    if (observer) {
        try { observer.disconnect(); } catch { /* ignoré */ }
        observer = null;
    }
}

// ---------------------------------------------------------------------------
// Réglages
// ---------------------------------------------------------------------------

function getSettings() {
    if (!extension_settings[MODULE_NAME] || typeof extension_settings[MODULE_NAME] !== 'object') {
        extension_settings[MODULE_NAME] = {};
    }
    const cleaned = sanitize(extension_settings[MODULE_NAME]);
    Object.assign(extension_settings[MODULE_NAME], cleaned);
    return extension_settings[MODULE_NAME];
}

function persist(s) {
    Object.assign(extension_settings[MODULE_NAME], sanitize(s));
    writeCache(extension_settings[MODULE_NAME]);
    observedSettings = extension_settings[MODULE_NAME];
    try { saveSettingsDebounced(); } catch (e) { console.warn(LOG, 'saveSettingsDebounced', e); }
}

function reapply() {
    const s = getSettings();
    applyAll(s);
    writeCache(s);
    observedSettings = s;
    if (s.enabled) startObserver(s);
    else stopObserver();
    return s;
}

// ---------------------------------------------------------------------------
// Aperçu (3–5 s)
// ---------------------------------------------------------------------------

let previewTimer = null;

function hidePreview() {
    clearTimeout(previewTimer);
    previewTimer = null;
    const el = document.getElementById(PREVIEW_ID);
    if (el) el.remove();
}

function showPreview(seconds) {
    hidePreview();
    const s = getSettings();
    const sec = clampNumber(seconds ?? s.previewSeconds, 4, 3, 5);
    applyCssVars({ ...s, enabled: true });

    const overlay = document.createElement('div');
    overlay.id = PREVIEW_ID;
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-label', 'Aperçu Splash Custom');

    const img = document.createElement('img');
    img.className = 'splash-logo';
    img.src = resolveImageSrc(s);
    img.alt = 'Splash';

    const msg = document.createElement('h2');
    msg.className = 'splash-message';
    msg.textContent = s.textLabel;

    overlay.appendChild(img);
    if (!s.hideText) overlay.appendChild(msg);
    document.body.appendChild(overlay);
    patchElement(img, { ...s, enabled: true });
    patchElement(msg, { ...s, enabled: true });

    previewTimer = setTimeout(() => {
        hidePreview();
        // Restaurer l'état enabled réel (si désactivé, retirer sc-active)
        applyCssVars(getSettings());
    }, sec * 1000);
}

// ---------------------------------------------------------------------------
// Panneau FR
// ---------------------------------------------------------------------------

function buildSettingsHtml() {
    return `
<div id="${PANEL_ID}" class="extension_container">
    <div class="inline-drawer">
        <div class="inline-drawer-toggle inline-drawer-header">
            <b>Splash Custom</b>
            <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
        </div>
        <div class="inline-drawer-content">
            <p class="sc-hint">Personnalise l'écran de lancement SillyTavern (logo / GIF, fond, texte). Les réglages sont mis en cache pour s'appliquer dès le prochain chargement.</p>

            <div class="sc-block sc-row">
                <label for="sc_enabled"><input type="checkbox" id="sc_enabled" /> Activer Splash Custom</label>
            </div>

            <hr />
            <div class="sc-block">
                <b>Image / GIF</b>
                <p class="sc-hint">URL https (ou data URL), ou fichier local (stocké dans les réglages de l'extension). GIF animés acceptés.</p>
                <div class="sc-row">
                    <label for="sc_image_url">URL</label>
                    <input type="url" id="sc_image_url" class="text_pole" placeholder="https://…/mon-logo.png ou .gif" />
                </div>
                <div class="sc-row">
                    <label for="sc_image_file">Fichier</label>
                    <input type="file" id="sc_image_file" accept="image/*,.gif" />
                </div>
                <div class="sc-row">
                    <button type="button" id="sc_clear_image" class="menu_button">Effacer l'image</button>
                </div>
                <img id="sc_thumb" class="sc-preview-thumb" alt="Aperçu image" />
            </div>

            <div class="sc-block">
                <b>Taille de l'image</b>
                <div class="sc-row">
                    <input type="number" id="sc_image_size" class="text_pole" min="16" max="800" step="1" />
                    <select id="sc_image_unit">
                        <option value="px">px</option>
                        <option value="%">%</option>
                    </select>
                </div>
            </div>

            <hr />
            <div class="sc-block">
                <b>Fond</b>
                <div class="sc-row">
                    <label for="sc_bg">Couleur</label>
                    <input type="color" id="sc_bg" />
                    <input type="text" id="sc_bg_hex" class="text_pole" maxlength="7" placeholder="#000000" />
                </div>
            </div>

            <hr />
            <div class="sc-block">
                <b>Texte « Initialisation… »</b>
                <div class="sc-row">
                    <label for="sc_hide_text"><input type="checkbox" id="sc_hide_text" /> Masquer le texte</label>
                </div>
                <div class="sc-row">
                    <label for="sc_text_label">Libellé</label>
                    <input type="text" id="sc_text_label" class="text_pole" maxlength="120" />
                </div>
                <div class="sc-row">
                    <label for="sc_text_color">Couleur</label>
                    <input type="color" id="sc_text_color" />
                    <input type="text" id="sc_text_hex" class="text_pole" maxlength="7" placeholder="#ffffff" />
                </div>
            </div>

            <div class="sc-block sc-row">
                <label for="sc_hide_spinner"><input type="checkbox" id="sc_hide_spinner" /> Masquer l'icône engrenage (#load-spinner)</label>
            </div>

            <div class="sc-block">
                <b>Aperçu</b>
                <p class="sc-hint">Réaffiche un splash factice 3–5 secondes pour tester sans recharger la page.</p>
                <div class="sc-row">
                    <label for="sc_preview_sec">Durée (s)</label>
                    <input type="number" id="sc_preview_sec" class="text_pole" min="3" max="5" step="1" />
                </div>
                <div class="sc-actions">
                    <button type="button" id="sc_preview_btn" class="menu_button">Aperçu</button>
                    <button type="button" id="sc_reset_btn" class="menu_button">Réinitialiser</button>
                </div>
            </div>

            <p class="sc-hint">Splash Custom ${VERSION} — hydravnss</p>
        </div>
    </div>
</div>`;
}

function updateThumb(s) {
    const $ = globalThis.jQuery;
    if (!$) return;
    const src = resolveImageSrc(s);
    const $img = $('#sc_thumb');
    if (src && src !== DEFAULT_LOGO) {
        $img.attr('src', src).addClass('sc-show');
    } else if (s.imageUrl || s.imageData) {
        $img.attr('src', src).addClass('sc-show');
    } else {
        $img.removeClass('sc-show').removeAttr('src');
    }
}

function syncUi() {
    const $ = globalThis.jQuery;
    if (!$ || !$(`#${PANEL_ID}`).length) return;
    const s = getSettings();
    $('#sc_enabled').prop('checked', s.enabled);
    $('#sc_image_url').val(s.imageUrl);
    $('#sc_image_size').val(s.imageSize);
    $('#sc_image_unit').val(s.imageSizeUnit);
    $('#sc_bg').val(s.bgColor);
    $('#sc_bg_hex').val(s.bgColor);
    $('#sc_hide_text').prop('checked', s.hideText);
    $('#sc_text_label').val(s.textLabel);
    $('#sc_text_color').val(s.textColor);
    $('#sc_text_hex').val(s.textColor);
    $('#sc_hide_spinner').prop('checked', s.hideSpinner);
    $('#sc_preview_sec').val(s.previewSeconds);
    updateThumb(s);
}

function bindUi() {
    const $ = globalThis.jQuery;
    if (!$ || $(`#${PANEL_ID}`).data('sc-bound')) return;
    $(`#${PANEL_ID}`).data('sc-bound', true);

    const change = (patch) => {
        const s = getSettings();
        Object.assign(s, patch);
        const cleaned = sanitize(s);
        Object.assign(s, cleaned);
        persist(s);
        applyAll(s);
        if (s.enabled) startObserver(s);
        else stopObserver();
        syncUi();
    };

    $('#sc_enabled').on('change', function () { change({ enabled: !!$(this).prop('checked') }); });
    $('#sc_image_url').on('change input', function () { change({ imageUrl: String($(this).val() || '') }); });
    $('#sc_image_size').on('change input', function () { change({ imageSize: Number($(this).val()) }); });
    $('#sc_image_unit').on('change', function () { change({ imageSizeUnit: $(this).val() === '%' ? '%' : 'px' }); });
    $('#sc_bg').on('input change', function () { change({ bgColor: $(this).val() }); });
    $('#sc_bg_hex').on('change', function () { change({ bgColor: normalizeHex($(this).val(), getSettings().bgColor) }); });
    $('#sc_hide_text').on('change', function () { change({ hideText: !!$(this).prop('checked') }); });
    $('#sc_text_label').on('change input', function () { change({ textLabel: String($(this).val() || '') }); });
    $('#sc_text_color').on('input change', function () { change({ textColor: $(this).val() }); });
    $('#sc_text_hex').on('change', function () { change({ textColor: normalizeHex($(this).val(), getSettings().textColor) }); });
    $('#sc_hide_spinner').on('change', function () { change({ hideSpinner: !!$(this).prop('checked') }); });
    $('#sc_preview_sec').on('change input', function () { change({ previewSeconds: Number($(this).val()) }); });

    $('#sc_clear_image').on('click', () => {
        change({ imageUrl: '', imageData: '' });
        $('#sc_image_file').val('');
    });

    $('#sc_image_file').on('change', function () {
        const file = this.files && this.files[0];
        if (!file) return;
        if (!/^image\//i.test(file.type) && !/\.gif$/i.test(file.name)) {
            toastr?.warning?.('Fichier image requis (PNG, JPG, GIF, WebP…).');
            return;
        }
        if (file.size > MAX_UPLOAD_BYTES) {
            toastr?.warning?.(`Fichier trop volumineux (max ~${Math.round(MAX_UPLOAD_BYTES / 1e6)} Mo). Utilisez une URL.`);
            return;
        }
        const reader = new FileReader();
        reader.onload = () => {
            const data = String(reader.result || '');
            if (!data.startsWith('data:image/')) {
                toastr?.error?.('Lecture du fichier impossible.');
                return;
            }
            change({ imageData: data, imageUrl: '' });
            toastr?.success?.('Image enregistrée dans les réglages.');
        };
        reader.onerror = () => toastr?.error?.('Erreur de lecture du fichier.');
        reader.readAsDataURL(file);
    });

    $('#sc_preview_btn').on('click', () => {
        const s = getSettings();
        showPreview(s.previewSeconds);
    });

    $('#sc_reset_btn').on('click', () => {
        extension_settings[MODULE_NAME] = { ...defaultSettings };
        persist(extension_settings[MODULE_NAME]);
        applyAll(getSettings());
        syncUi();
        toastr?.info?.('Réglages Splash Custom réinitialisés.');
    });
}

function mountSettings() {
    const $ = globalThis.jQuery;
    if (!$ || $(`#${PANEL_ID}`).length) return;
    const host = $('#extensions_settings2').length ? $('#extensions_settings2') : $('#extensions_settings');
    if (!host.length) {
        console.warn(LOG, 'Conteneur des réglages introuvable.');
        return;
    }
    host.append(buildSettingsHtml());
    syncUi();
    bindUi();
}

// ---------------------------------------------------------------------------
// Boot précoce (avant jQuery ready) — le splash est encore visible
// ---------------------------------------------------------------------------

(function earlyBoot() {
    try {
        if (typeof document === 'undefined') return;
        const cached = readCache();
        if (cached && cached.enabled) {
            applyAll(cached);
            startObserver(cached);
        }
    } catch (e) {
        console.warn(LOG, 'earlyBoot', e);
    }
})();

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------

function init() {
    try {
        if (typeof document === 'undefined') return; // tests Node
        const s = getSettings();
        writeCache(s);
        applyAll(s);
        if (s.enabled) startObserver(s);
        mountSettings();
        console.log(LOG, `chargé v${VERSION}`);
    } catch (e) {
        console.error(LOG, 'Initialisation échouée (chat non affecté)', e);
    }
}

if (typeof document !== 'undefined') {
    if (globalThis.jQuery) {
        globalThis.jQuery(() => init());
    } else {
        init();
    }
}

// API tests / console
globalThis.SplashCustom = {
    getSettings,
    reapply,
    showPreview,
    hidePreview,
    resolveImageSrc,
    sanitize,
    VERSION,
};

export const __test = {
    clampNumber,
    normalizeHex,
    sizeCss,
    resolveImageSrc,
    sanitize,
    defaultSettings,
    MODULE_NAME,
    CACHE_KEY,
    MAX_UPLOAD_BYTES,
    DEFAULT_LOGO,
    VERSION,
};
