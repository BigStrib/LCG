/* ============================================
   LANE COUNTY GIS PROPERTY EXPLORER
   Main Application Script
   ============================================ */

(function() {
    'use strict';

    /* ============================================
       CONFIGURATION
       ============================================ */
    const CONFIG = {
        // Cloudflare Worker Proxy URL - Replace with your deployed worker URL
        PROXY_URL: 'https://lane-cors.blakebigstrib.workers.dev',
        
        // Lane County ArcGIS REST Services Base URL
        ARCGIS_BASE_URL: 'https://lcmaps.lanecounty.org/arcgis/rest/services',
        
        // Primary map service for property identification
        MAP_SERVICE: '/Taxlots/MapServer',
        
        // Layer index for taxlots (adjust based on actual service)
        TAXLOT_LAYER_ID: 0,
        
        // Default map center (Lane County, Oregon - Eugene area)
        DEFAULT_CENTER: [44.0521, -123.0868],
        DEFAULT_ZOOM: 12,
        MIN_ZOOM: 8,
        MAX_ZOOM: 19,
        
        // Identify tolerance in pixels
        IDENTIFY_TOLERANCE: 5,
        
        // Search settings
        MAX_SEARCH_RESULTS: 50,
        SEARCH_DEBOUNCE_MS: 300,
        
        // Toast notification duration (ms)
        TOAST_DURATION: 4000,
        
        // LocalStorage key for saved properties
        STORAGE_KEY: 'laneCountyGIS_savedProperties',
        
        // Default N/A text
        NA_TEXT: 'N/A'
    };

    /* ============================================
       BASEMAP CONFIGURATIONS
       ============================================ */
    const BASEMAPS = {
        street: {
            url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
            options: {
                attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
                maxZoom: 19
            }
        },
        satellite: {
            url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
            options: {
                attribution: '&copy; <a href="https://www.esri.com/">Esri</a> | Earthstar Geographics',
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
        searchResults: [],
        searchDebounceTimer: null
    };

    /* ============================================
       DOM ELEMENT REFERENCES
       ============================================ */
    const elements = {};

    /* ============================================
       INITIALIZATION
       ============================================ */
    function init() {
        cacheElements();
        loadSavedProperties();
        initMap();
        initBasemaps();
        bindEvents();
        bindSearchEvents();
        updateUI();
        
        console.log('Lane County GIS Property Explorer initialized');
    }

    /**
     * Cache DOM element references for performance
     */
    function cacheElements() {
        // Map
        elements.map = document.getElementById('map');
        
        // Sidebar
        elements.sidebar = document.getElementById('sidebar');
        elements.sidebarToggle = document.getElementById('sidebar-toggle');
        elements.sidebarExpandBtn = document.getElementById('sidebar-expand-btn');
        elements.savedPropertiesList = document.getElementById('saved-properties-list');
        elements.emptyState = document.getElementById('empty-state');
        elements.propertyCount = document.getElementById('property-count');
        elements.savedBadge = document.getElementById('saved-badge');
        
        // Buttons
        elements.btnExportAll = document.getElementById('btn-export-all');
        elements.btnExportSelected = document.getElementById('btn-export-selected');
        elements.btnClearAll = document.getElementById('btn-clear-all');
        elements.btnStreetView = document.getElementById('btn-street-view');
        elements.btnSatelliteView = document.getElementById('btn-satellite-view');
        elements.btnMyLocation = document.getElementById('btn-my-location');
        elements.btnResetView = document.getElementById('btn-reset-view');
        
        // Checkboxes
        elements.selectAllCheckbox = document.getElementById('select-all-checkbox');
        
        // Search Elements
        elements.searchPanel = document.getElementById('search-panel');
        elements.searchTabs = document.querySelectorAll('.search-tab');
        elements.searchInputGroups = document.querySelectorAll('.search-input-group');
        
        // Search Inputs
        elements.inputAddress = document.getElementById('input-address');
        elements.inputTaxlot = document.getElementById('input-taxlot');
        elements.inputOwner = document.getElementById('input-owner');
        elements.inputLat = document.getElementById('input-lat');
        elements.inputLng = document.getElementById('input-lng');
        
        // Search Buttons
        elements.btnSearchAddress = document.getElementById('btn-search-address');
        elements.btnSearchTaxlot = document.getElementById('btn-search-taxlot');
        elements.btnSearchOwner = document.getElementById('btn-search-owner');
        elements.btnSearchCoords = document.getElementById('btn-search-coords');
        
        // Clear Buttons
        elements.btnClearAddress = document.getElementById('btn-clear-address');
        elements.btnClearTaxlot = document.getElementById('btn-clear-taxlot');
        elements.btnClearOwner = document.getElementById('btn-clear-owner');
        
        // Search Results
        elements.searchResults = document.getElementById('search-results');
        elements.resultsList = document.getElementById('results-list');
        elements.resultsCount = document.getElementById('results-count');
        elements.resultsEmpty = document.getElementById('results-empty');
        elements.resultsLoading = document.getElementById('results-loading');
        elements.btnCloseResults = document.getElementById('btn-close-results');
        
        // Overlays & Toasts
        elements.loadingOverlay = document.getElementById('loading-overlay');
        elements.errorToast = document.getElementById('error-toast');
        elements.successToast = document.getElementById('success-toast');
        elements.errorMessage = document.getElementById('error-message');
        elements.successMessage = document.getElementById('success-message');
        elements.toastClose = document.getElementById('toast-close');
        
        // Coordinates
        elements.coordsText = document.getElementById('coords-text');
        
        // Modal
        elements.confirmModal = document.getElementById('confirm-modal');
        elements.confirmMessage = document.getElementById('confirm-message');
        elements.btnConfirmOk = document.getElementById('btn-confirm-ok');
        elements.btnConfirmCancel = document.getElementById('btn-confirm-cancel');
        
        // Templates
        elements.popupTemplate = document.getElementById('popup-template');
        elements.propertyCardTemplate = document.getElementById('property-card-template');
        elements.searchResultTemplate = document.getElementById('search-result-template');
    }

    /**
     * Initialize Leaflet map
     */
    function initMap() {
        state.map = L.map('map', {
            center: CONFIG.DEFAULT_CENTER,
            zoom: CONFIG.DEFAULT_ZOOM,
            minZoom: CONFIG.MIN_ZOOM,
            maxZoom: CONFIG.MAX_ZOOM,
            zoomControl: true
        });

        // Move zoom control to bottom-right
        state.map.zoomControl.setPosition('bottomright');

        // Bind map events
        state.map.on('click', handleMapClick);
        state.map.on('mousemove', handleMapMouseMove);
    }

    /**
     * Initialize basemap layers
     */
    function initBasemaps() {
        // Create street basemap layer
        state.basemapLayers.street = L.tileLayer(
            BASEMAPS.street.url,
            BASEMAPS.street.options
        );

        // Create satellite basemap layer
        state.basemapLayers.satellite = L.tileLayer(
            BASEMAPS.satellite.url,
            BASEMAPS.satellite.options
        );

        // Add default basemap to map
        state.basemapLayers[state.currentBasemap].addTo(state.map);
    }

    /**
     * Bind all event listeners
     */
    function bindEvents() {
        // Basemap toggles
        elements.btnStreetView.addEventListener('click', () => switchBasemap('street'));
        elements.btnSatelliteView.addEventListener('click', () => switchBasemap('satellite'));

        // Map action buttons
        elements.btnMyLocation.addEventListener('click', goToMyLocation);
        elements.btnResetView.addEventListener('click', resetMapView);

        // Sidebar toggle
        elements.sidebarToggle.addEventListener('click', toggleSidebar);
        elements.sidebarExpandBtn.addEventListener('click', toggleSidebar);

        // Export and clear buttons
        elements.btnExportAll.addEventListener('click', exportAllProperties);
        elements.btnExportSelected.addEventListener('click', exportSelectedProperties);
        elements.btnClearAll.addEventListener('click', confirmClearAll);

        // Select all checkbox
        elements.selectAllCheckbox.addEventListener('change', handleSelectAll);

        // Toast close button
        elements.toastClose.addEventListener('click', () => hideToast('error'));

        // Modal buttons
        elements.btnConfirmCancel.addEventListener('click', hideModal);
        elements.confirmModal.querySelector('.modal-backdrop').addEventListener('click', hideModal);
    }

    /**
     * Bind search-related event listeners
     */
    function bindSearchEvents() {
        // Search tabs
        elements.searchTabs.forEach(tab => {
            tab.addEventListener('click', () => switchSearchTab(tab.dataset.searchType));
        });

        // Search buttons
        elements.btnSearchAddress.addEventListener('click', () => performSearch('address'));
        elements.btnSearchTaxlot.addEventListener('click', () => performSearch('taxlot'));
        elements.btnSearchOwner.addEventListener('click', () => performSearch('owner'));
        elements.btnSearchCoords.addEventListener('click', () => performSearch('coordinates'));

        // Enter key on inputs
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

        // Clear buttons
        elements.btnClearAddress.addEventListener('click', () => clearSearchInput('address'));
        elements.btnClearTaxlot.addEventListener('click', () => clearSearchInput('taxlot'));
        elements.btnClearOwner.addEventListener('click', () => clearSearchInput('owner'));

        // Input change for clear button visibility
        elements.inputAddress.addEventListener('input', () => toggleClearButton('address'));
        elements.inputTaxlot.addEventListener('input', () => toggleClearButton('taxlot'));
        elements.inputOwner.addEventListener('input', () => toggleClearButton('owner'));

        // Close results button
        elements.btnCloseResults.addEventListener('click', hideSearchResults);

        // Click outside to close results
        document.addEventListener('click', (e) => {
            if (!elements.searchPanel.contains(e.target)) {
                hideSearchResults();
            }
        });
    }

    /* ============================================
       MAP INTERACTION HANDLERS
       ============================================ */
    
    /**
     * Handle map click event
     * @param {L.LeafletMouseEvent} e - Leaflet mouse event
     */
    async function handleMapClick(e) {
        const { lat, lng } = e.latlng;
        
        // Remove existing marker if present
        if (state.currentMarker) {
            state.map.removeLayer(state.currentMarker);
        }

        // Add click marker
        state.currentMarker = L.marker([lat, lng], {
            icon: createCustomIcon()
        }).addTo(state.map);

        // Query property data
        await identifyProperty(lat, lng);
    }

    /**
     * Handle map mouse move for coordinate display
     * @param {L.LeafletMouseEvent} e - Leaflet mouse event
     */
    function handleMapMouseMove(e) {
        const { lat, lng } = e.latlng;
        elements.coordsText.textContent = `Lat: ${lat.toFixed(6)}, Lng: ${lng.toFixed(6)}`;
    }

    /**
     * Create custom marker icon
     * @returns {L.DivIcon} Custom Leaflet div icon
     */
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

    /**
     * Go to user's current location
     */
    function goToMyLocation() {
        if (!navigator.geolocation) {
            showToast('error', 'Geolocation is not supported by your browser');
            return;
        }

        showLoading();

        navigator.geolocation.getCurrentPosition(
            (position) => {
                const { latitude, longitude } = position.coords;
                state.map.setView([latitude, longitude], 16);
                
                // Add marker at location
                if (state.currentMarker) {
                    state.map.removeLayer(state.currentMarker);
                }
                state.currentMarker = L.marker([latitude, longitude], {
                    icon: createCustomIcon()
                }).addTo(state.map);

                hideLoading();
                showToast('success', 'Moved to your location');

                // Identify property at location
                identifyProperty(latitude, longitude);
            },
            (error) => {
                hideLoading();
                let message = 'Unable to get your location';
                switch (error.code) {
                    case error.PERMISSION_DENIED:
                        message = 'Location access denied by user';
                        break;
                    case error.POSITION_UNAVAILABLE:
                        message = 'Location information unavailable';
                        break;
                    case error.TIMEOUT:
                        message = 'Location request timed out';
                        break;
                }
                showToast('error', message);
            },
            {
                enableHighAccuracy: true,
                timeout: 10000,
                maximumAge: 0
            }
        );
    }

    /**
     * Reset map to default view
     */
    function resetMapView() {
        state.map.setView(CONFIG.DEFAULT_CENTER, CONFIG.DEFAULT_ZOOM);
        
        // Remove current marker
        if (state.currentMarker) {
            state.map.removeLayer(state.currentMarker);
            state.currentMarker = null;
        }

        // Close popup
        if (state.currentPopup) {
            state.map.closePopup(state.currentPopup);
            state.currentPopup = null;
        }

        showToast('success', 'Map view reset');
    }

    /* ============================================
       BASEMAP FUNCTIONS
       ============================================ */

    /**
     * Switch between basemap layers
     * @param {string} basemapType - 'street' or 'satellite'
     */
    function switchBasemap(basemapType) {
        if (basemapType === state.currentBasemap) return;

        // Remove current basemap
        state.map.removeLayer(state.basemapLayers[state.currentBasemap]);

        // Add new basemap
        state.basemapLayers[basemapType].addTo(state.map);
        state.currentBasemap = basemapType;

        // Update button states
        elements.btnStreetView.classList.toggle('active', basemapType === 'street');
        elements.btnSatelliteView.classList.toggle('active', basemapType === 'satellite');
    }

    /* ============================================
       SEARCH FUNCTIONS
       ============================================ */

    /**
     * Switch active search tab
     * @param {string} searchType - Type of search
     */
    function switchSearchTab(searchType) {
        state.currentSearchType = searchType;

        // Update tab styles
        elements.searchTabs.forEach(tab => {
            tab.classList.toggle('active', tab.dataset.searchType === searchType);
        });

        // Show/hide input groups
        elements.searchInputGroups.forEach(group => {
            const isActive = group.id === `search-${searchType}`;
            group.classList.toggle('active', isActive);
        });

        // Hide results when switching tabs
        hideSearchResults();
    }

    /**
     * Toggle clear button visibility
     * @param {string} inputType - Input type
     */
    function toggleClearButton(inputType) {
        const input = elements[`input${capitalize(inputType)}`];
        const clearBtn = elements[`btnClear${capitalize(inputType)}`];
        
        if (input && clearBtn) {
            clearBtn.classList.toggle('hidden', input.value.length === 0);
        }
    }

    /**
     * Clear search input
     * @param {string} inputType - Input type
     */
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

    /**
     * Perform search based on type
     * @param {string} searchType - Type of search
     */
    async function performSearch(searchType) {
        let searchValue = '';
        let searchParams = {};

        switch (searchType) {
            case 'address':
                searchValue = elements.inputAddress.value.trim();
                if (!searchValue) {
                    showToast('error', 'Please enter an address to search');
                    return;
                }
                searchParams = {
                    where: `UPPER(SITUS) LIKE UPPER('%${escapeSQL(searchValue)}%') OR UPPER(SITUS_ADDR) LIKE UPPER('%${escapeSQL(searchValue)}%')`,
                    outFields: '*',
                    returnGeometry: true,
                    f: 'json'
                };
                break;

            case 'taxlot':
                searchValue = elements.inputTaxlot.value.trim();
                if (!searchValue) {
                    showToast('error', 'Please enter a tax lot ID to search');
                    return;
                }
                searchParams = {
                    where: `MAPTAXLOT LIKE '%${escapeSQL(searchValue)}%' OR TAXLOT LIKE '%${escapeSQL(searchValue)}%'`,
                    outFields: '*',
                    returnGeometry: true,
                    f: 'json'
                };
                break;

            case 'owner':
                searchValue = elements.inputOwner.value.trim();
                if (!searchValue) {
                    showToast('error', 'Please enter an owner name to search');
                    return;
                }
                searchParams = {
                    where: `UPPER(OWNER) LIKE UPPER('%${escapeSQL(searchValue)}%') OR UPPER(OWNER1) LIKE UPPER('%${escapeSQL(searchValue)}%')`,
                    outFields: '*',
                    returnGeometry: true,
                    f: 'json'
                };
                break;

            case 'coordinates':
                const lat = parseFloat(elements.inputLat.value.trim());
                const lng = parseFloat(elements.inputLng.value.trim());
                
                if (isNaN(lat) || isNaN(lng)) {
                    showToast('error', 'Please enter valid coordinates');
                    return;
                }
                
                if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
                    showToast('error', 'Coordinates out of valid range');
                    return;
                }

                // For coordinates, just zoom and identify
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
                showToast('error', 'Invalid search type');
                return;
        }

        // Show loading in results
        showSearchLoading();

        try {
            const queryUrl = `${CONFIG.ARCGIS_BASE_URL}${CONFIG.MAP_SERVICE}/${CONFIG.TAXLOT_LAYER_ID}/query`;
            const data = await fetchThroughProxy(queryUrl, searchParams);

            if (data && data.features && data.features.length > 0) {
                displaySearchResults(data.features, searchType);
            } else {
                showSearchEmpty();
            }
        } catch (error) {
            console.error('Search error:', error);
            showToast('error', `Search failed: ${error.message}`);
            hideSearchResults();
        }
    }

    /**
     * Display search results
     * @param {Array} features - Array of feature results
     * @param {string} searchType - Type of search performed
     */
    function displaySearchResults(features, searchType) {
        // Clear previous results
        elements.resultsList.innerHTML = '';
        state.searchResults = [];

        // Limit results
        const limitedFeatures = features.slice(0, CONFIG.MAX_SEARCH_RESULTS);

        limitedFeatures.forEach((feature, index) => {
            const attrs = feature.attributes || {};
            const geometry = feature.geometry;

            // Calculate centroid if geometry exists
            let lat = null;
            let lng = null;
            if (geometry) {
                if (geometry.rings) {
                    // Polygon - calculate centroid
                    const centroid = calculatePolygonCentroid(geometry.rings[0]);
                    lat = centroid.lat;
                    lng = centroid.lng;
                } else if (geometry.x && geometry.y) {
                    // Point
                    lat = geometry.y;
                    lng = geometry.x;
                }
            }

            // Parse property data
            const propertyData = {
                id: safeValue(attrs.MAPTAXLOT || attrs.MapTaxlot || attrs.TAXLOT || `result_${index}`),
                address: safeValue(attrs.SITUS || attrs.SITUS_ADDR || attrs.ADDRESS),
                taxlotId: safeValue(attrs.MAPTAXLOT || attrs.MapTaxlot || attrs.TAXLOT),
                owner: safeValue(attrs.OWNER || attrs.OWNER1 || attrs.OwnerName),
                acreage: safeValue(attrs.ACRES || attrs.Acres || attrs.ACREAGE || attrs.GIS_ACRES),
                mapTaxlot: safeValue(attrs.MAPTAXLOT || attrs.MapTaxlot),
                city: safeValue(attrs.CITY || attrs.City || attrs.SITUS_CITY),
                zipCode: safeValue(attrs.ZIPCODE || attrs.ZIP || attrs.Zip),
                lat: lat,
                lng: lng,
                rawAttributes: attrs
            };

            state.searchResults.push(propertyData);

            // Create result item
            const template = elements.searchResultTemplate.content.cloneNode(true);
            const resultItem = template.querySelector('.result-item');

            resultItem.dataset.index = index;
            resultItem.dataset.lat = lat || '';
            resultItem.dataset.lng = lng || '';

            // Set content
            resultItem.querySelector('.result-title').textContent = propertyData.address;
            resultItem.querySelector('.result-subtitle').textContent = `Tax Lot: ${propertyData.taxlotId}`;

            // Bind click event
            resultItem.addEventListener('click', () => selectSearchResult(index));

            elements.resultsList.appendChild(resultItem);
        });

        // Update count
        const totalCount = features.length;
        const displayedCount = limitedFeatures.length;
        elements.resultsCount.textContent = totalCount > displayedCount 
            ? `Showing ${displayedCount} of ${totalCount} results`
            : `${displayedCount} result${displayedCount !== 1 ? 's' : ''} found`;

        // Show results container
        elements.searchResults.classList.remove('hidden');
        elements.resultsEmpty.classList.add('hidden');
        elements.resultsLoading.classList.add('hidden');
        elements.resultsList.classList.remove('hidden');
    }

    /**
     * Select a search result and show on map
     * @param {number} index - Result index
     */
    async function selectSearchResult(index) {
        const property = state.searchResults[index];
        
        if (!property) return;

        // Hide results
        hideSearchResults();

        if (property.lat && property.lng) {
            // Zoom to location
            state.map.setView([property.lat, property.lng], 17);

            // Add marker
            if (state.currentMarker) {
                state.map.removeLayer(state.currentMarker);
            }
            state.currentMarker = L.marker([property.lat, property.lng], {
                icon: createCustomIcon()
            }).addTo(state.map);

            // Show popup with property data
            property.savedAt = null;
            showPropertyPopup(property);
        } else {
            showToast('error', 'Unable to locate property on map');
        }
    }

    /**
     * Show search loading state
     */
    function showSearchLoading() {
        elements.searchResults.classList.remove('hidden');
        elements.resultsLoading.classList.remove('hidden');
        elements.resultsList.classList.add('hidden');
        elements.resultsEmpty.classList.add('hidden');
    }

    /**
     * Show search empty state
     */
    function showSearchEmpty() {
        elements.searchResults.classList.remove('hidden');
        elements.resultsEmpty.classList.remove('hidden');
        elements.resultsList.classList.add('hidden');
        elements.resultsLoading.classList.add('hidden');
    }

    /**
     * Hide search results
     */
    function hideSearchResults() {
        elements.searchResults.classList.add('hidden');
    }

    /**
     * Calculate centroid of a polygon
     * @param {Array} ring - Array of coordinate pairs
     * @returns {Object} Centroid {lat, lng}
     */
    function calculatePolygonCentroid(ring) {
        let latSum = 0;
        let lngSum = 0;
        const count = ring.length;

        ring.forEach(coord => {
            lngSum += coord[0];
            latSum += coord[1];
        });

        return {
            lat: latSum / count,
            lng: lngSum / count
        };
    }

    /**
     * Escape SQL special characters
     * @param {string} str - Input string
     * @returns {string} Escaped string
     */
    function escapeSQL(str) {
        return str.replace(/'/g, "''").replace(/[%_]/g, '');
    }

    /* ============================================
       PROPERTY IDENTIFICATION (API QUERY)
       ============================================ */

    /**
     * Identify property at clicked location
     * @param {number} lat - Latitude
     * @param {number} lng - Longitude
     */
    async function identifyProperty(lat, lng) {
        showLoading();

        try {
            // Get map bounds and size for identify request
            const bounds = state.map.getBounds();
            const size = state.map.getSize();

            // Build identify request parameters
            const params = {
                f: 'json',
                geometry: JSON.stringify({
                    x: lng,
                    y: lat,
                    spatialReference: { wkid: 4326 }
                }),
                geometryType: 'esriGeometryPoint',
                sr: 4326,
                layers: `all:${CONFIG.TAXLOT_LAYER_ID}`,
                tolerance: CONFIG.IDENTIFY_TOLERANCE,
                mapExtent: `${bounds.getWest()},${bounds.getSouth()},${bounds.getEast()},${bounds.getNorth()}`,
                imageDisplay: `${size.x},${size.y},96`,
                returnGeometry: true,
                returnFieldName: true,
                returnUnformattedValues: false
            };

            // Build the full ArcGIS identify URL
            const identifyUrl = `${CONFIG.ARCGIS_BASE_URL}${CONFIG.MAP_SERVICE}/identify`;
            
            // Make request through proxy
            const data = await fetchThroughProxy(identifyUrl, params);

            if (data && data.results && data.results.length > 0) {
                const propertyData = parsePropertyData(data.results[0], lat, lng);
                showPropertyPopup(propertyData);
            } else {
                showToast('error', 'No property found at this location');
                if (state.currentMarker) {
                    state.map.removeLayer(state.currentMarker);
                    state.currentMarker = null;
                }
            }
        } catch (error) {
            console.error('Error identifying property:', error);
            showToast('error', `Failed to fetch property data: ${error.message}`);
            if (state.currentMarker) {
                state.map.removeLayer(state.currentMarker);
                state.currentMarker = null;
            }
        } finally {
            hideLoading();
        }
    }

    /**
     * Fetch data through Cloudflare Worker proxy
     * @param {string} url - The ArcGIS REST API URL
     * @param {Object} params - Query parameters
     * @returns {Promise<Object>} API response data
     */
    async function fetchThroughProxy(url, params) {
        // Build query string
        const queryString = new URLSearchParams(params).toString();
        const fullUrl = `${url}?${queryString}`;

        // Make request to proxy
        const proxyUrl = `${CONFIG.PROXY_URL}?url=${encodeURIComponent(fullUrl)}`;

        const response = await fetch(proxyUrl, {
            method: 'GET',
            headers: {
                'Accept': 'application/json'
            }
        });

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        return await response.json();
    }

    /**
     * Get safe value or N/A
     * @param {*} value - Value to check
     * @returns {string} Value or N/A
     */
    function safeValue(value) {
        if (value === null || value === undefined || value === '' || value === ' ') {
            return CONFIG.NA_TEXT;
        }
        return String(value).trim();
    }

    /**
     * Check if value is N/A
     * @param {string} value - Value to check
     * @returns {boolean} True if N/A
     */
    function isNA(value) {
        return value === CONFIG.NA_TEXT || value === null || value === undefined || value === '';
    }

    /**
     * Parse raw API response into structured property data
     * @param {Object} result - Single result from identify response
     * @param {number} lat - Click latitude
     * @param {number} lng - Click longitude
     * @returns {Object} Parsed property data
     */
    function parsePropertyData(result, lat, lng) {
        const attrs = result.attributes || {};
        
        // Generate unique ID for the property
        const rawId = attrs.MAPTAXLOT || attrs.MapTaxlot || attrs.TAXLOT;
        const propertyId = safeValue(rawId) !== CONFIG.NA_TEXT 
            ? rawId 
            : `${lat.toFixed(6)}_${lng.toFixed(6)}_${Date.now()}`;

        return {
            id: propertyId,
            address: safeValue(attrs.SITUS || attrs.SITUS_ADDR || attrs.ADDRESS || attrs.SitusAddress),
            taxlotId: safeValue(attrs.MAPTAXLOT || attrs.MapTaxlot || attrs.TAXLOT || attrs.TaxlotID),
            owner: safeValue(attrs.OWNER || attrs.OWNER1 || attrs.OwnerName || attrs.OWNER_NAME),
            acreage: safeValue(attrs.ACRES || attrs.Acres || attrs.ACREAGE || attrs.GIS_ACRES),
            mapTaxlot: safeValue(attrs.MAPTAXLOT || attrs.MapTaxlot || attrs.MAP_TAXLOT),
            city: safeValue(attrs.CITY || attrs.City || attrs.SITUS_CITY),
            zipCode: safeValue(attrs.ZIPCODE || attrs.ZIP || attrs.Zip || attrs.SITUS_ZIP),
            landValue: safeValue(attrs.LANDVAL || attrs.LandValue || attrs.LAND_VALUE),
            improvementValue: safeValue(attrs.IMPVAL || attrs.ImpValue || attrs.IMP_VALUE),
            totalValue: safeValue(attrs.TOTALVAL || attrs.TotalValue || attrs.TOTAL_VALUE),
            yearBuilt: safeValue(attrs.YEARBUILT || attrs.YearBuilt || attrs.YEAR_BUILT),
            propertyClass: safeValue(attrs.PROPCLASS || attrs.PropClass || attrs.PROPERTY_CLASS),
            lat: lat,
            lng: lng,
            rawAttributes: attrs,
            savedAt: null
        };
    }

    /* ============================================
       POPUP FUNCTIONS
       ============================================ */

    /**
     * Show property popup on map
     * @param {Object} propertyData - Parsed property data
     */
    function showPropertyPopup(propertyData) {
        // Clone popup template
        const template = elements.popupTemplate.content.cloneNode(true);
        const popupElement = template.querySelector('.property-popup');

        // Populate popup with data (adding .na class for N/A values)
        setPopupValue(popupElement, '.property-address', propertyData.address);
        setPopupValue(popupElement, '.taxlot-id', propertyData.taxlotId);
        setPopupValue(popupElement, '.owner-name', propertyData.owner);
        setPopupValue(popupElement, '.acreage', formatAcreage(propertyData.acreage));
        setPopupValue(popupElement, '.map-taxlot', propertyData.mapTaxlot);
        setPopupValue(popupElement, '.city', propertyData.city);
        setPopupValue(popupElement, '.zipcode', propertyData.zipCode);

        // Get buttons
        const saveBtn = popupElement.querySelector('.btn-save-property');
        const zoomBtn = popupElement.querySelector('.btn-zoom-to');

        // Check if property is already saved
        const isAlreadySaved = state.savedProperties.some(p => p.id === propertyData.id);
        if (isAlreadySaved) {
            saveBtn.innerHTML = '<i class="fas fa-check"></i><span>Saved</span>';
            saveBtn.classList.add('saved');
            saveBtn.disabled = true;
        }

        // Create Leaflet popup
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

        // Re-bind events after popup opens (Leaflet recreates DOM)
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

    /**
     * Set popup value with N/A styling
     * @param {Element} container - Popup container element
     * @param {string} selector - CSS selector for value element
     * @param {string} value - Value to set
     */
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
       PROPERTY SAVE & MANAGEMENT FUNCTIONS
       ============================================ */

    /**
     * Save property to the saved list
     * @param {Object} propertyData - Property data to save
     */
    function saveProperty(propertyData) {
        // Check for duplicates
        if (state.savedProperties.some(p => p.id === propertyData.id)) {
            showToast('error', 'Property already saved');
            return;
        }

        // Add timestamp
        propertyData.savedAt = new Date().toISOString();

        // Add to state
        state.savedProperties.push(propertyData);

        // Persist to localStorage
        persistSavedProperties();

        // Create and add property card
        addPropertyCard(propertyData);

        // Update UI
        updateUI();

        showToast('success', 'Property saved successfully');
    }

    /**
     * Add property card to sidebar
     * @param {Object} propertyData - Property data
     */
    function addPropertyCard(propertyData) {
        // Hide empty state
        elements.emptyState.classList.add('hidden');

        // Clone template
        const template = elements.propertyCardTemplate.content.cloneNode(true);
        const card = template.querySelector('.property-card');

        // Set data attribute
        card.dataset.propertyId = propertyData.id;

        // Populate card with N/A handling
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

        // Bind checkbox event
        const checkbox = card.querySelector('.property-checkbox');
        checkbox.addEventListener('change', (e) => {
            handlePropertySelect(propertyData.id, e.target.checked);
            card.classList.toggle('selected', e.target.checked);
        });

        // Bind remove button
        const removeBtn = card.querySelector('.btn-remove-property');
        removeBtn.addEventListener('click', () => removeProperty(propertyData.id));

        // Bind zoom button
        const zoomBtn = card.querySelector('.btn-zoom-to-saved');
        zoomBtn.addEventListener('click', () => zoomToProperty(propertyData));

        // Add to list
        elements.savedPropertiesList.appendChild(card);
    }

    /**
     * Remove property from saved list
     * @param {string} propertyId - Property ID to remove
     */
    function removeProperty(propertyId) {
        // Remove from state
        state.savedProperties = state.savedProperties.filter(p => p.id !== propertyId);
        state.selectedPropertyIds.delete(propertyId);

        // Remove card from DOM
        const card = elements.savedPropertiesList.querySelector(`[data-property-id="${propertyId}"]`);
        if (card) {
            card.style.animation = 'slideInLeft 0.2s ease-out reverse';
            setTimeout(() => {
                card.remove();
                updateUI();
            }, 200);
        }

        // Persist changes
        persistSavedProperties();

        // Update UI
        updateUI();
    }

    /**
     * Handle property checkbox selection
     * @param {string} propertyId - Property ID
     * @param {boolean} isSelected - Selection state
     */
    function handlePropertySelect(propertyId, isSelected) {
        if (isSelected) {
            state.selectedPropertyIds.add(propertyId);
        } else {
            state.selectedPropertyIds.delete(propertyId);
        }

        updateSelectAllCheckbox();
        updateExportButtons();
    }

    /**
     * Handle select all checkbox
     */
    function handleSelectAll() {
        const isChecked = elements.selectAllCheckbox.checked;

        state.savedProperties.forEach(property => {
            if (isChecked) {
                state.selectedPropertyIds.add(property.id);
            } else {
                state.selectedPropertyIds.delete(property.id);
            }
        });

        // Update all property cards
        const cards = elements.savedPropertiesList.querySelectorAll('.property-card');
        cards.forEach(card => {
            const checkbox = card.querySelector('.property-checkbox');
            checkbox.checked = isChecked;
            card.classList.toggle('selected', isChecked);
        });

        updateExportButtons();
    }

    /**
     * Update select all checkbox state
     */
    function updateSelectAllCheckbox() {
        const totalProperties = state.savedProperties.length;
        const selectedCount = state.selectedPropertyIds.size;

        elements.selectAllCheckbox.checked = totalProperties > 0 && selectedCount === totalProperties;
        elements.selectAllCheckbox.indeterminate = selectedCount > 0 && selectedCount < totalProperties;
    }

    /**
     * Zoom to property location
     * @param {Object} propertyData - Property data with lat/lng
     */
    function zoomToProperty(propertyData) {
        state.map.setView([propertyData.lat, propertyData.lng], 18);

        // Add/move marker
        if (state.currentMarker) {
            state.map.removeLayer(state.currentMarker);
        }
        state.currentMarker = L.marker([propertyData.lat, propertyData.lng], {
            icon: createCustomIcon()
        }).addTo(state.map);

        // Show popup
        showPropertyPopup(propertyData);
    }

    /* ============================================
       EXPORT FUNCTIONS
       ============================================ */

    /**
     * Export all saved properties
     */
    function exportAllProperties() {
        if (state.savedProperties.length === 0) {
            showToast('error', 'No properties to export');
            return;
        }

        const content = generateExportContent(state.savedProperties);
        downloadTextFile(content, 'lane_county_properties_all.txt');
        showToast('success', `Exported ${state.savedProperties.length} properties`);
    }

    /**
     * Export selected properties
     */
    function exportSelectedProperties() {
        if (state.selectedPropertyIds.size === 0) {
            showToast('error', 'No properties selected');
            return;
        }

        const selectedProperties = state.savedProperties.filter(
            p => state.selectedPropertyIds.has(p.id)
        );

        const content = generateExportContent(selectedProperties);
        downloadTextFile(content, 'lane_county_properties_selected.txt');
        showToast('success', `Exported ${selectedProperties.length} properties`);
    }

    /**
     * Generate formatted export content
     * @param {Array} properties - Array of property objects
     * @returns {string} Formatted text content
     */
    function generateExportContent(properties) {
        const dateStr = new Date().toLocaleString();
        
        const header = `
================================================================================
                        LANE COUNTY PROPERTY EXPORT
================================================================================
Generated: ${dateStr}
Total Properties: ${properties.length}
================================================================================

`;

        const propertyBlocks = properties.map((prop, index) => {
            return `
--------------------------------------------------------------------------------
PROPERTY #${(index + 1).toString().padStart(3, '0')}
--------------------------------------------------------------------------------
Address:        ${prop.address}
Tax Lot ID:     ${prop.taxlotId}
Owner:          ${prop.owner}
Acreage:        ${formatAcreage(prop.acreage)}
Map/Taxlot:     ${prop.mapTaxlot}
City:           ${prop.city}
Zip Code:       ${prop.zipCode}
Coordinates:    ${prop.lat.toFixed(6)}, ${prop.lng.toFixed(6)}
Saved:          ${prop.savedAt ? new Date(prop.savedAt).toLocaleString() : 'N/A'}
--------------------------------------------------------------------------------
`;
        }).join('\n');

        const footer = `
================================================================================
                              END OF EXPORT
                    Lane County GIS Property Explorer
================================================================================
`;

        return header + propertyBlocks + footer;
    }

    /**
     * Download text content as file
     * @param {string} content - Text content
     * @param {string} filename - Output filename
     */
    function downloadTextFile(content, filename) {
        const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
    }

    /* ============================================
       CLEAR ALL FUNCTIONALITY
       ============================================ */

    /**
     * Show confirmation modal for clear all
     */
    function confirmClearAll() {
        elements.confirmMessage.textContent = 
            `Are you sure you want to remove all ${state.savedProperties.length} saved properties? This action cannot be undone.`;
        
        // Bind confirm button
        const confirmHandler = () => {
            clearAllProperties();
            hideModal();
            elements.btnConfirmOk.removeEventListener('click', confirmHandler);
        };
        
        elements.btnConfirmOk.addEventListener('click', confirmHandler);
        
        showModal();
    }

    /**
     * Clear all saved properties
     */
    function clearAllProperties() {
        state.savedProperties = [];
        state.selectedPropertyIds.clear();

        // Clear DOM
        const cards = elements.savedPropertiesList.querySelectorAll('.property-card');
        cards.forEach(card => card.remove());

        // Persist changes
        persistSavedProperties();

        // Update UI
        updateUI();

        showToast('success', 'All properties cleared');
    }

    /* ============================================
       SIDEBAR FUNCTIONS
       ============================================ */

    /**
     * Toggle sidebar visibility
     */
    function toggleSidebar() {
        state.isSidebarCollapsed = !state.isSidebarCollapsed;
        elements.sidebar.classList.toggle('collapsed', state.isSidebarCollapsed);

        // Invalidate map size after transition
        setTimeout(() => {
            state.map.invalidateSize();
        }, 300);
    }

    /* ============================================
       LOCAL STORAGE PERSISTENCE
       ============================================ */

    /**
     * Load saved properties from localStorage
     */
    function loadSavedProperties() {
        try {
            const stored = localStorage.getItem(CONFIG.STORAGE_KEY);
            if (stored) {
                state.savedProperties = JSON.parse(stored);
                // Render saved property cards
                state.savedProperties.forEach(property => addPropertyCard(property));
            }
        } catch (error) {
            console.error('Error loading saved properties:', error);
            state.savedProperties = [];
        }
    }

    /**
     * Persist saved properties to localStorage
     */
    function persistSavedProperties() {
        try {
            localStorage.setItem(CONFIG.STORAGE_KEY, JSON.stringify(state.savedProperties));
        } catch (error) {
            console.error('Error persisting saved properties:', error);
        }
    }

    /* ============================================
       UI UPDATE FUNCTIONS
       ============================================ */

    /**
     * Update all UI elements based on current state
     */
    function updateUI() {
        updatePropertyCount();
        updateExportButtons();
        updateEmptyState();
        updateSelectAllCheckbox();
        updateSavedBadge();
    }

    /**
     * Update property count display
     */
    function updatePropertyCount() {
        const count = state.savedProperties.length;
        elements.propertyCount.textContent = `${count} ${count === 1 ? 'property' : 'properties'}`;
    }

    /**
     * Update saved badge on expand button
     */
    function updateSavedBadge() {
        const count = state.savedProperties.length;
        if (count > 0) {
            elements.savedBadge.textContent = count > 99 ? '99+' : count;
            elements.savedBadge.classList.remove('hidden');
        } else {
            elements.savedBadge.classList.add('hidden');
        }
    }

    /**
     * Update export button states
     */
    function updateExportButtons() {
        const hasProperties = state.savedProperties.length > 0;
        const hasSelected = state.selectedPropertyIds.size > 0;

        elements.btnExportAll.disabled = !hasProperties;
        elements.btnExportSelected.disabled = !hasSelected;
        elements.btnClearAll.disabled = !hasProperties;
    }

    /**
     * Update empty state visibility
     */
    function updateEmptyState() {
        const isEmpty = state.savedProperties.length === 0;
        elements.emptyState.classList.toggle('hidden', !isEmpty);
    }

    /* ============================================
       LOADING & TOAST FUNCTIONS
       ============================================ */

    /**
     * Show loading overlay
     */
    function showLoading() {
        state.isLoading = true;
        elements.loadingOverlay.classList.remove('hidden');
    }

    /**
     * Hide loading overlay
     */
    function hideLoading() {
        state.isLoading = false;
        elements.loadingOverlay.classList.add('hidden');
    }

    /**
     * Show toast notification
     * @param {string} type - 'success' or 'error'
     * @param {string} message - Toast message
     */
    function showToast(type, message) {
        const toast = type === 'error' ? elements.errorToast : elements.successToast;
        const messageEl = type === 'error' ? elements.errorMessage : elements.successMessage;

        messageEl.textContent = message;
        toast.classList.remove('hidden');

        // Auto-hide after duration
        setTimeout(() => {
            hideToast(type);
        }, CONFIG.TOAST_DURATION);
    }

    /**
     * Hide toast notification
     * @param {string} type - 'success' or 'error'
     */
    function hideToast(type) {
        const toast = type === 'error' ? elements.errorToast : elements.successToast;
        toast.classList.add('hidden');
    }

    /* ============================================
       MODAL FUNCTIONS
       ============================================ */

    /**
     * Show confirmation modal
     */
    function showModal() {
        elements.confirmModal.classList.remove('hidden');
    }

    /**
     * Hide confirmation modal
     */
    function hideModal() {
        elements.confirmModal.classList.add('hidden');
    }

    /* ============================================
       UTILITY FUNCTIONS
       ============================================ */

    /**
     * Format acreage value
     * @param {string|number} value - Raw acreage value
     * @returns {string} Formatted acreage
     */
    function formatAcreage(value) {
        if (isNA(value)) return CONFIG.NA_TEXT;
        const num = parseFloat(value);
        if (isNaN(num)) return CONFIG.NA_TEXT;
        return `${num.toFixed(2)} acres`;
    }

    /**
     * Truncate text with ellipsis
     * @param {string} text - Input text
     * @param {number} maxLength - Maximum length
     * @returns {string} Truncated text
     */
    function truncateText(text, maxLength) {
        if (isNA(text)) return CONFIG.NA_TEXT;
        return text.length > maxLength ? text.substring(0, maxLength - 3) + '...' : text;
    }

    /**
     * Capitalize first letter
     * @param {string} str - Input string
     * @returns {string} Capitalized string
     */
    function capitalize(str) {
        return str.charAt(0).toUpperCase() + str.slice(1);
    }

    /* ============================================
       INITIALIZE APPLICATION
       ============================================ */
    
    // Wait for DOM to be ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

})();