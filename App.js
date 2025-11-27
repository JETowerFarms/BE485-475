import React, { useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import HomeScreen from './src/screens/HomeScreen';
import CitySelectionScreen from './src/screens/CitySelectionScreen';
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
    // TODO: Navigate to pin placement screen (screen 3)
    console.log('Navigate to pin screen:', county, city);
    // For now, just log - we'll implement screen 3 later
  };

  const handleBackToHome = () => {
    setCurrentScreen('home');
    setSelectedCounty(null);
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
    </>
  );
}
