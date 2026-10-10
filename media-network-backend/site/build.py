#!/usr/bin/env python3
"""Build the Vidar site: inlines a logo as a data URI.
Usage: build.py [logo-file] [out.html]   (default: original emblem -> index.html)
Use your own logo for a private copy: build.py ~/vidar_logo_v2.png private.html"""
import base64, mimetypes, sys
from pathlib import Path
here = Path(__file__).parent
logo = Path(sys.argv[1]) if len(sys.argv) > 1 else here.parent / "vidar-tv/branding/vidar-emblem.svg"
out = Path(sys.argv[2]) if len(sys.argv) > 2 else here / "index.html"
mime = mimetypes.guess_type(logo.name)[0] or "image/png"
uri = f"data:{mime};base64," + base64.b64encode(logo.read_bytes()).decode()
out.write_text((here / "template.html").read_text().replace("__LOGO__", uri))
print(f"wrote {out} with {logo.name}")
