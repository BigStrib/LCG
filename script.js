// script.js
// Lane County GIS Pro - Front-end only (GitHub Pages safe)
// Uses a public CORS proxy (AllOrigins) + Lane County ArcGIS services
// + geocoder fallbacks, with robust error handling and N/A behavior.

// =======================================================
// CONFIG
// =======================================================

// 1) CORS PROXY (AllOrigins)
// -------------------------------------------------------
// AllOrigins docs: https://api.allorigins.win
// Usage: GET https://api.allorigins.win/raw?url=<encoded_target_url>
//
// For example to query Lane County:
//   https://api.allorigins.win/raw?url=https%3A%2F%2Fgis.lanecounty.org%2F...
//
const CORS_PROXY = 'https://api.allorigins.win/raw?url=';

// 2) Lane County taxlots (ArcGIS MapServer layer 0)
const LANE_TAXLOTS_URL =
  'https://gis.lanecounty.org/arcgis/rest/services/LaneCounty/Taxlots/MapServer/0';

// 3) City of Eugene taxlots (optional fallback)
// If you find the official Eugene taxlot URL, plug it in here.
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

  AppState.map.setMaxBounds(LANE_BOUNDS);
  AppState.map.on('drag', () => {
    AppState.map.panInsideBounds(LANE_BOUNDS, { animate: false });
  });

  AppState.highlightLayer = L.layerGroup().addTo(AppState.map);

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
// FETCH WITH TIMEOUT + AllOrigins PROXY
// =======================================================

async function fetchWithTimeout(url, options = {}, timeoutMs = 8000) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const proxiedUrl = CORS_PROXY
      ? `${CORS_PROXY}${encodeURIComponent(url)}`
      : url;

    console.log('FETCH:', proxiedUrl);
    const res = await fetch(proxiedUrl, { ...options, signal: controller.signal });
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

  try {
    const result = await tryIdentifyFromTaxlots(lat, lng);
    if (result) {
      prop = result.property;
      geometry = result.geometry;
    }
  } catch (err) {
    console.warn('Taxlot identify failed:', err.message || err);
  }

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

  if (!prop) {
    prop = buildNAProperty(lat, lng);
    usedFallback = true;
  }

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

  // Oregon fallback (optional)
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

// (searchAddresses defined above – repeated here so it's in one place)
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

// =======================================================
// SAVED PROPERTIES, RLID, MODAL, UTILITIES
// =======================================================
// (Same as before; if you want me to paste them again, I can.)
// For brevity, the rest of the code is unchanged from your last working version,
// and this CORS change is the key difference.