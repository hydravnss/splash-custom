// E2E 1.0.1 — upload galerie (input file) sous Playwright WebKit iPhone 14 Pro.
// SillyTavern sur http://localhost:8000 ; extension liée dans public/scripts/extensions/third-party/splash-custom
// Usage: node test/st-upload-playwright.mjs   → captures /workspace/st-test-shots/splash-upload-*.png
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const pwRoot = fs.existsSync('/workspace/pw/node_modules/playwright')
    ? '/workspace/pw/node_modules/playwright'
    : 'playwright';
const { webkit, devices } = require(pwRoot);

const SHOTS = '/workspace/st-test-shots';
fs.mkdirSync(SHOTS, { recursive: true });
const shot = (page, name) => page.screenshot({ path: path.join(SHOTS, `splash-upload-${name}.png`) });

// GIF animé 2 frames 1x1 (rouge / bleu)
const GIF_B64 = 'R0lGODlhAQABAPAAAP8AAAAAACH/C05FVFNDQVBFMi4wAwEAAAAh+QQACgAAACwAAAAAAQABAAACAkQBACH5BAAKAAAALAAAAAABAAEAgAAA/wAAAAICRAEAOw==';

const results = [];
const check = (name, ok, extra = '') => {
    results.push(!!ok);
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  -> ' + extra : ''}`);
};

async function makeImage(page, { w, h, type, quality, noise }) {
    const b64 = await page.evaluate(({ w, h, type, quality, noise }) => {
        const c = document.createElement('canvas');
        c.width = w; c.height = h;
        const g = c.getContext('2d');
        const grad = g.createLinearGradient(0, 0, w, h);
        grad.addColorStop(0, '#ff3cac'); grad.addColorStop(0.5, '#784ba0'); grad.addColorStop(1, '#2b86c5');
        g.fillStyle = grad; g.fillRect(0, 0, w, h);
        g.fillStyle = '#ffffff';
        g.font = `bold ${Math.round(h / 4)}px sans-serif`;
        g.textAlign = 'center'; g.textBaseline = 'middle';
        g.fillText('ST', w / 2, h / 2);
        if (noise) {
            const d = g.getImageData(0, 0, w, h);
            for (let i = 0; i < d.data.length; i += 4) {
                const n = (Math.random() * 120) | 0;
                d.data[i] ^= n; d.data[i + 1] ^= n >> 1; d.data[i + 2] ^= n >> 2;
            }
            g.putImageData(d, 0, 0);
        }
        return c.toDataURL(type, quality).split(',')[1];
    }, { w, h, type, quality, noise });
    return Buffer.from(b64, 'base64');
}

async function openPanel(page) {
    await page.evaluate(() => {
        const t = document.querySelector('#extensions-settings-button .drawer-toggle');
        const content = document.getElementById('rm_extensions_block');
        if (t && content && !content.classList.contains('openDrawer')) t.click();
    });
    await page.waitForTimeout(600);
    await page.evaluate(() => {
        const p = document.getElementById('splash_custom_settings');
        const content = p?.querySelector('.inline-drawer-content');
        if (content && getComputedStyle(content).display === 'none') p.querySelector('.inline-drawer-toggle')?.click();
    });
    await page.waitForTimeout(500);
    await page.evaluate(() => {
        globalThis.toastr?.remove?.();
        const target = document.getElementById('splash_custom_settings')?.querySelector('.sc-block b');
        if (!target) return;
        let el = target.parentElement;
        while (el && el !== document.body) {
            const cs = getComputedStyle(el);
            if (/(auto|scroll)/.test(cs.overflowY) && el.scrollHeight > el.clientHeight) {
                el.scrollTop += target.getBoundingClientRect().top - el.getBoundingClientRect().top - 60;
                break;
            }
            el = el.parentElement;
        }
    });
    await page.waitForTimeout(300);
}

const state = (page) => page.evaluate(() => {
    const s = SillyTavern.getContext().extensionSettings['splash-custom'];
    const thumb = document.getElementById('sc_thumb');
    let cache = null;
    try { cache = JSON.parse(localStorage.getItem('sc_cache_v1') || 'null'); } catch { /* */ }
    return {
        data: s.imageData || '',
        name: s.imageName || '',
        hasUrlKey: 'imageUrl' in s,
        thumbShown: !!thumb && thumb.classList.contains('sc-show') && getComputedStyle(thumb).display !== 'none',
        thumbSrc: thumb?.getAttribute('src') || '',
        thumbLoaded: !!thumb && thumb.complete && thumb.naturalWidth > 0,
        thumbNatural: thumb ? [thumb.naturalWidth, thumb.naturalHeight] : null,
        status: document.getElementById('sc_image_status')?.textContent || '',
        cacheData: cache?.imageData || '',
    };
});

async function previewCheck(page, label, expectedPrefix, shotName) {
    await page.click('#sc_preview_btn');
    await page.waitForSelector('#sc-preview-overlay .splash-logo', { timeout: 5000 });
    await page.waitForFunction(() => {
        const i = document.querySelector('#sc-preview-overlay .splash-logo');
        return i && i.complete && i.naturalWidth > 0;
    }, null, { timeout: 5000 });
    const p = await page.evaluate(() => {
        const i = document.querySelector('#sc-preview-overlay .splash-logo');
        const r = i.getBoundingClientRect();
        return { src: i.getAttribute('src') || '', w: Math.round(r.width), h: Math.round(r.height), nat: i.naturalWidth };
    });
    check(`Aperçu splash (${label}) affiche l'image importée`, p.src.startsWith(expectedPrefix) && p.nat > 0 && p.w > 0 && p.h > 0,
        JSON.stringify({ ...p, src: p.src.slice(0, 30) }));
    await shot(page, shotName);
    await page.evaluate(() => window.SplashCustom.hidePreview());
    await page.waitForTimeout(200);
}

async function main() {
    const b = await webkit.launch();
    const ctx = await b.newContext({ ...devices['iPhone 14 Pro'], colorScheme: 'dark' });
    const page = await ctx.newPage();
    const errs = [];
    page.on('pageerror', (e) => errs.push('PAGE ' + e.message.slice(0, 240)));
    page.on('console', (m) => {
        if (m.type() === 'error' && !/interactive-widget|Failed to load resource|favicon/.test(m.text())) errs.push('CONSOLE ' + m.text().slice(0, 240));
    });

    await page.goto('http://localhost:8000/', { waitUntil: 'load', timeout: 60000 });
    await page.waitForFunction(() => window.SplashCustom && document.querySelector('#send_textarea') && document.getElementById('splash_custom_settings'), null, { timeout: 60000 });
    await page.waitForTimeout(1500);

    // Sauvegarde des réglages existants pour les restaurer à la fin
    const original = await page.evaluate(() => JSON.parse(JSON.stringify(SillyTavern.getContext().extensionSettings['splash-custom'] || {})));
    check('Version 1.0.1 chargée', await page.evaluate(() => window.SplashCustom.VERSION === '1.0.1'));

    // Partir d'un état propre (image effacée, extension active)
    await page.evaluate(() => {
        const s = SillyTavern.getContext().extensionSettings['splash-custom'];
        Object.assign(s, { enabled: true, imageData: '', imageName: '', bgColor: '#1a0033', textColor: '#ff66cc', textLabel: 'Chargement custom…', hideText: false, imageSize: 160, imageSizeUnit: 'px', previewSeconds: 5 });
        window.SplashCustom.reapply();
    });
    await page.evaluate(() => document.getElementById('sc_clear_image').click());
    await openPanel(page);

    // --- Panneau : plus de champ URL, input file galerie ---
    const ui = await page.evaluate(() => {
        const p = document.getElementById('splash_custom_settings');
        const inp = document.getElementById('sc_image_file');
        const label = document.querySelector('label[for="sc_image_file"]');
        const cs = inp ? getComputedStyle(inp) : null;
        return {
            urlField: !!document.getElementById('sc_image_url'),
            urlInputs: p.querySelectorAll('input[type="url"]').length,
            urlText: /\bURL\b/.test(p.querySelector('.inline-drawer-content').innerText),
            type: inp?.type,
            accept: inp?.getAttribute('accept'),
            capture: inp?.hasAttribute('capture'),
            multiple: inp?.multiple,
            display: cs?.display,
            label: label?.textContent.trim(),
            labelVisible: !!label && label.getBoundingClientRect().width > 0,
        };
    });
    check('Champ URL retiré du panneau', !ui.urlField && ui.urlInputs === 0 && !ui.urlText, JSON.stringify(ui));
    check('input file accept="image/*,image/gif"', ui.type === 'file' && ui.accept === 'image/*,image/gif', ui.accept);
    check('Pas d\'attribut capture (galerie iOS, pas caméra forcée)', ui.capture === false && ui.multiple === false);
    check('Input non display:none + bouton « Choisir dans la galerie » visible', ui.display !== 'none' && ui.labelVisible, `${ui.display} / ${ui.label}`);
    await shot(page, 'panel-empty');

    // --- Tap sur le bouton → sélecteur de fichier natif (galerie sur iOS) ---
    const png = await makeImage(page, { w: 320, h: 200, type: 'image/png' });
    const chooserP = page.waitForEvent('filechooser', { timeout: 5000 }).catch(() => null);
    await page.tap('#sc_pick_label');
    const chooser = await chooserP;
    check('Tap sur le bouton ouvre le sélecteur de fichier (filechooser)', !!chooser, chooser ? `multiple=${chooser.isMultiple()}` : 'aucun');
    if (chooser) {
        await chooser.setFiles({ name: 'IMG_0420.PNG', mimeType: 'image/png', buffer: png });
    } else {
        await page.setInputFiles('#sc_image_file', { name: 'IMG_0420.PNG', mimeType: 'image/png', buffer: png });
    }
    await page.waitForFunction(() => document.getElementById('sc_thumb')?.classList.contains('sc-show'), null, { timeout: 8000 }).catch(() => {});
    await page.waitForTimeout(400);
    let st = await state(page);
    check('Upload PNG → imageData data:image/png stocké en extensionSettings', st.data.startsWith('data:image/png;base64,') && st.name === 'IMG_0420.PNG', `${st.data.length} chars, ${st.name}`);
    check('Upload PNG → data URL identique au fichier', st.data === 'data:image/png;base64,' + png.toString('base64'));
    check('Upload PNG → miniature affichée et décodée', st.thumbShown && st.thumbLoaded && st.thumbSrc === st.data, JSON.stringify(st.thumbNatural));
    check('Upload PNG → statut + cache localStorage', st.status.includes('IMG_0420.PNG') && st.cacheData === st.data, st.status);
    check('Pas de clé imageUrl dans les réglages', !st.hasUrlKey);
    check('Case « Activer » cochée (synchro UI)', await page.evaluate(() => document.getElementById('sc_enabled').checked));
    await openPanel(page);
    await shot(page, 'panel-png');
    await previewCheck(page, 'PNG', 'data:image/png', 'preview-png');

    // --- GIF animé (setInputFiles direct) ---
    await page.setInputFiles('#sc_image_file', { name: 'anim.gif', mimeType: 'image/gif', buffer: Buffer.from(GIF_B64, 'base64') });
    await page.waitForFunction(() => (document.getElementById('sc_thumb')?.getAttribute('src') || '').startsWith('data:image/gif'), null, { timeout: 8000 }).catch(() => {});
    await page.waitForTimeout(300);
    st = await state(page);
    check('Upload GIF → conservé tel quel (data:image/gif, animation intacte)', st.data === 'data:image/gif;base64,' + GIF_B64, st.data.slice(0, 40));
    check('Upload GIF → miniature OK', st.thumbShown && st.thumbLoaded, JSON.stringify(st.thumbNatural));
    await page.evaluate(() => {
        const s = SillyTavern.getContext().extensionSettings['splash-custom'];
        s.imageSize = 50; s.imageSizeUnit = '%';
        window.SplashCustom.reapply();
    });
    await openPanel(page);
    await shot(page, 'panel-gif');
    await previewCheck(page, 'GIF', 'data:image/gif', 'preview-gif');

    // --- Grosse photo galerie (JPEG 4032x3024 bruité, type iPhone) → réduite ---
    const big = await makeImage(page, { w: 4032, h: 3024, type: 'image/jpeg', quality: 0.95, noise: true });
    await page.setInputFiles('#sc_image_file', { name: 'IMG_1234.JPG', mimeType: 'image/jpeg', buffer: big });
    await page.waitForFunction(() => (document.getElementById('sc_thumb')?.getAttribute('src') || '').startsWith('data:image/jpeg'), null, { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(400);
    st = await state(page);
    check('Photo lourde → réduite ≤1024 px et ≤1.8 Mo', st.data.startsWith('data:image/jpeg') && st.data.length <= 1_800_000 && Math.max(...(st.thumbNatural || [9999])) <= 1024,
        `source ${(big.length / 1e6).toFixed(2)} Mo → ${(st.data.length / 1e6).toFixed(2)} Mo, ${JSON.stringify(st.thumbNatural)}`);
    await page.evaluate(() => {
        const s = SillyTavern.getContext().extensionSettings['splash-custom'];
        s.imageSize = 220; s.imageSizeUnit = 'px';
        window.SplashCustom.reapply();
    });
    await openPanel(page);
    await shot(page, 'panel-photo');
    await previewCheck(page, 'photo réduite', 'data:image/jpeg', 'preview-photo');

    // --- Fichier non image refusé ---
    const before = st.data;
    await page.setInputFiles('#sc_image_file', { name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('hello') });
    await page.waitForTimeout(600);
    st = await state(page);
    check('Fichier non-image refusé (image précédente conservée)', st.data === before);

    // --- Effacer ---
    await page.click('#sc_clear_image');
    await page.waitForTimeout(300);
    st = await state(page);
    check('Effacer → retour logo ST, miniature masquée', st.data === '' && !st.thumbShown, st.status);

    // UI chat intacte
    const chatOk = await page.evaluate(() => !!document.getElementById('send_textarea') && !!document.getElementById('form_sheld') && !!document.getElementById('chat'));
    check('Chat / sendbar intacts', chatOk);
    const e = errs.filter((x) => !/Splash Custom/.test(x));
    check('Pas d\'erreur console critique', e.length === 0, JSON.stringify(e.slice(0, 3)));

    // Restauration des réglages initiaux
    await page.evaluate((orig) => {
        const ctx = SillyTavern.getContext();
        const s = ctx.extensionSettings['splash-custom'];
        for (const k of Object.keys(s)) delete s[k];
        Object.assign(s, orig);
        window.SplashCustom.reapply();
        ctx.saveSettingsDebounced?.();
    }, original);
    await page.waitForTimeout(1500);
    await b.close();

    const failed = results.filter((x) => !x).length;
    console.log(`\n${failed} échec(s) / ${results.length}`);
    process.exit(failed ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
