import { useAuth } from "@clerk/clerk-expo";
import { Ionicons } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import { LinearGradient } from "expo-linear-gradient";
import { useEffect, useRef, useState } from "react";
import {
    ActivityIndicator,
    Alert,
    Image,
    ScrollView,
    StyleSheet,
    Text,
    TextInput,
    TouchableOpacity,
    View,
} from "react-native";
import { getOrRefreshJWT } from "../../services/jwt";
import {
    getPreferences,
    setPreferences,
    type UserPreferencesData,
} from "../../services/preferences";
import { clearAllUserData } from "../../services/session";

const ACCENT = "#22D3EE";
const ACCENT_DARK = "#06B6D4";
const BG_DARK = "#050B1A";
const BG_MID = "#0B1220";
const CARD = "#0F172A";
const BORDER = "rgba(34, 211, 238, 0.15)";
const MUTED = "#64748B";
const TEXT = "#E2E8F0";
const TEXT_BRIGHT = "#F8FAFC";

const GOALS = [
  { id: "productivity", label: "Boost Productivity", icon: "flash" as const },
  { id: "communication", label: "Manage Communications", icon: "chatbubble" as const },
  { id: "scheduling", label: "Smart Scheduling", icon: "calendar" as const },
  { id: "shopping", label: "Shopping & Orders", icon: "cart" as const },
];

const COMM_PREFS = [
  "Brief replies",
  "Detailed explanations",
  "Prefer text",
  "Prefer voice",
  "Prefer async",
  "Proactive suggestions",
];

const AI_CAPABILITIES = [
  { id: "voice", label: "Voice Commands" },
  { id: "email", label: "Email Drafting" },
  { id: "research", label: "Research & Summaries" },
  { id: "booking", label: "Booking & Reservations" },
  { id: "finance", label: "Finance Tracking" },
  { id: "health", label: "Health & Wellness" },
];

export default function ProfileScreen() {
  const { getToken, isSignedIn, signOut } = useAuth();
  const [loading, setLoading] = useState(true);
  const hasLoadedOnce = useRef(false);
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState("");
  const [preferredName, setPreferredName] = useState("");
  const [bio, setBio] = useState("");
  const [timezone, setTimezone] = useState("");
  const [location, setLocation] = useState("");
  const [workStyle, setWorkStyle] = useState("");
  const [avatarUri, setAvatarUri] = useState<string | null>(null);
  const [interests, setInterests] = useState<string[]>([]);
  const [interestInput, setInterestInput] = useState("");
  const [communicationPreferences, setCommunicationPreferences] = useState<string[]>([]);
  const [goals, setGoals] = useState<string[]>(["productivity"]);
  const [aiCapabilities, setAiCapabilities] = useState<string[]>([]);

  // Ref to hold the latest getToken without causing re-renders
  const getTokenRef = useRef(getToken);
  getTokenRef.current = getToken;

  // Load preferences exactly ONCE on mount (no dependency on getToken)
  useEffect(() => {
    if (hasLoadedOnce.current) return;

    const load = async () => {
      if (!isSignedIn || !getTokenRef.current) {
        setLoading(false);
        return;
      }

      const safetyTimer = setTimeout(() => {
        console.warn("Profile load timed out, showing empty profile");
        setLoading(false);
      }, 8000);

      try {
        const token = await Promise.race([
          getOrRefreshJWT(getTokenRef.current),
          new Promise<null>((resolve) => setTimeout(() => resolve(null), 5000)),
        ]);

        if (token) {
          const prefs = await getPreferences(token);
          setName(prefs.name ?? "");
          setPreferredName(prefs.preferredName ?? prefs.name ?? "");
          setBio(prefs.bio ?? "");
          setTimezone(prefs.timezone ?? "");
          setLocation(prefs.location ?? "");
          setWorkStyle(prefs.workStyle ?? "");
          setAvatarUri(prefs.avatarUri ?? null);
          setInterests(prefs.interests ?? []);
          setCommunicationPreferences(prefs.communicationPreferences ?? []);
          setGoals(prefs.goals?.length ? prefs.goals : ["productivity"]);
          setAiCapabilities(prefs.aiCapabilities ?? []);
        }
      } catch (e) {
        console.warn("Failed to load preferences:", e);
      } finally {
        hasLoadedOnce.current = true;
        clearTimeout(safetyTimer);
        setLoading(false);
      }
    };

    load();
  }, [isSignedIn]);

  const save = async () => {
    if (!getTokenRef.current) return;
    setSaving(true);
    try {
      const token = await getOrRefreshJWT(getTokenRef.current);
      const prefs: UserPreferencesData = {
        name: name.trim() || undefined,
        preferredName: preferredName.trim() || name.trim() || undefined,
        bio: bio.trim() || undefined,
        timezone: timezone.trim() || undefined,
        location: location.trim() || undefined,
        workStyle: workStyle.trim() || undefined,
        interests: interests.length ? interests : undefined,
        communicationPreferences: communicationPreferences.length ? communicationPreferences : undefined,
        goals: goals.length ? goals : undefined,
        aiCapabilities: aiCapabilities.length ? aiCapabilities : undefined,
        avatarUri: avatarUri || undefined,
      };
      const result = await setPreferences(token ?? null, prefs);
      if (result.success) {
        Alert.alert("Saved", "Your profile and preferences have been saved.");
      } else {
        Alert.alert("Error", result.error ?? "Failed to save.");
      }
    } catch (e: any) {
      Alert.alert("Error", e?.message ?? "Failed to save.");
    } finally {
      setSaving(false);
    }
  };

  const pickImage = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.7,
      allowsEditing: true,
      aspect: [1, 1],
    });
    if (!result.canceled && result.assets[0]) {
      setAvatarUri(result.assets[0].uri);
    }
  };

  const addInterest = () => {
    const t = interestInput.trim();
    if (t && !interests.includes(t)) {
      setInterests([...interests, t]);
      setInterestInput("");
    }
  };

  const removeInterest = (item: string) => {
    setInterests(interests.filter((i) => i !== item));
  };

  const toggleCommPref = (item: string) => {
    setCommunicationPreferences((prev) =>
      prev.includes(item) ? prev.filter((p) => p !== item) : [...prev, item]
    );
  };

  const toggleGoal = (id: string) => {
    setGoals((prev) =>
      prev.includes(id) ? prev.filter((g) => g !== id) : [...prev, id]
    );
  };

  const toggleAiCapability = (id: string) => {
    setAiCapabilities((prev) =>
      prev.includes(id) ? prev.filter((c) => c !== id) : [...prev, id]
    );
  };

  if (loading) {
    return (
      <LinearGradient colors={[BG_DARK, BG_MID, "#0A0F1A"]} style={styles.gradient}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={ACCENT} />
          <Text style={styles.loadingText}>Loading profile…</Text>
        </View>
      </LinearGradient>
    );
  }

  return (
    <LinearGradient colors={[BG_DARK, BG_MID, "#0A0F1A"]} style={styles.gradient}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Header - chat-style */}
        <View style={styles.header}>
          <Text style={styles.headerTitle}>Profile</Text>
          <Text style={styles.headerSubtitle}>
            Bio & preferences for you and your 2nd Brain
          </Text>
        </View>

        {/* Avatar */}
        <View style={styles.avatarSection}>
          <TouchableOpacity onPress={pickImage} activeOpacity={0.85}>
            <View style={styles.avatarWrapper}>
              {avatarUri ? (
                <Image source={{ uri: avatarUri }} style={styles.avatarImg} />
              ) : (
                <View style={styles.avatarPlaceholder}>
                  <Ionicons name="person" size={44} color={MUTED} />
                </View>
              )}
              <View style={styles.avatarBadge}>
                <Ionicons name="camera" size={14} color="#0B1220" />
              </View>
            </View>
          </TouchableOpacity>
          <Text style={styles.avatarHint}>Tap to change photo</Text>
        </View>

        {/* Basic Info */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Basic info</Text>
          <TextInput
            placeholder="Display name"
            placeholderTextColor={MUTED}
            value={name}
            onChangeText={setName}
            style={styles.input}
          />
          <TextInput
            placeholder="How should I call you? (e.g. Alex)"
            placeholderTextColor={MUTED}
            value={preferredName}
            onChangeText={setPreferredName}
            style={styles.input}
          />
          <TextInput
            placeholder="Short bio – what you do, interests…"
            placeholderTextColor={MUTED}
            value={bio}
            onChangeText={setBio}
            multiline
            style={[styles.input, styles.textArea]}
          />
        </View>

        {/* Timezone, Location & Work style */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Context for your assistant</Text>
          <TextInput
            placeholder="Timezone (e.g. America/New_York)"
            placeholderTextColor={MUTED}
            value={timezone}
            onChangeText={setTimezone}
            style={styles.input}
          />
          <TextInput
            placeholder="Location (e.g. Austin, TX) – for search and local results"
            placeholderTextColor={MUTED}
            value={location}
            onChangeText={setLocation}
            style={styles.input}
          />
          <TextInput
            placeholder="Work style (e.g. async, deep focus, meetings-heavy)"
            placeholderTextColor={MUTED}
            value={workStyle}
            onChangeText={setWorkStyle}
            style={styles.input}
          />
        </View>

        {/* Interests */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Interests</Text>
          <View style={styles.chipRow}>
            {interests.map((item) => (
              <TouchableOpacity
                key={item}
                onPress={() => removeInterest(item)}
                style={styles.chip}
              >
                <Text style={styles.chipText}>{item}</Text>
                <Ionicons name="close" size={14} color={ACCENT} />
              </TouchableOpacity>
            ))}
          </View>
          <View style={styles.inputRow}>
            <TextInput
              placeholder="Add interest"
              placeholderTextColor={MUTED}
              value={interestInput}
              onChangeText={setInterestInput}
              onSubmitEditing={addInterest}
              returnKeyType="done"
              style={[styles.input, styles.inputFlex]}
            />
            <TouchableOpacity onPress={addInterest} style={styles.addChipBtn}>
              <Ionicons name="add" size={22} color={ACCENT} />
            </TouchableOpacity>
          </View>
        </View>

        {/* Communication preferences */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Communication preferences</Text>
          <View style={styles.chipRow}>
            {COMM_PREFS.map((item) => {
              const active = communicationPreferences.includes(item);
              return (
                <TouchableOpacity
                  key={item}
                  onPress={() => toggleCommPref(item)}
                  style={[styles.chip, active && styles.chipActive]}
                >
                  <Text style={[styles.chipText, active && styles.chipTextActive]}>
                    {item}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>

        {/* Goals */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Your goals</Text>
          <View style={styles.goalGrid}>
            {GOALS.map((goal) => {
              const active = goals.includes(goal.id);
              return (
                <TouchableOpacity
                  key={goal.id}
                  onPress={() => toggleGoal(goal.id)}
                  style={[styles.goalCard, active && styles.goalCardActive]}
                >
                  <Ionicons
                    name={goal.icon}
                    size={22}
                    color={active ? ACCENT : MUTED}
                  />
                  <Text style={[styles.goalLabel, active && styles.goalLabelActive]}>
                    {goal.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>

        {/* AI capabilities */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Preferred AI capabilities</Text>
          <View style={styles.chipRow}>
            {AI_CAPABILITIES.map((cap) => {
              const active = aiCapabilities.includes(cap.id);
              return (
                <TouchableOpacity
                  key={cap.id}
                  onPress={() => toggleAiCapability(cap.id)}
                  style={[styles.chip, active && styles.chipActive]}
                >
                  <Text style={[styles.chipText, active && styles.chipTextActive]}>
                    {cap.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>

        {!isSignedIn && (
          <Text style={styles.signInHint}>
            Sign in to load and save your profile to the cloud.
          </Text>
        )}

        {/* Key settings */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Settings</Text>
          <TouchableOpacity
            onPress={() => {
              Alert.alert(
                "Sign out",
                "This will clear your local chat history and session data. Your profile and memories are saved in the cloud.",
                [
                  { text: "Cancel", style: "cancel" },
                  {
                    text: "Sign out",
                    style: "destructive",
                    onPress: async () => {
                      try {
                        await clearAllUserData();
                      } catch (e) {
                        console.warn("Error clearing user data:", e);
                      }
                      signOut?.();
                    },
                  },
                ],
              );
            }}
            style={styles.settingsRow}
            activeOpacity={0.85}
          >
            <Ionicons name="log-out-outline" size={22} color={MUTED} />
            <Text style={styles.settingsRowText}>Sign out</Text>
            <Ionicons name="chevron-forward" size={18} color={MUTED} />
          </TouchableOpacity>
        </View>

        {/* Save */}
        <TouchableOpacity
          onPress={save}
          disabled={saving || !isSignedIn}
          style={[styles.saveBtn, !isSignedIn && styles.saveBtnDisabled]}
          activeOpacity={0.85}
        >
          <LinearGradient
            colors={[ACCENT, ACCENT_DARK]}
            style={styles.saveBtnGradient}
          >
            {saving ? (
              <ActivityIndicator size="small" color="#0B1220" />
            ) : (
              <>
                <Ionicons name="cloud-upload" size={20} color="#0B1220" />
                <Text style={styles.saveBtnText}>Save to cloud</Text>
              </>
            )}
          </LinearGradient>
        </TouchableOpacity>

        <View style={{ height: 40 }} />
      </ScrollView>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  gradient: {
    flex: 1,
    paddingTop: 60,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    gap: 12,
  },
  loadingText: {
    color: MUTED,
    fontSize: 14,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 20,
    paddingBottom: 24,
  },
  header: {
    marginBottom: 28,
  },
  headerTitle: {
    fontSize: 32,
    fontWeight: "800",
    color: TEXT_BRIGHT,
    letterSpacing: -0.5,
  },
  headerSubtitle: {
    fontSize: 14,
    color: MUTED,
    marginTop: 6,
  },
  avatarSection: {
    alignItems: "center",
    marginBottom: 28,
  },
  avatarWrapper: {
    width: 100,
    height: 100,
    borderRadius: 28,
    backgroundColor: CARD,
    borderWidth: 2,
    borderColor: BORDER,
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
  },
  avatarPlaceholder: {
    width: "100%",
    height: "100%",
    alignItems: "center",
    justifyContent: "center",
  },
  avatarImg: {
    width: "100%",
    height: "100%",
    borderRadius: 26,
  },
  avatarBadge: {
    position: "absolute",
    right: 4,
    bottom: 4,
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: ACCENT,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarHint: {
    color: MUTED,
    fontSize: 12,
    marginTop: 8,
  },
  section: {
    marginBottom: 24,
  },
  sectionTitle: {
    fontSize: 15,
    fontWeight: "600",
    color: TEXT,
    marginBottom: 12,
  },
  input: {
    backgroundColor: CARD,
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 14,
    color: TEXT,
    fontSize: 16,
    borderWidth: 1,
    borderColor: BORDER,
    marginBottom: 10,
  },
  textArea: {
    minHeight: 88,
    textAlignVertical: "top",
  },
  inputRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  inputFlex: {
    flex: 1,
    marginBottom: 0,
  },
  chipRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginBottom: 10,
  },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: CARD,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: BORDER,
  },
  chipActive: {
    borderColor: ACCENT,
    backgroundColor: "rgba(34, 211, 238, 0.1)",
  },
  chipText: {
    color: TEXT,
    fontSize: 13,
    fontWeight: "500",
  },
  chipTextActive: {
    color: ACCENT,
  },
  addChipBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: CARD,
    borderWidth: 1,
    borderColor: BORDER,
    alignItems: "center",
    justifyContent: "center",
  },
  goalGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 12,
  },
  goalCard: {
    width: "47%",
    backgroundColor: CARD,
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: BORDER,
    gap: 8,
  },
  goalCardActive: {
    borderColor: ACCENT,
    backgroundColor: "rgba(34, 211, 238, 0.08)",
  },
  goalLabel: {
    color: MUTED,
    fontSize: 13,
    fontWeight: "500",
  },
  goalLabelActive: {
    color: TEXT,
  },
  signInHint: {
    color: MUTED,
    fontSize: 13,
    marginTop: 8,
    marginBottom: 4,
  },
  settingsRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: CARD,
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderWidth: 1,
    borderColor: BORDER,
  },
  settingsRowText: {
    flex: 1,
    color: TEXT,
    fontSize: 16,
    fontWeight: "500",
  },
  saveBtn: {
    marginTop: 16,
    borderRadius: 24,
    overflow: "hidden",
    shadowColor: ACCENT,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 12,
    elevation: 6,
  },
  saveBtnDisabled: {
    opacity: 0.6,
  },
  saveBtnGradient: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    paddingVertical: 16,
    paddingHorizontal: 24,
  },
  saveBtnText: {
    color: "#0B1220",
    fontSize: 16,
    fontWeight: "700",
  },
});
