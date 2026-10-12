/**
 * The colour tokens from styles.css, for SVG drawings and canvas that set
 * colours as attributes. Same names, same meanings: action is amber, data
 * cyan, good green, bad red, caution yellow, crew violet.
 */
export const COLORS = {
  ground: "#0e1216",
  panel: "#151b21",
  raised: "#1c242c",
  line: "#2a343f",
  lineStrong: "#3a4652",
  text: "#e8ecef",
  textSoft: "#c3ccd5",
  muted: "#93a0ad",
  faint: "#5b6773",
  action: "#f0a43a",
  data: "#5bb8e3",
  dataDeep: "#2e6e8e",
  good: "#63c58a",
  bad: "#ef6a5e",
  caution: "#e3c25e",
  crew: "#a993e8",
} as const;

/** Colours that only tell categories apart in a chart (spend by kind, Δv losses). They carry no meaning of their own. */
export const CATEGORY = ["#5bb8e3", "#d9c35b", "#e0913c", "#b5732a", "#8a6bd1", "#2e6e8e", "#63c58a", "#9aa86b", "#5b6773", "#ef6a5e"] as const;
