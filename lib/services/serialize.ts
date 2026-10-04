/**
 * lib/services/serialize.ts — public JSON shapes for Backend Engineer B's
 * domains (companies, teams, invitations, conversations, messages, calls,
 * admin). Keeps passwords/hashes/tokens out of every response.
 *
 * NOTE: these shapes mirror ARCHITECTURE.md §7. The posts/feed domain (Agent C)
 * owns the canonical post serializer; the summary here is intentionally small
 * and only used for company feeds / announcements / admin lists.
 */
import type {
  Attachment,
  Call,
  CallParticipant,
  Company,
  CompanyMember,
  Conversation,
  ConversationMember,
  Invitation,
  Message,
  MessageReaction,
  Team,
  TeamMember,
  User,
  VoiceMessage,
} from "@/lib/prisma-types";

export interface PublicUser {
  id: string;
  name: string;
  username: string;
  avatarUrl: string | null;
  bio: string | null;
  isVerified: boolean;
  createdAt: string;
}

export function publicUser(u: User): PublicUser {
  return {
    id: u.id,
    name: u.name,
    username: u.username,
    avatarUrl: u.avatarUrl,
    bio: u.bio,
    isVerified: u.isVerified,
    createdAt: u.createdAt.toISOString(),
  };
}

export interface PublicCompany {
  id: string;
  name: string;
  slug: string;
  logoUrl: string | null;
  coverUrl: string | null;
  brandColor: string | null;
  description: string | null;
  website: string | null;
  isActive: boolean;
  createdAt: string;
}

export function publicCompany(c: Company): PublicCompany {
  return {
    id: c.id,
    name: c.name,
    slug: c.slug,
    logoUrl: c.logoUrl,
    coverUrl: c.coverUrl,
    brandColor: c.brandColor,
    description: c.description,
    website: c.website,
    isActive: c.isActive,
    createdAt: c.createdAt.toISOString(),
  };
}

export interface CompanyMemberView {
  user: PublicUser;
  role: CompanyMember["role"];
  joinedAt: string;
}

export function companyMemberView(m: CompanyMember & { user: User }): CompanyMemberView {
  return { user: publicUser(m.user), role: m.role, joinedAt: m.joinedAt.toISOString() };
}

export interface PublicTeam {
  id: string;
  companyId: string;
  name: string;
  description: string | null;
  memberCount: number;
  createdAt: string;
}

export function publicTeam(
  t: Team & { members?: TeamMember[]; _count?: { members: number } }
): PublicTeam {
  const memberCount = t._count?.members ?? t.members?.length ?? 0;
  return {
    id: t.id,
    companyId: t.companyId,
    name: t.name,
    description: t.description,
    memberCount,
    createdAt: t.createdAt.toISOString(),
  };
}

export interface TeamMemberView {
  user: PublicUser;
  role: TeamMember["role"];
  joinedAt: string;
}

export function teamMemberView(m: TeamMember & { user: User }): TeamMemberView {
  return { user: publicUser(m.user), role: m.role, joinedAt: m.joinedAt.toISOString() };
}

export interface InvitationView {
  id: string;
  email: string;
  role: Invitation["role"];
  status: Invitation["status"];
  expiresAt: string;
  createdAt: string;
  company: PublicCompany;
  team: { id: string; name: string } | null;
  invitedBy: PublicUser;
}

export function invitationView(
  i: Invitation & { company: Company; team: Team | null; invitedBy: User }
): InvitationView {
  return {
    id: i.id,
    email: i.email,
    role: i.role,
    status: i.status,
    expiresAt: i.expiresAt.toISOString(),
    createdAt: i.createdAt.toISOString(),
    company: publicCompany(i.company),
    team: i.team ? { id: i.team.id, name: i.team.name } : null,
    invitedBy: publicUser(i.invitedBy),
  };
}

export interface ReactionView {
  emoji: string;
  count: number;
  reacted: boolean;
}

export function reactionViews(
  reactions: (MessageReaction & { userId: string })[],
  viewerId: string | null
): ReactionView[] {
  const byEmoji = new Map<string, { count: number; reacted: boolean }>();
  for (const r of reactions) {
    const cur = byEmoji.get(r.emoji) ?? { count: 0, reacted: false };
    cur.count += 1;
    if (viewerId && r.userId === viewerId) cur.reacted = true;
    byEmoji.set(r.emoji, cur);
  }
  return [...byEmoji.entries()].map(([emoji, v]) => ({ emoji, ...v }));
}

/**
 * A quoted parent or forward source. Deliberately smaller than MessageView:
 * the bubble only renders a one-line sender + body, and a quote is never
 * recursive, so this cannot nest.
 */
export interface MessageQuoteView {
  id: string;
  sender: PublicUser | null;
  body: string | null;
  /** True when the source was soft-deleted — the UI shows "Message deleted". */
  deleted: boolean;
}

export interface MessageView {
  id: string;
  conversationId: string;
  sender: PublicUser | null;
  body: string | null;
  type: Message["type"];
  editedAt: string | null;
  createdAt: string;
  attachments: Attachment[];
  reactions: ReactionView[];
  voice: VoiceMessage | null;
  /** Quoted parent — persisted via `Message.replyToId`. */
  replyTo: MessageQuoteView | null;
  /** Original message when this one is a forward — persisted via `forwardedFromId`. */
  forwardedFrom: MessageQuoteView | null;
  deleted: boolean;
}

function quoteView(
  source: (Message & { sender: User | null }) | null | undefined,
): MessageQuoteView | null {
  if (!source) return null;
  return {
    id: source.id,
    sender: source.sender ? publicUser(source.sender) : null,
    // A deleted parent's body must not leak — the tombstone replaces it.
    body: source.deletedAt ? null : source.body,
    deleted: Boolean(source.deletedAt),
  };
}

export function messageTombstone(id: string, createdAt: Date): MessageView {
  return {
    id,
    conversationId: "",
    sender: null,
    body: null,
    type: "TEXT",
    editedAt: null,
    createdAt: createdAt.toISOString(),
    attachments: [],
    reactions: [],
    voice: null,
    replyTo: null,
    forwardedFrom: null,
    deleted: true,
  };
}

export function messageView(
  m: Message & {
    sender: User | null;
    attachments: Attachment[];
    reactions: MessageReaction[];
    voice: VoiceMessage | null;
    // Optional: callers that only need a preview (the conversation list's
    // `lastMessage`) can skip the joins and get `null` quotes.
    replyTo?: (Message & { sender: User | null }) | null;
    forwardedFrom?: (Message & { sender: User | null }) | null;
  },
  viewerId: string | null,
): MessageView {
  if (m.deletedAt) return messageTombstone(m.id, m.createdAt);
  return {
    id: m.id,
    conversationId: m.conversationId,
    sender: m.sender ? publicUser(m.sender) : null,
    body: m.body,
    type: m.type,
    editedAt: m.editedAt ? m.editedAt.toISOString() : null,
    createdAt: m.createdAt.toISOString(),
    attachments: m.attachments,
    reactions: reactionViews(m.reactions, viewerId),
    voice: m.voice,
    replyTo: quoteView(m.replyTo),
    forwardedFrom: quoteView(m.forwardedFrom),
    deleted: false,
  };
}

export interface ConversationMemberView {
  user: PublicUser;
  role: ConversationMember["role"];
  isMuted: boolean;
  lastReadAt: string;
  joinedAt: string;
}

export function conversationMemberView(
  m: ConversationMember & { user: User }
): ConversationMemberView {
  return {
    user: publicUser(m.user),
    role: m.role,
    isMuted: m.isMuted,
    lastReadAt: m.lastReadAt.toISOString(),
    joinedAt: m.joinedAt.toISOString(),
  };
}

export interface ConversationView {
  id: string;
  type: Conversation["type"];
  title: string | null;
  avatarUrl: string | null;
  companyId: string | null;
  members: ConversationMemberView[];
  lastMessage: MessageView | null;
  unreadCount: number;
  lastMessageAt: string;
}

export interface CallParticipantView {
  user: PublicUser;
  joinedAt: string;
  leftAt: string | null;
}

export interface CallView {
  id: string;
  conversationId: string | null;
  type: Call["type"];
  status: Call["status"];
  initiator: PublicUser;
  participants: CallParticipantView[];
  startedAt: string;
  endedAt: string | null;
}

export function callView(
  c: Call & { initiator: User; participants: (CallParticipant & { user: User })[] }
): CallView {
  return {
    id: c.id,
    conversationId: c.conversationId,
    type: c.type,
    status: c.status,
    initiator: publicUser(c.initiator),
    participants: c.participants.map((p) => ({
      user: publicUser(p.user),
      joinedAt: p.joinedAt.toISOString(),
      leftAt: p.leftAt ? p.leftAt.toISOString() : null,
    })),
    startedAt: c.startedAt.toISOString(),
    endedAt: c.endedAt ? c.endedAt.toISOString() : null,
  };
}

/** Minimal post summary for company feeds / announcements / admin lists. */
export interface PostSummary {
  id: string;
  author: PublicUser;
  body: string;
  visibility: string;
  companyId: string | null;
  likeCount: number;
  commentCount: number;
  createdAt: string;
  viewerState: { liked: boolean; bookmarked: boolean };
}

export function postSummary(
  p: {
    id: string;
    author: User;
    body: string;
    visibility: string;
    companyId: string | null;
    likeCount: number;
    commentCount: number;
    createdAt: Date;
  },
  viewerState?: { liked: boolean; bookmarked: boolean }
): PostSummary {
  return {
    id: p.id,
    author: publicUser(p.author),
    body: p.body,
    visibility: p.visibility,
    companyId: p.companyId,
    likeCount: p.likeCount,
    commentCount: p.commentCount,
    createdAt: p.createdAt.toISOString(),
    viewerState: viewerState ?? { liked: false, bookmarked: false },
  };
}
