// Concise local summaries, paraphrased from the linked English Wikipedia pages.
// Retrieved 2026-07-11. Kept local so the information popup works offline.
window.STAR_TYPE_DESCRIPTIONS = {
  red_dwarf: {
    title: "Red dwarf",
    summary: "A cool, low-mass main-sequence star that steadily fuses hydrogen. Red dwarfs are faint individually but are the most common fusion-powered stars in the Milky Way.",
    facts: ["Usually an M-type dwarf; definitions sometimes include late K stars.", "Their efficient convection gives them lifetimes far longer than the current age of the Universe."],
    sourceTitle: "Wikipedia · Red dwarf",
    sourceUrl: "https://en.wikipedia.org/wiki/Red_dwarf"
  },
  yellow_dwarf: {
    title: "G-type main-sequence star",
    summary: "A Sun-like star of spectral class G and luminosity class V, powered by hydrogen fusion in its core. Typical masses are about 0.9–1.1 Suns.",
    facts: ["Typical surface temperatures are roughly 5,380–5,930 K.", "“Yellow dwarf” is a visual shorthand: the Sun is intrinsically close to white."],
    sourceTitle: "Wikipedia · G-type main-sequence star",
    sourceUrl: "https://en.wikipedia.org/wiki/G-type_main-sequence_star"
  },
  other_main_sequence: {
    title: "Main-sequence star",
    summary: "A stable star fusing hydrogen into helium in its core. In an MK spectral code, luminosity class V identifies the main sequence.",
    facts: ["The sequence O–B–A–F–G–K–M runs broadly from hottest to coolest.", "A star spends most of its active lifetime on the main sequence."],
    sourceTitle: "Wikipedia · Main sequence",
    sourceUrl: "https://en.wikipedia.org/wiki/Main_sequence"
  },
  white_dwarf: {
    title: "White dwarf",
    summary: "A compact stellar remnant with roughly stellar mass compressed into an Earth-sized volume. It has no sustained fusion and fades as stored heat escapes.",
    facts: ["Electron degeneracy pressure supports it against further collapse.", "A non-rotating white dwarf cannot remain stable above roughly 1.44 solar masses."],
    sourceTitle: "Wikipedia · White dwarf",
    sourceUrl: "https://en.wikipedia.org/wiki/White_dwarf"
  },
  neutron_star: {
    title: "Neutron star / pulsar",
    summary: "The collapsed core left by some massive-star supernovae. About a solar mass can be compressed into a sphere only around 10 km in radius.",
    facts: ["A pulsar is a rapidly rotating, magnetized neutron star whose beams sweep past Earth like a lighthouse.", "Pulse periods can be extraordinarily regular, from milliseconds to seconds."],
    sourceTitle: "Wikipedia · Neutron star",
    sourceUrl: "https://en.wikipedia.org/wiki/Neutron_star",
    secondaryTitle: "Wikipedia · Pulsar",
    secondaryUrl: "https://en.wikipedia.org/wiki/Pulsar"
  },
  black_hole: {
    title: "Black hole",
    summary: "A compact object whose gravity creates an event horizon: beyond that boundary, no signal can return to the outside Universe.",
    facts: ["Stellar-mass black holes can form when massive stellar cores collapse.", "They are detected indirectly through their influence on nearby matter, light, and spacetime."],
    sourceTitle: "Wikipedia · Black hole",
    sourceUrl: "https://en.wikipedia.org/wiki/Black_hole"
  },
  giant_or_supergiant: {
    title: "Giant or supergiant",
    summary: "An expanded, luminous star above the main sequence. Giants are commonly luminosity classes II–III; supergiants occupy class I.",
    facts: ["Many giants form after core hydrogen is depleted and fusion moves into a surrounding shell.", "Supergiants span blue through red temperatures and include some of the most luminous stars known."],
    sourceTitle: "Wikipedia · Giant star",
    sourceUrl: "https://en.wikipedia.org/wiki/Giant_star",
    secondaryTitle: "Wikipedia · Supergiant",
    secondaryUrl: "https://en.wikipedia.org/wiki/Supergiant"
  },
  brown_dwarf: {
    title: "Brown dwarf",
    summary: "A substellar object between giant planets and the lightest stars. It is not massive enough to sustain ordinary hydrogen fusion.",
    facts: ["Typical masses are about 13–80 Jupiters, while radii remain near Jupiter's.", "Cool brown dwarfs occupy the L, T, and Y spectral classes and radiate mainly in infrared."],
    sourceTitle: "Wikipedia · Brown dwarf",
    sourceUrl: "https://en.wikipedia.org/wiki/Brown_dwarf"
  },
  other: {
    title: "Stellar spectral classification",
    summary: "A spectral type summarizes a star's observed spectrum and temperature. A following Roman numeral describes luminosity and surface gravity.",
    facts: ["Letter classes O–B–A–F–G–K–M are subdivided from 0 to 9.", "D denotes white-dwarf spectra; L, T, and Y are commonly used for brown dwarfs."],
    sourceTitle: "Wikipedia · Stellar classification",
    sourceUrl: "https://en.wikipedia.org/wiki/Stellar_classification"
  },
  // Nebula families for the imaged objects in data/nebulae.js (paraphrased from
  // the linked English Wikipedia articles, retrieved 2026-08-26).
  nebula_hii: {
    group: "nebula",
    title: "Emission nebula (H II region)",
    summary: "A cloud of interstellar gas ionised by the ultraviolet light of hot, young stars. The recombining hydrogen glows, most strongly in the red H-alpha line, marking regions of recent and ongoing star formation.",
    facts: ["H II regions span from a few to several hundred light-years and trace the spiral arms.", "Their distances usually come from the parallaxes of the embedded young stars or clusters."],
    sourceTitle: "Wikipedia · H II region",
    sourceUrl: "https://en.wikipedia.org/wiki/H_II_region",
    secondaryTitle: "Wikipedia · Emission nebula",
    secondaryUrl: "https://en.wikipedia.org/wiki/Emission_nebula"
  },
  nebula_planetary: {
    group: "nebula",
    title: "Planetary nebula",
    summary: "An expanding shell of gas ejected by a dying low- or intermediate-mass star and lit by its hot exposed core, which is becoming a white dwarf. The name is historical; planetary nebulae have nothing to do with planets.",
    facts: ["Typical sizes are about a light-year; the phase lasts only some tens of thousands of years.", "Gaia parallaxes of the central stars now give many of them reliable distances."],
    sourceTitle: "Wikipedia · Planetary nebula",
    sourceUrl: "https://en.wikipedia.org/wiki/Planetary_nebula"
  },
  nebula_snr: {
    group: "nebula",
    title: "Supernova remnant",
    summary: "The expanding debris of an exploded star sweeping up the surrounding interstellar medium. Remnants shine in radio, optical and X-ray light for tens of thousands of years, and some contain a pulsar or other compact object.",
    facts: ["Distances are often derived from expansion proper motions, pulsar parallaxes or absorbing foreground stars.", "The historical supernovae of 1006, 1054, 1572 and 1604 all left remnants that are still observed."],
    sourceTitle: "Wikipedia · Supernova remnant",
    sourceUrl: "https://en.wikipedia.org/wiki/Supernova_remnant"
  },
  nebula_reflection: {
    group: "nebula",
    title: "Reflection nebula",
    summary: "A cloud of interstellar dust that shines by scattering the light of nearby stars rather than by its own emission. Scattering favours blue light, so reflection nebulae usually appear blue.",
    facts: ["The illuminating stars are not hot enough to ionise the gas, otherwise an emission nebula would form.", "Many reflection nebulae belong to larger star-forming complexes."],
    sourceTitle: "Wikipedia · Reflection nebula",
    sourceUrl: "https://en.wikipedia.org/wiki/Reflection_nebula"
  },
  nebula_dark: {
    group: "nebula",
    title: "Dark nebula / molecular cloud",
    summary: "A dense cloud of gas and dust that blocks the light of the stars behind it. Dark nebulae are the cold, dense parts of molecular clouds in which new stars form.",
    facts: ["Their distances are measured with the parallaxes of embedded young stars or from three-dimensional dust maps.", "Examples such as the Coalsack and the Pipe are visible to the naked eye as gaps in the Milky Way."],
    sourceTitle: "Wikipedia · Dark nebula",
    sourceUrl: "https://en.wikipedia.org/wiki/Dark_nebula",
    secondaryTitle: "Wikipedia · Molecular cloud",
    secondaryUrl: "https://en.wikipedia.org/wiki/Molecular_cloud"
  },
  nebula_protoplanetary: {
    group: "nebula",
    title: "Protoplanetary nebula",
    summary: "A short-lived object between the asymptotic-giant-branch phase and a planetary nebula: the ejected envelope is still lit by reflected starlight because the central star is not yet hot enough to ionise it.",
    facts: ["The phase lasts only a few thousand years, so few examples are known.", "Bipolar shapes are common and point to outflows shaped by companions or discs."],
    sourceTitle: "Wikipedia · Protoplanetary nebula",
    sourceUrl: "https://en.wikipedia.org/wiki/Protoplanetary_nebula"
  },
  nebula_lbv: {
    group: "nebula",
    title: "Ejecta nebula of a luminous blue variable",
    summary: "Material thrown off in the giant eruptions of a very massive, unstable star. The Homunculus around Eta Carinae, ejected in the 1840s, is the best-studied example.",
    facts: ["Such nebulae expand at hundreds of kilometres per second and can be dated from their expansion.", "Luminous blue variables are candidates for the next Galactic supernovae."],
    sourceTitle: "Wikipedia · Luminous blue variable",
    sourceUrl: "https://en.wikipedia.org/wiki/Luminous_blue_variable",
    secondaryTitle: "Wikipedia · Homunculus Nebula",
    secondaryUrl: "https://en.wikipedia.org/wiki/Homunculus_Nebula"
  }
};
