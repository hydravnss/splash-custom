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
| **Image / GIF** | URL `https` (ou data URL) **ou** upload fichier → stocké dans `extensionSettings` |
| **Taille** | Largeur en `px` (16–800) ou `%` (16–100) |
| **Fond** | Couleur de fond du splash (`#rrggbb`) |
| **Texte** | Masquer / changer le libellé / couleur |
| **Engrenage** | Masquer `#load-spinner` sur le splash (activé par défaut) |
| **Aperçu** | Réaffiche un splash factice **3–5 s** sans recharger |

## Application précoce

Le splash disparaît vite. Pour que la personnalisation soit visible :

1. `style.css` du manifest est chargé tôt (`loading_order: 1`)
2. Cache `localStorage` (`sc_cache_v1`) appliqué dès le chargement du module
3. `MutationObserver` sur `.splash-logo` / `.splash-message` / `#loader.splash-screen`

L’extension **ne modifie pas** `#chat`, `#form_sheld`, `#send_textarea`, ni les styles des autres extensions.

## Tests

```bash
# Fonctions pures (Node)
node test/splash-custom.test.mjs

# E2E Playwright WebKit (émulation iPhone 14 Pro) — ST sur http://localhost:8000
node test/st-playwright.mjs
```

Captures : `/workspace/st-test-shots/splash-*.png`.

**Pas testé sur un vrai iPhone** (émulation WebKit Playwright uniquement).

## Licence

MIT — hydravnss
