/**
 * components/companies/CreateCompanyForm.tsx — POST /api/companies.
 * The creator becomes the company's MANAGER (server-side) — never an owner;
 * the owner role is retired from the product (see lib/company-roles.ts).
 */
"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Button, Card, CardContent, CardHeader, CardTitle, FormField, Icon, Input, Textarea, toast } from "@/components/ui";
import { apiPost } from "@/lib/api-client";

export function CreateCompanyForm() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [description, setDescription] = useState("");
  const [website, setWebsite] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function slugify(v: string) {
    return v.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      const res = await apiPost<{ slug: string }>("/api/companies", {
        name: name.trim(),
        ...(slug.trim() ? { slug: slugify(slug) } : {}),
        ...(description.trim() ? { description: description.trim() } : {}),
        ...(website.trim() ? { website: website.trim() } : {}),
      });
      toast({ variant: "success", title: "Company created" });
      router.push(`/company/${res.slug}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create the company.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mx-auto max-w-xl px-4 py-8 sm:px-6">
      <Card>
        <CardHeader>
          <CardTitle className="font-display text-h2">Create a company</CardTitle>
          <p className="text-body-sm text-ink-2">
            You&apos;ll become the company&apos;s manager and can invite your team.
          </p>
        </CardHeader>
        <CardContent>
          <form onSubmit={submit} className="flex flex-col gap-4">
            <FormField label="Company name" required>
              {(fp) => (
                <Input
                  {...fp}
                  value={name}
                  onChange={(e) => {
                    setName(e.target.value);
                    if (!slug) setSlug(slugify(e.target.value));
                  }}
                  placeholder="Avocado Labs"
                  maxLength={80}
                  required
                />
              )}
            </FormField>
            <FormField label="URL slug" hint="Used in the company URL: /company/your-slug" required>
              {(fp) => <Input {...fp} value={slug} onChange={(e) => setSlug(slugify(e.target.value))} placeholder="avocado-labs" maxLength={60} required />}
            </FormField>
            <FormField label="Description">
              {(fp) => (
                <Textarea {...fp} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What does your company do?" rows={3} maxLength={1000} />
              )}
            </FormField>
            <FormField label="Website">
              {(fp) => <Input {...fp} type="url" value={website} onChange={(e) => setWebsite(e.target.value)} placeholder="https://example.com" maxLength={200} />}
            </FormField>
            {error && (
              <p role="alert" className="flex items-center gap-2 text-body-sm text-danger-strong">
                <Icon name="alert" size={16} aria-hidden />
                {error}
              </p>
            )}
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => router.back()}>
                Cancel
              </Button>
              <Button type="submit" loading={saving} disabled={!name.trim() || !slug.trim()}>
                Create company
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
