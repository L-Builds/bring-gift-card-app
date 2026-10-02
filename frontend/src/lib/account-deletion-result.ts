// Set only after the API confirms closure. It is deliberately not persisted:
// opening or refreshing the public URL cannot display a false success message.
const DISPLAY_WINDOW_MS = 5 * 60 * 1000;
let completedAt = 0;

export function markAccountDeletionCompleted() {
  completedAt = Date.now();
}

export function takeAccountDeletionCompleted() {
  const age = Date.now() - completedAt;
  const confirmed = completedAt > 0 && age >= 0 && age <= DISPLAY_WINDOW_MS;
  completedAt = 0;
  return confirmed;
}
