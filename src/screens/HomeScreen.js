import React, { useState } from 'react';
import { 
  View, 
  Text, 
  StyleSheet, 
  TouchableOpacity, 
  SafeAreaView,
  StatusBar,
} from 'react-native';
import MichiganMap from '../components/MichiganMap';
import { isTargetCounty } from '../data/michiganCounties';

// Color scheme matching the reference design
const COLORS = {
  background: '#F5F0E6',     // Cream/off-white background
  text: '#2C2C2C',           // Dark text
  buttonBorder: '#2C2C2C',   // Button border
  buttonBackground: '#F5F0E6', // Button background (same as page)
};

const HomeScreen = ({ navigation }) => {
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
    if (selectedCounty) {
      // Navigate to next screen with selected county
      console.log('Selected county:', selectedCounty);
      // navigation.navigate('FarmInput', { county: selectedCounty });
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="dark-content" backgroundColor={COLORS.background} />
      
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
        <TouchableOpacity 
          style={[
            styles.nextButton,
            !selectedCounty && styles.nextButtonDisabled
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
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
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
    borderTopWidth: 4,
    borderLeftWidth: 4,
    borderRightWidth: 2,
    borderBottomWidth: 2,
    borderTopColor: '#6B665F',
    borderLeftColor: '#6B665F',
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
  },
  nextButtonTextDisabled: {
    color: '#A0A0A0',
  },
});

export default HomeScreen;
