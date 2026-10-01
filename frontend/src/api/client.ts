import { Platform } from "react-native";
import { storage } from "@/src/utils/storage";
import { apiBaseUrl } from "@/config/public-env";
import { queryClient } from "@/src/query-client";
import { isAdminQueryKey, isPublicQueryAffectedByAdminWrite } from "@/src/lib/admin-query-keys";

// Expo replaces this public value at build time. Production web uses the
// same-origin Vercel /api proxy; native and local Expo dev use an explicit URL.
const BASE = apiBaseUrl(process.env.EXPO_PUBLIC_BACKEND_URL, { web: Platform.OS === "web", dev: __DEV__ });
export const TOKEN_KEY = "bgc_auth_token";

let memToken: string | null = null;
let sessionInvalidatedHandler: (() => void | Promise<void>) | null = null;

export function onSessionInvalidated(handler: () => void | Promise<void>): () => void {
  sessionInvalidatedHandler = handler;
  return () => { if (sessionInvalidatedHandler === handler) sessionInvalidatedHandler = null; };
}

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
  let sentToken: string | null = null;
  if (auth) {
    sentToken = await getToken();
    if (sentToken) headers.set("Authorization", `Bearer ${sentToken}`);
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
    if (auth && path !== "/auth/me" && sentToken && res.status === 401 &&
        (detail === "Invalid or expired session" || detail === "Not authenticated") &&
        await getToken() === sentToken) {
      void Promise.resolve(sessionInvalidatedHandler?.()).catch(() => {});
    }
    if (detail && typeof detail === "object" && !Array.isArray(detail)) {
      throw new ApiError(detail.message || "Request failed", res.status, detail.code || "");
    }
    const msg = detail || "Something went wrong";
    throw new ApiError(typeof msg === "string" ? msg : "Request failed", res.status);
  }
  if (path.startsWith("/admin/") && !["GET", "HEAD"].includes((init.method || "GET").toUpperCase())) {
    void queryClient.invalidateQueries({
      predicate: query => isAdminQueryKey(query.queryKey) || isPublicQueryAffectedByAdminWrite(path, query.queryKey),
      refetchType: "active",
    }).catch(() => {});
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
  const chunkSize = 3 * 1024 * 1024;
  let size: number;
  let webBlob: Blob | undefined;
  let nativeFile: import("expo-file-system").File | undefined;
  if (Platform.OS === "web") {
    webBlob = await (await fetch(uri)).blob();
    size = webBlob.size;
    form.append("file", webBlob, name);
  } else {
    const { File } = await import("expo-file-system");
    nativeFile = new File(uri);
    size = nativeFile.size;
    form.append("file", { uri, name, type: "image/jpeg" } as any);
  }
  if (size > 12 * 1024 * 1024) throw new ApiError("Image too large (max 12MB)", 413);
  if (size > chunkSize) {
    const session = await api.post<{ id: string; chunk_size: number }>("/uploads/chunks", { size });
    const bytes = nativeFile ? await nativeFile.bytes() : undefined;
    for (let offset = 0, part = 0; offset < size; offset += chunkSize, part++) {
      const body = webBlob ? await webBlob.slice(offset, offset + chunkSize).arrayBuffer()
        : bytes!.slice(offset, offset + chunkSize).buffer as ArrayBuffer;
      const result = await fetch(`${BASE}/uploads/chunks/${session.id}/${part}`, {
        method: "PUT", headers: { "Content-Type": "application/octet-stream", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body,
      });
      if (!result.ok) throw new ApiError("Upload failed", result.status);
    }
    return (await api.post<{ path: string }>(`/uploads/chunks/${session.id}/complete`)).path;
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

// Brand logos use the bounded chunk transport so PNG transparency reaches the
// server intact. Evidence uploads keep their existing JPEG normalization.
export async function uploadBrandLogo(uri: string, brandId: string): Promise<void> {
  const token = await getToken();
  const chunkSize = 3 * 1024 * 1024;
  let size: number;
  let webBlob: Blob | undefined;
  let nativeBytes: Uint8Array | undefined;
  if (Platform.OS === "web") {
    webBlob = await (await fetch(uri)).blob();
    size = webBlob.size;
  } else {
    const { File } = await import("expo-file-system");
    nativeBytes = await new File(uri).bytes();
    size = nativeBytes.byteLength;
  }
  if (!size || size > 12 * 1024 * 1024) throw new ApiError("Logo must be under 12MB", 413);
  const session = await api.post<{ id: string }>("/uploads/chunks", {
    size, purpose: "brand_logo", brand_id: brandId,
  });
  for (let offset = 0, part = 0; offset < size; offset += chunkSize, part++) {
    const body = webBlob ? await webBlob.slice(offset, offset + chunkSize).arrayBuffer()
      : nativeBytes!.slice(offset, offset + chunkSize).buffer as ArrayBuffer;
    const response = await fetch(`${BASE}/uploads/chunks/${session.id}/${part}`, {
      method: "PUT",
      headers: { "Content-Type": "application/octet-stream", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body,
    });
    if (!response.ok) throw new ApiError("Logo upload failed", response.status);
  }
  await api.post(`/uploads/chunks/${session.id}/complete`);
}

// Private image requests use Authorization headers, never JWTs in URLs.
export function fileUrl(path: string, token: string | null): string {
  return `${BASE}/files/${path}`;
}

// Preserve private Authorization headers while keeping every response below the
// Vercel gateway payload limit. No bearer credentials are ever put in a URL.
export async function privateImageBlob(uri: string, headers: Record<string, string> = {}, signal?: AbortSignal): Promise<Blob> {
  const parts: Blob[] = [];
  const chunkSize = 3 * 1024 * 1024;
  let offset = 0;
  let contentType = "image/jpeg";
  while (true) {
    const response = await fetch(uri, { headers: { ...headers, Range: `bytes=${offset}-${offset + chunkSize - 1}` }, signal, cache: "no-store" });
    if (!response.ok) throw new ApiError("Could not load private image", response.status);
    contentType = response.headers.get("content-type") || contentType;
    const chunk = await response.blob();
    parts.push(chunk);
    if (response.status === 200) break; // Existing hosts may return the full image.
    const range = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(response.headers.get("content-range") || "");
    if (!range || Number(range[1]) !== offset || chunk.size !== Number(range[2]) - offset + 1) throw new ApiError("Invalid image response", 502);
    offset = Number(range[2]) + 1;
    if (offset >= Number(range[3])) break;
  }
  return new Blob(parts, { type: contentType });
}
