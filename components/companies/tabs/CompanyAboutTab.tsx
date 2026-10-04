/**
 * components/companies/tabs/CompanyAboutTab.tsx — company workspace About tab.
 *
 * Extracted from CompanyWorkspace.tsx (code-review split; no behavior change).
 */
"use client";

import { Card, CardContent, Icon } from "@/components/ui";
import type { CompanyDetail } from "@/lib/types";

export function CompanyAboutTab({ detail }: { detail: CompanyDetail }) {
  const c = detail.company;
  return (
    <div className="py-4">
      <Card>
        <CardContent className="flex flex-col gap-4 p-5">
          {c.description && (
            <div>
              <h3 className="text-caption font-semibold uppercase tracking-wider text-ink-3">About</h3>
              <p className="mt-1 whitespace-pre-wrap text-body-sm text-ink">{c.description}</p>
            </div>
          )}
          {c.website && (
            <div>
              <h3 className="text-caption font-semibold uppercase tracking-wider text-ink-3">Website</h3>
              <a href={c.website} target="_blank" rel="noopener noreferrer" className="mt-1 inline-flex items-center gap-1 text-body-sm text-brand-strong hover:underline">
                {c.website}
                <Icon name="link" size={13} aria-hidden />
              </a>
            </div>
          )}
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
            <div>
              <h3 className="text-caption font-semibold uppercase tracking-wider text-ink-3">Members</h3>
              <p className="mt-1 text-body-sm font-semibold text-ink">{detail.counts.members}</p>
            </div>
            <div>
              <h3 className="text-caption font-semibold uppercase tracking-wider text-ink-3">Teams</h3>
              <p className="mt-1 text-body-sm font-semibold text-ink">{detail.counts.teams}</p>
            </div>
            <div>
              <h3 className="text-caption font-semibold uppercase tracking-wider text-ink-3">Founded</h3>
              <p className="mt-1 text-body-sm font-semibold text-ink">{new Date(c.createdAt).toLocaleDateString()}</p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
