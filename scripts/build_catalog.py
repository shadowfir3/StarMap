#!/usr/bin/env python3
"""Build the Star Map catalog from WGSN, SIMBAD, and Gaia DR3.

The script intentionally uses only the Python standard library.  It writes a
CSV audit table and a JavaScript copy that can be loaded from file:// URLs.
"""

from __future__ import annotations

import argparse
import csv
import html
from html.parser import HTMLParser
import json
import math
from pathlib import Path
import re
import time
from typing import Any, Iterable
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen


WGSN_URL = "https://exopla.net/star-names/modern-iau-star-names/"
SIMBAD_TAP_URL = "https://simbad.cds.unistra.fr/simbad/sim-tap/sync"
GAIA_TAP_URL = "https://gea.esac.esa.int/tap-server/tap/sync"
VIZIER_TAP_URL = "https://tapvizier.cds.unistra.fr/TAPVizieR/tap/sync"
VIZIER_ASU_URL = "https://vizier.cds.unistra.fr/viz-bin/asu-tsv"
LY_PER_PC = 3.261563777
NEARBY_LIMIT_LY = 50.0
NEARBY_MIN_PARALLAX_MAS = 1000.0 / (NEARBY_LIMIT_LY / LY_PER_PC)
BRIGHT_V_LIMIT = 4.0
MIN_PARALLAX_SNR = 10.0

CURATED = {
    "Barnard's Star": ["NAME Barnard's star", "Barnard's Star"],
    "Proxima Centauri": ["NAME Proxima Centauri", "Proxima Centauri"],
    "TRAPPIST-1": ["NAME TRAPPIST-1", "TRAPPIST-1"],
    "Polaris": ["NAME Polaris", "Polaris"],
    "Betelgeuse": ["NAME Betelgeuse", "Betelgeuse"],
    "Vega": ["NAME Vega", "Vega"],
    "Sirius": ["NAME Sirius", "Sirius"],
    "Eta Carinae": ["V* eta Car", "* eta Car", "NAME Eta Carinae"],
    "UY Scuti": ["V* UY Sct", "UY Sct"],
    "Stephenson 2-18": ["Cl* Stephenson 2 DFK 1", "Stephenson 2-18"],
    "R136a1": ["RMC 136a1", "R136a1"],
    "Bellatrix": ["NAME Bellatrix", "Bellatrix"],
    "Pollux": ["NAME Pollux", "Pollux"],
    "Castor": ["NAME Castor", "Castor"],
    "Deneb": ["NAME Deneb", "Deneb"],
    "Arcturus": ["NAME Arcturus", "Arcturus"],
    "Antares": ["NAME Antares", "Antares"],
    # Galactic centre
    "Sagittarius A*": ["NAME Sgr A*"],
    "S2 (S0-2)": ["[EG97] S2"],
    "Pistol Star": ["NAME Pistol Star"],
    # Hypergiants and extreme supergiants
    "VY Canis Majoris": ["V* VY CMa"],
    "Mu Cephei": ["* mu. Cep"],
    "NML Cygni": ["NML Cyg"],
    "Westerlund 1-26": ["Cl* Westerlund 1 W 26"],
    "RW Cephei": ["V* RW Cep"],
    "VV Cephei": ["V* VV Cep"],
    "KY Cygni": ["V* KY Cyg"],
    "RSGC1-F01": ["[FMR2006] 1"],
    "Rho Cassiopeiae": ["* rho Cas"],
    "HR 5171 A": ["HD 119796"],
    "V838 Monocerotis": ["V* V838 Mon"],
    "WR 104": ["WR 104"],
    "WR 124": ["WR 124"],
    "Sher 25": ["NAME Sher 25 star"],
    "WOH G64": ["WOH G 64"],
    "S Doradus": ["V* S Dor"],
    "Mira": ["* omi Cet"],
    # Black holes and X-ray binaries
    "Cygnus X-1": ["HD 226868"],
    "V404 Cygni": ["V* V404 Cyg"],
    "Gaia BH1": ["Gaia DR3 4373465352415301632"],
    "Gaia BH2": ["Gaia DR3 5870569352746779008"],
    "Gaia BH3": ["Gaia DR3 4318465066420528000"],
    "SS 433": ["SS 433"],
    "V4641 Sagittarii": ["V* V4641 Sgr"],
    "A0620-00": ["1A 0620-00"],
    "GRS 1915+105": ["Granat 1915+105"],
    "MAXI J1820+070": ["MAXI J1820+070"],
    # Pulsars
    "Crab Pulsar": ["PSR B0531+21"],
    "Vela Pulsar": ["PSR B0833-45"],
    "Geminga": ["NAME Geminga"],
    "PSR B1919+21": ["PSR B1919+21"],
    "PSR J0437-4715": ["PSR J0437-4715"],
    # Exoplanet hosts, nearby and historically notable stars
    "Methuselah Star": ["HD 140283"],
    "Kepler-186": ["Kepler-186"],
    "Kepler-452": ["Kepler-452"],
    "Kepler-22": ["Kepler-22"],
    "Kepler-90": ["Kepler-90"],
    "HD 209458": ["HD 209458"],
    "T Coronae Borealis": ["V* T CrB"],
    "RR Lyrae": ["V* RR Lyr"],
    "Wolf 359": ["V* CN Leo"],
    "Gliese 581": ["BD-07 4003"],
    "Gliese 667 C": ["GJ 667 C"],
    "Gliese 876": ["GJ 876"],
    "Ross 128": ["V* FI Vir"],
    "Lalande 21185": ["HD 95735"],
    "Groombridge 34 A": ["HD 1326"],
    "Luyten's Star": ["BD+05 1668"],
    "Teegarden's Star": ["NAME Teegarden's Star"],
    "Kapteyn's Star": ["HD 33793"],
    "Van Maanen's Star": ["Wolf 28"],
    "WISE 0855-0714": ["WISEA J085510.74-071442.5"],
}

# Explicit stellar categories for objects whose SIMBAD object type does not
# reveal the compact object (X-ray binaries, astrometric binaries, Sgr A*).
CATEGORY_OVERRIDES = {
    "NAME Sgr A*": "black_hole", "HD 226868": "black_hole", "V* V404 Cyg": "black_hole",
    "Gaia DR3 4373465352415301632": "black_hole", "Gaia DR3 5870569352746779008": "black_hole",
    "Gaia DR3 4318465066420528000": "black_hole", "SS 433": "black_hole", "V* V4641 Sgr": "black_hole",
    "1A 0620-00": "black_hole", "Granat 1915+105": "black_hole", "MAXI J1820+070": "black_hole",
}

# Host galaxy or wider context.  Everything else defaults to the Milky Way;
# positioned objects beyond EXTRAGALACTIC_LY without an entry are flagged.
DEFAULT_LOCALITY = "Milky Way"
LOCALITY_OVERRIDES = {
    "BAT99 108": "Large Magellanic Cloud", "RMC 136a1": "Large Magellanic Cloud",
    "WOH G 64": "Large Magellanic Cloud", "V* S Dor": "Large Magellanic Cloud",
}
EXTRAGALACTIC_LY = 100000.0

# Distant or crowded massive stars often have unusable parallaxes.  These
# values are deliberately explicit rather than silently inverting them.
LITERATURE_DISTANCE_PC = {
    "* alf Sco": (170.0, "uncertain_literature_distance", "Adopted literature distance 170 pc for Antares"),
    "* alf Ori": (168.0, "uncertain_literature_distance", "Adopted literature distance 168 pc for Betelgeuse"),
    "* alf Cyg": (802.0, "uncertain_literature_distance", "Adopted literature distance 802 pc for Deneb"),
    "* eta Car": (2300.0, "literature_distance", "Smith 2006; distance 2.3 +/- 0.1 kpc"),
    "V* UY Sct": (2900.0, "uncertain_literature_distance", "Arroyo-Torres et al. 2013; adopted 2.9 kpc"),
    "BAT99 108": (49590.0, "host_system_distance", "Pietrzynski et al. 2019; adopted LMC distance 49.59 kpc"),
    # Galactic centre
    "NAME Sgr A*": (8277.0, "literature_distance", "GRAVITY Collaboration 2022 (A&A 657, L12): R0 = 8.277 +/- 0.009 (stat) +/- 0.033 (sys) kpc from the S2 orbit"),
    "[EG97] S2": (8277.0, "host_system_distance", "S2 orbits Sgr A*; Galactic-centre distance 8.277 kpc adopted (GRAVITY Collaboration 2022)"),
    "NAME Pistol Star": (8277.0, "host_system_distance", "Quintuplet cluster member near the Galactic centre; 8.277 kpc adopted (GRAVITY Collaboration 2022)"),
    # Hypergiants and supergiants with unusable optical parallaxes
    "V* VY CMa": (1200.0, "literature_distance", "Zhang et al. 2012 (AJ 143, 70): VLBA SiO-maser parallax 0.83 +/- 0.08 mas -> 1.20 +0.13/-0.10 kpc"),
    "* mu. Cep": (940.0, "uncertain_literature_distance", "Davies & Beasor 2020 (MNRAS 493, 468) adopt 940 pc; published values span 390-1800 pc"),
    "NML Cyg": (1610.0, "literature_distance", "Zhang et al. 2012 (A&A 544, A42): VLBI H2O-maser parallax -> 1.61 +0.13/-0.11 kpc"),
    "Cl* Westerlund 1 W 26": (4100.0, "host_system_distance", "Westerlund 1 cluster distance 4.1 +/- 0.2 kpc (Negueruela et al. 2022, A&A 664, A146); own Gaia parallax unusable"),
    "V* RW Cep": (3400.0, "uncertain_literature_distance", "Anugu et al. 2023 (AJ 166, 78) adopt 3.4 kpc; Gaia DR3 parallax 0.114 +/- 0.034 mas"),
    "V* VV Cep": (1000.0, "uncertain_literature_distance", "Gaia DR3 parallax 1.003 +/- 0.107 mas inverted (SNR 9.4, below the 10 threshold)"),
    "[FMR2006] 1": (6600.0, "host_system_distance", "RSGC1 cluster kinematic distance 6.6 +/- 0.9 kpc (Davies et al. 2008, ApJ 676, 1016)"),
    "* rho Cas": (2500.0, "uncertain_literature_distance", "Cas OB5 association distance ~2.5 kpc; published values span 1.0-3.4 kpc"),
    "HD 119796": (3600.0, "uncertain_literature_distance", "Chesneau et al. 2014 (A&A 563, A71): 3.6 +/- 0.5 kpc; van Genderen et al. 2019 argue ~1.5 kpc"),
    "WR 104": (2580.0, "uncertain_literature_distance", "Soulain et al. 2018 (A&A 618, A108) ~2.58 kpc; the Gaia DR3 parallax of this pinwheel binary is considered spurious", True),
    "NAME Sher 25 star": (6400.0, "uncertain_literature_distance", "Gaia DR3 parallax 0.156 +/- 0.017 mas inverted (SNR 9.4, below the 10 threshold); NGC 3603 lies at ~7 kpc"),
    "WOH G 64": (49590.0, "host_system_distance", "LMC member; Pietrzynski et al. 2019 LMC distance 49.59 kpc"),
    "V* S Dor": (49590.0, "host_system_distance", "LMC member; Pietrzynski et al. 2019 LMC distance 49.59 kpc"),
    "* omi Cet": (92.0, "uncertain_literature_distance", "van Leeuwen 2007 Hipparcos parallax 10.91 +/- 1.22 mas -> 92 +/- 10 pc"),
    # Black holes
    "V* V404 Cyg": (2390.0, "literature_distance", "Miller-Jones et al. 2009 (ApJ 706, L230): VLBI parallax -> 2.39 +/- 0.14 kpc"),
    "Gaia DR3 4373465352415301632": (480.0, "literature_distance", "El-Badry et al. 2023 (MNRAS 518, 1057): Gaia DR3 parallax 2.09 mas -> 480 +/- 27 pc"),
    "Gaia DR3 5870569352746779008": (1160.0, "literature_distance", "El-Badry et al. 2023 (MNRAS 521, 4323): Gaia DR3 astrometric orbit -> 1.16 +/- 0.02 kpc"),
    "Gaia DR3 4318465066420528000": (591.0, "literature_distance", "Gaia Collaboration (Panuzzo et al.) 2024 (A&A 686, L2): 590.6 +/- 5.8 pc"),
    "SS 433": (5500.0, "literature_distance", "Blundell & Bowler 2004 (ApJ 616, L159): jet kinematic distance 5.5 +/- 0.2 kpc; Gaia DR3 parallax disagrees"),
    "V* V4641 Sgr": (6200.0, "uncertain_literature_distance", "MacDonald et al. 2014 (ApJ 784, 2): 6.2 +/- 0.7 kpc; Gaia DR3 parallax agrees within errors"),
    "1A 0620-00": (1060.0, "uncertain_literature_distance", "Cantrell et al. 2010 (ApJ 710, 1127): 1.06 +/- 0.12 kpc; Gaia DR3 suggests ~1.4 kpc"),
    "Granat 1915+105": (8600.0, "uncertain_literature_distance", "Reid et al. 2014 (ApJ 796, 2): VLBI parallax -> 8.6 +2.0/-1.6 kpc"),
    "MAXI J1820+070": (2960.0, "literature_distance", "Atri et al. 2020 (MNRAS 493, L81): VLBI parallax -> 2.96 +/- 0.33 kpc"),
    # Pulsars
    "PSR B0531+21": (1900.0, "literature_distance", "Lin et al. 2023 (ApJ 952, 161): VLBI parallax 0.53 +/- 0.06 mas -> 1.90 +0.22/-0.18 kpc"),
    "PSR B0833-45": (287.0, "literature_distance", "Dodson et al. 2003 (ApJ 596, 1137): VLBI parallax 3.5 +/- 0.2 mas -> 287 +19/-17 pc"),
    "NAME Geminga": (250.0, "uncertain_literature_distance", "Faherty, Walter & Anderson 2007 (Ap&SS 308, 225): HST parallax 4.0 +/- 1.3 mas -> 250 +120/-62 pc"),
    "PSR B1919+21": (1000.0, "uncertain_literature_distance", "Dispersion-measure distance only: NE2001 ~1.0 kpc, YMW16 ~0.3 kpc"),
}


def literature_distance(main_id: str, identifiers: list[str]) -> tuple[float, str, str, bool] | None:
    """Return (distance_pc, quality, note, force) for a curated literature distance."""
    table = {identifier_key(key): value for key, value in LITERATURE_DISTANCE_PC.items()}
    for key in [main_id, *identifiers]:
        entry = table.get(identifier_key(key))
        if entry:
            return entry[0], entry[1], entry[2], (bool(entry[3]) if len(entry) > 3 else False)
    return None


def alias_lookup(table: dict[str, str], main_id: str, identifiers: list[str]) -> str:
    normalized = {identifier_key(key): value for key, value in table.items()}
    for key in [main_id, *identifiers]:
        value = normalized.get(identifier_key(key))
        if value:
            return value
    return ""

LITERATURE_ONLY = [{
    "main_id": "Stephenson 2-18", "ra": 279.759875, "dec": -6.0862597,
    "distance_pc": 5800.0, "spectral_type": "M6", "vmag": None,
    "identifiers": ["Stephenson 2-18", "St2-18"],
    "curated_names": {"Stephenson 2-18"}, "reasons": {"curated_famous"},
    "notes": ["Literature-only row; no unique SIMBAD object was resolved", "Adopted cluster distance 5.8 kpc; uncertain membership"],
}]

COLUMNS = [
    "display_name", "official_iau_name", "simbad_main_id",
    "gaia_dr3_source_id", "hip_id", "hd_id", "bayer_designation",
    "flamsteed_designation", "all_identifiers", "ra_deg", "dec_deg",
    "parallax_mas", "parallax_error_mas", "parallax_over_error",
    "proper_motion_ra_mas_yr", "proper_motion_dec_mas_yr",
    "radial_velocity_km_s", "distance_pc", "distance_ly", "x_ly", "y_ly",
    "z_ly", "r_ly", "phi_deg", "theta_deg", "apparent_magnitude",
    "spectral_type", "stellar_category", "locality", "astrometry_source", "distance_quality_flag",
    "selection_reason", "fame_score", "notes",
]


class WgsnTableParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.in_table = False
        self.in_cell = False
        self.is_header = False
        self.cell_parts: list[str] = []
        self.row: list[str] = []
        self.headers: list[str] = []
        self.rows: list[list[str]] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        attrs_dict = dict(attrs)
        if tag == "table" and attrs_dict.get("id") == "table_1":
            self.in_table = True
        elif self.in_table and tag == "tr":
            self.row = []
        elif self.in_table and tag in ("th", "td"):
            self.in_cell = True
            self.is_header = tag == "th"
            self.cell_parts = []

    def handle_data(self, data: str) -> None:
        if self.in_cell:
            self.cell_parts.append(data)

    def handle_endtag(self, tag: str) -> None:
        if self.in_table and tag in ("th", "td") and self.in_cell:
            value = " ".join("".join(self.cell_parts).split())
            self.row.append(html.unescape(value))
            self.in_cell = False
        elif self.in_table and tag == "tr" and self.row:
            if self.is_header and not self.headers:
                self.headers = self.row
            elif len(self.row) >= 10:
                self.rows.append(self.row)
        elif tag == "table" and self.in_table:
            self.in_table = False


def http_text(url: str, data: dict[str, str] | None = None, attempts: int = 3) -> str:
    encoded = urlencode(data).encode("utf-8") if data else None
    for attempt in range(attempts):
        try:
            request = Request(url, data=encoded, headers={
                "User-Agent": "StarMap-catalog-builder/1.0 (+local reproducible research)",
                "Accept": "application/json,text/html;q=0.9,*/*;q=0.1",
            })
            with urlopen(request, timeout=120) as response:
                return response.read().decode("utf-8")
        except (HTTPError, URLError, TimeoutError) as error:
            if attempt == attempts - 1:
                raise RuntimeError(f"Request failed for {url}: {error}") from error
            time.sleep(2 ** attempt)
    raise AssertionError("unreachable")


def tap_query(url: str, query: str) -> list[list[Any]]:
    payload = {"REQUEST": "doQuery", "LANG": "ADQL", "FORMAT": "json", "QUERY": query}
    response = json.loads(http_text(url, payload))
    if "data" not in response:
        raise RuntimeError(f"TAP response did not contain data: {response}")
    return response["data"]


def chunks(values: list[Any], size: int) -> Iterable[list[Any]]:
    for start in range(0, len(values), size):
        yield values[start:start + size]


def adql_string(value: str) -> str:
    return "'" + value.replace("'", "''") + "'"


def identifier_key(value: str) -> str:
    """SIMBAD pads identifiers ("HD  95735", "Wolf   28"); compare them whitespace-insensitively."""
    return re.sub(r"\s+", " ", value.strip()).casefold()


def parse_wgsn() -> list[dict[str, str]]:
    parser = WgsnTableParser()
    parser.feed(http_text(WGSN_URL))
    normalized_headers = [re.sub(r"\s+", "_", h.strip().lower()) for h in parser.headers]
    rows = []
    for values in parser.rows:
        values += [""] * (len(normalized_headers) - len(values))
        row = dict(zip(normalized_headers, values))
        if row.get("proper_names") and row.get("designation"):
            rows.append(row)
    if len(rows) < 400:
        raise RuntimeError(f"Expected at least 400 WGSN rows, found {len(rows)}")
    return rows


def base_columns(prefix: str = "b") -> str:
    return ",".join([
        f"{prefix}.oid", f"{prefix}.main_id", f"{prefix}.ra", f"{prefix}.dec",
        f"{prefix}.plx_value", f"{prefix}.plx_err", f"{prefix}.pmra", f"{prefix}.pmdec",
        f"{prefix}.rvz_radvel", f"{prefix}.sp_type", f"{prefix}.otype_txt", "v.flux",
    ])


def row_to_object(values: list[Any]) -> dict[str, Any]:
    keys = ["oid", "main_id", "ra", "dec", "plx", "plx_err", "pmra", "pmdec",
            "radial_velocity", "spectral_type", "object_type", "vmag"]
    return dict(zip(keys, values))


def query_vizier_bright() -> list[dict[str, Any]]:
    try:
        rows = tap_query(
            VIZIER_TAP_URL,
            f'SELECT HR,Vmag FROM "V/50/catalog" WHERE Vmag < {BRIGHT_V_LIMIT}',
        )
        return [{"hr": str(hr), "vmag": float(vmag)} for hr, vmag in rows if hr is not None]
    except RuntimeError as error:
        # TAPVizieR is occasionally unavailable (HTTP 503); the classic ASU
        # TSV service serves the same V/50 table.
        print(f"TAPVizieR failed ({error}); falling back to the VizieR ASU service", flush=True)
    query = urlencode({"-source": "V/50/catalog", "Vmag": f"<{BRIGHT_V_LIMIT:g}", "-out": "HR,Vmag", "-out.max": "unlimited"})
    rows = []
    for line in http_text(f"{VIZIER_ASU_URL}?{query}").splitlines():
        parts = [part.strip() for part in line.split("	")]
        if len(parts) < 2 or not parts[0].isdigit():
            continue
        vmag = safe_float(parts[1])
        if vmag is not None:
            rows.append({"hr": parts[0], "vmag": vmag})
    if len(rows) < 400:
        raise RuntimeError(f"Expected at least 400 bright stars from VizieR, found {len(rows)}")
    return rows


def query_simbad_candidates(wgsn: list[dict[str, str]], bright: list[dict[str, Any]]) -> tuple[dict[int, dict[str, Any]], int]:
    objects: dict[int, dict[str, Any]] = {}
    direct_query = f"""
        SELECT {base_columns()}
        FROM basic AS b
        JOIN otypes AS stellar ON b.oid=stellar.oidref AND stellar.otype='*'
        LEFT OUTER JOIN flux AS v ON b.oid=v.oidref AND v.filter='V'
        WHERE b.plx_value >= {NEARBY_MIN_PARALLAX_MAS}
          AND b.otype NOT IN ('Pl','Pl?')
          AND b.ra IS NOT NULL AND b.dec IS NOT NULL
    """
    for values in tap_query(SIMBAD_TAP_URL, direct_query):
        item = row_to_object(values)
        item["reasons"] = set()
        if item.get("vmag") is not None and item["vmag"] < BRIGHT_V_LIMIT:
            item["reasons"].add(f"bright_v<{BRIGHT_V_LIMIT:g}")
        if item.get("plx") is not None and item["plx"] >= NEARBY_MIN_PARALLAX_MAS:
            item["reasons"].add(f"nearby_<={NEARBY_LIMIT_LY:g}ly")
        objects[int(item["oid"])] = item

    named_object_ids: set[int] = set()
    named_query = f"""
        SELECT {base_columns()},i.id
        FROM ident AS i JOIN basic AS b ON i.oidref=b.oid
        JOIN otypes AS stellar ON b.oid=stellar.oidref AND stellar.otype='*'
        LEFT OUTER JOIN flux AS v ON b.oid=v.oidref AND v.filter='V'
        WHERE i.id LIKE 'NAME %'
          AND b.otype NOT IN ('Pl','Pl?')
    """
    for values in tap_query(SIMBAD_TAP_URL, named_query):
        item = row_to_object(values[:12])
        oid = int(item["oid"])
        current = objects.setdefault(oid, item | {"reasons": set()})
        current["reasons"].add("simbad_named_star")
        current.setdefault("simbad_names", set()).add(str(values[12]).removeprefix("NAME "))
        named_object_ids.add(oid)

    lookup: dict[str, dict[str, str]] = {}
    for row in wgsn:
        ids = [row.get("designation", ""), row.get("simbad_spelling", "")]
        if row.get("hip"):
            ids.append(f"HIP {row['hip'].replace(',', '')}")
        for identifier in ids:
            if identifier:
                lookup[identifier_key(identifier)] = row
    for label, aliases in CURATED.items():
        for identifier in aliases:
            lookup.setdefault(identifier_key(identifier), {"curated_label": label})
    for row in bright:
        lookup[identifier_key(f"HR {row['hr']}")] = {"bright_catalog": True}

    identifiers = sorted({identifier for identifier in lookup})
    # Query case-sensitive identifiers in their source spelling.
    source_spellings = {}
    for row in wgsn:
        for identifier in (row.get("designation", ""), row.get("simbad_spelling", "")):
            if identifier:
                source_spellings[identifier_key(identifier)] = identifier
        if row.get("hip"):
            hip = f"HIP {row['hip'].replace(',', '')}"
            source_spellings[identifier_key(hip)] = hip
    for aliases in CURATED.values():
        for identifier in aliases:
            source_spellings[identifier_key(identifier)] = identifier
    for row in bright:
        identifier = f"HR {row['hr']}"
        source_spellings[identifier_key(identifier)] = identifier

    for batch in chunks([source_spellings[i] for i in identifiers], 120):
        # WGSN and Bright Star identifiers are stars by construction; curated
        # identifiers may point at compact objects SIMBAD does not type as
        # stellar (e.g. Sgr A*), so no stellar object-type join here.
        query = f"""
            SELECT {base_columns()},i.id
            FROM ident AS i JOIN basic AS b ON i.oidref=b.oid
            LEFT OUTER JOIN flux AS v ON b.oid=v.oidref AND v.filter='V'
            WHERE i.id IN ({','.join(adql_string(i) for i in batch)})
              AND b.otype NOT IN ('Pl','Pl?')
        """
        for values in tap_query(SIMBAD_TAP_URL, query):
            item = row_to_object(values[:12])
            matched_id = str(values[12])
            oid = int(item["oid"])
            current = objects.setdefault(oid, item | {"reasons": set()})
            match = lookup.get(identifier_key(matched_id), {})
            if match.get("proper_names"):
                current.setdefault("official_names", set()).add(match["proper_names"])
                current["reasons"].add("official_iau_name")
            if match.get("curated_label"):
                current.setdefault("curated_names", set()).add(match["curated_label"])
                current["reasons"].add("curated_famous")
            if match.get("bright_catalog"):
                current["reasons"].add(f"bright_bsc_v<{BRIGHT_V_LIMIT:g}")
    return objects, len(named_object_ids)


def query_identifiers(objects: dict[int, dict[str, Any]]) -> None:
    object_ids = sorted(objects)
    for batch in chunks(object_ids, 500):
        query = f"SELECT oidref,id FROM ident WHERE oidref IN ({','.join(map(str, batch))})"
        for oid, identifier in tap_query(SIMBAD_TAP_URL, query):
            objects[int(oid)].setdefault("identifiers", []).append(str(identifier))


def disambiguate_wgsn(objects: dict[int, dict[str, Any]], wgsn: list[dict[str, str]]) -> None:
    by_name = {row.get("proper_names", ""): row for row in wgsn}
    assignments: dict[str, list[dict[str, Any]]] = {}
    for item in objects.values():
        for name in item.get("official_names", set()):
            assignments.setdefault(name, []).append(item)

    for name, candidates in assignments.items():
        if len(candidates) < 2:
            continue
        row = by_name.get(name, {})
        hip = f"HIP {row.get('hip', '').replace(',', '')}" if row.get("hip") else ""
        designation = row.get("designation", "")
        spelling = row.get("simbad_spelling", "")

        def score(item: dict[str, Any]) -> tuple[int, int]:
            identifiers = set(item.get("identifiers", []))
            value = 0
            if hip and hip in identifiers:
                value += 100
            if designation and (designation == item.get("main_id") or designation in identifiers):
                value += 50
            if spelling and (spelling == item.get("main_id") or spelling in identifiers):
                value += 20
            return value, len(identifiers)

        winner = max(candidates, key=score)
        for item in candidates:
            if item is winner:
                continue
            item["official_names"].discard(name)
            if not item["official_names"]:
                item["reasons"].discard("official_iau_name")

    for oid in [oid for oid, item in objects.items() if not item.get("reasons")]:
        del objects[oid]


def add_unresolved_wgsn(objects: dict[int, dict[str, Any]], wgsn: list[dict[str, str]]) -> None:
    resolved = {name for item in objects.values() for name in item.get("official_names", set())}
    next_id = min(objects, default=0) - 1
    for row in wgsn:
        name = row.get("proper_names", "")
        if not name or name in resolved:
            continue
        identifiers = [row.get("designation", ""), row.get("simbad_spelling", "")]
        if row.get("hip"):
            identifiers.append(f"HIP {row['hip'].replace(',', '')}")
        objects[next_id] = {
            "oid": next_id, "main_id": row.get("designation") or name,
            "ra": safe_float(row.get("ra")), "dec": safe_float(row.get("dec")),
            "plx": None, "plx_err": None, "pmra": None, "pmdec": None,
            "radial_velocity": None, "spectral_type": "", "object_type": "Star",
            "vmag": safe_float(row.get("mag")), "identifiers": [i for i in identifiers if i],
            "official_names": {name}, "reasons": {"official_iau_name"},
            "source_hint": "WGSN", "notes": ["WGSN candidate not resolved to a unique SIMBAD object"],
        }
        next_id -= 1


def add_literature_only_objects(objects: dict[int, dict[str, Any]]) -> None:
    next_id = min(objects, default=0) - 1
    for source in LITERATURE_ONLY:
        item = dict(source)
        item["oid"] = next_id
        item.setdefault("plx", None)
        item.setdefault("plx_err", None)
        item.setdefault("pmra", None)
        item.setdefault("pmdec", None)
        item.setdefault("radial_velocity", None)
        item.setdefault("object_type", "Star")
        objects[next_id] = item
        next_id -= 1


def gaia_source_id(identifiers: list[str]) -> str:
    matches = []
    for identifier in identifiers:
        match = re.fullmatch(r"Gaia DR3\s+(\d+)", identifier, flags=re.IGNORECASE)
        if match:
            matches.append(match.group(1))
    return matches[0] if matches else ""


def query_gaia(objects: dict[int, dict[str, Any]]) -> dict[str, dict[str, Any]]:
    source_ids = sorted({gaia_source_id(o.get("identifiers", [])) for o in objects.values()} - {""})
    gaia: dict[str, dict[str, Any]] = {}
    keys = ["source_id", "ra", "dec", "parallax", "parallax_error", "pmra", "pmdec",
            "radial_velocity", "phot_g_mean_mag", "ruwe", "duplicated_source"]
    for batch in chunks(source_ids, 300):
        query = f"""
            SELECT source_id,ra,dec,parallax,parallax_error,pmra,pmdec,
                   radial_velocity,phot_g_mean_mag,ruwe,duplicated_source
            FROM gaiadr3.gaia_source
            WHERE source_id IN ({','.join(batch)})
        """
        for values in tap_query(GAIA_TAP_URL, query):
            row = dict(zip(keys, values))
            gaia[str(row["source_id"])] = row
    return gaia


def first_matching(identifiers: list[str], patterns: list[str]) -> str:
    for pattern in patterns:
        for identifier in identifiers:
            match = re.fullmatch(pattern, identifier, flags=re.IGNORECASE)
            if match:
                return match.group(1) if match.groups() else identifier
    return ""


def choose_display_name(item: dict[str, Any], identifiers: list[str]) -> tuple[str, str]:
    official_names = sorted(item.get("official_names", []))
    official = official_names[0] if official_names else ""
    if official:
        return official, official
    curated_names = sorted(item.get("curated_names", []))
    if curated_names:
        return curated_names[0], ""
    named = first_matching(identifiers, [r"NAME\s+(.+)"])
    if named:
        return named, ""
    bayer = first_matching(identifiers, [r"([a-zA-Z]+\s+[A-Z][a-z]{2}(?:\s+[A-Z])?)"])
    if bayer:
        return bayer, ""
    flamsteed = first_matching(identifiers, [r"(\d+\s+[A-Z][a-z]{2}(?:\s+[A-Z])?)"])
    if flamsteed:
        return flamsteed, ""
    for prefix in ("HD ", "HIP ", "Gaia DR3 "):
        value = next((i for i in identifiers if i.startswith(prefix)), "")
        if value:
            return value, ""
    return str(item["main_id"]), ""


def safe_float(value: Any) -> float | None:
    if value in (None, ""):
        return None
    try:
        number = float(value)
        return number if math.isfinite(number) else None
    except (TypeError, ValueError):
        return None


def rounded(value: float | None, digits: int = 8) -> float | str:
    return "" if value is None else round(value, digits)


def classify_stellar_category(spectral_type: str, object_type: str, main_id: str, identifiers: list[str] | None = None) -> str:
    override = alias_lookup(CATEGORY_OVERRIDES, main_id, identifiers or [])
    if override:
        return override
    # Composite types such as "M1.5Iab+B2Vn" (Antares) describe several
    # components; classify by the primary one so the companion's "V" does not
    # turn a supergiant into a dwarf.
    spectral = re.split(r"\+(?=[OBAFGKMLTYDWC])", spectral_type.strip().upper())[0].strip()
    object_code = object_type.strip().upper()
    identifier = main_id.strip().upper()
    if object_code in {"BH", "XBH"} or "BLACK HOLE" in object_code or "BLACK HOLE" in identifier:
        return "black_hole"
    if object_code in {"PSR", "PULSAR", "NS"} or "PULSAR" in object_code or identifier.startswith(("PSR ", "PULSAR ")):
        return "neutron_star"
    # White-dwarf classes are DA/DB/DO/DQ/DZ/DC/DX (plus mixtures); "dM6" is
    # legacy notation for a dwarf M star, not a degenerate.
    if re.match(r"^D[ABOQZCX]", spectral) or object_code.startswith("WD"):
        return "white_dwarf"
    if re.match(r"^[LTY][0-9]", spectral) or object_code.startswith("BD"):
        return "brown_dwarf"
    if re.match(r"^(?:D?M)[0-9]", spectral) and ("V" in spectral or spectral.startswith("DM")):
        return "red_dwarf"
    if re.match(r"^G[0-9]", spectral) and "V" in spectral and "IV" not in spectral:
        return "yellow_dwarf"
    if re.match(r"^[OBAFK][0-9]", spectral) and "V" in spectral and "IV" not in spectral:
        return "other_main_sequence"
    if re.search(r"(?:^|[0-9])(I|II|III|IV)(?:[^IV]|$)", spectral):
        return "giant_or_supergiant"
    return "other"


def build_rows(objects: dict[int, dict[str, Any]], gaia: dict[str, dict[str, Any]]) -> list[dict[str, Any]]:
    result = []
    for item in objects.values():
        identifiers = sorted(set(item.get("identifiers", [])), key=str.casefold)
        source_id = gaia_source_id(identifiers)
        g = gaia.get(source_id)
        simbad_parallax = safe_float(item.get("plx"))
        simbad_error = safe_float(item.get("plx_err"))
        gaia_parallax = safe_float(g.get("parallax")) if g else None
        gaia_error = safe_float(g.get("parallax_error")) if g else None
        gaia_snr = gaia_parallax / gaia_error if gaia_parallax and gaia_error and gaia_error > 0 else None
        gaia_ruwe = safe_float(g.get("ruwe")) if g else None
        gaia_reliable = bool(
            gaia_parallax and gaia_parallax > 0 and gaia_snr and gaia_snr >= MIN_PARALLAX_SNR
            and (gaia_ruwe is None or gaia_ruwe <= 1.4)
            and not (g and g.get("duplicated_source"))
        )
        simbad_snr = simbad_parallax / simbad_error if simbad_parallax and simbad_error and simbad_error > 0 else None
        simbad_reliable = bool(simbad_parallax and simbad_parallax > 0 and (simbad_snr is None or simbad_snr >= MIN_PARALLAX_SNR))

        notes = list(item.get("notes", []))
        if gaia_reliable:
            ra, dec = safe_float(g["ra"]), safe_float(g["dec"])
            parallax, parallax_error = gaia_parallax, gaia_error
            pmra, pmdec = safe_float(g.get("pmra")), safe_float(g.get("pmdec"))
            radial_velocity = safe_float(g.get("radial_velocity"))
            source, quality = "Gaia DR3", "reliable_gaia_parallax"
        else:
            ra, dec = safe_float(item.get("ra")), safe_float(item.get("dec"))
            parallax, parallax_error = simbad_parallax, simbad_error
            pmra, pmdec = safe_float(item.get("pmra")), safe_float(item.get("pmdec"))
            radial_velocity = safe_float(item.get("radial_velocity"))
            source = item.get("source_hint", "SIMBAD")
            quality = "reliable_simbad_parallax" if simbad_reliable else "uncertain_or_missing_distance"
            if g:
                notes.append("Gaia astrometry rejected: low SNR, RUWE > 1.4, duplicate, or non-positive parallax")

        distance_pc = 1000.0 / parallax if parallax and parallax > 0 and (gaia_reliable or simbad_reliable) else None
        fallback = literature_distance(str(item.get("main_id")), identifiers)
        if fallback and fallback[3] and distance_pc is not None:
            notes.append("Catalog parallax deliberately overridden by literature distance")
            distance_pc = None
        if distance_pc is None and item.get("distance_pc"):
            distance_pc = safe_float(item["distance_pc"])
            source, quality = "Literature", "uncertain_literature_distance"
        elif distance_pc is None and fallback:
            distance_pc = fallback[0]
            source, quality = "Literature", fallback[1]
            notes.append(fallback[2])
        distance_ly = distance_pc * LY_PER_PC if distance_pc else None
        if distance_ly is not None and (ra is None or dec is None):
            distance_pc = distance_ly = None
            quality = "missing_coordinates"
        if distance_ly is not None:
            ra_rad, dec_rad = math.radians(ra), math.radians(dec)
            x = distance_ly * math.cos(dec_rad) * math.cos(ra_rad)
            y = distance_ly * math.cos(dec_rad) * math.sin(ra_rad)
            z = distance_ly * math.sin(dec_rad)
        else:
            x = y = z = None

        display, official = choose_display_name(item, identifiers)
        hip = first_matching(identifiers, [r"HIP\s+(\d+[A-Z]?)"])
        hd = first_matching(identifiers, [r"HD\s+(\d+[A-Z]?)"])
        bayer = first_matching(identifiers, [r"([a-zA-Z]+\s+[A-Z][a-z]{2}(?:\s+[A-Z])?)"])
        flamsteed = first_matching(identifiers, [r"(\d+\s+[A-Z][a-z]{2}(?:\s+[A-Z])?)"])
        vmag = safe_float(item.get("vmag"))
        reasons = set(item.get("reasons", []))
        if official:
            reasons.add("official_iau_name")
        if any(name.casefold() == display.casefold() for name in CURATED):
            reasons.add("curated_famous")
        fame = (100 if official else 0) + (50 if vmag is not None and vmag < 2 else 0)
        fame += 30 if distance_ly is not None and distance_ly < 25 else 0
        fame += 25 if "curated_famous" in reasons else 0
        fame += 10 if bayer else 0
        if g and gaia_ruwe is not None:
            notes.append(f"Gaia RUWE={gaia_ruwe:.3f}")

        spectral_type = item.get("spectral_type") or ""
        stellar_category = classify_stellar_category(
            spectral_type, str(item.get("object_type") or ""), str(item.get("main_id") or ""), identifiers
        )
        locality = alias_lookup(LOCALITY_OVERRIDES, str(item.get("main_id") or ""), identifiers) or item.get("locality") or DEFAULT_LOCALITY
        if distance_ly is not None and distance_ly > EXTRAGALACTIC_LY and locality == DEFAULT_LOCALITY:
            locality = "Beyond the Milky Way (host not recorded)"
            notes.append("Distance exceeds the Milky Way's extent; host galaxy not curated")
        result.append({
            "display_name": display, "official_iau_name": official,
            "simbad_main_id": item["main_id"], "gaia_dr3_source_id": source_id,
            "hip_id": hip, "hd_id": hd, "bayer_designation": bayer,
            "flamsteed_designation": flamsteed,
            "all_identifiers": " | ".join(identifiers), "ra_deg": rounded(ra),
            "dec_deg": rounded(dec), "parallax_mas": rounded(parallax, 6),
            "parallax_error_mas": rounded(parallax_error, 6),
            "parallax_over_error": rounded((parallax / parallax_error) if parallax and parallax_error else None, 3),
            "proper_motion_ra_mas_yr": rounded(pmra, 6),
            "proper_motion_dec_mas_yr": rounded(pmdec, 6),
            "radial_velocity_km_s": rounded(radial_velocity, 4),
            "distance_pc": rounded(distance_pc, 6), "distance_ly": rounded(distance_ly, 6),
            "x_ly": rounded(x, 6), "y_ly": rounded(y, 6), "z_ly": rounded(z, 6),
            "r_ly": rounded(distance_ly, 6), "phi_deg": rounded(ra),
            "theta_deg": rounded(90.0 - dec if dec is not None else None),
            "apparent_magnitude": rounded(vmag, 3), "spectral_type": spectral_type,
            "stellar_category": stellar_category, "locality": locality,
            "astrometry_source": source, "distance_quality_flag": quality,
            "selection_reason": " | ".join(sorted(reasons)), "fame_score": fame,
            "notes": "; ".join(notes),
        })
    return sorted(result, key=lambda row: (-int(row["fame_score"]), float(row["apparent_magnitude"] or 99), row["display_name"].casefold()))


def write_outputs(rows: list[dict[str, Any]], output_dir: Path, metadata: dict[str, Any]) -> None:
    output_dir.mkdir(parents=True, exist_ok=True)
    with (output_dir / "stars.csv").open("w", encoding="utf-8-sig", newline="") as stream:
        writer = csv.DictWriter(stream, fieldnames=COLUMNS)
        writer.writeheader()
        writer.writerows(rows)

    browser_rows = []
    for row in rows:
        if row["distance_ly"] == "":
            continue
        browser_rows.append({
            "name": row["display_name"], "officialName": row["official_iau_name"],
            "simbadId": row["simbad_main_id"], "gaiaId": row["gaia_dr3_source_id"],
            "hipId": row["hip_id"], "hdId": row["hd_id"], "ra": row["ra_deg"],
            "dec": row["dec_deg"], "distanceLy": row["distance_ly"],
            "x": row["x_ly"], "y": row["y_ly"], "z": row["z_ly"],
            "magnitude": row["apparent_magnitude"], "spectralType": row["spectral_type"],
            "category": row["stellar_category"], "locality": row["locality"],
            "astrometrySource": row["astrometry_source"], "distanceQuality": row["distance_quality_flag"],
            "distanceNote": row["notes"] if row["astrometry_source"] == "Literature" else "",
            "selectionReason": row["selection_reason"], "fameScore": row["fame_score"],
        })
    payload = "// Generated by scripts/build_catalog.py; do not edit manually.\n"
    payload += "window.STAR_CATALOG_META = " + json.dumps(metadata, ensure_ascii=False, separators=(",", ":")) + ";\n"
    payload += "window.STAR_CATALOG = " + json.dumps(browser_rows, ensure_ascii=False, separators=(",", ":")) + ";\n"
    (output_dir / "stars.js").write_text(payload, encoding="utf-8")
    (output_dir / "catalog-metadata.json").write_text(json.dumps(metadata, indent=2) + "\n", encoding="utf-8")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=Path(__file__).resolve().parents[1] / "data")
    parser.add_argument("--skip-gaia", action="store_true", help="Use SIMBAD astrometry only")
    args = parser.parse_args()

    wgsn = parse_wgsn()
    bright = query_vizier_bright()
    objects, simbad_named_count = query_simbad_candidates(wgsn, bright)
    query_identifiers(objects)
    disambiguate_wgsn(objects, wgsn)
    add_unresolved_wgsn(objects, wgsn)
    add_literature_only_objects(objects)
    gaia = {} if args.skip_gaia else query_gaia(objects)
    rows = build_rows(objects, gaia)
    metadata = {
        "schemaVersion": 1,
        "generatedUtc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "selectionRule": {
            "officialIauNames": True, "brightVLessThan": BRIGHT_V_LIMIT,
            "nearbyWithinLy": NEARBY_LIMIT_LY, "allSimbadNamedStars": True,
            "curated": sorted(CURATED),
        },
        "rowSemantics": "One SIMBAD object per resolved row; resolved components remain separate. Unresolved WGSN and literature-only exceptions are explicitly flagged.",
        "coordinateFrame": "Sun-centered ICRS equatorial Cartesian; X=RA0/Dec0, Y=RA90/Dec0, Z=Dec+90.",
        "distanceRule": f"Positive parallax with SNR >= {MIN_PARALLAX_SNR:g}; Gaia also requires RUWE <= 1.4 and non-duplicated source. Curated literature distances are recorded per row in notes.",
        "localityRule": f"'{DEFAULT_LOCALITY}' unless curated; positioned rows beyond {EXTRAGALACTIC_LY:g} ly without a curated host are flagged.",
        "sources": {"wgsn": WGSN_URL, "brightStarCatalog": VIZIER_TAP_URL, "simbadTap": SIMBAD_TAP_URL, "gaiaTap": GAIA_TAP_URL},
        "wgsnCandidateCount": len(wgsn), "brightCandidateCount": len(bright),
        "simbadNamedCandidateCount": simbad_named_count, "catalogRowCount": len(rows),
        "renderableRowCount": sum(row["distance_ly"] != "" for row in rows),
    }
    write_outputs(rows, args.output, metadata)
    print(json.dumps(metadata, indent=2))


if __name__ == "__main__":
    main()
