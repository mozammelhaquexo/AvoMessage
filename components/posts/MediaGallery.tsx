/**
 * components/posts/MediaGallery.tsx — post media grid (1–4 items).
 * Images render responsive; videos get native controls. Clicking an image
 * opens a lightbox dialog. Respects reduced motion; lazy-loads below fold.
 */
"use client";

import { useState } from "react";
import { Dialog } from "@/components/ui";
import { cn } from "@/components/ui/utils";
import { useAvoReducedMotion } from "@/lib/motion";
import type { PostMedia } from "@/lib/api-types";

function isVideo(media: PostMedia): boolean {
  return media.kind === "VIDEO" || media.kind === "video";
}

export function MediaGallery({ media }: { media: PostMedia[] }) {
  const [lightbox, setLightbox] = useState<string | null>(null);
  const reduceMotion = useAvoReducedMotion();
  if (media.length === 0) return null;

  const gridClass =
    media.length === 1
      ? "grid-cols-1"
      : media.length === 2
        ? "grid-cols-2"
        : "grid-cols-2";

  return (
    <>
      <div className={cn("mt-3 grid gap-2 overflow-hidden rounded-xl", gridClass)} role="group" aria-label="Post media">
        {media.map((m) => (
          <div
            key={m.id}
            className={cn(
              "relative overflow-hidden rounded-lg bg-surface-2",
              media.length === 1 ? "max-h-96" : "aspect-square",
              media.length === 3 && m === media[0] && "row-span-2 aspect-auto",
            )}
          >
            {isVideo(m) ? (
              <video
                src={m.url}
                controls
                preload="metadata"
                playsInline
                className="img-dim h-full w-full object-cover"
                aria-label="Post video"
              />
            ) : (
              <button
                type="button"
                onClick={() => setLightbox(m.url)}
                className="block h-full w-full cursor-zoom-in"
                aria-label="View image full size"
              >
                <img
                  src={m.url}
                  alt="Post image"
                  loading="lazy"
                  className={cn(
                    "img-dim h-full w-full object-cover",
                    !reduceMotion && "transition-transform duration-slow ease-out hover:scale-[1.02]",
                  )}
                />
              </button>
            )}
          </div>
        ))}
      </div>

      <Dialog
        open={lightbox !== null}
        onOpenChange={(open) => {
          if (!open) setLightbox(null);
        }}
        title="Image preview"
        size="xl"
        contentClassName="p-2"
      >
        {lightbox && (
          <img decoding="async" loading="lazy" src={lightbox} alt="Post image full size" className="img-dim max-h-[80vh] w-full rounded-lg object-contain" />
        )}
      </Dialog>
    </>
  );
}
