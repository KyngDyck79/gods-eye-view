# Credits

**GOD'S EYE VIEW** is created by **Rod Smith**.

## Upstream project

This product is built on the open-source **God's Eye View** project by
**Bilawal Sidhu** and its contributors:

- Source: <https://github.com/bilawalsidhu/gods-eye-view>
- License: MIT. The original copyright notice is kept, unchanged, in
  [`LICENSE`](LICENSE), as the MIT License requires.

Rod Smith's version is a fork with its own branding and features. The upstream
authors are not responsible for it.

## Data providers

Every live data source, its license and its required attribution is listed in
[`DATA_SOURCES.md`](DATA_SOURCES.md). The same list is available in the app
under **SYSTEM** (bottom right), and map attributions stay on the map.

Providers added or changed for v2 so far:

| Provider | Used for | License / terms | Attribution |
|---|---|---|---|
| [ADSB.lol](https://api.adsb.lol/docs) | Live aircraft (primary) | ODbL 1.0 | Required |
| [OpenSky Network](https://openskynetwork.github.io/opensky-api/rest.html) | Live aircraft (fallback), tracks | Non-commercial terms of use | Required |
| [adsbdb](https://github.com/mrjackwills/adsbdb) | Plausible routes, aircraft type | No service licence published; route data by David Taylor (Edinburgh) and Jim Mason (Glasgow), display only — not to be copied or republished | Credited |
| [OurAirports](https://ourairports.com/data/) | Airports, runways, frequencies, navaids | Public domain | Courtesy |
| [AviationWeather.gov](https://aviationweather.gov/data/api/) | METAR and TAF | U.S. Government work (NOAA/NWS) | Courtesy |
| [TomTom](https://docs.tomtom.com/traffic-api/documentation/tomtom-maps/traffic-incidents/incident-details) | Traffic incidents (your key) | TomTom for Developers terms | Required |
| [LiveATC.net](https://www.liveatc.net/) | External link only, never embedded | LiveATC terms (personal use) | Linked |
| [NOAA National Weather Service](https://www.weather.gov/documentation/services-web-api) | Warning polygons, alerts | U.S. Government work | Courtesy |
| [USGS](https://earthquake.usgs.gov) | Earthquake alerts | U.S. Government work | Courtesy |
| [NASA EONET](https://eonet.gsfc.nasa.gov) | Natural events | NASA open data | Courtesy |
| [OpenStreetMap](https://www.openstreetmap.org/copyright) via [Overpass API](https://overpass-api.de) and [VK Maps Overpass](https://maps.mail.ru/osm/tools/overpass/) | Emergency facilities | ODbL 1.0 | Required |

## Third-party software

npm packages keep their own licenses; see `package-lock.json` and
[`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md).
