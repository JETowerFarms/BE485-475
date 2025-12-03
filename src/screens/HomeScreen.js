import React, { useState } from 'react';
import { 
  View, 
  Text, 
  StyleSheet, 
  Pressable, 
  SafeAreaView,
  StatusBar,
  BackHandler,
} from 'react-native';
import MichiganMap from '../components/MichiganMap';
import { isTargetCounty } from '../data/michiganCounties';

// Color scheme matching the reference design
const COLORS = {
  background: '#F5F0E6',     // Cream/off-white background
  text: '#2C2C2C',           // Dark text
  buttonBorder: '#2C2C2C',   // Button border
  buttonBackground: '#F5F0E6', // Button background (same as page)
  exitRed: '#C54B4B',        // Muted red for exit button
  exitRedBorder: '#A03030',  // Darker red for border
};

const HomeScreen = ({ onNavigateToCity }) => {
  const [selectedCounty, setSelectedCounty] = useState(null);

  const handleCountyPress = (county) => {
    // Single select: toggle selection or select new county
    if (selectedCounty === county.name) {
      setSelectedCounty(null);  // Deselect if tapping same county
    } else {
      setSelectedCounty(county.name);  // Select new county
    }
  };

  const handleNext = () => {
    if (selectedCounty && onNavigateToCity) {
      onNavigateToCity(selectedCounty);
    }
  };

  const handleExit = () => {
    BackHandler.exitApp();
  };

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="dark-content" backgroundColor={COLORS.background} />
      
      {/* Exit Button - Top Left */}
      <Pressable 
        style={({ pressed }) => [styles.exitButton, pressed && styles.exitButtonPressed]}
        onPress={handleExit}
      >
        <Text style={styles.exitButtonText}>✕</Text>
      </Pressable>
      
      <View style={styles.content}>
        {/* Map Container */}
        <View style={styles.mapContainer}>
          <MichiganMap 
            selectedCounty={selectedCounty}
            onCountyPress={handleCountyPress}
          />
        </View>

        {/* Instructions */}
        <Text style={styles.instruction}>
          {selectedCounty ? `${selectedCounty} County` : 'Select a county to start'}
        </Text>

        {/* Next Button */}
        <Pressable 
          style={({ pressed }) => [
            styles.nextButton,
            !selectedCounty && styles.nextButtonDisabled,
            pressed && !(!selectedCounty) && styles.buttonPressed
          ]}
          onPress={handleNext}
          disabled={!selectedCounty}
        >
          <Text style={[
            styles.nextButtonText,
            !selectedCounty && styles.nextButtonTextDisabled
          ]}>
            Next
          </Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  exitButton: {
    position: 'absolute',
    top: 50,
    left: 15,
    zIndex: 100,
    width: 36,
    height: 36,
    borderRadius: 4,
    backgroundColor: COLORS.exitRed,
    borderWidth: 2,
    borderColor: COLORS.exitRedBorder,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 2, height: 3 },
    shadowOpacity: 0.35,
    shadowRadius: 3,
    elevation: 6,
  },
  exitButtonPressed: {
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0,
    elevation: 0,
    transform: [{ translateY: 2 }],
  },
  exitButtonText: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: 'bold',
    textAlign: 'center',
    includeFontPadding: false,
    textAlignVertical: 'center',
    lineHeight: 18,
  },
  content: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 0,
    paddingHorizontal: 0,
  },
  mapContainer: {
    flex: 1,
    width: '100%',
    justifyContent: 'center',
    alignItems: 'center',
    borderTopWidth: 2.5,
    borderLeftWidth: 10,
    borderRightWidth: 1.25,
    borderBottomWidth: 5,
    borderTopColor: '#5A554E',
    borderLeftColor: '#5A554E',
    borderRightColor: '#FFFEF8',
    borderBottomColor: '#FFFEF8',
    backgroundColor: '#E8E4DA',
  },
  instruction: {
    fontSize: 24,
    fontWeight: '400',
    color: COLORS.text,
    textAlign: 'center',
    marginVertical: 10,
    paddingHorizontal: 20,
  },
  nextButton: {
    width: '90%',
    paddingVertical: 18,
    borderWidth: 2,
    borderColor: '#5A7A5A',
    backgroundColor: '#7A9A7A',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
    marginHorizontal: 20,
    // Shadow
    shadowColor: '#000',
    shadowOffset: { width: 2, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 4,
    elevation: 8,
  },
  nextButtonDisabled: {
    borderColor: '#A0A0A0',
    backgroundColor: COLORS.buttonBackground,
    opacity: 0.6,
  },
  nextButtonText: {
    fontSize: 22,
    fontWeight: '500',
    color: '#FFFFFF',
    includeFontPadding: false,
    textAlignVertical: 'center',
    lineHeight: 22,
  },
  nextButtonTextDisabled: {
    color: '#A0A0A0',
  },
  buttonPressed: {
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0,
    shadowRadius: 0,
    elevation: 0,
    transform: [{ translateY: 2 }],
  },
});

export default HomeScreen;
