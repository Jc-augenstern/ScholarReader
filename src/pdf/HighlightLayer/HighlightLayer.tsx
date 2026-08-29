import type { Favorite, HighlightRect } from "../../core/models/favorite";

export type ResolvedHighlight = {
  favorite: Favorite;
  rects: HighlightRect[];
  isTarget: boolean;
};

type HighlightLayerProps = {
  highlights: ResolvedHighlight[];
  onFavoriteClick?: (favorite: Favorite) => void;
};

export function HighlightLayer({ highlights, onFavoriteClick }: HighlightLayerProps) {
  return (
    <div aria-hidden={!highlights.length} className="highlight-layer">
      {highlights.flatMap((highlight) =>
        highlight.rects.map((rect, index) => (
          <button
            aria-label={`收藏高亮：${highlight.favorite.selectedText}`}
            className={`favorite-highlight${highlight.isTarget ? " target flash" : ""}`}
            key={`${highlight.favorite.id}-${index}`}
            onClick={() => onFavoriteClick?.(highlight.favorite)}
            style={{
              left: `${rect.x * 100}%`,
              top: `${rect.y * 100}%`,
              width: `${rect.width * 100}%`,
              height: `${rect.height * 100}%`,
            }}
            type="button"
          />
        )),
      )}
    </div>
  );
}
