export interface TeamColors {
  /** Primary jersey / identity color — used for home-team visuals. */
  main: string;
  /** Alternate jersey color — used for away-team visuals to guarantee contrast. */
  secondary: string;
}

const DEFAULT: TeamColors = { main: "#525252", secondary: "#9ca3af" };

/**
 * Kit colors keyed by FIFA ISO-3 / API-Football country_code (uppercase).
 * Home = main, Away = secondary — mirrors real kit rules and prevents H2H clashes.
 */
const COLORS: Record<string, TeamColors> = {
  // ── Top-ranked / fan-favourite teams ────────────────────────────────────────
  ARG: { main: "#6CACE4", secondary: "#3D1A78" },   // celeste / dark purple (2022-26 away)
  FRA: { main: "#003189", secondary: "#ED2939" },   // royal blue / red
  ESP: { main: "#C60B1E", secondary: "#0039A6" },   // red / navy away
  ENG: { main: "#003399", secondary: "#CE1126" },   // navy (badge) / red
  POR: { main: "#006A44", secondary: "#CE1126" },   // dark green / red
  BRA: { main: "#FCD116", secondary: "#009C3B" },   // yellow / green
  MAR: { main: "#C1272D", secondary: "#006233" },   // red / green
  NED: { main: "#FF6600", secondary: "#1B3A6B" },   // orange / dark blue
  GER: { main: "#DD0000", secondary: "#1D1D1B" },   // red (away) / black
  BEL: { main: "#C8102E", secondary: "#1A1A1A" },   // red / black
  CRO: { main: "#FF2400", secondary: "#005BAC" },   // red checkerboard / blue
  ITA: { main: "#003298", secondary: "#00B140" },   // azzurri / green away
  MEX: { main: "#006847", secondary: "#C8102E" },   // green / red
  COL: { main: "#FCD116", secondary: "#003087" },   // yellow / dark blue
  USA: { main: "#002868", secondary: "#BF0A30" },   // navy / red
  SEN: { main: "#00853E", secondary: "#FDEF42" },   // green / yellow
  URU: { main: "#4EAFED", secondary: "#000000" },   // sky blue / black (distinct from ARG celeste)
  JPN: { main: "#BC0027", secondary: "#003DA5" },   // red / blue
  SUI: { main: "#FF0000", secondary: "#262626" },   // red / dark
  IRN: { main: "#239F40", secondary: "#CE1126" },   // green / red
  DEN: { main: "#C60C30", secondary: "#008537" },   // red / green (change kit)
  KOR: { main: "#003580", secondary: "#CD2E3A" },   // dark blue / red
  AUS: { main: "#FFD700", secondary: "#006A4E" },   // gold / dark green
  AUT: { main: "#ED2939", secondary: "#3D3D3D" },   // red / dark grey
  NGA: { main: "#008751", secondary: "#1A1A1A" },   // green / dark
  TUR: { main: "#E30A17", secondary: "#0F1F5C" },   // red / dark navy
  ALG: { main: "#006233", secondary: "#D21034" },   // green / red
  ECU: { main: "#FFD100", secondary: "#003DA5" },   // yellow / blue
  EGY: { main: "#CE1126", secondary: "#1A1A1A" },   // red / dark
  CIV: { main: "#F77F00", secondary: "#009A44" },   // orange / green
  NOR: { main: "#EF2B2D", secondary: "#002868" },   // red / dark blue
  CAN: { main: "#FF0000", secondary: "#1C1C1C" },   // red / dark
  UKR: { main: "#0057B7", secondary: "#FFD700" },   // blue / yellow
  PAN: { main: "#CE1126", secondary: "#005EB8" },   // red / blue
  SWE: { main: "#006AA7", secondary: "#FECC00" },   // blue / yellow
  RUS: { main: "#D52B1E", secondary: "#003DA5" },   // red / blue
  POL: { main: "#DC143C", secondary: "#1A3A6B" },   // red / blue (away)
  SCO: { main: "#003F87", secondary: "#CE1126" },   // dark blue / red (saltire)
  WAL: { main: "#C8102E", secondary: "#006A4E" },   // red / dark green
  HUN: { main: "#CE1126", secondary: "#00843D" },   // red / green (tricolor)
  SRB: { main: "#C6363C", secondary: "#0C4076" },   // red / blue
  PAR: { main: "#D52B1E", secondary: "#0038A8" },   // red / blue
  CZE: { main: "#D7141A", secondary: "#003366" },   // red / dark blue
  CMR: { main: "#007A5E", secondary: "#CE1126" },   // green / red
  COD: { main: "#007FFF", secondary: "#FFCC00" },   // blue / yellow
  SVK: { main: "#0B3D91", secondary: "#EE1C25" },   // blue / red
  GRE: { main: "#0D5EAF", secondary: "#4A4A4A" },   // blue / dark grey
  VEN: { main: "#CF142B", secondary: "#002395" },   // red / blue
  QAT: { main: "#8D153A", secondary: "#C9A84C" },   // maroon / gold
  UZB: { main: "#1EB53A", secondary: "#0099B5" },   // green / teal
  CHI: { main: "#D52B1E", secondary: "#003580" },   // red / dark blue
  PER: { main: "#D91023", secondary: "#2C2C2C" },   // red / dark
  CRC: { main: "#002B7F", secondary: "#CE1126" },   // blue / red
  ROU: { main: "#003DA5", secondary: "#FFCC00" },   // blue / yellow
  MLI: { main: "#14B53A", secondary: "#FCD116" },   // green / yellow
  TUN: { main: "#E70013", secondary: "#1E3A8A" },   // red / blue
  IRQ: { main: "#007A3D", secondary: "#CE1126" },   // green / red
  IRL: { main: "#169B62", secondary: "#FF883E" },   // green / orange
  SVN: { main: "#003DA5", secondary: "#1B951F" },   // blue / green (flag)
  KSA: { main: "#006C35", secondary: "#C9A84C" },   // green / gold
  RSA: { main: "#007A4D", secondary: "#FFB81C" },   // green / gold
  BFA: { main: "#EF2B2D", secondary: "#009A44" },   // red / green
  BIH: { main: "#003DA5", secondary: "#FFC600" },   // blue / yellow
  CPV: { main: "#003893", secondary: "#CF2027" },   // blue / red
  JOR: { main: "#CE1126", secondary: "#007A3D" },   // red / green (flag)
  HON: { main: "#0073CF", secondary: "#1A1A1A" },   // blue / dark
  ALB: { main: "#E41E20", secondary: "#C8A951" },   // red / gold (eagle crest)
  UAE: { main: "#009900", secondary: "#CC0001" },   // green / red (flag)
  MKD: { main: "#CE2028", secondary: "#F7E63C" },   // red / yellow (sun)
  NIR: { main: "#003F87", secondary: "#CF101A" },   // blue / red
  JAM: { main: "#FED100", secondary: "#000000" },   // gold / black (Reggae Boyz)
  GEO: { main: "#CC0000", secondary: "#1C3A6B" },   // red / dark blue
  GHA: { main: "#006B3F", secondary: "#FCD116" },   // green / yellow
  ISL: { main: "#003897", secondary: "#ED1C24" },   // dark blue / red
  FIN: { main: "#003580", secondary: "#B0B0B0" },   // dark blue / silver
  ISR: { main: "#003DA5", secondary: "#6B6B6B" },   // blue / grey
  BOL: { main: "#D52B1E", secondary: "#F4E400" },   // red / yellow
  KVX: { main: "#244AA5", secondary: "#E4C23F" },   // blue / gold (Kosovo flag)
  OMA: { main: "#DB161B", secondary: "#009A44" },   // red / green
  MNE: { main: "#D4AF37", secondary: "#CF143B" },   // gold / red (Montenegro)
  GUI: { main: "#CE1126", secondary: "#009A44" },   // red / green
  CUW: { main: "#003DA5", secondary: "#F9C000" },   // blue / yellow
  SYR: { main: "#007A3D", secondary: "#CE1126" },   // green / red
  HAI: { main: "#00209F", secondary: "#D21034" },   // blue / red
  NZL: { main: "#2C2C2C", secondary: "#808080" },   // near-black / grey (All Blacks)
  // ── API-Football country_code variants (DB uses these, not the ISO codes
  //    above) — duplicated so both spellings resolve across seasons ──────────
  CGO: { main: "#C8102E", secondary: "#0085CA" },   // Congo DR (Leopards) red / sky blue — alias of COD
  CUR: { main: "#003DA5", secondary: "#F9C000" },   // Curaçao blue / yellow — alias of CUW
};

export function getTeamColors(countryCode: string | null | undefined): TeamColors {
  if (!countryCode) return DEFAULT;
  return COLORS[countryCode.toUpperCase()] ?? DEFAULT;
}
