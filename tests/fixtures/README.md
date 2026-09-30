# Recorded fixtures

Real provider responses, captured once and stored here so tests never call a
live API (GODS-EYE-VIEW-SPEC v2, Part 7). Trimmed to a few records; the
content of each record is unchanged.

| File | Source | Captured |
|---|---|---|
| `awc/metars.cache.sample.csv` | `https://aviationweather.gov/data/cache/metars.cache.csv.gz` (header plus 12 stations, including KMYR, KCRE, KHYW) | 2026-09-30 03:38 UTC |
| `awc/tafs.cache.sample.xml` | `https://aviationweather.gov/data/cache/tafs.cache.xml.gz` (KMYR, KCRE, KCHS, LFBT) | 2026-09-30 03:38 UTC |

| `nws/alerts-active.sample.json` | `https://api.weather.gov/alerts/active?status=actual` (two polygon alerts, one zone-only; properties trimmed to the fields used) | 2026-09-30 |
| `eonet/events-open.sample.json` | `https://eonet.gsfc.nasa.gov/api/v3/events?status=open&days=30&limit=5` (unmodified) | 2026-09-30 |

AviationWeather.gov and NWS data are U.S. Government works (NOAA/NWS).
