/**
 * Splash Custom 1.0.2 — extension SillyTavern
 * Personnalise l'écran de lancement (logo ST / GIF, fond, texte « Initialisation… »).
 *
 * 1.0.1 : upload galerie → data URL (plus de champ URL).
 * 1.0.2 : anti-flash iPhone — apply synchrone depuis localStorage AVANT le paint du logo ST
 * restant, style boot injecté (#sc-boot-style), couverture du logo ST, MutationObserver dès
 * le premier tick, re-show court (#sc-boot-overlay) si le splash ST a déjà disparu.
 *
 * ST peint le logo dans firstLoadInit() avant d'activer les extensions : on ne peut pas
 * modifier index.html. On maximise donc l'early apply (loading_order bas + cache + CSS +
 * observer + re-show).
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
const STYLE_ID = 'sc-boot-style';
const PREVIEW_ID = 'sc-preview-overlay';
const BOOT_OVERLAY_ID = 'sc-boot-overlay';
const BOOT_COVER_ID = 'sc-boot-cover';
const PANEL_ID = 'splash_custom_settings';
const BOOT_RESHOW_MS = 1800; // re-show court si le splash ST a déjà disparu (iPhone)
const CSS_BOOT_BEGIN = '/* BEGIN-SPLASH-CUSTOM-BOOT */';
const CSS_BOOT_END = '/* END-SPLASH-CUSTOM-BOOT */';
const BOOT_FILE_NAME = 'splash-custom-boot.img';
const SCHEMA = 1;
const VERSION = '1.0.2';
const MAX_UPLOAD_BYTES = 1_800_000; // ~1.8 Mo (data URL dans extensionSettings)
const MAX_SOURCE_BYTES = 25_000_000; // photo galerie brute acceptée avant redimensionnement
const MAX_DIMENSION = 1024; // px — les images fixes trop lourdes sont réduites (pas les GIF)
const FILE_ACCEPT = 'image/*,image/gif';
const IMAGE_EXT_RE = /\.(png|jpe?g|gif|webp|avif|heic|heif|bmp|svg)$/i;
const DEFAULT_LOGO = '/img/logo.png';
const HEX_RE = /^#[0-9a-f]{6}$/i;

const defaultSettings = Object.freeze({
    schema: SCHEMA,
    enabled: true,
    imageData: '', // data:image/... depuis upload fichier (galerie)
    imageName: '', // nom du fichier importé (affichage)
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

function isImageDataUrl(v) {
    return typeof v === 'string' && /^data:image\/[a-z0-9.+-]+[;,]/i.test(v.trim());
}

/** Fichier accepté comme image (type MIME image/* ou extension connue — iOS peut laisser type vide). */
function isImageFile(file) {
    if (!file) return false;
    const type = String(file.type || '');
    if (/^image\//i.test(type)) return true;
    return !type && IMAGE_EXT_RE.test(String(file.name || ''));
}

function isGifFile(file) {
    return !!file && (/^image\/gif$/i.test(String(file.type || '')) || /\.gif$/i.test(String(file.name || '')));
}

/** Source image effective : data URL importée (galerie) > logo ST par défaut. Aucune URL distante. */
function resolveImageSrc(s) {
    const data = s && typeof s.imageData === 'string' ? s.imageData.trim() : '';
    if (isImageDataUrl(data)) return data;
    return DEFAULT_LOGO;
}

function sanitize(src) {
    const d = defaultSettings;
    const o = (src && typeof src === 'object') ? src : {};
    const unit = o.imageSizeUnit === '%' ? '%' : 'px';
    // Migration 1.0.0 → 1.0.1 : une ancienne « URL » de type data:image devient imageData ;
    // les URL http(s) ne sont plus supportées (champ retiré).
    let imageData = isImageDataUrl(o.imageData) ? o.imageData.trim() : '';
    if (!imageData && isImageDataUrl(o.imageUrl)) imageData = o.imageUrl.trim();
    return {
        schema: SCHEMA,
        enabled: o.enabled !== false,
        imageData,
        imageName: imageData && typeof o.imageName === 'string' ? o.imageName.slice(0, 120) : '',
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

function hasCustomImage(s) {
    return !!(s && s.enabled && isImageDataUrl(s.imageData));
}

function applyCssVars(s) {
    if (typeof document === 'undefined') return;
    const root = document.documentElement;
    if (!root) return;
    if (!s || !s.enabled) {
        root.classList.remove('sc-active', 'sc-hide-text', 'sc-hide-spinner', 'sc-has-image');
        root.style.removeProperty('--sc-bg');
        root.style.removeProperty('--sc-text');
        root.style.removeProperty('--sc-size');
        root.style.removeProperty('--sc-img');
        return;
    }
    root.classList.add('sc-active');
    root.classList.toggle('sc-hide-text', !!s.hideText);
    root.classList.toggle('sc-hide-spinner', !!s.hideSpinner);
    root.classList.toggle('sc-has-image', hasCustomImage(s));
    root.style.setProperty('--sc-bg', s.bgColor);
    root.style.setProperty('--sc-text', s.textColor);
    root.style.setProperty('--sc-size', sizeCss(s.imageSize, s.imageSizeUnit));
    if (hasCustomImage(s)) {
        // URL encodée pour background-image CSS (guillemets échappés)
        const safe = String(s.imageData).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
        root.style.setProperty('--sc-img', `url("${safe}")`);
    } else {
        root.style.removeProperty('--sc-img');
    }
}

function patchElement(el, s) {
    if (!el || !s || !s.enabled) return;
    if (el.classList && el.classList.contains('splash-logo')) {
        // Cover / logo du re-show : gérés ailleurs
        if (el.id === BOOT_COVER_ID || el.id === 'sc-boot-logo' || el.getAttribute('data-sc-cover') === '1') return;
        const src = resolveImageSrc(s);
        const custom = hasCustomImage(s);
        if (el.getAttribute('src') !== src) el.setAttribute('src', src);
        el.alt = 'Splash';
        if (custom) {
            // Logo ST d'origine : masqué ; le cover affiche l'image custom
            el.setAttribute('data-sc-replaced', '1');
            el.style.setProperty('display', 'none', 'important');
            el.style.setProperty('opacity', '0', 'important');
            el.style.setProperty('visibility', 'hidden', 'important');
            el.setAttribute('aria-hidden', 'true');
            // S'assurer qu'un cover existe dès qu'on voit un logo ST
            coverStLogo(s);
        } else {
            el.style.setProperty('width', sizeCss(s.imageSize, s.imageSizeUnit), 'important');
            el.style.setProperty('height', 'auto', 'important');
            el.style.setProperty('max-width', 'min(90vw, ' + sizeCss(s.imageSize, s.imageSizeUnit) + ')', 'important');
            el.style.setProperty('object-fit', 'contain', 'important');
        }
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
    delete extension_settings[MODULE_NAME].imageUrl; // champ URL retiré en 1.0.1
    return extension_settings[MODULE_NAME];
}

function persist(s) {
    Object.assign(extension_settings[MODULE_NAME], sanitize(s));
    delete extension_settings[MODULE_NAME].imageUrl;
    writeCache(extension_settings[MODULE_NAME]);
    observedSettings = extension_settings[MODULE_NAME];
    try { syncEarlyCss(extension_settings[MODULE_NAME]); } catch (e) { console.warn(LOG, 'syncEarlyCss', e); }
    try { saveSettingsDebounced(); } catch (e) { console.warn(LOG, 'saveSettingsDebounced', e); }
}

function reapply() {
    const s = getSettings();
    applyAll(s);
    writeCache(s);
    observedSettings = s;
    if (s.enabled) startObserver(s);
    else stopObserver();
    syncUi();
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
                <p class="sc-hint">Choisis une image ou un GIF animé depuis ta galerie / tes fichiers. Elle est stockée directement dans les réglages de l'extension (aucun lien à coller). Les grosses photos sont réduites automatiquement ; GIF max ~${Math.round(MAX_UPLOAD_BYTES / 1e5) / 10} Mo.</p>
                <div class="sc-row sc-upload-row">
                    <input type="file" id="sc_image_file" class="sc-file-input" accept="${FILE_ACCEPT}" />
                    <label for="sc_image_file" id="sc_pick_label" class="menu_button sc-pick" role="button" tabindex="0">
                        <i class="fa-solid fa-images"></i> Choisir dans la galerie
                    </label>
                    <button type="button" id="sc_clear_image" class="menu_button">Effacer l'image</button>
                </div>
                <div id="sc_image_status" class="sc-hint" aria-live="polite"></div>
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

function formatKb(chars) {
    // Taille approximative du binaire encodé en base64
    return `${Math.max(1, Math.round((chars * 3) / 4 / 1024))} Ko`;
}

function updateThumb(s) {
    const $ = globalThis.jQuery;
    if (!$) return;
    const src = resolveImageSrc(s);
    const $img = $('#sc_thumb');
    const $status = $('#sc_image_status');
    if (src !== DEFAULT_LOGO) {
        if ($img.attr('src') !== src) $img.attr('src', src);
        $img.addClass('sc-show');
        const name = s.imageName ? `« ${s.imageName} »` : 'Image importée';
        $status.text(`${name} — ${formatKb(src.length)}`);
    } else {
        $img.removeClass('sc-show').removeAttr('src');
        $status.text('Aucune image : logo SillyTavern par défaut.');
    }
}

function loadImage(src) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error('image illisible'));
        img.src = src;
    });
}

function readAsDataUrl(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ''));
        reader.onerror = () => reject(reader.error || new Error('lecture impossible'));
        reader.readAsDataURL(file);
    });
}

/**
 * Lit un fichier de la galerie et renvoie une data URL image prête à stocker.
 * - GIF : conservé tel quel (animation), refusé au-delà de MAX_UPLOAD_BYTES.
 * - Autres : conservés si légers, sinon réduits à MAX_DIMENSION px (canvas → JPEG/PNG).
 */
async function fileToStoredDataUrl(file) {
    if (!isImageFile(file)) throw new Error('Fichier image requis (PNG, JPG, GIF, WebP…).');
    if (isGifFile(file)) {
        if (file.size > MAX_UPLOAD_BYTES) {
            throw new Error(`GIF trop volumineux (max ~${Math.round(MAX_UPLOAD_BYTES / 1e5) / 10} Mo).`);
        }
        let data = await readAsDataUrl(file);
        if (data.startsWith('data:application/octet-stream') || data.startsWith('data:;')) {
            data = data.replace(/^data:[^;,]*/, 'data:image/gif');
        }
        if (!isImageDataUrl(data)) throw new Error('Lecture du fichier impossible.');
        return data;
    }
    if (file.size > MAX_SOURCE_BYTES) throw new Error('Fichier trop volumineux.');
    let data = await readAsDataUrl(file);
    if (!isImageDataUrl(data)) {
        const ext = (String(file.name || '').match(IMAGE_EXT_RE) || [])[1] || 'png';
        const mime = ext.toLowerCase() === 'jpg' ? 'jpeg' : ext.toLowerCase() === 'svg' ? 'svg+xml' : ext.toLowerCase();
        data = data.replace(/^data:[^;,]*/, `data:image/${mime}`);
    }
    if (!isImageDataUrl(data)) throw new Error('Lecture du fichier impossible.');
    let img = null;
    try { img = await loadImage(data); } catch { /* format non décodable : on garde tel quel si léger */ }
    const tooBig = data.length > MAX_UPLOAD_BYTES;
    const tooLarge = img && Math.max(img.naturalWidth, img.naturalHeight) > MAX_DIMENSION;
    if (!img || (!tooBig && !tooLarge) || /^data:image\/svg/i.test(data)) {
        if (tooBig) throw new Error('Image trop volumineuse.');
        return data;
    }
    const ratio = Math.min(1, MAX_DIMENSION / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.max(1, Math.round(img.naturalWidth * ratio));
    const h = Math.max(1, Math.round(img.naturalHeight * ratio));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    canvas.getContext('2d').drawImage(img, 0, 0, w, h);
    const keepAlpha = /^image\/(png|webp|avif)$/i.test(file.type || '');
    let out = keepAlpha ? canvas.toDataURL('image/png') : '';
    if (!out || out.length > MAX_UPLOAD_BYTES) out = canvas.toDataURL('image/jpeg', 0.85);
    if (out.length > MAX_UPLOAD_BYTES) out = canvas.toDataURL('image/jpeg', 0.6);
    if (!isImageDataUrl(out) || out.length > MAX_UPLOAD_BYTES) throw new Error('Image trop volumineuse même réduite.');
    return out;
}

function syncUi() {
    const $ = globalThis.jQuery;
    if (!$ || !$(`#${PANEL_ID}`).length) return;
    const s = getSettings();
    $('#sc_enabled').prop('checked', s.enabled);
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
        change({ imageData: '', imageName: '' });
        $('#sc_image_file').val('');
    });

    // Clavier : Entrée / Espace sur le bouton-label ouvre le sélecteur (le tap/clic passe nativement par <label for>).
    $('#sc_pick_label').on('keydown', function (ev) {
        if (ev.key === 'Enter' || ev.key === ' ') {
            ev.preventDefault();
            document.getElementById('sc_image_file')?.click();
        }
    });

    $('#sc_image_file').on('change', async function () {
        const input = this;
        const file = input.files && input.files[0];
        if (!file) return;
        $('#sc_image_status').text('Import en cours…');
        try {
            const data = await fileToStoredDataUrl(file);
            change({ imageData: data, imageName: String(file.name || 'image').slice(0, 120) });
            toastr?.success?.('Image enregistrée dans les réglages.');
        } catch (e) {
            console.warn(LOG, 'upload', e);
            toastr?.warning?.(e?.message || 'Erreur de lecture du fichier.');
            updateThumb(getSettings());
        } finally {
            input.value = ''; // permet de re-sélectionner le même fichier
        }
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


/**
 * Bloc CSS injecté dans power_user.custom_css — appliqué par ST dans
 * applyPowerUserSettings() AVANT loadExtensionSettings(). Masque le logo ST et
 * affiche l'image custom via ::before dès que les réglages power user sont là
 * (plus tôt que le JS de l'extension).
 */
function buildEarlyCssBlock(s) {
    if (!s || !s.enabled || !hasCustomImage(s)) return '';
    const size = sizeCss(s.imageSize, s.imageSizeUnit);
    const safe = String(s.imageData).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '');
    const bg = s.bgColor;
    const tc = s.textColor;
    const hideMsg = s.hideText
        ? '#loader.splash-screen .splash-message{display:none!important;}'
        : `#loader.splash-screen .splash-message{color:${tc}!important;}`;
    const hideSpin = s.hideSpinner ? '#loader.splash-screen #load-spinner{display:none!important;}' : '';
    return `${CSS_BOOT_BEGIN}
#preloader,#loader.splash-screen,.popup:has(#loader.splash-screen),.popup:has(#loader.splash-screen) .popup-body,.popup:has(#loader.splash-screen) .popup-content{background-color:${bg}!important;background-image:none!important;color:${tc}!important;}
#loader.splash-screen img.splash-logo:not(#sc-boot-cover):not([data-sc-cover="1"]):not(#sc-boot-logo){opacity:0!important;visibility:hidden!important;position:absolute!important;width:0!important;height:0!important;overflow:hidden!important;}
#loader.splash-screen::before{content:"";display:block;width:${size};max-width:min(90vw,${size});aspect-ratio:1;height:auto;min-height:${size};background-image:url("${safe}");background-size:contain;background-repeat:no-repeat;background-position:center;filter:drop-shadow(0 4px 8px rgba(0,0,0,.35));flex-shrink:0;}
html.sc-has-image #loader.splash-screen::before{display:none!important;}
${hideMsg}${hideSpin}
${CSS_BOOT_END}`;
}

function stripEarlyCssBlock(css) {
    const src = String(css || '');
    const i = src.indexOf(CSS_BOOT_BEGIN);
    if (i < 0) return src.trimEnd();
    const j = src.indexOf(CSS_BOOT_END, i);
    if (j < 0) return (src.slice(0, i) + src.slice(i + CSS_BOOT_BEGIN.length)).trimEnd();
    return (src.slice(0, i) + src.slice(j + CSS_BOOT_END.length)).replace(/\n{3,}/g, '\n\n').trimEnd();
}

function syncEarlyCss(s) {
    try {
        // power_user est un export live de ST ; on le récupère sans import statique
        // pour ne pas retarder earlyBoot.
        const ctx = globalThis.SillyTavern?.getContext?.();
        const pu = globalThis.power_user
            || ctx?.powerUserSettings
            || ctx?.powerUser
            || null;
        if (!pu || typeof pu !== 'object') return false;
        const cleaned = stripEarlyCssBlock(pu.custom_css || '');
        const block = buildEarlyCssBlock(s);
        const next = block ? (cleaned ? `${cleaned}\n\n${block}\n` : `${block}\n`) : (cleaned ? `${cleaned}\n` : '');
        if (pu.custom_css === next) return !!block;
        pu.custom_css = next;
        // Appliquer immédiatement si le <style id="custom-style"> existe déjà
        let style = document.getElementById('custom-style');
        if (!style && document.head) {
            style = document.createElement('style');
            style.id = 'custom-style';
            document.head.appendChild(style);
        }
        if (style) style.textContent = next;
        const ta = document.getElementById('customCSS');
        if (ta && ta.value !== next) ta.value = next;
        return !!block;
    } catch (e) {
        console.warn(LOG, 'syncEarlyCss', e);
        return false;
    }
}

// ---------------------------------------------------------------------------
// Boot précoce — maximiser l'apply AVANT / PENDANT le splash ST
// ST crée #loader.splash-screen + .splash-logo (src=/img/logo.png) dans
// firstLoadInit(), puis charge les extensions plus tard. Sur iPhone le splash
// peut disparaître avant que ce module tourne → re-show court.
// ---------------------------------------------------------------------------

function injectBootStyle(s) {
    if (typeof document === 'undefined' || !s || !s.enabled) return;
    let style = document.getElementById(STYLE_ID);
    if (!style) {
        style = document.createElement('style');
        style.id = STYLE_ID;
        // Le plus haut possible dans <head> pour gagner la course au paint
        const head = document.head || document.documentElement;
        if (head.firstChild) head.insertBefore(style, head.firstChild);
        else head.appendChild(style);
    }
    const size = sizeCss(s.imageSize, s.imageSizeUnit);
    const hasImg = hasCustomImage(s);
    const imgRule = hasImg
        ? `html.sc-has-image #loader.splash-screen img.splash-logo:not(#${BOOT_COVER_ID}):not([src^="data:"]) {
    opacity: 0 !important;
    visibility: hidden !important;
}
html.sc-has-image #loader.splash-screen img.splash-logo[src^="data:"],
html.sc-has-image #${BOOT_COVER_ID},
html.sc-has-image #sc-boot-logo {
    opacity: 1 !important;
    visibility: visible !important;
}
html.sc-has-image #${BOOT_COVER_ID} {
    display: block !important;
    width: var(--sc-size, ${size}) !important;
    max-width: min(90vw, var(--sc-size, ${size})) !important;
    height: auto !important;
    object-fit: contain !important;
    filter: drop-shadow(0 4px 8px rgba(0, 0, 0, 0.35));
    margin: 0 !important;
}`
        : '';
    style.textContent = `
html.sc-active #preloader,
html.sc-active #loader.splash-screen,
html.sc-active .popup:has(#loader.splash-screen),
html.sc-active .popup:has(#loader.splash-screen) .popup-body,
html.sc-active .popup:has(#loader.splash-screen) .popup-content,
html.sc-active #${BOOT_OVERLAY_ID} {
    background-color: var(--sc-bg, ${s.bgColor}) !important;
    background-image: none !important;
    color: var(--sc-text, ${s.textColor}) !important;
}
html.sc-active.sc-hide-spinner #loader.splash-screen #load-spinner { display: none !important; }
html.sc-active.sc-hide-text #loader.splash-screen .splash-message,
html.sc-active.sc-hide-text #${BOOT_OVERLAY_ID} .splash-message { display: none !important; }
${imgRule}
#${BOOT_OVERLAY_ID} {
    position: fixed !important;
    inset: 0 !important;
    z-index: 2147483646 !important;
    display: flex !important;
    flex-direction: column !important;
    align-items: center !important;
    justify-content: center !important;
    gap: 4rem !important;
    margin: 0 !important;
    padding: 0 !important;
    width: 100vw !important;
    height: 100vh !important;
    width: 100dvw !important;
    height: 100dvh !important;
    pointer-events: none !important;
}
#${BOOT_OVERLAY_ID} .splash-message {
    margin: 0;
    font-size: 1.25rem;
    font-weight: 500;
    opacity: 0.9;
    letter-spacing: 0.02em;
    color: var(--sc-text, ${s.textColor}) !important;
}
`.replace(/\n\s+/g, '\n');
}

/** Pré-décode la data URL pour que le swap src soit immédiat (pas de frame vide). */
function predecodeImage(s) {
    if (!hasCustomImage(s) || typeof Image === 'undefined') return;
    try {
        const img = new Image();
        img.decoding = 'sync';
        img.src = s.imageData;
        if (img.decode) img.decode().catch(() => {});
    } catch { /* ignoré */ }
}

/**
 * Couvre le logo ST d'une img custom (même parent) : même si un frame ST a déjà
 * été peint, la couverture le masque dès le premier tick de l'extension.
 */
function coverStLogo(s) {
    if (typeof document === 'undefined' || !hasCustomImage(s)) return;
    const loader = document.querySelector('#loader.splash-screen');
    if (!loader) return;
    // Tous les logos ST d'origine (pas notre cover) : on les retire du flux
    // et on swap leur src pour qu'aucune capture / paint ne montre /img/logo.png.
    const stLogos = loader.querySelectorAll('img.splash-logo:not(#' + BOOT_COVER_ID + ')');
    stLogos.forEach((stLogo) => {
        if (stLogo.getAttribute('src') !== s.imageData) stLogo.setAttribute('src', s.imageData);
        stLogo.setAttribute('data-sc-replaced', '1');
        stLogo.style.setProperty('display', 'none', 'important');
        stLogo.style.setProperty('opacity', '0', 'important');
        stLogo.style.setProperty('visibility', 'hidden', 'important');
        stLogo.setAttribute('aria-hidden', 'true');
    });
    let cover = document.getElementById(BOOT_COVER_ID);
    if (!cover) {
        cover = document.createElement('img');
        cover.id = BOOT_COVER_ID;
        cover.className = 'splash-logo';
        cover.alt = 'Splash';
        cover.setAttribute('data-sc-cover', '1');
        const anchor = stLogos[0];
        if (anchor && anchor.parentNode === loader) loader.insertBefore(cover, anchor);
        else loader.insertBefore(cover, loader.firstChild);
    }
    if (cover.getAttribute('src') !== s.imageData) cover.setAttribute('src', s.imageData);
    cover.style.setProperty('display', 'block', 'important');
    cover.style.setProperty('position', 'static', 'important');
    cover.style.setProperty('width', sizeCss(s.imageSize, s.imageSizeUnit), 'important');
    cover.style.setProperty('height', 'auto', 'important');
    cover.style.setProperty('max-width', 'min(90vw, ' + sizeCss(s.imageSize, s.imageSizeUnit) + ')', 'important');
    cover.style.setProperty('object-fit', 'contain', 'important');
    cover.style.setProperty('opacity', '1', 'important');
    cover.style.setProperty('visibility', 'visible', 'important');
    cover.style.removeProperty('overflow');
}

function hideBootOverlay() {
    const el = document.getElementById(BOOT_OVERLAY_ID);
    if (el) el.remove();
}

let bootReshowTimer = null;

/**
 * Si le splash ST est encore là : patch + cover.
 * S'il a déjà disparu (cas iPhone) : re-show court avec l'image custom.
 */
function ensureCustomSplashVisible(s) {
    if (typeof document === 'undefined' || !hasCustomImage(s)) return;
    const live = document.querySelector('#loader.splash-screen');
    if (live) {
        coverStLogo(s);
        patchSplashDom(s);
        return;
    }
    // Trop tard : le splash ST est parti — re-show court pour que l'utilisateur
    // voie SON image plutôt que rien / un flash ST déjà passé.
    if (document.getElementById(BOOT_OVERLAY_ID) || document.getElementById(PREVIEW_ID)) return;
    const overlay = document.createElement('div');
    overlay.id = BOOT_OVERLAY_ID;
    overlay.setAttribute('role', 'presentation');
    overlay.setAttribute('aria-hidden', 'true');
    const img = document.createElement('img');
    img.id = 'sc-boot-logo';
    img.className = 'splash-logo';
    img.src = s.imageData;
    img.alt = 'Splash';
    overlay.appendChild(img);
    if (!s.hideText) {
        const msg = document.createElement('h2');
        msg.className = 'splash-message';
        msg.textContent = s.textLabel;
        overlay.appendChild(msg);
    }
    (document.body || document.documentElement).appendChild(overlay);
    clearTimeout(bootReshowTimer);
    bootReshowTimer = setTimeout(() => {
        hideBootOverlay();
        bootReshowTimer = null;
    }, BOOT_RESHOW_MS);
}

function scheduleRepatch(s) {
    const run = () => {
        try {
            patchSplashDom(s);
            coverStLogo(s);
        } catch { /* ignoré */ }
    };
    run();
    if (typeof queueMicrotask === 'function') queueMicrotask(run);
    else Promise.resolve().then(run);
    if (typeof requestAnimationFrame === 'function') {
        requestAnimationFrame(() => {
            run();
            requestAnimationFrame(run);
        });
    }
    // Filet de sécurité : quelques ticks au cas où ST recrée le logo
    [16, 50, 100, 250, 500].forEach((ms) => setTimeout(run, ms));
}

(function earlyBoot() {
    try {
        if (typeof document === 'undefined') return;
        const cached = readCache();
        if (!cached || !cached.enabled) return;
        // Ordre critique : style inline → vars/classes → prédecode → observer → patch → cover/re-show
        injectBootStyle(cached);
        applyCssVars(cached);
        predecodeImage(cached);
        startObserver(cached);
        patchSplashDom(cached);
        coverStLogo(cached);
        ensureCustomSplashVisible(cached);
        scheduleRepatch(cached);
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
        syncEarlyCss(s);
        injectBootStyle(s);
        applyAll(s);
        if (s.enabled) {
            startObserver(s);
            predecodeImage(s);
            coverStLogo(s);
            // Si earlyBoot a déjà posé un re-show, on ne le double pas ;
            // sinon (cache vide au earlyBoot, settings maintenant OK) on assure.
            ensureCustomSplashVisible(s);
            scheduleRepatch(s);
        } else {
            hideBootOverlay();
            stopObserver();
        }
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
    fileToStoredDataUrl,
    hasCustomImage,
    injectBootStyle,
    coverStLogo,
    ensureCustomSplashVisible,
    hideBootOverlay,
    syncEarlyCss,
    buildEarlyCssBlock,
    stripEarlyCssBlock,
    VERSION,
};

export const __test = {
    clampNumber,
    normalizeHex,
    sizeCss,
    resolveImageSrc,
    sanitize,
    isImageDataUrl,
    isImageFile,
    isGifFile,
    hasCustomImage,
    buildEarlyCssBlock,
    stripEarlyCssBlock,
    CSS_BOOT_BEGIN,
    CSS_BOOT_END,
    defaultSettings,
    FILE_ACCEPT,
    MODULE_NAME,
    CACHE_KEY,
    MAX_UPLOAD_BYTES,
    DEFAULT_LOGO,
    BOOT_OVERLAY_ID,
    BOOT_COVER_ID,
    STYLE_ID,
    VERSION,
};
