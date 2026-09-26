import { QueryClientProvider } from "@tanstack/react-query";
import { Stack } from "expo-router";
import { LogBox } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { StatusBar } from "expo-status-bar";

import { ErrorBoundary } from "@/src/components/error-boundary";
import { queryClient } from "@/src/query-client";
import { AuthProvider } from "@/src/context/auth";
import { ToastProvider } from "@/src/components/toast";
import { SideMenuProvider } from "@/src/components/side-menu";
import { LiveAlertsProvider } from "@/src/components/live-alerts";
import { RouteAccessGuard } from "@/src/components/route-access-guard";

LogBox.ignoreAllLogs(true);

export default function RootLayout() {
  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <GestureHandlerRootView style={{ flex: 1 }}>
          <SafeAreaProvider>
            <KeyboardProvider>
              <AuthProvider>
                <ToastProvider>
                  <LiveAlertsProvider>
                    <SideMenuProvider>
                      <StatusBar style="dark" />
                      <RouteAccessGuard>
                        <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: "#EAF2FF" } }} />
                      </RouteAccessGuard>
                    </SideMenuProvider>
                  </LiveAlertsProvider>
                </ToastProvider>
              </AuthProvider>
            </KeyboardProvider>
          </SafeAreaProvider>
        </GestureHandlerRootView>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}
