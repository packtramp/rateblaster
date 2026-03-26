import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { Colors } from '../constants/colors';

export default function RootLayout() {
  return (
    <>
      <StatusBar style="light" />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: Colors.primary },
          headerTintColor: Colors.textLight,
          headerTitleStyle: { fontWeight: '700' },
          contentStyle: { backgroundColor: Colors.background },
        }}
      >
        <Stack.Screen
          name="index"
          options={{ headerShown: false }}
        />
        <Stack.Screen
          name="history"
          options={{ title: 'Rate History' }}
        />
        <Stack.Screen
          name="calculator"
          options={{ title: 'Mortgage Calculator' }}
        />
        <Stack.Screen
          name="unsubscribe"
          options={{ title: 'Unsubscribe' }}
        />
      </Stack>
    </>
  );
}
