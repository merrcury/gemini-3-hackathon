// Redirect /onboarding -> /(tabs)/onboarding so direct URL works
import { Redirect } from "expo-router";

export default function OnboardingRedirect() {
  return <Redirect href="/(tabs)/onboarding" />;
}
