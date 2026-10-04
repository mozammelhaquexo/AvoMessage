/**
 * components/companies/tabs/CompanyTeamsTab.tsx — company workspace Teams tab.
 *
 * Extracted from CompanyWorkspace.tsx (code-review split; no behavior change).
 */
"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { apiGet, apiPost } from "@/lib/api-client";
import {
  Button,
  Card,
  CardContent,
  Dialog,
  EmptyState,
  FormField,
  Icon,
  Input,
  LoadingState,
  Textarea,
  toast,
} from "@/components/ui";
import type { PublicTeam } from "@/lib/types";

export function CompanyTeamsTab({
  companyId,
  slug,
  isManager,
}: {
  companyId: string;
  slug: string;
  isManager: boolean;
}) {
  const [teams, setTeams] = useState<PublicTeam[]>([]);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setTeams(await apiGet<PublicTeam[]>(`/api/teams`, { params: { companyId } }));
    } catch {
      setTeams([]);
    } finally {
      setLoading(false);
    }
  }, [companyId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function createTeam() {
    if (!name.trim()) return;
    setSaving(true);
    try {
      await apiPost(`/api/companies/${companyId}/teams`, {
        name: name.trim(),
        ...(description.trim() ? { description: description.trim() } : {}),
      });
      setName("");
      setDescription("");
      setCreateOpen(false);
      toast({ variant: "success", title: "Team created" });
      void load();
    } catch (e) {
      toast({ variant: "error", title: e instanceof Error ? e.message : "Could not create team" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="py-4">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-h3 font-semibold text-ink">Teams</h2>
        {isManager && (
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            <Icon name="plus" size={15} aria-hidden className="mr-1" />
            New team
          </Button>
        )}
      </div>
      {loading ? (
        <LoadingState message="Loading teams…" />
      ) : teams.length === 0 ? (
        <EmptyState icon="users" title="No teams yet" description={isManager ? "Create a team to organize members." : "Teams will appear here once created."} compact />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {teams.map((t) => (
            <Link key={t.id} href={`/company/${slug}/teams/${t.id}`}>
              <Card className="h-full transition-shadow hover:shadow-md">
                <CardContent className="p-4">
                  <p className="text-body-sm font-semibold text-ink">{t.name}</p>
                  {t.description && <p className="mt-1 line-clamp-2 text-body-sm text-ink-2">{t.description}</p>}
                  <p className="mt-2 text-caption text-ink-3">
                    {t.memberCount} member{t.memberCount === 1 ? "" : "s"}
                  </p>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}

      <Dialog open={createOpen} onOpenChange={setCreateOpen} title="Create a team" size="sm">
        <div className="flex flex-col gap-3">
          <FormField label="Team name" required>
            {(fp) => <Input {...fp} value={name} onChange={(e) => setName(e.target.value)} maxLength={80} placeholder="Engineering" />}
          </FormField>
          <FormField label="Description">
            {(fp) => <Textarea {...fp} value={description} onChange={(e) => setDescription(e.target.value)} rows={2} maxLength={500} />}
          </FormField>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setCreateOpen(false)}>
              Cancel
            </Button>
            <Button onClick={() => void createTeam()} loading={saving} disabled={!name.trim()}>
              Create
            </Button>
          </div>
        </div>
      </Dialog>
    </div>
  );
}
