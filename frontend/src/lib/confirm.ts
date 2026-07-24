// Cross-platform confirm dialog.
//
// react-native-web's Alert.alert with a button list is a SILENT NO-OP —
// the dialog never appears and no button callback runs. That made every
// "Are you sure?" action (confirm delivery, delete address, …) dead on
// the web preview. On web we fall back to window.confirm; native keeps
// the familiar two-button Alert.
import { Alert, Platform } from "react-native";

export function confirmDialog(opts: {
  title: string;
  message: string;
  confirmLabel?: string;
  destructive?: boolean;
  onConfirm: () => void;
}) {
  const { title, message, confirmLabel = "Confirm", destructive, onConfirm } = opts;
  if (Platform.OS === "web") {
    if (window.confirm(`${title}\n\n${message}`)) onConfirm();
    return;
  }
  Alert.alert(title, message, [
    { text: "Cancel", style: "cancel" },
    {
      text: confirmLabel,
      style: destructive ? "destructive" : "default",
      onPress: onConfirm,
    },
  ]);
}
