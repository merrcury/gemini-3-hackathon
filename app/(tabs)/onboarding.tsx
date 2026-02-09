// app/(tabs)/onboarding.tsx

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth, useUser } from "@clerk/clerk-expo";
import { Feather, MaterialCommunityIcons } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as ImagePicker from "expo-image-picker";
import { useRouter } from "expo-router";
import { useEffect, useRef, useState } from "react";
import {
  Alert,
  Animated,
  Image,
  KeyboardAvoidingView,
  Platform,
  SafeAreaView,
  ScrollView,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { getOrRefreshJWT } from "../../services/jwt";
import {
  setPreferences,
  type UserPreferencesData,
} from "../../services/preferences";

type Step = "profile" | "goals";

interface OnboardingData {
	name: string;
	avatar: string | null;
	bio: string;
	timezone: string;
	location: string;
	primaryGoals: string[];
	aiCapabilities: string[];
}

const steps: { id: Step; title: string; icon: string }[] = [
	{ id: "profile", title: "Profile", icon: "account" },
	{ id: "goals", title: "Goals", icon: "target" },
];

const goalOptions = [
	{ id: "productivity", label: "Boost Productivity", icon: "zap" },
	{
		id: "communication",
		label: "Manage Communications",
		icon: "message-square",
	},
	{ id: "scheduling", label: "Smart Scheduling", icon: "calendar" },
	{ id: "shopping", label: "Shopping & Orders", icon: "shopping-cart" },
	{ id: "automation", label: "Task Automation", icon: "robot" },
	{ id: "reminders", label: "Smart Reminders", icon: "bell" },
];

const capabilityOptions = [
	{ id: "voice", label: "Voice Commands" },
	{ id: "email", label: "Email Drafting" },
	{ id: "research", label: "Research & Summaries" },
	{ id: "booking", label: "Booking & Reservations" },
	{ id: "finance", label: "Finance Tracking" },
	{ id: "health", label: "Health & Wellness" },
];

const OnboardingPage = () => {
	const router = useRouter();
	const { getToken } = useAuth();
	const { user } = useUser();
	const [currentStep, setCurrentStep] = useState<Step>("profile");
	const [isLoading, setIsLoading] = useState(false);
	const [data, setData] = useState<OnboardingData>({
		name: "",
		avatar: null,
		bio: "",
		timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "",
		location: "",
		primaryGoals: [],
		aiCapabilities: [],
	});
	const [rotation] = useState(new Animated.Value(0));

	// Pre-fill from Clerk user profile (avatar, name) on mount
	useEffect(() => {
		if (!user) return;
		setData((prev) => ({
			...prev,
			name:
				prev.name || [user.firstName, user.lastName].filter(Boolean).join(" "),
			avatar: prev.avatar || user.imageUrl || null,
		}));
	}, [user]);

	const scrollViewRef = useRef<ScrollView>(null);

	const currentIndex = steps.findIndex((s) => s.id === currentStep);
	const isFirst = currentIndex === 0;
	const isLast = currentIndex === steps.length - 1;

	// Animation for loading spinner
	useEffect(() => {
		if (isLoading) {
			Animated.loop(
				Animated.timing(rotation, {
					toValue: 1,
					duration: 1000,
					useNativeDriver: true,
				}),
			).start();
		} else {
			rotation.setValue(0);
		}
	}, [isLoading]);

	const handleNext = async () => {
		if (isLast) {
			setIsLoading(true);
			try {
				// Try to save preferences to server (best-effort, don't block onboarding)
				const token = getToken ? await getOrRefreshJWT(getToken) : null;
				if (token) {
					const prefs: UserPreferencesData = {
						name: data.name.trim() || undefined,
						preferredName: data.name.trim() || undefined,
						bio: data.bio.trim() || undefined,
						timezone: data.timezone.trim() || undefined,
						location: data.location.trim() || undefined,
						goals: data.primaryGoals.length ? data.primaryGoals : undefined,
						aiCapabilities: data.aiCapabilities.length
							? data.aiCapabilities
							: undefined,
						avatarUri: data.avatar || undefined,
					};
					try {
						const result = await setPreferences(token, prefs);
						if (!result.success) {
							console.warn(
								"Onboarding: server save failed (will sync later):",
								result.error,
							);
						}
					} catch (e) {
						console.warn("Onboarding: server save error (will sync later):", e);
					}
				}
				// Always save locally and proceed — server sync can happen from Profile later
				await AsyncStorage.setItem("userProfile", JSON.stringify(data));
				setTimeout(() => {
					setIsLoading(false);
					router.replace("/(tabs)/chat");
				}, 500);
			} catch (error) {
				// Even on error, save locally and proceed
				try {
					await AsyncStorage.setItem("userProfile", JSON.stringify(data));
				} catch (_) {}
				setIsLoading(false);
				router.replace("/(tabs)/chat");
			}
		} else {
			setCurrentStep(steps[currentIndex + 1].id);
			// Scroll to top when changing step
			scrollViewRef.current?.scrollTo({ y: 0, animated: true });
		}
	};

	const handleBack = () => {
		if (!isFirst) {
			setCurrentStep(steps[currentIndex - 1].id);
			scrollViewRef.current?.scrollTo({ y: 0, animated: true });
		}
	};

	const pickImage = async () => {
		const permissionResult =
			await ImagePicker.requestMediaLibraryPermissionsAsync();

		if (permissionResult.granted === false) {
			Alert.alert(
				"Permission Required",
				"You need to allow access to your photos",
			);
			return;
		}

		const result = await ImagePicker.launchImageLibraryAsync({
			mediaTypes: ImagePicker.MediaTypeOptions.Images,
			allowsEditing: true,
			aspect: [1, 1],
			quality: 0.8,
		});

		if (!result.canceled) {
			setData({ ...data, avatar: result.assets[0].uri });
		}
	};

	const toggleArrayItem = (
		key: keyof Pick<OnboardingData, "primaryGoals" | "aiCapabilities">,
		item: string,
	) => {
		setData((prev) => ({
			...prev,
			[key]: prev[key].includes(item)
				? prev[key].filter((i) => i !== item)
				: [...prev[key], item],
		}));
	};

	const renderIcon = (iconName: string, isActive: boolean) => {
		const color = isActive ? "#00E5FF" : "#6B7280";
		const size = 20;

		switch (iconName) {
			case "account":
				return (
					<MaterialCommunityIcons name="account" size={size} color={color} />
				);
			case "target":
				return (
					<MaterialCommunityIcons name="target" size={size} color={color} />
				);
			case "zap":
				return <Feather name="zap" size={size} color={color} />;
			case "message-square":
				return <Feather name="message-square" size={size} color={color} />;
			case "calendar":
				return <Feather name="calendar" size={size} color={color} />;
			case "shopping-cart":
				return <Feather name="shopping-cart" size={size} color={color} />;
			case "robot":
				return (
					<MaterialCommunityIcons name="robot" size={size} color={color} />
				);
			case "bell":
				return <Feather name="bell" size={size} color={color} />;
			default:
				return null;
		}
	};

	// Step header icons (Feather for reliable web/native rendering)
	const renderStepIcon = (stepId: Step, filled: boolean) => {
		const color = filled ? "#FFFFFF" : "#9CA3AF";
		const size = 20;
		if (stepId === "profile") {
			return <Feather name="user" size={size} color={color} />;
		}
		return <Feather name="flag" size={size} color={color} />;
	};

	const spin = rotation.interpolate({
		inputRange: [0, 1],
		outputRange: ["0deg", "360deg"],
	});

	const handleSkip = async () => {
		// Save a minimal profile so the user isn't forced back to onboarding
		try {
			await AsyncStorage.setItem(
				"userProfile",
				JSON.stringify({ skipped: true }),
			);
		} catch (_) {}
		router.replace("/(tabs)/chat");
	};

	return (
		<SafeAreaView style={{ flex: 1, backgroundColor: "#0B1220" }}>
			{/* Progress Header */}
			<View
				style={{
					backgroundColor: "rgba(11, 18, 32, 0.8)",
					borderBottomWidth: 1,
					borderBottomColor: "#374151",
					paddingHorizontal: 16,
					paddingVertical: 16,
				}}
			>
				<View style={{ maxWidth: 400, width: "100%", alignSelf: "center" }}>
					{/* Skip link */}
					<TouchableOpacity
						onPress={handleSkip}
						style={{ alignSelf: "flex-end", marginBottom: 8 }}
					>
						<Text
							style={{
								color: "#9CA3AF",
								fontSize: 14,
								fontWeight: "500",
							}}
						>
							Skip
						</Text>
					</TouchableOpacity>
					{/* Step Indicators */}
					<View
						style={{
							flexDirection: "row",
							alignItems: "center",
							marginBottom: 12,
						}}
					>
						{steps.map((step, index) => {
							const isActive = step.id === currentStep;
							const isComplete = index < currentIndex;
							const filled = isComplete || isActive;

							return (
								<View
									key={step.id}
									style={{
										flexDirection: "row",
										alignItems: "center",
										flex: index < steps.length - 1 ? 1 : 0,
									}}
								>
									<View
										style={{
											width: 40,
											height: 40,
											borderRadius: 20,
											backgroundColor: filled ? "#00E5FF" : "#374151",
											alignItems: "center",
											justifyContent: "center",
											transform: [{ scale: isActive ? 1.1 : 1 }],
										}}
									>
										{isComplete ? (
											<Feather name="check" size={20} color="#FFFFFF" />
										) : (
											renderStepIcon(step.id, filled)
										)}
									</View>
									{index < steps.length - 1 && (
										<View
											style={{
												flex: 1,
												height: 2,
												marginHorizontal: 8,
												justifyContent: "center",
											}}
										>
											<View
												style={{
													height: 2,
													backgroundColor: "#374151",
													position: "absolute",
													left: 0,
													right: 0,
												}}
											/>
											{index < currentIndex && (
												<View
													style={{
														height: 2,
														backgroundColor: "#00E5FF",
														position: "absolute",
														left: 0,
														right: 0,
													}}
												/>
											)}
										</View>
									)}
								</View>
							);
						})}
					</View>
					<Text style={{ fontSize: 12, color: "#9CA3AF", textAlign: "center" }}>
						Step {currentIndex + 1} of {steps.length}
					</Text>
				</View>
			</View>

			{/* Content */}
			<KeyboardAvoidingView
				style={{ flex: 1 }}
				behavior={Platform.OS === "ios" ? "padding" : "height"}
				keyboardVerticalOffset={Platform.OS === "ios" ? 0 : 0}
			>
				<ScrollView
					ref={scrollViewRef}
					style={{ flex: 1 }}
					contentContainerStyle={{ padding: 16, paddingBottom: 32 }}
					showsVerticalScrollIndicator={false}
					keyboardShouldPersistTaps="handled"
				>
					<View style={{ maxWidth: 400, width: "100%", alignSelf: "center" }}>
						{currentStep === "profile" && (
							<View style={{ gap: 16 }}>
								<View style={{ alignItems: "center", marginBottom: 8 }}>
									<Text
										style={{
											fontSize: 24,
											fontWeight: "bold",
											color: "white",
											marginBottom: 4,
										}}
									>
										Set up your profile
									</Text>
									<Text style={{ fontSize: 14, color: "#9CA3AF" }}>
										Help us personalize your experience
									</Text>
								</View>

								{/* Avatar Upload */}
								<View style={{ alignItems: "center" }}>
									<TouchableOpacity
										onPress={pickImage}
										style={{
											width: 80,
											height: 80,
											borderRadius: 40,
											backgroundColor: "#1F2937",
											borderWidth: 2,
											borderStyle: "dashed",
											borderColor: "#374151",
											alignItems: "center",
											justifyContent: "center",
										}}
									>
										{data.avatar ? (
											<Image
												source={{ uri: data.avatar }}
												style={{
													width: "100%",
													height: "100%",
													borderRadius: 40,
												}}
											/>
										) : (
											<MaterialCommunityIcons
												name="camera"
												size={28}
												color="#6B7280"
											/>
										)}
										<View
											style={{
												position: "absolute",
												bottom: -4,
												right: -4,
												width: 32,
												height: 32,
												borderRadius: 16,
												backgroundColor: "#00E5FF",
												alignItems: "center",
												justifyContent: "center",
												shadowColor: "#000",
												shadowOffset: { width: 0, height: 2 },
												shadowOpacity: 0.25,
												shadowRadius: 4,
												elevation: 5,
											}}
										>
											<Feather name="upload" size={16} color="white" />
										</View>
									</TouchableOpacity>
								</View>

								{/* Name Input */}
								<View style={{ gap: 8 }}>
									<Label>Your Name</Label>
									<Input
										placeholder="John Doe"
										value={data.name}
										onChangeText={(text) => setData({ ...data, name: text })}
										style={{
											height: 48,
											borderRadius: 16,
											paddingHorizontal: 16,
											backgroundColor: "rgba(31, 41, 55, 0.3)",
											borderColor: "rgba(55, 65, 81, 0.5)",
										}}
									/>
								</View>

								{/* Bio Input */}
								<View style={{ gap: 8 }}>
									<Label>Tell us about yourself</Label>
									<TextInput
										placeholder="I'm a product designer who loves automation..."
										value={data.bio}
										onChangeText={(text) => setData({ ...data, bio: text })}
										multiline
										numberOfLines={3}
										scrollEnabled={false}
										style={{
											minHeight: 72,
											borderRadius: 16,
											backgroundColor: "rgba(31, 41, 55, 0.3)",
											borderWidth: 1,
											borderColor: "rgba(55, 65, 81, 0.5)",
											padding: 12,
											color: "white",
											fontSize: 14,
											textAlignVertical: "top",
										}}
										placeholderTextColor="#6B7280"
										onFocus={() => {
											setTimeout(() => {
												scrollViewRef.current?.scrollToEnd({ animated: true });
											}, 300);
										}}
									/>
								</View>

								{/* Location & Timezone — side by side */}
								<View
									style={{
										flexDirection: "row",
										gap: 12,
									}}
								>
									<View style={{ flex: 1, gap: 6 }}>
										<Label>Location</Label>
										<Input
											placeholder="e.g. Montreal"
											value={data.location}
											onChangeText={(text) =>
												setData({ ...data, location: text })
											}
											style={{
												height: 44,
												borderRadius: 14,
												paddingHorizontal: 14,
												backgroundColor: "rgba(31, 41, 55, 0.3)",
												borderColor: "rgba(55, 65, 81, 0.5)",
												fontSize: 13,
											}}
										/>
									</View>
									<View style={{ flex: 1, gap: 6 }}>
										<Label>Timezone</Label>
										<Input
											placeholder="Auto-detected"
											value={data.timezone}
											onChangeText={(text) =>
												setData({ ...data, timezone: text })
											}
											style={{
												height: 44,
												borderRadius: 14,
												paddingHorizontal: 14,
												backgroundColor: "rgba(31, 41, 55, 0.3)",
												borderColor: "rgba(55, 65, 81, 0.5)",
												fontSize: 13,
											}}
										/>
									</View>
								</View>
							</View>
						)}

						{currentStep === "goals" && (
							<View style={{ gap: 24 }}>
								<View style={{ alignItems: "center", marginBottom: 16 }}>
									<Text
										style={{
											fontSize: 24,
											fontWeight: "bold",
											color: "white",
											marginBottom: 4,
										}}
									>
										What are your goals?
									</Text>
									<Text style={{ fontSize: 14, color: "#9CA3AF" }}>
										Select what you want to achieve
									</Text>
								</View>

								{/* Primary Goals */}
								<View style={{ gap: 12 }}>
									<Label>Primary Goals</Label>
									<View
										style={{ flexDirection: "row", flexWrap: "wrap", gap: 12 }}
									>
										{goalOptions.map((goal) => {
											const isSelected = data.primaryGoals.includes(goal.id);
											return (
												<TouchableOpacity
													key={goal.id}
													onPress={() =>
														toggleArrayItem("primaryGoals", goal.id)
													}
													style={{
														width: "48%",
														padding: 16,
														borderRadius: 16,
														borderWidth: 2,
														borderColor: isSelected
															? "#00E5FF"
															: "rgba(55, 65, 81, 0.5)",
														backgroundColor: isSelected
															? "rgba(0, 229, 255, 0.1)"
															: "rgba(31, 41, 55, 0.3)",
													}}
												>
													{renderIcon(goal.icon, isSelected)}
													<Text
														style={{
															fontSize: 14,
															fontWeight: "500",
															marginTop: 8,
															color: isSelected ? "white" : "#9CA3AF",
														}}
													>
														{goal.label}
													</Text>
												</TouchableOpacity>
											);
										})}
									</View>
								</View>

								{/* AI Capabilities */}
								<View style={{ gap: 12 }}>
									<Label>Preferred AI Capabilities</Label>
									<View
										style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}
									>
										{capabilityOptions.map((cap) => {
											const isSelected = data.aiCapabilities.includes(cap.id);
											return (
												<TouchableOpacity
													key={cap.id}
													onPress={() =>
														toggleArrayItem("aiCapabilities", cap.id)
													}
													style={{
														paddingHorizontal: 16,
														paddingVertical: 8,
														borderRadius: 20,
														backgroundColor: isSelected ? "#00E5FF" : "#1F2937",
													}}
												>
													<Text
														style={{
															fontSize: 12,
															fontWeight: "500",
															color: isSelected ? "white" : "#9CA3AF",
														}}
													>
														{cap.label}
													</Text>
												</TouchableOpacity>
											);
										})}
									</View>
								</View>
							</View>
						)}
					</View>
				</ScrollView>
			</KeyboardAvoidingView>

			{/* Navigation Footer */}
			<View
				style={{
					backgroundColor: "rgba(11, 18, 32, 0.8)",
					borderTopWidth: 1,
					borderTopColor: "#374151",
					paddingHorizontal: 16,
					paddingVertical: 16,
				}}
			>
				<View
					style={{
						maxWidth: 400,
						width: "100%",
						alignSelf: "center",
						flexDirection: "row",
						gap: 12,
					}}
				>
					{!isFirst && !isLast && (
						<Button
							variant="outline"
							onPress={handleBack}
							style={{ flex: 1, height: 48, borderRadius: 24 }}
						>
							<Feather
								name="arrow-left"
								size={16}
								color="white"
								style={{ marginRight: 8 }}
							/>
							<Text style={{ color: "white", fontWeight: "500" }}>Back</Text>
						</Button>
					)}
					<Button
						onPress={handleNext}
						disabled={isLoading}
						style={[
							{
								height: 48,
								borderRadius: 24,
								backgroundColor: "#00E5FF",
								opacity: isLoading ? 0.7 : 1,
								width: "100%",
							},
							!isFirst && !isLast ? { flex: 1, width: undefined } : {},
						]}
					>
						{isLoading ? (
							<Animated.View style={{ transform: [{ rotate: spin }] }}>
								<Feather name="loader" size={20} color="white" />
							</Animated.View>
						) : isLast ? (
							<>
								<Text style={{ color: "white", fontWeight: "500" }}>
									Get Started
								</Text>
								<Feather
									name="star"
									size={16}
									color="white"
									style={{ marginLeft: 8 }}
								/>
							</>
						) : (
							<>
								<Text style={{ color: "white", fontWeight: "500" }}>
									Continue
								</Text>
								<Feather
									name="arrow-right"
									size={16}
									color="white"
									style={{ marginLeft: 8 }}
								/>
							</>
						)}
					</Button>
				</View>
			</View>
		</SafeAreaView>
	);
};

export default OnboardingPage;
