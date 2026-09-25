import { Platform } from "react-native";
import { storage } from "@/src/utils/storage";

const BACKEND_URL = process.env.EXPO_PUBLIC_BACKEND_URL?.trim().replace(/\/$/, "");
if (!BACKEND_URL) throw new Error("EXPO_PUBLIC_BACKEND_URL is not configured");
const BASE = `${BACKEND_URL}/api`;
export const TOKEN_KEY = "bgc_auth_token";

let memToken: string | null = null;

export async function getToken(): Promise<string | null> {
  if (memToken) return memToken;
  memToken = await storage.secureGet<string>(TOKEN_KEY, "");
  return memToken || null;
}

export async function setToken(token: string): Promise<void> {
  memToken = token;
  await storage.secureSet(TOKEN_KEY, token);
}

export async function clearToken(): Promise<void> {
  memToken = null;
  await storage.secureRemove(TOKEN_KEY);
}

export class ApiError extends Error {
  status: number;
  code: string;
  constructor(message: string, status: number, code = "") {
    super(message);
    this.status = status;
    this.code = code;
  }
}

async function request<T>(path: string, init: RequestInit = {}, auth = true): Promise<T> {
  const headers = new Headers(init.headers as any);
  if (!headers.has("Content-Type") && init.body) headers.set("Content-Type", "application/json");
  if (auth) {
    const token = await getToken();
    if (token) headers.set("Authorization", `Bearer ${token}`);
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 35000);
  let res: Response;
  try { res = await fetch(`${BASE}${path}`, { ...init, headers, signal: controller.signal }); } finally { clearTimeout(timeout); }
  const text = await res.text();
  let data: any = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (!res.ok) {
    const detail = data && (data.detail ?? data.message);
    if (detail && typeof detail === "object" && !Array.isArray(detail)) {
      throw new ApiError(detail.message || "Request failed", res.status, detail.code || "");
    }
    const msg = detail || "Something went wrong";
    throw new ApiError(typeof msg === "string" ? msg : "Request failed", res.status);
  }
  return data as T;
}

export const api = {
  get: <T>(path: string, auth = true) => request<T>(path, { method: "GET" }, auth),
  post: <T>(path: string, body?: any, auth = true, headers?: Record<string, string>) =>
    request<T>(path, { method: "POST", body: body ? JSON.stringify(body) : undefined, headers }, auth),
  patch: <T>(path: string, body?: any) =>
    request<T>(path, { method: "PATCH", body: body ? JSON.stringify(body) : undefined }),
  del: <T>(path: string) => request<T>(path, { method: "DELETE" }),
  base: BASE,
};

// Upload a local image uri as multipart. Handles web vs native body shapes.
export async function uploadImage(uri: string): Promise<string> {
  const token = await getToken();
  const name = `card_${Date.now()}.jpg`;
  const form = new FormData();
  if (Platform.OS === "web") {
    const blob = await (await fetch(uri)).blob();
    form.append("file", blob, name);
  } else {
    form.append("file", { uri, name, type: "image/jpeg" } as any);
  }
  const res = await fetch(`${BASE}/uploads`, {
    method: "POST",
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body: form,
  });
  if (!res.ok) throw new ApiError("Upload failed", res.status);
  const data = await res.json();
  return data.path as string;
}

// Private image requests use Authorization headers, never JWTs in URLs.
export function fileUrl(path: string, token: string | null): string {
  return `${BASE}/files/${path}`;
}
