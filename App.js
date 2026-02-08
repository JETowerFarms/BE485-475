import React, { useState, useEffect } from 'react';
import { StatusBar, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { loadFarms as loadFarmsFromStorage, saveFarms as saveFarmsToStorage } from './src/utils/farmStorage';
import { loadLocation } from './src/utils/locationStorage';
import { buildApiUrl } from './src/config/apiConfig';
import HomeScreen from './src/screens/HomeScreen';
import CitySelectionScreen from './src/screens/CitySelectionScreen';
import MapScreen from './src/screens/MapScreen';
import FarmDescriptionScreen from './src/screens/FarmDescriptionScreen';
import LinearOptimizationScreen from './src/screens/LinearOptimizationScreen';
import ModelEditorScreen from './src/screens/ModelEditorScreen';
import LoginScreen from './src/screens/LoginScreen';
// import TestPathRendering from './TestPathRendering'; // Uncomment to test

// Set to true to show the test component
const SHOW_TEST = false;

export default function App() {
  const [currentScreen, setCurrentScreen] = useState('home');
  const [selectedCounty, setSelectedCounty] = useState(null);
  const [selectedCity, setSelectedCity] = useState(null);
  const [currentUser, setCurrentUser] = useState(null);
  const [farms, setFarms] = useState([]);
  const [isLoadingFarms, setIsLoadingFarms] = useState(true);
  const [mcdData, setMcdData] = useState(null);
  const [isLoadingMcdData, setIsLoadingMcdData] = useState(false);
  const [savedLocation, setSavedLocation] = useState(null);
  const [isLoadingSavedLocation, setIsLoadingSavedLocation] = useState(true);
  useEffect(() => {
    const loadSavedLocation = async () => {
      const storedLocation = await loadLocation();
      if (storedLocation?.county && storedLocation?.city) {
        setSavedLocation(storedLocation);
      }
      setIsLoadingSavedLocation(false);
    };

    loadSavedLocation();
  }, []);


  // Load farms from storage on app start
  useEffect(() => {
    const initializeFarms = async () => {
      const savedFarms = await loadFarmsFromStorage();
      setFarms(savedFarms);
      setIsLoadingFarms(false);
    };
    initializeFarms();
  }, []);

  // Load MCD data once when needed
  useEffect(() => {
    if ((currentScreen === 'citySelection' || currentScreen === 'map') && !mcdData && !isLoadingMcdData) {
      const fetchMcdData = async () => {
        try {
          setIsLoadingMcdData(true);
          const response = await fetch(buildApiUrl('/geo/michigan-mcd'));
          if (!response.ok) {
            throw new Error('Failed to fetch MCD data');
          }
          const data = await response.json();
          console.log('App: MCD data loaded:', data.features?.length, 'features');
          setMcdData(data);
        } catch (error) {
          console.error('App: Error fetching MCD data:', error);
        } finally {
          setIsLoadingMcdData(false);
        }
      };
      fetchMcdData();
    }
  }, [currentScreen, mcdData, isLoadingMcdData]);

  // Update farms state and persist to storage
  const updateFarms = async (farmsData) => {
    setFarms(farmsData);
    await saveFarmsToStorage(farmsData);
  };

  const handleNavigateToCity = (county, city = null) => {
    setSelectedCounty(county);
    if (city) {
      setSelectedCity(city);
      setCurrentScreen('map');
    } else {
      setCurrentScreen('citySelection');
    }
  };
  const handleResumeSavedLocation = () => {
    if (savedLocation?.county && savedLocation?.city) {
      setSelectedCounty(savedLocation.county);
      setSelectedCity(savedLocation.city);
      setCurrentScreen('map');
    }
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

  const handleNavigateToNextForm = (updatedFarms) => {
    if (Array.isArray(updatedFarms)) {
      updateFarms(updatedFarms);
    }
    setCurrentScreen('linearOptimization');
  };

  const handleBackToFarmDescription = () => {
    setCurrentScreen('farmDescription');
  };

  const handleLoginSuccess = (user) => {
    setCurrentUser(user);
    setCurrentScreen('home');
  };

  const handleNavigateToModelEditor = () => {
    setCurrentScreen('modelEditor');
  };

  // Uncomment below to test path rendering directly
  // if (SHOW_TEST) return <TestPathRendering />;

  return (
    <SafeAreaProvider>
      <View style={{ flex: 1 }}>
        <StatusBar barStyle="dark-content" backgroundColor="#ffffff" />
        {!currentUser ? (
          <LoginScreen onLoginSuccess={handleLoginSuccess} />
        ) : currentScreen === 'home' ? (
          <HomeScreen 
            onNavigateToCity={handleNavigateToCity}
            savedLocation={savedLocation}
            isLoadingInitial={isLoadingSavedLocation || isLoadingFarms}
            onResumeSavedLocation={handleResumeSavedLocation}
          />
        ) : currentScreen === 'citySelection' && selectedCounty ? (
          <CitySelectionScreen 
            county={selectedCounty}
            mcdData={mcdData}
            isLoadingMcdData={isLoadingMcdData}
            onNavigateBack={handleBackToHome}
            onNavigateToPin={(city) => handleNavigateToPin(selectedCounty, city)}
          />
        ) : currentScreen === 'map' && selectedCounty && selectedCity ? (
          <MapScreen
            county={selectedCounty}
            city={selectedCity}
            mcdData={mcdData}
            isLoadingMcdData={isLoadingMcdData}
            initialFarms={farms}
            onNavigateBack={handleBackToCitySelection}
            onNavigateNext={handleNavigateToFarmDescription}
            onFarmsUpdate={updateFarms}
          />
        ) : currentScreen === 'farmDescription' && selectedCounty && selectedCity ? (
          <FarmDescriptionScreen
            farms={farms}
            county={selectedCounty}
            city={selectedCity}
            onNavigateBack={handleBackToMap}
            onNavigateNext={handleNavigateToNextForm}
            onFarmsUpdate={updateFarms}
            onOpenModelEditor={handleNavigateToModelEditor}
          />
        ) : currentScreen === 'linearOptimization' ? (
          <LinearOptimizationScreen
            farms={farms}
            onBack={handleBackToFarmDescription}
          />
        ) : currentScreen === 'modelEditor' ? (
          <ModelEditorScreen
            onBack={handleBackToFarmDescription}
          />
        ) : null}
      </View>
    </SafeAreaProvider>
  );
}
