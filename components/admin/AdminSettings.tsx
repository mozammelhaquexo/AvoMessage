/**
 * components/admin/AdminSettings.tsx — /admin/settings.
 * System settings key/value editor (audited server-side).
 */
"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Button,
  Card,
  CardContent,
  Dialog,
  EmptyState,
  FormField,
  Icon,
  Input,
  ErrorState,
  LoadingState,
  Textarea,
  toast,
} from "@/components/ui";
import { apiGet, apiPatch } from "@/lib/api-client";

interface Setting {
  key: string;
  value: unknown;
}

function pretty(value: unknown): string {
  return typeof value === "string" ? value : JSON.stringify(value, null, 2);
}

export function AdminSettings() {
  const [settings, setSettings] = useState<Setting[]>([]);
  const [loading, setLoading] = useState(true);
  // Load failure is a rendered state, not just a toast: a failed fetch used to
  // leave "No settings yet" on screen, which reads as an empty configuration.
  const [loadError, setLoadError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Setting | null>(null);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [newKey, setNewKey] = useState("");
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      setSettings(await apiGet<Setting[]>("/api/admin/settings"));
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "Could not load settings");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function save(key: string, raw: string) {
    setSaving(true);
    try {
      let value: unknown = raw;
      try {
        value = JSON.parse(raw);
      } catch {
        // Keep as a plain string.
      }
      await apiPatch("/api/admin/settings", { key, value });
      toast({ variant: "success", title: `Setting "${key}" saved` });
      setEditing(null);
      setCreating(false);
      setNewKey("");
      void load();
    } catch (e) {
      toast({ variant: "error", title: e instanceof Error ? e.message : "Could not save setting" });
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <LoadingState message="Loading settings…" />;
  if (loadError && settings.length === 0) {
    return (
      <ErrorState
        title="Couldn't load settings"
        message={loadError}
        onRetry={() => void load()}
      />
    );
  }

  return (
    <div className="flex max-w-3xl flex-col gap-4">
      <div className="flex items-center justify-between">
        <h2 className="text-h3 font-semibold text-ink">System settings ({settings.length})</h2>
        <Button size="sm" onClick={() => { setCreating(true); setNewKey(""); setDraft(""); }}>
          <Icon name="plus" size={15} aria-hidden className="mr-1.5" />
          New setting
        </Button>
      </div>

      {settings.length === 0 && !creating ? (
        <EmptyState icon="settings" title="No settings yet" description="Add the first system setting." compact />
      ) : (
        <div className="flex flex-col gap-2">
          {settings.map((s) => (
            <Card key={s.key}>
              <CardContent className="flex items-center gap-3 p-4">
                <div className="min-w-0 flex-1">
                  <code className="font-mono text-body-sm font-semibold text-ink">{s.key}</code>
                  <pre className="mt-1 max-h-20 overflow-auto whitespace-pre-wrap break-all rounded bg-surface-2 p-2 font-mono text-caption text-ink-2">
                    {pretty(s.value)}
                  </pre>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setEditing(s);
                    setDraft(pretty(s.value));
                  }}
                >
                  <Icon name="edit" size={14} aria-hidden className="mr-1.5" />
                  Edit
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Edit dialog */}
      <Dialog open={editing !== null} onOpenChange={(o) => !o && setEditing(null)} title={`Edit "${editing?.key}"`} size="md">
        <div className="flex flex-col gap-3">
          <FormField label="Value" hint="Valid JSON is stored as JSON; anything else is stored as a string.">
            {(fp) => <Textarea {...fp} value={draft} onChange={(e) => setDraft(e.target.value)} rows={6} className="font-mono" />}
          </FormField>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setEditing(null)}>
              Cancel
            </Button>
            <Button onClick={() => editing && void save(editing.key, draft)} loading={saving}>
              Save
            </Button>
          </div>
        </div>
      </Dialog>

      {/* Create dialog */}
      <Dialog open={creating} onOpenChange={setCreating} title="New setting" size="md">
        <div className="flex flex-col gap-3">
          <FormField label="Key" required hint="Lowercase letters, digits, dots, dashes, underscores.">
            {(fp) => <Input {...fp} value={newKey} onChange={(e) => setNewKey(e.target.value)} placeholder="feature.new_home" pattern="[a-z0-9._-]+" />}
          </FormField>
          <FormField label="Value" hint="Valid JSON is stored as JSON; anything else is stored as a string.">
            {(fp) => <Textarea {...fp} value={draft} onChange={(e) => setDraft(e.target.value)} rows={4} className="font-mono" placeholder="true" />}
          </FormField>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setCreating(false)}>
              Cancel
            </Button>
            <Button onClick={() => newKey.trim() && void save(newKey.trim(), draft)} loading={saving} disabled={!newKey.trim()}>
              Create
            </Button>
          </div>
        </div>
      </Dialog>
    </div>
  );
}
