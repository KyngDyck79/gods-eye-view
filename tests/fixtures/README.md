# Recorded fixtures

Real provider responses, captured once and stored here so tests never call a
live API (GODS-EYE-VIEW-SPEC v2, Part 7). Trimmed to a few records; the
content of each record is unchanged.

| File | Source | Captured |
|---|---|---|
| `awc/metars.cache.sample.csv` | `https://aviationweather.gov/data/cache/metars.cache.csv.gz` (header plus 12 stations, including KMYR, KCRE, KHYW) | 2026-09-30 03:38 UTC |
| `awc/tafs.cache.sample.xml` | `https://aviationweather.gov/data/cache/tafs.cache.xml.gz` (KMYR, KCRE, KCHS, LFBT) | 2026-09-30 03:38 UTC |

AviationWeather.gov data is a U.S. Government work (NOAA/NWS).
