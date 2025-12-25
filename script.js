// script.js
// Lane County GIS Pro - Front-end only (GitHub Pages safe)
// Uses your Cloudflare Worker as a CORS proxy + multiple ArcGIS endpoints
// + geocoder fallbacks, with strong error handling and N/A fallbacks.

// =======================================================
// CONFIG
// =======================================================

// 1) CORS PROXY (YOUR WORKER)
// -------------------------------------------------------
// This is your worker URL with "?url=" appended.
// The target URL we want will be encoded and appended after that.
//
// Example final call:
//   https://lane-cors.blakebigstrib.workers.dev/?url=https%3A%2F%2Fgis.lanecounty.org%2F...
//
const CORS_PROXY = 'https://lane-cors.blakebigstrib.workers.dev/?url=';

// 2) Lane County taxlots (ArcGIS MapServer layer 0)
const LANE_TAXLOTS_URL =
  'https://gis.lanecounty.org/arcgis/rest/services/LaneCounty/Taxlots/MapServer/0';

// 3) City of Eugene taxlots (optional fallback)
// If you find the official Eugene taxlot URL, put it here (HTTPS).
const EUGENE_TAXLOTS_URL =
  ''; // e.g. 'https://maps.eugene-or.gov/arcgis/rest/services/Public/Taxlots/MapServer/0'

// 4) Statewide taxlots (optional fallback #2)
const STATEWIDE_TAXLOTS_URL =
  ''; // e.g. 'https://state.or.us/arcgis/rest/services/State/Taxlots/MapServer/0'

// TAXLOT_ENDPOINTS is the ordered list of parcel services to try
const TAXLOT_ENDPOINTS = [
  LANE_TAXLOTS_URL,
  EUGENE_TAXLOTS_URL,
  STATEWIDE_TAXLOTS_URL
].filter(Boolean); // removes empty strings

// 5) Geocoders
// Primary: Esri World Geocoder
const ESRI_GEOCODE_URL =
  'https://geocode.arcgis.com/arcgis/rest/services/World/GeocodeServer';

// Fallback: Oregon GEOHub / Statewide geocoder (optional)
const OREGON_GEOCODE_URL =
  ''; // e.g. 'https://example.state.or.us/arcgis/rest/services/Geocoders/Statewide/GeocodeServer'

// 6) Lane County approximate bounds (for map constraints & search bias)
const LANE_BOUNDS = L.latLngBounds(
  [43.4, -124.1], // SW
  [44.4, -122.5]  // NE
);

// 7) LocalStorage key
const STORAGE_KEY = 'lane_gis_saved_v1';

// 8) Field mappings for different services (Lane, Eugene, State)
const FIELD_MAP = {
  owner: [
    'OWNER1', 'OWNER', 'OWNER_NAME', 'NAME', 'GRANTEE',
    'OWNNAME', 'ownname'
  ],
  situs: [
    'SITUS_ADDR', 'SITEADDR', 'SITUS', 'ADDRESS', 'PROP_ADDR',
    'ADDR1', 'addr1'
  ],
  city:       ['SITUS_CITY', 'CITY'],
  state:      ['SITUS_STATE', 'STATE'],
  zip:        ['SITUS_ZIP', 'ZIP', 'ZIPCODE'],
  assessed:   ['TOTALVALUE', 'TOTAL_VALUE', 'ASSESSED', 'ASSESSED_VALUE'],
  land:       ['LANDVALUE', 'LAND_VALUE'],
  improv:     ['IMPVALUE', 'IMP_VALUE', 'IMPR_VALUE'],
  acres:      ['ACRES', 'ACREAGE'],
  zoning:     ['ZONING', 'ZONE'],
  yearBuilt:  ['YEARBUILT', 'YEAR_BUILT'],
  parcelId:   ['TAXLOT', 'PARCEL', 'PARCEL_ID', 'ACCTNO', 'acctno', 'MAPLOT', 'maplot'],
  taxLot:     ['MAPTAXLOT', 'MAP_TAXLOT', 'TAXLOT', 'MAPLOT', 'maplot'],
  propType:   ['PROPCLASS', 'PROP_CLASS', 'PROPERTY_CLASS'],
  township:   ['TOWNSHIP', 'TWP'],
  range:      ['RANGE', 'RNG'],
  section:    ['SECTION', 'SEC']
};

// =======================================================
// APP STATE
// =======================================================

const AppState = {
  map: null,
  baseLayers: {},
  currentView: 'street',
  highlightLayer: null,
  userMarker: null,
  isLocating: false,

  currentProperty: null,     // normalized property object
  saved: [],
  filteredSaved: [],
  selectedSavedIds: new Set()
};

// =======================================================
// INIT
// =======================================================

document.addEventListener('DOMContentLoaded', () => {
  initMap();
  initBaseLayers();
  initUIEvents();
  initSaved();
  initGlobalSearch();

  setTimeout(() => {
    document.getElementById('loadingOverlay').classList.add('hidden');
  }, 900);
});

// =======================================================
// MAP
// =======================================================

function initMap() {
  AppState.map = L.map('map', {
    center: [44.05, -123.09],
    zoom: 11,
    minZoom: 9,
    maxZoom: 20,
    zoomControl: false,
    attributionControl: false
  });

  // Constrain map pannning to Lane County
  AppState.map.setMaxBounds(LANE_BOUNDS);
  AppState.map.on('drag', () => {
    AppState.map.panInsideBounds(LANE_BOUNDS, { animate: false });
  });

  AppState.highlightLayer = L.layerGroup().addTo(AppState.map);

  // Identify parcels on map click
  AppState.map.on('click', (e) => {
    if (AppState.map.getZoom() < 14) {
      showToast('Zoom in closer to identify parcels', 'error');
      return;
    }
    identifyParcelAt(e.latlng.lat, e.latlng.lng);
  });
}

function initBaseLayers() {
  const street = L.tileLayer(
    'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png',
    { maxZoom: 20 }
  ).addTo(AppState.map);

  const satellite = L.tileLayer(
    'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    { maxZoom: 20 }
  );

  const dark = L.tileLayer(
    'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
    { maxZoom: 20 }
  );

  AppState.baseLayers = { street, satellite, dark };
}

// =======================================================
// UI EVENTS
// =======================================================

function initUIEvents() {
  // Basemap toggle
  document.querySelectorAll('.view-btn').forEach(btn => {
    btn.addEventListener('click', () => switchBasemap(btn.dataset.view));
  });

  // Zoom
  document.getElementById('zoomIn').addEventListener('click', () => AppState.map.zoomIn());
  document.getElementById('zoomOut').addEventListener('click', () => AppState.map.zoomOut());

  // GPS
  document.getElementById('gpsBtn').addEventListener('click', toggleLocate);

  // Property panel
  document.getElementById('panelClose').addEventListener('click', closePropertyPanel);
  document.getElementById('savePropertyIcon').addEventListener('click', saveCurrentProperty);
  document.getElementById('savePropertyButton').addEventListener('click', saveCurrentProperty);
  document.getElementById('viewOnRLID').addEventListener('click', openRLID);

  // Saved drawer
  document.getElementById('savedBtn').addEventListener('click', openSavedDrawer);
  document.getElementById('savedClose').addEventListener('click', closeSavedDrawer);
  document.getElementById('overlay').addEventListener('click', closeSavedDrawer);

  // Saved search
  const savedSearchInput = document.getElementById('savedSearchInput');
  const savedSearchClear = document.getElementById('savedSearchClear');

  savedSearchInput.addEventListener('input', () => {
    const q = savedSearchInput.value.trim();
    savedSearchClear.classList.toggle('visible', q.length > 0);
    filterSaved(q);
  });

  savedSearchClear.addEventListener('click', () => {
    savedSearchInput.value = '';
    savedSearchClear.classList.remove('visible');
    filterSaved('');
  });

  // Select all
  document.getElementById('selectAllCheckbox').addEventListener('change', (e) => {
    handleSelectAll(e.target.checked);
  });

  // Delete/export
  document.getElementById('deleteSelected').addEventListener('click', deleteSelectedSaved);
  document.getElementById('exportSelected').addEventListener('click', exportSelectedSaved);

  // Confirm modal
  initConfirmModal();
}

// =======================================================
// FETCH WITH TIMEOUT + PROXY
// =======================================================

async function fetchWithTimeout(url, options = {}, timeoutMs = 8000) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const fullUrl = CORS_PROXY
      ? `${CORS_PROXY}${encodeURIComponent(url)}`
      : url;

    console.log('FETCH:', fullUrl);
    const res = await fetch(fullUrl, { ...options, signal: controller.signal });
    clearTimeout(id);
    return res;
  } catch (err) {
    clearTimeout(id);
    throw err;
  }
}

// =======================================================
// FIELD NORMALIZATION
// =======================================================

function getField(attrs, keys, fallback = null) {
  for (const key of keys) {
    if (attrs[key] !== undefined && attrs[key] !== null && attrs[key] !== '') {
      return attrs[key];
    }
    const lower = key.toLowerCase();
    for (const actual of Object.keys(attrs)) {
      if (actual.toLowerCase() === lower) {
        const val = attrs[actual];
        if (val !== undefined && val !== null && val !== '') return val;
      }
    }
  }
  return fallback;
}

function normalizeParcel(attrs) {
  const owner      = getField(attrs, FIELD_MAP.owner, 'Unknown Owner');
  const situs      = getField(attrs, FIELD_MAP.situs, 'Address not available');
  const city       = getField(attrs, FIELD_MAP.city, '');
  const state      = getField(attrs, FIELD_MAP.state, 'OR');
  const zip        = getField(attrs, FIELD_MAP.zip, '');
  const assessed   = getField(attrs, FIELD_MAP.assessed, null);
  const land       = getField(attrs, FIELD_MAP.land, null);
  const improv     = getField(attrs, FIELD_MAP.improv, null);
  const acres      = getField(attrs, FIELD_MAP.acres, null);
  const zoning     = getField(attrs, FIELD_MAP.zoning, 'N/A');
  const yearBuilt  = getField(attrs, FIELD_MAP.yearBuilt, 'N/A');
  const parcelId   = getField(attrs, FIELD_MAP.parcelId, 'N/A');
  const taxLot     = getField(attrs, FIELD_MAP.taxLot, parcelId);
  const propType   = getField(attrs, FIELD_MAP.propType, 'N/A');
  const township   = getField(attrs, FIELD_MAP.township, '');
  const rangeVal   = getField(attrs, FIELD_MAP.range, '');
  const section    = getField(attrs, FIELD_MAP.section, '');

  const fullParts = [situs];
  const cityState = [city, state].filter(Boolean).join(', ');
  if (cityState) fullParts.push(cityState);
  if (zip) fullParts.push(zip);
  const fullAddress = fullParts.join(' | ');

  const lotSizeLabel = acres ? `${Number(acres).toFixed(2)} ac` : 'N/A';
  const trs = (township || rangeVal || section)
    ? `T${township || '?'} R${rangeVal || '?'} S${section || '?'}`
    : 'N/A';

  const uniqueKey = `${parcelId}|${situs}|${owner}`.toLowerCase();

  return {
    uniqueKey,
    owner,
    situs,
    city,
    state,
    zip,
    fullAddress,
    assessed,
    land,
    improv,
    acres,
    lotSizeLabel,
    zoning,
    yearBuilt,
    parcelId,
    taxLot,
    propType,
    township,
    range: rangeVal,
    section,
    trs,
    savedAt: null,
    _rawAttrs: attrs
  };
}

function buildNAProperty(lat, lng) {
  const coordLabel = `${lat.toFixed(6)}, ${lng.toFixed(6)}`;
  return {
    uniqueKey: `na|${coordLabel}`,
    owner: 'Owner not available',
    situs: 'Location in Lane County',
    city: '',
    state: 'OR',
    zip: '',
    fullAddress: `Coordinates: ${coordLabel}`,
    assessed: null,
    land: null,
    improv: null,
    acres: null,
    lotSizeLabel: 'N/A',
    zoning: 'N/A',
    yearBuilt: 'N/A',
    parcelId: 'N/A',
    taxLot: 'N/A',
    propType: 'N/A',
    township: '',
    range: '',
    section: '',
    trs: 'N/A',
    savedAt: null,
    _rawAttrs: {}
  };
}

function buildReverseGeocodeProperty(lat, lng, addressObj) {
  const addr = addressObj || {};
  const situs = addr.Address || addr.Match_addr || 'Address not available';
  const city = addr.City || '';
  const state = addr.Region || 'OR';
  const zip = addr.Postal || '';

  const fullParts = [situs];
  const cs = [city, state].filter(Boolean).join(', ');
  if (cs) fullParts.push(cs);
  if (zip) fullParts.push(zip);
  const fullAddress = fullParts.join(' | ');

  return {
    uniqueKey: `revgeo|${situs}|${lat.toFixed(6)},${lng.toFixed(6)}`,
    owner: 'Owner not available',
    situs,
    city,
    state,
    zip,
    fullAddress,
    assessed: null,
    land: null,
    improv: null,
    acres: null,
    lotSizeLabel: 'N/A',
    zoning: 'N/A',
    yearBuilt: 'N/A',
    parcelId: 'N/A',
    taxLot: 'N/A',
    propType: 'N/A',
    township: '',
    range: '',
    section: '',
    trs: 'N/A',
    savedAt: null,
    _rawAttrs: {}
  };
}

// =======================================================
// IDENTIFY PARCEL + FALLBACKS
// =======================================================

async function identifyParcelAt(lat, lng) {
  AppState.highlightLayer.clearLayers();

  let prop = null;
  let geometry = null;
  let usedFallback = false;

  // 1) Parcel services
  try {
    const result = await tryIdentifyFromTaxlots(lat, lng);
    if (result) {
      prop = result.property;
      geometry = result.geometry;
    }
  } catch (err) {
    console.warn('Taxlot identify failed:', err.message || err);
  }

  // 2) Reverse geocode
  if (!prop) {
    try {
      const rev = await tryReverseGeocode(lat, lng);
      if (rev) {
        prop = rev;
        usedFallback = true;
      }
    } catch (err) {
      console.warn('Reverse geocode fallback failed:', err.message || err);
    }
  }

  // 3) Full N/A fallback
  if (!prop) {
    prop = buildNAProperty(lat, lng);
    usedFallback = true;
  }

  // Highlight geometry if available
  if (geometry && geometry.rings) {
    const coords = geometry.rings[0].map(([x, y]) => [y, x]);
    L.polygon(coords, {
      color: '#f97316',
      weight: 3,
      opacity: 1,
      fillOpacity: 0.2,
      fillColor: '#f97316'
    }).addTo(AppState.highlightLayer);
  }

  AppState.currentProperty = prop;
  updatePropertyPanel(prop);
  openPropertyPanel();

  if (usedFallback) {
    showToast('Limited data (parcel records unavailable). Showing best available info.', 'error');
  } else {
    showToast('Property loaded', 'success');
  }

  console.log('Raw parcel attributes:', prop._rawAttrs || {});
}

async function tryIdentifyFromTaxlots(lat, lng) {
  const params = new URLSearchParams({
    f: 'json',
    geometry: `${lng},${lat}`,
    geometryType: 'esriGeometryPoint',
    inSR: '4326',
    spatialRel: 'esriSpatialRelIntersects',
    outFields: '*',
    returnGeometry: 'true'
  });

  const errors = [];

  for (const endpoint of TAXLOT_ENDPOINTS) {
    const url = `${endpoint}/query?${params.toString()}`;
    try {
      console.log('Querying taxlots endpoint:', url);
      const res = await fetchWithTimeout(url, {}, 8000);
      if (!res.ok) {
        errors.push(`${endpoint}: HTTP ${res.status}`);
        continue;
      }

      const json = await res.json();
      if (json.features && json.features.length) {
        const feat = json.features[0];
        const attrs = feat.attributes || feat.properties || {};
        const geom = feat.geometry || null;
        const prop = normalizeParcel(attrs);
        return { property: prop, geometry: geom };
      } else {
        errors.push(`${endpoint}: no features at this location`);
      }
    } catch (err) {
      const reason = err.name === 'AbortError' ? 'timeout' : (err.message || 'network error');
      errors.push(`${endpoint}: ${reason}`);
    }
  }

  if (errors.length) {
    console.warn('All taxlot endpoints failed:', errors.join(' | '));
  }
  return null;
}

async function tryReverseGeocode(lat, lng) {
  const baseParams = new URLSearchParams({
    f: 'json',
    location: `${lng},${lat}`,
    outFields: '*'
  });

  const errors = [];

  // Esri primary
  try {
    const urlEsri = `${ESRI_GEOCODE_URL}/reverseGeocode?${baseParams.toString()}`;
    const resEsri = await fetchWithTimeout(urlEsri, {}, 7000);
    if (resEsri.ok) {
      const data = await resEsri.json();
      if (data.address) {
        return buildReverseGeocodeProperty(lat, lng, data.address);
      }
      errors.push('Esri reverse: no address in response');
    } else {
      errors.push(`Esri reverse: HTTP ${resEsri.status}`);
    }
  } catch (err) {
    errors.push(`Esri reverse: ${err.name === 'AbortError' ? 'timeout' : err.message}`);
  }

  // Oregon fallback
  if (OREGON_GEOCODE_URL) {
    try {
      const urlOr = `${OREGON_GEOCODE_URL}/reverseGeocode?${baseParams.toString()}`;
      const resOr = await fetchWithTimeout(urlOr, {}, 7000);
      if (resOr.ok) {
        const data = await resOr.json();
        if (data.address) {
          return buildReverseGeocodeProperty(lat, lng, data.address);
        }
        errors.push('Oregon reverse: no address in response');
      } else {
        errors.push(`Oregon reverse: HTTP ${resOr.status}`);
      }
    } catch (err) {
      errors.push(`Oregon reverse: ${err.name === 'AbortError' ? 'timeout' : err.message}`);
    }
  }

  console.warn('All reverse geocoders failed or returned nothing:', errors.join(' | '));
  return null;
}

// =======================================================
// PROPERTY PANEL
// =======================================================

function updatePropertyPanel(p) {
  document.getElementById('propertyOwner').textContent = p.owner || 'Owner not available';
  document.getElementById('propertyAddress').textContent = p.fullAddress || p.situs || 'N/A';

  document.getElementById('statAssessed').textContent =
    p.assessed != null ? formatCurrency(p.assessed) : 'N/A';
  document.getElementById('statLotSize').textContent = p.lotSizeLabel || 'N/A';
  document.getElementById('statZoning').textContent = p.zoning || 'N/A';
  document.getElementById('statYearBuilt').textContent = p.yearBuilt || 'N/A';

  document.getElementById('detailParcelId').textContent = p.parcelId || 'N/A';
  document.getElementById('detailTaxLot').textContent = p.taxLot || 'N/A';
  document.getElementById('detailPropType').textContent = p.propType || 'N/A';
  document.getElementById('detailLandValue').textContent =
    p.land != null ? formatCurrency(p.land) : 'N/A';
  document.getElementById('detailImprovementValue').textContent =
    p.improv != null ? formatCurrency(p.improv) : 'N/A';
  document.getElementById('detailTRS').textContent = p.trs || 'N/A';

  updateSaveButtons();
}

function openPropertyPanel() {
  document.getElementById('propertyPanel').classList.add('active');
  document.body.classList.add('map-focus');
}

function closePropertyPanel() {
  document.getElementById('propertyPanel').classList.remove('active');
  if (AppState.highlightLayer) {
    AppState.highlightLayer.clearLayers();
  }
  AppState.currentProperty = null;
  document.body.classList.remove('map-focus');
}

// =======================================================
// BASEMAP
// =======================================================

function switchBasemap(view) {
  if (view === AppState.currentView) return;

  Object.values(AppState.baseLayers).forEach(layer => AppState.map.removeLayer(layer));
  AppState.baseLayers[view].addTo(AppState.map);
  AppState.currentView = view;

  document.querySelectorAll('.view-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.view === view);
  });

  document.body.classList.toggle('dark-basemap', view === 'dark');
}

// =======================================================
// GPS
// =======================================================

function toggleLocate() {
  const btn = document.getElementById('gpsBtn');
  const status = document.getElementById('gpsStatus');

  if (!navigator.geolocation) {
    showToast('Geolocation not supported', 'error');
    return;
  }

  if (AppState.isLocating) {
    AppState.isLocating = false;
    btn.classList.remove('active');
    if (AppState.userMarker) {
      AppState.map.removeLayer(AppState.userMarker);
      AppState.userMarker = null;
    }
    return;
  }

  AppState.isLocating = true;
  btn.classList.add('active');
  status.textContent = 'Locating…';
  status.classList.add('visible');

  navigator.geolocation.getCurrentPosition(
    pos => {
      const { latitude, longitude, accuracy } = pos.coords;
      const latlng = [latitude, longitude];

      if (AppState.userMarker) {
        AppState.userMarker.setLatLng(latlng);
      } else {
        AppState.userMarker = L.marker(latlng, {
          icon: L.divIcon({
            className: 'user-location-marker',
            iconSize: [16, 16]
          })
        }).addTo(AppState.map);
      }

      AppState.map.flyTo(latlng, 18, { duration: 1.2 });
      status.textContent = `Accuracy ±${Math.round(accuracy)} m`;
      setTimeout(() => status.classList.remove('visible'), 2000);

      setTimeout(() => identifyParcelAt(latitude, longitude), 1200);
    },
    () => {
      status.classList.remove('visible');
      btn.classList.remove('active');
      AppState.isLocating = false;
      showToast('Unable to get location', 'error');
    },
    { enableHighAccuracy: true, timeout: 10000 }
  );
}

// =======================================================
// GLOBAL SEARCH
// =======================================================

function initGlobalSearch() {
  const input = document.getElementById('globalSearchInput');
  const clearBtn = document.getElementById('globalSearchClear');
  const resultsEl = document.getElementById('globalSearchResults');
  let debounce;

  input.addEventListener('input', () => {
    const q = input.value.trim();
    clearBtn.classList.toggle('visible', q.length > 0);

    clearTimeout(debounce);
    if (q.length < 3) {
      resultsEl.innerHTML = '';
      resultsEl.classList.remove('visible');
      return;
    }

    debounce = setTimeout(async () => {
      try {
        const candidates = await searchAddresses(q);
        renderSearchResults(candidates);
      } catch (err) {
        console.error(err);
        showToast('Network error while searching', 'error');
      }
    }, 300);
  });

  clearBtn.addEventListener('click', () => {
    input.value = '';
    clearBtn.classList.remove('visible');
    resultsEl.innerHTML = '';
    resultsEl.classList.remove('visible');
  });

  document.addEventListener('click', (e) => {
    if (!e.target.closest('.search-wrapper')) {
      resultsEl.classList.remove('visible');
    }
  });
}

async function searchAddresses(query) {
  const bbox = `${LANE_BOUNDS.getWest()},${LANE_BOUNDS.getSouth()},${LANE_BOUNDS.getEast()},${LANE_BOUNDS.getNorth()}`;
  const params = new URLSearchParams({
    f: 'json',
    SingleLine: query,
    maxLocations: '8',
    outFields: '*',
    category: 'Address',
    searchExtent: bbox
  });

  const normalizeCandidates = (json) =>
    (json.candidates || []).map(c => ({
      address: c.address,
      score: c.score,
      location: { lat: c.location.y, lng: c.location.x }
    }));

  const errors = [];

  // Esri primary
  try {
    const urlEsri = `${ESRI_GEOCODE_URL}/findAddressCandidates?${params.toString()}`;
    const resEsri = await fetchWithTimeout(urlEsri, {}, 8000);
    if (resEsri.ok) {
      const json = await resEsri.json();
      const cands = normalizeCandidates(json);
      if (cands.length) return cands;
      errors.push('Esri geocoder: no candidates');
    } else {
      errors.push(`Esri geocoder: HTTP ${resEsri.status}`);
    }
  } catch (err) {
    errors.push(`Esri geocoder: ${err.name === 'AbortError' ? 'timeout' : err.message}`);
  }

  // Oregon fallback (optional)
  if (OREGON_GEOCODE_URL) {
    try {
      const urlOr = `${OREGON_GEOCODE_URL}/findAddressCandidates?${params.toString()}`;
      const resOr = await fetchWithTimeout(urlOr, {}, 8000);
      if (resOr.ok) {
        const json = await resOr.json();
        const cands = normalizeCandidates(json);
        if (cands.length) return cands;
        errors.push('Oregon geocoder: no candidates');
      } else {
        errors.push(`Oregon geocoder: HTTP ${resOr.status}`);
      }
    } catch (err) {
      errors.push(`Oregon geocoder: ${err.name === 'AbortError' ? 'timeout' : err.message}`);
    }
  }

  console.warn('All geocoders failed or returned no candidates:', errors.join(' | '));
  return [];
}

function renderSearchResults(candidates) {
  const resultsEl = document.getElementById('globalSearchResults');
  resultsEl.innerHTML = '';

  if (!candidates.length) {
    resultsEl.innerHTML = `
      <div class="search-result-item">
        <div class="search-result-icon">
          <svg class="icon"><use href="#ic-search"></use></svg>
        </div>
        <div class="search-result-text">
          <div class="search-result-title">No results found</div>
          <div class="search-result-subtitle">Try another Lane County address</div>
        </div>
      </div>`;
    resultsEl.classList.add('visible');
    return;
  }

  candidates.forEach(c => {
    const div = document.createElement('div');
    div.className = 'search-result-item';
    div.innerHTML = `
      <div class="search-result-icon">
        <svg class="icon"><use href="#ic-location"></use></svg>
      </div>
      <div class="search-result-text">
        <div class="search-result-title">${c.address}</div>
        <div class="search-result-subtitle">Score: ${Math.round(c.score)}%</div>
      </div>`;
    div.addEventListener('click', () => {
      resultsEl.classList.remove('visible');
      document.getElementById('globalSearchInput').value = c.address;
      flyToAndIdentify(c.location.lat, c.location.lng);
    });
    resultsEl.appendChild(div);
  });

  resultsEl.classList.add('visible');
}

function flyToAndIdentify(lat, lng) {
  const center = L.latLng(lat, lng);
  AppState.map.flyTo(center, 18, { duration: 1.5 });
  setTimeout(() => identifyParcelAt(lat, lng), 1500);
}

// =======================================================
// SAVED PROPERTIES
// =======================================================

function initSaved() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    AppState.saved = raw ? JSON.parse(raw) : [];
  } catch {
    AppState.saved = [];
  }
  AppState.filteredSaved = [...AppState.saved];
  updateSavedBadges();
  renderSavedList();
}

function updateSavedBadges() {
  const count = AppState.saved.length;
  document.getElementById('savedBadge').textContent = count;
  document.getElementById('savedSubtitle').textContent =
    count === 1 ? '1 property' : `${count} properties`;
}

function isCurrentSaved() {
  if (!AppState.currentProperty) return false;
  const key = AppState.currentProperty.uniqueKey;
  return AppState.saved.some(p => p.uniqueKey === key);
}

function updateSaveButtons() {
  const iconBtn = document.getElementById('savePropertyIcon');
  const footerBtn = document.getElementById('savePropertyButton');
  const saved = isCurrentSaved();

  iconBtn.classList.add('primary');

  if (saved) {
    footerBtn.innerHTML = '<svg class="icon sm"><use href="#ic-bookmark"></use></svg> Saved';
    footerBtn.disabled = true;
  } else {
    footerBtn.innerHTML =
      '<svg class="icon sm"><use href="#ic-bookmark"></use></svg> Save to List';
    footerBtn.disabled = false;
  }
}

function saveCurrentProperty() {
  if (!AppState.currentProperty) {
    showToast('No property selected', 'error');
    return;
  }
  if (isCurrentSaved()) {
    showToast('Property already in your list', 'error');
    return;
  }

  const p = AppState.currentProperty;
  const savedItem = {
    ...p,
    id: Date.now(),
    savedAt: new Date().toISOString()
  };

  AppState.saved.push(savedItem);
  AppState.filteredSaved = [...AppState.saved];
  localStorage.setItem(STORAGE_KEY, JSON.stringify(AppState.saved));

  updateSavedBadges();
  renderSavedList();
  updateSaveButtons();
  showToast('Property saved', 'success');
}

// Drawer
function openSavedDrawer() {
  document.getElementById('savedDrawer').classList.add('open');
  document.getElementById('overlay').classList.add('visible');
  AppState.selectedSavedIds.clear();
  filterSaved(document.getElementById('savedSearchInput').value.trim());
}

function closeSavedDrawer() {
  document.getElementById('savedDrawer').classList.remove('open');
  document.getElementById('overlay').classList.remove('visible');
}

// Filter saved
function filterSaved(query) {
  const q = query.toLowerCase();
  if (!q) {
    AppState.filteredSaved = [...AppState.saved];
  } else {
    AppState.filteredSaved = AppState.saved.filter(p =>
      (p.owner || '').toLowerCase().includes(q) ||
      (p.situs || '').toLowerCase().includes(q) ||
      (p.parcelId || '').toLowerCase().includes(q)
    );
  }
  renderSavedList();
  updateSelectionSummary();
}

function renderSavedList() {
  const list = document.getElementById('savedList');
  list.innerHTML = '';

  if (!AppState.filteredSaved.length) {
    list.innerHTML = `
      <div class="saved-empty">
        <div class="saved-empty-icon">
          <svg class="icon"><use href="#ic-bookmark"></use></svg>
        </div>
        <div>No saved properties match your search.</div>
      </div>`;
    const cb = document.getElementById('selectAllCheckbox');
    cb.checked = false;
    cb.indeterminate = false;
    return;
  }

  AppState.filteredSaved.forEach((p, index) => {
    const isSelected = AppState.selectedSavedIds.has(p.id);
    const card = document.createElement('div');
    card.className = 'saved-card' + (isSelected ? ' selected' : '');
    card.dataset.id = p.id;

    const savedDate = p.savedAt ? new Date(p.savedAt) : null;
    const dateLabel = savedDate
      ? savedDate.toLocaleDateString('en-US', {
          month: 'short',
          day: 'numeric',
          year: 'numeric'
        })
      : '';

    card.innerHTML = `
      <div class="saved-card-top">
        <div class="card-left">
          <div class="card-checkbox ${isSelected ? 'checked' : ''}"></div>
          <div class="card-index">#${index + 1}</div>
        </div>
        <div class="card-tag">${p.zoning || 'Zoning N/A'}</div>
      </div>
      <div class="saved-card-main">
        <div class="saved-owner">${p.owner}</div>
        <div class="saved-address">${p.fullAddress || p.situs}</div>
        <div class="saved-card-stats">
          <div class="saved-stat">
            <span class="saved-stat-label">Value</span>
            <span class="saved-stat-value">${p.assessed != null ? formatCurrency(p.assessed) : 'N/A'}</span>
          </div>
          <div class="saved-stat">
            <span class="saved-stat-label">Lot</span>
            <span class="saved-stat-value">${p.lotSizeLabel || 'N/A'}</span>
          </div>
          <div class="saved-stat">
            <span class="saved-stat-label">Parcel</span>
            <span class="saved-stat-value">${p.parcelId || 'N/A'}</span>
          </div>
        </div>
      </div>
      <div class="saved-card-footer">
        <div class="saved-date">${dateLabel ? 'Saved ' + dateLabel : ''}</div>
        <div class="saved-actions">
          <button class="saved-mini-btn" title="Zoom to on map">
            <svg class="icon sm"><use href="#ic-location"></use></svg>
          </button>
          <button class="saved-mini-btn" title="Remove from list">
            <svg class="icon sm"><use href="#ic-trash"></use></svg>
          </button>
        </div>
      </div>
    `;

    // Selection
    card.querySelector('.card-checkbox').addEventListener('click', (e) => {
      e.stopPropagation();
      toggleSavedSelection(p.id);
    });

    // Zoom to property
    card.querySelectorAll('.saved-mini-btn')[0].addEventListener('click', async (e) => {
      e.stopPropagation();
      closeSavedDrawer();

      const query = p.fullAddress || p.situs;
      if (!query || query === 'N/A') {
        showToast('No address available to locate this property', 'error');
        return;
      }

      showToast('Locating property on map…', 'success');

      try {
        const candidates = await searchAddresses(query);
        if (!candidates.length) {
          showToast('Could not locate this address on the map', 'error');
          return;
        }

        const best = candidates[0];
        flyToAndIdentify(best.location.lat, best.location.lng);
      } catch (err) {
        console.error(err);
        showToast('Network error while locating property', 'error');
      }
    });

    // Delete single
    card.querySelectorAll('.saved-mini-btn')[1].addEventListener('click', async (e) => {
      e.stopPropagation();
      const confirmed = await showConfirmModal({
        title: 'Remove property',
        message: `Remove "${p.owner}" at "${p.situs}" from your saved list?`,
        confirmText: 'Remove',
        confirmStyle: 'danger'
      });
      if (confirmed) {
        deleteSingleSaved(p.id);
      }
    });

    list.appendChild(card);
  });

  updateSelectAllCheckbox();
  updateSelectionSummary();
}

function toggleSavedSelection(id) {
  if (AppState.selectedSavedIds.has(id)) {
    AppState.selectedSavedIds.delete(id);
  } else {
    AppState.selectedSavedIds.add(id);
  }
  renderSavedList();
}

function handleSelectAll(checked) {
  AppState.selectedSavedIds.clear();
  if (checked) {
    AppState.filteredSaved.forEach(p => AppState.selectedSavedIds.add(p.id));
  }
  renderSavedList();
}

function updateSelectAllCheckbox() {
  const cb = document.getElementById('selectAllCheckbox');
  const visibleIds = AppState.filteredSaved.map(p => p.id);
  const selectedVisible = visibleIds.filter(id => AppState.selectedSavedIds.has(id));

  if (!visibleIds.length) {
    cb.checked = false;
    cb.indeterminate = false;
    return;
  }

  if (!selectedVisible.length) {
    cb.checked = false;
    cb.indeterminate = false;
  } else if (selectedVisible.length === visibleIds.length) {
    cb.checked = true;
    cb.indeterminate = false;
  } else {
    cb.checked = false;
    cb.indeterminate = true;
  }
}

function updateSelectionSummary() {
  const selectedCount = AppState.selectedSavedIds.size;
  const totalVisible = AppState.filteredSaved.length;
  const summary = document.getElementById('selectedSummary');
  const delBtn = document.getElementById('deleteSelected');
  const expBtn = document.getElementById('exportSelected');

  if (!totalVisible) {
    summary.textContent = 'No saved properties to show';
    delBtn.disabled = true;
    expBtn.disabled = true;
    return;
  }

  if (!selectedCount) {
    summary.textContent = `${totalVisible} in view. No selection.`;
    delBtn.disabled = true;
    expBtn.disabled = true;
  } else if (selectedCount === totalVisible) {
    summary.textContent = `All ${selectedCount} visible properties selected`;
    delBtn.disabled = false;
    expBtn.disabled = false;
  } else {
    summary.textContent = `${selectedCount} of ${totalVisible} visible selected`;
    delBtn.disabled = false;
    expBtn.disabled = false;
  }
}

function deleteSingleSaved(id) {
  AppState.saved = AppState.saved.filter(p => p.id !== id);
  AppState.selectedSavedIds.delete(id);
  AppState.filteredSaved = AppState.filteredSaved.filter(p => p.id !== id);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(AppState.saved));
  updateSavedBadges();
  renderSavedList();
  showToast('Property removed', 'success');
}

async function deleteSelectedSaved() {
  const ids = Array.from(AppState.selectedSavedIds);
  if (!ids.length) return;

  const confirmed = await showConfirmModal({
    title: 'Remove selected',
    message: `Remove ${ids.length} propert${ids.length === 1 ? 'y' : 'ies'} from your saved list?`,
    confirmText: 'Remove',
    confirmStyle: 'danger'
  });
  if (!confirmed) return;

  AppState.saved = AppState.saved.filter(p => !AppState.selectedSavedIds.has(p.id));
  localStorage.setItem(STORAGE_KEY, JSON.stringify(AppState.saved));

  AppState.filteredSaved = [...AppState.saved];
  AppState.selectedSavedIds.clear();
  updateSavedBadges();
  renderSavedList();
  showToast('Selected properties removed', 'success');
}

function exportSelectedSaved() {
  const ids = Array.from(AppState.selectedSavedIds);
  if (!ids.length) return;

  const props = AppState.saved.filter(p => ids.includes(p.id));
  if (!props.length) return;

  const lines = [];
  lines.push('LANE COUNTY PROPERTY REPORT');
  lines.push('========================================');
  lines.push(`Generated: ${new Date().toLocaleString()}`);
  lines.push(`Total properties: ${props.length}`);
  lines.push('');

  props.forEach((p, i) => {
    lines.push(`Property ${i + 1}`);
    lines.push('----------------------------------------');
    lines.push(`Owner:          ${p.owner}`);
    lines.push(`Site Address:   ${p.situs}`);
    lines.push(`Parcel ID:      ${p.parcelId || 'N/A'}`);
    lines.push(`Tax Lot:        ${p.taxLot || 'N/A'}`);
    lines.push(`Zoning:         ${p.zoning || 'N/A'}`);
    lines.push(`Assessed Value: ${p.assessed != null ? formatCurrency(p.assessed) : 'N/A'}`);
    lines.push(`Land Value:     ${p.land != null ? formatCurrency(p.land) : 'N/A'}`);
    lines.push(`Impr. Value:    ${p.improv != null ? formatCurrency(p.improv) : 'N/A'}`);
    lines.push(`Lot Size:       ${p.lotSizeLabel || 'N/A'}`);
    lines.push(`Year Built:     ${p.yearBuilt || 'N/A'}`);
    lines.push(`Saved On:       ${p.savedAt ? new Date(p.savedAt).toLocaleString() : 'N/A'}`);
    lines.push('');
  });

  lines.push('========================================');
  lines.push('Source: Lane County GIS / RLID');
  lines.push('Note: Values are approximate and for reference only.');
  lines.push('========================================');

  const blob = new Blob([lines.join('\n')], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const now = new Date();
  const name = `lane_county_properties_${now.getFullYear()}${String(
    now.getMonth() + 1
  ).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}.txt`;

  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);

  showToast(`Exported ${props.length} propert${props.length === 1 ? 'y' : 'ies'}`, 'success');
}

// =======================================================
// RLID
// =======================================================

function openRLID() {
  if (!AppState.currentProperty) {
    window.open('https://www.rlid.org', '_blank');
    return;
  }
  const pid = AppState.currentProperty.parcelId;
  if (!pid || pid === 'N/A') {
    window.open('https://www.rlid.org', '_blank');
    return;
  }
  window.open(
    `https://www.rlid.org/custom/lc/at/query_results.cfm?maptaxlot=${encodeURIComponent(pid)}`,
    '_blank'
  );
}

// =======================================================
// CONFIRM MODAL + UTILITIES
// =======================================================

let confirmResolve = null;

function initConfirmModal() {
  const modal = document.getElementById('confirmModal');
  const btnOk = document.getElementById('confirmOk');
  const btnCancel = document.getElementById('confirmCancel');
  const btnClose = document.getElementById('confirmClose');

  const close = (result) => {
    modal.classList.remove('visible');
    if (confirmResolve) {
      confirmResolve(result);
      confirmResolve = null;
    }
  };

  btnOk.addEventListener('click', () => close(true));
  btnCancel.addEventListener('click', () => close(false));
  btnClose.addEventListener('click', () => close(false));
  modal.addEventListener('click', (e) => {
    if (e.target === modal) close(false);
  });
}

function showConfirmModal({ title, message, confirmText = 'OK', confirmStyle = 'primary' }) {
  const modal = document.getElementById('confirmModal');
  document.getElementById('confirmTitle').textContent = title;
  document.getElementById('confirmMessage').textContent = message;
  const btnOk = document.getElementById('confirmOk');

  btnOk.textContent = confirmText;
  btnOk.classList.remove('primary', 'danger');
  btnOk.classList.add('primary');

  modal.classList.add('visible');

  return new Promise((resolve) => {
    confirmResolve = resolve;
  });
}

function formatCurrency(v) {
  const n = Number(v);
  if (Number.isNaN(n)) return 'N/A';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0
  }).format(n);
}

function showToast(message, type = 'success') {
  const container = document.getElementById('toastContainer');
  const div = document.createElement('div');
  div.className = `toast ${type}`;
  div.innerHTML = `
    <span class="toast-icon"></span>
    <span>${message}</span>
  `;
  container.appendChild(div);
  setTimeout(() => div.remove(), 2600);
}