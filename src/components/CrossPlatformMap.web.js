import React, { useEffect, useRef, useState } from 'react';
import { View, StyleSheet } from 'react-native';
import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet';
import L from 'leaflet';

// Fix for default marker icons in webpack
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon-2x.png',
  iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png',
});

// Custom pin icon
const createPinIcon = (color = '#C54B4B') => {
  return L.divIcon({
    className: 'custom-pin',
    html: `<div style="
      width: 24px;
      height: 24px;
      background-color: ${color};
      border: 3px solid #FFFFFF;
      border-radius: 50% 50% 50% 0;
      transform: rotate(-45deg);
      box-shadow: 2px 2px 4px rgba(0,0,0,0.3);
    "></div>`,
    iconSize: [24, 24],
    iconAnchor: [12, 24],
    popupAnchor: [0, -24],
  });
};

// Component to handle map center changes
const MapController = ({ center, zoom }) => {
  const map = useMap();
  
  useEffect(() => {
    if (center) {
      map.setView(center, zoom);
    }
  }, [center, zoom, map]);
  
  return null;
};

const CrossPlatformMap = ({ 
  region, 
  pins = [], 
  onPinAdd, 
  onPinRemove,
  onMapPress,
  style,
}) => {
  const mapRef = useRef(null);
  const [mapReady, setMapReady] = useState(false);

  const center = region ? [region.latitude, region.longitude] : [43.0, -84.5];
  const zoom = 12; // Fixed zoom level for Screen Three

  const handleMapClick = (e) => {
    if (onMapPress) {
      onMapPress({
        latitude: e.latlng.lat,
        longitude: e.latlng.lng,
      });
    }
    if (onPinAdd) {
      onPinAdd({
        latitude: e.latlng.lat,
        longitude: e.latlng.lng,
        id: Date.now().toString(),
      });
    }
  };

  return (
    <View style={[styles.container, style]}>
      <link
        rel="stylesheet"
        href="https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/leaflet.css"
      />
      <MapContainer
        ref={mapRef}
        center={center}
        zoom={zoom}
        style={{ width: '100%', height: '100%' }}
        whenReady={() => setMapReady(true)}
        onClick={handleMapClick}
      >
        <MapController center={center} zoom={zoom} />
        
        {/* Satellite imagery from ESRI */}
        <TileLayer
          url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
          attribution='&copy; <a href="https://www.esri.com/">Esri</a>'
          maxZoom={19}
        />
        
        {/* Optional: Add labels on top of satellite */}
        <TileLayer
          url="https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}"
          attribution=''
          maxZoom={19}
        />

        {/* Render pins */}
        {pins.map((pin, index) => (
          <Marker
            key={pin.id || index}
            position={[pin.latitude, pin.longitude]}
            icon={createPinIcon(pin.color || '#C54B4B')}
            eventHandlers={{
              click: () => {
                if (onPinRemove) {
                  onPinRemove(pin);
                }
              },
            }}
          >
            {pin.title && (
              <Popup>
                <span>{pin.title}</span>
              </Popup>
            )}
          </Marker>
        ))}
      </MapContainer>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    overflow: 'hidden',
  },
});

export default CrossPlatformMap;
