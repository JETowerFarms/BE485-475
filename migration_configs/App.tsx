import React from 'react';
import {NavigationContainer} from '@react-navigation/native';
import {createStackNavigator} from '@react-navigation/stack';
import HomeScreen from './src/screens/HomeScreen';
import CitySelectionScreen from './src/screens/CitySelectionScreen';
import MapScreen from './src/screens/MapScreen';
import FarmDescriptionScreen from './src/screens/FarmDescriptionScreen';

const Stack = createStackNavigator();

function App(): React.JSX.Element {
  return (
    <NavigationContainer>
      <Stack.Navigator
        initialRouteName="Home"
        screenOptions={{
          headerStyle: {
            backgroundColor: '#4CAF50',
          },
          headerTintColor: '#fff',
          headerTitleStyle: {
            fontWeight: 'bold',
          },
        }}>
        <Stack.Screen
          name="Home"
          component={HomeScreen}
          options={{title: 'Michigan Solar Optimization'}}
        />
        <Stack.Screen
          name="CitySelection"
          component={CitySelectionScreen}
          options={{title: 'Select Location'}}
        />
        <Stack.Screen
          name="Map"
          component={MapScreen}
          options={{title: 'Draw Farm Boundary'}}
        />
        <Stack.Screen
          name="FarmDescription"
          component={FarmDescriptionScreen}
          options={{title: 'Farm Analysis'}}
        />
      </Stack.Navigator>
    </NavigationContainer>
  );
}

export default App;
