import { Fragment } from "react";
import { toHighlightSegments, type MatchRange } from "@/lib/entries/search";

/**
 * Renders text with the search-matched runs marked. Uses <mark> because
 * that is what it means — a screen reader announces it as highlighted,
 * which a styled <span> would not.
 *
 * Styling stays inside the app's monochrome palette rather than the
 * browser's default yellow <mark>, which would be the single loudest
 * colour anywhere in this UI.
 */
export function HighlightedText({ text, ranges }: { text: string; ranges: MatchRange[] }) {
  const segments = toHighlightSegments(text, ranges);
  return (
    <>
      {segments.map((segment, index) => (
        <Fragment key={index}>
          {segment.matched ? (
            <mark className="rounded-sm bg-zinc-200 text-foreground dark:bg-zinc-700">
              {segment.text}
            </mark>
          ) : (
            segment.text
          )}
        </Fragment>
      ))}
    </>
  );
}
