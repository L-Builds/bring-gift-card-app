export type Ticket = {
  id: string; ref: string; subject: string; category: string; category_label: string; status: string;
  ref_type: string; ref_id: string; ref_label: string; customer_name: string; customer_email: string;
  unread_for_customer: number; unread_for_admin: number; last_message_preview: string; last_sender: string;
  last_message_at: string; created_at: string;
};

export type TicketMessage = { id: string; sender: "customer" | "admin"; sender_name: string; body: string; image_paths: string[]; created_at: string };

export function ticketStatusLabel(s: string): string {
  return ({ OPEN: "Open", AWAITING_CUSTOMER: "Replied", RESOLVED: "Resolved", CLOSED: "Closed" } as Record<string, string>)[s] ?? s;
}
