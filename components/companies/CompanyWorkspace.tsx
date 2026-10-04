/**
 * components/companies/CompanyWorkspace.tsx — /company/[slug].
 *
 * Membership-gated: the slug is resolved from the viewer's own memberships
 * (GET /api/companies). Non-members see a "not a member" state and the UI
 * never requests company-private endpoints for them (the API 403s anyway).
 *
 * Shell + header; each tab lives in ./tabs/ (code-review split of the
 * original 850-line file).
 */
"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Avatar,
  Badge,
  Button,
  ErrorState,
  Icon,
  LoadingState,
  Tabs,
  TabPanel,
} from "@/components/ui";
import { apiGet, ApiError } from "@/lib/api-client";
import { companyRoleBadgeVariant, companyRoleLabel, isCompanyManagerRole } from "@/lib/company-roles";
import { CompanyOverviewTab } from "./tabs/CompanyOverviewTab";
import { CompanyFeedTab } from "./tabs/CompanyFeedTab";
import { CompanyMembersTab } from "./tabs/CompanyMembersTab";
import { CompanyManagersTab } from "./tabs/CompanyManagersTab";
import { CompanyTeamsTab } from "./tabs/CompanyTeamsTab";
import { CompanyAnnouncementsTab } from "./tabs/CompanyAnnouncementsTab";
import { CompanyMediaTab } from "./tabs/CompanyMediaTab";
import { CompanyAboutTab } from "./tabs/CompanyAboutTab";
import { CompanySettingsTab } from "./tabs/CompanySettingsTab";
import type { CompanyDetail, CompanyMembership } from "@/lib/types";

const TABS = [
  { id: "overview", label: "Overview" },
  { id: "feed", label: "Feed" },
  { id: "members", label: "Members" },
  { id: "managers", label: "Managers" },
  { id: "teams", label: "Teams" },
  { id: "announcements", label: "Announcements" },
  { id: "media", label: "Media" },
  { id: "about", label: "About" },
  { id: "settings", label: "Settings" },
];

export function CompanyWorkspace({ slug }: { slug: string }) {
  const [membership, setMembership] = useState<CompanyMembership | null>(null);
  const [detail, setDetail] = useState<CompanyDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notMember, setNotMember] = useState(false);
  const [tab, setTab] = useState("overview");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setNotMember(false);
    try {
      const mine = await apiGet<CompanyMembership[]>("/api/companies");
      const found = mine.find((m) => m.company.slug === slug);
      if (!found) {
        setNotMember(true);
        return;
      }
      setMembership(found);
      setDetail(await apiGet<CompanyDetail>(`/api/companies/${found.company.id}`));
    } catch (e) {
      if (e instanceof ApiError && e.status === 403) setNotMember(true);
      else setError(e instanceof Error ? e.message : "Could not load the company.");
    } finally {
      setLoading(false);
    }
  }, [slug]);

  useEffect(() => {
    void load();
  }, [load]);

  const company = detail?.company ?? membership?.company ?? null;
  const role = detail?.viewerRole ?? membership?.role ?? null;
  const isManager = isCompanyManagerRole(role);

  if (loading) return <LoadingState message="Loading company…" />;
  if (notMember || !company) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-16">
        <ErrorState
          title="You're not a member"
          message="This company workspace is private. Ask a manager to invite you, or check your email for an invitation."
          onRetry={() => void load()}
          retryLabel="Check again"
        />
      </div>
    );
  }
  if (error) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-16">
        <ErrorState message={error} onRetry={() => void load()} />
      </div>
    );
  }

  return (
    <div className="pb-10">
      {/* Cover + header */}
      <div className="relative">
        {company.coverUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img decoding="async" loading="lazy" src={company.coverUrl} alt="" aria-hidden className="img-dim h-40 w-full object-cover sm:h-52" />
        ) : (
          <div className="h-40 w-full bg-brand-gradient-soft sm:h-52" aria-hidden />
        )}
        <div className="mx-auto max-w-5xl px-4 sm:px-6">
          <div className="-mt-10 flex flex-wrap items-end gap-4">
            <Avatar src={company.logoUrl} name={company.name} size="xl" fallbackIcon="building" className="ring-4 ring-canvas" />
            <div className="min-w-0 flex-1 pb-1">
              <h1 className="font-display text-h1 font-bold text-ink">{company.name}</h1>
              <p className="text-body-sm text-ink-2">
                /{company.slug} ·{" "}
                {role && (
                  <Badge variant={companyRoleBadgeVariant(role)}>{companyRoleLabel(role)}</Badge>
                )}
              </p>
            </div>
            {isManager && (
              <Button href={`/manage/${company.slug}`} variant="outline" size="sm">
                <Icon name="shield" size={15} aria-hidden className="mr-1.5" />
                Manage
              </Button>
            )}
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-5xl px-4 sm:px-6">
        <Tabs tabs={TABS} value={tab} onValueChange={setTab} label="Company sections" className="mt-4">
          <TabPanel id="overview">
            <CompanyOverviewTab companyId={company.id} detail={detail!} />
          </TabPanel>
          <TabPanel id="feed">
            <CompanyFeedTab companyId={company.id} />
          </TabPanel>
          <TabPanel id="members">
            <CompanyMembersTab companyId={company.id} />
          </TabPanel>
          <TabPanel id="managers">
            <CompanyManagersTab companyId={company.id} />
          </TabPanel>
          <TabPanel id="teams">
            <CompanyTeamsTab companyId={company.id} slug={company.slug} isManager={isManager} />
          </TabPanel>
          <TabPanel id="announcements">
            <CompanyAnnouncementsTab companyId={company.id} isManager={isManager} />
          </TabPanel>
          <TabPanel id="media">
            <CompanyMediaTab companyId={company.id} />
          </TabPanel>
          <TabPanel id="about">
            <CompanyAboutTab detail={detail!} />
          </TabPanel>
          <TabPanel id="settings">
            <CompanySettingsTab detail={detail!} isManager={isManager} onSaved={() => void load()} />
          </TabPanel>
        </Tabs>
      </div>
    </div>
  );
}
