/**
 * components/manage/ManageBranding.tsx — company branding studio.
 *
 * Logo + cover upload, brand color, and name with a live preview of how the
 * company page looks. Saves via PATCH /api/companies/[id].
 */
"use client";

import { useRef, useState } from "react";
import { Avatar, Button, Card, Icon, Input, Textarea } from "@/components/ui";
import { apiPatch, apiUpload } from "@/lib/api-client";
import { toast } from "@/components/ui/toast";
import { readableInkOn } from "@/lib/color";
import { useManage } from "./ManageShell";

const SWATCHES = [
  "#84cc16", // lime
  "#22c55e", // green
  "#14b8a6", // teal
  "#0ea5e9", // sky
  "#6366f1", // indigo
  "#a855f7", // violet
  "#ec4899", // pink
  "#f43f5e", // rose
  "#f59e0b", // amber
  "#f97316", // orange
];

export function ManageBranding() {
  const { detail, refresh } = useManage();
  const c = detail.company;

  const [name, setName] = useState(c.name);
  const [description, setDescription] = useState(c.description ?? "");
  const [logoUrl, setLogoUrl] = useState(c.logoUrl ?? "");
  const [coverUrl, setCoverUrl] = useState(c.coverUrl ?? "");
  const [brandColor, setBrandColor] = useState(c.brandColor ?? "#84cc16");
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState<"logo" | "cover" | null>(null);
  const logoRef = useRef<HTMLInputElement>(null);
  const coverRef = useRef<HTMLInputElement>(null);

  const dirty =
    name.trim() !== c.name ||
    (description.trim() || "") !== (c.description ?? "") ||
    (logoUrl || "") !== (c.logoUrl ?? "") ||
    (coverUrl || "") !== (c.coverUrl ?? "") ||
    brandColor !== (c.brandColor ?? "#84cc16");

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
    if (!name.trim()) {
      toast({ variant: "error", title: "Company name is required" });
      return;
    }
    setSaving(true);
    try {
      await apiPatch(`/api/companies/${c.id}`, {
        name: name.trim(),
        description: description.trim() ? description.trim() : null,
        logoUrl: logoUrl ? logoUrl : null,
        coverUrl: coverUrl ? coverUrl : null,
        brandColor,
      });
      toast({ variant: "success", title: "Branding saved" });
      refresh();
    } catch (e) {
      toast({ variant: "error", title: e instanceof Error ? e.message : "Could not save" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Branding</h1>
        <p className="text-sm text-ink-2 mt-1">
          Shape how {c.name} looks across AvoMessage.
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Live preview */}
        <Card className="overflow-hidden">
          <div className="px-4 pt-4 text-xs font-semibold uppercase tracking-wider text-ink-3">
            Live preview
          </div>
          <div className="p-4">
            <div className="overflow-hidden rounded-xl border border-line">
              <div
                className="h-32 bg-surface-2 bg-cover bg-center"
                style={coverUrl ? { backgroundImage: `url(${coverUrl})` } : { background: `linear-gradient(135deg, ${brandColor}33, ${brandColor}11)` }}
              />
              <div className="p-4">
                <div className="-mt-10 mb-3">
                  <div
                    className="inline-block rounded-2xl p-1 bg-canvas"
                    style={{ boxShadow: `0 0 0 3px ${brandColor}` }}
                  >
                    <Avatar src={logoUrl || null} name={name} size="xl" fallbackIcon="building" />
                  </div>
                </div>
                <h3 className="text-lg font-bold">{name || "Company name"}</h3>
                {description ? (
                  <p className="mt-1 text-sm text-ink-2 line-clamp-2">{description}</p>
                ) : (
                  <p className="mt-1 text-sm italic text-ink-3/70">A short tagline…</p>
                )}
                <div className="mt-3 flex gap-2">
                  <span
                    className="rounded-full px-3 py-1 text-xs font-semibold"
                    style={{
                      backgroundColor: brandColor,
                      // The preview must stay legible for ANY brand colour the
                      // company picks, so choose the ink by contrast instead of
                      // hardcoding white.
                      color: readableInkOn(brandColor),
                    }}
                  >
                    Follow
                  </span>
                  <span className="rounded-full border border-line px-3 py-1 text-xs font-medium">
                    Message
                  </span>
                </div>
              </div>
            </div>
          </div>
        </Card>

        {/* Controls */}
        <div className="space-y-4">
          <Card className="p-4 space-y-4">
            <h2 className="font-semibold">Identity</h2>
            <div>
              <label className="text-sm font-medium" htmlFor="brand-name">Company name</label>
              <Input id="brand-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} className="mt-1.5" />
            </div>
            <div>
              <label className="text-sm font-medium" htmlFor="brand-desc">Tagline</label>
              <Textarea id="brand-desc" value={description} onChange={(e) => setDescription(e.target.value)} rows={2} maxLength={1000} placeholder="What does your company do?" className="mt-1.5" />
            </div>
          </Card>

          <Card className="p-4 space-y-4">
            <h2 className="font-semibold">Logo & cover</h2>
            <div className="flex items-center gap-4">
              <Avatar src={logoUrl || null} name={name} size="lg" fallbackIcon="building" />
              <div className="flex gap-2">
                <input ref={logoRef} type="file" accept="image/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) void uploadImage(f, "logo"); e.target.value = ""; }} />
                <Button size="sm" variant="outline" onClick={() => logoRef.current?.click()} loading={uploading === "logo"}>
                  <Icon name="upload" size={14} /> Upload logo
                </Button>
                {logoUrl && <Button size="sm" variant="ghost" onClick={() => setLogoUrl("")}>Remove</Button>}
              </div>
            </div>
            <div className="flex items-center gap-4">
              <div className="h-14 w-28 shrink-0 overflow-hidden rounded-lg bg-surface-2 bg-cover bg-center" style={coverUrl ? { backgroundImage: `url(${coverUrl})` } : undefined} />
              <div className="flex gap-2">
                <input ref={coverRef} type="file" accept="image/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) void uploadImage(f, "cover"); e.target.value = ""; }} />
                <Button size="sm" variant="outline" onClick={() => coverRef.current?.click()} loading={uploading === "cover"}>
                  <Icon name="upload" size={14} /> Upload cover
                </Button>
                {coverUrl && <Button size="sm" variant="ghost" onClick={() => setCoverUrl("")}>Remove</Button>}
              </div>
            </div>
          </Card>

          <Card className="p-4 space-y-4">
            <h2 className="font-semibold">Brand color</h2>
            <div className="flex flex-wrap gap-2">
              {SWATCHES.map((sw) => (
                <button
                  key={sw}
                  type="button"
                  aria-label={`Use ${sw}`}
                  onClick={() => setBrandColor(sw)}
                  className="h-9 w-9 rounded-full transition-transform hover:scale-110"
                  style={{
                    backgroundColor: sw,
                    boxShadow: brandColor === sw ? `0 0 0 2px var(--bg-base), 0 0 0 4px ${sw}` : "none",
                  }}
                />
              ))}
              <label
                className="flex h-9 w-9 cursor-pointer items-center justify-center rounded-full border border-dashed border-line text-ink-3"
                title="Custom color"
              >
                <Icon name="edit" size={14} />
                <input
                  type="color"
                  value={brandColor}
                  onChange={(e) => setBrandColor(e.target.value)}
                  className="sr-only"
                  aria-label="Custom brand color"
                />
              </label>
            </div>
            <p className="text-xs text-ink-3">Used for accents, buttons, and highlights on your company page.</p>
          </Card>

          <div className="flex justify-end">
            <Button onClick={save} loading={saving} disabled={!dirty}>
              Save branding
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
