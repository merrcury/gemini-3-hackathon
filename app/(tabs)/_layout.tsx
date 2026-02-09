import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import { Tabs } from "expo-router";

const active = "#00E5FF";
const inactive = "#6B7280";
const bg = "#0B1220";

export default function TabLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarStyle: {
          backgroundColor: bg,
          borderTopColor: "#111827",
          height: 70,
        },
        tabBarActiveTintColor: active,
        tabBarInactiveTintColor: inactive,
      }}
    >
      <Tabs.Screen
        name="chat"
        options={{
          title: "Chat",
          tabBarIcon: ({ color, size }) => (
            <MaterialCommunityIcons
              name="brain"
              size={size}
              color={color}
            />
          ),
        }}
      />
      <Tabs.Screen
        name="explore"
        options={{ href: null }}
      />
      <Tabs.Screen
        name="market"
        options={{
          title: "Market",
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="storefront" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="logs"
        options={{ href: null }}
      />
      <Tabs.Screen
        name="settings"
        options={{ href: null }}
      />
      {/* Hide index from tab bar */}
      <Tabs.Screen
        name="index"
        options={{
          href: null, // Hide from tab bar
        }}
      />
      <Tabs.Screen
        name="onboarding"
        options={{
          href: null, // Hide from tab bar; route is /(tabs)/onboarding
        }}
      />
      <Tabs.Screen
  name="profile"
  options={{
    title: "Profile",
    tabBarIcon: ({ color, size }) => (
      <Ionicons name="person" size={size} color={color} />
    ),
  }}
/>

    </Tabs>
  );
}