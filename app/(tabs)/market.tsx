import { useMCPAuth } from "@/hooks/use-mcp-auth";
import {
    checkMCPHealth,
    getMCPServerURL,
    getTravelServerURL,
    isGoogleConnected,
    listMCPTools,
    type MCPTool,
    reinitializeMCP,
} from "@/services/mcp-client";
import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
    ActivityIndicator,
    Alert,
    FlatList,
    ScrollView,
    StyleSheet,
    Text,
    TextInput,
    TouchableOpacity,
    View,
} from "react-native";

// =============================================================================
// CONNECTOR DEFINITIONS
// =============================================================================

type ConnectorStatus =
	| "connected"
	| "disconnected"
	| "connecting"
	| "error"
	| "soon";

interface Connector {
	id: string;
	name: string;
	description: string;
	category: string;
	icon: string;
	/** Whether this connector needs OAuth (vs just a URL/key) */
	needsOAuth: boolean;
	/** Tools discovered from this server */
	tools: MCPTool[];
	/** Live status */
	status: ConnectorStatus;
	/** Error message if any */
	error?: string;
}

/** Static connector metadata – status & tools filled at runtime */
const CONNECTOR_DEFS: Omit<Connector, "tools" | "status" | "error">[] = [
	{
		id: "google",
		name: "Google Workspace",
		description: "Gmail, Calendar, Drive, Contacts",
		category: "Productivity",
		icon: "google",
		needsOAuth: true,
	},
	{
		id: "travel",
		name: "Travel",
		description: "Flights, hotels & web search (SerpAPI)",
		category: "Travel",
		icon: "airplane",
		needsOAuth: false,
	},
	{
		id: "spotify",
		name: "Spotify",
		description: "Music streaming",
		category: "Entertainment",
		icon: "music",
		needsOAuth: false,
	},
	{
		id: "netflix",
		name: "Netflix",
		description: "Watch movies and shows",
		category: "Entertainment",
		icon: "television",
		needsOAuth: false,
	},
];

const CATEGORIES = ["All", "Productivity", "Travel", "AI", "Entertainment"];

// =============================================================================
// COMPONENT
// =============================================================================

export default function MarketScreen() {
	const [search, setSearch] = useState("");
	const [selectedCategory, setSelectedCategory] = useState("All");
	const [connectors, setConnectors] = useState<Connector[]>([]);
	const [isRefreshing, setIsRefreshing] = useState(false);

	// MCP auth hook (handles Google OAuth)
	const mcpAuth = useMCPAuth();

	// ── Build live connector list ──────────────────────────────────────────────

	/** Discover tools and update connector statuses */
	const discoverTools = useCallback(async () => {
		setIsRefreshing(true);

		// Fetch all tools (aggregated from all healthy servers)
		let allTools: MCPTool[] = [];
		try {
			allTools = await listMCPTools();
		} catch {
			// No tools available
		}

		// Check health of primary (Google) server
		const health = await checkMCPHealth();
		const hasGoogleAuth = isGoogleConnected();
		const googleUrl = getMCPServerURL();

		// Build connector state
		const updated: Connector[] = CONNECTOR_DEFS.map((def) => {
			if (def.id === "google") {
				const isConfigured = !!googleUrl;
				const isHealthy = health.healthy;
				const hasAuth = hasGoogleAuth;
				const googleTools = allTools.filter(
					(t) =>
						t.name.startsWith("gmail_") ||
						t.name.startsWith("drive_") ||
						t.name.startsWith("calendar_") ||
						t.name.startsWith("contacts_") ||
						t.name.startsWith("auth_"),
				);

				// OAuth connectors require actual auth to be "connected"
				// (server lists tools publicly, but calls need a token)
				let status: ConnectorStatus = "disconnected";
				if (!isConfigured) status = "disconnected";
				else if (isHealthy && hasAuth) status = "connected";
				else if (isHealthy)
					status = "disconnected"; // server up, needs OAuth
				else status = "error";

				return {
					...def,
					tools: googleTools,
					status,
					error: !isConfigured
						? "Server URL not configured"
						: !isHealthy
							? health.error
							: undefined,
				};
			}

			if (def.id === "travel") {
				const travelToolNames = [
					"flight",
					"hotel",
					"travel",
					"cache",
					"cheapest",
					"budget",
					"search_flights",
					"search_hotels",
				];
				const travelTools = allTools.filter((t) =>
					travelToolNames.some((k) => t.name.toLowerCase().includes(k)),
				);
				const travelUrl = getTravelServerURL();
				const isConfigured = !!travelUrl;
				return {
					...def,
					tools: travelTools,
					status: travelTools.length > 0 ? "connected" : "disconnected",
					error:
						isConfigured && travelTools.length === 0
							? "No tools from Travel server. Check EXPO_PUBLIC_MCP_TRAVEL_URL and EXPO_PUBLIC_MCP_API_KEY in .env, then restart (npx expo start)."
							: !isConfigured
								? "Set EXPO_PUBLIC_MCP_TRAVEL_URL in .env"
								: undefined,
				};
			}

			// Coming soon connectors
			return { ...def, tools: [], status: "soon" as ConnectorStatus };
		});

		setConnectors(updated);
		setIsRefreshing(false);
	}, []);

	// Auto-discover on mount
	useEffect(() => {
		discoverTools();
	}, [discoverTools]);

	// Re-discover when Google auth state changes (connect/disconnect/expiry)
	const googleConnected = mcpAuth.isGoogleConnected;
	useEffect(() => {
		discoverTools();
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [googleConnected]);

	// ── OAuth handlers ─────────────────────────────────────────────────────────

	const handleConnect = useCallback(
		async (connector: Connector) => {
			if (connector.id === "google" && connector.needsOAuth) {
				// Update status to connecting
				setConnectors((prev) =>
					prev.map((c) =>
						c.id === "google"
							? { ...c, status: "connecting" as ConnectorStatus }
							: c,
					),
				);

				const result = await mcpAuth.promptGoogleOAuth();

				if (result.success) {
					// Re-discover tools after successful auth (automatic tool discovery)
					await reinitializeMCP();
					await discoverTools();
				} else if (result.error) {
					Alert.alert("OAuth Failed", result.error);
					setConnectors((prev) =>
						prev.map((c) =>
							c.id === "google"
								? {
										...c,
										status: "error" as ConnectorStatus,
										error: result.error,
									}
								: c,
						),
					);
				}
			}
		},
		[mcpAuth, discoverTools],
	);

	const handleDisconnect = useCallback(
		async (connector: Connector) => {
			if (connector.id === "google") {
				Alert.alert(
					"Disconnect Google",
					"This will remove your Google OAuth token. You'll need to reconnect to use Google tools.",
					[
						{ text: "Cancel", style: "cancel" },
						{
							text: "Disconnect",
							style: "destructive",
							onPress: async () => {
								await mcpAuth.signOut();
								await discoverTools();
							},
						},
					],
				);
			}
		},
		[mcpAuth, discoverTools],
	);

	// ── Filter logic ───────────────────────────────────────────────────────────

	const filteredData = useMemo(() => {
		return connectors.filter((item) => {
			const matchesCategory =
				selectedCategory === "All" || item.category === selectedCategory;
			const matchesSearch = item.name
				.toLowerCase()
				.includes(search.toLowerCase());
			return matchesCategory && matchesSearch;
		});
	}, [search, selectedCategory, connectors]);

	// Stats
	const connectedCount = connectors.filter(
		(c) => c.status === "connected",
	).length;
	const totalTools = connectors.reduce((sum, c) => sum + c.tools.length, 0);

	// ── Render ─────────────────────────────────────────────────────────────────

	return (
		<LinearGradient
			colors={["#050B1A", "#0B1220", "#0A0F1A"]}
			style={{ flex: 1, paddingTop: 60 }}
		>
			{/* HEADER */}
			<View style={styles.header}>
				<View style={styles.headerTop}>
					<View style={styles.headerBadge}>
						<Ionicons name="storefront" size={12} color="#22D3EE" />
						<Text style={styles.headerBadgeText}>2ND BRAIN</Text>
					</View>
					<TouchableOpacity
						onPress={discoverTools}
						disabled={isRefreshing}
						style={styles.refreshButton}
					>
						{isRefreshing ? (
							<ActivityIndicator size="small" color="#22D3EE" />
						) : (
							<Ionicons name="refresh" size={18} color="#22D3EE" />
						)}
					</TouchableOpacity>
				</View>
				<Text style={styles.headerTitle}>MCP Marketplace</Text>
				<Text style={styles.headerSubtitle}>
					{connectedCount} connected{" "}
					{totalTools > 0 ? `\u00B7 ${totalTools} tools discovered` : ""}
				</Text>
			</View>

			{/* SEARCH BAR */}
			<View style={styles.searchContainer}>
				<View style={styles.searchBar}>
					<Ionicons name="search" size={20} color="#94A3B8" />
					<TextInput
						placeholder="Search connectors..."
						placeholderTextColor="#64748B"
						value={search}
						onChangeText={setSearch}
						style={styles.searchInput}
					/>
					{search.length > 0 && (
						<TouchableOpacity onPress={() => setSearch("")}>
							<Ionicons name="close-circle" size={20} color="#64748B" />
						</TouchableOpacity>
					)}
				</View>
			</View>

			{/* CATEGORY PILLS */}
			<ScrollView
				horizontal
				showsHorizontalScrollIndicator={false}
				contentContainerStyle={styles.categoriesContainer}
				style={styles.categoriesScroll}
			>
				{CATEGORIES.map((cat) => {
					const active = cat === selectedCategory;
					return (
						<TouchableOpacity
							key={cat}
							onPress={() => setSelectedCategory(cat)}
							style={[styles.categoryPill, active && styles.categoryPillActive]}
						>
							{active ? (
								<LinearGradient
									colors={["#22D3EE", "#06B6D4"]}
									style={styles.categoryPillGradient}
								>
									<Text style={styles.categoryPillTextActive}>{cat}</Text>
								</LinearGradient>
							) : (
								<Text style={styles.categoryPillText}>{cat}</Text>
							)}
						</TouchableOpacity>
					);
				})}
			</ScrollView>

			{/* CONNECTOR LIST */}
			{filteredData.length === 0 ? (
				<View style={styles.emptyState}>
					<Ionicons name="search-outline" size={64} color="#64748B" />
					<Text style={styles.emptyStateText}>No connectors found</Text>
					<Text style={styles.emptyStateSubtext}>
						Try adjusting your search or category filter
					</Text>
				</View>
			) : (
				<FlatList
					data={filteredData}
					keyExtractor={(item) => item.id}
					contentContainerStyle={styles.listContainer}
					showsVerticalScrollIndicator={false}
					renderItem={({ item }) => (
						<ConnectorCard
							connector={item}
							onConnect={handleConnect}
							onDisconnect={handleDisconnect}
							isAuthLoading={mcpAuth.isLoading}
						/>
					)}
				/>
			)}
		</LinearGradient>
	);
}

// =============================================================================
// CONNECTOR CARD
// =============================================================================

function ConnectorCard({
	connector,
	onConnect,
	onDisconnect,
	isAuthLoading,
}: {
	connector: Connector;
	onConnect: (c: Connector) => void;
	onDisconnect: (c: Connector) => void;
	isAuthLoading: boolean;
}) {
	const { status, tools, needsOAuth, error } = connector;
	const isConnecting =
		status === "connecting" || (isAuthLoading && connector.id === "google");

	return (
		<View style={styles.connectorCard}>
			<View style={styles.connectorContent}>
				{/* ICON */}
				<LinearGradient
					colors={
						status === "connected"
							? ["#22D3EE", "#06B6D4"]
							: status === "error"
								? ["#EF4444", "#DC2626"]
								: ["#1E293B", "#0F172A"]
					}
					style={styles.iconContainer}
				>
					<MaterialCommunityIcons
						name={connector.icon as any}
						size={28}
						color={
							status === "connected"
								? "#020617"
								: status === "error"
									? "#FFF"
									: "#22D3EE"
						}
					/>
				</LinearGradient>

				{/* TEXT */}
				<View style={styles.connectorText}>
					<View style={styles.connectorHeader}>
						<Text style={styles.connectorName}>{connector.name}</Text>
						<StatusBadge status={status} />
					</View>

					<Text style={styles.connectorDescription}>
						{connector.description}
					</Text>

					{/* Tool count when connected */}
					{status === "connected" && tools.length > 0 && (
						<View style={styles.toolCountRow}>
							<Ionicons name="construct" size={12} color="#22D3EE" />
							<Text style={styles.toolCountText}>
								{tools.length} tool{tools.length !== 1 ? "s" : ""} available
							</Text>
						</View>
					)}

					{/* Error message */}
					{status === "error" && error && (
						<Text style={styles.errorText} numberOfLines={1}>
							{error}
						</Text>
					)}

					<View style={styles.connectorCategory}>
						<Ionicons name="pricetag" size={12} color="#64748B" />
						<Text style={styles.connectorCategoryText}>
							{connector.category}
						</Text>
					</View>
				</View>
			</View>

			{/* ACTION BUTTON */}
			<View style={styles.actionRow}>
				{status === "soon" ? (
					<View style={styles.soonButton}>
						<Ionicons name="time-outline" size={16} color="#A78BFA" />
						<Text style={styles.soonButtonText}>Coming Soon</Text>
					</View>
				) : status === "connected" ? (
					<View style={styles.actionButtons}>
						<View style={styles.connectedButton}>
							<Ionicons name="checkmark-circle" size={16} color="#22D3EE" />
							<Text style={styles.connectedButtonText}>Connected</Text>
						</View>
						{needsOAuth && (
							<TouchableOpacity
								onPress={() => onDisconnect(connector)}
								style={styles.disconnectButton}
							>
								<Ionicons name="log-out-outline" size={16} color="#EF4444" />
							</TouchableOpacity>
						)}
					</View>
				) : status === "connecting" || isConnecting ? (
					<View style={styles.connectingButton}>
						<ActivityIndicator size="small" color="#22D3EE" />
						<Text style={styles.connectingButtonText}>Connecting...</Text>
					</View>
				) : needsOAuth ? (
					<TouchableOpacity
						onPress={() => onConnect(connector)}
						style={styles.connectButton}
					>
						<LinearGradient
							colors={["#22D3EE", "#06B6D4"]}
							style={styles.connectButtonGradient}
						>
							<Ionicons name="key" size={16} color="#020617" />
							<Text style={styles.connectButtonText}>Connect</Text>
						</LinearGradient>
					</TouchableOpacity>
				) : status === "error" ? (
					<TouchableOpacity
						onPress={() => onConnect(connector)}
						style={styles.retryButton}
					>
						<Ionicons name="refresh" size={16} color="#F59E0B" />
						<Text style={styles.retryButtonText}>Retry</Text>
					</TouchableOpacity>
				) : (
					<View style={styles.autoButton}>
						<Ionicons name="flash" size={16} color="#64748B" />
						<Text style={styles.autoButtonText}>Auto</Text>
					</View>
				)}
			</View>
		</View>
	);
}

// =============================================================================
// STATUS BADGE
// =============================================================================

function StatusBadge({ status }: { status: ConnectorStatus }) {
	if (status === "connected") {
		return (
			<View style={styles.connectedBadge}>
				<View style={styles.connectedDot} />
				<Text style={styles.connectedBadgeText}>Live</Text>
			</View>
		);
	}
	if (status === "error") {
		return (
			<View style={styles.errorBadge}>
				<View style={styles.errorDot} />
				<Text style={styles.errorBadgeText}>Error</Text>
			</View>
		);
	}
	if (status === "connecting") {
		return (
			<View style={styles.connectingBadge}>
				<ActivityIndicator size={8} color="#F59E0B" />
				<Text style={styles.connectingBadgeText}>Connecting</Text>
			</View>
		);
	}
	if (status === "soon") {
		return (
			<View style={styles.soonBadge}>
				<Text style={styles.soonBadgeText}>Soon</Text>
			</View>
		);
	}
	return null;
}

// =============================================================================
// STYLES
// =============================================================================

const styles = StyleSheet.create({
	header: {
		paddingHorizontal: 20,
		paddingBottom: 20,
	},
	headerTop: {
		flexDirection: "row",
		justifyContent: "space-between",
		alignItems: "center",
		marginBottom: 8,
	},
	headerBadge: {
		flexDirection: "row",
		alignItems: "center",
		backgroundColor: "rgba(34, 211, 238, 0.1)",
		paddingHorizontal: 10,
		paddingVertical: 4,
		borderRadius: 12,
		gap: 6,
	},
	headerBadgeText: {
		color: "#22D3EE",
		fontSize: 11,
		fontWeight: "600",
		letterSpacing: 0.5,
	},
	refreshButton: {
		width: 36,
		height: 36,
		borderRadius: 18,
		backgroundColor: "rgba(34, 211, 238, 0.1)",
		justifyContent: "center",
		alignItems: "center",
	},
	headerTitle: {
		color: "white",
		fontSize: 36,
		fontWeight: "800",
		letterSpacing: -0.5,
		marginBottom: 4,
	},
	headerSubtitle: {
		color: "#94A3B8",
		fontSize: 14,
		marginTop: 4,
	},
	searchContainer: {
		paddingHorizontal: 20,
		marginBottom: 16,
	},
	searchBar: {
		flexDirection: "row",
		alignItems: "center",
		paddingHorizontal: 16,
		paddingVertical: 14,
		borderRadius: 20,
		backgroundColor: "#0F172A",
		borderWidth: 1,
		borderColor: "rgba(34, 211, 238, 0.1)",
	},
	searchInput: {
		marginLeft: 12,
		color: "white",
		fontSize: 16,
		flex: 1,
	},
	categoriesContainer: {
		paddingHorizontal: 20,
		paddingVertical: 4,
	},
	categoriesScroll: {
		marginBottom: 16,
		overflow: "visible",
	},
	categoryPill: {
		height: 40,
		paddingHorizontal: 18,
		borderRadius: 20,
		backgroundColor: "#0F172A",
		justifyContent: "center",
		alignItems: "center",
		marginRight: 10,
		borderWidth: 1,
		borderColor: "rgba(34, 211, 238, 0.2)",
		overflow: "hidden",
	},
	categoryPillActive: {
		paddingHorizontal: 0,
		borderColor: "transparent",
		backgroundColor: "transparent",
	},
	categoryPillGradient: {
		flex: 1,
		width: "100%",
		justifyContent: "center",
		alignItems: "center",
		paddingHorizontal: 20,
	},
	categoryPillText: {
		color: "#CBD5E1",
		fontSize: 14,
		fontWeight: "600",
	},
	categoryPillTextActive: {
		color: "#020617",
		fontSize: 14,
		fontWeight: "700",
	},
	listContainer: {
		padding: 20,
		paddingTop: 0,
		paddingBottom: 40,
	},
	emptyState: {
		flex: 1,
		justifyContent: "center",
		alignItems: "center",
		paddingHorizontal: 40,
	},
	emptyStateText: {
		color: "white",
		fontSize: 20,
		fontWeight: "600",
		marginTop: 16,
		marginBottom: 8,
	},
	emptyStateSubtext: {
		color: "#94A3B8",
		fontSize: 14,
		textAlign: "center",
	},

	// Connector card
	connectorCard: {
		backgroundColor: "#0F172A",
		borderRadius: 24,
		padding: 18,
		marginBottom: 16,
		borderWidth: 1,
		borderColor: "rgba(34, 211, 238, 0.1)",
	},
	connectorContent: {
		flexDirection: "row",
		alignItems: "flex-start",
	},
	iconContainer: {
		width: 56,
		height: 56,
		borderRadius: 16,
		justifyContent: "center",
		alignItems: "center",
		marginRight: 16,
	},
	connectorText: {
		flex: 1,
	},
	connectorHeader: {
		flexDirection: "row",
		alignItems: "center",
		flexWrap: "wrap",
		gap: 8,
		marginBottom: 6,
	},
	connectorName: {
		color: "white",
		fontSize: 18,
		fontWeight: "700",
	},
	connectorDescription: {
		color: "#94A3B8",
		fontSize: 14,
		lineHeight: 20,
		marginBottom: 6,
	},
	toolCountRow: {
		flexDirection: "row",
		alignItems: "center",
		gap: 6,
		marginBottom: 6,
	},
	toolCountText: {
		color: "#22D3EE",
		fontSize: 12,
		fontWeight: "600",
	},
	errorText: {
		color: "#EF4444",
		fontSize: 12,
		marginBottom: 6,
	},
	connectorCategory: {
		flexDirection: "row",
		alignItems: "center",
		gap: 6,
	},
	connectorCategoryText: {
		color: "#64748B",
		fontSize: 12,
		fontWeight: "500",
	},

	// Action row
	actionRow: {
		marginTop: 14,
		flexDirection: "row",
		justifyContent: "flex-end",
	},
	actionButtons: {
		flexDirection: "row",
		alignItems: "center",
		gap: 8,
	},

	// Connected button
	connectedButton: {
		flexDirection: "row",
		alignItems: "center",
		backgroundColor: "rgba(34, 211, 238, 0.1)",
		paddingHorizontal: 14,
		paddingVertical: 8,
		borderRadius: 16,
		gap: 6,
	},
	connectedButtonText: {
		color: "#22D3EE",
		fontSize: 13,
		fontWeight: "700",
	},

	// Disconnect button
	disconnectButton: {
		width: 36,
		height: 36,
		borderRadius: 18,
		backgroundColor: "rgba(239, 68, 68, 0.1)",
		justifyContent: "center",
		alignItems: "center",
	},

	// Connect button (OAuth)
	connectButton: {
		borderRadius: 16,
		overflow: "hidden",
	},
	connectButtonGradient: {
		flexDirection: "row",
		alignItems: "center",
		paddingHorizontal: 18,
		paddingVertical: 10,
		gap: 6,
	},
	connectButtonText: {
		color: "#020617",
		fontSize: 13,
		fontWeight: "700",
	},

	// Connecting button
	connectingButton: {
		flexDirection: "row",
		alignItems: "center",
		backgroundColor: "rgba(245, 158, 11, 0.1)",
		paddingHorizontal: 14,
		paddingVertical: 8,
		borderRadius: 16,
		gap: 8,
	},
	connectingButtonText: {
		color: "#F59E0B",
		fontSize: 13,
		fontWeight: "600",
	},

	// Retry button
	retryButton: {
		flexDirection: "row",
		alignItems: "center",
		backgroundColor: "rgba(245, 158, 11, 0.1)",
		paddingHorizontal: 14,
		paddingVertical: 8,
		borderRadius: 16,
		gap: 6,
	},
	retryButtonText: {
		color: "#F59E0B",
		fontSize: 13,
		fontWeight: "600",
	},

	// Auto-connected (no OAuth needed)
	autoButton: {
		flexDirection: "row",
		alignItems: "center",
		backgroundColor: "#1E293B",
		paddingHorizontal: 14,
		paddingVertical: 8,
		borderRadius: 16,
		gap: 6,
	},
	autoButtonText: {
		color: "#64748B",
		fontSize: 13,
		fontWeight: "600",
	},

	// Soon button
	soonButton: {
		flexDirection: "row",
		alignItems: "center",
		backgroundColor: "rgba(124, 58, 237, 0.1)",
		paddingHorizontal: 14,
		paddingVertical: 8,
		borderRadius: 16,
		gap: 6,
		borderWidth: 1,
		borderColor: "rgba(124, 58, 237, 0.2)",
	},
	soonButtonText: {
		color: "#A78BFA",
		fontSize: 13,
		fontWeight: "600",
	},

	// Status badges
	connectedBadge: {
		flexDirection: "row",
		alignItems: "center",
		backgroundColor: "rgba(34, 211, 238, 0.1)",
		paddingHorizontal: 10,
		paddingVertical: 4,
		borderRadius: 12,
		gap: 6,
	},
	connectedDot: {
		width: 6,
		height: 6,
		borderRadius: 3,
		backgroundColor: "#22D3EE",
	},
	connectedBadgeText: {
		color: "#22D3EE",
		fontSize: 11,
		fontWeight: "700",
	},
	errorBadge: {
		flexDirection: "row",
		alignItems: "center",
		backgroundColor: "rgba(239, 68, 68, 0.1)",
		paddingHorizontal: 10,
		paddingVertical: 4,
		borderRadius: 12,
		gap: 6,
	},
	errorDot: {
		width: 6,
		height: 6,
		borderRadius: 3,
		backgroundColor: "#EF4444",
	},
	errorBadgeText: {
		color: "#EF4444",
		fontSize: 11,
		fontWeight: "700",
	},
	connectingBadge: {
		flexDirection: "row",
		alignItems: "center",
		backgroundColor: "rgba(245, 158, 11, 0.1)",
		paddingHorizontal: 10,
		paddingVertical: 4,
		borderRadius: 12,
		gap: 6,
	},
	connectingBadgeText: {
		color: "#F59E0B",
		fontSize: 11,
		fontWeight: "700",
	},
	soonBadge: {
		backgroundColor: "rgba(124, 58, 237, 0.2)",
		paddingHorizontal: 10,
		paddingVertical: 4,
		borderRadius: 12,
		borderWidth: 1,
		borderColor: "rgba(124, 58, 237, 0.3)",
	},
	soonBadgeText: {
		color: "#A78BFA",
		fontSize: 11,
		fontWeight: "700",
		letterSpacing: 0.5,
	},
});
