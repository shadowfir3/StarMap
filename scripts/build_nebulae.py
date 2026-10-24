#!/usr/bin/env python3
"""Build the nebula catalog: positions from SIMBAD, curated literature distances,
and licence-checked Wikimedia Commons images embedded as data URIs.

Standard library only, like build_catalog.py.  Outputs:

  data/nebulae.js            browser payload (metadata + rows with embedded images)
  data/nebulae.csv           audit table without image bytes
  data/nebulae/<key>.jpg     the downloaded Wikimedia thumbnails (standard width)
  data/nebulae/sources.json  cached Commons/SIMBAD responses for --offline rebuilds
  CREDITS.md                 per-image attribution and licence list (the marked
                             galaxy section written by build_galaxy.py is preserved)

Only public-domain, CC0 and CC BY images are accepted; the licence is read from
the Commons extmetadata of each pinned file at build time, never assumed.
"""

from __future__ import annotations

import argparse
import base64
import csv
import html
import json
import math
from pathlib import Path
import re
import time
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import quote, urlencode
from urllib.request import Request, urlopen

SIMBAD_TAP_URL = "https://simbad.cds.unistra.fr/simbad/sim-tap/sync"
COMMONS_API_URL = "https://commons.wikimedia.org/w/api.php"
USER_AGENT = "StarMap-nebula-builder/1.0 (https://github.com/shadowfir3/StarMap; local reproducible research) python-urllib"
LY_PER_PC = 3.261563777
# Wikimedia only serves these thumbnail widths to external requests (T414805).
STANDARD_THUMB_WIDTHS = (20, 40, 60, 120, 250, 330, 500, 960, 1280, 1920, 3840)
ALLOWED_LICENSE = re.compile(r"^(Public domain|CC0(?: 1\.0)?|CC BY(?: \d(?:\.\d)?)?(?: [A-Za-z]+)?)$", re.I)

KIND_LABELS = {
    "hii": "Emission nebula (H II region)",
    "planetary": "Planetary nebula",
    "snr": "Supernova remnant",
    "reflection": "Reflection nebula",
    "dark": "Dark nebula / molecular cloud",
    "protoplanetary": "Protoplanetary nebula",
    "lbv": "Luminous blue variable ejecta nebula",
}

# Distance quality mirrors build_catalog.py: literature_distance (well
# constrained, roughly <15 %), uncertain_literature_distance (larger or
# discordant), host_system_distance (galaxy or cluster distance adopted).
# Sizes are the apparent extent used for the sprite; SIMBAD's galdim_majaxis
# is preferred when present and `size_arcmin` is the fallback.
NEBULAE: list[dict[str, Any]] = [
    dict(key="m42", name="Orion Nebula", aliases=["M 42", "NGC 1976"], simbad="M 42", kind="hii",
         distance_pc=390, err_minus_pc=10, err_plus_pc=10, quality="literature_distance",
         source="Kounkel et al. 2018 (AJ 156, 84): 389 +/- 3 pc from Gaia DR2 members of the Orion Nebula Cluster; Grossschedl et al. 2018 give ~400 pc for the head of Orion A",
         bibcode="2018AJ....156...84K", size_arcmin=65,
         image="Orion Nebula - Hubble 2006 mosaic 18000.jpg"),
    dict(key="horsehead", name="Horsehead Nebula", aliases=["Barnard 33", "IC 434"], simbad="NAME Horsehead Nebula", kind="dark",
         distance_pc=400, err_minus_pc=20, err_plus_pc=20, quality="literature_distance",
         source="Orion B cloud distance from Gaia DR2 YSOs and dust (Kounkel et al. 2018; Zucker et al. 2020), ~400 pc",
         bibcode="2018AJ....156...84K", size_arcmin=8,
         image="Horsehead-Hubble.jpg"),
    dict(key="flame", name="Flame Nebula", aliases=["NGC 2024", "Sh2-277"], simbad="NAME Flame Nebula", kind="hii",
         distance_pc=400, err_minus_pc=20, err_plus_pc=20, quality="literature_distance",
         source="Orion B cloud distance from Gaia DR2 YSOs and dust (Kounkel et al. 2018; Zucker et al. 2020), ~400 pc",
         bibcode="2018AJ....156...84K", size_arcmin=30,
         image="Flame Nebula NGC 2024.jpg"),
    dict(key="m1", name="Crab Nebula", aliases=["M 1", "NGC 1952", "Taurus A", "SN 1054"], simbad="M 1", kind="snr",
         distance_pc=1900, err_minus_pc=180, err_plus_pc=220, quality="literature_distance",
         source="Lin et al. 2023 (ApJ 952, 161): VLBI parallax of the Crab Pulsar 0.53 +/- 0.06 mas -> 1.90 +0.22/-0.18 kpc",
         bibcode="2023ApJ...952..161L", size_arcmin=7,
         image="Crab Nebula.jpg"),
    dict(key="m16", name="Eagle Nebula", aliases=["M 16", "NGC 6611", "IC 4703"], simbad="M 16", kind="hii",
         distance_pc=1700, err_minus_pc=120, err_plus_pc=130, quality="literature_distance",
         source="Kuhn et al. 2019 (ApJ 870, 32): Gaia DR2 distance to NGC 6611 1.74 +0.13/-0.12 kpc; Zucker et al. 2020 dust distance 1.69 kpc",
         bibcode="2019ApJ...870...32K", size_arcmin=70,
         image="Eagle Nebula from ESO.jpg"),
    dict(key="pillars", name="Pillars of Creation", aliases=["M 16 pillars"], simbad="", kind="hii",
         ra=274.7000, dec=-13.8167,
         distance_pc=1700, err_minus_pc=120, err_plus_pc=130, quality="host_system_distance",
         source="Part of the Eagle Nebula (M 16); Kuhn et al. 2019 Gaia DR2 distance to NGC 6611 adopted",
         bibcode="2019ApJ...870...32K", size_arcmin=4,
         image="Pillars of Creation (NIRCam Image).jpg"),
    dict(key="m57", name="Ring Nebula", aliases=["M 57", "NGC 6720"], simbad="M 57", kind="planetary",
         distance_pc=788, err_minus_pc=27, err_plus_pc=27, quality="literature_distance",
         source="Gaia EDR3 parallax of the central star, Bailer-Jones et al. 2021 geometric distance 787.7 +/- 27 pc (via SIMBAD); Chornay & Walton 2021",
         bibcode="2021AJ....161..147B", size_arcmin=1.5,
         image="Webb captures detailed beauty of Ring Nebula (NIRCam image) (weic2320b).jpg"),
    dict(key="ngc7293", name="Helix Nebula", aliases=["NGC 7293", "Caldwell 63"], simbad="NGC 7293", kind="planetary",
         distance_pc=200, err_minus_pc=2, err_plus_pc=2, quality="literature_distance",
         source="Gaia EDR3 parallax of the central star 5.01 +/- 0.04 mas; Bailer-Jones et al. 2021 distance 199.5 +/- 1.7 pc (via SIMBAD)",
         bibcode="2021AJ....161..147B", size_arcmin=16,
         image="NGC7293 (2004).jpg"),
    dict(key="m27", name="Dumbbell Nebula", aliases=["M 27", "NGC 6853"], simbad="M 27", kind="planetary",
         distance_pc=389, err_minus_pc=6, err_plus_pc=6, quality="literature_distance",
         source="Gaia EDR3 parallax of the central star 2.57 +/- 0.04 mas; Bailer-Jones et al. 2021 distance 389 +/- 6 pc (via SIMBAD)",
         bibcode="2021AJ....161..147B", size_arcmin=7,
         image="M27 - Dumbbell Nebula.jpg"),
    dict(key="ngc6543", name="Cat's Eye Nebula", aliases=["NGC 6543", "Caldwell 6"], simbad="NGC 6543", kind="planetary",
         distance_pc=1366, err_minus_pc=54, err_plus_pc=54, quality="literature_distance",
         source="Gaia EDR3 parallax of the central star 0.73 +/- 0.03 mas; Bailer-Jones et al. 2021 distance 1366 +/- 54 pc (via SIMBAD)",
         bibcode="2021AJ....161..147B", size_arcmin=0.7,
         image="NGC6543.jpg"),
    dict(key="ngc3372", name="Carina Nebula", aliases=["NGC 3372", "Caldwell 92", "Eta Carinae Nebula"], simbad="NGC 3372", kind="hii",
         distance_pc=2350, err_minus_pc=80, err_plus_pc=80, quality="literature_distance",
         source="Shull, Darling & Danforth 2021 (ApJ 914, 18): Gaia EDR3 parallaxes of 69 O-type members -> 2.35 +/- 0.08 kpc; Goeppl & Preibisch 2022 agree",
         bibcode="2021ApJ...914...18S", size_arcmin=120,
         image="Carina Nebula.jpg"),
    dict(key="homunculus", name="Homunculus Nebula", aliases=["Eta Carinae ejecta"], simbad="NAME Homunculus Nebula", kind="lbv",
         distance_pc=2350, err_minus_pc=50, err_plus_pc=50, quality="literature_distance",
         source="Smith 2006 (ApJ 644, 1151): expansion parallax of the Homunculus -> 2.35 +/- 0.05 kpc",
         bibcode="2006ApJ...644.1151S", size_arcmin=0.3,
         image="EtaCarinae.jpg"),
    dict(key="m8", name="Lagoon Nebula", aliases=["M 8", "NGC 6523", "NGC 6530", "Sh2-25"], simbad="M 8", kind="hii",
         distance_pc=1300, err_minus_pc=70, err_plus_pc=70, quality="literature_distance",
         source="Kuhn et al. 2019 (ApJ 870, 32): Gaia DR2 distance to NGC 6530 1.34 +0.08/-0.07 kpc; Zucker et al. 2020 dust distance 1.27 kpc",
         bibcode="2019ApJ...870...32K", size_arcmin=90,
         image="VST images the Lagoon Nebula.jpg"),
    dict(key="m20", name="Trifid Nebula", aliases=["M 20", "NGC 6514", "Sh2-30"], simbad="M 20", kind="hii",
         distance_pc=1260, err_minus_pc=70, err_plus_pc=80, quality="literature_distance",
         source="Kuhn et al. 2019 (ApJ 870, 32): Gaia DR2 distance 1.26 +0.08/-0.07 kpc",
         bibcode="2019ApJ...870...32K", size_arcmin=28,
         image="The Trifid Nebula.jpg"),
    dict(key="m17", name="Omega Nebula", aliases=["M 17", "NGC 6618", "Swan Nebula", "Sh2-45"], simbad="M 17", kind="hii",
         distance_pc=1680, err_minus_pc=110, err_plus_pc=130, quality="literature_distance",
         source="Kuhn et al. 2019 (ApJ 870, 32): Gaia DR2 distance 1.68 +0.13/-0.11 kpc; VLBI methanol-maser parallax 1.98 +0.14/-0.12 kpc (Xu et al. 2011)",
         bibcode="2019ApJ...870...32K", size_arcmin=25,
         image="The Omega Nebula (M17) (omega-nebula).jpg"),
    dict(key="rosette", name="Rosette Nebula", aliases=["NGC 2237", "NGC 2244", "Caldwell 49", "Sh2-275"], simbad="NGC 2237", kind="hii",
         distance_pc=1500, err_minus_pc=60, err_plus_pc=60, quality="literature_distance",
         source="Kuhn et al. 2019 (ApJ 870, 32): Gaia DR2 distance to NGC 2244 1.55 +0.10/-0.09 kpc; Muzic et al. 2022 Gaia EDR3 1.44-1.49 kpc",
         bibcode="2019ApJ...870...32K", size_arcmin=80,
         image="Rosette Nebula, NGC 2237 (noao-rosette).jpg"),
    dict(key="veil", name="Veil Nebula", aliases=["Cygnus Loop", "NGC 6960", "NGC 6992", "Caldwell 33", "Caldwell 34"], simbad="NAME Cygnus Loop", kind="snr",
         distance_pc=725, err_minus_pc=15, err_plus_pc=15, quality="literature_distance",
         source="Fesen et al. 2021 (MNRAS 507, 244): Gaia EDR3 parallaxes of stars behind and in front of the remnant -> 725 +/- 15 pc",
         bibcode="2021MNRAS.507..244F", size_arcmin=180,
         image="Wide-field ground-based astrophoto of the Veil Nebula (heic0712g).jpg"),
    dict(key="ngc7000", name="North America Nebula", aliases=["NGC 7000", "Caldwell 20", "Sh2-117"], simbad="NGC 7000", kind="hii",
         distance_pc=795, err_minus_pc=25, err_plus_pc=25, quality="literature_distance",
         source="Kuhn et al. 2020 (ApJ 899, 128): Gaia DR2 parallaxes of 395 young stars in the North America/Pelican complex -> 795 +/- 25 pc",
         bibcode="2020ApJ...899..128K", size_arcmin=120,
         image="The North America Nebula (ground-based image) (heic0510a).jpg"),
    dict(key="ngc7635", name="Bubble Nebula", aliases=["NGC 7635", "Caldwell 11", "Sh2-162"], simbad="NGC 7635", kind="hii",
         distance_pc=3000, err_minus_pc=140, err_plus_pc=140, quality="literature_distance",
         source="Gaia EDR3 parallax of the ionizing star BD+60 2522 (0.334 +/- 0.015 mas); Bailer-Jones et al. 2021 distance 2.99 +/- 0.14 kpc",
         bibcode="2021AJ....161..147B", size_arcmin=3,
         image="The Bubble Nebula - NGC 7635 - Heic1608a.jpg"),
    dict(key="ngc6302", name="Butterfly Nebula", aliases=["NGC 6302", "Bug Nebula", "Caldwell 69"], simbad="NGC 6302", kind="planetary",
         distance_pc=1170, err_minus_pc=140, err_plus_pc=140, quality="literature_distance",
         source="Meaburn et al. 2008 (MNRAS 385, 269): expansion parallax of the lobes -> 1.17 +/- 0.14 kpc",
         bibcode="2008MNRAS.385..269M", size_arcmin=3,
         image="NGC 6302 Hubble 2009.full.jpg"),
    dict(key="cone", name="Cone Nebula", aliases=["NGC 2264", "Christmas Tree Cluster", "Sh2-273"], simbad="NGC 2264", kind="hii",
         distance_pc=720, err_minus_pc=15, err_plus_pc=15, quality="literature_distance",
         source="Maiz Apellaniz 2019 (A&A 630, A119): Gaia DR2 distance to NGC 2264 719 +/- 16 pc; Cantat-Gaudin et al. 2020 707 pc",
         bibcode="2019A&A...630A.119M", size_arcmin=12,
         image="Cone Nebula (NGC 2264) Star-Forming Pillar of Gas and Dust.jpg"),
    dict(key="witchhead", name="Witch Head Nebula", aliases=["IC 2118", "NGC 1909"], simbad="IC 2118", kind="reflection",
         distance_pc=295, err_minus_pc=20, err_plus_pc=13, quality="literature_distance",
         source="Zucker et al. 2020 (A&A 633, A51): Gaia DR2 + dust distance 295 +13/-20 pc",
         bibcode="2020A&A...633A..51Z", size_arcmin=120,
         image="Witch Head Nebula.jpg"),
    dict(key="ngc1499", name="California Nebula", aliases=["NGC 1499", "Sh2-220"], simbad="NGC 1499", kind="hii",
         distance_pc=470, err_minus_pc=25, err_plus_pc=25, quality="literature_distance",
         source="Zucker et al. 2019 (ApJ 879, 125): Gaia DR2 + dust distance 470 +/- 2 (+/- 24 systematic) pc",
         bibcode="2019ApJ...879..125Z", size_arcmin=100,
         image="California nebula NGC1499.jpg"),
    dict(key="ic1805", name="Heart Nebula", aliases=["IC 1805", "Sh2-190", "Melotte 15"], simbad="IC 1805", kind="hii",
         distance_pc=2000, err_minus_pc=100, err_plus_pc=100, quality="literature_distance",
         source="W3/W4/W5 complex: VLBI parallax of W3(OH) 1.95 +/- 0.04 kpc (Xu et al. 2006, Science 311, 54); Cantat-Gaudin et al. 2020 Gaia DR2 1.96 kpc",
         bibcode="2006Sci...311...54X", size_arcmin=150,
         image="Heart Nebula -IC 1805, Sh2-190.jpg"),
    dict(key="ic1848", name="Soul Nebula", aliases=["IC 1848", "Sh2-199", "W5"], simbad="IC 1848", kind="hii",
         distance_pc=2000, err_minus_pc=100, err_plus_pc=100, quality="literature_distance",
         source="W3/W4/W5 complex: VLBI parallax of W3(OH) 1.95 +/- 0.04 kpc (Xu et al. 2006); Zucker et al. 2020 dust distance 1.98 kpc",
         bibcode="2006Sci...311...54X", size_arcmin=100,
         image="Soul nebula (53327273623).jpg"),
    dict(key="m97", name="Owl Nebula", aliases=["M 97", "NGC 3587"], simbad="M 97", kind="planetary",
         distance_pc=811, err_minus_pc=30, err_plus_pc=30, quality="literature_distance",
         source="Gaia EDR3 parallax of the central star 1.23 +/- 0.05 mas; Bailer-Jones et al. 2021 / Chornay & Walton 2021 distance 811 +/- 30 pc",
         bibcode="2021AJ....161..147B", size_arcmin=3.3,
         image="Gemini North image of the planetary nebula M97 (geminiann10008a).jpg"),
    dict(key="ngc3132", name="Southern Ring Nebula", aliases=["NGC 3132", "Eight-Burst Nebula", "Caldwell 74"], simbad="NGC 3132", kind="planetary",
         distance_pc=754, err_minus_pc=18, err_plus_pc=15, quality="literature_distance",
         source="De Marco et al. 2022 (Nature Astronomy 6, 1421): Gaia EDR3 parallax of the A-type companion -> 754 +15/-18 pc",
         bibcode="2022NatAs...6.1421D", size_arcmin=1.0,
         image="Southern Ring Nebula by Webb Telescope (2022).jpg"),
    dict(key="ngc2392", name="Eskimo Nebula", aliases=["NGC 2392", "Lion Nebula", "Clown Face Nebula", "Caldwell 39"], simbad="NGC 2392", kind="planetary",
         distance_pc=1795, err_minus_pc=130, err_plus_pc=150, quality="literature_distance",
         source="Chornay & Walton 2021 (A&A 656, A110): Gaia EDR3 parallax of the central star 0.545 +/- 0.047 mas -> 1.80 +0.15/-0.13 kpc",
         bibcode="2021A&A...656A.110C", size_arcmin=0.8,
         image="Ngc2392.jpg"),
    dict(key="ngc6888", name="Crescent Nebula", aliases=["NGC 6888", "Caldwell 27", "Sh2-105"], simbad="NGC 6888", kind="hii",
         distance_pc=1730, err_minus_pc=50, err_plus_pc=50, quality="literature_distance",
         source="Gaia EDR3 parallax of the Wolf-Rayet star WR 136 (0.577 +/- 0.016 mas); Bailer-Jones et al. 2021 distance 1732 +/- 48 pc",
         bibcode="2021AJ....161..147B", size_arcmin=18,
         image="Crescent, NGC 6888 (noao-04494).jpg"),
    dict(key="abell21", name="Medusa Nebula", aliases=["Abell 21", "Sh2-274", "PN A66 21"], simbad="PN A66 21", kind="planetary",
         distance_pc=592, err_minus_pc=24, err_plus_pc=24, quality="literature_distance",
         source="Gaia EDR3 parallax of the central star 1.69 +/- 0.07 mas; Bailer-Jones et al. 2021 distance 592 +/- 24 pc",
         bibcode="2021AJ....161..147B", size_arcmin=10,
         image="ESO Very Large Telescope images the Medusa Nebula.jpg"),
    dict(key="ngc281", name="Pacman Nebula", aliases=["NGC 281", "IC 1590", "Sh2-184"], simbad="NGC 281", kind="hii",
         distance_pc=2820, err_minus_pc=240, err_plus_pc=240, quality="literature_distance",
         source="Sato et al. 2008 (PASJ 60, 975): VERA H2O-maser parallax -> 2.82 +/- 0.24 kpc",
         bibcode="2008PASJ...60..975S", size_arcmin=35,
         image="Pacman nebula.jpg"),
    dict(key="wd2", name="Westerlund 2 / Gum 29", aliases=["Westerlund 2", "Gum 29", "RCW 49"], simbad="Cl Westerlund 2", kind="hii",
         distance_pc=4160, err_minus_pc=270, err_plus_pc=270, quality="uncertain_literature_distance",
         source="Vargas Alvarez et al. 2013 (AJ 145, 125): spectrophotometric distance 4.16 +/- 0.07 (+/- 0.26 systematic) kpc; Gaia DR2 ~4.2 kpc (Cantat-Gaudin et al. 2018)",
         bibcode="2013AJ....145..125V", size_arcmin=40,
         image="Heic1509a.jpg"),
    dict(key="ngc3603", name="NGC 3603", aliases=["NGC 3603", "HD 97950"], simbad="NGC 3603", kind="hii",
         distance_pc=7200, err_minus_pc=500, err_plus_pc=600, quality="literature_distance",
         source="Drew, Monguio & Wright 2019 (MNRAS 486, 1034): Gaia DR2 O stars -> 7.2 +/- 0.1 kpc; Maiz Apellaniz 2022 EDR3 7.13 +0.59/-0.50 kpc",
         bibcode="2019MNRAS.486.1034D", size_arcmin=10,
         image="Starburst Cluster Shows Celestial Fireworks.jpg"),
    dict(key="ngc3324", name="Cosmic Cliffs (NGC 3324)", aliases=["NGC 3324", "Gum 31", "IC 2599"], simbad="NGC 3324", kind="hii",
         distance_pc=2350, err_minus_pc=50, err_plus_pc=50, quality="literature_distance",
         source="Goeppl & Preibisch 2022 (A&A 660, A11): Gaia EDR3 distance to the Carina complex 2.35 +/- 0.05 kpc; Cantat-Gaudin et al. 2020 2.39 kpc",
         bibcode="2022A&A...660A..11G", size_arcmin=15,
         image="NASA’s Webb Reveals Cosmic Cliffs, Glittering Landscape of Star Birth.jpg"),
    dict(key="ngc2070", name="Tarantula Nebula", aliases=["NGC 2070", "30 Doradus", "Caldwell 103"], simbad="NGC 2070", kind="hii",
         locality="Large Magellanic Cloud",
         distance_pc=49590, err_minus_pc=550, err_plus_pc=550, quality="host_system_distance",
         source="LMC distance from eclipsing binaries, Pietrzynski et al. 2019 (Nature 567, 200): 49.59 +/- 0.09 (+/- 0.54 systematic) kpc",
         bibcode="2019Natur.567..200P", size_arcmin=40,
         image="30 Doradus, Tarantula Nebula.jpg"),
    dict(key="coalsack", name="Coalsack Nebula", aliases=["Coalsack", "Caldwell 99"], simbad="NAME Coalsack", kind="dark",
         distance_pc=189, err_minus_pc=6, err_plus_pc=6, quality="literature_distance",
         source="Zucker et al. 2020 (A&A 633, A51): Gaia DR2 + dust distance 189 +/- 6 pc",
         bibcode="2020A&A...633A..51Z", size_arcmin=360,
         image="Part of the Coalsack Nebula.jpg"),
    dict(key="rhooph", name="Rho Ophiuchi Cloud Complex", aliases=["Rho Ophiuchi cloud", "LDN 1688", "IC 4604"], simbad="NAME rho Oph Cloud", kind="dark",
         distance_pc=138, err_minus_pc=3, err_plus_pc=3, quality="literature_distance",
         source="Ortiz-Leon et al. 2017 (ApJ 834, 141): VLBI parallaxes of young stars (GOBELINS) -> 137.3 +/- 1.2 pc; Zucker et al. 2020 139 pc",
         bibcode="2017ApJ...834..141O", size_arcmin=300,
         image="Rho Ophiuchi.jpg"),
    dict(key="pipe", name="Pipe Nebula", aliases=["LDN 1773", "Barnard 59", "Barnard 78"], simbad="NAME Pipe Nebula", kind="dark",
         distance_pc=163, err_minus_pc=5, err_plus_pc=5, quality="literature_distance",
         source="Dzib et al. 2018 (ApJ 867, 151): VLBI + Gaia DR2 distance to Barnard 59 163 +/- 5 pc",
         bibcode="2018ApJ...867..151D", size_arcmin=300,
         image="The Pipe Nebula.jpg"),
    dict(key="velasnr", name="Vela Supernova Remnant", aliases=["Vela SNR", "Gum 16"], simbad="NAME Vela SNR", kind="snr",
         distance_pc=287, err_minus_pc=17, err_plus_pc=19, quality="literature_distance",
         source="Dodson et al. 2003 (ApJ 596, 1137): VLBI parallax of the Vela Pulsar 3.5 +/- 0.2 mas -> 287 +19/-17 pc",
         bibcode="2003ApJ...596.1137D", size_arcmin=480,
         image="Vela supernova - VST - Eso2214a.jpg"),
    dict(key="casa", name="Cassiopeia A", aliases=["Cas A", "3C 461", "SNR G111.7-02.1"], simbad="NAME Cas A", kind="snr",
         distance_pc=3400, err_minus_pc=100, err_plus_pc=300, quality="literature_distance",
         source="Reed et al. 1995 (ApJ 440, 706): kinematic distance from knot proper motions and radial velocities 3.4 +0.3/-0.1 kpc",
         bibcode="1995ApJ...440..706R", size_arcmin=5,
         image="Cassiopeia A Spitzer Crop.jpg"),
    dict(key="tycho", name="Tycho's Supernova Remnant", aliases=["SN 1572", "3C 10", "SNR G120.1+01.4"], simbad="NAME Tycho SNR", kind="snr",
         distance_pc=2800, err_minus_pc=800, err_plus_pc=800, quality="uncertain_literature_distance",
         source="Published values span 2.5-4 kpc: HI absorption 2.5-3 kpc (Tian & Leahy 2011, ApJ 729, L15), X-ray expansion 4 +/- 1 kpc (Hayato et al. 2010); 2.8 kpc adopted",
         bibcode="2011ApJ...729L..15T", size_arcmin=8,
         image="Tycho-supernova-xray.jpg"),
    dict(key="keplersnr", name="Kepler's Supernova Remnant", aliases=["SN 1604", "3C 358", "SNR G004.5+06.8"], simbad="NAME Kepler SNR", kind="snr",
         distance_pc=5000, err_minus_pc=700, err_plus_pc=800, quality="literature_distance",
         source="Sankrit et al. 2016 (ApJ 817, 36): proper motion and shock velocity -> 5.1 +0.8/-0.7 kpc",
         bibcode="2016ApJ...817...36S", size_arcmin=4,
         image="Keplers supernova.jpg"),
    dict(key="sn1006", name="SN 1006 Remnant", aliases=["SN 1006", "PKS 1459-41", "SNR G327.6+14.6"], simbad="SNR G327.6+14.6", kind="snr",
         distance_pc=2180, err_minus_pc=80, err_plus_pc=80, quality="literature_distance",
         source="Winkler, Gupta & Long 2003 (ApJ 585, 324): filament proper motion and shock velocity -> 2.18 +/- 0.08 kpc",
         bibcode="2003ApJ...585..324W", size_arcmin=30,
         image="Supernova Remnant SN 1006.jpg"),
    dict(key="sn1987a", name="SN 1987A Remnant", aliases=["SN 1987A", "Sanduleak -69 202"], simbad="SN 1987A", kind="snr",
         locality="Large Magellanic Cloud",
         distance_pc=51400, err_minus_pc=1200, err_plus_pc=1200, quality="literature_distance",
         source="Panagia 1999 (IAU Symp. 190): light-echo geometry of the equatorial ring -> 51.4 +/- 1.2 kpc; LMC 49.59 kpc (Pietrzynski et al. 2019)",
         bibcode="1999IAUS..190..549P", size_arcmin=0.03,
         image="SN 1987a in the Large Magellanic Cloud (opo9904e).jpg"),
    dict(key="redrectangle", name="Red Rectangle", aliases=["HD 44179"], simbad="HD 44179", kind="protoplanetary",
         distance_pc=710, err_minus_pc=100, err_plus_pc=100, quality="uncertain_literature_distance",
         source="Men'shchikov et al. 2002 (A&A 393, 867): spectrophotometric model distance 710 +/- 100 pc; no usable parallax",
         bibcode="2002A&A...393..867M", size_arcmin=0.8,
         image="Redrectangle hst full.jpg"),
    dict(key="calabash", name="Calabash Nebula", aliases=["OH 231.8+4.2", "Rotten Egg Nebula"], simbad="OH 231.8+04.2", kind="protoplanetary",
         distance_pc=1540, err_minus_pc=50, err_plus_pc=50, quality="literature_distance",
         source="Choi et al. 2012 (PASJ 64, 1): VLBI H2O-maser parallax 0.65 +/- 0.02 mas -> 1.54 +/- 0.05 kpc",
         bibcode="2012PASJ...64....1C", size_arcmin=1.0,
         image="The 'Rotten Egg' Nebula - a Planetary Nebula in the Making (heic9903a).jpg"),
    dict(key="ic418", name="Spirograph Nebula", aliases=["IC 418"], simbad="IC 418", kind="planetary",
         distance_pc=1365, err_minus_pc=52, err_plus_pc=56, quality="literature_distance",
         source="Chornay & Walton 2021 (A&A 656, A110): Gaia EDR3 parallax of the central star 0.734 +/- 0.029 mas -> 1.37 +0.06/-0.05 kpc",
         bibcode="2021A&A...656A.110C", size_arcmin=0.25,
         image="Hubble’s Spirograph (34503878404).jpg"),
    dict(key="ngc6369", name="Little Ghost Nebula", aliases=["NGC 6369"], simbad="NGC 6369", kind="planetary",
         distance_pc=1086, err_minus_pc=54, err_plus_pc=60, quality="literature_distance",
         source="Chornay & Walton 2021 (A&A 656, A110): Gaia EDR3 parallax of the central star 0.918 +/- 0.049 mas -> 1.09 +0.06/-0.05 kpc",
         bibcode="2021A&A...656A.110C", size_arcmin=0.6,
         image="NGC 6369HST.jpg"),
    dict(key="ngc7009", name="Saturn Nebula", aliases=["NGC 7009", "Caldwell 55"], simbad="NGC 7009", kind="planetary",
         distance_pc=1242, err_minus_pc=80, err_plus_pc=92, quality="literature_distance",
         source="Chornay & Walton 2021 (A&A 656, A110): Gaia EDR3 parallax of the central star 0.812 +/- 0.057 mas -> 1.24 +0.09/-0.08 kpc",
         bibcode="2021A&A...656A.110C", size_arcmin=0.7,
         image="The Saturn Nebula, NGC 7009 (noao-02211).jpg"),
    dict(key="ic1396", name="Elephant's Trunk Nebula", aliases=["IC 1396", "IC 1396A", "Sh2-131", "Trumpler 37"], simbad="IC 1396", kind="hii",
         distance_pc=920, err_minus_pc=20, err_plus_pc=20, quality="literature_distance",
         source="Zucker et al. 2020 (A&A 633, A51): Gaia DR2 + dust distance 918 +22/-21 pc; Cantat-Gaudin & Anders 2020 Trumpler 37 parallax 1.066 mas (~940 pc)",
         bibcode="2020A&A...633A..51Z", size_arcmin=170,
         image="IC1396, The Elephant Trunk Nebula (noao-ic1396).jpg"),
    dict(key="ngc7380", name="Wizard Nebula", aliases=["NGC 7380", "Sh2-142"], simbad="NGC 7380", kind="hii",
         distance_pc=2900, err_minus_pc=150, err_plus_pc=150, quality="uncertain_literature_distance",
         source="Gaia EDR3 (Gaia Collaboration 2021) parallax of the ionizing binary DH Cephei, 0.340 +/- 0.014 mas -> ~2.9 kpc; cluster catalogues scatter between 2.4 and 3.7 kpc",
         bibcode="2020yCat.1350....0G", size_arcmin=25,
         image="Wizard Nebula, NGC 7380 (noao-ngc7380).jpg"),
    dict(key="sh2-101", name="Tulip Nebula", aliases=["Sh2-101", "LBN 71.58+2.86"], simbad="Sh 2-101", kind="hii",
         distance_pc=2200, err_minus_pc=100, err_plus_pc=100, quality="literature_distance",
         source="Gaia EDR3 parallax of the ionizing star HD 227018 (0.452 +/- 0.015 mas) -> 2.2 kpc; consistent with the VLBI distance of neighbouring Cygnus X-1, 2.22 kpc (Miller-Jones et al. 2021)",
         bibcode="2021Sci...371.1046M", size_arcmin=16,
         image="Tulip Nebula (52696167214).jpg"),
    dict(key="pleiades", name="Pleiades Reflection Nebulosity", aliases=["Merope Nebula", "NGC 1435", "Tempel's Nebula", "M 45"], simbad="NGC 1435", kind="reflection",
         distance_pc=136, err_minus_pc=1, err_plus_pc=1, quality="host_system_distance",
         source="Pleiades cluster distance from Gaia DR2/EDR3 parallaxes, 136 +/- 1 pc (Gaia Collaboration 2017, A&A 598, A48; Dias et al. 2021); the dust the cluster is passing through is placed at the cluster distance",
         bibcode="2017A&A...598A..48G", size_arcmin=110,
         image="Pleiades large.jpg"),
    dict(key="ngc6334", name="Cat's Paw Nebula", aliases=["NGC 6334", "Bear Claw Nebula", "Gum 64"], simbad="NGC 6334", kind="hii",
         distance_pc=1300, err_minus_pc=170, err_plus_pc=150, quality="uncertain_literature_distance",
         source="Chibueze et al. 2014 (ApJ 784, 114): VLBI H2O-maser parallax of NGC 6334 I -> 1.34 +0.15/-0.11 kpc; Zucker et al. 2020 dust distance 1.13 kpc",
         bibcode="2014ApJ...784..114C", size_arcmin=35,
         image="Cats-paw-eso.jpg"),
    dict(key="ngc6357", name="Lobster Nebula", aliases=["NGC 6357", "War and Peace Nebula", "Sh2-11", "Pismis 24"], simbad="NGC 6357", kind="hii",
         distance_pc=1760, err_minus_pc=60, err_plus_pc=60, quality="literature_distance",
         source="Cantat-Gaudin et al. 2020 (A&A 640, A1): Gaia DR2 parallax of the embedded cluster Pismis 24 0.567 +/- 0.009 mas -> ~1.76 kpc",
         bibcode="2020A&A...640A...1C", size_arcmin=60,
         image="NGC 6357.jpg"),
    dict(key="ngc7023", name="Iris Nebula", aliases=["NGC 7023", "Caldwell 4", "LBN 487"], simbad="NGC 7023", kind="reflection",
         distance_pc=344, err_minus_pc=10, err_plus_pc=10, quality="literature_distance",
         source="Hunt & Reffert 2023 (A&A 673, A114): Gaia DR3 parallax of the embedded cluster 2.905 +/- 0.077 mas -> 344 pc (via SIMBAD)",
         bibcode="2023A&A...673A.114H", size_arcmin=18,
         image="Iris Nebula NGC 7023 (noao-ngc7023).jpg"),
]

CSV_COLUMNS = [
    "key", "display_name", "aliases", "simbad_main_id", "nebula_kind", "kind_label", "ra_deg", "dec_deg",
    "distance_pc", "distance_err_minus_pc", "distance_err_plus_pc", "distance_ly", "x_ly", "y_ly", "z_ly",
    "angular_size_arcmin", "angular_size_source", "size_ly", "locality", "distance_quality_flag",
    "distance_source", "distance_bibcode", "image_file", "image_page_url", "image_license", "image_license_url",
    "image_author", "image_credit", "image_width_px", "image_height_px", "image_bytes",
]


DOWNLOAD_PAUSE_S = 1.5  # be polite to upload.wikimedia.org (HTTP 429 otherwise)


def http_bytes(url: str, data: dict[str, str] | None = None, attempts: int = 5) -> bytes:
    encoded = urlencode(data).encode("utf-8") if data else None
    for attempt in range(attempts):
        try:
            request = Request(url, data=encoded, headers={"User-Agent": USER_AGENT, "Accept": "application/json,image/*;q=0.9,*/*;q=0.1"})
            with urlopen(request, timeout=120) as response:
                return response.read()
        except (HTTPError, URLError, TimeoutError) as error:
            if attempt == attempts - 1:
                raise RuntimeError(f"Request failed for {url}: {error}") from error
            wait = 2 ** attempt
            if isinstance(error, HTTPError) and error.code == 429:
                retry_after = error.headers.get("Retry-After") if error.headers else None
                wait = max(wait, float(retry_after) if retry_after and retry_after.isdigit() else 15.0 * (attempt + 1))
                print(f"Rate limited by {url.split('/')[2]}; waiting {wait:.0f}s", flush=True)
            time.sleep(wait)
    raise AssertionError("unreachable")


def http_json(url: str, data: dict[str, str] | None = None) -> Any:
    return json.loads(http_bytes(url, data).decode("utf-8"))


def adql_string(value: str) -> str:
    return "'" + value.replace("'", "''") + "'"


def strip_html(value: str) -> str:
    return html.unescape(re.sub(r"<[^>]+>", "", value or "")).strip()


def query_simbad(entries: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    """Resolve each entry's SIMBAD identifier to main_id, position and angular size."""
    identifiers = sorted({entry["simbad"] for entry in entries if entry.get("simbad")})
    query = f"""
        SELECT i.id, b.main_id, b.ra, b.dec, b.galdim_majaxis, b.galdim_minaxis, b.otype
        FROM ident AS i JOIN basic AS b ON i.oidref=b.oid
        WHERE i.id IN ({','.join(adql_string(i) for i in identifiers)})
    """
    payload = {"REQUEST": "doQuery", "LANG": "ADQL", "FORMAT": "json", "QUERY": query}
    response = http_json(SIMBAD_TAP_URL, payload)
    # SIMBAD matches identifiers whitespace-insensitively but returns them
    # padded ("M   1", "NGC  1976"); map results back through a normalised key.
    normalise = lambda value: re.sub(r"\s+", " ", str(value).strip()).casefold()
    resolved = {}
    for identifier, main_id, ra, dec, major, minor, otype in response.get("data", []):
        resolved[normalise(identifier)] = {"main_id": str(main_id), "ra": ra, "dec": dec, "galdim_majaxis": major,
                                          "galdim_minaxis": minor, "otype": str(otype or "")}
    result = {identifier: resolved[normalise(identifier)] for identifier in identifiers if normalise(identifier) in resolved}
    missing = [i for i in identifiers if i not in result]
    if missing:
        raise RuntimeError(f"SIMBAD did not resolve: {missing}")
    return result


def query_commons(files: list[str], width: int) -> dict[str, dict[str, Any]]:
    result = {}
    for start in range(0, len(files), 40):
        batch = files[start:start + 40]
        params = {
            "action": "query", "format": "json", "formatversion": "2", "prop": "imageinfo",
            "iiprop": "extmetadata|size|mime|url", "iiurlwidth": str(width),
            "iiextmetadatafilter": "LicenseShortName|LicenseUrl|Artist|Credit|UsageTerms|AttributionRequired",
            "titles": "|".join(f"File:{name}" for name in batch),
        }
        response = http_json(f"{COMMONS_API_URL}?{urlencode(params)}")
        normalized = {page.get("title", ""): page for page in response["query"]["pages"]}
        for name in batch:
            page = normalized.get(f"File:{name}") or normalized.get(f"File:{name.replace('_', ' ')}")
            if not page or "imageinfo" not in page:
                raise RuntimeError(f"Commons file not found: {name}")
            info = page["imageinfo"][0]
            meta = info.get("extmetadata", {})
            result[name] = {
                "file": name, "page_url": info.get("descriptionurl", f"https://commons.wikimedia.org/wiki/File:{quote(name)}"),
                "thumb_url": info.get("thumburl"), "thumb_width": info.get("thumbwidth"), "thumb_height": info.get("thumbheight"),
                "original_url": info.get("url"), "mime": info.get("mime"),
                "license": strip_html(meta.get("LicenseShortName", {}).get("value", "")),
                "license_url": strip_html(meta.get("LicenseUrl", {}).get("value", "")),
                "author": strip_html(meta.get("Artist", {}).get("value", "")),
                "credit": strip_html(meta.get("Credit", {}).get("value", "")),
                "usage_terms": strip_html(meta.get("UsageTerms", {}).get("value", "")),
            }
    return result


def check_license(entry: dict[str, Any], image: dict[str, Any]) -> None:
    if image.get("mime") != "image/jpeg":
        raise RuntimeError(f"{entry['name']}: {image['file']} is {image.get('mime')}, only JPEG is embedded")
    if not ALLOWED_LICENSE.match(image.get("license") or ""):
        raise RuntimeError(f"{entry['name']}: licence '{image.get('license')}' of {image['file']} is not PD/CC0/CC BY")


def image_dimensions(data: bytes) -> tuple[int, int]:
    """Read JPEG SOF dimensions without third-party libraries."""
    index = 2
    while index < len(data):
        if data[index] != 0xFF:
            index += 1
            continue
        marker = data[index + 1]
        if marker in (0xD8, 0x01) or 0xD0 <= marker <= 0xD7:
            index += 2
            continue
        length = int.from_bytes(data[index + 2:index + 4], "big")
        if 0xC0 <= marker <= 0xCF and marker not in (0xC4, 0xC8, 0xCC):
            height = int.from_bytes(data[index + 5:index + 7], "big")
            width = int.from_bytes(data[index + 7:index + 9], "big")
            return width, height
        index += 2 + length
    raise RuntimeError("Could not read JPEG dimensions")


def compact(text: str, limit: int = 140) -> str:
    text = re.sub(r"\s+", " ", text or "").strip()
    if len(text) <= limit:
        return text
    cut = text[:limit].rsplit(" ", 1)[0]
    return cut.rstrip(",;:.") + " …"


def cartesian(ra_deg: float, dec_deg: float, distance_ly: float) -> tuple[float, float, float]:
    ra, dec = math.radians(ra_deg), math.radians(dec_deg)
    return (distance_ly * math.cos(dec) * math.cos(ra), distance_ly * math.cos(dec) * math.sin(ra), distance_ly * math.sin(dec))


def build(output_dir: Path, image_dir: Path, credits_path: Path, width: int, offline: bool, refresh: bool = False) -> None:
    if width not in STANDARD_THUMB_WIDTHS:
        raise SystemExit(f"--width must be one of the Wikimedia standard widths {STANDARD_THUMB_WIDTHS}")
    image_dir.mkdir(parents=True, exist_ok=True)
    cache_path = image_dir / "sources.json"
    keys = [entry["key"] for entry in NEBULAE]
    if len(set(keys)) != len(keys):
        raise SystemExit("Duplicate nebula keys")

    if offline:
        cache = json.loads(cache_path.read_text(encoding="utf-8"))
        simbad, commons = cache["simbad"], cache["commons"]
    else:
        simbad = query_simbad(NEBULAE)
        commons = query_commons([entry["image"] for entry in NEBULAE], width)
        cache_path.write_text(json.dumps({"retrievedUtc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                                          "thumbWidth": width, "simbad": simbad, "commons": commons},
                                         indent=1, ensure_ascii=False) + "\n", encoding="utf-8")

    rows, browser_rows, credits = [], [], []
    total_bytes = 0
    for entry in NEBULAE:
        resolved = simbad.get(entry["simbad"]) if entry.get("simbad") else None
        ra = resolved["ra"] if resolved and resolved.get("ra") is not None else entry.get("ra")
        dec = resolved["dec"] if resolved and resolved.get("dec") is not None else entry.get("dec")
        if ra is None or dec is None:
            raise RuntimeError(f"{entry['name']}: no coordinates")
        main_id = resolved["main_id"] if resolved else ""
        size_source = "curated"
        size_arcmin = float(entry["size_arcmin"])
        if resolved and resolved.get("galdim_majaxis") and entry.get("prefer_simbad_size"):
            size_arcmin, size_source = float(resolved["galdim_majaxis"]), "SIMBAD galdim_majaxis"
        distance_pc = float(entry["distance_pc"])
        distance_ly = distance_pc * LY_PER_PC
        x, y, z = cartesian(ra, dec, distance_ly)
        size_ly = 2 * distance_ly * math.tan(math.radians(size_arcmin / 60) / 2)
        locality = entry.get("locality", "Milky Way")

        image = commons[entry["image"]]
        check_license(entry, image)
        image_path = image_dir / f"{entry['key']}.jpg"
        cached = image_path.exists() and image_path.stat().st_size > 0
        if offline and not cached:
            raise RuntimeError(f"{entry['name']}: {image_path} missing for --offline build")
        if cached and (offline or not refresh):
            data = image_path.read_bytes()
        else:
            time.sleep(DOWNLOAD_PAUSE_S)
            data = http_bytes(image["thumb_url"])
            image_path.write_bytes(data)
            print(f"downloaded {image['file']} ({len(data)} bytes)", flush=True)
        if data[:2] != b"\xff\xd8":
            raise RuntimeError(f"{entry['name']}: downloaded thumbnail is not a JPEG")
        px_width, px_height = image_dimensions(data)
        total_bytes += len(data)

        kind_label = KIND_LABELS[entry["kind"]]
        row = {
            "key": entry["key"], "display_name": entry["name"], "aliases": " | ".join(entry.get("aliases", [])),
            "simbad_main_id": main_id, "nebula_kind": entry["kind"], "kind_label": kind_label,
            "ra_deg": round(ra, 6), "dec_deg": round(dec, 6), "distance_pc": distance_pc,
            "distance_err_minus_pc": entry["err_minus_pc"], "distance_err_plus_pc": entry["err_plus_pc"],
            "distance_ly": round(distance_ly, 4), "x_ly": round(x, 4), "y_ly": round(y, 4), "z_ly": round(z, 4),
            "angular_size_arcmin": size_arcmin, "angular_size_source": size_source, "size_ly": round(size_ly, 4),
            "locality": locality, "distance_quality_flag": entry["quality"], "distance_source": entry["source"],
            "distance_bibcode": entry["bibcode"], "image_file": image["file"], "image_page_url": image["page_url"],
            "image_license": image["license"], "image_license_url": image["license_url"], "image_author": image["author"],
            "image_credit": image["credit"], "image_width_px": px_width, "image_height_px": px_height, "image_bytes": len(data),
        }
        rows.append(row)
        browser_rows.append({
            "key": entry["key"], "name": entry["name"], "aliases": entry.get("aliases", []), "simbadId": main_id,
            "kind": entry["kind"], "kindLabel": kind_label, "ra": row["ra_deg"], "dec": row["dec_deg"],
            "distanceLy": row["distance_ly"], "distancePc": distance_pc,
            "distanceErrMinusLy": round(entry["err_minus_pc"] * LY_PER_PC, 2), "distanceErrPlusLy": round(entry["err_plus_pc"] * LY_PER_PC, 2),
            "x": row["x_ly"], "y": row["y_ly"], "z": row["z_ly"], "sizeLy": row["size_ly"], "sizeArcmin": size_arcmin,
            "locality": locality, "distanceQuality": entry["quality"], "distanceSource": entry["source"], "distanceBibcode": entry["bibcode"],
            "image": {
                "dataUri": "data:image/jpeg;base64," + base64.b64encode(data).decode("ascii"),
                "width": px_width, "height": px_height, "file": image["file"], "pageUrl": image["page_url"],
                "license": image["license"], "licenseUrl": image["license_url"],
                # Some Commons author fields are whole paragraphs; the panel shows a
                # compact line and links to the file page for the full statement.
                "author": compact(image["author"]), "credit": compact(image["credit"]),
            },
        })
        credits.append(f"- **{entry['name']}** — [{image['file']}]({image['page_url']}) · {image['license']}"
                       + (f" ([licence]({image['license_url']}))" if image["license_url"] else "")
                       + f" · Author/credit: {image['author'] or image['credit'] or 'see file page'}"
                       + f" · resized to {px_width}×{px_height} px, unmodified otherwise")

    metadata = {
        "schemaVersion": 1, "generatedUtc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "count": len(rows), "thumbWidth": width, "totalImageBytes": total_bytes,
        "coordinateFrame": "Sun-centered ICRS equatorial Cartesian; X=RA0/Dec0, Y=RA90/Dec0, Z=Dec+90.",
        "positionSource": "SIMBAD basic table (main_id, ra, dec) for the curated identifier; curated coordinates only where SIMBAD has no entry",
        "distanceRule": "Curated literature distance per object with citation and quality flag; see distance_source/distance_bibcode.",
        "sizeRule": "Sprite extent = 2 * distance * tan(angular_size / 2) with the curated apparent size in arcmin.",
        "imageRule": "Wikimedia Commons file pinned per object; licence read from extmetadata at build time and restricted to public domain, CC0 and CC BY.",
        "allowedLicenses": ALLOWED_LICENSE.pattern, "sources": {"simbadTap": SIMBAD_TAP_URL, "commonsApi": COMMONS_API_URL},
    }
    output_dir.mkdir(parents=True, exist_ok=True)
    with (output_dir / "nebulae.csv").open("w", encoding="utf-8-sig", newline="") as stream:
        writer = csv.DictWriter(stream, fieldnames=CSV_COLUMNS)
        writer.writeheader()
        writer.writerows(rows)
    payload = "// Generated by scripts/build_nebulae.py; do not edit manually.\n"
    payload += "window.NEBULA_CATALOG_META = " + json.dumps(metadata, ensure_ascii=False, separators=(",", ":")) + ";\n"
    payload += "window.NEBULA_CATALOG = " + json.dumps(browser_rows, ensure_ascii=False, separators=(",", ":")) + ";\n"
    (output_dir / "nebulae.js").write_text(payload, encoding="utf-8")

    credits_text = "# Image credits\n\n"
    credits_text += ("Nebula sprites in `data/nebulae.js` and `data/nebulae/` are Wikimedia Commons thumbnails "
                     f"({width} px standard width) downloaded by `scripts/build_nebulae.py` on {metadata['generatedUtc'][:10]}. "
                     "Only public-domain, CC0 and CC BY files are accepted; the licence of each file was read from its Commons "
                     "metadata at build time. CC BY images require the credit line below to stay with the image; NASA/ESA/STScI "
                     "public-domain images carry the requested courtesy credit. Images were downsized only.\n\n")
    credits_text += "\n".join(credits) + "\n"
    # build_galaxy.py owns a marked section at the end of the file; keep it.
    existing = credits_path.read_text(encoding="utf-8") if credits_path.exists() else ""
    galaxy_section = re.search(r"<!-- galaxy-credits:start -->.*?<!-- galaxy-credits:end -->\n?", existing, re.S)
    if galaxy_section:
        credits_text += "\n" + galaxy_section.group(0)
    credits_path.write_text(credits_text, encoding="utf-8")
    print(json.dumps(metadata, indent=2))


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    root = Path(__file__).resolve().parents[1]
    parser.add_argument("--output", type=Path, default=root / "data")
    parser.add_argument("--images", type=Path, default=root / "data" / "nebulae")
    parser.add_argument("--credits", type=Path, default=root / "CREDITS.md")
    parser.add_argument("--width", type=int, default=500, help="Wikimedia standard thumbnail width to embed")
    parser.add_argument("--offline", action="store_true", help="Reuse data/nebulae/sources.json and downloaded images")
    parser.add_argument("--refresh", action="store_true", help="Re-download images that already exist in --images")
    args = parser.parse_args()
    build(args.output, args.images, args.credits, args.width, args.offline, args.refresh)


if __name__ == "__main__":
    main()
