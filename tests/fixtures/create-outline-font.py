"""Regenerate the original MIT-licensed OTF test fixture (fonttools==4.58.5)."""
from pathlib import Path
from fontTools.fontBuilder import FontBuilder
from fontTools.pens.t2CharStringPen import T2CharStringPen

font = FontBuilder(1000, isTTF=False)
font.setupGlyphOrder([".notdef", "space", "A"])
font.setupCharacterMap({32: "space", 65: "A"})
charstrings = {}
for name in [".notdef", "space", "A"]:
    pen = T2CharStringPen(600, None)
    if name != "space":
        pen.moveTo((50, 0))
        pen.lineTo((300, 700))
        pen.lineTo((550, 0))
        pen.closePath()
    charstrings[name] = pen.getCharString()
font.setupCFF("StudioOutline-Regular", {"FullName": "Studio Outline Regular", "FamilyName": "Studio Outline", "Weight": "Regular"}, charstrings, {})
font.setupHorizontalMetrics({name: (600, 50 if name != "space" else 0) for name in charstrings})
font.setupHorizontalHeader(ascent=800, descent=-200)
font.setupNameTable({"familyName": "Studio Outline", "styleName": "Regular", "uniqueFontIdentifier": "StudioOutline-Regular-1", "fullName": "Studio Outline Regular", "psName": "StudioOutline-Regular", "version": "Version 1.0", "copyright": "MCP Visual Design Studio contributors; MIT license"})
font.setupOS2(sTypoAscender=800, sTypoDescender=-200, usWinAscent=800, usWinDescent=200)
font.setupPost()
font.font["head"].created = font.font["head"].modified = 3849984000
font.save(Path(__file__).with_name("custom-outline.otf"))
