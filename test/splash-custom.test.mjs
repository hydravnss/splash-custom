// Tests unitaires (sans SillyTavern) : node test/splash-custom.test.mjs
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sc-test-'));
const extDir = path.join(root, 'scripts/extensions/third-party/splash-custom');
fs.mkdirSync(extDir, { recursive: true });
fs.copyFileSync(path.join(here, '../index.js'), path.join(extDir, 'index.js'));
fs.writeFileSync(path.join(root, 'script.js'), `
export const saveSettingsDebounced = () => {};
`);
fs.writeFileSync(path.join(root, 'scripts/extensions.js'), `
export const extension_settings = globalThis.__settings;
`);
globalThis.__settings = {};
globalThis.localStorage = {
    _d: {},
    getItem(k) { return Object.prototype.hasOwnProperty.call(this._d, k) ? this._d[k] : null; },
    setItem(k, v) { this._d[k] = String(v); },
    removeItem(k) { delete this._d[k]; },
};

const { __test: t } = await import(pathToFileURL(path.join(extDir, 'index.js')).href);

assert.equal(t.VERSION, '1.0.1');
assert.equal(t.MODULE_NAME, 'splash-custom');
assert.equal(t.clampNumber(999, 150, 16, 800), 800);
assert.equal(t.clampNumber(-1, 150, 16, 800), 16);
assert.equal(t.clampNumber('x', 42, 0, 100), 42);
assert.equal(t.normalizeHex('#fff'), '#ffffff');
assert.equal(t.normalizeHex('nope', '#112233'), '#112233');
assert.equal(t.sizeCss(200, 'px'), '200px');
assert.equal(t.sizeCss(50, '%'), '50%');
assert.equal(t.sizeCss(100, 'em'), '100px');
assert.equal(
    t.resolveImageSrc({ imageData: 'data:image/gif;base64,AAA', imageUrl: 'https://x/y.png' }),
    'data:image/gif;base64,AAA',
);
// 1.0.1 : plus d'URL distante — seule la data URL importée compte
assert.equal(t.resolveImageSrc({ imageData: '', imageUrl: 'https://cdn.example/a.gif' }), t.DEFAULT_LOGO);
assert.equal(t.resolveImageSrc({ imageData: 'https://cdn.example/a.gif' }), t.DEFAULT_LOGO);
assert.equal(t.resolveImageSrc({ imageData: '', imageUrl: '' }), t.DEFAULT_LOGO);
assert.equal(t.FILE_ACCEPT, 'image/*,image/gif');
assert.equal(t.isImageDataUrl('data:image/png;base64,AAA'), true);
assert.equal(t.isImageDataUrl('data:text/html,<b>'), false);
assert.equal(t.isImageDataUrl('javascript:alert(1)'), false);
assert.equal(t.isImageFile({ type: 'image/jpeg', name: 'IMG_0001.JPG' }), true);
assert.equal(t.isImageFile({ type: '', name: 'IMG_0002.HEIC' }), true);
assert.equal(t.isImageFile({ type: 'text/plain', name: 'x.gif' }), false);
assert.equal(t.isGifFile({ type: 'image/gif', name: 'a' }), true);
assert.equal(t.isGifFile({ type: '', name: 'anim.GIF' }), true);
// Migration 1.0.0 : ancienne URL data:image → imageData ; https ignorée ; champ imageUrl supprimé
assert.equal(t.sanitize({ imageUrl: 'data:image/gif;base64,R0l' }).imageData, 'data:image/gif;base64,R0l');
assert.equal(t.sanitize({ imageUrl: 'https://x/y.png' }).imageData, '');
assert.equal('imageUrl' in t.sanitize({ imageUrl: 'https://x/y.png' }), false);
assert.equal('imageUrl' in t.defaultSettings, false);
assert.equal(t.sanitize({ imageData: 'data:image/png;base64,A', imageName: 'a.png' }).imageName, 'a.png');
assert.equal(t.sanitize({ imageData: '', imageName: 'a.png' }).imageName, '');
assert.equal(t.sanitize({}).enabled, true);
assert.equal(t.sanitize({}).hideSpinner, true);
assert.equal(t.sanitize({ previewSeconds: 99 }).previewSeconds, 5);
assert.equal(t.sanitize({ previewSeconds: 1 }).previewSeconds, 3);
assert.equal(t.sanitize({ textLabel: 'x'.repeat(200) }).textLabel.length, 120);
assert.equal(t.defaultSettings.schema, 1);
assert.equal(t.defaultSettings.bgColor, '#000000');
assert.ok(t.MAX_UPLOAD_BYTES >= 500_000 && t.MAX_UPLOAD_BYTES <= 3_000_000);

const manifest = JSON.parse(fs.readFileSync(path.join(here, '../manifest.json'), 'utf8'));
assert.equal(manifest.version, '1.0.1');
assert.equal(manifest.loading_order, 1);
assert.equal(manifest.css, 'style.css');
assert.equal(manifest.js, 'index.js');
assert.equal(manifest.author, 'hydravnss');
assert.equal(manifest.display_name, 'Splash Custom');

const css = fs.readFileSync(path.join(here, '../style.css'), 'utf8');
assert.match(css, /splash-logo/);
assert.match(css, /#preloader/);
assert.match(css, /#sc-preview-overlay/);
assert.doesNotMatch(css, /#chat\s*[{,]/);
assert.doesNotMatch(css, /#form_sheld/);
assert.doesNotMatch(css, /#send_textarea/);

console.log('OK splash-custom unit tests');
