import type { Metadata } from "next";
import { MessagesView } from "@/components/chat/MessagesView";

export const metadata: Metadata = { title: "Messages" };

export default function MessagesPage() {
  return <MessagesView />;
}
