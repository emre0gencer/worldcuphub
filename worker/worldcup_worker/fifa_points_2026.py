"""FIFA Elo ranking points for all ranked nations — snapshot as of 2026-06-15.

Source: https://inside.fifa.com/fifa-world-ranking/men (official update 2026-06-11).
Pulled manually; the FIFA ranking page is dynamically rendered and cannot be
fetched programmatically.

These points are used as the pre-tournament Elo seed for 2026 World Cup teams
(initial_elo / fifa_points columns on team_seasons). They also serve as the
reference Elo for ALL ranked nations so that the seed_elo script can look up
any 2026 DB team by name or country_code even if the team isn't a WC qualifier.

Format: (fifa_rank, canonical_name, iso3_code, elo_points)
iso3_code is the FIFA ISO-3 code; API-Football's team.code may differ (handled
in seed_elo.py by falling back to name matching).
"""

# (rank, canonical_name, iso3_code, elo_points)
FIFA_RANKING_2026: list[tuple[int, str, str, float]] = [
    (1,  "Argentina",              "ARG", 1877.27),
    (2,  "France",                 "FRA", 1870.70),
    (3,  "Spain",                  "ESP", 1856.03),
    (4,  "England",                "ENG", 1828.02),
    (5,  "Portugal",               "POR", 1767.85),
    (6,  "Brazil",                 "BRA", 1765.34),
    (7,  "Morocco",                "MAR", 1755.62),
    (8,  "Netherlands",            "NED", 1749.20),
    (9,  "Germany",                "GER", 1743.54),
    (10, "Belgium",                "BEL", 1733.93),
    (11, "Croatia",                "CRO", 1714.87),
    (12, "Italy",                  "ITA", 1704.73),
    (13, "Mexico",                 "MEX", 1700.98),
    (14, "Colombia",               "COL", 1698.35),
    (15, "USA",                    "USA", 1688.53),
    (16, "Senegal",                "SEN", 1684.07),
    (17, "Uruguay",                "URU", 1673.07),
    (18, "Japan",                  "JPN", 1665.94),
    (19, "Switzerland",            "SUI", 1640.92),
    (20, "IR Iran",                "IRN", 1619.58),
    (21, "Denmark",                "DEN", 1619.47),
    (22, "Korea Republic",         "KOR", 1612.55),
    (23, "Australia",              "AUS", 1605.61),
    (24, "Austria",                "AUT", 1597.40),
    (25, "Nigeria",                "NGA", 1585.02),
    (26, "Türkiye",                "TUR", 1579.47),
    (27, "Algeria",                "ALG", 1571.03),
    (28, "Ecuador",                "ECU", 1570.76),
    (29, "Egypt",                  "EGY", 1570.67),
    (30, "Côte d'Ivoire",          "CIV", 1568.62),
    (31, "Norway",                 "NOR", 1557.44),
    (32, "Canada",                 "CAN", 1551.50),
    (33, "Ukraine",                "UKR", 1549.29),
    (34, "Panama",                 "PAN", 1539.16),
    (35, "Sweden",                 "SWE", 1533.19),
    (36, "Russia",                 "RUS", 1529.60),
    (37, "Poland",                 "POL", 1526.18),
    (38, "Scotland",               "SCO", 1518.77),
    (39, "Wales",                  "WAL", 1516.95),
    (40, "Hungary",                "HUN", 1506.39),
    (41, "Serbia",                 "SRB", 1502.13),
    (42, "Paraguay",               "PAR", 1488.05),
    (43, "Czechia",                "CZE", 1484.82),
    (44, "Cameroon",               "CMR", 1481.24),
    (45, "Congo DR",               "COD", 1474.43),
    (46, "Slovakia",               "SVK", 1473.66),
    (47, "Greece",                 "GRE", 1473.19),
    (48, "Venezuela",              "VEN", 1469.18),
    (49, "Qatar",                  "QAT", 1459.45),
    (50, "Uzbekistan",             "UZB", 1458.73),
    (51, "Chile",                  "CHI", 1458.20),
    (52, "Peru",                   "PER", 1457.69),
    (53, "Costa Rica",             "CRC", 1456.03),
    (54, "Romania",                "ROU", 1455.89),
    (55, "Mali",                   "MLI", 1455.59),
    (56, "Tunisia",                "TUN", 1453.00),
    (57, "Iraq",                   "IRQ", 1446.28),
    (58, "Republic of Ireland",    "IRL", 1441.10),
    (59, "Slovenia",               "SVN", 1441.09),
    (60, "Saudi Arabia",           "KSA", 1423.88),
    (61, "South Africa",           "RSA", 1414.88),
    (62, "Burkina Faso",           "BFA", 1406.99),
    (63, "Bosnia and Herzegovina", "BIH", 1395.19),
    (64, "Cabo Verde",             "CPV", 1389.79),
    (65, "Jordan",                 "JOR", 1387.74),
    (66, "Honduras",               "HON", 1378.97),
    (67, "Albania",                "ALB", 1376.03),
    (68, "United Arab Emirates",   "UAE", 1370.47),
    (69, "North Macedonia",        "MKD", 1369.16),
    (70, "Northern Ireland",       "NIR", 1365.30),
    (71, "Jamaica",                "JAM", 1357.84),
    (72, "Georgia",                "GEO", 1355.26),
    (73, "Ghana",                  "GHA", 1346.88),
    (74, "Iceland",                "ISL", 1342.77),
    (75, "Finland",                "FIN", 1341.92),
    (76, "Israel",                 "ISR", 1333.90),
    (77, "Bolivia",                "BOL", 1326.00),
    (78, "Kosovo",                 "KVX", 1319.12),
    (79, "Oman",                   "OMA", 1306.90),
    (80, "Montenegro",             "MNE", 1301.98),
    (81, "Guinea",                 "GUI", 1295.60),
    (82, "Curaçao",                "CUW", 1287.00),
    (83, "Syria",                  "SYR", 1283.05),
    (84, "Haiti",                  "HAI", 1277.67),
    (85, "New Zealand",            "NZL", 1275.58),
]

# Name aliases: alternate → canonical name in FIFA_RANKING_2026.
# API-Football uses its own name variants; this map bridges them.
NAME_ALIASES: dict[str, str] = {
    # API-Football → FIFA canonical
    "Cape Verde Islands":          "Cabo Verde",
    "Cape Verde":                  "Cabo Verde",
    "Iran":                        "IR Iran",
    "Islamic Republic of Iran":    "IR Iran",
    "South Korea":                 "Korea Republic",
    "Republic of Korea":           "Korea Republic",
    "Turkey":                      "Türkiye",
    "Ivory Coast":                 "Côte d'Ivoire",
    "Cote d'Ivoire":               "Côte d'Ivoire",
    "Cote dIvoire":                "Côte d'Ivoire",
    "DR Congo":                    "Congo DR",
    "Democratic Republic of Congo":"Congo DR",
    "United States":               "USA",
    "Czech Republic":              "Czechia",
    "Bosnia & Herzegovina":        "Bosnia and Herzegovina",
    "Bosnia-Herzegovina":          "Bosnia and Herzegovina",
    "Curacao":                     "Curaçao",
    "Saudi Arabia":                "Saudi Arabia",   # same
    "New Zealand":                 "New Zealand",    # same
}

# Build lookup dicts for the seed script.
# Keys are lowercased for case-insensitive matching.
_by_code: dict[str, tuple[int, str, float]] = {
    code.lower(): (rank, name, pts)
    for rank, name, code, pts in FIFA_RANKING_2026
}
_by_name: dict[str, tuple[int, str, float]] = {
    name.lower(): (rank, name, pts)
    for rank, name, iso3, pts in FIFA_RANKING_2026
}


def lookup(country_code: str | None, team_name: str) -> tuple[int, str, float] | None:
    """Return (rank, canonical_name, elo_points) for a team, or None if not found.

    Tries, in order:
      1. country_code exact match (case-insensitive)
      2. team_name exact match (case-insensitive)
      3. team_name via NAME_ALIASES (case-insensitive)
    """
    if country_code:
        hit = _by_code.get(country_code.lower())
        if hit:
            return hit

    # Direct name match
    hit = _by_name.get(team_name.lower())
    if hit:
        return hit

    # Alias match
    canonical = NAME_ALIASES.get(team_name) or NAME_ALIASES.get(
        # strip accents isn't worth a dependency — try the raw string as-is
        team_name
    )
    if canonical:
        hit = _by_name.get(canonical.lower())
        if hit:
            return hit

    return None
