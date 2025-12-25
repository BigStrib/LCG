/* ============================================
   LANE COUNTY GIS PROPERTY EXPLORER
   Main Application Script - Debug Version
   ============================================ */

(function() {
    'use strict';

    /* ============================================
       CONFIGURATION
       ============================================ */
    const CONFIG = {
        // Cloudflare Worker Proxy URL - UPDATE THIS!
        PROXY_URL: 'https://lane-cors.blakebigstrib.workers.dev',
        
        // Lane County ArcGIS REST Services
        ARCGIS_BASE_URL: 'https://lcmaps.lanecounty.org/arcgis/rest/services',
        
        // Map Services - we'll try multiple
        MAP_SERVICES: [
            '/Taxlots/MapServer',
            '/TaxlotsFull/MapServer',
            '/Assessor/MapServer',
            '/Taxlots_Parcels/MapServer'
        ],
        
        // Current map service index
        CURRENT_SERVICE_INDEX: 0,
        
        // Layer IDs to try
        TAXLOT_LAYER_IDS: [0, 1, 2],
        
        // Default map center (Lane County, Oregon)
        DEFAULT_CENTER: [44.0521, -123.0868],
        DEFAULT_ZOOM: 12,
        MIN_ZOOM: 8,
        MAX_ZOOM: 19,
        
        // Identify settings
        IDENTIFY_TOLERANCE: 10,
        
        // Search settings
        MAX_SEARCH_RESULTS: 50,
        
        // Toast duration
        TOAST_DURATION: 5000,
        
        // LocalStorage key
        STORAGE_KEY: 'laneCountyGIS_savedProperties',
        
        // N/A text
        NA_TEXT: 'N/A',
        
        // Debug mode
        DEBUG: true
    };

    /* ============================================
       DEBUG LOGGING
       ============================================ */
    function debug(...args) {
        if (CONFIG.DEBUG) {
            console.log('[GIS Debug]', ...args);
        }
    }

    function debugError(...args) {
        console.error('[GIS Error]', ...args);
    }

    /* ============================================
       BASEMAP CONFIGURATIONS
       ============================================ */
    const BASEMAPS = {
        street: {
            url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
            options: {
                attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
                maxZoom: 19
            }
        },
        satellite: {
            url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
            options: {
                attribution: '&copy; <a href="https://www.esri.com/">Esri</a>',
                maxZoom: 19
            }
        }
    };

    /* ============================================
       APPLICATION STATE
       ============================================ */
    const state = {
        map: null,
        currentBasemap: 'street',
        basemapLayers: {},
        currentMarker: null,
        currentPopup: null,
        savedProperties: [],
        selectedPropertyIds: new Set(),
        isLoading: false,
        isSidebarCollapsed: false,
        currentSearchType: 'address',
        searchResults: []
    };

    /* ============================================
       DOM ELEMENT REFERENCES
       ============================================ */
    const elements = {};

    /* ============================================
       INITIALIZATION
       ============================================ */
    function init() {
        debug('Initializing application...');
        
        cacheElements();
        loadSavedProperties();
        initMap();
        initBasemaps();
        bindEvents();
        bindSearchEvents();
        updateUI();
        
        // Test the proxy connection
        testProxyConnection();
        
        debug('Application initialized');
    }

    /**
     * Test proxy connection on startup
     */
    async function testProxyConnection() {
        debug('Testing proxy connection...');
        
        try {
            // Try to get service info
            const testUrl = `${CONFIG.ARCGIS_BASE_URL}${CONFIG.MAP_SERVICES[0]}?f=json`;
            const response = await fetchThroughProxy(testUrl);
            
            if (response && response.layers) {
                debug('Proxy connection successful!');
                debug('Available layers:', response.layers.map(l => `${l.id}: ${l.name}`));
                
                // Find the taxlot layer
                const taxlotLayer = response.layers.find(l => 
                    l.name.toLowerCase().includes('taxlot') || 
                    l.name.toLowerCase().includes('parcel')
                );
                
                if (taxlotLayer) {
                    debug('Found taxlot layer:', taxlotLayer.id, taxlotLayer.name);
                }
            } else {
                debug('Proxy response:', response);
            }
        } catch (error) {
            debugError('Proxy test failed:', error);
            showToast('error', 'Connection test failed. Check console for details.');
        }
    }

    /**
     * Cache DOM elements
     */
    function cacheElements() {
        elements.map = document.getElementById('map');
        elements.sidebar = document.getElementById('sidebar');
        elements.sidebarToggle = document.getElementById('sidebar-toggle');
        elements.sidebarExpandBtn = document.getElementById('sidebar-expand-btn');
        elements.savedPropertiesList = document.getElementById('saved-properties-list');
        elements.emptyState = document.getElementById('empty-state');
        elements.propertyCount = document.getElementById('property-count');
        elements.savedBadge = document.getElementById('saved-badge');
        
        elements.btnExportAll = document.getElementById('btn-export-all');
        elements.btnExportSelected = document.getElementById('btn-export-selected');
        elements.btnClearAll = document.getElementById('btn-clear-all');
        elements.btnStreetView = document.getElementById('btn-street-view');
        elements.btnSatelliteView = document.getElementById('btn-satellite-view');
        elements.btnMyLocation = document.getElementById('btn-my-location');
        elements.btnResetView = document.getElementById('btn-reset-view');
        
        elements.selectAllCheckbox = document.getElementById('select-all-checkbox');
        
        elements.searchPanel = document.getElementById('search-panel');
        elements.searchTabs = document.querySelectorAll('.search-tab');
        elements.searchInputGroups = document.querySelectorAll('.search-input-group');
        
        elements.inputAddress = document.getElementById('input-address');
        elements.inputTaxlot = document.getElementById('input-taxlot');
        elements.inputOwner = document.getElementById('input-owner');
        elements.inputLat = document.getElementById('input-lat');
        elements.inputLng = document.getElementById('input-lng');
        
        elements.btnSearchAddress = document.getElementById('btn-search-address');
        elements.btnSearchTaxlot = document.getElementById('btn-search-taxlot');
        elements.btnSearchOwner = document.getElementById('btn-search-owner');
        elements.btnSearchCoords = document.getElementById('btn-search-coords');
        
        elements.btnClearAddress = document.getElementById('btn-clear-address');
        elements.btnClearTaxlot = document.getElementById('btn-clear-taxlot');
        elements.btnClearOwner = document.getElementById('btn-clear-owner');
        
        elements.searchResults = document.getElementById('search-results');
        elements.resultsList = document.getElementById('results-list');
        elements.resultsCount = document.getElementById('results-count');
        elements.resultsEmpty = document.getElementById('results-empty');
        elements.resultsLoading = document.getElementById('results-loading');
        elements.btnCloseResults = document.getElementById('btn-close-results');
        
        elements.loadingOverlay = document.getElementById('loading-overlay');
        elements.errorToast = document.getElementById('error-toast');
        elements.successToast = document.getElementById('success-toast');
        elements.errorMessage = document.getElementById('error-message');
        elements.successMessage = document.getElementById('success-message');
        elements.toastClose = document.getElementById('toast-close');
        
        elements.coordsText = document.getElementById('coords-text');
        
        elements.confirmModal = document.getElementById('confirm-modal');
        elements.confirmMessage = document.getElementById('confirm-message');
        elements.btnConfirmOk = document.getElementById('btn-confirm-ok');
        elements.btnConfirmCancel = document.getElementById('btn-confirm-cancel');
        
        elements.popupTemplate = document.getElementById('popup-template');
        elements.propertyCardTemplate = document.getElementById('property-card-template');
        elements.searchResultTemplate = document.getElementById('search-result-template');
    }

    /**
     * Initialize map
     */
    function initMap() {
        state.map = L.map('map', {
            center: CONFIG.DEFAULT_CENTER,
            zoom: CONFIG.DEFAULT_ZOOM,
            minZoom: CONFIG.MIN_ZOOM,
            maxZoom: CONFIG.MAX_ZOOM,
            zoomControl: true
        });

        state.map.zoomControl.setPosition('bottomright');
        state.map.on('click', handleMapClick);
        state.map.on('mousemove', handleMapMouseMove);
    }

    /**
     * Initialize basemaps
     */
    function initBasemaps() {
        state.basemapLayers.street = L.tileLayer(BASEMAPS.street.url, BASEMAPS.street.options);
        state.basemapLayers.satellite = L.tileLayer(BASEMAPS.satellite.url, BASEMAPS.satellite.options);
        state.basemapLayers[state.currentBasemap].addTo(state.map);
    }

    /**
     * Bind events
     */
    function bindEvents() {
        elements.btnStreetView.addEventListener('click', () => switchBasemap('street'));
        elements.btnSatelliteView.addEventListener('click', () => switchBasemap('satellite'));
        elements.btnMyLocation.addEventListener('click', goToMyLocation);
        elements.btnResetView.addEventListener('click', resetMapView);
        elements.sidebarToggle.addEventListener('click', toggleSidebar);
        elements.sidebarExpandBtn.addEventListener('click', toggleSidebar);
        elements.btnExportAll.addEventListener('click', exportAllProperties);
        elements.btnExportSelected.addEventListener('click', exportSelectedProperties);
        elements.btnClearAll.addEventListener('click', confirmClearAll);
        elements.selectAllCheckbox.addEventListener('change', handleSelectAll);
        elements.toastClose.addEventListener('click', () => hideToast('error'));
        elements.btnConfirmCancel.addEventListener('click', hideModal);
        elements.confirmModal.querySelector('.modal-backdrop').addEventListener('click', hideModal);
    }

    /**
     * Bind search events
     */
    function bindSearchEvents() {
        elements.searchTabs.forEach(tab => {
            tab.addEventListener('click', () => switchSearchTab(tab.dataset.searchType));
        });

        elements.btnSearchAddress.addEventListener('click', () => performSearch('address'));
        elements.btnSearchTaxlot.addEventListener('click', () => performSearch('taxlot'));
        elements.btnSearchOwner.addEventListener('click', () => performSearch('owner'));
        elements.btnSearchCoords.addEventListener('click', () => performSearch('coordinates'));

        elements.inputAddress.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') performSearch('address');
        });
        elements.inputTaxlot.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') performSearch('taxlot');
        });
        elements.inputOwner.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') performSearch('owner');
        });
        elements.inputLat.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') performSearch('coordinates');
        });
        elements.inputLng.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') performSearch('coordinates');
        });

        elements.btnClearAddress.addEventListener('click', () => clearSearchInput('address'));
        elements.btnClearTaxlot.addEventListener('click', () => clearSearchInput('taxlot'));
        elements.btnClearOwner.addEventListener('click', () => clearSearchInput('owner'));

        elements.inputAddress.addEventListener('input', () => toggleClearButton('address'));
        elements.inputTaxlot.addEventListener('input', () => toggleClearButton('taxlot'));
        elements.inputOwner.addEventListener('input', () => toggleClearButton('owner'));

        elements.btnCloseResults.addEventListener('click', hideSearchResults);

        document.addEventListener('click', (e) => {
            if (!elements.searchPanel.contains(e.target)) {
                hideSearchResults();
            }
        });
    }

    /* ============================================
       MAP INTERACTION
       ============================================ */
    
    async function handleMapClick(e) {
        const { lat, lng } = e.latlng;
        
        debug(`Map clicked at: ${lat}, ${lng}`);
        
        if (state.currentMarker) {
            state.map.removeLayer(state.currentMarker);
        }

        state.currentMarker = L.marker([lat, lng], {
            icon: createCustomIcon()
        }).addTo(state.map);

        await identifyProperty(lat, lng);
    }

    function handleMapMouseMove(e) {
        const { lat, lng } = e.latlng;
        elements.coordsText.textContent = `Lat: ${lat.toFixed(6)}, Lng: ${lng.toFixed(6)}`;
    }

    function createCustomIcon() {
        return L.divIcon({
            className: 'custom-marker',
            html: `
                <div style="
                    width: 30px;
                    height: 30px;
                    background: linear-gradient(135deg, #3b82f6, #1d4ed8);
                    border: 3px solid white;
                    border-radius: 50% 50% 50% 0;
                    transform: rotate(-45deg);
                    box-shadow: 0 4px 10px rgba(0,0,0,0.3);
                "></div>
            `,
            iconSize: [30, 30],
            iconAnchor: [15, 30],
            popupAnchor: [0, -30]
        });
    }

    function goToMyLocation() {
        if (!navigator.geolocation) {
            showToast('error', 'Geolocation not supported');
            return;
        }

        showLoading();

        navigator.geolocation.getCurrentPosition(
            (position) => {
                const { latitude, longitude } = position.coords;
                state.map.setView([latitude, longitude], 16);
                
                if (state.currentMarker) {
                    state.map.removeLayer(state.currentMarker);
                }
                state.currentMarker = L.marker([latitude, longitude], {
                    icon: createCustomIcon()
                }).addTo(state.map);

                hideLoading();
                identifyProperty(latitude, longitude);
            },
            (error) => {
                hideLoading();
                showToast('error', 'Unable to get location');
            },
            { enableHighAccuracy: true, timeout: 10000 }
        );
    }

    function resetMapView() {
        state.map.setView(CONFIG.DEFAULT_CENTER, CONFIG.DEFAULT_ZOOM);
        
        if (state.currentMarker) {
            state.map.removeLayer(state.currentMarker);
            state.currentMarker = null;
        }

        if (state.currentPopup) {
            state.map.closePopup(state.currentPopup);
            state.currentPopup = null;
        }
    }

    function switchBasemap(basemapType) {
        if (basemapType === state.currentBasemap) return;

        state.map.removeLayer(state.basemapLayers[state.currentBasemap]);
        state.basemapLayers[basemapType].addTo(state.map);
        state.currentBasemap = basemapType;

        elements.btnStreetView.classList.toggle('active', basemapType === 'street');
        elements.btnSatelliteView.classList.toggle('active', basemapType === 'satellite');
    }

    /* ============================================
       PROPERTY IDENTIFICATION - CORE FUNCTION
       ============================================ */

    async function identifyProperty(lat, lng) {
        showLoading();
        debug(`Identifying property at: ${lat}, ${lng}`);

        try {
            const bounds = state.map.getBounds();
            const size = state.map.getSize();
            
            // Try each layer ID
            for (const layerId of CONFIG.TAXLOT_LAYER_IDS) {
                debug(`Trying layer ${layerId}...`);
                
                const params = new URLSearchParams({
                    f: 'json',
                    geometry: JSON.stringify({
                        x: lng,
                        y: lat,
                        spatialReference: { wkid: 4326 }
                    }),
                    geometryType: 'esriGeometryPoint',
                    sr: '4326',
                    layers: `all:${layerId}`,
                    tolerance: CONFIG.IDENTIFY_TOLERANCE.toString(),
                    mapExtent: `${bounds.getWest()},${bounds.getSouth()},${bounds.getEast()},${bounds.getNorth()}`,
                    imageDisplay: `${size.x},${size.y},96`,
                    returnGeometry: 'true',
                    returnFieldName: 'true',
                    returnUnformattedValues: 'false'
                });

                const identifyUrl = `${CONFIG.ARCGIS_BASE_URL}${CONFIG.MAP_SERVICES[0]}/identify?${params.toString()}`;
                
                debug('Identify URL:', identifyUrl);
                
                const data = await fetchThroughProxy(identifyUrl);
                
                debug('Identify response:', data);

                if (data && data.results && data.results.length > 0) {
                    debug(`Found ${data.results.length} result(s) on layer ${layerId}`);
                    
                    const propertyData = parsePropertyData(data.results[0], lat, lng);
                    debug('Parsed property data:', propertyData);
                    
                    showPropertyPopup(propertyData);
                    hideLoading();
                    return;
                }
            }
            
            // If we get here, no results were found on any layer
            debug('No results found on any layer');
            showToast('error', 'No property found at this location');
            
            if (state.currentMarker) {
                state.map.removeLayer(state.currentMarker);
                state.currentMarker = null;
            }
            
        } catch (error) {
            debugError('Identify error:', error);
            showToast('error', `Failed to identify property: ${error.message}`);
            
            if (state.currentMarker) {
                state.map.removeLayer(state.currentMarker);
                state.currentMarker = null;
            }
        } finally {
            hideLoading();
        }
    }

    /**
     * Fetch through Cloudflare Worker proxy
     */
    async function fetchThroughProxy(url) {
        const proxyUrl = `${CONFIG.PROXY_URL}?url=${encodeURIComponent(url)}`;
        
        debug('Fetching through proxy:', proxyUrl);

        const response = await fetch(proxyUrl, {
            method: 'GET',
            headers: {
                'Accept': 'application/json'
            }
        });

        debug('Proxy response status:', response.status);

        if (!response.ok) {
            const errorText = await response.text();
            debugError('Proxy error response:', errorText);
            throw new Error(`Proxy error: ${response.status} ${response.statusText}`);
        }

        const data = await response.json();
        
        // Check if the proxy returned an error
        if (data.error === true && data.message) {
            throw new Error(data.message);
        }

        return data;
    }

    /**
     * Get safe value or N/A
     */
    function safeValue(value) {
        if (value === null || value === undefined || value === '' || value === ' ' || value === 'Null') {
            return CONFIG.NA_TEXT;
        }
        return String(value).trim();
    }

    /**
     * Check if value is N/A
     */
    function isNA(value) {
        return value === CONFIG.NA_TEXT || value === null || value === undefined || value === '';
    }

    /**
     * Parse property data from identify result
     */
    function parsePropertyData(result, lat, lng) {
        const attrs = result.attributes || {};
        
        debug('Raw attributes:', attrs);
        
        // Log all available fields for debugging
        debug('Available fields:', Object.keys(attrs));

        // Try multiple field name variations
        const getValue = (...fieldNames) => {
            for (const field of fieldNames) {
                if (attrs[field] !== undefined && attrs[field] !== null && attrs[field] !== '' && attrs[field] !== 'Null') {
                    return attrs[field];
                }
            }
            return null;
        };

        const taxlotId = getValue(
            'MAPTAXLOT', 'MapTaxlot', 'TAXLOT', 'TaxlotID', 'TAXLOT_ID',
            'MAPLOT', 'PARCEL_ID', 'PARCELID', 'APN', 'PIN'
        );

        const address = getValue(
            'SITUS', 'SITUS_ADDR', 'SITUS_ADDRESS', 'SitusAddress', 
            'ADDRESS', 'ADDR', 'PROPERTY_ADDRESS', 'SITE_ADDR',
            'LOCATION', 'STREET_ADDRESS'
        );

        const owner = getValue(
            'OWNER', 'OWNER1', 'OWNER_NAME', 'OwnerName', 'OWNERNAME',
            'OWNER_1', 'PRIMARY_OWNER', 'TAXPAYER'
        );

        const acreage = getValue(
            'ACRES', 'Acres', 'ACREAGE', 'GIS_ACRES', 'GISACRES',
            'LAND_AREA', 'AREA_ACRES', 'LOT_ACRES', 'CALC_ACRES'
        );

        const city = getValue(
            'CITY', 'City', 'SITUS_CITY', 'SITUSCITY',
            'PROP_CITY', 'PROPERTY_CITY'
        );

        const zipCode = getValue(
            'ZIPCODE', 'ZIP', 'Zip', 'ZIP_CODE', 'SITUS_ZIP',
            'SITUSZIP', 'PROP_ZIP', 'POSTAL_CODE'
        );

        const propertyId = taxlotId || `${lat.toFixed(6)}_${lng.toFixed(6)}_${Date.now()}`;

        return {
            id: propertyId,
            address: safeValue(address),
            taxlotId: safeValue(taxlotId),
            owner: safeValue(owner),
            acreage: safeValue(acreage),
            mapTaxlot: safeValue(taxlotId),
            city: safeValue(city),
            zipCode: safeValue(zipCode),
            lat: lat,
            lng: lng,
            layerId: result.layerId,
            layerName: result.layerName,
            rawAttributes: attrs,
            savedAt: null
        };
    }

    /* ============================================
       SEARCH FUNCTIONS
       ============================================ */

    function switchSearchTab(searchType) {
        state.currentSearchType = searchType;

        elements.searchTabs.forEach(tab => {
            tab.classList.toggle('active', tab.dataset.searchType === searchType);
        });

        elements.searchInputGroups.forEach(group => {
            const isActive = group.id === `search-${searchType}`;
            group.classList.toggle('active', isActive);
        });

        hideSearchResults();
    }

    function toggleClearButton(inputType) {
        const input = elements[`input${capitalize(inputType)}`];
        const clearBtn = elements[`btnClear${capitalize(inputType)}`];
        
        if (input && clearBtn) {
            clearBtn.classList.toggle('hidden', input.value.length === 0);
        }
    }

    function clearSearchInput(inputType) {
        const input = elements[`input${capitalize(inputType)}`];
        const clearBtn = elements[`btnClear${capitalize(inputType)}`];
        
        if (input) {
            input.value = '';
            input.focus();
        }
        if (clearBtn) {
            clearBtn.classList.add('hidden');
        }
        
        hideSearchResults();
    }

    async function performSearch(searchType) {
        let searchValue = '';
        let whereClause = '';

        switch (searchType) {
            case 'address':
                searchValue = elements.inputAddress.value.trim();
                if (!searchValue) {
                    showToast('error', 'Please enter an address');
                    return;
                }
                whereClause = `UPPER(SITUS) LIKE UPPER('%${escapeSQL(searchValue)}%')`;
                break;

            case 'taxlot':
                searchValue = elements.inputTaxlot.value.trim();
                if (!searchValue) {
                    showToast('error', 'Please enter a tax lot ID');
                    return;
                }
                whereClause = `MAPTAXLOT LIKE '%${escapeSQL(searchValue)}%'`;
                break;

            case 'owner':
                searchValue = elements.inputOwner.value.trim();
                if (!searchValue) {
                    showToast('error', 'Please enter an owner name');
                    return;
                }
                whereClause = `UPPER(OWNER) LIKE UPPER('%${escapeSQL(searchValue)}%')`;
                break;

            case 'coordinates':
                const lat = parseFloat(elements.inputLat.value.trim());
                const lng = parseFloat(elements.inputLng.value.trim());
                
                if (isNaN(lat) || isNaN(lng)) {
                    showToast('error', 'Please enter valid coordinates');
                    return;
                }

                state.map.setView([lat, lng], 17);
                
                if (state.currentMarker) {
                    state.map.removeLayer(state.currentMarker);
                }
                state.currentMarker = L.marker([lat, lng], {
                    icon: createCustomIcon()
                }).addTo(state.map);

                await identifyProperty(lat, lng);
                return;

            default:
                return;
        }

        showSearchLoading();

        try {
            const params = new URLSearchParams({
                where: whereClause,
                outFields: '*',
                returnGeometry: 'true',
                outSR: '4326',
                f: 'json',
                resultRecordCount: CONFIG.MAX_SEARCH_RESULTS.toString()
            });

            const queryUrl = `${CONFIG.ARCGIS_BASE_URL}${CONFIG.MAP_SERVICES[0]}/0/query?${params.toString()}`;
            
            debug('Query URL:', queryUrl);
            
            const data = await fetchThroughProxy(queryUrl);
            
            debug('Query response:', data);

            if (data && data.features && data.features.length > 0) {
                displaySearchResults(data.features, searchType);
            } else {
                showSearchEmpty();
            }
        } catch (error) {
            debugError('Search error:', error);
            showToast('error', `Search failed: ${error.message}`);
            hideSearchResults();
        }
    }

    function displaySearchResults(features, searchType) {
        elements.resultsList.innerHTML = '';
        state.searchResults = [];

        const limitedFeatures = features.slice(0, CONFIG.MAX_SEARCH_RESULTS);

        limitedFeatures.forEach((feature, index) => {
            const attrs = feature.attributes || {};
            const geometry = feature.geometry;

            let lat = null;
            let lng = null;
            
            if (geometry) {
                if (geometry.rings && geometry.rings[0]) {
                    const ring = geometry.rings[0];
                    let sumX = 0, sumY = 0;
                    ring.forEach(coord => {
                        sumX += coord[0];
                        sumY += coord[1];
                    });
                    lng = sumX / ring.length;
                    lat = sumY / ring.length;
                } else if (geometry.x !== undefined && geometry.y !== undefined) {
                    lng = geometry.x;
                    lat = geometry.y;
                }
            }

            const propertyData = {
                id: safeValue(attrs.MAPTAXLOT || attrs.TAXLOT || `result_${index}`),
                address: safeValue(attrs.SITUS || attrs.ADDRESS),
                taxlotId: safeValue(attrs.MAPTAXLOT || attrs.TAXLOT),
                owner: safeValue(attrs.OWNER || attrs.OWNER1),
                acreage: safeValue(attrs.ACRES || attrs.ACREAGE),
                mapTaxlot: safeValue(attrs.MAPTAXLOT),
                city: safeValue(attrs.CITY),
                zipCode: safeValue(attrs.ZIPCODE || attrs.ZIP),
                lat: lat,
                lng: lng,
                rawAttributes: attrs
            };

            state.searchResults.push(propertyData);

            const template = elements.searchResultTemplate.content.cloneNode(true);
            const resultItem = template.querySelector('.result-item');

            resultItem.dataset.index = index;
            resultItem.querySelector('.result-title').textContent = propertyData.address;
            resultItem.querySelector('.result-subtitle').textContent = `Tax Lot: ${propertyData.taxlotId}`;
            resultItem.addEventListener('click', () => selectSearchResult(index));

            elements.resultsList.appendChild(resultItem);
        });

        elements.resultsCount.textContent = `${limitedFeatures.length} result${limitedFeatures.length !== 1 ? 's' : ''} found`;
        elements.searchResults.classList.remove('hidden');
        elements.resultsEmpty.classList.add('hidden');
        elements.resultsLoading.classList.add('hidden');
        elements.resultsList.classList.remove('hidden');
    }

    async function selectSearchResult(index) {
        const property = state.searchResults[index];
        if (!property || !property.lat || !property.lng) {
            showToast('error', 'Unable to locate property');
            return;
        }

        hideSearchResults();
        state.map.setView([property.lat, property.lng], 17);

        if (state.currentMarker) {
            state.map.removeLayer(state.currentMarker);
        }
        state.currentMarker = L.marker([property.lat, property.lng], {
            icon: createCustomIcon()
        }).addTo(state.map);

        property.savedAt = null;
        showPropertyPopup(property);
    }

    function showSearchLoading() {
        elements.searchResults.classList.remove('hidden');
        elements.resultsLoading.classList.remove('hidden');
        elements.resultsList.classList.add('hidden');
        elements.resultsEmpty.classList.add('hidden');
    }

    function showSearchEmpty() {
        elements.searchResults.classList.remove('hidden');
        elements.resultsEmpty.classList.remove('hidden');
        elements.resultsList.classList.add('hidden');
        elements.resultsLoading.classList.add('hidden');
    }

    function hideSearchResults() {
        elements.searchResults.classList.add('hidden');
    }

    function escapeSQL(str) {
        return str.replace(/'/g, "''").replace(/[%_]/g, '');
    }

    /* ============================================
       POPUP FUNCTIONS
       ============================================ */

    function showPropertyPopup(propertyData) {
        const template = elements.popupTemplate.content.cloneNode(true);
        const popupElement = template.querySelector('.property-popup');

        setPopupValue(popupElement, '.property-address', propertyData.address);
        setPopupValue(popupElement, '.taxlot-id', propertyData.taxlotId);
        setPopupValue(popupElement, '.owner-name', propertyData.owner);
        setPopupValue(popupElement, '.acreage', formatAcreage(propertyData.acreage));
        setPopupValue(popupElement, '.map-taxlot', propertyData.mapTaxlot);
        setPopupValue(popupElement, '.city', propertyData.city);
        setPopupValue(popupElement, '.zipcode', propertyData.zipCode);

        const saveBtn = popupElement.querySelector('.btn-save-property');
        const zoomBtn = popupElement.querySelector('.btn-zoom-to');

        const isAlreadySaved = state.savedProperties.some(p => p.id === propertyData.id);
        if (isAlreadySaved) {
            saveBtn.innerHTML = '<i class="fas fa-check"></i><span>Saved</span>';
            saveBtn.classList.add('saved');
            saveBtn.disabled = true;
        }

        const popupContent = document.createElement('div');
        popupContent.appendChild(popupElement);

        if (state.currentPopup) {
            state.map.closePopup(state.currentPopup);
        }

        state.currentPopup = L.popup({
            maxWidth: 350,
            className: 'custom-popup'
        })
        .setLatLng([propertyData.lat, propertyData.lng])
        .setContent(popupContent.innerHTML)
        .openOn(state.map);

        setTimeout(() => {
            const popupContainer = document.querySelector('.leaflet-popup-content');
            if (popupContainer) {
                const newSaveBtn = popupContainer.querySelector('.btn-save-property');
                const newZoomBtn = popupContainer.querySelector('.btn-zoom-to');

                if (newSaveBtn && !isAlreadySaved) {
                    newSaveBtn.addEventListener('click', () => {
                        saveProperty(propertyData);
                        newSaveBtn.innerHTML = '<i class="fas fa-check"></i><span>Saved</span>';
                        newSaveBtn.classList.add('saved');
                        newSaveBtn.disabled = true;
                    });
                }

                if (newZoomBtn) {
                    newZoomBtn.addEventListener('click', () => {
                        state.map.setView([propertyData.lat, propertyData.lng], 18);
                    });
                }
            }
        }, 100);
    }

    function setPopupValue(container, selector, value) {
        const element = container.querySelector(selector);
        if (element) {
            element.textContent = value;
            if (isNA(value)) {
                element.classList.add('na');
            }
        }
    }

    /* ============================================
       SAVE & MANAGE PROPERTIES
       ============================================ */

    function saveProperty(propertyData) {
        if (state.savedProperties.some(p => p.id === propertyData.id)) {
            showToast('error', 'Property already saved');
            return;
        }

        propertyData.savedAt = new Date().toISOString();
        state.savedProperties.push(propertyData);
        persistSavedProperties();
        addPropertyCard(propertyData);
        updateUI();
        showToast('success', 'Property saved');
    }

    function addPropertyCard(propertyData) {
        elements.emptyState.classList.add('hidden');

        const template = elements.propertyCardTemplate.content.cloneNode(true);
        const card = template.querySelector('.property-card');

        card.dataset.propertyId = propertyData.id;

        const addressEl = card.querySelector('.card-address');
        addressEl.textContent = truncateText(propertyData.address, 30);
        if (isNA(propertyData.address)) addressEl.classList.add('na');

        const taxlotEl = card.querySelector('.card-taxlot');
        taxlotEl.textContent = `Tax Lot: ${propertyData.taxlotId}`;
        if (isNA(propertyData.taxlotId)) taxlotEl.classList.add('na');

        const acreageEl = card.querySelector('.card-acreage');
        acreageEl.textContent = `Acreage: ${formatAcreage(propertyData.acreage)}`;
        if (isNA(propertyData.acreage)) acreageEl.classList.add('na');

        const ownerEl = card.querySelector('.card-owner');
        ownerEl.textContent = truncateText(propertyData.owner, 25);
        if (isNA(propertyData.owner)) ownerEl.classList.add('na');

        const checkbox = card.querySelector('.property-checkbox');
        checkbox.addEventListener('change', (e) => {
            handlePropertySelect(propertyData.id, e.target.checked);
            card.classList.toggle('selected', e.target.checked);
        });

        card.querySelector('.btn-remove-property').addEventListener('click', () => removeProperty(propertyData.id));
        card.querySelector('.btn-zoom-to-saved').addEventListener('click', () => zoomToProperty(propertyData));

        elements.savedPropertiesList.appendChild(card);
    }

    function removeProperty(propertyId) {
        state.savedProperties = state.savedProperties.filter(p => p.id !== propertyId);
        state.selectedPropertyIds.delete(propertyId);

        const card = elements.savedPropertiesList.querySelector(`[data-property-id="${propertyId}"]`);
        if (card) {
            card.remove();
        }

        persistSavedProperties();
        updateUI();
    }

    function handlePropertySelect(propertyId, isSelected) {
        if (isSelected) {
            state.selectedPropertyIds.add(propertyId);
        } else {
            state.selectedPropertyIds.delete(propertyId);
        }
        updateSelectAllCheckbox();
        updateExportButtons();
    }

    function handleSelectAll() {
        const isChecked = elements.selectAllCheckbox.checked;

        state.savedProperties.forEach(property => {
            if (isChecked) {
                state.selectedPropertyIds.add(property.id);
            } else {
                state.selectedPropertyIds.delete(property.id);
            }
        });

        const cards = elements.savedPropertiesList.querySelectorAll('.property-card');
        cards.forEach(card => {
            const checkbox = card.querySelector('.property-checkbox');
            checkbox.checked = isChecked;
            card.classList.toggle('selected', isChecked);
        });

        updateExportButtons();
    }

    function updateSelectAllCheckbox() {
        const total = state.savedProperties.length;
        const selected = state.selectedPropertyIds.size;
        elements.selectAllCheckbox.checked = total > 0 && selected === total;
        elements.selectAllCheckbox.indeterminate = selected > 0 && selected < total;
    }

    function zoomToProperty(propertyData) {
        state.map.setView([propertyData.lat, propertyData.lng], 18);

        if (state.currentMarker) {
            state.map.removeLayer(state.currentMarker);
        }
        state.currentMarker = L.marker([propertyData.lat, propertyData.lng], {
            icon: createCustomIcon()
        }).addTo(state.map);

        showPropertyPopup(propertyData);
    }

    /* ============================================
       EXPORT FUNCTIONS
       ============================================ */

    function exportAllProperties() {
        if (state.savedProperties.length === 0) {
            showToast('error', 'No properties to export');
            return;
        }
        const content = generateExportContent(state.savedProperties);
        downloadTextFile(content, 'lane_county_properties_all.txt');
        showToast('success', `Exported ${state.savedProperties.length} properties`);
    }

    function exportSelectedProperties() {
        if (state.selectedPropertyIds.size === 0) {
            showToast('error', 'No properties selected');
            return;
        }
        const selected = state.savedProperties.filter(p => state.selectedPropertyIds.has(p.id));
        const content = generateExportContent(selected);
        downloadTextFile(content, 'lane_county_properties_selected.txt');
        showToast('success', `Exported ${selected.length} properties`);
    }

    function generateExportContent(properties) {
        const header = `
================================================================================
LANE COUNTY PROPERTY EXPORT
Generated: ${new Date().toLocaleString()}
Total: ${properties.length} properties
================================================================================

`;
        const body = properties.map((p, i) => `
Property #${i + 1}
--------------------------------------------------------------------------------
Address:     ${p.address}
Tax Lot:     ${p.taxlotId}
Owner:       ${p.owner}
Acreage:     ${formatAcreage(p.acreage)}
City:        ${p.city}
Zip:         ${p.zipCode}
Coordinates: ${p.lat.toFixed(6)}, ${p.lng.toFixed(6)}
Saved:       ${p.savedAt ? new Date(p.savedAt).toLocaleString() : 'N/A'}
`).join('\n');

        return header + body + '\n================================================================================\n';
    }

    function downloadTextFile(content, filename) {
        const blob = new Blob([content], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.click();
        URL.revokeObjectURL(url);
    }

    /* ============================================
       CLEAR ALL
       ============================================ */

    function confirmClearAll() {
        elements.confirmMessage.textContent = `Remove all ${state.savedProperties.length} saved properties?`;
        
        const handler = () => {
            clearAllProperties();
            hideModal();
            elements.btnConfirmOk.removeEventListener('click', handler);
        };
        
        elements.btnConfirmOk.addEventListener('click', handler);
        showModal();
    }

    function clearAllProperties() {
        state.savedProperties = [];
        state.selectedPropertyIds.clear();
        
        const cards = elements.savedPropertiesList.querySelectorAll('.property-card');
        cards.forEach(card => card.remove());
        
        persistSavedProperties();
        updateUI();
        showToast('success', 'All properties cleared');
    }

    /* ============================================
       SIDEBAR
       ============================================ */

    function toggleSidebar() {
        state.isSidebarCollapsed = !state.isSidebarCollapsed;
        elements.sidebar.classList.toggle('collapsed', state.isSidebarCollapsed);
        setTimeout(() => state.map.invalidateSize(), 300);
    }

    /* ============================================
       PERSISTENCE
       ============================================ */

    function loadSavedProperties() {
        try {
            const stored = localStorage.getItem(CONFIG.STORAGE_KEY);
            if (stored) {
                state.savedProperties = JSON.parse(stored);
                state.savedProperties.forEach(p => addPropertyCard(p));
            }
        } catch (e) {
            state.savedProperties = [];
        }
    }

    function persistSavedProperties() {
        localStorage.setItem(CONFIG.STORAGE_KEY, JSON.stringify(state.savedProperties));
    }

    /* ============================================
       UI UPDATES
       ============================================ */

    function updateUI() {
        updatePropertyCount();
        updateExportButtons();
        updateEmptyState();
        updateSelectAllCheckbox();
        updateSavedBadge();
    }

    function updatePropertyCount() {
        const count = state.savedProperties.length;
        elements.propertyCount.textContent = `${count} ${count === 1 ? 'property' : 'properties'}`;
    }

    function updateSavedBadge() {
        const count = state.savedProperties.length;
        if (count > 0) {
            elements.savedBadge.textContent = count > 99 ? '99+' : count;
            elements.savedBadge.classList.remove('hidden');
        } else {
            elements.savedBadge.classList.add('hidden');
        }
    }

    function updateExportButtons() {
        elements.btnExportAll.disabled = state.savedProperties.length === 0;
        elements.btnExportSelected.disabled = state.selectedPropertyIds.size === 0;
        elements.btnClearAll.disabled = state.savedProperties.length === 0;
    }

    function updateEmptyState() {
        elements.emptyState.classList.toggle('hidden', state.savedProperties.length > 0);
    }

    /* ============================================
       LOADING & TOASTS
       ============================================ */

    function showLoading() {
        elements.loadingOverlay.classList.remove('hidden');
    }

    function hideLoading() {
        elements.loadingOverlay.classList.add('hidden');
    }

    function showToast(type, message) {
        const toast = type === 'error' ? elements.errorToast : elements.successToast;
        const msgEl = type === 'error' ? elements.errorMessage : elements.successMessage;
        
        msgEl.textContent = message;
        toast.classList.remove('hidden');
        
        setTimeout(() => hideToast(type), CONFIG.TOAST_DURATION);
    }

    function hideToast(type) {
        const toast = type === 'error' ? elements.errorToast : elements.successToast;
        toast.classList.add('hidden');
    }

    function showModal() {
        elements.confirmModal.classList.remove('hidden');
    }

    function hideModal() {
        elements.confirmModal.classList.add('hidden');
    }

    /* ============================================
       UTILITIES
       ============================================ */

    function formatAcreage(value) {
        if (isNA(value)) return CONFIG.NA_TEXT;
        const num = parseFloat(value);
        return isNaN(num) ? CONFIG.NA_TEXT : `${num.toFixed(2)} acres`;
    }

    function truncateText(text, max) {
        if (isNA(text)) return CONFIG.NA_TEXT;
        return text.length > max ? text.substring(0, max - 3) + '...' : text;
    }

    function capitalize(str) {
        return str.charAt(0).toUpperCase() + str.slice(1);
    }

    /* ============================================
       INIT
       ============================================ */
    
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

})();