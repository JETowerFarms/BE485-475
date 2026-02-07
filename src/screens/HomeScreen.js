import React, { useState, useEffect } from 'react';
import { 
  View, 
  Text, 
  StyleSheet, 
  Pressable, 
  StatusBar,
  BackHandler,
  ActivityIndicator,
  Modal,
  TouchableWithoutFeedback,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import MichiganMap from '../components/MichiganMap';

// Color scheme matching the reference design
const COLORS = {
  background: '#F5F0E6',     // Cream/off-white background
  text: '#2C2C2C',           // Dark text
  buttonBorder: '#2C2C2C',   // Button border
  buttonBackground: '#F5F0E6', // Button background (same as page)
  exitRed: '#C54B4B',        // Muted red for exit button
  exitRedBorder: '#A03030',  // Darker red for border
};

const HomeScreen = ({
  onNavigateToCity,
  savedLocation,
  onResumeSavedLocation,
  isLoadingInitial = false,
}) => {
  const [selectedCounty, setSelectedCounty] = useState(null);
  const hasSavedLocation = Boolean(savedLocation?.county && savedLocation?.city);
  const [isResumeModalVisible, setIsResumeModalVisible] = useState(false);

  useEffect(() => {
    if (hasSavedLocation) {
      setIsResumeModalVisible(true);
    } else {
      setIsResumeModalVisible(false);
    }
  }, [hasSavedLocation]);

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

  const handleResume = () => {
    onResumeSavedLocation?.();
    setIsResumeModalVisible(false);
  };

  const handleDismissModal = () => {
    setIsResumeModalVisible(false);
  };

  if (isLoadingInitial) {
    return (
      <SafeAreaView style={styles.container}>
        <StatusBar barStyle="dark-content" backgroundColor={COLORS.background} />
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={COLORS.text} />
        </View>
      </SafeAreaView>
    );
  }

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

      <Modal
        transparent
        animationType="fade"
        visible={isResumeModalVisible}
        onRequestClose={handleDismissModal}
      >
        <TouchableWithoutFeedback onPress={handleDismissModal}>
          <View style={styles.modalBackdrop}>
            <TouchableWithoutFeedback>
              <View style={styles.modalContent}>
                <Text style={styles.modalTitle}>Resume previous location?</Text>
                <Text style={styles.modalMessage}>
                  {savedLocation?.city}, {savedLocation?.county} County
                </Text>
                <View style={styles.modalButtons}>
                  <Pressable
                    style={({ pressed }) => [styles.modalSecondary, pressed && styles.buttonPressed]}
                    onPress={handleDismissModal}
                  >
                    <Text style={styles.modalSecondaryText}>Not Now</Text>
                  </Pressable>
                  <Pressable
                    style={({ pressed }) => [styles.modalPrimary, pressed && styles.buttonPressed]}
                    onPress={handleResume}
                  >
                    <Text style={styles.modalPrimaryText}>Continue Here</Text>
                  </Pressable>
                </View>
              </View>
            </TouchableWithoutFeedback>
          </View>
        </TouchableWithoutFeedback>
      </Modal>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
    modalBackdrop: {
      flex: 1,
      backgroundColor: 'rgba(0,0,0,0.35)',
      justifyContent: 'center',
      alignItems: 'center',
      padding: 24,
    },
    modalContent: {
      width: '100%',
      backgroundColor: '#FFFDF8',
      padding: 24,
      borderRadius: 10,
      borderWidth: 2,
      borderColor: '#5A554E',
      alignItems: 'center',
    },
    modalTitle: {
      fontSize: 20,
      fontWeight: '700',
      color: COLORS.text,
      marginBottom: 8,
      textAlign: 'center',
    },
    modalMessage: {
      fontSize: 18,
      color: '#4A4438',
      marginBottom: 20,
      textAlign: 'center',
    },
    modalButtons: {
      width: '100%',
      flexDirection: 'row',
      justifyContent: 'center',
      gap: 12,
    },
    modalSecondary: {
      paddingVertical: 12,
      paddingHorizontal: 18,
      borderWidth: 2,
      borderColor: '#A0A0A0',
      backgroundColor: '#FFFFFF',
    },
    modalSecondaryText: {
      color: '#6B665D',
      fontSize: 16,
      fontWeight: '600',
    },
    modalPrimary: {
      paddingVertical: 12,
      paddingHorizontal: 18,
      borderWidth: 2,
      borderColor: '#5A7A5A',
      backgroundColor: '#7A9A7A',
    },
    modalPrimaryText: {
      color: '#FFFFFF',
      fontSize: 16,
      fontWeight: '700',
    },
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  exitButton: {
    position: 'absolute',
    top: 70,
    left: 20,
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
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
});

export default HomeScreen;
