/**
 * PassportSnap v5.0
 * Flow: Welcome → CountrySelect → ImageInput → Processing → Adjust → Preview
 */
import React, { useEffect } from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import WelcomeScreen       from './src/screens/WelcomeScreen';
import CountrySelectScreen from './src/screens/CountrySelectScreen';
import ImageInputScreen    from './src/screens/ImageInputScreen';
import ProcessingScreen    from './src/screens/ProcessingScreen';
import AdjustScreen        from './src/screens/AdjustScreen';
import PreviewScreen       from './src/screens/PreviewScreen';
import Purchases           from 'react-native-purchases';

const Stack = createNativeStackNavigator();

export default function App() {
  useEffect(() => {
	try {
    Purchases.configure({
      apiKey: 'goog_SOrjKfCqKpWRTpijBLZZCFIITPn',
    });
  } catch (e) {
    console.warn('RevenueCat init failed:', e);
  }
  }, []);
    
  return (
    <NavigationContainer>
      <Stack.Navigator
        initialRouteName="Welcome"
        screenOptions={{
          headerStyle:      { backgroundColor: '#0C0F1A' },
          headerTintColor:  '#F0F2FF',
          headerTitleStyle: { fontWeight: '700', fontSize: 17 },
          headerShadowVisible: false,
        }}
      >
        <Stack.Screen
          name="Welcome"
          component={WelcomeScreen}
          options={{ headerShown: false }}
        />
        <Stack.Screen
          name="CountrySelect"
          component={CountrySelectScreen}
          options={{ title: 'PassportSnap', headerBackVisible: false }}
        />
        <Stack.Screen
          name="ImageInput"
          component={ImageInputScreen}
          options={{ title: 'Upload Photo' }}
        />
        <Stack.Screen
          name="Processing"
          component={ProcessingScreen}
          options={{ title: 'Processing...', headerBackVisible: false }}
        />
        <Stack.Screen
          name="Adjust"
          component={AdjustScreen}
          options={{ title: 'Adjust Photo', headerBackVisible: false }}
        />
        <Stack.Screen
          name="Preview"
          component={PreviewScreen}
          options={{ title: 'Preview & Download', headerBackVisible: false }}
        />
      </Stack.Navigator>
    </NavigationContainer>
  );
}
