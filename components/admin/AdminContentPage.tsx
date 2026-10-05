/**
 * components/admin/AdminContentPage.tsx — /admin/content.
 *
 * The missing home for `AdminPosts` and `AdminComments`, which were written
 * but never mounted (there was no route for them, so the two components were
 * dead code reachable only by import). One page, two tabs, plus a toolbar that
 * can export whichever list is showing.
 *
 * The rows live inside the child lists, so each reports its loaded rows up via
 * `onRowsChange`; the Export button then serialises exactly what is on screen
 * — not a second, divergent query.
 */
"use client";

import { useCallback, useMemo, useState } from "react";
import { Tabs, TabPanel, toast } from "@/components/ui";
import { SaaSToolbar } from "@/components/console/SaaSToolbar";
import { AdminComments, AdminPosts, type AdminComment, type AdminPost } from "./AdminContent";
import { csvFilename, downloadCsv, toCsv, type CsvColumn } from "@/lib/csv";

const POST_COLUMNS: CsvColumn<AdminPost>[] = [
  { header: "id", value: (p) => p.id },
  { header: "author", value: (p) => p.author.name },
  { header: "username", value: (p) => p.author.username },
  { header: "visibility", value: (p) => p.visibility },
  { header: "status", value: (p) => (p.deleted ? "deleted" : "live") },
  { header: "createdAt", value: (p) => p.createdAt },
  { header: "body", value: (p) => p.body },
];

const COMMENT_COLUMNS: CsvColumn<AdminComment>[] = [
  { header: "id", value: (c) => c.id },
  { header: "postId", value: (c) => c.postId },
  { header: "author", value: (c) => c.author.name },
  { header: "username", value: (c) => c.author.username },
  { header: "status", value: (c) => (c.deleted ? "deleted" : "live") },
  { header: "createdAt", value: (c) => c.createdAt },
  { header: "body", value: (c) => c.body },
];

export function AdminContentPage() {
  const [tab, setTab] = useState("posts");
  const [posts, setPosts] = useState<AdminPost[]>([]);
  const [comments, setComments] = useState<AdminComment[]>([]);

  // Stable setters — the child effect depends on this identity.
  const onPosts = useCallback((rows: AdminPost[]) => setPosts(rows), []);
  const onComments = useCallback((rows: AdminComment[]) => setComments(rows), []);

  const tabs = useMemo(
    () => [
      { id: "posts", label: "Posts", badge: posts.length || undefined },
      { id: "comments", label: "Comments", badge: comments.length || undefined },
    ],
    [posts.length, comments.length],
  );

  function exportCsv() {
    const isPosts = tab === "posts";
    const rows: unknown[] = isPosts ? posts : comments;
    if (rows.length === 0) {
      toast({ variant: "warning", title: "Nothing to export yet" });
      return;
    }
    const csv = isPosts
      ? toCsv(posts, POST_COLUMNS)
      : toCsv(comments, COMMENT_COLUMNS);
    downloadCsv(csvFilename(isPosts ? "admin-posts" : "admin-comments"), csv);
    toast({ variant: "success", title: `Exported ${rows.length} row${rows.length === 1 ? "" : "s"}` });
  }

  return (
    <div className="flex flex-col gap-4">
      <SaaSToolbar
        variant="page"
        label="Content toolbar"
        onExport={exportCsv}
      />

      <Tabs tabs={tabs} value={tab} onValueChange={setTab} label="Content type">
        <TabPanel id="posts">
          <AdminPosts onRowsChange={onPosts} />
        </TabPanel>
        <TabPanel id="comments">
          <AdminComments onRowsChange={onComments} />
        </TabPanel>
      </Tabs>
    </div>
  );
}
