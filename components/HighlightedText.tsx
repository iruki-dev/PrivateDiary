import { Fragment } from "react";
import { toHighlightSegments, type MatchRange } from "@/lib/entries/search";

/**
 * Renders text with the search-matched runs marked. Uses <mark> because
 * that is what it means — a screen reader announces it as highlighted,
 * which a styled <span> would not.
 *
 * Styled globally (app/globals.css): a highlighter yellow, the one colour
 * in the app that isn't a warning — "where did I write this word" is the
 * one question a search screen exists to answer at a glance.
 */
export function HighlightedText({ text, ranges }: { text: string; ranges: MatchRange[] }) {
  const segments = toHighlightSegments(text, ranges);
  return (
    <>
      {segments.map((segment, index) => (
        <Fragment key={index}>
          {segment.matched ? (
            <mark>{segment.text}</mark>
          ) : (
            segment.text
          )}
        </Fragment>
      ))}
    </>
  );
}
