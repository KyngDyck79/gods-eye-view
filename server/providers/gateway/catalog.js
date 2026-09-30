/**
 * Provider metadata, checked against each provider's official documentation
 * on the date in `verified`. When a provider changes its terms, update the
 * entry here and in DATA_SOURCES.md together.
 *
 * @type {Readonly<Record<string, import('./registry.js').ProviderMeta>>}
 */
export const PROVIDER_CATALOG = Object.freeze({
  adsblol: Object.freeze({
    id: 'adsblol',
    name: 'ADSB.lol',
    domain: 'aircraft',
    sourceUrl: 'https://api.adsb.lol/docs',
    cost: 'Free',
    apiKeyRequired: false,
    rateLimit:
      'Dynamic, based on server load (not published). Point queries limited to a 250 nm radius.',
    license: 'ODbL 1.0',
    commercialUse: 'conditional',
    updateFrequency: 'Live (seconds)',
    dataTypes: [
      'position',
      'altitude',
      'speed',
      'track',
      'squawk',
      'emergency',
      'registration',
      'type',
    ],
    attribution: Object.freeze({
      text: 'Aircraft data © ADSB.lol contributors, ODbL 1.0',
      url: 'https://adsb.lol',
      required: true,
    }),
    verified: '2026-09-29',
  }),
  opensky: Object.freeze({
    id: 'opensky',
    name: 'OpenSky Network',
    domain: 'aircraft',
    sourceUrl: 'https://openskynetwork.github.io/opensky-api/rest.html',
    cost: 'Free for research and non-commercial use',
    apiKeyRequired: false,
    rateLimit:
      'Daily credits: 400 anonymous, 4,000 with an account. /states/all costs 1–4 credits by area.',
    license: 'OpenSky Network terms of use (non-commercial)',
    commercialUse: 'not-allowed',
    updateFrequency: '5 s (account) / 10 s (anonymous) resolution',
    dataTypes: ['position', 'altitude', 'speed', 'track', 'squawk', 'tracks'],
    attribution: Object.freeze({
      text: 'The OpenSky Network, https://opensky-network.org',
      url: 'https://opensky-network.org',
      required: true,
    }),
    verified: '2026-09-29',
  }),
  adsbdb: Object.freeze({
    id: 'adsbdb',
    name: 'adsbdb',
    domain: 'route',
    sourceUrl: 'https://github.com/mrjackwills/adsbdb',
    cost: 'Free',
    apiKeyRequired: false,
    rateLimit: 'Not published; requests are throttled and cached locally.',
    // No service licence is published. Its route data credit reads: "the
    // work of David Taylor, Edinburgh and Jim Mason, Glasgow, and may not be
    // copied, published, or incorporated into other databases without the
    // explicit permission of David J Taylor, Edinburgh". Display only.
    license:
      'No service licence published; route data © David Taylor & Jim Mason — display only, no copying or republishing',
    commercialUse: 'unknown',
    updateFrequency: 'On request, cached permanently',
    dataTypes: [
      'plausible route by callsign',
      'aircraft registration and type',
    ],
    attribution: Object.freeze({
      text: 'adsbdb — api.adsbdb.com; route data: David Taylor, Edinburgh and Jim Mason, Glasgow',
      url: 'https://www.adsbdb.com',
      required: true,
    }),
    verified: '2026-09-29',
  }),
  awc: Object.freeze({
    id: 'awc',
    name: 'AviationWeather.gov',
    domain: 'weather',
    sourceUrl: 'https://aviationweather.gov/data/api/',
    cost: 'Free',
    apiKeyRequired: false,
    rateLimit:
      '100 requests per minute; at most 400 results per request. Cache files are used instead of per-station queries.',
    license: 'U.S. Government work (NOAA/NWS), public domain',
    commercialUse: 'allowed',
    updateFrequency: 'METAR cache every minute, TAF cache every 10 minutes',
    dataTypes: ['METAR', 'TAF'],
    attribution: Object.freeze({
      text: 'Aviation weather: NOAA/NWS AviationWeather.gov',
      url: 'https://aviationweather.gov',
      required: false,
    }),
    verified: '2026-09-29',
  }),
  ourairports: Object.freeze({
    id: 'ourairports',
    name: 'OurAirports',
    domain: 'airport',
    sourceUrl: 'https://ourairports.com/data/',
    cost: 'Free',
    apiKeyRequired: false,
    rateLimit: 'Static files; downloaded once, refreshed weekly',
    license: 'Public domain',
    commercialUse: 'allowed',
    updateFrequency: 'Nightly upstream; refreshed here weekly',
    dataTypes: ['airports', 'runways', 'frequencies', 'navaids'],
    attribution: Object.freeze({
      text: 'Airport data from OurAirports (public domain)',
      url: 'https://ourairports.com',
      required: false,
    }),
    verified: '2026-09-29',
  }),
});
