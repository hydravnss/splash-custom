// E2E Playwright WebKit iPhone 14 Pro — SillyTavern 1.19 sur http://localhost:8000
// Usage: node test/st-playwright.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const pwRoot = fs.existsSync('/workspace/pw/node_modules/playwright')
    ? '/workspace/pw/node_modules/playwright'
    : 'playwright';
const { webkit, devices } = require(pwRoot);

const SHOTS = '/workspace/st-test-shots';
fs.mkdirSync(SHOTS, { recursive: true });

const TINY_PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAoAAAAKCAYAAACNMs+7AAAAFUlEQVR42mNk+M9Qz0AEYBxVSF+FABJADveWkH6aAAAAAElFTkSuQmCC';
// GIF 1x1 rouge animé minimal
const TINY_GIF = 'data:image/gif;base64,R0lGODlhAQABAIAAAAUEBAAAACwAAAAAAQABAAACAkQBADs=';

const results = [];
const check = (name, ok, extra = '') => {
    results.push(!!ok);
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  -> ' + extra : ''}`);
};

async function launch() {
    const b = await webkit.launch();
    const ctx = await b.newContext({ ...devices['iPhone 14 Pro'], colorScheme: 'dark' });
    const page = await ctx.newPage();
    const errs = [];
    page.on('pageerror', (e) => errs.push('PAGE ' + e.message.slice(0, 240)));
    page.on('console', (m) => {
        if (m.type() === 'error' && !/interactive-widget|Failed to load resource|favicon/.test(m.text())) {
            errs.push('CONSOLE ' + m.text().slice(0, 240));
        }
    });
    return { b, page, errs };
}

async function waitReady(page) {
    await page.goto('http://localhost:8000/', { waitUntil: 'load', timeout: 60000 });
    await page.waitForFunction(() => window.SplashCustom && document.querySelector('#send_textarea'), null, { timeout: 60000 });
    await page.waitForTimeout(1500);
}

async function main() {
    // 1) Aperçu + image PNG
    {
        const { b, page, errs } = await launch();
        await waitReady(page);

        const hasApi = await page.evaluate(() => !!window.SplashCustom);
        check('API SplashCustom exposée', hasApi);

        await page.evaluate((png) => {
            const s = SillyTavern.getContext().extensionSettings['splash-custom'];
            Object.assign(s, {
                enabled: true,
                imageData: png,
                imageUrl: '',
                bgColor: '#1a0033',
                textLabel: 'Chargement custom…',
                textColor: '#ff66cc',
                imageSize: 120,
                imageSizeUnit: 'px',
                hideText: false,
                hideSpinner: true,
                previewSeconds: 4,
            });
            window.SplashCustom.reapply();
        }, TINY_PNG);

        const panel = await page.evaluate(() => !!document.getElementById('splash_custom_settings'));
        check('Panneau #splash_custom_settings monté', panel);

        await page.evaluate(() => window.SplashCustom.showPreview(4));
        await page.waitForSelector('#sc-preview-overlay', { timeout: 5000 });
        await page.waitForTimeout(400);

        const preview = await page.evaluate(() => {
            const o = document.getElementById('sc-preview-overlay');
            const img = o?.querySelector('.splash-logo');
            const msg = o?.querySelector('.splash-message');
            const cs = getComputedStyle(o);
            return {
                exists: !!o,
                src: img?.getAttribute('src')?.slice(0, 40) || '',
                label: msg?.textContent || '',
                bg: cs.backgroundColor,
                htmlActive: document.documentElement.classList.contains('sc-active'),
            };
        });
        check('Aperçu visible (#sc-preview-overlay)', preview.exists && preview.htmlActive, JSON.stringify(preview));
        check('Aperçu : image data PNG', preview.src.startsWith('data:image/png'), preview.src);
        check('Aperçu : libellé custom', preview.label === 'Chargement custom…', preview.label);
        check('Aperçu : fond violet appliqué', /26,\s*0,\s*51|rgb\(26,\s*0,\s*51\)/.test(preview.bg) || preview.bg.includes('26'), preview.bg);

        await page.screenshot({ path: path.join(SHOTS, 'splash-preview-png.png') });

        await page.waitForTimeout(4200);
        const gone = await page.evaluate(() => !document.getElementById('sc-preview-overlay'));
        check('Aperçu disparaît après ~4 s', gone);

        // Sendbar / chat intacts
        const ui = await page.evaluate(() => {
            const ta = document.getElementById('send_textarea');
            const form = document.getElementById('form_sheld');
            const chat = document.getElementById('chat');
            return {
                ta: !!ta,
                form: !!form,
                chat: !!chat,
                taDisp: ta ? getComputedStyle(ta).display : null,
                formPos: form ? getComputedStyle(form).position : null,
            };
        });
        check('Sendbar / chat présents (non cassés)', ui.ta && ui.form && ui.chat && ui.taDisp !== 'none', JSON.stringify(ui));

        const e = errs.filter((x) => !/Splash Custom/.test(x));
        check('Pas d’erreur console critique (PNG)', e.length === 0, JSON.stringify(e.slice(0, 3)));
        await b.close();
    }

    // 2) GIF + masquage texte + fond noir
    {
        const { b, page, errs } = await launch();
        await waitReady(page);

        await page.evaluate((gif) => {
            const s = SillyTavern.getContext().extensionSettings['splash-custom'];
            Object.assign(s, {
                enabled: true,
                imageData: gif,
                imageUrl: '',
                bgColor: '#000000',
                hideText: true,
                textLabel: 'Initialisation...',
                textColor: '#ffffff',
                imageSize: 50,
                imageSizeUnit: '%',
                hideSpinner: true,
                previewSeconds: 3,
            });
            window.SplashCustom.reapply();
            window.SplashCustom.showPreview(3);
        }, TINY_GIF);

        await page.waitForSelector('#sc-preview-overlay', { timeout: 5000 });
        await page.waitForTimeout(300);
        const gifState = await page.evaluate(() => {
            const o = document.getElementById('sc-preview-overlay');
            const img = o?.querySelector('.splash-logo');
            const msg = o?.querySelector('.splash-message');
            return {
                src: img?.getAttribute('src')?.startsWith('data:image/gif') || false,
                msgHidden: !msg || getComputedStyle(msg).display === 'none' || document.documentElement.classList.contains('sc-hide-text'),
                size: getComputedStyle(img).width,
            };
        });
        check('GIF data URL sur le logo', gifState.src, JSON.stringify(gifState));
        check('Texte masqué (hideText)', gifState.msgHidden, JSON.stringify(gifState));

        await page.screenshot({ path: path.join(SHOTS, 'splash-preview-gif.png') });
        await page.waitForTimeout(3200);

        // Désactivation
        await page.evaluate(() => {
            const s = SillyTavern.getContext().extensionSettings['splash-custom'];
            s.enabled = false;
            window.SplashCustom.reapply();
            window.SplashCustom.showPreview(2);
        });
        await page.waitForTimeout(200);
        // Même en preview on force enabled dans showPreview via applyCssVars({...s, enabled:true})
        // Vérifier plutôt que reapply hors preview retire sc-active
        await page.evaluate(() => window.SplashCustom.hidePreview());
        await page.evaluate(() => {
            const s = SillyTavern.getContext().extensionSettings['splash-custom'];
            s.enabled = false;
            window.SplashCustom.reapply();
        });
        const off = await page.evaluate(() => !document.documentElement.classList.contains('sc-active'));
        check('Désactivé : html.sc-active retiré', off);

        await page.screenshot({ path: path.join(SHOTS, 'splash-disabled.png') });

        const e = errs.filter((x) => !/Splash Custom/.test(x));
        check('Pas d’erreur console critique (GIF)', e.length === 0, JSON.stringify(e.slice(0, 3)));
        await b.close();
    }

    // 3) Simulateur splash DOM ST (logo + message + spinner) sans recharger
    {
        const { b, page, errs } = await launch();
        await waitReady(page);

        await page.evaluate((png) => {
            const s = SillyTavern.getContext().extensionSettings['splash-custom'];
            Object.assign(s, {
                enabled: true,
                imageData: png,
                bgColor: '#002244',
                textLabel: 'Init test DOM',
                textColor: '#00ffcc',
                imageSize: 100,
                imageSizeUnit: 'px',
                hideText: false,
                hideSpinner: true,
            });
            window.SplashCustom.reapply();

            // Simule le DOM splash ST 1.19
            const loader = document.createElement('div');
            loader.id = 'loader';
            loader.className = 'splash-screen';
            const logo = document.createElement('img');
            logo.className = 'splash-logo';
            logo.src = '/img/logo.png';
            const spin = document.createElement('div');
            spin.id = 'load-spinner';
            spin.className = 'fa-solid fa-gear fa-spin';
            const msg = document.createElement('h2');
            msg.className = 'splash-message';
            msg.textContent = 'Initializing…';
            loader.append(logo, spin, msg);
            document.body.appendChild(loader);
        }, TINY_PNG);

        await page.waitForTimeout(500);
        const dom = await page.evaluate(() => {
            const logo = document.querySelector('#loader.splash-screen .splash-logo');
            const msg = document.querySelector('#loader.splash-screen .splash-message');
            const spin = document.querySelector('#loader.splash-screen #load-spinner');
            return {
                src: logo?.getAttribute('src')?.startsWith('data:image/png') || false,
                label: msg?.textContent || '',
                spinDisplay: spin ? getComputedStyle(spin).display : null,
                bg: getComputedStyle(document.getElementById('loader')).backgroundColor,
            };
        });
        check('Observer : logo remplacé (PNG)', dom.src, JSON.stringify(dom));
        check('Observer : texte remplacé', dom.label === 'Init test DOM', dom.label);
        check('Observer : spinner masqué', dom.spinDisplay === 'none', dom.spinDisplay);

        await page.screenshot({ path: path.join(SHOTS, 'splash-dom-observer.png') });
        await page.evaluate(() => document.getElementById('loader')?.remove());

        const e = errs.filter((x) => !/Splash Custom/.test(x));
        check('Pas d’erreur console critique (DOM)', e.length === 0, JSON.stringify(e.slice(0, 3)));
        await b.close();
    }

    const failed = results.filter((x) => !x).length;
    console.log(`\n${failed} échec(s) / ${results.length}`);
    fs.writeFileSync('/tmp/splash-custom-results.json', JSON.stringify({ failed, total: results.length, results }));
    process.exit(failed ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
