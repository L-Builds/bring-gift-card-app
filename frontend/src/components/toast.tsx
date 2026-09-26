import React, { createContext, useContext, useCallback, useRef, useState } from "react";
import { Text, View, Animated, Platform, Pressable } from "react-native";
import Ionicons from "@react-native-vector-icons/ionicons";
import { makeStyles, useTheme, radius, spacing } from "@/src/theme";

type ToastType = "success" | "error" | "info";
type ToastOpts = { actionLabel?: string; onPress?: () => void; duration?: number };
type ToastState = { message: string; type: ToastType; opts: ToastOpts } | null;

const ToastContext = createContext<{ show: (m: string, t?: ToastType, opts?: ToastOpts) => void } | undefined>(undefined);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toast, setToast] = useState<ToastState>(null);
  const opacity = useRef(new Animated.Value(0)).current;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const styles = useStyles();
  const { colors } = useTheme();

  const hide = useCallback(() => {
    Animated.timing(opacity, { toValue: 0, duration: 250, useNativeDriver: Platform.OS !== "web" }).start(() => setToast(null));
  }, [opacity]);

  const show = useCallback(
    (message: string, type: ToastType = "info", opts: ToastOpts = {}) => {
      if (timer.current) clearTimeout(timer.current);
      setToast({ message, type, opts });
      Animated.timing(opacity, { toValue: 1, duration: 200, useNativeDriver: Platform.OS !== "web" }).start();
      timer.current = setTimeout(hide, opts.duration ?? (opts.onPress ? 5000 : 2600));
    },
    [opacity, hide],
  );

  const bg =
    toast?.type === "success" ? colors.success : toast?.type === "error" ? colors.error : colors.surfaceInverse;
  const icon =
    toast?.type === "success" ? "checkmark-circle" : toast?.type === "error" ? "alert-circle" : "information-circle";
  const interactive = !!toast?.opts.onPress;

  return (
    <ToastContext.Provider value={{ show }}>
      {children}
      {toast && (
        <Animated.View pointerEvents={interactive ? "box-none" : "none"} style={[styles.wrap, { opacity }]} testID="app-toast">
          <Pressable
            disabled={!interactive}
            onPress={() => {
              if (timer.current) clearTimeout(timer.current);
              hide();
              toast.opts.onPress?.();
            }}
            style={[styles.toast, { backgroundColor: bg }]}
            testID="app-toast-action"
          >
            <Ionicons name={icon as any} size={20} color={colors.onSurfaceInverse} />
            <Text style={styles.text}>{toast.message}</Text>
            {interactive && (
              <View style={styles.action}>
                <Text style={styles.actionText}>{toast.opts.actionLabel ?? "View"}</Text>
              </View>
            )}
          </Pressable>
        </Animated.View>
      )}
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within ToastProvider");
  return ctx;
}

const useStyles = makeStyles((colors) => ({
  wrap: {
    position: "absolute",
    top: 60,
    left: 0,
    right: 0,
    alignItems: "center",
    zIndex: 9999,
  },
  toast: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.pill,
    maxWidth: "90%",
    shadowColor: "#000",
    shadowOpacity: 0.2,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
  text: { color: colors.onSurfaceInverse, fontWeight: "600", fontSize: 14, flexShrink: 1 },
  action: { backgroundColor: "rgba(255,255,255,0.22)", borderRadius: radius.pill, paddingHorizontal: spacing.md, paddingVertical: 4, marginLeft: spacing.xs },
  actionText: { color: colors.onSurfaceInverse, fontWeight: "800", fontSize: 12 },
}));
