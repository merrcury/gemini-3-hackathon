import { View, Text, StyleSheet } from "react-native";

export default function LogsScreen() {
  return (
    <View style={styles.container}>
      <Text style={styles.text}>Logs</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "#0A0F1A",
  },
  text: {
    color: "#fff",
    fontSize: 18,
  },
});
