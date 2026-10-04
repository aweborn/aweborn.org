# Card fonts

These fonts are used **only at build time**. `scripts/cards/lib/outline.mjs` turns text into vector paths, so the card SVGs don't contain or reference any font.

| File | Family | Licence |
|---|---|---|
| Jost-Variable.ttf | Jost* (indestructible type*) | SIL OFL 1.1 |
| JetBrainsMono-Variable.ttf | JetBrains Mono | SIL OFL 1.1 |
| Outfit-Variable.ttf | Outfit | SIL OFL 1.1 |
| JosefinSans-Variable.ttf | Josefin Sans | SIL OFL 1.1 |
| CormorantGaramond-Variable.ttf | Cormorant Garamond | SIL OFL 1.1 |
| Cinzel-Variable.ttf | Cinzel | SIL OFL 1.1 |
| Quicksand-Variable.ttf | Quicksand | SIL OFL 1.1 |
| Comfortaa-Variable.ttf | Comfortaa | SIL OFL 1.1 |
| SpaceGrotesk-Variable.ttf | Space Grotesk | SIL OFL 1.1 |
| Ubuntu-Light.ttf, Ubuntu-Regular.ttf | Ubuntu | Ubuntu Font Licence 1.0 |

Each font's copyright notice and licence URL are embedded in its own `name` table.

- SIL OFL 1.1: https://openfontlicense.org
- Ubuntu Font Licence: https://ubuntu.com/legal/font-licence

The cards use Jost. JetBrains Mono is kept for comparison renders (`renderFront(w, { numbers: "jetbrains" })`). The other families are only used in the back-of-card exploration sheets.
