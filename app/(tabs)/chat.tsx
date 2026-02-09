import { useAuth } from "@clerk/clerk-expo";
import { Ionicons } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Audio } from "expo-av";
import { LinearGradient } from "expo-linear-gradient";
import { useCallback, useEffect, useRef, useState } from "react";
import {
	ActivityIndicator,
	Alert,
	Animated,
	FlatList,
	KeyboardAvoidingView,
	Platform,
	StyleSheet,
	Text,
	TextInput,
	TouchableOpacity,
	View,
} from "react-native";
import Markdown from "react-native-markdown-display";
import {
	type AgentEventCallback,
	type AgentSoul,
	type ChatMessage,
	initializeBrainAgent,
	sendChatMessage,
	transcribeAudio,
} from "../../services/gemini";
import { forceNewJWT, getOrRefreshJWT } from "../../services/jwt";
import { clearAllUserData, clearChatSession } from "../../services/session";

export default function ChatScreen() {
	const STORAGE_KEY = "chat_session_v1";

	// Auth
	const { getToken, isSignedIn, signOut } = useAuth();

	// State
	const [message, setMessage] = useState("");
	const [messages, setMessages] = useState<ChatMessage[]>([]);
	const [isTyping, setIsTyping] = useState(false);
	const [isLoading, setIsLoading] = useState(false);
	const [isRecording, setIsRecording] = useState(false);
	const [recording, setRecording] = useState<Audio.Recording | null>(null);
	const [currentToolCall, setCurrentToolCall] = useState<string | null>(null);
	const [currentStatus, setCurrentStatus] = useState<string | null>(null);
	const flatListRef = useRef<FlatList>(null);
	const recordingRef = useRef<Audio.Recording | null>(null);

	// Brain state
	const brainInitRef = useRef(false);
	const [brainStatus, setBrainStatus] = useState<{
		initialized: boolean;
		soul: AgentSoul | null;
		mcpConnected: boolean;
		memoryConnected: boolean;
	}>({
		initialized: false,
		soul: null,
		mcpConnected: false,
		memoryConnected: false,
	});
	const [sessionId, setSessionId] = useState<string>(
		() => `session-${Date.now()}`,
	);

	// Load persisted session/messages
	useEffect(() => {
		const loadSession = async () => {
			try {
				const raw = await AsyncStorage.getItem(STORAGE_KEY);
				if (!raw) return;
				const parsed = JSON.parse(raw);
				if (parsed?.sessionId) {
					setSessionId(parsed.sessionId);
				}
				if (Array.isArray(parsed?.messages)) {
					setMessages(parsed.messages);
				}
			} catch (error) {
				console.warn("Failed to load chat session:", error);
			}
		};

		loadSession();
	}, []);

	// Persist session/messages
	useEffect(() => {
		const persistSession = async () => {
			try {
				await AsyncStorage.setItem(
					STORAGE_KEY,
					JSON.stringify({ sessionId, messages }),
				);
			} catch (error) {
				console.warn("Failed to persist chat session:", error);
			}
		};

		persistSession();
	}, [sessionId, messages]);

	// Auto-logout when signed in but JWT is unobtainable
	const forceLogout = useCallback(async () => {
		console.warn("⚠️ No JWT token available — forcing logout");
		try {
			await clearAllUserData();
		} catch (e) {
			console.warn("Error clearing data on force logout:", e);
		}
		signOut?.();
	}, [signOut]);

	// Initialize 2nd Brain on mount — only once per component lifecycle
	useEffect(() => {
		if (brainInitRef.current) return;
		if (!isSignedIn) return;
		brainInitRef.current = true;

		const initBrain = async () => {
			try {
				// Get a FRESH JWT from Clerk (skip stored cache) — ensures we
				// never init the brain with a stale token that will 401 everywhere.
				// Don't force logout on init failure; only on active user actions.
				let jwtToken: string | undefined;
				if (getToken) {
					try {
						const token = await forceNewJWT(getToken);
						if (token) {
							jwtToken = token;
						} else {
							console.warn("Brain init: JWT unavailable, proceeding without token");
						}
					} catch (e) {
						console.warn("Brain init: JWT error, proceeding without token:", e);
					}
				}

				// Initialize the brain
				const status = await initializeBrainAgent(jwtToken);
				setBrainStatus(status);

				if (status.soul) {
					console.log(`✅ ${status.soul.name} initialized`);
					console.log(
						`   MCP: ${status.mcpConnected ? "connected" : "offline"}`,
					);
					console.log(
						`   Memory: ${status.memoryConnected ? "connected" : "offline"}`,
					);
				}
			} catch (error: any) {
				console.error("Failed to initialize brain:", error);
			}
		};

		initBrain();
	}, [isSignedIn, getToken]);

	// Handle agent events (tool calls, status updates)
	const handleAgentEvent: AgentEventCallback = useCallback((event) => {
		switch (event.type) {
			case "thinking":
				setCurrentStatus("Thinking...");
				break;
			case "tool_call":
				setCurrentToolCall(event.data.name);
				setCurrentStatus(`Using ${event.data.name}...`);
				break;
			case "tool_result":
				setTimeout(() => setCurrentToolCall(null), 1000);
				break;
			case "memory_access":
				setCurrentStatus("Accessing memories...");
				break;
			case "complete":
				setCurrentStatus(null);
				setCurrentToolCall(null);
				break;
		}
	}, []);

	// Scroll to bottom when messages change
	useEffect(() => {
		if (messages.length > 0) {
			setTimeout(() => {
				flatListRef.current?.scrollToEnd({ animated: true });
			}, 100);
		}
	}, [messages.length]);

	useEffect(() => {
		// Request audio permissions and configure audio session
		(async () => {
			const { status } = await Audio.requestPermissionsAsync();
			if (status !== "granted") {
				Alert.alert(
					"Permission Required",
					"Audio recording permission is required for voice messages.",
				);
				return;
			}
			// Pre-configure audio session category so recording activation succeeds later
			await Audio.setAudioModeAsync({
				allowsRecordingIOS: false,
				playsInSilentModeIOS: true,
			});
		})();

		// Cleanup on unmount - use ref to get current recording value
		return () => {
			if (recordingRef.current) {
				recordingRef.current.stopAndUnloadAsync().catch((err) => {
					console.error("Error stopping recording on unmount:", err);
				});
			}
		};
	}, []);

	const toggleRecording = async () => {
		if (isRecording) {
			// Stop recording
			if (!recording) return;

			try {
				setIsRecording(false);
				const currentRecording = recordingRef.current;
				if (currentRecording) {
					await currentRecording.stopAndUnloadAsync();
					const uri = currentRecording.getURI();
					setRecording(null);
					recordingRef.current = null;

					// Reset audio mode after recording (release mic, allow playback)
					await Audio.setAudioModeAsync({
						allowsRecordingIOS: false,
						playsInSilentModeIOS: true,
					});

					if (uri) {
						await handleAudioMessage(uri);
					}
				}
			} catch (err) {
				console.error("Failed to stop recording", err);
				setRecording(null);
				recordingRef.current = null;
				// Best-effort reset audio mode
				try {
					await Audio.setAudioModeAsync({ allowsRecordingIOS: false, playsInSilentModeIOS: true });
				} catch {}
			}
		} else {
			// Start recording
			try {
				const { status } = await Audio.requestPermissionsAsync();
				if (status !== "granted") {
					Alert.alert(
						"Permission Required",
						"Microphone permission is needed for voice messages. Please enable it in Settings.",
					);
					return;
				}

				// Clean up any stale recording that wasn't properly released
				if (recordingRef.current) {
					try {
						await recordingRef.current.stopAndUnloadAsync();
					} catch {}
					setRecording(null);
					recordingRef.current = null;
				}

				// Reset audio mode first (deactivate), then re-activate with recording
				await Audio.setAudioModeAsync({
					allowsRecordingIOS: false,
					playsInSilentModeIOS: true,
				});
				await Audio.setAudioModeAsync({
					allowsRecordingIOS: true,
					playsInSilentModeIOS: true,
				});

				// Use the built-in HIGH_QUALITY preset — avoids misconfigured options
				const { recording: newRecording } =
					await Audio.Recording.createAsync(
						Audio.RecordingOptionsPresets.HIGH_QUALITY,
					);
				setRecording(newRecording);
				recordingRef.current = newRecording;
				setIsRecording(true);
			} catch (err) {
				console.error("Failed to start recording", err);
				// Reset audio mode on failure so next attempt starts clean
				try {
					await Audio.setAudioModeAsync({ allowsRecordingIOS: false, playsInSilentModeIOS: true });
				} catch {}
				Alert.alert("Error", "Failed to start recording. Please try again.");
			}
		}
	};

	// Generate unique message ID to prevent collisions
	const generateMessageId = (): string => {
		return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
	};

	const handleAudioMessage = async (uri: string) => {
		try {
			setIsLoading(true);
			setCurrentStatus("Transcribing…");

			// Detect mimeType from file extension
			let mimeType = "audio/mp4";
			if (uri.endsWith(".m4a") || uri.endsWith(".mp4")) {
				mimeType = "audio/mp4";
			} else if (uri.endsWith(".wav")) {
				mimeType = "audio/wav";
			} else if (uri.endsWith(".mp3")) {
				mimeType = "audio/mp3";
			} else if (uri.endsWith(".aac")) {
				mimeType = "audio/aac";
			} else if (uri.endsWith(".aiff")) {
				mimeType = "audio/aiff";
			} else if (uri.endsWith(".ogg")) {
				mimeType = "audio/ogg";
			} else if (uri.endsWith(".flac")) {
				mimeType = "audio/flac";
			}

			console.log("Processing audio file:", uri, "mimeType:", mimeType);

			// Step 1: Transcribe — show user message immediately
			const transcription = await transcribeAudio(uri, mimeType);

			const userMessage: ChatMessage = {
				id: generateMessageId(),
				text: transcription,
				role: "user",
				timestamp: Date.now(),
			};

			// Show the user's words in chat right away
			const messagesWithUser = [...messages, userMessage];
			setMessages(messagesWithUser);
			setCurrentStatus("Thinking…");

			// Yield a frame so React renders the user message before we start the AI call
			await new Promise((resolve) => setTimeout(resolve, 50));

			// Step 2: Get JWT token
			let jwtToken: string | undefined;
			if (isSignedIn && getToken) {
				try {
					const token = await getOrRefreshJWT(getToken);
					if (!token) {
						forceLogout();
						return;
					}
					jwtToken = token;
				} catch (e) {
					forceLogout();
					return;
				}
			}

			// Step 3: Send transcription to brain — get AI response
			const {
				text: aiResponse,
				metadata,
				toolCalls,
				thinking,
			} = await sendChatMessage(transcription, messagesWithUser, {
				jwtToken,
				sessionId,
				onEvent: handleAgentEvent,
			});

			const assistantMessage: ChatMessage = {
				id: generateMessageId(),
				text: aiResponse,
				role: "assistant",
				timestamp: Date.now(),
				toolCalls,
				thinking,
				metadata,
			};

			setMessages([...messagesWithUser, assistantMessage]);
		} catch (error: any) {
			console.error("Error handling audio:", error);
			Alert.alert("Error", error.message || "Failed to handle audio");
		} finally {
			setIsLoading(false);
			setCurrentStatus(null);
		}
	};

	const sendMessage = async () => {
		if (!message.trim() || isLoading) return;

		const userMessage: ChatMessage = {
			id: generateMessageId(),
			text: message,
			role: "user",
			timestamp: Date.now(),
		};

		// Add user message to UI immediately
		const updatedMessages = [...messages, userMessage];
		setMessages(updatedMessages);

		const currentMessage = message;
		setMessage("");
		setIsTyping(false);
		setIsLoading(true);
		setCurrentStatus("Thinking...");

		try {
			// Get JWT token — force logout if signed in but no token
			let jwtToken: string | undefined;
			if (isSignedIn && getToken) {
				try {
					const token = await getOrRefreshJWT(getToken);
					if (!token) {
						forceLogout();
						return;
					}
					jwtToken = token;
				} catch (e) {
					forceLogout();
					return;
				}
			}

			// Send to 2nd Brain
			const {
				text: responseText,
				metadata,
				toolCalls,
				thinking,
			} = await sendChatMessage(currentMessage, updatedMessages, {
				jwtToken,
				sessionId,
				onEvent: handleAgentEvent,
			});

			const assistantMessage: ChatMessage = {
				id: generateMessageId(),
				text: responseText,
				role: "assistant",
				timestamp: Date.now(),
				toolCalls,
				thinking,
				metadata,
			};

			// Add assistant message to UI
			const finalMessages = [...updatedMessages, assistantMessage];
			setMessages(finalMessages);
		} catch (error: any) {
			console.error("Error sending message:", error);
			Alert.alert(
				"Error",
				error.message ||
					"Failed to send message. Please check your API key in .env file.",
			);

			// Remove the user message if there was an error
			setMessages((prev) => prev.filter((msg) => msg.id !== userMessage.id));
		} finally {
			setIsLoading(false);
			setCurrentToolCall(null);
			setCurrentStatus(null);
		}
	};

	const retryReply = async (userMessageIndex: number) => {
		if (isLoading || userMessageIndex < 0 || userMessageIndex >= messages.length) return;
		const msg = messages[userMessageIndex];
		if (msg.role !== "user") return;
		const history = messages.slice(0, userMessageIndex + 1);
		setMessages(history);
		setIsLoading(true);
		setCurrentStatus("Thinking...");
		try {
			let jwtToken: string | undefined;
			if (isSignedIn && getToken) {
				try {
					const token = await getOrRefreshJWT(getToken);
					if (!token) {
						forceLogout();
						return;
					}
					jwtToken = token;
				} catch (e) {
					forceLogout();
					return;
				}
			}
			const {
				text: responseText,
				metadata,
				toolCalls,
				thinking,
			} = await sendChatMessage(msg.text, history, {
				jwtToken,
				sessionId,
				onEvent: handleAgentEvent,
			});
			const assistantMessage: ChatMessage = {
				id: generateMessageId(),
				text: responseText,
				role: "assistant",
				timestamp: Date.now(),
				toolCalls,
				thinking,
				metadata,
			};
			setMessages((prev) => [...prev, assistantMessage]);
		} catch (error: any) {
			console.error("Error retrying:", error);
			Alert.alert(
				"Error",
				error.message || "Failed to get a new reply. Please try again.",
			);
		} finally {
			setIsLoading(false);
			setCurrentToolCall(null);
			setCurrentStatus(null);
		}
	};

	// Start a new chat session
	const handleNewChat = useCallback(async () => {
		if (isLoading) return;
		await clearChatSession();
		setMessages([]);
		setSessionId(`session-${Date.now()}`);
		setCurrentToolCall(null);
		setCurrentStatus(null);
	}, [isLoading]);

	const pulseAnim = useRef(new Animated.Value(1)).current;

	useEffect(() => {
		if (isRecording) {
			Animated.loop(
				Animated.sequence([
					Animated.timing(pulseAnim, {
						toValue: 1.2,
						duration: 1000,
						useNativeDriver: true,
					}),
					Animated.timing(pulseAnim, {
						toValue: 1,
						duration: 1000,
						useNativeDriver: true,
					}),
				]),
			).start();
		} else {
			pulseAnim.setValue(1);
		}
	}, [isRecording]);

	return (
		<LinearGradient
			colors={["#050B1A", "#0B1220", "#0A0F1A"]}
			style={{ flex: 1, paddingTop: 60 }}
		>
		<KeyboardAvoidingView
			style={{ flex: 1 }}
			behavior={Platform.OS === "ios" ? "padding" : "height"}
			keyboardVerticalOffset={0}
		>
				{/* HEADER */}
				<View style={styles.header}>
					<View style={styles.headerRow}>
						<View style={{ flex: 1 }}>
							<Text style={styles.headerTitle}>Chat</Text>
							<Text style={styles.headerSubtitle}>
								{brainStatus.soul?.name
									? `with ${brainStatus.soul.name}`
									: "Your 2nd Brain"}
							</Text>
						</View>
						{messages.length > 0 && (
							<TouchableOpacity
								onPress={handleNewChat}
								style={styles.newChatBtn}
								activeOpacity={0.7}
							>
								<Ionicons name="add-circle-outline" size={20} color="#22D3EE" />
								<Text style={styles.newChatBtnText}>New Chat</Text>
							</TouchableOpacity>
						)}
					</View>
					<Text style={styles.headerStatus}>
						Workspace: {brainStatus.mcpConnected ? "connected" : "offline"} •
						Memory: {brainStatus.memoryConnected ? "connected" : "offline"}
					</Text>

					{/* Current Status Indicator */}
					{(currentStatus || currentToolCall) && (
						<View style={styles.toolCallIndicator}>
							<ActivityIndicator size="small" color="#22D3EE" />
							<Text style={styles.toolCallText}>
								{currentStatus || `Using ${currentToolCall}...`}
							</Text>
						</View>
					)}
				</View>

				{/* BODY */}
				<View style={{ flex: 1 }}>
					{messages.length === 0 ? (
						<View style={styles.emptyState}>
							<LinearGradient
								colors={["#22D3EE", "#7C3AED", "#EC4899"]}
								start={{ x: 0, y: 0 }}
								end={{ x: 1, y: 1 }}
								style={styles.emptyStateIcon}
							>
								<Ionicons name="sparkles" size={42} color="#020617" />
							</LinearGradient>

							<Text style={styles.emptyStateTitle}>
								{brainStatus.soul?.userContext?.preferredName
									? `Hey, ${brainStatus.soul.userContext.preferredName}!`
									: brainStatus.soul
										? `Hey, I'm ${brainStatus.soul.name}`
										: "What can I help with?"}
							</Text>

							<Text style={styles.emptyStateSubtitle}>
								{brainStatus.soul
									? "Your cognitive partner - I handle the details so you can focus on what matters."
									: "Ask me anything. I'll use my tools and memory to help you."}
							</Text>
						</View>
					) : (
						<FlatList
							ref={flatListRef}
							style={{ flex: 1 }}
							contentContainerStyle={{ padding: 20, paddingBottom: 10 }}
							data={messages}
							keyExtractor={(item) => item.id}
							onContentSizeChange={() => {
								setTimeout(() => {
									flatListRef.current?.scrollToEnd({ animated: true });
								}, 100);
							}}
							onLayout={() => {
								setTimeout(() => {
									flatListRef.current?.scrollToEnd({ animated: false });
								}, 100);
							}}
							renderItem={({ item, index }) => (
								<View
									style={[
										styles.messageContainer,
										item.role === "user"
											? styles.userMessage
											: styles.assistantMessage,
									]}
								>
									{item.role === "assistant" && (
										<View style={styles.assistantAvatar}>
											<Ionicons name="sparkles" size={16} color="#22D3EE" />
										</View>
									)}
									<View
										style={[
											item.role === "user" && styles.userBubbleAndRetryWrap,
										]}
									>
										<View
											style={[
												styles.messageBubble,
												item.role === "user" && styles.userMessageBubble,
											]}
										>
											{item.role === "assistant" ? (
												<Markdown style={markdownStyles}>{item.text}</Markdown>
											) : (
												<Text
													style={[styles.messageText, styles.userMessageText]}
												>
													{item.text}
												</Text>
											)}

											{item.role === "assistant" &&
												item.metadata?.citations &&
												item.metadata.citations.length > 0 && (
													<View style={styles.citationsContainer}>
														<View style={styles.citationsHeader}>
															<Ionicons name="link" size={12} color="#22D3EE" />
															<Text style={styles.citationsTitle}>Sources</Text>
														</View>
														{item.metadata.citations.map(
															(citation: any, idx: number) => (
																<Text key={idx} style={styles.citationItem}>
																	{citation?.title || citation?.uri || "Source"}
																</Text>
															),
														)}
													</View>
												)}
										</View>
										{item.role === "user" &&
											messages[index + 1]?.role === "assistant" &&
											!isLoading && (
												<TouchableOpacity
													style={styles.retryButton}
													onPress={() => retryReply(index)}
													activeOpacity={0.7}
												>
													<Ionicons name="refresh" size={14} color="#22D3EE" />
													<Text style={styles.retryButtonText}>Retry</Text>
												</TouchableOpacity>
											)}
									</View>
								</View>
							)}
							ListFooterComponent={
								isLoading ? (
									<View style={styles.loadingBubble}>
										<View style={styles.loadingDots}>
											<Animated.View style={[styles.dot, styles.dot1]} />
											<Animated.View style={[styles.dot, styles.dot2]} />
											<Animated.View style={[styles.dot, styles.dot3]} />
										</View>
									</View>
								) : null
							}
						/>
					)}
				</View>

				{/* VOICE-FIRST INPUT */}
				<View style={styles.inputContainer}>
					{isTyping ? (
						<View style={styles.inputWrapper}>
							{/* Keyboard/Voice Toggle */}
							<TouchableOpacity
								onPress={() => setIsTyping(false)}
								style={styles.toggleButton}
							>
								<Ionicons name="mic-outline" size={22} color="#22D3EE" />
							</TouchableOpacity>

							<TextInput
								autoFocus
								placeholder="Type a message..."
								placeholderTextColor="#6B7280"
								value={message}
								onChangeText={setMessage}
								onSubmitEditing={sendMessage}
								editable={!isLoading && !isRecording}
								style={styles.textInput}
								multiline
							/>

						{/* Send button - only when there's text */}
						{message.trim() ? (
							<TouchableOpacity
								onPress={sendMessage}
								disabled={!message.trim() || isLoading}
								style={[
									styles.sendButton,
									message.trim() && !isLoading && styles.sendButtonActive,
								]}
							>
								<LinearGradient
									colors={
										message.trim() && !isLoading
											? ["#00CFE8", "#06B6D4"]
											: ["#1E293B", "#1E293B"]
									}
									style={styles.sendButtonGradient}
								>
									<Ionicons
										name="send"
										size={18}
										color={message.trim() ? "#001018" : "#64748B"}
									/>
								</LinearGradient>
							</TouchableOpacity>
						) : null}
						</View>
					) : (
						<View style={styles.voiceModeContainer}>
							<TouchableOpacity
								onPress={() => setIsTyping(true)}
								style={styles.toggleButtonFloating}
							>
								<Ionicons name="text-outline" size={22} color="#9CA3AF" />
								<Text style={styles.toggleButtonLabel}>Aa</Text>
							</TouchableOpacity>

							<TouchableOpacity
								onPress={toggleRecording}
								disabled={isLoading}
								style={styles.voiceButtonCenter}
							>
								<Animated.View
									style={[
										styles.voiceButton,
										isRecording && styles.voiceButtonRecording,
										{ transform: [{ scale: pulseAnim }] },
									]}
								>
									{isRecording ? (
										<View style={styles.stopIconLarge} />
									) : (
										<LinearGradient
											colors={["#22D3EE", "#06B6D4"]}
											style={styles.voiceButtonGradient}
										>
											<Ionicons name="mic" size={28} color="#020617" />
										</LinearGradient>
									)}
								</Animated.View>

								<Text style={styles.voiceButtonText}>
									{isRecording ? "Tap to stop" : "Tap to record"}
								</Text>
							</TouchableOpacity>

							{/* Spacer to balance the layout */}
							<View style={styles.toggleButtonFloating}>
								<View style={{ width: 22, height: 22 }} />
							</View>
						</View>
					)}
				</View>
			</KeyboardAvoidingView>
		</LinearGradient>
	);
}

const styles = StyleSheet.create({
	header: {
		paddingHorizontal: 20,
		paddingBottom: 20,
	},
	toolCallIndicator: {
		flexDirection: "row",
		alignItems: "center",
		backgroundColor: "rgba(34, 211, 238, 0.1)",
		paddingHorizontal: 12,
		paddingVertical: 6,
		borderRadius: 16,
		gap: 8,
		alignSelf: "flex-start",
		marginTop: 8,
	},
	toolCallText: {
		color: "#22D3EE",
		fontSize: 12,
		fontWeight: "500",
	},
	headerRow: {
		flexDirection: "row",
		alignItems: "flex-start",
		justifyContent: "space-between",
	},
	headerTitle: {
		color: "white",
		fontSize: 36,
		fontWeight: "800",
		letterSpacing: -0.5,
	},
	headerSubtitle: {
		color: "#94A3B8",
		fontSize: 14,
		marginTop: 6,
	},
	newChatBtn: {
		flexDirection: "row",
		alignItems: "center",
		gap: 5,
		paddingHorizontal: 12,
		paddingVertical: 8,
		borderRadius: 20,
		borderWidth: 1,
		borderColor: "rgba(34, 211, 238, 0.25)",
		backgroundColor: "rgba(34, 211, 238, 0.08)",
		marginTop: 4,
	},
	newChatBtnText: {
		color: "#22D3EE",
		fontSize: 13,
		fontWeight: "600",
	},
	headerStatus: {
		color: "#64748B",
		fontSize: 12,
		marginTop: 6,
	},
	emptyState: {
		flex: 1,
		justifyContent: "center",
		alignItems: "center",
		paddingHorizontal: 30,
	},
	emptyStateIcon: {
		width: 100,
		height: 100,
		borderRadius: 28,
		justifyContent: "center",
		alignItems: "center",
		marginBottom: 28,
		shadowColor: "#22D3EE",
		shadowOffset: { width: 0, height: 8 },
		shadowOpacity: 0.3,
		shadowRadius: 16,
		elevation: 8,
	},
	emptyStateTitle: {
		color: "white",
		fontSize: 28,
		fontWeight: "700",
		marginBottom: 12,
		textAlign: "center",
	},
	emptyStateSubtitle: {
		color: "#94A3B8",
		fontSize: 16,
		textAlign: "center",
		lineHeight: 24,
		marginBottom: 24,
	},
	messageContainer: {
		flexDirection: "row",
		maxWidth: "85%",
		marginBottom: 16,
		gap: 8,
	},
	userMessage: {
		alignSelf: "flex-end",
		flexDirection: "row-reverse",
	},
	userBubbleAndRetryWrap: {
		alignItems: "flex-end",
		gap: 6,
	},
	retryButton: {
		flexDirection: "row",
		alignItems: "center",
		gap: 4,
		paddingVertical: 4,
		paddingHorizontal: 8,
	},
	retryButtonText: {
		fontSize: 12,
		color: "#22D3EE",
		fontWeight: "500",
	},
	assistantMessage: {
		alignSelf: "flex-start",
	},
	assistantAvatar: {
		width: 32,
		height: 32,
		borderRadius: 16,
		backgroundColor: "rgba(34, 211, 238, 0.2)",
		justifyContent: "center",
		alignItems: "center",
		marginTop: 4,
	},
	messageBubble: {
		backgroundColor: "#1E293B",
		paddingHorizontal: 16,
		paddingVertical: 12,
		borderRadius: 20,
		borderTopLeftRadius: 4,
		shadowColor: "#000",
		shadowOffset: { width: 0, height: 2 },
		shadowOpacity: 0.1,
		shadowRadius: 8,
		elevation: 2,
	},
	userMessageBubble: {
		backgroundColor: "#00CFE8",
		borderTopLeftRadius: 20,
		borderTopRightRadius: 4,
	},
	messageText: {
		fontSize: 16,
		lineHeight: 24,
	},
	userMessageText: {
		color: "#001018",
		fontWeight: "500",
	},
	assistantMessageText: {
		color: "#E2E8F0",
	},
	citationsContainer: {
		marginTop: 10,
		backgroundColor: "rgba(34, 211, 238, 0.08)",
		borderRadius: 8,
		padding: 8,
		gap: 6,
	},
	citationsHeader: {
		flexDirection: "row",
		alignItems: "center",
		gap: 6,
	},
	citationsTitle: {
		color: "#22D3EE",
		fontSize: 11,
		fontWeight: "600",
	},
	citationItem: {
		color: "#94A3B8",
		fontSize: 11,
	},
	loadingBubble: {
		alignSelf: "flex-start",
		backgroundColor: "#1E293B",
		paddingHorizontal: 20,
		paddingVertical: 14,
		borderRadius: 20,
		borderTopLeftRadius: 4,
		marginBottom: 10,
	},
	loadingDots: {
		flexDirection: "row",
		gap: 6,
		alignItems: "center",
	},
	dot: {
		width: 8,
		height: 8,
		borderRadius: 4,
		backgroundColor: "#22D3EE",
	},
	dot1: {
		opacity: 0.4,
	},
	dot2: {
		opacity: 0.7,
	},
	dot3: {
		opacity: 1,
	},
	inputContainer: {
		paddingHorizontal: 16,
		paddingBottom: 4,
		paddingTop: 6,
	},
	inputWrapper: {
		backgroundColor: "#0F172A",
		borderRadius: 32,
		paddingVertical: 6,
		paddingLeft: 6,
		paddingRight: 6,
		flexDirection: "row",
		alignItems: "center",
		borderWidth: 1,
		borderColor: "rgba(34, 211, 238, 0.1)",
		shadowColor: "#000",
		shadowOffset: { width: 0, height: 4 },
		shadowOpacity: 0.1,
		shadowRadius: 12,
		elevation: 4,
	},
	voiceModeContainer: {
		flexDirection: "row",
		alignItems: "center",
		justifyContent: "center",
		paddingVertical: 8,
	},
	toggleButton: {
		padding: 10,
		borderRadius: 20,
		alignSelf: "center",
	},
	toggleButtonFloating: {
		padding: 10,
		borderRadius: 20,
		alignItems: "center",
		justifyContent: "center",
		width: 50,
	},
	toggleButtonLabel: {
		color: "#9CA3AF",
		fontSize: 10,
		marginTop: 2,
		fontWeight: "600",
	},
	textInput: {
		flex: 1,
		color: "white",
		marginHorizontal: 8,
		fontSize: 16,
		maxHeight: 100,
		paddingVertical: 6,
	},
	recordButtonSmall: {
		width: 38,
		height: 38,
		borderRadius: 19,
		backgroundColor: "#1E293B",
		justifyContent: "center",
		alignItems: "center",
	},
	recordButtonActive: {
		backgroundColor: "#EF4444",
	},
	stopIcon: {
		width: 16,
		height: 16,
		borderRadius: 4,
		backgroundColor: "#020617",
	},
	voiceButtonCenter: {
		alignItems: "center",
		justifyContent: "center",
		flex: 1,
	},
	voiceButton: {
		width: 64,
		height: 64,
		borderRadius: 32,
		justifyContent: "center",
		alignItems: "center",
	},
	voiceButtonRecording: {
		backgroundColor: "#EF4444",
	},
	voiceButtonGradient: {
		width: 64,
		height: 64,
		borderRadius: 32,
		justifyContent: "center",
		alignItems: "center",
		shadowColor: "#22D3EE",
		shadowOffset: { width: 0, height: 4 },
		shadowOpacity: 0.4,
		shadowRadius: 12,
		elevation: 6,
	},
	stopIconLarge: {
		width: 24,
		height: 24,
		borderRadius: 6,
		backgroundColor: "#020617",
	},
	voiceButtonText: {
		color: "#94A3B8",
		fontSize: 12,
		marginTop: 8,
		fontWeight: "500",
	},
	sendButton: {
		width: 38,
		height: 38,
		borderRadius: 19,
		overflow: "hidden",
	},
	sendButtonActive: {
		shadowColor: "#00CFE8",
		shadowOffset: { width: 0, height: 4 },
		shadowOpacity: 0.3,
		shadowRadius: 8,
		elevation: 4,
	},
	sendButtonGradient: {
		width: "100%",
		height: "100%",
		justifyContent: "center",
		alignItems: "center",
	},
});

const markdownStyles = StyleSheet.create({
	body: {
		color: "#E2E8F0",
		fontSize: 16,
		lineHeight: 24,
	},
	paragraph: {
		marginTop: 0,
		marginBottom: 8,
	},
	heading1: {
		color: "#E2E8F0",
		fontSize: 22,
		marginTop: 8,
		marginBottom: 6,
	},
	heading2: {
		color: "#E2E8F0",
		fontSize: 20,
		marginTop: 8,
		marginBottom: 6,
	},
	heading3: {
		color: "#E2E8F0",
		fontSize: 18,
		marginTop: 8,
		marginBottom: 6,
	},
	link: {
		color: "#22D3EE",
	},
	bullet_list: {
		marginVertical: 6,
	},
	ordered_list: {
		marginVertical: 6,
	},
	list_item: {
		color: "#E2E8F0",
	},
	code_inline: {
		backgroundColor: "#0F172A",
		color: "#E2E8F0",
		paddingHorizontal: 6,
		paddingVertical: 2,
		borderRadius: 6,
	},
	code_block: {
		backgroundColor: "#0F172A",
		color: "#E2E8F0",
		padding: 10,
		borderRadius: 8,
	},
	fence: {
		backgroundColor: "#0F172A",
		color: "#E2E8F0",
		padding: 10,
		borderRadius: 8,
	},
	blockquote: {
		backgroundColor: "rgba(148, 163, 184, 0.1)",
		borderLeftColor: "#94A3B8",
		borderLeftWidth: 3,
		paddingLeft: 10,
		marginVertical: 6,
	},
});
