import React, { useState, useMemo, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  StatusBar,
  Pressable,
  Platform,
  Modal,
  TextInput,
  ScrollView,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import CrossPlatformMap from '../components/CrossPlatformMap';
import { buildApiUrl, apiFetch } from '../config/apiConfig';

const concaveman = require('concaveman');

const COLORS = {
  background: '#F5F0E6',
  text: '#2C2C2C',
  buttonBg: '#5A554E',
  buttonBorder: '#3D3A36',
  shadow: 'rgba(0,0,0,0.15)',
};

// Calculate centroid of a polygon
const calculateCentroid = (coordinates) => {
  if (!coordinates || coordinates.length === 0) return null;
  
  // Handle MultiPolygon - use the largest polygon
  let ring = coordinates;
  if (Array.isArray(coordinates[0]) && Array.isArray(coordinates[0][0]) && Array.isArray(coordinates[0][0][0])) {
    // MultiPolygon - find largest
    let maxArea = 0;
    coordinates.forEach(poly => {
      const area = calculateRingArea(poly[0]);
      if (area > maxArea) {
        maxArea = area;
        ring = poly[0];
      }
    });
  } else if (Array.isArray(coordinates[0]) && Array.isArray(coordinates[0][0])) {
    // Polygon
    ring = coordinates[0];
  }
  
  let sumLat = 0, sumLng = 0;
  ring.forEach(coord => {
    sumLng += coord[0];
    sumLat += coord[1];
  });
  
  return {
    latitude: sumLat / ring.length,
    longitude: sumLng / ring.length,
  };
};

const calculateRingArea = (ring) => {
  if (!ring || ring.length < 3) return 0;
  let area = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    area += (ring[j][0] + ring[i][0]) * (ring[j][1] - ring[i][1]);
  }
  return Math.abs(area / 2);
};

const degToRad = (deg) => (deg * Math.PI) / 180;

// Convert lat/lng to a local planar coordinate system (meters-ish) for stable hull math.
const toLocalXY = (pins) => {
  const lat0 = pins.reduce((acc, p) => acc + p.latitude, 0) / Math.max(pins.length, 1);
  const lng0 = pins.reduce((acc, p) => acc + p.longitude, 0) / Math.max(pins.length, 1);
  const latRad = degToRad(lat0);
  const metersPerDegLat = 110540; // rough
  const metersPerDegLng = 111320 * Math.cos(latRad); // rough

  const xy = pins.map((p) => {
    const x = (p.longitude - lng0) * metersPerDegLng;
    const y = (p.latitude - lat0) * metersPerDegLat;
    return { x, y };
  });

  return { lat0, lng0, xy };
};

const pointToSegmentDistanceSq = (px, py, ax, ay, bx, by) => {
  const abx = bx - ax;
  const aby = by - ay;
  const apx = px - ax;
  const apy = py - ay;

  const abLenSq = abx * abx + aby * aby;
  if (abLenSq === 0) {
    const dx = px - ax;
    const dy = py - ay;
    return { distSq: dx * dx + dy * dy, t: 0 };
  }

  let t = (apx * abx + apy * aby) / abLenSq;
  if (t < 0) t = 0;
  if (t > 1) t = 1;

  const cx = ax + t * abx;
  const cy = ay + t * aby;
  const dx = px - cx;
  const dy = py - cy;
  return { distSq: dx * dx + dy * dy, t };
};

const cross = (ax, ay, bx, by) => ax * by - ay * bx;

const segmentsIntersect = (a, b, c, d) => {
  // Proper segment intersection (including collinear overlaps treated as intersecting)
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const acx = c.x - a.x;
  const acy = c.y - a.y;
  const adx = d.x - a.x;
  const ady = d.y - a.y;

  const cdx = d.x - c.x;
  const cdy = d.y - c.y;
  const cax = a.x - c.x;
  const cay = a.y - c.y;
  const cbx = b.x - c.x;
  const cby = b.y - c.y;

  const d1 = cross(abx, aby, acx, acy);
  const d2 = cross(abx, aby, adx, ady);
  const d3 = cross(cdx, cdy, cax, cay);
  const d4 = cross(cdx, cdy, cbx, cby);

  const eps = 1e-9;
  const s1 = Math.abs(d1) < eps ? 0 : Math.sign(d1);
  const s2 = Math.abs(d2) < eps ? 0 : Math.sign(d2);
  const s3 = Math.abs(d3) < eps ? 0 : Math.sign(d3);
  const s4 = Math.abs(d4) < eps ? 0 : Math.sign(d4);

  const onSegment = (p, q, r) => {
    // q on pr
    return (
      Math.min(p.x, r.x) - eps <= q.x &&
      q.x <= Math.max(p.x, r.x) + eps &&
      Math.min(p.y, r.y) - eps <= q.y &&
      q.y <= Math.max(p.y, r.y) + eps
    );
  };

  if (s1 === 0 && onSegment(a, c, b)) return true;
  if (s2 === 0 && onSegment(a, d, b)) return true;
  if (s3 === 0 && onSegment(c, a, d)) return true;
  if (s4 === 0 && onSegment(c, b, d)) return true;

  return s1 !== s2 && s3 !== s4;
};

// Returns an array of pin indexes in boundary order (no closing point).
// Robust strategy:
// 1) dedupe near-identical points
// 2) centroid-angle sort
// 3) 2-opt untangling to remove self-intersections
const orderPinIndexesForPolygon = (pins) => {
  if (!Array.isArray(pins) || pins.length < 3) return [];

  // Dedupe near-identical pins (common when tapping corners repeatedly)
  const keyToIndex = new Map();
  const keptIndexes = [];
  for (let i = 0; i < pins.length; i++) {
    const p = pins[i];
    const key = `${p.latitude.toFixed(7)},${p.longitude.toFixed(7)}`;
    if (keyToIndex.has(key)) continue;
    keyToIndex.set(key, i);
    keptIndexes.push(i);
  }
  if (keptIndexes.length < 3) return [];

  const keptPins = keptIndexes.map((i) => pins[i]);
  const { xy } = toLocalXY(keptPins);

  // Initial order: sort by angle around centroid
  const cx = xy.reduce((acc, p) => acc + p.x, 0) / xy.length;
  const cy = xy.reduce((acc, p) => acc + p.y, 0) / xy.length;
  let order = xy
    .map((p, localIdx) => ({ localIdx, a: Math.atan2(p.y - cy, p.x - cx) }))
    .sort((a, b) => a.a - b.a)
    .map((v) => v.localIdx);

  // 2-opt: remove edge crossings by reversing segments
  const maxPasses = 200;
  for (let pass = 0; pass < maxPasses; pass++) {
    let improved = false;
    const n = order.length;
    for (let i = 0; i < n; i++) {
      const i2 = (i + 1) % n;
      const a = xy[order[i]];
      const b = xy[order[i2]];

      for (let j = i + 2; j < n; j++) {
        const j2 = (j + 1) % n;
        // Skip adjacent edges and the edge that shares the start/end vertex
        if (i === 0 && j2 === 0) continue;
        if (i2 === j) continue;

        const c = xy[order[j]];
        const d = xy[order[j2]];
        if (segmentsIntersect(a, b, c, d)) {
          // Reverse the segment between i2 and j
          const start = i2;
          const end = j;
          const next = order.slice();
          const segment = [];
          for (let k = start; k <= end; k++) segment.push(next[k]);
          segment.reverse();
          for (let k = start; k <= end; k++) next[k] = segment[k - start];
          order = next;
          improved = true;
        }
        if (improved) break;
      }
      if (improved) break;
    }
    if (!improved) break;
  }

  // Map back to original pin indexes
  return order.map((localIdx) => keptIndexes[localIdx]);
};

const MapScreen = ({ county, city, mcdData: propMcdData, isLoadingMcdData: propIsLoading, initialFarms, onNavigateBack, onNavigateNext, onFarmsUpdate }) => {
  const [pins, setPins] = useState([]);
  const [farmPins, setFarmPins] = useState(() => {
    // Initialize farmPins from initialFarms if provided, but only for valid farms
    if (initialFarms && initialFarms.length > 0) {
      const validFarms = initialFarms.filter(farm => {
        const id = parseInt(farm.id);
        return !isNaN(id) && id < 1000000;
      });
      return validFarms.flatMap(farm => farm.pins || []);
    }
    return [];
  });
  const [farms, setFarms] = useState(() => {
    // Filter out farms with invalid IDs (timestamp IDs that were never saved to backend)
    if (initialFarms && initialFarms.length > 0) {
      const validFarms = initialFarms.filter(farm => {
        const id = parseInt(farm.id);
        // Valid database IDs are small integers (< 1 million), timestamp IDs are large (> 1 billion)
        return !isNaN(id) && id < 1000000;
      });
      return validFarms;
    }
    return [];
  });
  const [backPressed, setBackPressed] = useState(false);
  const farmsRef = useRef(farms);
  const isMountedRef = useRef(true);

  useEffect(() => {
    farmsRef.current = farms;
  }, [farms]);

  useEffect(() => {
    return () => {
      isMountedRef.current = false;
    };
  }, []);
  
  // Use prop data directly
  const mcdData = propMcdData;
  const isLoadingMcdData = propIsLoading || !propMcdData;
  
  // Modal states
  const [farmsModalVisible, setFarmsModalVisible] = useState(false);
  const [farmDetailModalVisible, setFarmDetailModalVisible] = useState(false);
  const [selectedFarm, setSelectedFarm] = useState(null);
  const [editingFarmName, setEditingFarmName] = useState('');
  const [editingPinIndex, setEditingPinIndex] = useState(null);
  const [editingLat, setEditingLat] = useState('');
  const [editingLng, setEditingLng] = useState('');
  
  // Confirmation modal state
  const [confirmModalVisible, setConfirmModalVisible] = useState(false);
  const [confirmModalConfig, setConfirmModalConfig] = useState({
    title: '',
    message: '',
    onConfirm: () => {},
  });
  
  // Error modal state
  const [errorModalVisible, setErrorModalVisible] = useState(false);
  const [errorModalConfig, setErrorModalConfig] = useState({
    title: '',
    message: '',
  });
  
  const [isBuildingFarm, setIsBuildingFarm] = useState(false);

  // Find the selected city data and calculate centroid
  const cityData = useMemo(() => {
    if (!city || !county || !mcdData) return null;
    
    const feature = mcdData.features.find(f => 
      f.properties.namelsad === city && 
      f.properties.county === county
    );
    
    if (!feature) return null;
    
    const centroid = calculateCentroid(feature.geometry.coordinates);
    
    return {
      name: city,
      county: county,
      centroid,
      geometry: feature.geometry,
    };
  }, [city, county]);

  const region = cityData?.centroid || {
    latitude: 43.0,
    longitude: -84.5,
  };

  // Notify parent component when farms change
  useEffect(() => {
    if (onFarmsUpdate) {
      onFarmsUpdate(farms);
    }
  }, [farms, onFarmsUpdate]);

  // Load farms from backend on component mount
  useEffect(() => {
    const loadFarmsFromBackend = async () => {
      try {
        const response = await apiFetch(buildApiUrl('/farms?userId=default-user'));
        if (response.ok) {
          const backendResponse = await response.json();
          if (backendResponse.success && Array.isArray(backendResponse.data)) {
            const localFarms = backendResponse.data.map(bf => {
              if (!bf.id || !bf.name || !bf.boundary || !bf.boundary.coordinates) {
                console.error('Invalid farm data from backend:', bf);
                return null;
              }
              const existingFarm = (farmsRef.current || []).find(f => f?.id === bf.id.toString());
              return {
                id: bf.id.toString(),
                type: 'Feature',
                properties: {
                  name: bf.name,
                  county: county,
                  city: city,
                  createdAt: bf.createdAt,
                  pinCount: bf.boundary.coordinates[0].length,
                  avgSuitability: parseFloat(bf.avgSuitability) || 0,
                },
                geometry: bf.boundary,
                pins: existingFarm?.pins || [],
                backendAnalysis: existingFarm?.backendAnalysis || null,
                analysisStatus: existingFarm?.analysisStatus,
              };
            }).filter(f => f !== null);
            setFarms(localFarms);
            
            // Create farm pins from loaded farm boundaries
            const loadedFarmPins = localFarms.flatMap(farm => {
              if (farm.geometry && farm.geometry.coordinates && farm.geometry.coordinates[0]) {
                return farm.geometry.coordinates[0].map((coord, index) => ({
                  id: `${farm.id}-pin-${index}`,
                  latitude: coord[1], // GeoJSON is [lng, lat]
                  longitude: coord[0],
                  color: '#3B82F6',
                  farmId: farm.id,
                  title: `Farm ${farm.properties.name} Pin ${index + 1}`,
                }));
              }
              return [];
            });
            setFarmPins(loadedFarmPins);
            
            console.log('Loaded', localFarms.length, 'farms from backend');
          }
        }
      } catch (error) {
        console.warn('Failed to load farms from backend:', error);
        // Clear farms if backend load fails - don't show potentially stale/invalid local data
        setFarms([]);
        setFarmPins([]);
      }
    };

    loadFarmsFromBackend();
  }, []); // Empty dependency array - only run once on mount

  const handlePinAdd = (newPin) => {
    setPins(currentPins => [...currentPins, {
      ...newPin,
      title: `Pin ${currentPins.length + 1}`,
      color: '#C54B4B',
    }]);
  };

  const handlePinRemove = (pinToRemove) => {
    // Only allow removing red pins (not blue farm pins)
    if (pinToRemove.farmId) {
      return; // Don't remove farm pins
    }
    setPins(currentPins => currentPins.filter(p => p.id !== pinToRemove.id));
  };

  const showConfirmation = (title, message, onConfirm) => {
    setConfirmModalConfig({ title, message, onConfirm });
    setConfirmModalVisible(true);
  };
  
  const showError = (title, message) => {
    setErrorModalConfig({ title, message });
    setErrorModalVisible(true);
  };

  const handleClearPins = () => {
    showConfirmation(
      'Clear Pins',
      `Are you sure you want to clear all ${pins.length} pin${pins.length !== 1 ? 's' : ''}?`,
      () => setPins([])
    );
  };

  const handleBuildFarm = async () => {
    if (pins.length < 3 || isBuildingFarm) {
      // Need at least 3 points to make a polygon and avoid duplicate submissions
      return;
    }

    setIsBuildingFarm(true);

    try {
      // Connect-the-dots: preserve the user's pin placement order.
      const orderedPins = pins;

      // Store the farm polygon coordinates in GeoJSON format (ring)
      const coordinates = orderedPins.map((pin) => [pin.longitude, pin.latitude]);
      // Close the polygon by adding the first point at the end
      coordinates.push(coordinates[0]);

      // Create farm on backend first (returns farm ID immediately)
      try {
        const requestBody = {
          userId: 'default-user',
          name: `Farm ${farms.length + 1}`,
          coordinates: coordinates.slice(0, -1),
        };
        
        const farmResponse = await apiFetch(buildApiUrl('/farms'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(requestBody)
        });

        if (!farmResponse.ok) {
          const errorText = await farmResponse.text();
          let errorData;
          try {
            errorData = JSON.parse(errorText);
          } catch (e) {
            // If not JSON, use raw text
            errorData = { message: errorText };
          }

          // Handle farm size validation error specifically
          if (farmResponse.status === 422 && errorData.error === 'Farm Too Large') {
            showError(
              'Farm Too Large',
              errorData.message
            );
            return; // Don't create farm locally if backend rejected it
          }

          // For any other backend error, don't create farm locally
          console.warn('Failed to save farm to backend:', errorText);
          showError(
            'Failed to Save Farm',
            'Farm could not be saved to the server. Please check your connection and try again.'
          );
          return; // Don't create farm locally if backend save failed
        } else {
          const savedFarm = await farmResponse.json();
          console.log('Farm saved to backend:', savedFarm);
          
          if (!savedFarm.success || !savedFarm.data || !savedFarm.data.id) {
            throw new Error('Invalid backend response structure');
          }
          
          // Build farm object from backend response
          const bluePins = orderedPins.map((pin) => ({
            ...pin,
            color: '#3B82F6',
            farmId: savedFarm.data.id.toString(),
          }));
          
          const farm = {
            id: savedFarm.data.id.toString(),
            type: 'Feature',
            properties: {
              name: savedFarm.data.name,
              county: county,
              city: city,
              createdAt: savedFarm.data.createdAt,
              pinCount: orderedPins.length,
              avgSuitability: savedFarm.data.avgSuitability,
            },
            geometry: {
              type: 'Polygon',
              coordinates: [coordinates],
            },
            pins: bluePins,
            backendAnalysis: null,
            analysisStatus: 'queued',
          };

          setFarmPins(currentFarmPins => [...currentFarmPins, ...bluePins]);
          setFarms(currentFarms => [...currentFarms, farm]);
          setPins([]);
          console.log('Farm created:', farm.id, farm.properties.name);

          const updateFarmAnalysisStatus = (farmId, status) => {
            setFarms(currentFarms => currentFarms.map(f => {
              if (f.id !== farmId) return f;
              return { ...f, analysisStatus: status };
            }));
          };

          // Kick off analysis by farm ID (non-blocking)
          const analyzeFarmInBackground = async (farmToAnalyze) => {
            const farmId = farmToAnalyze?.id;
            if (!farmId) return;
            const analysisCounty = farmToAnalyze?.properties?.county;
            const analysisCity = farmToAnalyze?.properties?.city;
            if (!analysisCounty || !analysisCity || analysisCounty.trim() === '' || analysisCity.trim() === '') {
              console.warn('Analysis skipped: county or city not available for farm', farmId);
              updateFarmAnalysisStatus(farmId, 'error');
              return;
            }
            console.log('Starting background analysis for farm', farmId);
            updateFarmAnalysisStatus(farmId, 'running');
            try {
              const rawCoordinates = farmToAnalyze?.geometry?.coordinates?.[0] || [];
              const coordinates = rawCoordinates.length > 1 &&
                rawCoordinates[0][0] === rawCoordinates[rawCoordinates.length - 1][0] &&
                rawCoordinates[0][1] === rawCoordinates[rawCoordinates.length - 1][1]
                ? rawCoordinates.slice(0, -1)
                : rawCoordinates;

              if (!Array.isArray(coordinates) || coordinates.length < 3) {
                throw new Error('Invalid farm geometry: not enough points to analyze');
              }

              const payload = { coordinates, userId: 'default-user' };
              console.log('Analyze request payload:', JSON.stringify(payload, null, 2));

              const response = await apiFetch(buildApiUrl('/reports/analyze'), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
              });

              if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`Backend API error (${response.status}): ${errorText}`);
              }

              const responseText = await response.text();
              console.log('Analyze response payload:', responseText);
              let backendAnalysis;
              try {
                backendAnalysis = JSON.parse(responseText);
              } catch (parseError) {
                throw new Error(`Invalid JSON response: ${parseError.message}`);
              }

              const solarResults = backendAnalysis?.solarSuitability?.results;
              if (Array.isArray(solarResults) && solarResults.length > 0) {
                // Solar data caching removed - no longer needed for heatmap display
              }

              const nextFarms = (farmsRef.current || []).map(f => {
                if (f.id !== farmId) return f;
                return {
                  ...f,
                  properties: {
                    ...f.properties,
                    avgSuitability: backendAnalysis?.solarSuitability?.summary?.averageSuitability,
                  },
                  backendAnalysis,
                  analysisStatus: 'completed',
                };
              });
              farmsRef.current = nextFarms;
              if (isMountedRef.current) {
                setFarms(nextFarms);
              }
              if (onFarmsUpdate) {
                onFarmsUpdate(nextFarms);
              }
              console.log('Analysis completed for farm', farmId);
            } catch (error) {
              console.warn('Backend analysis failed:', error?.message || error);
              console.log('Analysis failed for farm', farmId, error?.message || error);
              updateFarmAnalysisStatus(farmId, 'error');
            }
          };

          analyzeFarmInBackground(farm);
        }
      } catch (error) {
        console.warn('Error saving farm to backend:', error);
        showError(
          'Network Error',
          'Failed to connect to server. Please check your connection and try again.'
        );
        return; // Don't create farm locally if network error
      }
    } finally {
      setIsBuildingFarm(false);
    }
  };

  // Open farms list modal
  // Open farms list modal
  const handleFarmsPress = () => {
    setFarmsModalVisible(true);
  };

  // Open farm detail modal
  const handleFarmSelect = (farm) => {
    setSelectedFarm(farm);
    setEditingFarmName(farm.properties.name);
    setFarmsModalVisible(false);
    setFarmDetailModalVisible(true);
  };

  // Delete a farm with confirmation
  const handleDeleteFarm = async (farmId) => {
    const farm = farms.find(f => f.id === farmId);
    const farmName = farm ? farm.properties.name : 'this farm';

    showConfirmation(
      'Delete Farm',
      `Are you sure you want to delete "${farmName}"? This cannot be undone.`,
      async () => {
        try {
          // Delete from backend first
          const response = await apiFetch(buildApiUrl(`/farms/${farmId}?userId=default-user`), {
            method: 'DELETE',
          });

          if (!response.ok) {
            const errorText = await response.text();
            console.warn('Failed to delete farm from backend:', errorText);
            showError(
              'Delete Failed',
              'Failed to delete farm from server. Please try again.'
            );
            return;
          }

          // If backend deletion successful, update local state
          setFarms(currentFarms => currentFarms.filter(f => f.id !== farmId));
          setFarmPins(currentFarmPins => currentFarmPins.filter(p => p.farmId !== farmId));

          console.log('Farm deleted successfully from backend and local state');
        } catch (error) {
          console.warn('Error deleting farm from backend:', error);
          showError(
            'Delete Failed',
            'Network error while deleting farm. Please check your connection and try again.'
          );
        }
      }
    );
  };

  // Update farm name (backend + local)
  const handleFarmNameChange = async () => {
    if (!selectedFarm || !editingFarmName.trim()) return;

    const farmId = selectedFarm.id;
    const newName = editingFarmName.trim();
    const previousName = selectedFarm.properties?.name || '';

    if (newName === previousName) return;

    // Optimistic local update
    setFarms(currentFarms => currentFarms.map(f => {
      if (f.id === farmId) {
        return {
          ...f,
          properties: {
            ...f.properties,
            name: newName,
          },
        };
      }
      return f;
    }));

    setSelectedFarm(prev => (prev ? {
      ...prev,
      properties: {
        ...prev.properties,
        name: newName,
      },
    } : prev));

    try {
      const response = await apiFetch(buildApiUrl(`/farms/${farmId}`), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: 'default-user', name: newName }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Backend error (${response.status}): ${errorText}`);
      }

      const payload = await response.json();
      const syncedName = payload?.data?.name || newName;
      const updatedAt = payload?.data?.updatedAt;

      setFarms(currentFarms => currentFarms.map(f => {
        if (f.id === farmId) {
          return {
            ...f,
            properties: {
              ...f.properties,
              name: syncedName,
              updatedAt: updatedAt || f.properties?.updatedAt,
            },
          };
        }
        return f;
      }));

      setSelectedFarm(prev => (prev ? {
        ...prev,
        properties: {
          ...prev.properties,
          name: syncedName,
          updatedAt: updatedAt || prev.properties?.updatedAt,
        },
      } : prev));
    } catch (error) {
      console.warn('Failed to update farm name on backend:', error);
      showError(
        'Rename Failed',
        'Could not update farm name on server. Please try again.'
      );

      setEditingFarmName(previousName);

      // Roll back optimistic update
      setFarms(currentFarms => currentFarms.map(f => {
        if (f.id === farmId) {
          return {
            ...f,
            properties: {
              ...f.properties,
              name: previousName,
            },
          };
        }
        return f;
      }));

      setSelectedFarm(prev => (prev ? {
        ...prev,
        properties: {
          ...prev.properties,
          name: previousName,
        },
      } : prev));
    }
  };

  // Get pins for a specific farm
  const getFarmPinsById = (farmId) => {
    return farmPins.filter(p => p.farmId === farmId);
  };

  // Start editing a pin coordinate
  const handlePinEdit = (index, coord) => {
    // coord is [lng, lat] from GeoJSON
    setEditingPinIndex(index);
    setEditingLat(coord[1].toFixed(6));
    setEditingLng(coord[0].toFixed(6));
  };

  // Save pin coordinate edit
  const handleSavePinEdit = () => {
    if (editingPinIndex === null || !selectedFarm) return;
    
    const newLat = parseFloat(editingLat);
    const newLng = parseFloat(editingLng);
    
    if (isNaN(newLat) || isNaN(newLng)) return;
    
    // Update the farm pin (use selectedFarm.pins order; don't rely on farmPins ordering)
    const pinToUpdate = (selectedFarm.pins || [])[editingPinIndex];
    
    if (pinToUpdate) {
      setFarmPins(currentFarmPins => currentFarmPins.map(p => {
        if (p.id === pinToUpdate.id) {
          return {
            ...p,
            latitude: newLat,
            longitude: newLng,
          };
        }
        return p;
      }));
      
      // Also update the farm geometry and pins
      setFarms(currentFarms => currentFarms.map(f => {
        if (f.id === selectedFarm.id) {
          // Update pins array (vertex list) in-place (connect-the-dots order)
          const updatedPins = f.pins ? [...f.pins] : [];
          if (updatedPins[editingPinIndex]) {
            updatedPins[editingPinIndex] = {
              ...updatedPins[editingPinIndex],
              latitude: newLat,
              longitude: newLng,
            };
          }

          const newCoords = updatedPins.map((p) => [p.longitude, p.latitude]);
          if (newCoords.length) newCoords.push(newCoords[0]);

          return {
            ...f,
            properties: {
              ...f.properties,
              pinCount: updatedPins.length,
            },
            geometry: {
              ...f.geometry,
              coordinates: [newCoords],
            },
            pins: updatedPins,
          };
        }
        return f;
      }));
      
      // Also update selectedFarm to show updated coordinates in UI
      setSelectedFarm(prev => {
        const updatedPins = prev.pins ? [...prev.pins] : [];
        if (updatedPins[editingPinIndex]) {
          updatedPins[editingPinIndex] = {
            ...updatedPins[editingPinIndex],
            latitude: newLat,
            longitude: newLng,
          };
        }

        const newCoords = updatedPins.map((p) => [p.longitude, p.latitude]);
        if (newCoords.length) newCoords.push(newCoords[0]);

        return {
          ...prev,
          properties: {
            ...prev.properties,
            pinCount: updatedPins.length,
          },
          geometry: {
            ...prev.geometry,
            coordinates: [newCoords],
          },
          pins: updatedPins,
        };
      });
    }
    
    setEditingPinIndex(null);
  };

  // Cancel pin edit
  const handleCancelPinEdit = () => {
    setEditingPinIndex(null);
  };

  // Show loading state
  if (isLoadingMcdData) {
    return (
      <SafeAreaView style={styles.container}>
        <StatusBar barStyle="dark-content" backgroundColor={COLORS.background} />
        <Pressable
          style={({ pressed }) => [
            styles.backButton,
            pressed && styles.backButtonPressed,
          ]}
          onPress={onNavigateBack}
        >
          <Text style={styles.backButtonText}>←</Text>
        </Pressable>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={COLORS.buttonBg} />
          <Text style={styles.loadingText}>Loading map data...</Text>
        </View>
      </SafeAreaView>
    );
  }

  // Show error state if data failed to load
  if (!mcdData) {
    return (
      <SafeAreaView style={styles.container}>
        <StatusBar barStyle="dark-content" backgroundColor={COLORS.background} />
        <Pressable
          style={({ pressed }) => [
            styles.backButton,
            pressed && styles.backButtonPressed,
          ]}
          onPress={onNavigateBack}
        >
          <Text style={styles.backButtonText}>←</Text>
        </Pressable>
        <View style={styles.header}>
          <Text style={styles.headerTitle}>{city}</Text>
          <Text style={styles.headerSubtitle}>{county} County</Text>
        </View>
        <View style={styles.errorContainer}>
          <Text style={styles.errorText}>Unable to load map data</Text>
          <Text style={styles.errorSubtext}>Please check your connection and try again</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <>
      <SafeAreaView style={styles.container}>
        <StatusBar barStyle="dark-content" backgroundColor={COLORS.background} />
      
      {/* Header */}
      <View style={styles.header}>
        <Pressable
          style={({ pressed }) => [
            styles.backButton,
            pressed && styles.backButtonPressed,
          ]}
          onPress={onNavigateBack}
          onPressIn={() => setBackPressed(true)}
          onPressOut={() => setBackPressed(false)}
        >
          <Text style={styles.backButtonText}>←</Text>
        </Pressable>
        <View style={styles.headerCenter}>
          <Text style={styles.headerTitle} numberOfLines={1}>
            {cityData ? cityData.name : 'Map View'}
          </Text>
          <Text style={styles.headerSubtitle}>
            {cityData ? `${county} County` : 'Select a location'}
          </Text>
        </View>
      </View>

      {/* Instructions */}
      <View style={styles.instructionBar}>
        <Text style={styles.instructionText}>
          Tap on the map to place pins
        </Text>
      </View>

      {/* Map Container */}
      <View style={styles.mapContainer}>
        <CrossPlatformMap
          region={region}
          pins={[...farmPins, ...pins]}
          onPinAdd={handlePinAdd}
          onPinRemove={handlePinRemove}
          style={styles.map}
        />

        {isBuildingFarm && (
          <View style={styles.buildingOverlay}>
            <ActivityIndicator size="large" color="#FFFFFF" />
            <Text style={styles.buildingOverlayText}>Creating farm...</Text>
            <Text style={styles.buildingOverlaySubtext}>
              Waiting for farm ID from the server.
            </Text>
          </View>
        )}

        {/* Control Panel Overlay */}
        <View style={styles.controlPanel}>
          {/* Header Row: Title and Clear Pins */}
          <View style={styles.controlPanelHeader}>
            <Pressable
              style={({ pressed }) => [
                styles.farmsButton,
                pressed && styles.farmsButtonPressed,
              ]}
              onPress={handleFarmsPress}
            >
              <Text style={styles.farmsButtonText}>Farms: {farms.length}</Text>
            </Pressable>
            <Pressable
              style={({ pressed }) => [
                styles.clearButton,
                pins.length === 0 && styles.clearButtonDisabled,
                pressed && pins.length > 0 && styles.clearButtonPressed,
              ]}
              onPress={handleClearPins}
              disabled={pins.length === 0}
            >
              <Text style={[
                styles.clearButtonText,
                pins.length === 0 && styles.clearButtonTextDisabled,
              ]}>
                {pins.length > 0 ? `Clear ${pins.length} Pin${pins.length !== 1 ? 's' : ''}` : 'Clear Pins'}
              </Text>
            </Pressable>
          </View>
          
          {/* Center Content: Build Farm Button */}
          <View style={styles.controlPanelContent}>
            <Pressable
              style={({ pressed }) => [
                styles.buildFarmButton,
                (pins.length < 3 || isBuildingFarm) && styles.buildFarmButtonDisabled,
                pressed && pins.length >= 3 && !isBuildingFarm && styles.buildFarmButtonPressed,
              ]}
              onPress={handleBuildFarm}
              disabled={pins.length < 3 || isBuildingFarm}
            >
              <Text style={[
                styles.buildFarmButtonText,
                (pins.length < 3 || isBuildingFarm) && styles.buildFarmButtonTextDisabled,
              ]}>
                {isBuildingFarm ? 'Building...' : 'Build Farm'}
              </Text>
            </Pressable>
            
            {pins.length < 3 && pins.length > 0 && (
              <Text style={styles.hintText}>
                Need {3 - pins.length} more pin{3 - pins.length !== 1 ? 's' : ''}
              </Text>
            )}
          </View>
        </View>

        {/* Next Button Control Panel */}
        <View style={styles.nextControlPanel}>
          <Pressable
            style={({ pressed }) => [
              styles.nextButton,
              farms.length === 0 && styles.nextButtonDisabled,
              pressed && farms.length > 0 && styles.nextButtonPressed,
            ]}
            onPress={() => {
              if (onNavigateNext) {
                onNavigateNext(farms);
              }
            }}
            disabled={farms.length === 0}
          >
            <Text style={[
              styles.nextButtonText,
              farms.length === 0 && styles.nextButtonTextDisabled,
            ]}>
              Next
            </Text>
          </Pressable>
        </View>
      </View>
      </SafeAreaView>

      {/* Farms List Modal */}
      <Modal
        visible={farmsModalVisible}
        transparent={true}
        animationType="fade"
        statusBarTranslucent={true}
        onRequestClose={() => setFarmsModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <View style={{ width: 28 }} />
              <Text style={styles.modalTitle}>Farms ({farms.length})</Text>
              <Pressable
                style={styles.modalCloseButton}
                onPress={() => setFarmsModalVisible(false)}
              >
                <Text style={styles.modalCloseText}>✕</Text>
              </Pressable>
            </View>
            
            {farms.length === 0 ? (
              <Text style={styles.emptyText}>No farms created yet. Place 3+ pins on the map and tap "Build Farm".</Text>
            ) : (
              <View style={[
                styles.farmsListContainer,
                { height: Math.min(farms.length, 3) * 60 } // 60px per farm item, max 3 visible
              ]}>
                <FlatList
                  data={farms}
                  keyExtractor={(item) => item.id}
                  showsVerticalScrollIndicator={true}
                  persistentScrollbar={true}
                  renderItem={({ item, index }) => (
                    <Pressable
                      style={({ pressed }) => [
                        styles.farmItem,
                        pressed && styles.farmItemPressed,
                      ]}
                      onPress={() => handleFarmSelect(item)}
                    >
                      <View style={styles.farmItemInfo}>
                        <Text style={styles.farmItemText}>
                          {item.properties.name}
                        </Text>
                        <Text style={styles.farmItemSubtext}>
                          {item.properties.pinCount} pins • Tap to edit
                        </Text>
                      </View>
                      <Pressable
                        style={styles.deleteButton}
                        onPress={(e) => {
                          e.stopPropagation();
                          handleDeleteFarm(item.id);
                        }}
                        onStartShouldSetResponder={() => true}
                      >
                        <Text style={styles.deleteButtonText}>Delete</Text>
                      </Pressable>
                    </Pressable>
                  )}
                />
              </View>
            )}
          </View>
        </View>
      </Modal>

      {/* Farm Detail Modal */}
      <Modal
        visible={farmDetailModalVisible}
        transparent={true}
        animationType="fade"
        statusBarTranslucent={true}
        onRequestClose={() => setFarmDetailModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContentDetail}>
            <View style={styles.modalHeader}>
              <Pressable
                style={styles.modalBackButton}
                onPress={() => {
                  setFarmDetailModalVisible(false);
                  setFarmsModalVisible(true);
                }}
              >
                <Text style={styles.modalBackText}>←</Text>
              </Pressable>
              <Text style={styles.modalTitle}>Farm Details</Text>
              <Pressable
                style={styles.modalCloseButton}
                onPress={() => {
                  setFarmDetailModalVisible(false);
                  setSelectedFarm(null);
                }}
              >
                <Text style={styles.modalCloseText}>✕</Text>
              </Pressable>
            </View>
            
            {selectedFarm && (
              <ScrollView 
                style={styles.farmDetailScroll}
                showsVerticalScrollIndicator={true}
                persistentScrollbar={true}
              >
                {/* Editable Name */}
                <Text style={styles.fieldLabel}>Farm Name:</Text>
                <TextInput
                  style={styles.nameInput}
                  value={editingFarmName}
                  onChangeText={setEditingFarmName}
                  onBlur={handleFarmNameChange}
                  placeholder="Enter farm name"
                  placeholderTextColor="#999"
                />
                
                {/* Pin List */}
                <Text style={styles.fieldLabel}>
                  Pins ({selectedFarm.properties.pinCount}):
                </Text>
                {selectedFarm.geometry.coordinates[0].slice(0, -1).map((coord, index) => (
                  <View key={index} style={styles.pinItem}>
                    <Text style={styles.pinLabel}>Pin {index + 1}:</Text>
                    {editingPinIndex === index ? (
                      <View style={styles.pinEditContainer}>
                        <View style={styles.coordInputRow}>
                          <Text style={styles.coordLabel}>Lat:</Text>
                          <TextInput
                            style={styles.coordInput}
                            value={editingLat}
                            onChangeText={setEditingLat}
                            keyboardType="numeric"
                            placeholder="Latitude"
                          />
                        </View>
                        <View style={styles.coordInputRow}>
                          <Text style={styles.coordLabel}>Lng:</Text>
                          <TextInput
                            style={styles.coordInput}
                            value={editingLng}
                            onChangeText={setEditingLng}
                            keyboardType="numeric"
                            placeholder="Longitude"
                          />
                        </View>
                        <View style={styles.pinEditButtons}>
                          <Pressable
                            style={styles.saveButton}
                            onPress={handleSavePinEdit}
                          >
                            <Text style={styles.saveButtonText}>Save</Text>
                          </Pressable>
                          <Pressable
                            style={styles.cancelButton}
                            onPress={handleCancelPinEdit}
                          >
                            <Text style={styles.cancelButtonText}>Cancel</Text>
                          </Pressable>
                        </View>
                      </View>
                    ) : (
                      <Pressable
                        style={styles.coordDisplay}
                        onPress={() => handlePinEdit(index, coord)}
                      >
                        <Text style={styles.coordText}>
                          {coord[1].toFixed(6)}, {coord[0].toFixed(6)}
                        </Text>
                        <Text style={styles.tapToEdit}>Tap to edit</Text>
                      </Pressable>
                    )}
                  </View>
                ))}
              </ScrollView>
            )}
          </View>
        </View>
      </Modal>

      {/* Confirmation Modal */}
      <Modal
        visible={confirmModalVisible}
        transparent={true}
        animationType="fade"
        statusBarTranslucent={true}
        onRequestClose={() => setConfirmModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.confirmModal}>
            <Text style={styles.confirmTitle}>{confirmModalConfig.title}</Text>
            <Text style={styles.confirmMessage}>{confirmModalConfig.message}</Text>
            <View style={styles.confirmButtons}>
              <Pressable
                style={({ pressed }) => [
                  styles.confirmButton,
                  styles.confirmButtonCancel,
                  pressed && styles.confirmButtonPressed,
                ]}
                onPress={() => setConfirmModalVisible(false)}
              >
                <Text style={styles.confirmButtonText}>Cancel</Text>
              </Pressable>
              <Pressable
                style={({ pressed }) => [
                  styles.confirmButton,
                  styles.confirmButtonDelete,
                  pressed && styles.confirmButtonPressed,
                ]}
                onPress={() => {
                  setConfirmModalVisible(false);
                  confirmModalConfig.onConfirm();
                }}
              >
                <Text style={styles.confirmButtonText}>Confirm</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
      
      {/* Error Modal */}
      <Modal
        visible={errorModalVisible}
        transparent={true}
        animationType="fade"
        statusBarTranslucent={true}
        onRequestClose={() => setErrorModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.errorModal}>
            <Text style={styles.errorTitle}>{errorModalConfig.title}</Text>
            <Text style={styles.errorMessage}>{errorModalConfig.message}</Text>
            <Pressable
              style={({ pressed }) => [
                styles.errorButton,
                pressed && styles.errorButtonPressed,
              ]}
              onPress={() => setErrorModalVisible(false)}
            >
              <Text style={styles.errorButtonText}>OK</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  backButton: {
    width: 36,
    height: 36,
    borderRadius: 4,
    backgroundColor: COLORS.buttonBg,
    borderWidth: 2,
    borderColor: COLORS.buttonBorder,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 2, height: 3 },
    shadowOpacity: 0.35,
    shadowRadius: 3,
    elevation: 6,
  },
  backButtonPressed: {
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0,
    elevation: 0,
    transform: [{ translateY: 2 }],
  },
  backButtonText: {
    color: '#FFFFFF',
    fontSize: 20,
    fontWeight: 'bold',
    textAlign: 'center',
    includeFontPadding: false,
    textAlignVertical: 'center',
    lineHeight: 20,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingTop: Platform.OS === 'ios' ? 50 : 45,
    paddingBottom: 10,
    paddingHorizontal: 16,
  },
  headerCenter: {
    flex: 1,
    alignItems: 'center',
    marginRight: 36,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: COLORS.text,
    textAlign: 'center',
  },
  headerSubtitle: {
    fontSize: 14,
    color: COLORS.text,
    opacity: 0.7,
    marginTop: 2,
  },
  clearButton: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 4,
    backgroundColor: '#C54B4B',
    borderWidth: 2,
    borderColor: '#A03A3A',
    shadowColor: '#000',
    shadowOffset: { width: 2, height: 3 },
    shadowOpacity: 0.35,
    shadowRadius: 3,
    elevation: 6,
  },
  clearButtonDisabled: {
    backgroundColor: '#A0A0A0',
    borderColor: '#808080',
    shadowOpacity: 0.15,
    elevation: 2,
  },
  clearButtonPressed: {
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0,
    elevation: 0,
    transform: [{ translateY: 2 }],
  },
  clearButtonText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: 'bold',
  },
  clearButtonTextDisabled: {
    color: '#E0E0E0',
  },
  instructionBar: {
    backgroundColor: 'rgba(90, 85, 78, 0.9)',
    paddingVertical: 8,
    paddingHorizontal: 15,
    alignItems: 'center',
  },
  instructionText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '500',
  },
  mapContainer: {
    flex: 1,
    overflow: 'hidden',
  },
  map: {
    flex: 1,
  },
  buildingOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.35)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 20,
  },
  buildingOverlayText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: 'bold',
    marginTop: 12,
  },
  buildingOverlaySubtext: {
    color: '#E0E0E0',
    fontSize: 12,
    textAlign: 'center',
    marginTop: 6,
    lineHeight: 16,
  },
  controlPanel: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    width: '60%',
    height: '30%',
    backgroundColor: 'rgba(245, 240, 230, 0.95)',
    borderTopWidth: 4,
    borderLeftWidth: 4,
    borderTopColor: '#5A554E',
    borderLeftColor: '#5A554E',
    padding: 12,
    shadowColor: '#000',
    shadowOffset: { width: -4, height: -4 },
    shadowOpacity: 0.4,
    shadowRadius: 8,
    elevation: 12,
  },
  controlPanelHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  controlPanelContent: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  controlPanelText: {
    fontSize: 14,
    color: COLORS.text,
    fontWeight: 'bold',
  },
  // Next Button Control Panel
  nextControlPanel: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    width: '40%',
    backgroundColor: 'rgba(245, 240, 230, 0.95)',
    borderTopWidth: 4,
    borderTopColor: '#5A554E',
    padding: 12,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.4,
    shadowRadius: 8,
    elevation: 12,
  },
  nextButton: {
    paddingHorizontal: 30,
    paddingVertical: 12,
    borderRadius: 4,
    backgroundColor: '#4A7C59',
    borderWidth: 2,
    borderColor: '#3A6249',
    shadowColor: '#000',
    shadowOffset: { width: 2, height: 3 },
    shadowOpacity: 0.35,
    shadowRadius: 3,
    elevation: 6,
  },
  nextButtonDisabled: {
    backgroundColor: '#A0A0A0',
    borderColor: '#808080',
    shadowOpacity: 0.15,
    elevation: 2,
  },
  nextButtonPressed: {
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0,
    elevation: 0,
    transform: [{ translateY: 2 }],
  },
  nextButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: 'bold',
  },
  nextButtonTextDisabled: {
    color: '#E0E0E0',
  },
  buildFarmButton: {
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 4,
    backgroundColor: '#4A7C59',
    borderWidth: 2,
    borderColor: '#3A6249',
    shadowColor: '#000',
    shadowOffset: { width: 2, height: 3 },
    shadowOpacity: 0.35,
    shadowRadius: 3,
    elevation: 6,
  },
  buildFarmButtonDisabled: {
    backgroundColor: '#A0A0A0',
    borderColor: '#808080',
    shadowOpacity: 0.15,
    elevation: 2,
  },
  buildFarmButtonPressed: {
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0,
    elevation: 0,
    transform: [{ translateY: 2 }],
  },
  buildFarmButtonText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: 'bold',
  },
  buildFarmButtonTextDisabled: {
    color: '#E0E0E0',
  },
  hintText: {
    fontSize: 11,
    color: COLORS.text,
    opacity: 0.6,
    marginTop: 4,
    fontStyle: 'italic',
  },
  // Farms Button Styles
  farmsButton: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 4,
    backgroundColor: '#5A7F8B',
    borderWidth: 2,
    borderColor: '#4A6F7B',
    shadowColor: '#000',
    shadowOffset: { width: 2, height: 3 },
    shadowOpacity: 0.35,
    shadowRadius: 3,
    elevation: 6,
  },
  farmsButtonPressed: {
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0,
    elevation: 0,
    transform: [{ translateY: 2 }],
  },
  farmsButtonText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: 'bold',
  },
  // Modal Styles
  modalOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalContent: {
    width: '85%',
    backgroundColor: COLORS.background,
    borderRadius: 8,
    borderWidth: 3,
    borderColor: '#5A554E',
    shadowColor: '#000',
    shadowOffset: { width: 4, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 8,
    elevation: 12,
  },
  modalContentDetail: {
    width: '85%',
    height: '60%',
    backgroundColor: COLORS.background,
    borderRadius: 8,
    borderWidth: 3,
    borderColor: '#5A554E',
    shadowColor: '#000',
    shadowOffset: { width: 4, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 8,
    elevation: 12,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#5A554E',
    paddingHorizontal: 15,
    paddingVertical: 12,
  },
  modalTitle: {
    flex: 1,
    fontSize: 18,
    fontWeight: 'bold',
    color: '#FFFFFF',
    textAlign: 'center',
  },
  modalCloseButton: {
    width: 28,
    height: 28,
    borderRadius: 4,
    backgroundColor: '#C54B4B',
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalCloseText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: 'bold',
  },
  modalBackButton: {
    width: 28,
    height: 28,
    borderRadius: 4,
    backgroundColor: '#6B9080',
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalBackText: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: 'bold',
  },
  emptyText: {
    fontSize: 14,
    color: COLORS.text,
    textAlign: 'center',
    paddingVertical: 30,
    fontStyle: 'italic',
    opacity: 0.7,
  },
  farmsList: {
    flexGrow: 1,
    flexShrink: 1,
  },
  farmsListContainer: {
    // Height is set dynamically in the component
  },
  farmItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 15,
    paddingVertical: 12,
    height: 60, // Fixed height for calculation
    borderBottomWidth: 1,
    borderBottomColor: '#D0C8B8',
  },
  farmItemPressed: {
    backgroundColor: 'rgba(107, 144, 128, 0.2)',
  },
  farmItemInfo: {
    flex: 1,
  },
  farmItemText: {
    fontSize: 16,
    color: COLORS.text,
    fontWeight: '500',
  },
  farmItemSubtext: {
    fontSize: 12,
    color: COLORS.text,
    opacity: 0.6,
    marginTop: 2,
  },
  deleteButton: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 4,
    backgroundColor: '#C54B4B',
  },
  deleteButtonText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: 'bold',
  },
  farmDetailScroll: {
    flex: 1,
    padding: 15,
  },
  fieldLabel: {
    fontSize: 14,
    color: COLORS.text,
    fontWeight: 'bold',
    marginTop: 10,
    marginBottom: 6,
  },
  nameInput: {
    borderWidth: 2,
    borderColor: '#5A554E',
    borderRadius: 4,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
    backgroundColor: '#FFFFFF',
    color: COLORS.text,
  },
  pinItem: {
    backgroundColor: '#FFFFFF',
    borderRadius: 4,
    borderWidth: 1,
    borderColor: '#D0C8B8',
    padding: 10,
    marginBottom: 8,
  },
  pinLabel: {
    fontSize: 13,
    fontWeight: 'bold',
    color: COLORS.text,
    marginBottom: 4,
  },
  coordDisplay: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  coordText: {
    fontSize: 14,
    color: '#5A554E',
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  tapToEdit: {
    fontSize: 10,
    color: '#6B9080',
    fontStyle: 'italic',
  },
  pinEditContainer: {
    marginTop: 4,
  },
  coordInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 6,
  },
  coordLabel: {
    width: 35,
    fontSize: 12,
    color: COLORS.text,
    fontWeight: '500',
  },
  coordInput: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#5A554E',
    borderRadius: 4,
    paddingHorizontal: 8,
    paddingVertical: 6,
    fontSize: 14,
    backgroundColor: '#FFFFFF',
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  pinEditButtons: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 8,
    marginTop: 6,
  },
  saveButton: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 4,
    backgroundColor: '#4A7C59',
  },
  saveButtonText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: 'bold',
  },
  cancelButton: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 4,
    backgroundColor: '#808080',
  },
  cancelButtonText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: 'bold',
  },
  // Confirmation Modal Styles
  confirmModal: {
    width: '80%',
    backgroundColor: COLORS.background,
    borderRadius: 8,
    borderWidth: 3,
    borderColor: '#5A554E',
    padding: 20,
    shadowColor: '#000',
    shadowOffset: { width: 4, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 8,
    elevation: 12,
  },
  confirmTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: COLORS.text,
    textAlign: 'center',
    marginBottom: 12,
  },
  confirmMessage: {
    fontSize: 14,
    color: COLORS.text,
    textAlign: 'center',
    marginBottom: 20,
    lineHeight: 20,
  },
  confirmButtons: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 12,
  },
  confirmButton: {
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 4,
    borderWidth: 2,
    minWidth: 100,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 2, height: 3 },
    shadowOpacity: 0.35,
    shadowRadius: 3,
    elevation: 6,
  },
  confirmButtonCancel: {
    backgroundColor: '#808080',
    borderColor: '#666666',
  },
  confirmButtonDelete: {
    backgroundColor: '#C54B4B',
    borderColor: '#A03A3A',
  },
  confirmButtonPressed: {
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0,
    elevation: 0,
    transform: [{ translateY: 2 }],
  },
  confirmButtonText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: 'bold',
  },
  // Error Modal Styles
  errorModal: {
    width: '80%',
    backgroundColor: COLORS.background,
    borderRadius: 8,
    borderWidth: 3,
    borderColor: '#C54B4B',
    padding: 20,
    shadowColor: '#000',
    shadowOffset: { width: 4, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 8,
    elevation: 12,
  },
  errorTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#000000',
    textAlign: 'center',
    marginBottom: 12,
  },
  errorMessage: {
    fontSize: 14,
    color: '#000000',
    textAlign: 'center',
    marginBottom: 20,
    lineHeight: 20,
  },
  errorButton: {
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 4,
    borderWidth: 2,
    backgroundColor: '#3B82F6',
    borderColor: '#2563EB',
    alignSelf: 'center',
    minWidth: 100,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 2, height: 3 },
    shadowOpacity: 0.35,
    shadowRadius: 3,
    elevation: 6,
  },
  errorButtonPressed: {
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0,
    elevation: 0,
    transform: [{ translateY: 2 }],
  },
  errorButtonText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: 'bold',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    marginTop: 16,
    fontSize: 16,
    color: COLORS.text,
  },
  errorContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 40,
  },
  errorText: {
    fontSize: 18,
    fontWeight: 'bold',
    color: COLORS.text,
    textAlign: 'center',
    marginBottom: 8,
  },
  errorSubtext: {
    fontSize: 14,
    color: COLORS.text,
    textAlign: 'center',
    opacity: 0.7,
  },
});
export default MapScreen;
