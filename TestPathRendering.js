// Test file to debug SVG path rendering
import React from 'react';
import { View, Text, StyleSheet, Dimensions } from 'react-native';
import Svg, { Path, G } from 'react-native-svg';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

// Hardcoded test paths - taken directly from Node.js computation
const TEST_PATHS = [
  {
    id: 'badaxe',
    name: 'Bad Axe city (MultiPolygon)',
    // This is a real MultiPolygon path with 3 sub-paths (79 total points)
    path: 'M251.1,298.0L252.1,298.0L251.8,298.5L251.1,298.7L251.1,298.0Z M251.1,297.8L252.1,297.6L251.1,297.8Z M242.7,302.7L243.2,302.7L243.1,302.1L243.5,302.7L243.5,302.1L244.4,301.9L244.3,300.5L243.1,300.2L243.0,299.2L244.8,298.9L244.6,298.1L246.2,298.1L246.4,297.5L245.9,296.6L246.8,296.7L246.6,296.0L248.2,295.8L248.2,295.3L249.9,294.4L250.1,293.6L251.9,293.4L251.9,293.9L251.5,293.9L251.3,294.3L250.9,294.3L250.9,295.3L250.3,295.3L250.1,296.7L248.9,296.7L248.9,297.1L250.5,297.3L250.5,298.4L252.9,298.4L253.3,298.8L253.3,299.1L252.1,299.0L252.1,299.3L252.5,299.5L252.1,299.8L252.3,300.2L253.1,299.8L253.3,301.8L253.7,301.8L253.5,299.8L256.5,299.8L256.5,300.5L256.3,301.4L254.7,301.2L254.7,302.1L254.9,304.6L254.7,304.6L254.5,302.1L254.1,303.2L254.1,304.5L253.5,305.1L252.3,305.3L252.3,305.5L250.3,305.5L250.3,306.2L248.1,306.2L248.1,305.5L246.9,305.3L246.1,304.0L245.5,304.6L245.1,304.5L244.7,305.1L243.9,305.0L243.3,304.2L242.7,304.4L242.7,302.7Z',
  },
  {
    id: 'caseville',
    name: 'Caseville city (Polygon)',
    // This is a real Polygon path with 34 points
    path: 'M154.9,244.5L155.6,244.3L155.2,244.0L155.6,243.2L156.2,243.7L155.6,242.9L156.4,243.5L156.1,243.1L156.6,243.3L158.0,241.7L157.4,241.1L157.6,240.7L157.9,240.8L158.1,241.4L158.8,240.6L157.7,240.3L158.2,240.0L159.0,240.3L158.3,239.9L159.7,239.6L158.0,239.8L158.8,239.2L158.8,238.8L158.5,238.4L160.5,236.5L161.5,235.1L164.2,235.0L164.4,241.3L161.9,241.4L161.9,242.3L161.3,242.3L161.2,244.6L155.2,244.9L154.9,244.5Z',
  },
  {
    id: 'bingham',
    name: 'Bingham township (Polygon)',
    // Simple rectangle - 5 points
    path: 'M230.0,280.0L260.0,280.0L260.0,320.0L230.0,320.0L230.0,280.0Z',
  },
  {
    id: 'test_complex',
    name: 'Test Complex Shape',
    // A manually-created complex polygon (star shape)
    path: 'M200.0,150.0L220.0,200.0L270.0,200.0L230.0,230.0L250.0,280.0L200.0,250.0L150.0,280.0L170.0,230.0L130.0,200.0L180.0,200.0Z',
  },
];

export default function TestPathRendering() {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>SVG Path Rendering Test</Text>
      <Text style={styles.subtitle}>Each shape should match its description</Text>
      
      <Svg
        width={SCREEN_WIDTH - 40}
        height={400}
        viewBox="0 0 400 500"
        style={styles.svg}
      >
        {TEST_PATHS.map((item, idx) => {
          const hue = (idx * 90) % 360;
          console.log(`Rendering ${item.name}: path length=${item.path.length}`);
          return (
            <Path
              key={item.id}
              d={item.path}
              fill={`hsl(${hue}, 50%, 70%)`}
              stroke="#333"
              strokeWidth={1}
            />
          );
        })}
      </Svg>
      
      <View style={styles.legend}>
        {TEST_PATHS.map((item, idx) => {
          const hue = (idx * 90) % 360;
          return (
            <View key={item.id} style={styles.legendItem}>
              <View style={[styles.colorBox, { backgroundColor: `hsl(${hue}, 50%, 70%)` }]} />
              <Text style={styles.legendText}>{item.name}</Text>
            </View>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 20,
    backgroundColor: '#f5f5f5',
  },
  title: {
    fontSize: 20,
    fontWeight: 'bold',
    marginBottom: 5,
  },
  subtitle: {
    fontSize: 14,
    color: '#666',
    marginBottom: 15,
  },
  svg: {
    backgroundColor: '#fff',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#ddd',
  },
  legend: {
    marginTop: 15,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: 3,
  },
  colorBox: {
    width: 16,
    height: 16,
    marginRight: 8,
    borderRadius: 2,
    borderWidth: 1,
    borderColor: '#333',
  },
  legendText: {
    fontSize: 12,
  },
});
