# Splash Custom

Extension SillyTavern pour personnaliser l’**écran de lancement** (splash) : logo ST ou GIF, couleur de fond, texte « Initialisation… ».

Compatible SillyTavern **1.19.0** (DOM : `#preloader`, `#loader.splash-screen`, `.splash-logo`, `.splash-message`, `#load-spinner`).

## Installation

SillyTavern → Extensions → **Install extension** → coller :

`https://github.com/hydravnss/splash-custom`

Réglages : Extensions → **Splash Custom**.

## Fonctions

| Réglage | Description |
|---|---|
| **Activer** | Active / désactive l’extension |
| **Image / GIF** | Bouton **Choisir dans la galerie** (`<input type="file" accept="image/*,image/gif">`, sans `capture`) → data URL stockée dans `extensionSettings`. Pas de champ URL. Photos lourdes réduites à 1024 px ; GIF conservés tels quels (max ~1,8 Mo) |
| **Taille** | Largeur en `px` (16–800) ou `%` (16–100) |
| **Fond** | Couleur de fond du splash (`#rrggbb`) |
| **Texte** | Masquer / changer le libellé / couleur |
| **Engrenage** | Masquer `#load-spinner` sur le splash (activé par défaut) |
| **Aperçu** | Réaffiche un splash factice **3–5 s** sans recharger |

## Upload depuis la galerie (1.0.1)

- Sur **iPhone / Safari**, le bouton ouvre le menu iOS (Photothèque, Prendre une photo, Choisir un fichier) : l'input n'a pas d'attribut `capture`, il n'est pas en `display:none` (masqué visuellement) et s'ouvre via `<label for>`.
- Le fichier est lu en data URL (`FileReader`) et enregistré dans `extensionSettings['splash-custom'].imageData` (+ `imageName`), puis mis en cache local pour le prochain splash.
- Les URL distantes ne sont plus prises en charge : une ancienne valeur `imageUrl` de type `data:image/…` (1.0.0) est migrée, une URL `http(s)` est ignorée.

## Application précoce (1.0.2 — anti-flash iPhone)

SillyTavern peint le logo ST dans `firstLoadInit()` **avant** d’activer les extensions (on ne peut pas modifier `index.html`). Sur iPhone le splash peut disparaître avant que `index.js` tourne. Contre-mesures :

1. `loading_order: 0` + `style.css` (règles `html.sc-has-image`, `#sc-boot-cover`)
2. Cache `localStorage` (`sc_cache_v1`) lu **synchronement** au tout début du module
3. Injection d’un `<style id="sc-boot-style">` + variables CSS (`--sc-img`, `--sc-bg`…)
4. `MutationObserver` dès le premier tick + re-patch microtask / rAF / timeouts
5. Couverture du logo ST (`#sc-boot-cover`) : src custom, logo ST `display:none`
6. Si le splash ST a déjà disparu → **re-show court** (`#sc-boot-overlay`, ~1,8 s)
7. Bloc CSS `BEGIN-SPLASH-CUSTOM-BOOT` synchronisé dans `power_user.custom_css` (appliqué par ST **avant** le JS des extensions) : masque le logo ST et affiche l’image via `::before`

L’extension **ne modifie pas** `#chat`, `#form_sheld`, `#send_textarea`, ni les styles des autres extensions.

### Test boot froid

```bash
node test/st-boot-playwright.mjs   # image en cache → captures splash-boot-*.png (1er frame)
```

## Tests

```bash
# Fonctions pures (Node)
node test/splash-custom.test.mjs

# E2E Playwright WebKit (émulation iPhone 14 Pro) — ST sur http://localhost:8000
node test/st-playwright.mjs
node test/st-upload-playwright.mjs   # upload galerie (fichier mock) → miniature + aperçu
```

Captures : `/workspace/st-test-shots/splash-*.png` et `splash-upload-*.png`.

**Pas testé sur un vrai iPhone** (émulation WebKit Playwright uniquement).

## Licence

MIT — hydravnss
