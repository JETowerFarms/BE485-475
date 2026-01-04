import React, { useRef, useEffect, useState, useMemo } from 'react';
import { View, StyleSheet, Alert, Image } from 'react-native';
import { WebView } from 'react-native-webview';

const CrossPlatformMap = ({ 
  region, 
  pins = [], 
  onPinAdd, 
  onPinRemove,
  onMapPress,
  style,
}) => {
  const webViewRef = useRef(null);
  const [mapReady, setMapReady] = useState(false);
  const initialRegionRef = useRef(region);

  console.log('[CrossPlatformMap] Component rendered with:', {
    regionProvided: !!region,
    pinsCount: pins.length,
    hasOnPinAdd: !!onPinAdd,
    hasOnPinRemove: !!onPinRemove,
    hasOnMapPress: !!onMapPress,
  });

  // Default region centered on Michigan
  const defaultRegion = {
    latitude: 43.0,
    longitude: -84.5,
  };

  // Use initial region for HTML (only set once)
  const center = initialRegionRef.current || defaultRegion;

  // Memoize HTML content so it doesn't change when pins change
  const htmlContent = useMemo(() => `
    <!DOCTYPE html>
    <html>
    <head>
      <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
      <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" 
            onerror="console.error('Failed to load Leaflet CSS')" />
      <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js" 
              onerror="console.error('Failed to load Leaflet JS from CDN')"></script>
      <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        html, body, #map { 
          width: 100%; 
          height: 100%; 
          touch-action: manipulation;
          -webkit-touch-callout: none;
          -webkit-user-select: none;
          user-select: none;
        }
        .leaflet-container {
          touch-action: manipulation;
        }
      </style>
    </head>
    <body>
      <div id="map"></div>
      <script>
        // Debug logging function
        function debugLog(message, data) {
          console.log('[WebView Map]', message, data || '');
          try {
            window.ReactNativeWebView.postMessage(JSON.stringify({
              type: 'debug',
              message: message,
              data: data
            }));
          } catch (e) {
            console.error('Failed to send debug message:', e);
          }
        }

        debugLog('Script starting', 'Checking for Leaflet...');

        var initAttempts = 0;
        var maxAttempts = 100; // 5 seconds max (100 * 50ms)

        // Wait for Leaflet to load before initializing map
        function initializeMap() {
          initAttempts++;
          
          if (typeof L === 'undefined') {
            if (initAttempts >= maxAttempts) {
              debugLog('FATAL: Leaflet failed to load after 5 seconds', 'CDN may be blocked or unreachable');
              window.ReactNativeWebView.postMessage(JSON.stringify({ 
                type: 'error',
                message: 'Leaflet library failed to load. Check network connection or CDN access.'
              }));
              return;
            }
            debugLog('Leaflet not loaded yet (attempt ' + initAttempts + '/' + maxAttempts + ')', 'Retrying in 50ms...');
            setTimeout(initializeMap, 50);
            return;
          }

          debugLog('Leaflet loaded!', 'Version: ' + L.version + ' (after ' + initAttempts + ' attempts)');

          try {
            debugLog('Initializing map at', '${center.latitude}, ${center.longitude}');
            
            // Initialize map
            var map = L.map('map', {
            zoomControl: true,
            attributionControl: false,
            tap: true,
            tapTolerance: 15,
            touchZoom: true,
            dragging: true,
            doubleClickZoom: true,
          }).setView([${center.latitude}, ${center.longitude}], 12);

          debugLog('Map initialized', 'Adding tile layer...');

          // Satellite tile layer (ESRI World Imagery - free)
          var tileLayer = L.tileLayer('https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
            maxZoom: 19,
          });

          tileLayer.on('loading', function() {
            debugLog('Tiles loading', '');
          });

          tileLayer.on('load', function() {
            debugLog('Tiles loaded', '');
          });

          tileLayer.on('tileerror', function(error) {
            debugLog('Tile error', error.error ? error.error.message : 'Unknown tile error');
          });

          tileLayer.addTo(map);

          debugLog('Tile layer added', 'Map setup complete');

          // Store markers
          window.markers = {};

          // Create icon with custom color
          function createIcon(color) {
            var pinColor = color || '#C54B4B';
            var borderColor = pinColor === '#3B82F6' ? '#2563EB' : '#8B2020';
            return L.divIcon({
              className: 'custom-pin',
              html: '<div style="background:' + pinColor + ';width:24px;height:24px;border-radius:50% 50% 50% 0;transform:rotate(-45deg);border:2px solid ' + borderColor + ';box-shadow:0 2px 4px rgba(0,0,0,0.4);"></div>',
              iconSize: [24, 24],
              iconAnchor: [12, 24],
            });
          }

          function addMarker(pin) {
            var icon = createIcon(pin.color);
            var marker = L.marker([pin.latitude, pin.longitude], { icon: icon }).addTo(map);
            window.markers[pin.id] = marker;
            marker.on('click', function(e) {
              L.DomEvent.stopPropagation(e);
              window.ReactNativeWebView.postMessage(JSON.stringify({
                type: 'pinRemove',
                pin: pin
              }));
            });
          }

          // Map click handler
          map.on('click', function(e) {
            window.ReactNativeWebView.postMessage(JSON.stringify({
              type: 'mapClick',
              latitude: e.latlng.lat,
              longitude: e.latlng.lng
            }));
          });

          // Add a single pin without affecting view
          window.addPin = function(pin) {
            addMarker(pin);
          };

          // Remove a single pin
          window.removePin = function(pinId) {
            if (window.markers[pinId]) {
              map.removeLayer(window.markers[pinId]);
              delete window.markers[pinId];
            }
          };

          // Update all pins (used for initial sync and when farm pins are added)
          window.updatePins = function(newPins) {
            Object.keys(window.markers).forEach(function(id) {
              map.removeLayer(window.markers[id]);
            });
            window.markers = {};
            newPins.forEach(function(pin) {
              addMarker(pin);
            });
          };

          window.setCenter = function(lat, lng) {
            map.setView([lat, lng], 12);
          };

          // Signal ready
          debugLog('Sending ready signal', '');
          window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'ready' }));
          debugLog('Ready signal sent', '');
          
        } catch (e) {
          debugLog('ERROR during map initialization', e.message);
        }
      }

      // Global error handler
      window.onerror = function(message, source, lineno, colno, error) {
        debugLog('JavaScript Error', {
          message: message,
          source: source,
          line: lineno,
          column: colno,
          error: error ? error.message : 'Unknown'
        });
        return false;
      };

      // Start initialization
      initializeMap();
      </script>
    </body>
    </html>
  `, []); // Empty deps - never recreate HTML

  console.log('[CrossPlatformMap] HTML content created, center:', center);

  // Dev-only connectivity probe: distinguishes OkHttp fetch vs Fresco image loading.
  useEffect(() => {
    if (!__DEV__) return;

    const leafletUrl = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
    const esriTileUrl = 'https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/0/0/0';

    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(leafletUrl, { method: 'GET' });
        if (!cancelled) {
          console.log('[NetProbe] Leaflet fetch:', res.status, res.ok);
        }
      } catch (e) {
        if (!cancelled) {
          console.error('[NetProbe] Leaflet fetch failed:', e?.message || e);
          Alert.alert('Network issue', 'Failed to reach unpkg.com (Leaflet CDN).');
        }
      }

      try {
        const ok = await Image.prefetch(esriTileUrl);
        if (!cancelled) {
          console.log('[NetProbe] ESRI tile prefetch:', ok);
        }
      } catch (e) {
        if (!cancelled) {
          console.error('[NetProbe] ESRI tile prefetch failed:', e?.message || e);
          Alert.alert('Network issue', 'Failed to prefetch ArcGIS tile image.');
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  // Sync all pins when they change (farm pins + current pins)
  const prevPinsRef = useRef([]);
  useEffect(() => {
    console.log('[CrossPlatformMap] Pins effect triggered:', {
      mapReady,
      pinsCount: pins.length,
      hasWebViewRef: !!webViewRef.current
    });
    
    if (webViewRef.current && mapReady) {
      // Check if pins array actually changed
      const pinsChanged = JSON.stringify(pins) !== JSON.stringify(prevPinsRef.current);
      console.log('[CrossPlatformMap] Pins changed:', pinsChanged);
      
      if (pinsChanged) {
        console.log('[CrossPlatformMap] Injecting pin update with', pins.length, 'pins');
        webViewRef.current.injectJavaScript(`
          window.updatePins(${JSON.stringify(pins)});
          true;
        `);
        prevPinsRef.current = pins;
      }
    }
  }, [mapReady, pins]);

  const handleMessage = (event) => {
    try {
      const data = JSON.parse(event.nativeEvent.data);
      
      // Log all messages from WebView
      if (data.type === 'debug') {
        console.log(`[WebView Debug] ${data.message}`, data.data || '');
      } else {
        console.log('[WebView Message]', data.type, data);
      }
      
      if (data.type === 'ready') {
        console.log('[CrossPlatformMap] Map is ready!');
        setMapReady(true);
      } else if (data.type === 'mapClick') {
        const newPin = {
          latitude: data.latitude,
          longitude: data.longitude,
          id: Date.now().toString(),
        };
        
        // Add pin directly to the map without triggering re-render
        if (webViewRef.current) {
          webViewRef.current.injectJavaScript(`
            window.addPin(${JSON.stringify(newPin)});
            true;
          `);
        }
        
        if (onMapPress) {
          onMapPress({ latitude: data.latitude, longitude: data.longitude });
        }
        if (onPinAdd) {
          onPinAdd(newPin);
        }
      } else if (data.type === 'pinRemove') {
        // Don't remove farm pins (blue pins with farmId)
        if (data.pin.farmId) {
          return; // Don't allow removing farm pins
        }
        
        // Remove pin directly from the map
        if (webViewRef.current) {
          webViewRef.current.injectJavaScript(`
            window.removePin('${data.pin.id}');
            true;
          `);
        }
        
        if (onPinRemove) {
          onPinRemove(data.pin);
        }
      }
    } catch (e) {
      console.error('[WebView] Message parse error:', e, 'Raw data:', event.nativeEvent.data);
    }
  };

  const handleLoadStart = () => {
    console.log('[WebView] Load started');
  };

  const handleLoadEnd = () => {
    console.log('[WebView] Load ended');
  };

  const handleLoadProgress = (event) => {
    console.log('[WebView] Load progress:', event.nativeEvent.progress);
  };

  const handleError = (syntheticEvent) => {
    const { nativeEvent } = syntheticEvent;
    console.error('[WebView] Error occurred:', nativeEvent);
    Alert.alert(
      'WebView Error',
      `Code: ${nativeEvent.code}\nDescription: ${nativeEvent.description}`,
      [{ text: 'OK' }]
    );
  };

  const handleHttpError = (syntheticEvent) => {
    const { nativeEvent } = syntheticEvent;
    console.error('[WebView] HTTP Error:', nativeEvent);
    Alert.alert(
      'WebView HTTP Error',
      `Status: ${nativeEvent.statusCode}\nURL: ${nativeEvent.url}`,
      [{ text: 'OK' }]
    );
  };

  const handleRenderProcessGone = (syntheticEvent) => {
    const { nativeEvent } = syntheticEvent;
    console.error('[WebView] Render process gone:', nativeEvent);
    Alert.alert(
      'WebView Crashed',
      'The map view has crashed and will be reloaded.',
      [{ text: 'OK' }]
    );
    if (webViewRef.current) {
      webViewRef.current.reload();
    }
  };

  return (
    <View style={[styles.container, style]} pointerEvents="box-none">
      <WebView
        ref={webViewRef}
        source={{ html: htmlContent }}
        style={styles.webview}
        onMessage={handleMessage}
        onLoadStart={handleLoadStart}
        onLoadEnd={handleLoadEnd}
        onLoadProgress={handleLoadProgress}
        onError={handleError}
        onHttpError={handleHttpError}
        onRenderProcessGone={handleRenderProcessGone}
        javaScriptEnabled={true}
        domStorageEnabled={true}
        cacheEnabled={false}
        thirdPartyCookiesEnabled={true}
        sharedCookiesEnabled={true}
        scrollEnabled={false}
        bounces={false}
        overScrollMode="never"
        nestedScrollEnabled={false}
        showsHorizontalScrollIndicator={false}
        showsVerticalScrollIndicator={false}
        androidLayerType="hardware"
        androidHardwareAccelerationDisabled={false}
        mixedContentMode="always"
        allowsInlineMediaPlayback={true}
        mediaPlaybackRequiresUserAction={false}
        startInLoadingState={false}
        originWhitelist={['*']}
        allowFileAccess={true}
        allowUniversalAccessFromFileURLs={true}
        onContentProcessDidTerminate={() => {
          console.error('[WebView] Content process terminated');
          // Reload WebView if it crashes
          if (webViewRef.current) {
            webViewRef.current.reload();
          }
        }}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    overflow: 'hidden',
  },
  webview: {
    flex: 1,
    width: '100%',
    height: '100%',
  },
});

export default CrossPlatformMap;
