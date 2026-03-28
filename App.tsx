/**
 * PassportSnap v5.0
 * Flow: Welcome → CountrySelect → ImageInput → Processing → Adjust → Preview
 */
import React, { useEffect } from 'react';
import { Platform } from 'react-native';
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

/**
 * RevenueCat API keys — one per platform.
 *
 * ANDROID: already live on Google Play.
 * iOS:     create the iOS app in your RevenueCat dashboard, copy the
 *          "App Store" API key (starts with "appl_"), and replace the
 *          placeholder below before submitting to the App Store.
 *
 *  RevenueCat dashboard → Select project → Apps → + New app → App Store
 */
const RC_API_KEY = Platform.select({
  android: 'goog_iwVsxrYeBZwPLSQVsvSQgyLjrma',
  ios:     'appl_REPLACE_WITH_YOUR_IOS_KEY',   // ← replace before release
  default: 'goog_iwVsxrYeBZwPLSQVsvSQgyLjrma',
})!;

export default function App() {
  useEffect(() => {
    try {
      Purchases.setLogLevel(Purchases.LOG_LEVEL.DEBUG);
      Purchases.configure({ apiKey: RC_API_KEY });
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
