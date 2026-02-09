require('dotenv').config();

module.exports = {
  expo: {
    name: "Second Brain",
    slug: "second-brain",
    version: "1.0.0",
    orientation: "portrait",
    icon: "./assets/images/icon.png",
    scheme: "secondbrain",
    userInterfaceStyle: "automatic",
    newArchEnabled: true,
    ios: {
      supportsTablet: true,
      bundleIdentifier: "com.secondbrain.app",
      infoPlist: {
        NSMicrophoneUsageDescription: "2nd Brain needs microphone access for voice messages.",
      },
    },
    android: {
      package: "com.secondbrain.app",
      adaptiveIcon: {
        backgroundColor: "#E6F4FE",
        foregroundImage: "./assets/images/android-icon-foreground.png",
        backgroundImage: "./assets/images/android-icon-background.png",
        monochromeImage: "./assets/images/android-icon-monochrome.png"
      },
      edgeToEdgeEnabled: true,
      predictiveBackGestureEnabled: false
    },
    web: {
      output: "static",
      favicon: "./assets/images/favicon.png"
    },
    plugins: [
      "expo-router",
      [
        "expo-splash-screen",
        {
          image: "./assets/images/splash-icon.png",
          imageWidth: 200,
          resizeMode: "contain",
          backgroundColor: "#ffffff",
          dark: {
            backgroundColor: "#000000"
          }
        }
      ],
      [
        "expo-av",
        {
          microphonePermission: "2nd Brain needs microphone access for voice messages."
        }
      ]
    ],
    experiments: {
      typedRoutes: true,
      reactCompiler: true
    },
    extra: {
      eas: {
        projectId: "6f3e26ab-b94e-4ff7-8e21-1363d07c715c"
      },
      // Load from .env (dotenv.config() above). Use EXPO_PUBLIC_* for client exposure.
      clerkPublishableKey: process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY || "",
      geminiKey: process.env.GEMINIKEY || process.env.EXPO_PUBLIC_GEMINIKEY,
      apiUrl: process.env.API_URL || process.env.EXPO_PUBLIC_API_URL || "http://localhost:8080",
      mcpServerUrl: process.env.EXPO_PUBLIC_MCP_SERVER_URL || "",
      mcpKiteUrl: process.env.EXPO_PUBLIC_MCP_KITE_URL || "",
      mcpTravelUrl: process.env.EXPO_PUBLIC_MCP_TRAVEL_URL || "",
      mcpApiKey: process.env.EXPO_PUBLIC_MCP_API_KEY || "",
      serpApiKey: process.env.EXPO_PUBLIC_SERPAPI_API_KEY || "",
      memoryApiUrl: process.env.EXPO_PUBLIC_MEMORY_API_URL || "",
      preferencesApiUrl: process.env.EXPO_PUBLIC_PREFERENCES_API_URL || "",
    }
  }
};
