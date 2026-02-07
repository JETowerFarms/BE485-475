import React, { useMemo } from 'react';
import {
  View,
  Text,
  StatusBar,
  Pressable,
  ScrollView,
  StyleSheet,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

// Shared palette to match the rest of the app
const COLORS = {
  background: '#F5F0E6',
  headerBg: '#F5F0E6',
  headerBorder: '#5A554E',
  headerText: '#2C2C2C',
  accentRed: '#C54B4B',
  text: '#2C2C2C',
  textLight: '#4A4438',
  infoBg: '#FFFDF8',
  border: '#5A554E',
};

const LinearOptimizationScreen = ({ farms, onBack }) => {
  // Get analysis results from farms
  const analysisResults = useMemo(() => {
    console.log('[LinearOptimizationScreen] === PROCESSING FARMS FOR DISPLAY ===');
    console.log(`[LinearOptimizationScreen] Total farms received: ${farms?.length || 0}`);

    if (!farms) {
      console.log('[LinearOptimizationScreen] No farms provided');
      return [];
    }

    const results = farms
      .filter(farm => farm.backendAnalysis?.output)
      .map(farm => ({
        farmName: farm.properties?.name || `Farm ${farms.indexOf(farm) + 1}`,
        output: farm.backendAnalysis.output,
      }));

    console.log(`[LinearOptimizationScreen] Farms with analysis results: ${results.length}/${farms.length}`);
    results.forEach((result, index) => {
      const farm = farms.find(f => (f.properties?.name || `Farm ${farms.indexOf(f) + 1}`) === result.farmName);
      const analysisStatus = farm?.analysisStatus || 'unknown';
      console.log(`[LinearOptimizationScreen] Farm ${index + 1} (${result.farmName}): status=${analysisStatus}, outputLength=${result.output?.length || 0}`);
    });

    if (results.length === 0) {
      console.log('[LinearOptimizationScreen] No farms have analysis results to display');
    } else {
      console.log(`[LinearOptimizationScreen] Displaying results for ${results.length} farm(s)`);
    }

    return results;
  }, [farms]);

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="dark-content" backgroundColor={COLORS.background} />

      {/* Header */}
      <View style={styles.header}>
        <Pressable style={styles.backButton} onPress={onBack}>
          <Text style={styles.backButtonText}>←</Text>
        </Pressable>
        <View style={styles.headerContent}>
          <Text style={styles.headerTitle}>Agrivoltaics Analysis Results</Text>
        </View>
      </View>

      {/* Graph Display Area (60%) */}
      <View style={styles.graphContainer}>
        <View style={styles.graphWrapper}>
          <Text style={styles.placeholderText}>Optimization visualization will be displayed here</Text>
        </View>
      </View>

      {/* Info Display Area (40%) */}
      <ScrollView style={styles.infoContainer} contentContainerStyle={styles.infoContent}>
        {analysisResults.length === 0 ? (
          <View style={styles.infoCard}>
            <Text style={styles.infoTitle}>No Analysis Results</Text>
            <Text style={styles.infoPlaceholder}>
              Analysis results will appear here after running the optimization.
            </Text>
          </View>
        ) : (
          analysisResults.map((result, index) => {
            console.log(`[LinearOptimizationScreen] Rendering result ${index + 1}/${analysisResults.length} for ${result.farmName} (${result.output?.length || 0} chars)`);
            return (
              <View key={index} style={styles.infoCard}>
                <Text style={styles.infoTitle}>{result.farmName}</Text>
                <ScrollView style={styles.outputContainer} nestedScrollEnabled={true}>
                  <Text style={styles.outputText}>{result.output}</Text>
                </ScrollView>
              </View>
            );
          })
        )}
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingTop: Platform.OS === 'ios' ? 50 : 45,
    paddingBottom: 15,
    paddingHorizontal: 20,
    backgroundColor: COLORS.headerBg,
    borderBottomWidth: 3,
    borderBottomColor: COLORS.headerBorder,
  },
  backButton: {
    position: 'absolute',
    left: 20,
    top: Platform.OS === 'ios' ? 50 : 45,
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 10,
  },
  backButtonText: {
    color: COLORS.accentRed,
    fontSize: 20,
    fontWeight: 'bold',
    textAlign: 'center',
  },
  headerContent: {
    flex: 1,
    alignItems: 'center',
  },
  headerTitle: {
    fontSize: 22,
    fontWeight: 'bold',
    color: COLORS.headerText,
    textAlign: 'center',
  },
  buttonPressed: {
    opacity: 0.6,
  },
  graphContainer: {
    height: '60%',
    backgroundColor: COLORS.background,
    paddingHorizontal: 20,
    paddingTop: 15,
  },
  graphWrapper: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.infoBg,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
    padding: 10,
  },
  placeholderText: {
    fontSize: 16,
    color: COLORS.textLight,
    textAlign: 'center',
  },
  infoContainer: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  infoContent: {
    padding: 20,
    paddingTop: 15,
  },
  infoCard: {
    backgroundColor: COLORS.infoBg,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
    padding: 15,
    marginBottom: 15,
  },
  infoTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: COLORS.text,
    marginBottom: 12,
  },
  infoPlaceholder: {
    fontSize: 14,
    color: COLORS.textLight,
    fontStyle: 'italic',
    lineHeight: 20,
  },
  outputContainer: {
    maxHeight: 400,
    backgroundColor: '#000000',
    borderRadius: 8,
    padding: 10,
  },
  outputText: {
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    fontSize: 12,
    color: '#00FF00',
    lineHeight: 16,
  },
});

export default LinearOptimizationScreen;
