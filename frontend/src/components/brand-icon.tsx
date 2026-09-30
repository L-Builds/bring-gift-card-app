import React, { useState } from "react";
import { Image } from "expo-image";
import { api } from "@/src/api/client";
import { BrandMonogram } from "@/src/components/ui";

export type BrandArtwork = {
  id: string;
  name: string;
  color: string;
  has_logo?: boolean;
  logo_version?: string;
};

const bundledArt: Record<string, any> = {
  "apple/itunes": require("../../assets/home/brands/apple-itunes.png"),
  "apple itunes": require("../../assets/home/brands/apple-itunes.png"),
  "razer gold": require("../../assets/home/brands/razer-gold.png"),
  steam: require("../../assets/home/brands/steam.png"),
  playstation: require("../../assets/home/brands/playstation.png"),
  xbox: require("../../assets/home/brands/xbox.png"),
  amazon: require("../../assets/home/brands/amazon.png"),
  "google play": require("../../assets/home/brands/google-play.png"),
  nike: require("../../assets/home/brands/nike.png"),
  paysafecard: require("../../assets/rates/brands/paysafecard.png"),
  sephora: require("../../assets/rates/brands/sephora.png"),
  one4all: require("../../assets/rates/brands/one4all.png"),
  ebay: require("../../assets/rates/brands/ebay.png"),
  footlocker: require("../../assets/rates/brands/footlocker.png"),
};

export function BrandIcon({ brand, size, borderRadius = size / 2 }: {
  brand: BrandArtwork;
  size: number;
  borderRadius?: number;
}) {
  const [failedKey, setFailedKey] = useState<string | null>(null);
  const logoKey = `${brand.id}:${brand.logo_version || "1"}`;
  const logoFailed = failedKey === logoKey;
  const source = brand.has_logo && !logoFailed
    ? { uri: `${api.base}/brands/${encodeURIComponent(brand.id)}/logo?v=${brand.logo_version || "1"}` }
    : bundledArt[brand.name.trim().toLowerCase()];
  if (!source) return <BrandMonogram name={brand.name} color={brand.color} size={size} />;
  return <Image source={source} style={{ width: size, height: size, borderRadius }} contentFit="contain"
    accessibilityLabel={`${brand.name} logo`} onError={() => setFailedKey(logoKey)} />;
}
