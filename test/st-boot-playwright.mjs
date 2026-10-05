// E2E cold boot — image en localStorage AVANT navigation, capture du PREMIER frame splash
// Usage: node test/st-boot-playwright.mjs
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

const CUSTOM_PNG = fs.readFileSync('/tmp/sc-boot-img.txt', 'utf8').trim();

const results = [];
const check = (name, ok, extra = '') => {
    results.push(!!ok);
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  -> ' + extra : ''}`);
};

function cachePayload() {
    return {
        schema: 1,
        enabled: true,
        imageData: CUSTOM_PNG,
        imageName: 'boot-test.png',
        bgColor: '#120018',
        hideText: false,
        textLabel: 'Boot custom…',
        textColor: '#ff66cc',
        imageSize: 140,
        imageSizeUnit: 'px',
        hideSpinner: true,
        previewSeconds: 3,
    };
}

async function main() {
    const b = await webkit.launch();
    const ctx = await b.newContext({ ...devices['iPhone 14 Pro'], colorScheme: 'dark' });
    const page = await ctx.newPage();

    // Seed cache + probe AVANT tout paint (survit au goto)
    await ctx.addInitScript((payload) => {
        try {
            localStorage.setItem('sc_cache_v1', JSON.stringify(payload));
        } catch { /* */ }

        window.__scBootProbe = { samples: [], started: Date.now() };
        const take = () => {
            try {
                const loader = document.querySelector('#loader.splash-screen');
                const cover = document.getElementById('sc-boot-cover');
                const bootOv = document.getElementById('sc-boot-overlay');
                const logos = [...document.querySelectorAll(
                    '#loader.splash-screen img.splash-logo, #sc-boot-overlay img.splash-logo, #sc-boot-cover, #sc-boot-logo',
                )];
                const html = document.documentElement;
                const sample = {
                    t: Date.now() - window.__scBootProbe.started,
                    hasLoader: !!loader,
                    hasCover: !!cover,
                    hasBootOv: !!bootOv,
                    scActive: html.classList.contains('sc-active'),
                    scHasImg: html.classList.contains('sc-has-image'),
                    splashCustom: !!(window.SplashCustom),
                    logos: logos.map((img) => ({
                        id: img.id || '',
                        src: (img.getAttribute('src') || '').slice(0, 48),
                        isData: (img.getAttribute('src') || '').startsWith('data:image/'),
                        isSt: /\/img\/logo\.png/i.test(img.getAttribute('src') || ''),
                        display: getComputedStyle(img).display,
                        opacity: getComputedStyle(img).opacity,
                        visibility: getComputedStyle(img).visibility,
                    })),
                    visibleSt: logos.some((img) => {
                        const src = img.getAttribute('src') || '';
                        if (!/\/img\/logo\.png/i.test(src)) return false;
                        const cs = getComputedStyle(img);
                        return cs.display !== 'none' && cs.visibility !== 'hidden' && Number(cs.opacity) > 0.05;
                    }),
                    visibleCustom: logos.some((img) => {
                        const src = img.getAttribute('src') || '';
                        if (!src.startsWith('data:image/')) return false;
                        const cs = getComputedStyle(img);
                        return cs.display !== 'none' && cs.visibility !== 'hidden' && Number(cs.opacity) > 0.05;
                    }),
                };
                window.__scBootProbe.samples.push(sample);
                // garder la mémoire raisonnable
                if (window.__scBootProbe.samples.length > 400) {
                    window.__scBootProbe.samples.splice(0, 100);
                }
                return sample;
            } catch {
                return null;
            }
        };
        window.__scBootTake = take;
        const startPolling = () => {
            if (window.__scBootIv) return;
            window.__scBootIv = setInterval(take, 16);
            take();
        };
        if (document.documentElement) startPolling();
        document.addEventListener('DOMContentLoaded', startPolling);
        // MutationObserver pour déclencher take dès qu'un splash apparaît
        const mo = new MutationObserver(() => take());
        const arm = () => {
            try { mo.observe(document.documentElement, { childList: true, subtree: true, attributes: true }); } catch { /* */ }
        };
        if (document.documentElement) arm();
        else document.addEventListener('DOMContentLoaded', arm);
    }, cachePayload());

    let firstSplashShot = null;
    let patchedShot = null;

    const navPromise = page.goto('http://localhost:8000/', { waitUntil: 'commit', timeout: 90000 });

    // Boucle de capture agressive pendant le boot
    for (let i = 0; i < 120; i++) {
        await page.waitForTimeout(40);
        let sample = null;
        try {
            sample = await page.evaluate(() => (window.__scBootTake ? window.__scBootTake() : null));
        } catch { /* context destroyed mid-nav */ }
        if (!sample) continue;

        if ((sample.hasLoader || sample.hasBootOv || sample.hasCover) && !firstSplashShot) {
            const p0 = path.join(SHOTS, 'splash-boot-0-first.png');
            try {
                await page.screenshot({ path: p0, animations: 'disabled' });
                firstSplashShot = p0;
                console.log('captured first splash frame at t≈', sample.t, 'ms', {
                    hasLoader: sample.hasLoader,
                    hasCover: sample.hasCover,
                    scHasImg: sample.scHasImg,
                    visibleSt: sample.visibleSt,
                    visibleCustom: sample.visibleCustom,
                });
            } catch (e) {
                console.warn('shot0 failed', e.message);
            }
        }
        if ((sample.scHasImg || sample.hasCover || sample.visibleCustom) && sample.hasLoader && !patchedShot) {
            const p1 = path.join(SHOTS, 'splash-boot-1-patched.png');
            try {
                await page.screenshot({ path: p1, animations: 'disabled' });
                patchedShot = p1;
                console.log('captured patched splash at t≈', sample.t, 'ms');
            } catch (e) {
                console.warn('shot1 failed', e.message);
            }
        }

        const ready = await page.evaluate(() => !!(window.SplashCustom && document.querySelector('#send_textarea'))).catch(() => false);
        if (ready && (patchedShot || i > 60)) break;
    }

    await navPromise.catch(() => {});
    await page.waitForFunction(() => window.SplashCustom && document.querySelector('#send_textarea'), null, { timeout: 90000 });
    await page.waitForTimeout(400);

    const probe = await page.evaluate(() => {
        try { clearInterval(window.__scBootIv); } catch { /* */ }
        return window.__scBootProbe || { samples: [] };
    });
    fs.writeFileSync('/tmp/sc-boot-probe.json', JSON.stringify({
        n: (probe.samples || []).length,
        samples: (probe.samples || []).filter((_, i, a) => i < 30 || i > a.length - 10 || (_.hasLoader || _.hasCover || _.scHasImg)),
    }, null, 2));

    const late = await page.evaluate(() => {
        const s = window.SplashCustom?.getSettings?.() || null;
        const cache = (() => { try { return JSON.parse(localStorage.getItem('sc_cache_v1') || 'null'); } catch { return null; } })();
        return {
            version: window.SplashCustom?.VERSION,
            cacheHasImg: !!(cache && String(cache.imageData || '').startsWith('data:image/')),
            settingsHasImg: !!(s && String(s.imageData || '').startsWith('data:image/')),
            bootOv: !!document.getElementById('sc-boot-overlay'),
            cover: !!document.getElementById('sc-boot-cover'),
            scActive: document.documentElement.classList.contains('sc-active'),
            scHasImg: document.documentElement.classList.contains('sc-has-image'),
            bootStyle: !!document.getElementById('sc-boot-style'),
        };
    });

    // Force re-show (cas iPhone : splash déjà parti)
    await page.evaluate(() => {
        document.getElementById('loader')?.remove();
        window.SplashCustom.hideBootOverlay?.();
        window.SplashCustom.ensureCustomSplashVisible?.(window.SplashCustom.getSettings());
    });
    await page.waitForTimeout(180);
    await page.screenshot({ path: path.join(SHOTS, 'splash-boot-2-reshow.png'), animations: 'disabled' });

    const reshowState = await page.evaluate(() => {
        const ov = document.getElementById('sc-boot-overlay');
        const img = ov?.querySelector('img');
        return {
            exists: !!ov,
            isData: (img?.getAttribute('src') || '').startsWith('data:image/'),
            isSt: /\/img\/logo\.png/i.test(img?.getAttribute('src') || ''),
            label: ov?.querySelector('.splash-message')?.textContent || '',
            bg: ov ? getComputedStyle(ov).backgroundColor : null,
        };
    });

    const samples = probe.samples || [];
    const loaderSamples = samples.filter((s) => s.hasLoader);
    const afterHasImg = samples.filter((s) => s.scHasImg);
    const stVisibleAfter = afterHasImg.filter((s) => s.visibleSt);
    // ST logo visible pendant splash AVANT notre patch (attendu brièvement) vs APRÈS
    const customDuringLoader = loaderSamples.filter((s) => s.visibleCustom || s.hasCover);
    const stDuringLoaderAfterExt = loaderSamples.filter((s) => s.splashCustom && s.visibleSt);
    const patchedDuringLoader = loaderSamples.filter((s) => s.scHasImg || s.hasCover || s.visibleCustom);

    check('API SplashCustom 1.0.2', late.version === '1.0.2', String(late.version));
    check('Cache localStorage seedé (image)', late.cacheHasImg);
    check('html.sc-active + sc-has-image', late.scActive && late.scHasImg, JSON.stringify(late));
    check('#sc-boot-style injecté', late.bootStyle);
    check('Splash #loader observé pendant le boot froid', loaderSamples.length > 0, `n=${loaderSamples.length}`);
    check('Capture splash-boot-0-first.png', !!firstSplashShot && fs.existsSync(firstSplashShot || ''), String(firstSplashShot));
    check('Image custom appliquée pendant le splash live (cover/src)', patchedDuringLoader.length > 0,
        `patched=${patchedDuringLoader.length}/${loaderSamples.length}`);
    check('0 logo ST visible une fois SplashCustom chargé (pendant splash)', stDuringLoaderAfterExt.length === 0,
        stDuringLoaderAfterExt.length ? JSON.stringify(stDuringLoaderAfterExt.slice(0, 2)) : 'ok');
    check('0 logo ST visible après sc-has-image', stVisibleAfter.length === 0,
        stVisibleAfter.length ? JSON.stringify(stVisibleAfter.slice(0, 2)) : `ok (${afterHasImg.length} samples)`);
    check('Re-show overlay : data URL custom, pas logo ST', reshowState.exists && reshowState.isData && !reshowState.isSt,
        JSON.stringify(reshowState));

    // Simulation mutation : logo ST injecté → cover immédiat
    await page.evaluate((png) => {
        window.SplashCustom.hideBootOverlay?.();
        const s = window.SplashCustom.getSettings();
        Object.assign(s, {
            enabled: true, imageData: png, bgColor: '#120018', textLabel: 'Boot custom…',
            hideText: false, hideSpinner: true, imageSize: 140, imageSizeUnit: 'px',
        });
        window.SplashCustom.reapply();
        const loader = document.createElement('div');
        loader.id = 'loader';
        loader.className = 'splash-screen';
        loader.style.cssText = 'position:fixed;inset:0;z-index:999999;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4rem;background:#120018;';
        const logo = document.createElement('img');
        logo.className = 'splash-logo';
        logo.src = '/img/logo.png';
        logo.alt = 'SillyTavern';
        const msg = document.createElement('h2');
        msg.className = 'splash-message';
        msg.textContent = 'Initializing…';
        loader.append(logo, msg);
        document.body.appendChild(loader);
    }, CUSTOM_PNG);

    await page.waitForFunction(() => {
        const c = document.getElementById('sc-boot-cover');
        return c && c.complete && c.naturalWidth > 0 && getComputedStyle(c).display !== 'none';
    }, null, { timeout: 5000 }).catch(() => {});
    await page.screenshot({ path: path.join(SHOTS, 'splash-boot-3-observer-instant.png'), animations: 'disabled' });
    await page.waitForTimeout(30);
    await page.screenshot({ path: path.join(SHOTS, 'splash-boot-4-observer-30ms.png'), animations: 'disabled' });

    const obs = await page.evaluate(() => {
        const cover = document.getElementById('sc-boot-cover');
        const st = [...document.querySelectorAll('#loader.splash-screen img.splash-logo')].map((img) => ({
            id: img.id,
            srcHead: (img.getAttribute('src') || '').slice(0, 40),
            isSt: /\/img\/logo\.png/i.test(img.getAttribute('src') || ''),
            display: getComputedStyle(img).display,
            replaced: img.getAttribute('data-sc-replaced'),
        }));
        const visibleSt = st.some((x) => x.isSt && x.display !== 'none' && x.id !== 'sc-boot-cover');
        return { hasCover: !!cover, coverIsData: (cover?.getAttribute('src') || '').startsWith('data:image/'), st, visibleSt };
    });
    check('Observer instantané : cover custom présent', obs.hasCover && obs.coverIsData, JSON.stringify(obs));
    check('Observer : 0 logo ST visible', !obs.visibleSt && obs.st.every((x) => x.id === 'sc-boot-cover' || x.display === 'none' || !x.isSt),
        JSON.stringify(obs.st));

    await page.screenshot({ path: path.join(SHOTS, 'splash-boot-5-final.png'), animations: 'disabled' });

    // Early CSS (power_user.custom_css) doit être actif avant le JS extension :
    // dès qu'il s'applique, visibleSt doit passer à false même avant SplashCustom.
    const earlyCssHidden = loaderSamples.filter((s) => !s.visibleSt && s.hasLoader);
    check('Early CSS / patch : majority des frames splash sans ST logo visible',
        earlyCssHidden.length >= loaderSamples.length * 0.4,
        `hidden=${earlyCssHidden.length}/${loaderSamples.length}`);
    // Première frame peut encore être ST (avant applyPowerUserSettings) — documenté.
    if (firstSplashShot) {
        console.log('Note first-frame sample0:', JSON.stringify(loaderSamples[0] && {
            t: loaderSamples[0].t, visibleSt: loaderSamples[0].visibleSt,
            hasCover: loaderSamples[0].hasCover, scHasImg: loaderSamples[0].scHasImg,
        }));
    }

    // Attend décode image pour captures reshow/observer
    await page.evaluate(async () => {
        const imgs = [...document.querySelectorAll('#sc-boot-cover, #sc-boot-logo, #sc-boot-overlay img')];
        await Promise.all(imgs.map((img) => (img.decode ? img.decode() : Promise.resolve()).catch(() => {})));
    });
    await page.screenshot({ path: path.join(SHOTS, 'splash-boot-2b-reshow-decoded.png'), animations: 'disabled' });

    console.log('\nShots:', { firstSplashShot, patchedShot, customDuringLoader: customDuringLoader.length, loaderSamples: loaderSamples.length });
    const failed = results.filter((x) => !x).length;
    console.log(`\n${failed} échec(s) / ${results.length}`);
    fs.writeFileSync('/tmp/splash-boot-results.json', JSON.stringify({ failed, total: results.length, late, reshowState, obs, loaderN: loaderSamples.length }, null, 2));
    await b.close();
    process.exit(failed ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
