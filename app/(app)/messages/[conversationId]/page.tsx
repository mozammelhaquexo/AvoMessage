import type { Metadata } from "next";
import { MessagesView } from "@/components/chat/MessagesView";
import { ChatWindow } from "@/components/chat/ChatWindow";

export const metadata: Metadata = { title: "Conversation" };

// Next.js 16: params is a Promise.
export default async function ConversationPage({
  params,
}: {
  params: Promise<{ conversationId: string }>;
}) {
  const { conversationId } = await params;
  return (
    <MessagesView>
      <ChatWindow conversationId={conversationId} />
    </MessagesView>
  );
}
