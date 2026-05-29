# Hanzi Stroke Editor

A browser-based tool for editing Chinese character strokes and composing new characters from existing ones. Built on stroke data from [Make Me a Hanzi](https://github.com/skishore/makemeahanzi), covering ~9,500 hanzi.

Runs entirely in your browser. Nothing is sent to a server.

## What you can do

### Edit individual strokes
Click any stroke to select it, then drag to reposition. Drag the red **endpoint handles** or orange **corner handles** on each stroke to warp it — the calligraphic brush width is preserved automatically. Use the **▓ thicker** / **░ thinner** buttons to scale the brush weight without distorting the stroke's shape.

### Select and edit in bulk
- **Shift+click** strokes or **drag-marquee** an empty area to multi-select
- The blue bounding box around the selection has 8 resize handles — drag them to scale all selected strokes together, preserving widths
- **Ctrl+A** selects everything visible (skips hidden layers)
- The multi-select toolbar lets you duplicate, scale, thicken/thin, or delete the selection at once

### Layers
Each character you load becomes a **layer** in the stroke list. Layer headers let you:
- **●/◌** hide and show the layer on the canvas
- **⊕** select all its strokes (shift-click to add to current selection)
- **→ C** send the source character to the composer
- **×** delete the entire layer

Layers stay grouped by source character even after you reorder or interleave strokes.

### Browse 9,500+ characters
The **Radicals & Components** panel:
- Search by **pinyin** (`lin` or `lín` both match), **character** (`林`), **English meaning** (`forest`), or **stroke count** (`5` for exactly 5 strokes, `5-8` for a range)
- Click any of the **296 radicals** (214 Kangxi + 82 positional/simplified variants, sorted by stroke count with variants next to their parent) to see characters using it
- Pick a character → it renders in a preview canvas where you can select individual strokes (click, shift-click, or marquee-drag) and add just those to the main canvas

### Compose new characters
Open the composer panel (⚒ Composer button) to combine 2-3 components in standard IDS layouts:
- ⿰ left/right, ⿱ top/bottom, ⿲ ⿳ three-part, ⿴ ⿵ ⿶ enclosures
- **Smart lookup**: if your composition matches a real character's decomposition (e.g. 木+木 in horizontal layout = 林), the app loads that character natively with calligrapher-tuned proportions
- Otherwise, **geometric composition** warps each component's strokes into its slot

The result loads back into the main editor as new strokes, ready for further editing.

### Canvas controls
- **Zoom** with the `+`/`−`/`⌂` buttons, or scroll-wheel anywhere on the canvas (anchors zoom at the cursor)
- **Pan** by holding `Space` and dragging, or with middle-mouse-drag
- **Touch**: one-finger pan, two-finger pinch zoom
- The canvas itself is **resizable** — drag the bottom-right corner to widen the editor column (other panels share the remaining space)
- The Mi-zi-ge guideline grid (horizontal/vertical midlines + diagonal corner-to-corner lines) helps you place strokes precisely

### Save and share
- **↶ Undo** / **↷ Redo** (or `Ctrl+Z` / `Ctrl+Y`) — 100 step history
- **🔗 Save URL** copies a shareable URL with your current canvas state compressed into the query string. Anyone opening it sees the same strokes — no account or server needed
- **Export SVG** downloads the canvas as an `.svg` file

### Random character on launch
Each visit starts with a random character from the dataset, so you'll see something different each time. The default `林` only appears if loading fails.

## Tips

- Stroke handles only appear on visible layers; hide layers you're not working with to declutter
- The bbox resize uses control-point warping, not affine scaling — stroke widths stay calligraphic even at extreme aspect ratios
- For best calligraphic results when composing, let the smart lookup find real characters before falling back to geometric warping
- Hold `Space` *before* clicking to start a pan instead of a stroke drag

## Credits

- Stroke data: [Make Me a Hanzi](https://github.com/skishore/makemeahanzi) (derived from the Arphic Public License fonts)
- IDS / Kangxi radical conventions: [Unicode CJK Ideographic Description Characters](https://www.unicode.org/charts/PDF/U2FF0.pdf)
