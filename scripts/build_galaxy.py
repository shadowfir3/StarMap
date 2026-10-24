#!/usr/bin/env python3
"""Build the galaxy background: one licence-checked Wikimedia Commons picture of
the Milky Way, embedded as a data URI together with the calibration that places
it on the Galactic plane.

Standard library only, like the other builders; the Commons helpers are shared
with build_nebulae.py.  Outputs:

  data/galaxy.js            browser payload (metadata, calibration, embedded JPEG)
  data/galaxy/<key>.jpg     the downloaded Wikimedia thumbnail (standard width)
  data/galaxy/source.json   cached Commons response for --offline rebuilds
  CREDITS.md                the marked "Galaxy background" section; nebula entries
                            are left untouched (build_nebulae.py preserves the section)

Picture: the ESO/NASA artist's impression of the Milky Way (R. Hurt), Commons
file "Artist’s impression of the Milky Way.jpg" (ESO eso1339g, public domain),
a face-on view from the north Galactic pole.  Its annotated twin (eso1339e,
identical framing) carries Galactic-longitude lines and distance rings around
the Sun; CALIBRATION records the pixel positions measured on the 3840 px
thumbnail of that twin and is rescaled to the embedded width.
"""
from __future__ import annotations

import argparse
import base64
import json
from pathlib import Path
import re
import sys
import time

sys.path.insert(0, str(Path(__file__).resolve().parent))
import build_nebulae as commons  # noqa: E402  (shared HTTP, licence and JPEG helpers)

commons.USER_AGENT = "StarMap-galaxy-builder/1.0 (https://github.com/shadowfir3/StarMap; local reproducible research) python-urllib"

GALAXY = {
    "key": "milky-way",
    "name": "Milky Way",
    "image": "Artist’s impression of the Milky Way.jpg",  # the title contains U+2019
    "source": "ESO eso1339g (2013 update of NASA/JPL-Caltech/R. Hurt ssc2008-10a)",
    "sourceUrl": "https://www.eso.org/public/images/eso1339g/",
    "description": "Artist's impression of the Milky Way seen face-on from the north Galactic pole: "
                   "central bar, two major arms (Scutum-Centaurus, Perseus), the minor Sagittarius and Norma arms "
                   "and the Orion Spur at the Sun. The arm layout is schematic.",
}

# Measured 2026-10-24 on the 3840 px thumbnail of the annotated twin
# "Artist's impression of the Milky Way (updated - annotated).jpg" (eso1339e):
#   bar centroid (yellow bulge pixels)                   x = 1917.7, y = 1921.1
#   Sun = intersection of the l = 0° and l = 90°/270° lines  x = 1919.8, y = 2654.7
#   distance rings around the Sun every 141.2 px, labelled every 15,000 ly
#   with two unlabelled rings between, i.e. 5,000 ly per ring
#   l = 0° points up from the Sun, l = 90° left: the view from the north pole
CALIBRATION = {
    "file": "Artist's impression of the Milky Way (updated - annotated).jpg",
    "pageUrl": "https://commons.wikimedia.org/wiki/File:Artist%27s_impression_of_the_Milky_Way_(updated_-_annotated).jpg",
    "measuredUtc": "2026-10-24",
    "width": 3840,
    "centerPx": (1917.7, 1921.1),
    "sunPx": (1919.8, 2654.7),
    "ringSpacingPx": 141.2,
    "ringSpacingLy": 5000.0,
}

SECTION_START = "<!-- galaxy-credits:start -->"
SECTION_END = "<!-- galaxy-credits:end -->"


def scaled_calibration(width: int) -> dict:
    factor = width / CALIBRATION["width"]
    ly_per_px = CALIBRATION["ringSpacingLy"] / (CALIBRATION["ringSpacingPx"] * factor)
    centre = [round(v * factor, 1) for v in CALIBRATION["centerPx"]]
    sun = [round(v * factor, 1) for v in CALIBRATION["sunPx"]]
    sun_distance_px = ((sun[0] - centre[0]) ** 2 + (sun[1] - centre[1]) ** 2) ** 0.5
    return {
        "width": width, "centerPx": centre, "sunPx": sun, "lyPerPx": round(ly_per_px, 3),
        "sunDistanceLy": round(sun_distance_px * ly_per_px), "ringSpacingPx": round(CALIBRATION["ringSpacingPx"] * factor, 2),
        "ringSpacingLy": CALIBRATION["ringSpacingLy"], "viewpoint": "north Galactic pole",
        "longitudeZero": "up (from the Sun toward the centre)", "longitudeNinety": "left",
        "calibrationFile": CALIBRATION["file"], "calibrationPageUrl": CALIBRATION["pageUrl"], "measuredUtc": CALIBRATION["measuredUtc"],
    }


def write_credits(credits_path: Path, section: str) -> None:
    existing = credits_path.read_text(encoding="utf-8") if credits_path.exists() else "# Image credits\n"
    block = f"{SECTION_START}\n{section}\n{SECTION_END}\n"
    pattern = re.compile(re.escape(SECTION_START) + r".*?" + re.escape(SECTION_END) + r"\n?", re.S)
    if pattern.search(existing):
        text = pattern.sub(lambda _: block, existing)
    else:
        text = existing.rstrip("\n") + "\n\n" + block
    credits_path.write_text(text, encoding="utf-8")


def build(output_dir: Path, image_dir: Path, credits_path: Path, width: int, offline: bool, refresh: bool = False) -> None:
    if width not in commons.STANDARD_THUMB_WIDTHS:
        raise SystemExit(f"--width must be one of the Wikimedia standard widths {commons.STANDARD_THUMB_WIDTHS}")
    image_dir.mkdir(parents=True, exist_ok=True)
    cache_path = image_dir / "source.json"
    if offline:
        image = json.loads(cache_path.read_text(encoding="utf-8"))["commons"]
    else:
        image = commons.query_commons([GALAXY["image"]], width)[GALAXY["image"]]
        cache_path.write_text(json.dumps({"retrievedUtc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                                          "thumbWidth": width, "commons": image}, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")
    commons.check_license(GALAXY, image)

    image_path = image_dir / f"{GALAXY['key']}-{width}.jpg"
    cached = image_path.exists() and image_path.stat().st_size > 0
    if offline and not cached:
        raise RuntimeError(f"{image_path} missing for --offline build")
    if cached and (offline or not refresh):
        data = image_path.read_bytes()
    else:
        data = commons.http_bytes(image["thumb_url"])
        image_path.write_bytes(data)
        print(f"downloaded {image['file']} ({len(data)} bytes)", flush=True)
    if data[:2] != b"\xff\xd8":
        raise RuntimeError("downloaded thumbnail is not a JPEG")
    px_width, px_height = commons.image_dimensions(data)
    if px_width != width:
        raise RuntimeError(f"thumbnail is {px_width} px wide, expected {width}")

    generated = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    payload_object = {
        "schemaVersion": 1, "generatedUtc": generated, "key": GALAXY["key"], "name": GALAXY["name"],
        "description": GALAXY["description"], "source": GALAXY["source"], "sourceUrl": GALAXY["sourceUrl"],
        "file": image["file"], "pageUrl": image["page_url"], "license": image["license"], "licenseUrl": image["license_url"],
        "author": commons.compact(image["author"]), "credit": commons.compact(image["credit"]),
        "width": px_width, "height": px_height, "bytes": len(data),
        "imageRule": "Wikimedia Commons file pinned; licence read from extmetadata at build time and restricted to public domain, CC0 and CC BY.",
        "calibration": scaled_calibration(width),
        "dataUri": "data:image/jpeg;base64," + base64.b64encode(data).decode("ascii"),
    }
    output_dir.mkdir(parents=True, exist_ok=True)
    payload = "// Generated by scripts/build_galaxy.py; do not edit manually.\n"
    payload += "window.GALAXY_IMAGE = " + json.dumps(payload_object, ensure_ascii=False, separators=(",", ":")) + ";\n"
    (output_dir / "galaxy.js").write_text(payload, encoding="utf-8")

    section = ("## Galaxy background\n\n"
               f"The Milky Way picture in `data/galaxy.js` and `data/galaxy/` is the Wikimedia Commons file "
               f"[{image['file']}]({image['page_url']}) · {image['license']}"
               + (f" ([licence]({image['license_url']}))" if image["license_url"] else "")
               + f" · Author/credit: {payload_object['author'] or payload_object['credit'] or 'see file page'}"
               + f" · {GALAXY['source']} · resized to {px_width}×{px_height} px, unmodified otherwise; "
               f"downloaded by `scripts/build_galaxy.py` on {generated[:10]}. Scale, centre and Sun position were measured on "
               f"the annotated twin [{CALIBRATION['file']}]({CALIBRATION['pageUrl']}) (same credit and licence).")
    write_credits(credits_path, section)
    summary = {key: value for key, value in payload_object.items() if key != "dataUri"}
    print(json.dumps(summary, indent=2, ensure_ascii=False))


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    root = Path(__file__).resolve().parents[1]
    parser.add_argument("--output", type=Path, default=root / "data")
    parser.add_argument("--images", type=Path, default=root / "data" / "galaxy")
    parser.add_argument("--credits", type=Path, default=root / "CREDITS.md")
    parser.add_argument("--width", type=int, default=3840, help="Wikimedia standard thumbnail width to embed")
    parser.add_argument("--offline", action="store_true", help="Reuse data/galaxy/source.json and the downloaded image")
    parser.add_argument("--refresh", action="store_true", help="Re-download the image even if it exists in --images")
    args = parser.parse_args()
    build(args.output, args.images, args.credits, args.width, args.offline, args.refresh)


if __name__ == "__main__":
    main()
