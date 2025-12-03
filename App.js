import React, { useState, useEffect } from 'react';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { loadFarms as loadFarmsFromStorage, saveFarms as saveFarmsToStorage } from './src/utils/farmStorage';
import HomeScreen from './src/screens/HomeScreen';
import CitySelectionScreen from './src/screens/CitySelectionScreen';
import MapScreen from './src/screens/MapScreen';
import FarmDescriptionScreen from './src/screens/FarmDescriptionScreen';
// import TestPathRendering from './TestPathRendering'; // Uncomment to test

// Set to true to show the test component
const SHOW_TEST = false;

export default function App() {
  const [currentScreen, setCurrentScreen] = useState('home');
  const [selectedCounty, setSelectedCounty] = useState(null);
  const [selectedCity, setSelectedCity] = useState(null);
  const [farms, setFarms] = useState([]);
  const [isLoadingFarms, setIsLoadingFarms] = useState(true);

  // Load farms from storage on app start
  useEffect(() => {
    const initializeFarms = async () => {
      const savedFarms = await loadFarmsFromStorage();
      setFarms(savedFarms);
      setIsLoadingFarms(false);
    };
    initializeFarms();
  }, []);

  // Update farms state and persist to storage
  const updateFarms = async (farmsData) => {
    setFarms(farmsData);
    await saveFarmsToStorage(farmsData);
  };

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

  const handleNavigateToFarmDescription = (farmsData) => {
    updateFarms(farmsData);
    setCurrentScreen('farmDescription');
  };

  const handleBackToMap = () => {
    setCurrentScreen('map');
  };

  const handleDeleteFarm = (farmIndex) => {
    const updatedFarms = farms.filter((_, index) => index !== farmIndex);
    updateFarms(updatedFarms);
  };

  const handleNavigateToNextForm = (farmDescription) => {
    // TODO: Store farm description and navigate to next form
    console.log('Farm description:', farmDescription);
  };

  // Uncomment below to test path rendering directly
  // if (SHOW_TEST) return <TestPathRendering />;

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
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
          initialFarms={farms}
          onNavigateBack={handleBackToCitySelection}
          onNavigateNext={handleNavigateToFarmDescription}
          onFarmsUpdate={updateFarms}
        />
      )}
      {currentScreen === 'farmDescription' && selectedCounty && selectedCity && (
        <FarmDescriptionScreen
          farms={farms}
          county={selectedCounty}
          city={selectedCity}
          onNavigateBack={handleBackToMap}
          onNavigateNext={handleNavigateToNextForm}
        />
      )}
    </GestureHandlerRootView>
  );
}
