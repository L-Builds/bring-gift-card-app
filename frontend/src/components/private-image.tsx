import React, { useEffect, useState } from "react";
import { Platform } from "react-native";
import { Image as ExpoImage, type ImageProps } from "expo-image";
import { privateImageBlob } from "@/src/api/client";

type Props = Omit<ImageProps, "source"> & { source: { uri: string; headers?: Record<string, string> } };

// Same image layout and Expo renderer; only the authenticated transport changes.
export function Image({ source, ...props }: Props) {
  const [loaded, setLoaded] = useState<{ source: string; uri: string } | null>(null);
  const authorization = source.headers?.Authorization || "";
  const key = source.uri + authorization;
  useEffect(() => {
    const controller = new AbortController();
    let objectUrl: string | undefined;
    let active = true;
    void privateImageBlob(source.uri, authorization ? { Authorization: authorization } : {}, controller.signal).then(async blob => {
      let uri: string;
      if (Platform.OS === "web") {
        uri = URL.createObjectURL(blob);
        objectUrl = uri;
      } else {
        uri = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result));
          reader.onerror = () => reject(new Error("Image could not be read"));
          reader.readAsDataURL(blob);
        });
      }
      if (active) setLoaded({ source: key, uri });
      else if (objectUrl) URL.revokeObjectURL(objectUrl);
    }).catch(() => { /* Retain the existing empty image state on an inaccessible file. */ });
    return () => { active = false; controller.abort(); if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [source.uri, authorization, key]);
  return <ExpoImage {...props} source={loaded?.source === key ? { uri: loaded.uri } : undefined} />;
}
