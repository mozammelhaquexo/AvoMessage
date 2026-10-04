/**
 * components/manage/ManageSettings.tsx — /manage/[slug]/settings.
 * Company profile editing, logo upload, and the danger zone (owner only).
 */
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  Avatar,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  ConfirmDialog,
  FormField,
  Input,
  Textarea,
  toast,
} from "@/components/ui";
import { cn } from "@/components/ui/utils";
import { apiDelete, apiPatch, apiUpload } from "@/lib/api-client";
import { isCompanyManagerRole } from "@/lib/company-roles";
import { useManage } from "./ManageShell";

export function ManageSettings() {
  const router = useRouter();
  const { detail, refresh } = useManage();
  const c = detail.company;
  // The company's administrator. "Owner" is retired as a role and a label
  // (request 7); a legacy OWNER row is still an administrator.
  const isManager = isCompanyManagerRole(detail.viewerRole);

  const [name, setName] = useState(c.name);
  const [description, setDescription] = useState(c.description ?? "");
  const [website, setWebsite] = useState(c.website ?? "");
  const [logoUrl, setLogoUrl] = useState(c.logoUrl ?? "");
  const [coverUrl, setCoverUrl] = useState(c.coverUrl ?? "");
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState<"logo" | "cover" | null>(null);
  const [confirmDeactivate, setConfirmDeactivate] = useState(false);
  const [deactivating, setDeactivating] = useState(false);

  async function uploadImage(file: File, kind: "logo" | "cover") {
    setUploading(kind);
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("kind", "company-logo");
      const res = await apiUpload<{ url: string }>("/api/uploads", form);
      if (kind === "logo") setLogoUrl(res.url);
      else setCoverUrl(res.url);
      toast({ variant: "success", title: "Image uploaded — save to apply" });
    } catch (e) {
      toast({ variant: "error", title: e instanceof Error ? e.message : "Upload failed" });
    } finally {
      setUploading(null);
    }
  }

  async function save() {
    setSaving(true);
    try {
      await apiPatch(`/api/companies/${c.id}`, {
        name: name.trim(),
        description: description.trim() ? description.trim() : null,
        website: website.trim() ? website.trim() : null,
        logoUrl: logoUrl ? logoUrl : null,
        coverUrl: coverUrl ? coverUrl : null,
      });
      toast({ variant: "success", title: "Company updated" });
      refresh();
    } catch (e) {
      toast({ variant: "error", title: e instanceof Error ? e.message : "Could not save" });
    } finally {
      setSaving(false);
    }
  }

  async function deactivate() {
    setDeactivating(true);
    try {
      await apiDelete(`/api/companies/${c.id}`);
      toast({ variant: "success", title: "Company deactivated" });
      router.push("/companies");
    } catch (e) {
      toast({ variant: "error", title: e instanceof Error ? e.message : "Could not deactivate" });
    } finally {
      setDeactivating(false);
      setConfirmDeactivate(false);
    }
  }

  return (
    <div className="flex max-w-2xl flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-h3">Company profile</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-4">
            <Avatar src={logoUrl || null} name={name} size="xl" fallbackIcon="building" />
            <label className="cursor-pointer">
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp"
                className="sr-only"
                aria-label="Upload company logo"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void uploadImage(f, "logo");
                  e.target.value = "";
                }}
              />
              <span className={cn("inline-flex h-9 items-center rounded-md border border-line-strong px-4 text-body-sm font-medium text-ink hover:bg-surface-2", uploading === "logo" && "opacity-50")}>
                {uploading === "logo" ? "Uploading…" : "Change logo"}
              </span>
            </label>
            <label className="cursor-pointer">
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp"
                className="sr-only"
                aria-label="Upload cover image"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void uploadImage(f, "cover");
                  e.target.value = "";
                }}
              />
              <span className={cn("inline-flex h-9 items-center rounded-md border border-line-strong px-4 text-body-sm font-medium text-ink hover:bg-surface-2", uploading === "cover" && "opacity-50")}>
                {uploading === "cover" ? "Uploading…" : "Change cover"}
              </span>
            </label>
          </div>
          <FormField label="Name" required>
            {(fp) => <Input {...fp} value={name} onChange={(e) => setName(e.target.value)} maxLength={80} />}
          </FormField>
          <FormField label="Description">
            {(fp) => <Textarea {...fp} value={description} onChange={(e) => setDescription(e.target.value)} rows={3} maxLength={1000} />}
          </FormField>
          <FormField label="Website">
            {(fp) => <Input {...fp} type="url" value={website} onChange={(e) => setWebsite(e.target.value)} maxLength={200} />}
          </FormField>
          <FormField label="Slug" hint="Slugs can't be changed after creation.">
            {(fp) => <Input {...fp} value={c.slug} disabled />}
          </FormField>
          <div className="flex justify-end">
            <Button onClick={() => void save()} loading={saving} disabled={!name.trim()}>
              Save changes
            </Button>
          </div>
        </CardContent>
      </Card>

      {isManager && (
        <Card className="border-danger/30">
          <CardHeader>
            <CardTitle className="text-h3 text-danger-strong">Danger zone</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap items-center justify-between gap-3">
            <p className="max-w-md text-body-sm text-ink-2">
              Deactivate this company. Members will lose access immediately. This can only be undone by a platform administrator.
            </p>
            <Button variant="danger" size="sm" onClick={() => setConfirmDeactivate(true)}>
              Deactivate company
            </Button>
          </CardContent>
        </Card>
      )}

      <ConfirmDialog
        open={confirmDeactivate}
        onOpenChange={setConfirmDeactivate}
        title="Deactivate company?"
        description={`${c.name} will be deactivated and all members will lose access.`}
        confirmLabel="Deactivate"
        tone="danger"
        icon="alert"
        confirming={deactivating}
        onConfirm={() => void deactivate()}
      />
    </div>
  );
}
