import React, { useRef, useEffect, useState, useMemo } from 'react';
import { View, StyleSheet } from 'react-native';
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
      <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
      <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
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

        // Satellite tile layer (ESRI World Imagery - free)
        L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
          maxZoom: 19,
        }).addTo(map);

        // Store markers
        var markers = {};

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
          markers[pin.id] = marker;
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
          if (markers[pinId]) {
            map.removeLayer(markers[pinId]);
            delete markers[pinId];
          }
        };

        // Update all pins (used for initial sync and when farm pins are added)
        window.updatePins = function(newPins) {
          Object.keys(markers).forEach(function(id) {
            map.removeLayer(markers[id]);
          });
          markers = {};
          newPins.forEach(function(pin) {
            addMarker(pin);
          });
        };

        window.setCenter = function(lat, lng) {
          map.setView([lat, lng], 12);
        };

        // Signal ready
        window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'ready' }));
      </script>
    </body>
    </html>
  `, []); // Empty deps - never recreate HTML

  // Sync all pins when they change (farm pins + current pins)
  const prevPinsRef = useRef([]);
  useEffect(() => {
    if (webViewRef.current && mapReady) {
      // Check if pins array actually changed
      const pinsChanged = JSON.stringify(pins) !== JSON.stringify(prevPinsRef.current);
      if (pinsChanged) {
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
      
      if (data.type === 'ready') {
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
      console.error('WebView message error:', e);
    }
  };

  return (
    <View style={[styles.container, style]} pointerEvents="box-none">
      <WebView
        ref={webViewRef}
        source={{ html: htmlContent }}
        style={styles.webview}
        onMessage={handleMessage}
        javaScriptEnabled={true}
        domStorageEnabled={true}
        scrollEnabled={false}
        bounces={false}
        overScrollMode="never"
        nestedScrollEnabled={false}
        showsHorizontalScrollIndicator={false}
        showsVerticalScrollIndicator={false}
        androidLayerType="hardware"
        mixedContentMode="always"
        allowsInlineMediaPlayback={true}
        mediaPlaybackRequiresUserAction={false}
        startInLoadingState={false}
        originWhitelist={['*']}
        onContentProcessDidTerminate={() => {
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
