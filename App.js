import React, { useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import HomeScreen from './src/screens/HomeScreen';
import CitySelectionScreen from './src/screens/CitySelectionScreen';
import MapScreen from './src/screens/MapScreen';
// import TestPathRendering from './TestPathRendering'; // Uncomment to test

// Set to true to show the test component
const SHOW_TEST = false;

export default function App() {
  const [currentScreen, setCurrentScreen] = useState('home');
  const [selectedCounty, setSelectedCounty] = useState(null);
  const [selectedCity, setSelectedCity] = useState(null);

  const handleNavigateToCity = (county) => {
    setSelectedCounty(county);
    setCurrentScreen('citySelection');
  };

  const handleNavigateToPin = (county, city) => {
    setSelectedCity(city);
    setCurrentScreen('map');
  };

  const handleBackToHome = () => {
    setCurrentScreen('home');
    setSelectedCounty(null);
    setSelectedCity(null);
  };

  const handleBackToCitySelection = () => {
    setCurrentScreen('citySelection');
    setSelectedCity(null);
  };

  // Uncomment below to test path rendering directly
  // if (SHOW_TEST) return <TestPathRendering />;

  return (
    <>
      <StatusBar style="dark" />
      {currentScreen === 'home' && (
        <HomeScreen onNavigateToCity={handleNavigateToCity} />
      )}
      {currentScreen === 'citySelection' && selectedCounty && (
        <CitySelectionScreen 
          county={selectedCounty} 
          onNavigateBack={handleBackToHome}
          onNavigateToPin={(city) => handleNavigateToPin(selectedCounty, city)}
        />
      )}
      {currentScreen === 'map' && selectedCounty && selectedCity && (
        <MapScreen
          county={selectedCounty}
          city={selectedCity}
          onNavigateBack={handleBackToCitySelection}
        />
      )}
    </>
  );
}
